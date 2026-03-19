// backend/src/services/notebookChat.service.ts
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import prisma from "../config/database";
import { env } from "../config/env";
import { openaiClient, defaultModel } from "./openaiClient";
import { Prisma } from "../generated/prisma/client";
import { embedQuery, toPgVectorLiteral } from "./embeddings.service";

export type ChatHistoryItem = {
  role: "user" | "assistant";
  content: string;
};

export type AnswerMode = "draft" | "evidence" | "briefing";

const NOTEBOOK_CHAT_PROMPT_VERSION = "notebook-chat-v2";

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export type NotebookChatHistoryRun = {
  id: string;
  createdAt: string;
  status: "SUCCEEDED" | "FAILED";
  userMessage: string;
  answerMode: AnswerMode;
  answer: string | null;
  citations: any[];
  evidence: any[];
  suggested: string[];
  error: string | null;
  promptVersion: string | null;
  model: string | null;
  latencyMs: number | null;
};

type PersistedChatResult = {
  mode: AnswerMode;
  answer: string;
  citations: any[];
  evidence?: any[];
  suggested: string[];
};

type ChatRunContext = {
  notebookId: string;
  requestId?: string | null;
  createdBy?: string | null;
  message: string;
  history: ChatHistoryItem[];
  answerMode: AnswerMode;
  sourceIds?: string[];
};

async function createNotebookChatRun(ctx: ChatRunContext) {
  return prisma.notebookChatRun.create({
    data: {
      notebookId: ctx.notebookId,
      createdBy: ctx.createdBy ?? null,
      requestId: ctx.requestId ?? null,
      promptVersion: NOTEBOOK_CHAT_PROMPT_VERSION,
      answerMode: ctx.answerMode,
      model: env.OPENAI_ENABLED ? defaultModel() : null,
      status: "STARTED",
      userMessage: ctx.message,
      history: asJson(ctx.history ?? []),
      scopedSourceIds: ctx.sourceIds ?? [],
    },
    select: { id: true },
  });
}

async function succeedNotebookChatRun(p: {
  runId: string;
  result: PersistedChatResult;
  startedAtMs: number;
  candidateChunkIds?: string[];
  finalChunkIds?: string[];
  sourceRevisionIds?: string[];
  documentRevisionIds?: string[];
  pipelineConfigIds?: string[];
  openaiResponseId?: string | null;
}) {
  const latencyMs = Date.now() - p.startedAtMs;

  await prisma.notebookChatRun.update({
    where: { id: p.runId },
    data: {
      status: "SUCCEEDED",
      latencyMs,
      openaiResponseId: p.openaiResponseId ?? null,
      answer: p.result.answer,
      citations: asJson(p.result.citations ?? []),
      evidence: asJson(p.result.evidence ?? []),
      suggested: asJson(p.result.suggested ?? []),
      retrievedChunkIds: p.candidateChunkIds ?? [],
      finalChunkIds: p.finalChunkIds ?? [],
      sourceRevisionIds: p.sourceRevisionIds ?? [],
      documentRevisionIds: p.documentRevisionIds ?? [],
      pipelineConfigIds: p.pipelineConfigIds ?? [],
    },
  });

  return {
    ...p.result,
    runId: p.runId,
    promptVersion: NOTEBOOK_CHAT_PROMPT_VERSION,
    model: env.OPENAI_ENABLED ? defaultModel() : null,
    latencyMs,
  };
}

async function failNotebookChatRun(p: {
  runId: string;
  startedAtMs: number;
  error: unknown;
  candidateChunkIds?: string[];
  finalChunkIds?: string[];
  sourceRevisionIds?: string[];
  documentRevisionIds?: string[];
  pipelineConfigIds?: string[];
}) {
  await prisma.notebookChatRun.update({
    where: { id: p.runId },
    data: {
      status: "FAILED",
      latencyMs: Date.now() - p.startedAtMs,
      error:
        p.error instanceof Error
          ? p.error.message
          : String(p.error ?? "Unknown error"),
      retrievedChunkIds: p.candidateChunkIds ?? [],
      finalChunkIds: p.finalChunkIds ?? [],
      sourceRevisionIds: p.sourceRevisionIds ?? [],
      documentRevisionIds: p.documentRevisionIds ?? [],
      pipelineConfigIds: p.pipelineConfigIds ?? [],
    },
  });
}

