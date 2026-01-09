// backend/src/services/embeddings.service.ts
import { env } from "../config/env";
import { openaiClient } from "./openaiClient";

export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
// Must match your DB column: vector(1536)
export const EMBEDDING_DIM = 1536;

// Keep requests safe + efficient
const BATCH_SIZE = 96;

function cleanInput(s: string) {
  // Keep it deterministic; embeddings model tolerates large inputs,
  // but we still avoid pathological whitespace.
  return (s ?? "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
}

export function toPgVectorLiteral(vec: number[]) {
  if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIM) {
    throw new Error(
      `Embedding dim mismatch: expected ${EMBEDDING_DIM}, got ${vec?.length ?? 0}`
    );
  }
  // pgvector accepts: '[0.1,0.2,...]'
  return `[${vec.join(",")}]`;
}

export async function embedTexts(
  texts: string[],
  model: string = DEFAULT_EMBEDDING_MODEL
): Promise<number[][]> {
  if (!env.OPENAI_ENABLED) return [];
  if (!texts?.length) return [];

  const cleaned = texts.map(cleanInput);

  const out: number[][] = [];
  for (let i = 0; i < cleaned.length; i += BATCH_SIZE) {
    const batch = cleaned.slice(i, i + BATCH_SIZE);

    const resp = await openaiClient().embeddings.create({
      model,
      input: batch,
    });

    // Ensure order is preserved (OpenAI returns embeddings in input order)
    for (const item of resp.data) {
      out.push(item.embedding as number[]);
    }
  }

  return out;
}

export async function embedQuery(
  query: string,
  model: string = DEFAULT_EMBEDDING_MODEL
): Promise<number[] | null> {
  if (!env.OPENAI_ENABLED) return null;

  const q = cleanInput(query);
  if (!q) return null;

  const resp = await openaiClient().embeddings.create({
    model,
    input: q,
  });

  const emb = resp.data?.[0]?.embedding as number[] | undefined;
  if (!emb) return null;
  return emb;
}
