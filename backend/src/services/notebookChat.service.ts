// backend/src/services/notebookChat.service.ts
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import prisma from "../config/database";
import { env } from "../config/env";
import { openaiClient, defaultModel } from "./openaiClient";
import { Prisma } from "@prisma/client";
import { embedQuery, toPgVectorLiteral } from "./embeddings.service";

export type ChatHistoryItem = {
  role: "user" | "assistant";
  content: string;
};

const CitationSchema = z.object({
  chunkId: z.string().min(1),
  quote: z.string().min(20).max(240),
});

const ChatAnswerSchema = z.object({
  answer: z.string().describe("Markdown answer for the user."),
  citations: z
    .array(CitationSchema)
    .describe(
      "List of citations used to answer. Each citation must include a verbatim quote substring from the chunk text.",
    ),
  suggested: z
    .array(z.string().min(1))
    .max(6)
    .describe("Suggested follow-up questions."),
});

function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

function extractKeywords(q: string) {
  const stop = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "to",
    "of",
    "in",
    "on",
    "for",
    "with",
    "is",
    "are",
    "was",
    "were",
    "i",
    "you",
    "we",
    "they",
    "it",
    "this",
    "that",
    "these",
    "those",
    "as",
    "at",
    "by",
    "from",
    "be",
    "been",
    "being",
    "can",
    "could",
    "should",
    "would",
    "will",
    "may",
    "might",
    "do",
    "does",
    "did",
    "not",
    "no",
    "yes",
    "your",
    "my",
    "our",
    "their",
  ]);

  return q
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3 && !stop.has(s))
    .slice(0, 12);
}

async function retrieveRelevantChunkIdsVector(p: {
  notebookId: string;
  query: string;
  limit: number;
  sourceIds?: string[];
}) {
  const qEmbedding = await embedQuery(p.query);
  if (!qEmbedding || !Array.isArray(qEmbedding) || qEmbedding.length === 0) {
    // If embeddings unavailable, skip vector retrieval gracefully
    return [];
  }
  const qVec = toPgVectorLiteral(qEmbedding);

  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT sc."id"
    FROM "SourceChunk" sc
    JOIN "NotebookSource" ns ON ns."id" = sc."sourceId"
    WHERE ns."notebookId" = ${p.notebookId}
      AND sc."embedding" IS NOT NULL
      ${
        p.sourceIds?.length
          ? Prisma.sql`AND sc."sourceId" IN (${Prisma.join(p.sourceIds)})`
          : Prisma.empty
      }
    ORDER BY sc."embedding" <=> ${qVec}::vector
    LIMIT ${p.limit}
  `;

  return rows.map((r) => r.id);
}

async function retrieveRelevantChunkIdsKeywordFTS(p: {
  notebookId: string;
  query: string;
  limit: number;
  sourceIds?: string[];
}) {
  const q = (p.query ?? "").trim();
  if (!q) return [];

  // Prefer FTS if column exists; otherwise fallback to basic substring scoring
  try {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT sc."id"
      FROM "SourceChunk" sc
      JOIN "NotebookSource" ns ON ns."id" = sc."sourceId"
      WHERE ns."notebookId" = ${p.notebookId}
        ${
          p.sourceIds?.length
            ? Prisma.sql`AND sc."sourceId" IN (${Prisma.join(p.sourceIds)})`
            : Prisma.empty
        }
        AND sc."fts" @@ plainto_tsquery('english', ${q})
      ORDER BY ts_rank(sc."fts", plainto_tsquery('english', ${q})) DESC
      LIMIT ${p.limit}
    `;
    return rows.map((r) => r.id);
  } catch {
    // Fallback: naive substring scoring on a small window
    const rows = await prisma.sourceChunk.findMany({
      where: {
        source: {
          notebookId: p.notebookId,
          ...(p.sourceIds?.length ? { id: { in: p.sourceIds } } : {}),
        },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { id: true, text: true },
    });

    const kws = extractKeywords(q);
    const scored = rows
      .map((c) => {
        const t = c.text.toLowerCase();
        let s = 0;
        for (const k of kws) {
          const hits = t.split(k).length - 1;
          s += hits * 3;
          if (t.slice(0, 200).includes(k)) s += 2;
        }
        return { id: c.id, score: s };
      })
      .sort((a, b) => b.score - a.score)
      .map((x) => x.id);

    return scored.slice(0, p.limit);
  }
}