export async function listNotebookChatRuns(p: {
  notebookId: string;
  limit?: number;
}): Promise<NotebookChatHistoryRun[]> {
  const limit = Math.max(1, Math.min(200, Math.trunc(p.limit ?? 50)));

  const notebook = await prisma.notebook.findUnique({
    where: { id: p.notebookId },
    select: { id: true },
  });

  if (!notebook) {
    const err: any = new Error("Notebook not found");
    err.status = 404;
    throw err;
  }

  const rows = await prisma.notebookChatRun.findMany({
    where: {
      notebookId: p.notebookId,
      status: { in: ["SUCCEEDED", "FAILED"] },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      createdAt: true,
      status: true,
      userMessage: true,
      answerMode: true,
      answer: true,
      citations: true,
      evidence: true,
      suggested: true,
      error: true,
      promptVersion: true,
      model: true,
      latencyMs: true,
    },
  });

  return rows.reverse().map((r) => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    status: r.status as "SUCCEEDED" | "FAILED",
    userMessage: r.userMessage,
    answerMode:
      r.answerMode === "evidence" || r.answerMode === "briefing"
        ? r.answerMode
        : "draft",
    answer: r.answer ?? null,
    citations: asArray(r.citations),
    evidence: asArray(r.evidence),
    suggested: asArray<string>(r.suggested).filter(
      (x): x is string => typeof x === "string",
    ),
    error: r.error ?? null,
    promptVersion: r.promptVersion ?? null,
    model: r.model ?? null,
    latencyMs: r.latencyMs ?? null,
  }));
}

const CitationSchema = z.object({
  chunkId: z.string().min(1),
  quote: z.string().min(20).max(240),
});

const EvidenceBlockSchema = z.object({
  claim: z.string().min(5).max(800),
  citations: z
    .array(CitationSchema)
    .min(1)
    .max(6)
    .describe("Citations that directly support this claim."),
});

const ChatAnswerSchema = z.object({
  mode: z.enum(["draft", "evidence", "briefing"]).default("draft"),
  answer: z.string().describe("Markdown answer for the user."),
  citations: z
    .array(CitationSchema)
    .describe(
      "Flat list of citations used anywhere in the answer. Each citation must include a verbatim quote substring from the chunk text.",
    ),
  evidence: z
    .array(EvidenceBlockSchema)
    .optional()
    .describe(
      "If mode=evidence, provide a list of atomic claims with their supporting citations. If not evidence mode, omit or return an empty array.",
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

  const maxDist = env.RETRIEVAL_MAX_COSINE_DISTANCE ?? 0.42;

  const rows = await prisma.$queryRaw<{ id: string; dist: number }[]>`
    SELECT sc."id",
           (sc."embedding" <=> ${qVec}::vector)::float8 AS dist
    FROM "SourceChunk" sc
    JOIN "NotebookSource" ns ON ns."id" = sc."sourceId"
    JOIN "SourceRevision" sr ON sr."id" = sc."revisionId"
    WHERE ns."notebookId" = ${p.notebookId}
      AND sr."isActive" = true
      AND sc."embedding" IS NOT NULL
      ${
        p.sourceIds?.length
          ? Prisma.sql`AND sc."sourceId" IN (${Prisma.join(p.sourceIds)})`
          : Prisma.empty
      }
    ORDER BY dist ASC
    LIMIT ${p.limit}
  `;

  return rows.filter((r) => Number(r.dist) <= maxDist).map((r) => r.id);
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
        JOIN "SourceRevision" sr ON sr."id" = sc."revisionId"
        WHERE ns."notebookId" = ${p.notebookId}
          AND sr."isActive" = true
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
        revision: { isActive: true },
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
    if (!kws.length) return [];

    const scored = rows.map((c) => {
      const t = c.text.toLowerCase();
      let s = 0;
      for (const k of kws) {
        const hits = t.split(k).length - 1;
        s += hits * 3;
        if (t.slice(0, 200).includes(k)) s += 2;
      }
      return { id: c.id, score: s };
    });

    const maxScore = scored.reduce((m, x) => Math.max(m, x.score), 0);
    if (maxScore <= 0) return [];

    return scored
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, p.limit)
      .map((x) => x.id);
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
      revision: {
        select: {
          id: true,
          documentRevisionId: true,
          pipelineConfigId: true,
        },
      },
    },
  });

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

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type QuoteMatch = { idx: number; quote: string };

