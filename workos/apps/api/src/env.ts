import { apiEnvSchema, loadEnv, type ApiEnv } from "@workos/config";

// Validated, typed env — throws on startup if anything is missing/invalid.
export const env: ApiEnv = loadEnv(apiEnvSchema);

export const isProd = env.NODE_ENV === "production";