async function retrieveRelevantChunkIdsHybrid(p: {
  notebookId: string;
  query: string;
  limit: number;
  sourceIds?: string[];
}) {
  // Pull a bit extra from each side, merge, then optionally rerank later
  const vecTop = await retrieveRelevantChunkIdsVector({
    notebookId: p.notebookId,
    query: p.query,
    limit: Math.max(6, p.limit),
    sourceIds: p.sourceIds,
  });

  const kwTop = await retrieveRelevantChunkIdsKeywordFTS({
    notebookId: p.notebookId,
    query: p.query,
    limit: Math.max(6, p.limit),
    sourceIds: p.sourceIds,
  });

  const merged = uniq([...vecTop, ...kwTop]);

  // Keep it bounded (context window)
  return merged.slice(0, Math.max(p.limit, 8));
}

const RerankSchema = z.object({
  ranked: z.array(
    z.object({
      chunkId: z.string(),
      score: z.number().min(0).max(100),
    }),
  ),
});

async function rerankWithLLM(p: {
  query: string;
  candidates: { chunkId: string; text: string; sourceLabel: string }[];
  finalLimit: number;
  temperature?: number;
}) {
  if (!p.candidates.length) return [];

  const items = p.candidates
    .map((c, i) => {
      const t = (c.text ?? "").slice(0, 800).replace(/\s+/g, " ").trim();
      return [
        `#${i + 1}`,
        `CHUNK_ID: ${c.chunkId}`,
        `SOURCE: ${c.sourceLabel}`,
        `TEXT: ${t}`,
      ].join("\n");
    })
    .join("\n\n");

  const system = [
    "You are a strict reranker for retrieval candidates.",
    "Given a user query and candidate chunks, output a ranked list of chunk IDs with relevance scores.",
    "Prioritize exact evidence that answers the question over semantically-related but non-evidentiary text.",
    "Return only JSON matching the schema.",
  ].join("\n");

  const user = [
    `QUERY:\n${p.query}`,
    "",
    "CANDIDATES:",
    items,
    "",
    `Return JSON as { ranked: [{ chunkId, score }] } with highest score = most relevant.`,
  ].join("\n");

  const resp = await openaiClient().responses.parse({
    model: defaultModel(),
    input: [
      { role: "system" as const, content: system },
      { role: "user" as const, content: user },
    ],
    text: { format: zodTextFormat(RerankSchema, "rerank") },
  });

  const out = resp.output_parsed;
  if (!out) return [];

  const allowed = new Set(p.candidates.map((c) => c.chunkId));
  const ordered = out.ranked
    .filter((r) => allowed.has(r.chunkId))
    .sort((a, b) => b.score - a.score)
    .map((r) => r.chunkId);

  // If model returns too few, fall back to original order
  const final = uniq([...ordered, ...p.candidates.map((c) => c.chunkId)]).slice(
    0,
    p.finalLimit,
  );

  return final;
}

async function loadChunksForContext(chunkIds: string[]) {
  if (!chunkIds.length) return [];
  const rows = await prisma.sourceChunk.findMany({
    where: { id: { in: chunkIds } },
    include: {
      source: { include: { url: true, file: true } },
    },
  });

  // Preserve the order of chunkIds
  const byId = new Map(rows.map((r) => [r.id, r]));
  return chunkIds.map((id) => byId.get(id)).filter(Boolean) as typeof rows;
}

type PageRange = {
  pageNumber: number;
  globalStart: number;
  globalEnd: number;
};

function mapGlobalToPage(
  ranges: PageRange[],
  globalPos: number,
  isEnd: boolean,
) {
  if (!ranges.length) return null;

  // end boundary maps to preceding char (like your chunk mapper)
  const pos = isEnd ? Math.max(0, globalPos - 1) : globalPos;

  const r =
    ranges.find((x) => pos >= x.globalStart && pos < x.globalEnd) ??
    ranges[ranges.length - 1];

  return {
    pageNumber: r.pageNumber,
    char: Math.max(0, globalPos - r.globalStart),
  };
}