function findVerbatimQuote(
  chunkText: string,
  quoteFromModel: string,
): QuoteMatch | null {
  const raw = (quoteFromModel ?? "").replace(/\u00a0/g, " ").trim(); // normalize NBSP only
  if (!raw) return null;
  if (raw.length < 20) return null;

  // Exact match first (fast path)
  const exactIdx = chunkText.indexOf(raw);
  if (exactIdx >= 0) {
    const q = raw.length > 240 ? raw.slice(0, 240) : raw;
    return { idx: exactIdx, quote: q };
  }

  // Whitespace-flex match: token1\s+token2\s+...
  const tokens = raw.split(/\s+/g).filter(Boolean);
  if (tokens.length < 3) return null;

  const pattern = tokens.map(escapeRegExp).join("\\s+");
  const re = new RegExp(pattern, "m");
  const m = re.exec(chunkText);
  if (!m || m.index == null) return null;

  const matched = m[0];
  if (matched.length < 20) return null;

  const quote = matched.length > 240 ? matched.slice(0, 240) : matched;
  return { idx: m.index, quote };
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
  sourceIds?: string[];
  history?: ChatHistoryItem[];
  answerMode?: AnswerMode;
  requestId?: string | null;
  createdBy?: string | null;
}) {
  const notebookId = p.notebookId;
  const message = (p.message ?? "").trim();
  const mode: AnswerMode = p.answerMode ?? "draft";
  const history = Array.isArray(p.history) ? p.history.slice(-12) : [];
  const filterSourceIds = p.sourceIds;
  const startedAtMs = Date.now();

  const run = await createNotebookChatRun({
    notebookId,
    requestId: p.requestId ?? null,
    createdBy: p.createdBy ?? null,
    message,
    history,
    answerMode: mode,
    sourceIds: filterSourceIds,
  });

  let candidateChunkIds: string[] = [];
  let finalChunkIds: string[] = [];
  let sourceRevisionIds: string[] = [];
  let documentRevisionIds: string[] = [];
  let pipelineConfigIds: string[] = [];

  try {
    candidateChunkIds = await retrieveRelevantChunkIdsHybrid({
      notebookId,
      query: message,
      limit: 8,
      sourceIds: filterSourceIds,
    });

    if (!env.OPENAI_ENABLED) {
      return await succeedNotebookChatRun({
        runId: run.id,
        startedAtMs,
        candidateChunkIds,
        finalChunkIds: candidateChunkIds,
        result: {
          mode,
          answer: `**Draft answer (backend)**\n\nYou asked: _${message}_`,
          citations: await buildFallbackCitations(candidateChunkIds, 2),
          evidence: [],
          suggested: [],
        },
      });
    }

    if (candidateChunkIds.length === 0) {
      const requested = Array.isArray(p.sourceIds) ? p.sourceIds : null;

      if (requested && requested.length === 0) {
        return await succeedNotebookChatRun({
          runId: run.id,
          startedAtMs,
          candidateChunkIds,
          finalChunkIds: [],
          result: {
            mode,
            answer:
              "No sources are selected. Include at least one **Ready** source to get cited answers.",
            citations: [],
            evidence: [],
            suggested: [
              "Open Manage → include a source",
              "Add a URL or File source",
              "Ask: “Summarize the included sources with citations”",
            ],
          },
        });
      }

      return await succeedNotebookChatRun({
        runId: run.id,
        startedAtMs,
        candidateChunkIds,
        finalChunkIds: [],
        result: {
          mode,
          answer:
            "I couldn’t find any relevant passages in the **Ready** sources for your question. " +
            "Try rephrasing with more specific keywords, or include more sources (and wait for indexing to reach **Ready**).",
          citations: [],
          evidence: [],
          suggested: [
            "Rephrase using key terms that appear in the sources",
            "Ask for a source summary first (with citations)",
            "Include additional sources related to this question",
          ],
        },
      });
    }

    const chunks = await loadChunksForContext(candidateChunkIds);

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

    try {
      finalChunkIds = await rerankWithLLM({
        query: message,
        candidates: rerankCandidates,
        finalLimit: 8,
        temperature: 0,
      });
    } catch {
      finalChunkIds = candidateChunkIds;
    }

    const allowed = new Set(finalChunkIds);
    const finalChunks = await loadChunksForContext(finalChunkIds);
    const finalContext = formatContext(finalChunks);

    sourceRevisionIds = uniq(
      finalChunks.map((c: any) => c.revisionId).filter(Boolean),
    ) as string[];

    documentRevisionIds = uniq(
      finalChunks
        .map((c: any) => c.revision?.documentRevisionId)
        .filter(Boolean),
    ) as string[];

    pipelineConfigIds = uniq(
      finalChunks.map((c: any) => c.revision?.pipelineConfigId).filter(Boolean),
    ) as string[];

    const system = [
      "You are a helpful assistant for a Notebook-like product.",
      "Answer using ONLY the provided SOURCE_CHUNKS as evidence.",
      "Conversation history (if present) is for context only; it is NOT evidence. Never cite it; cite only SOURCE_CHUNKS.",
      "If the sources do not contain the answer, say you cannot verify it from the sources.",
      "",
      "MODE GUIDANCE:",
      "- mode=draft: normal helpful answer.",
      "- mode=evidence: return evidence blocks (atomic claims + citations); answer should be a short summary (3–8 lines).",
      "- mode=briefing: write like a policy/ops briefing (executive summary, key findings, recommendations, uncertainties), still fully cited.",
      "",
      "OUTPUT FORMAT:",
      "Return a JSON object that matches the required schema.",
      "- mode MUST equal ANSWER_MODE (draft/evidence/briefing).",
      "",
      "CITATIONS RULES:",
      "- Every non-trivial claim MUST have citations.",
      "- citations MUST be an array of objects: { chunkId, quote }.",
      "- quote MUST be copied EXACTLY from the cited chunk text (verbatim substring).",
      "- quote length must be 20–240 characters.",
      "- Only cite chunks from SOURCE_CHUNKS (IDs provided). Never invent IDs.",
      "- If you cannot find a verbatim quote supporting a claim, say you cannot verify it from the sources.",
      "- If mode=evidence, ALSO return evidence: an array of { claim, citations } where each claim has 1–6 citations.",
      "- If mode!=evidence, omit evidence or return an empty array.",
      "",
      "SUGGESTED:",
      "- Return 3–6 suggested follow-up questions as plain strings.",
    ].join("\n");

    const user = [
      `ANSWER_MODE: ${mode}\n\nUSER_QUESTION:\n${message}`,
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

    const openaiResponseId = (resp as any)?.id ?? null;
    const out = resp.output_parsed;

    if (!out) {
      throw new Error(
        "OpenAI did not return a valid structured response (output_parsed is null).",
      );
    }

    const byChunkId = new Map(finalChunks.map((c: any) => [c.id, c]));
    const chunkSourceIds = uniq(finalChunks.map((c: any) => c.sourceId));
    const pageRangesBySource = new Map<string, PageRange[]>();

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
      // keep page fields null if page lookup fails
    }

    const validateCitations = (raw: any[], max = 10) => {
      return (raw ?? [])
        .filter((c: any) => allowed.has(c.chunkId))
        .map((c: any) => {
          const chunk: any = byChunkId.get(c.chunkId);
          if (!chunk) return null;

          const chunkText = chunk.text || "";
          const match = findVerbatimQuote(chunkText, c.quote || "");
          if (!match) return null;

          const quote = match.quote;
          const idx = match.idx;
          if (quote.length < 20 || quote.length > 240) return null;

          const hasGlobal = typeof chunk.globalStart === "number";
          const quoteGlobalStart = hasGlobal ? chunk.globalStart + idx : null;
          const quoteGlobalEnd =
            hasGlobal && quoteGlobalStart != null
              ? quoteGlobalStart + quote.length
              : null;

          const ranges = pageRangesBySource.get(chunk.sourceId) ?? [];
          const s =
            quoteGlobalStart != null
              ? mapGlobalToPage(ranges, quoteGlobalStart, false)
              : null;
          const e =
            quoteGlobalEnd != null
              ? mapGlobalToPage(ranges, quoteGlobalEnd, true)
              : null;

          const kind = chunk.source?.kind ?? null;
          const sourceId = chunk.sourceId ?? null;

          const sourceLabel =
            kind === "URL"
              ? (chunk.source?.url?.title ?? chunk.source?.url?.url ?? "URL")
              : (chunk.source?.file?.fileName ?? "FILE");

          const sourceUrl =
            kind === "URL" ? (chunk.source?.url?.url ?? null) : null;
          const fileName =
            kind === "FILE" ? (chunk.source?.file?.fileName ?? null) : null;

          return {
            chunkId: c.chunkId,
            quote,

            sourceId,
            sourceKind: kind,
            sourceLabel,
            sourceUrl,
            fileName,

            sourceRevisionId: chunk.revisionId ?? null,
            documentRevisionId: chunk.revision?.documentRevisionId ?? null,
            pipelineConfigId: chunk.revision?.pipelineConfigId ?? null,

            pageStart: s?.pageNumber ?? null,
            pageEnd: e?.pageNumber ?? null,
            charStart: s?.char ?? null,
            charEnd: e?.char ?? null,
          };
        })
        .filter(Boolean)
        .slice(0, max) as any[];
    };

    const validatedCitations = validateCitations(out.citations ?? [], 12);

    const evidence =
      (out.mode ?? mode) === "evidence"
        ? (out.evidence ?? [])
            .slice(0, 12)
            .map((b: any) => {
              const claim = String(b?.claim ?? "").trim();
              if (!claim) return null;
              const citations = validateCitations(b?.citations ?? [], 6);
              if (!citations.length) return null;
              return { claim, citations };
            })
            .filter(Boolean)
        : [];

    return await succeedNotebookChatRun({
      runId: run.id,
      startedAtMs,
      candidateChunkIds,
      finalChunkIds,
      sourceRevisionIds,
      documentRevisionIds,
      pipelineConfigIds,
      openaiResponseId,
      result: {
        mode: (out.mode ?? mode) as AnswerMode,
        answer: out.answer,
        citations: validatedCitations,
        evidence,
        suggested: out.suggested ?? [],
      },
    });
  } catch (error) {
    await failNotebookChatRun({
      runId: run.id,
      startedAtMs,
      error,
      candidateChunkIds,
      finalChunkIds,
      sourceRevisionIds,
      documentRevisionIds,
      pipelineConfigIds,
    });
    throw error;
  }
}
