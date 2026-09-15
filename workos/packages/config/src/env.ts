import { z } from "zod";

// Environment validation — fail fast on startup (ТЗ §32: "environment validation on startup").
// Secrets are validated here but never logged.

const base = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

const databaseSchema = z.object({
  DATABASE_URL: z.string().url().describe("Postgres connection string"),
});

const redisSchema = z.object({
  REDIS_URL: z.string().url().describe("Redis connection string"),
});

// 32-byte key, base64-encoded (44 chars incl. padding).
const encryptionSchema = z.object({
  SESSION_ENCRYPTION_KEY: z
    .string()
    .min(1, "SESSION_ENCRYPTION_KEY is required")
    .refine((v) => {
      try {
        return Buffer.from(v, "base64").length === 32;
      } catch {
        return false;
      }
    }, "SESSION_ENCRYPTION_KEY must be 32 bytes, base64-encoded"),
});

const telegramSchema = z.object({
  TELEGRAM_API_ID: z.coerce.number().int().positive(),
  TELEGRAM_API_HASH: z.string().min(1),
});

const internalSchema = z.object({
  API_INTERNAL_SECRET: z.string().min(16),
});

// ─── API service env ──────────────────────────────────────────────────────────
export const apiEnvSchema = base
  .merge(databaseSchema)
  .merge(redisSchema)
  .merge(encryptionSchema)
  .merge(internalSchema)
  .extend({
    API_PORT: z.coerce.number().int().positive().default(4000),
  });
export type ApiEnv = z.infer<typeof apiEnvSchema>;

// ─── Telegram worker env ──────────────────────────────────────────────────────
export const workerEnvSchema = base
  .merge(redisSchema)
  .merge(encryptionSchema)
  .merge(telegramSchema)
  .merge(internalSchema)
  .extend({
    WORKER_PORT: z.coerce.number().int().positive().default(4100),
    API_URL: z.string().url().default("http://localhost:4000"),
  });
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

/**
 * Parse and validate env vars against a schema. Throws a readable error listing
 * every missing/invalid variable — without printing their values.
 */
export function loadEnv<T extends z.ZodTypeAny>(
  schema: T,
  source: Record<string, string | undefined> = process.env,
): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid environment configuration:\n${issues}\n` +
        `Check your .env against .env.example.`,
    );
  }
  return result.data;
}
