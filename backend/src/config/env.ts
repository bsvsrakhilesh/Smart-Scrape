import { z } from "zod";

// Safe boolean parse ("true" => true; everything else => false)
const BoolFromEnv = z
  .string()
  .optional()
  .transform((v) => (v ?? "false").trim().toLowerCase() === "true");

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).optional(),
  PORT: z.coerce.number().optional(),

  // OpenAI (optional unless enabled)
  OPENAI_ENABLED: BoolFromEnv,
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().optional().default("gpt-5.2"),
  OPENAI_TIMEOUT_MS: z.coerce.number().optional().default(30_000),

  // Redis (queues)
  REDIS_URL: z.string().optional().default("redis://localhost:6379/0"),
  EMBEDDING_QUEUE_CONCURRENCY: z.coerce.number().optional().default(2),
  INGESTION_QUEUE_CONCURRENCY: z.coerce.number().optional().default(2),

  // OCR for scanned PDFs
  OCR_ENABLED: BoolFromEnv,
  OCR_LANGS: z.string().optional().default("eng"), // e.g. "eng" or "eng+hin"
  OCR_DPI: z.coerce.number().optional().default(200),
  OCR_MAX_PAGES: z.coerce.number().optional().default(50),
  OCR_RENDER_TIMEOUT_MS: z.coerce.number().optional().default(60_000),
  OCR_PAGE_TIMEOUT_MS: z.coerce.number().optional().default(120_000),

  // Retrieval tuning (pgvector cosine distance; lower = more similar)
  RETRIEVAL_MAX_COSINE_DISTANCE: z.coerce.number().optional().default(0.42),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => ({
    path: i.path.join("."),
    message: i.message,
  }));
  throw new Error(
    `Invalid environment configuration: ${JSON.stringify(issues)}`,
  );
}

export const env = parsed.data;

export function requireOpenAI() {
  if (!env.OPENAI_ENABLED) {
    throw new Error(
      "OpenAI is disabled. Set OPENAI_ENABLED=true (and OPENAI_API_KEY) to enable.",
    );
  }
  if (!env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY is missing (required when OPENAI_ENABLED=true).",
    );
  }
}
