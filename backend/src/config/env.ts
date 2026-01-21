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

});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => ({
    path: i.path.join("."),
    message: i.message,
  }));
  throw new Error(`Invalid environment configuration: ${JSON.stringify(issues)}`);
}

export const env = parsed.data;

export function requireOpenAI() {
  if (!env.OPENAI_ENABLED) {
    throw new Error(
      "OpenAI is disabled. Set OPENAI_ENABLED=true (and OPENAI_API_KEY) to enable."
    );
  }
  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is missing (required when OPENAI_ENABLED=true).");
  }
}
