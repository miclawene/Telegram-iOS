import type { FastifyPluginAsync } from "fastify";

import type { InternalEvent } from "@workos/types";

import { env } from "../env.js";
import { logger } from "../logger.js";

// POST /internal/events — the telegram-worker posts normalized Telegram events
// here (ТЗ §25). The backend decides workspace/project/channel routing, caching,
// and realtime fan-out. Protected by the shared internal secret, never exposed
// to the browser.
//
// Phase 1: authenticated + validated ingest with logging. The mapping pipeline
// (telegram_chat -> channel -> realtime publish + cache) lands in Phase 2/3.
export const internalRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (req, reply) => {
    const secret = req.headers["x-internal-secret"];
    if (secret !== env.API_INTERNAL_SECRET) {
      await reply.code(401).send({ error: "Unauthorized" });
    }
  });

  app.post("/internal/events", async (req, reply) => {
    const event = req.body as InternalEvent;
    if (!event?.type || !event.accountId) {
      return reply.code(400).send({ error: "Invalid event" });
    }
    // Do not log message contents (ТЗ §34) — only metadata.
    logger.debug(
      { type: event.type, accountId: event.accountId, chatId: event.telegramChatId },
      "internal event received",
    );

    // Phase 2/3: map to workspace entities, cache text, publishRealtime(...).
    return reply.code(202).send({ accepted: true });
  });
};
