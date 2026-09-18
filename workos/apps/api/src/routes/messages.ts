import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { schema } from "@workos/database";

import { db } from "../db.js";
import { getMembership, roleAtLeast } from "../auth/membership.js";
import { getChannelSource } from "../telegram/sourceMapping.js";
import { workerClient } from "../telegram/workerClient.js";
import { publishRealtime } from "../realtime/hub.js";

// POST /messages/:id/reply — reply to a Telegram message (ТЗ §17, §26).
// :id is the Telegram message id being replied to; the channel is passed in the
// body so we can resolve the (accountId, peerId) source. We avoid encoding
// identity into a parsed string (ТЗ §36).
export const messageRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.requireAuth);

  const replyBody = z.object({
    channelId: z.string().uuid(),
    text: z.string().min(1).max(4096),
  });

  app.post("/messages/:id/reply", async (req, reply) => {
    const { id: replyToMessageId } = req.params as { id: string };
    const parsed = replyBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });

    const chRows = await db
      .select({ workspaceId: schema.channels.workspaceId })
      .from(schema.channels)
      .where(eq(schema.channels.id, parsed.data.channelId))
      .limit(1);
    if (!chRows[0]) return reply.code(404).send({ error: "Channel not found" });

    const role = await getMembership(req.user!.id, chRows[0].workspaceId);
    if (!role || !roleAtLeast(role, "member")) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    const source = await getChannelSource(parsed.data.channelId);
    if (!source) return reply.code(409).send({ error: "Channel has no Telegram source" });

    const result = await workerClient.send(
      source.accountId,
      source.peerId,
      parsed.data.text,
      replyToMessageId,
    );
    if (!result.ok) {
      return reply.code(result.status === 503 ? 503 : 502).send({ error: "Could not reply" });
    }

    await publishRealtime({
      type: "message.created",
      workspaceId: chRows[0].workspaceId,
      channelId: parsed.data.channelId,
      data: result.data.message,
      timestamp: new Date().toISOString(),
    });

    return reply.code(201).send({ message: result.data.message });
  });
};
