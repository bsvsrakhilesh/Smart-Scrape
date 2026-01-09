// backend/src/services/notebookChat.service.ts
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import prisma from "../config/database";
import { env } from "../config/env";
import { openaiClient, defaultModel } from "./openaiClient";

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
      })
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

async function pickRecentChunkIds(
  notebookId: string,
  limit: number,
  sourceIds?: string[]
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
  chunks: Awaited<ReturnType<typeof loadChunksForContext>>
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
  const candidateChunkIds = await pickRecentChunkIds(notebookId, 6, sourceIds);

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
      "OpenAI did not return a valid structured response (output_parsed is null)."
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
