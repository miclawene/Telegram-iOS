import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { schema } from "@workos/database";

import { db } from "../db.js";
import { getMembership, roleAtLeast } from "../auth/membership.js";
import { getChannelHistory } from "../telegram/history.js";
import { getChannelSource } from "../telegram/sourceMapping.js";
import { workerClient } from "../telegram/workerClient.js";
import { publishRealtime } from "../realtime/hub.js";

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
  // Phase 2: loads live Telegram history through the worker on open (ТЗ §13),
  // and returns a source state so the UI can render unavailable states (ТЗ §22).
  app.get("/channels/:id/messages", async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = z
      .object({ limit: z.coerce.number().int().positive().max(100).optional(), beforeId: z.string().optional() })
      .safeParse(req.query);

    const workspaceId = await channelWorkspace(id);
    if (!workspaceId) return reply.code(404).send({ error: "Not found" });
    const role = await getMembership(req.user!.id, workspaceId);
    if (!role) return reply.code(403).send({ error: "Forbidden" });

    const history = await getChannelHistory(id, q.success ? q.data : {});
    return reply.send({
      state: history.state,
      messages: history.messages,
    });
  });

  // POST /channels/:id/messages — send (or reply) via Telegram (ТЗ §16, §17).
  const sendBody = z.object({
    text: z.string().min(1).max(4096),
    replyToMessageId: z.string().optional(),
  });
  app.post("/channels/:id/messages", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = sendBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });

    const workspaceId = await channelWorkspace(id);
    if (!workspaceId) return reply.code(404).send({ error: "Not found" });
    const role = await getMembership(req.user!.id, workspaceId);
    if (!role || !roleAtLeast(role, "member")) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    const source = await getChannelSource(id);
    if (!source) return reply.code(409).send({ error: "Channel has no Telegram source" });

    const result = await workerClient.send(source.accountId, source.peerId, parsed.data.text, {
      replyToMessageId: parsed.data.replyToMessageId,
      topicId: source.topicId ?? undefined,
    });
    if (!result.ok) {
      return reply.code(result.status === 503 ? 503 : 502).send({
        error: "Could not send message",
      });
    }

    // Optimistic realtime echo so other Work clients update without reload.
    await publishRealtime({
      type: "message.created",
      workspaceId,
      channelId: id,
      data: result.data.message,
      timestamp: new Date().toISOString(),
    });

    return reply.code(201).send({ message: result.data.message });
  });

  async function channelWorkspace(channelId: string): Promise<string | null> {
    const rows = await db
      .select({ workspaceId: schema.channels.workspaceId })
      .from(schema.channels)
      .where(eq(schema.channels.id, channelId))
      .limit(1);
    return rows[0]?.workspaceId ?? null;
  }
};
