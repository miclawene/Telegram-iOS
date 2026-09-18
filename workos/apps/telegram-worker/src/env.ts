import { loadEnv, workerEnvSchema, LOG_REDACT_PATHS, type WorkerEnv } from "@workos/config";
import pino from "pino";

export const env: WorkerEnv = loadEnv(workerEnvSchema);

export const logger = pino({
  level: env.NODE_ENV === "production" ? "info" : "debug",
  redact: { paths: LOG_REDACT_PATHS, censor: "[redacted]" },
  base: { service: "telegram-worker" },
  transport:
    env.NODE_ENV === "production"
      ? undefined
      : { target: "pino-pretty", options: { colorize: true } },
});