function formatContext(
  chunks: Awaited<ReturnType<typeof loadChunksForContext>>,
) {
  if (!chunks.length) return "NO_SOURCES_AVAILABLE";

  return chunks
    .map((c) => {
      const sourceLabel =
        c.source?.kind === "URL"
          ? `URL: ${c.source.url?.title ?? c.source.url?.url ?? "unknown"}`
          : `FILE: ${c.source.file?.fileName ?? "unknown"}`;

      return [
        `CHUNK_ID: ${c.id}`,
        `SOURCE: ${sourceLabel}`,
        `CHUNK_INDEX: ${c.idx}`,
        "TEXT:",
        (c.text ?? "").trim(),
      ].join("\n");
    })
    .join("\n\n---\n\n");
}

async function buildFallbackCitations(chunkIds: string[], limit = 4) {
  const ids = uniq(chunkIds).slice(0, limit);
  if (!ids.length) return [];

  const rows = await prisma.sourceChunk.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      text: true,
      pageStart: true,
      pageEnd: true,
      charStart: true,
      charEnd: true,
    } as any,
  });

  const byId = new Map(rows.map((r: any) => [r.id, r]));
  return ids
    .map((id) => {
      const r: any = byId.get(id);
      if (!r) return null;
      const quote = (r.text || "").slice(0, 200).replace(/\s+/g, " ").trim();
      return {
        chunkId: id,
        quote:
          quote.length >= 20 ? quote : (quote + " ").padEnd(20, " ").trim(),
        pageStart: r.pageStart ?? null,
        pageEnd: r.pageEnd ?? null,
        charStart: r.charStart ?? null,
        charEnd: r.charEnd ?? null,
      };
    })
    .filter(Boolean) as any[];
}

