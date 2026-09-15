import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { schema } from "@workos/database";

import { db } from "../db.js";
import { getMembership, roleAtLeast } from "../auth/membership.js";

const slugify = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/^#/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "channel";

const createBody = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(120),
  type: z.enum(["telegram", "virtual"]).default("virtual"),
});

export const channelRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.requireAuth);

  // GET /channels?projectId=... | ?workspaceId=...
  app.get("/channels", async (req, reply) => {
    const q = z
      .object({
        workspaceId: z.string().uuid().optional(),
        projectId: z.string().uuid().optional(),
      })
      .safeParse(req.query);
    if (!q.success || (!q.data.workspaceId && !q.data.projectId)) {
      return reply.code(400).send({ error: "workspaceId or projectId required" });
    }

    const where = q.data.projectId
      ? eq(schema.channels.projectId, q.data.projectId)
      : eq(schema.channels.workspaceId, q.data.workspaceId!);

    const rows = await db.select().from(schema.channels).where(where);

    // Access check via workspace of the first row (all share a workspace here).
    const workspaceId = q.data.workspaceId ?? rows[0]?.workspaceId;
    if (workspaceId) {
      const role = await getMembership(req.user!.id, workspaceId);
      if (!role) return reply.code(403).send({ error: "Forbidden" });
    }
    return reply.send({ channels: rows });
  });

  // POST /channels
  app.post("/channels", async (req, reply) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });

    const role = await getMembership(req.user!.id, parsed.data.workspaceId);
    if (!role || !roleAtLeast(role, "member")) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    const [channel] = await db
      .insert(schema.channels)
      .values({
        workspaceId: parsed.data.workspaceId,
        projectId: parsed.data.projectId ?? null,
        name: parsed.data.name.replace(/^#/, ""),
        slug: slugify(parsed.data.name),
        type: parsed.data.type,
      })
      .returning();
    return reply.code(201).send({ channel });
  });

  // GET /channels/:id
  app.get("/channels/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const rows = await db
      .select()
      .from(schema.channels)
      .where(eq(schema.channels.id, id))
      .limit(1);
    const channel = rows[0];
    if (!channel) return reply.code(404).send({ error: "Not found" });

    const role = await getMembership(req.user!.id, channel.workspaceId);
    if (!role) return reply.code(404).send({ error: "Not found" });
    return reply.send({ channel });
  });

  // GET /channels/:id/messages
  // Phase 1: returns cached messages (empty until Telegram sync in Phase 2).
  app.get("/channels/:id/messages", async (req, reply) => {
    const { id } = req.params as { id: string };
    const rows = await db
      .select({ workspaceId: schema.channels.workspaceId })
      .from(schema.channels)
      .where(eq(schema.channels.id, id))
      .limit(1);
    if (!rows[0]) return reply.code(404).send({ error: "Not found" });

    const role = await getMembership(req.user!.id, rows[0].workspaceId);
    if (!role) return reply.code(403).send({ error: "Forbidden" });

    const messages = await db
      .select({
        id: schema.messageMetadata.id,
        telegramMessageId: schema.messageMetadata.telegramMessageId,
        senderTelegramUserId: schema.messageMetadata.senderTelegramUserId,
        replyToMessageId: schema.messageMetadata.replyToMessageId,
        date: schema.messageMetadata.date,
        classification: schema.messageMetadata.classification,
        requiresResponse: schema.messageMetadata.requiresResponse,
        text: schema.messageCache.text,
      })
      .from(schema.messageMetadata)
      .leftJoin(
        schema.messageCache,
        eq(schema.messageCache.messageMetadataId, schema.messageMetadata.id),
      )
      .where(eq(schema.messageMetadata.channelId, id))
      .orderBy(schema.messageMetadata.date)
      .limit(100);

    return reply.send({ messages });
  });
};
