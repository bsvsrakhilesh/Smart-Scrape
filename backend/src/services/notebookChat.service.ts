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

const ChatAnswerSchema = z.object({
  answer: z.string().describe("Markdown answer for the user."),
  citations: z
    .array(
      z.object({
        chunkId: z.string().min(1),
      }),
    )
    .describe("List of cited chunk IDs used to answer."),
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
    "my",
    "your",
    "our",
    "their",
    "from",
    "as",
    "at",
    "by",
    "be",
    "been",
    "but",
    "can",
    "could",
    "should",
    "would",
  ]);

  return (q || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3 && !stop.has(s))
    .slice(0, 8);
}

async function retrieveRelevantChunkIdsVector(p: {
  notebookId: string;
  query: string;
  limit: number;
  sourceIds?: string[];
}) {
  if (!env.OPENAI_ENABLED) return [];

  const qEmb = await embedQuery(p.query);
  if (!qEmb) return [];

  const qVec = toPgVectorLiteral(qEmb);

  // Vector search only over embedded chunks
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT sc.id
    FROM "SourceChunk" sc
    JOIN "NotebookSource" ns ON ns.id = sc."sourceId"
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

  const rows = await prisma.$queryRaw<{ id: string; rank: number }[]>`
    SELECT sc.id, ts_rank_cd(sc."fts", q) AS rank
    FROM "SourceChunk" sc
    JOIN "NotebookSource" ns ON ns.id = sc."sourceId"
    CROSS JOIN plainto_tsquery('english', ${q}) AS q
    WHERE ns."notebookId" = ${p.notebookId}
      ${p.sourceIds?.length ? Prisma.sql`AND sc."sourceId" IN (${Prisma.join(p.sourceIds)})` : Prisma.empty}
      AND sc."fts" @@ q
    ORDER BY rank DESC
    LIMIT ${p.limit}
  `;

  return rows.map((r) => r.id);
}

async function retrieveRelevantChunkIdsHybrid(p: {
  notebookId: string;
  query: string;
  limit: number;
  sourceIds?: string[];
}) {
  // Pull more candidates than final context window
  const vecK = Math.max(20, p.limit * 4);
  const kwK = Math.max(20, p.limit * 4);

  const [vecTop, kwTop] = await Promise.all([
    retrieveRelevantChunkIdsVector({
      notebookId: p.notebookId,
      query: p.query,
      limit: vecK,
      sourceIds: p.sourceIds,
    }),
    retrieveRelevantChunkIdsKeywordFTS({
      notebookId: p.notebookId,
      query: p.query,
      limit: kwK,
      sourceIds: p.sourceIds,
    }),
  ]);

  const merged = uniq([...vecTop, ...kwTop]);

  if (!merged.length) {
    return pickRecentChunkIds(p.notebookId, p.limit, p.sourceIds);
  }

  // Rerank merged candidates (Phase 1 requirement)
  const reranked = await rerankChunkIds({
    query: p.query,
    candidateChunkIds: merged,
    finalLimit: p.limit,
  });

  // If reranker returns too few, fill with recents
  if (reranked.length < p.limit) {
    const fill = await pickRecentChunkIds(p.notebookId, p.limit, p.sourceIds);
    for (const id of fill) {
      if (!reranked.includes(id)) reranked.push(id);
      if (reranked.length >= p.limit) break;
    }
  }

  return reranked.slice(0, p.limit);
}

