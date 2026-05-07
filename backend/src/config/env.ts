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

  // Embeddings. Current SourceChunk.embedding column is vector(1536).
  EMBEDDING_MODEL: z.string().optional().default("text-embedding-3-small"),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().optional().default(1536),
  EMBEDDING_BATCH_SIZE: z.coerce.number().int().positive().optional().default(96),
  EMBEDDING_MAX_RETRIES: z.coerce.number().int().min(0).optional().default(3),
  EMBEDDING_RETRY_BASE_MS: z.coerce.number().int().positive().optional().default(750),

  // Redis (queues)
  REDIS_URL: z.string().optional().default("redis://localhost:6379/0"),
  EMBEDDING_QUEUE_CONCURRENCY: z.coerce.number().optional().default(2),
  INGESTION_QUEUE_CONCURRENCY: z.coerce.number().optional().default(2),
  AI_TAG_URL_QUEUE_CONCURRENCY: z.coerce.number().optional().default(1),
  SAVED_URL_OPERATION_QUEUE_CONCURRENCY: z.coerce
    .number()
    .optional()
    .default(2),

  // OCR for scanned PDFs
  OCR_ENABLED: BoolFromEnv,
  OCR_LANGS: z.string().optional().default("eng"), // e.g. "eng" or "eng+hin"
  OCR_DPI: z.coerce.number().optional().default(200),
  OCR_MAX_PAGES: z.coerce.number().optional().default(50),
  OCR_RENDER_TIMEOUT_MS: z.coerce.number().optional().default(60_000),
  OCR_PAGE_TIMEOUT_MS: z.coerce.number().optional().default(120_000),

  // Browser runtime for crawl/extraction
  CHROMIUM_EXECUTABLE_PATH: z.string().optional(),

  // Retrieval tuning (pgvector cosine distance; lower = more similar)
  RETRIEVAL_MAX_COSINE_DISTANCE: z.coerce.number().optional().default(0.42),

  // Institutional Capture Node (ICN)
  ICN_ENABLED: BoolFromEnv,
  ICN_BASE_URL: z
    .string()
    .optional()
    .default("http://host.docker.internal:7081"),
  ICN_SHARED_SECRET: z.string().optional(),
  ICN_TIMEOUT_MS: z.coerce.number().optional().default(120_000),

  // Incremental auth / RBAC bootstrap (header-based in prod, safe defaults in dev)
  DEV_AUTH_ENABLED: BoolFromEnv,
  DEV_AUTH_USER_ID: z.string().optional(),
  DEV_AUTH_USER_NAME: z.string().optional(),
  DEV_AUTH_EMAIL: z.string().optional(),
  DEV_AUTH_ROLE: z.string().optional().default("admin"),
  DEV_AUTH_ROLES: z.string().optional(),
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