export async function runNotebookChat(p: {
  notebookId: string;
  message: string;
  history?: ChatHistoryItem[];
  sourceIds?: string[];
}) {
  const notebookId = p.notebookId;
  const message = (p.message ?? "").trim();
  const history = Array.isArray(p.history) ? p.history.slice(-12) : [];
  const filterSourceIds = p.sourceIds;

  // Always compute some citations to keep UI usable even if OpenAI disabled
  const candidateChunkIds = await retrieveRelevantChunkIdsHybrid({
    notebookId,
    query: message,
    limit: 8,
    sourceIds: filterSourceIds,
  });

  // If OpenAI is not enabled, keep behavior close to Phase 1 stub (safe fallback)
  if (!env.OPENAI_ENABLED) {
    return {
      answer: `**Draft answer (backend)**\n\nYou asked: _${message}_`,
      citations: await buildFallbackCitations(candidateChunkIds, 2),
      suggested: [],
    };
  }

  const chunks = await loadChunksForContext(candidateChunkIds);
  const context = formatContext(chunks);

  // Optional LLM rerank step for reliability
  const rerankCandidates = chunks.map((c) => {
    const sourceLabel =
      c.source?.kind === "URL"
        ? `URL: ${c.source.url?.title ?? c.source.url?.url ?? "unknown"}`
        : `FILE: ${c.source.file?.fileName ?? "unknown"}`;
    return {
      chunkId: c.id,
      text: c.text ?? "",
      sourceLabel,
    };
  });

  let finalChunkIds = candidateChunkIds;
  try {
    finalChunkIds = await rerankWithLLM({
      query: message,
      candidates: rerankCandidates,
      finalLimit: 8,
      temperature: 0,
    });
  } catch {
    // If rerank fails, proceed with hybrid order
    finalChunkIds = candidateChunkIds;
  }

  const allowed = new Set(finalChunkIds);
  const finalChunks = await loadChunksForContext(finalChunkIds);
  const finalContext = formatContext(finalChunks);

  const system = [
    "You are a helpful assistant for a Notebook-like product.",
    "Answer using ONLY the provided SOURCE_CHUNKS as evidence.",
    "If the sources do not contain the answer, say you cannot verify it from the sources.",
    "",
    "OUTPUT FORMAT:",
    "Return a JSON object that matches the required schema.",
    "",
    "CITATIONS RULES:",
    "- Every non-trivial claim MUST have citations.",
    "- citations MUST be an array of objects: { chunkId, quote }.",
    "- quote MUST be copied EXACTLY from the cited chunk text (verbatim substring).",
    "- quote length must be 20–240 characters.",
    "- Only cite chunks from SOURCE_CHUNKS (IDs provided). Never invent IDs.",
    "- If you cannot find a verbatim quote supporting a claim, say you cannot verify it from the sources.",
    "",
    "SUGGESTED:",
    "- Return 3–6 suggested follow-up questions as plain strings.",
  ].join("\n");

  const user = [
    `USER_QUESTION:\n${message}`,
    "",
    "SOURCE_CHUNKS:",
    finalContext,
    "",
    "Return a JSON object that matches the required schema.",
  ].join("\n");

  const input = [
    { role: "system" as const, content: system },
    ...history.map((h) => ({
      role: h.role,
      content: h.content,
    })),
    { role: "user" as const, content: user },
  ];

  const resp = await openaiClient().responses.parse({
    model: defaultModel(),
    input,
    text: {
      format: zodTextFormat(ChatAnswerSchema, "chat_answer"),
    },
  });

  const out = resp.output_parsed;
  if (!out) {
    throw new Error(
      "OpenAI did not return a valid structured response (output_parsed is null).",
    );
  }

  const byChunkId = new Map(finalChunks.map((c: any) => [c.id, c]));

  // Load page ranges for all involved sources (for quote->page mapping)
  const chunkSourceIds = uniq(finalChunks.map((c: any) => c.sourceId));
  let pageRangesBySource = new Map<string, PageRange[]>();

  try {
    const pages = await (prisma as any).sourcePage.findMany({
      where: { sourceId: { in: chunkSourceIds } },
      select: {
        sourceId: true,
        pageNumber: true,
        globalStart: true,
        globalEnd: true,
      },
      orderBy: [{ sourceId: "asc" }, { pageNumber: "asc" }],
    });

    for (const p of pages) {
      const arr = pageRangesBySource.get(p.sourceId) ?? [];
      arr.push({
        pageNumber: p.pageNumber,
        globalStart: p.globalStart,
        globalEnd: p.globalEnd,
      });
      pageRangesBySource.set(p.sourceId, arr);
    }
  } catch {
    // If SourcePage isn't available for some sources, we keep page fields null.
  }

  const validatedCitations = (out.citations ?? [])
    .filter((c: any) => allowed.has(c.chunkId))
    .map((c: any) => {
      const chunk: any = byChunkId.get(c.chunkId);
      if (!chunk) return null;

      const quote = (c.quote || "").replace(/\s+/g, " ").trim();
      if (quote.length < 20 || quote.length > 240) return null;

      // Must be a verbatim substring of the chunk text
      const idx = (chunk.text || "").indexOf(quote);
      if (idx < 0) return null;

      // Quote-level global offsets (preferred)
      const hasGlobal = typeof chunk.globalStart === "number";
      const quoteGlobalStart = hasGlobal ? chunk.globalStart + idx : null;
      const quoteGlobalEnd = hasGlobal ? quoteGlobalStart + quote.length : null;

      const ranges = pageRangesBySource.get(chunk.sourceId) ?? [];

      const s =
        quoteGlobalStart != null
          ? mapGlobalToPage(ranges, quoteGlobalStart, false)
          : null;
      const e =
        quoteGlobalEnd != null
          ? mapGlobalToPage(ranges, quoteGlobalEnd, true)
          : null;

      return {
        chunkId: c.chunkId,
        quote,

        // Quote span mapping (Phase 2)
        pageStart: s?.pageNumber ?? null,
        pageEnd: e?.pageNumber ?? null,
        charStart: s?.char ?? null,
        charEnd: e?.char ?? null,
      };
    })
    .filter(Boolean)
    .slice(0, 10) as any[];

  return {
    answer: out.answer,
    citations: validatedCitations,
    suggested: out.suggested ?? [],
  };
}
