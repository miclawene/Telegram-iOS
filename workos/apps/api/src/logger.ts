import pino from "pino";

import { LOG_REDACT_PATHS } from "@workos/config";

import { env, isProd } from "./env.js";

// Structured logging with secret redaction (ТЗ §34).
// Never logs telegram session, login code, 2FA password, api hash, or message contents.
export const logger = pino({
  level: env.NODE_ENV === "test" ? "silent" : isProd ? "info" : "debug",
  redact: {
    paths: LOG_REDACT_PATHS,
    censor: "[redacted]",
  },
  base: { service: "api" },
  transport: isProd
    ? undefined
    : {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "SYS:HH:MM:ss" },
      },
});