async function pickRecentChunkIds(
  notebookId: string,
  limit: number,
  sourceIds?: string[],
): Promise<string[]> {
  const rows = await prisma.sourceChunk.findMany({
    where: {
      source: { notebookId },
      ...(sourceIds?.length ? { sourceId: { in: sourceIds } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.max(0, Math.min(20, limit)),
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

const RerankSchema = z.object({
  ranked: z.array(
    z.object({
      chunkId: z.string().min(1),
      score: z.number().min(0).max(100),
    }),
  ),
});

async function rerankChunkIds(p: {
  query: string;
  candidateChunkIds: string[];
  finalLimit: number;
}) {
  const candidateIds = p.candidateChunkIds.slice(0, 40); // cap cost
  if (!candidateIds.length) return [];

  // Load chunk text for reranking
  const rows = await prisma.sourceChunk.findMany({
    where: { id: { in: candidateIds } },
    select: { id: true, text: true },
  });

  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = candidateIds.map((id) => byId.get(id)).filter(Boolean) as {
    id: string;
    text: string;
  }[];

  // If OpenAI disabled, do a simple lexical overlap scoring (fallback)
  if (!env.OPENAI_ENABLED) {
    const kws = extractKeywords(p.query);
    const scored = ordered
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

    return scored.slice(0, p.finalLimit);
  }

  // LLM rerank (cross-check)
  const system = [
    "You are a strict reranker for retrieval chunks.",
    "Your job: rank chunks by how well they answer the user query.",
    "Prefer chunks with direct, explicit evidence (exact names, numbers, definitions).",
    "Do NOT hallucinate. You must only score based on provided chunk text.",
    "Return JSON only.",
  ].join("\n");

  const items = ordered
    .map((c, i) => {
      const trimmed = (c.text ?? "").slice(0, 900);
      return `ITEM ${i + 1}\nCHUNK_ID: ${c.id}\nTEXT:\n${trimmed}\n----`;
    })
    .join("\n");

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
  if (!out) return ordered.map((c) => c.id).slice(0, p.finalLimit);

  const allowed = new Set(candidateIds);
  const ranked = out.ranked
    .filter((r) => allowed.has(r.chunkId))
    .sort((a, b) => b.score - a.score)
    .map((r) => r.chunkId);

  // Ensure we don’t drop everything if model behaves oddly
  const merged = uniq([...ranked, ...ordered.map((c) => c.id)]);
  return merged.slice(0, p.finalLimit);
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
        c.text,
        "-----",
      ].join("\n");
    })
    .join("\n");
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
  const sourceIds = p.sourceIds;

  // Always compute some citations to keep UI usable even if OpenAI disabled
  const candidateChunkIds = await retrieveRelevantChunkIdsHybrid({
    notebookId,
    query: message,
    limit: 8,
    sourceIds,
  });

  // If OpenAI is not enabled, keep behavior close to Phase 1 stub (safe fallback)
  if (!env.OPENAI_ENABLED) {
    return {
      answer: `**Draft answer (backend)**\n\nYou asked: _${message}_`,
      citations: candidateChunkIds.slice(0, 2).map((id) => ({ chunkId: id })),
      suggested: [],
    };
  }

  const chunks = await loadChunksForContext(candidateChunkIds);
  const context = formatContext(chunks);
  const allowed = new Set(candidateChunkIds);

  const system = [
    "You are a notebook assistant.",
    "Answer the user in Markdown.",
    "Use ONLY the provided SOURCE CHUNKS as evidence.",
    "If the chunks do not contain enough information, say you don't have enough information from the provided sources.",
    "",
    "CITATIONS RULES:",
    "- You may only cite chunk IDs that appear in the provided chunks.",
    "- Return citations as an array of { chunkId } objects.",
    "- Cite the chunks you actually relied on.",
    "",
    "SUGGESTED:",
    "- Return 3–6 suggested follow-up questions as plain strings.",
  ].join("\n");

  const user = [
    `USER_QUESTION:\n${message}`,
    "",
    "SOURCE_CHUNKS:",
    context,
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

  // Safety: never allow hallucinated citations
  const filteredCitations = uniq(out.citations.map((c) => c.chunkId))
    .filter((id) => allowed.has(id))
    .slice(0, 10)
    .map((chunkId) => ({ chunkId }));

  return {
    answer: out.answer,
    citations: filteredCitations,
    suggested: out.suggested ?? [],
  };
}
