import type { FastifyPluginAsync } from "fastify";

import type { InternalEvent, RealtimeEventType } from "@workos/types";

import { env } from "../env.js";
import { logger } from "../logger.js";
import { getChannelsForPeer } from "../telegram/sourceMapping.js";
import { publishRealtime } from "../realtime/hub.js";

// POST /internal/events — the telegram-worker posts normalized Telegram events
// here (ТЗ §25). The backend maps the (accountId, peerId) to Work channel(s)
// and fans out realtime events so Work clients update without polling (ТЗ §18).
// Protected by the shared internal secret, never exposed to the browser.

const EVENT_MAP: Record<string, RealtimeEventType> = {
  "telegram.message.created": "message.created",
  "telegram.message.updated": "message.updated",
  "telegram.message.deleted": "message.deleted",
  "telegram.reaction.updated": "reaction.updated",
  "telegram.connection.changed": "telegram.connection.changed",
};

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
    // Do not log message contents (ТЗ §34, §48) — only metadata.
    logger.debug(
      { type: event.type, accountId: event.accountId, chatId: event.telegramChatId },
      "internal event received",
    );

    const realtimeType = EVENT_MAP[event.type];
    if (!realtimeType || !event.telegramChatId) {
      return reply.code(202).send({ accepted: true });
    }

    // Map (accountId, peerId) -> channel(s). One peer can back several channels
    // across projects/workspaces; fan out to each. Multi-account safe (ТЗ §6).
    const mappings = await getChannelsForPeer(event.accountId, event.telegramChatId);
    const timestamp = event.timestamp ?? new Date().toISOString();

    for (const m of mappings) {
      await publishRealtime({
        type: realtimeType,
        workspaceId: m.workspaceId,
        channelId: m.channelId,
        data: event.message ?? { status: event.status },
        timestamp,
      });
    }

    return reply.code(202).send({ accepted: true, delivered: mappings.length });
  });
};
