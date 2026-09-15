import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { schema } from "@workos/database";

import { db } from "../db.js";
import { getMembership, roleAtLeast } from "../auth/membership.js";
import { workerClient } from "../telegram/workerClient.js";
import { logger } from "../logger.js";

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/^#/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) ||
  "item";

// Returns the user's telegram account row, creating a pending one if needed.
async function ensureAccount(userId: string) {
  const existing = await db
    .select()
    .from(schema.telegramAccounts)
    .where(eq(schema.telegramAccounts.userId, userId))
    .limit(1);
  if (existing[0]) return existing[0];
  const [created] = await db
    .insert(schema.telegramAccounts)
    .values({ userId, status: "pending" })
    .returning();
  return created!;
}

function accountDTO(row: typeof schema.telegramAccounts.$inferSelect) {
  // NEVER expose encryptedSession (ТЗ §29).
  return {
    id: row.id,
    telegramUserId: row.telegramUserId ? String(row.telegramUserId) : null,
    phone: row.phone,
    username: row.username,
    firstName: row.firstName,
    lastName: row.lastName,
    status: row.status,
    lastConnectedAt: row.lastConnectedAt,
  };
}

export const telegramRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.requireAuth);

  // ── Auth flow (ТЗ §7 enabling step) ───────────────────────────────────────
  app.post("/telegram/auth/request-code", async (req, reply) => {
    const parsed = z.object({ phone: z.string().min(5).max(20) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid phone" });

    const account = await ensureAccount(req.user!.id);
    await db
      .update(schema.telegramAccounts)
      .set({ phone: parsed.data.phone, updatedAt: new Date() })
      .where(eq(schema.telegramAccounts.id, account.id));

    const result = await workerClient.requestCode(account.id, parsed.data.phone);
    if (!result.ok) {
      return reply.code(result.status === 503 ? 503 : 502).send({
        error: result.status === 503 ? "Telegram service unavailable" : "Could not send code",
      });
    }
    return reply.send({ accountId: account.id });
  });

  const signInBody = z.object({
    phone: z.string().min(5).max(20),
    code: z.string().min(1).max(10),
    password: z.string().max(200).optional(),
  });

  async function doSignIn(userId: string, body: z.infer<typeof signInBody>, reply: import("fastify").FastifyReply) {
    const account = await ensureAccount(userId);
    const result = await workerClient.signIn(account.id, body);
    if (!result.ok) {
      if (result.error === "password_required") {
        return reply.code(409).send({ error: "password_required" });
      }
      return reply.code(result.status === 503 ? 503 : 401).send({
        error: result.status === 503 ? "Telegram service unavailable" : "Sign-in failed",
      });
    }
    return reply.send({ ok: true, accountId: account.id });
  }

  app.post("/telegram/auth/sign-in", async (req, reply) => {
    const parsed = signInBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });
    return doSignIn(req.user!.id, parsed.data, reply);
  });

  // 2FA is the same sign-in call with a password (ТЗ §12).
  app.post("/telegram/auth/2fa", async (req, reply) => {
    const parsed = signInBody.extend({ password: z.string().min(1).max(200) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });
    return doSignIn(req.user!.id, parsed.data, reply);
  });

  // ── Account ────────────────────────────────────────────────────────────────
  app.get("/telegram/account", async (req, reply) => {
    const rows = await db
      .select()
      .from(schema.telegramAccounts)
      .where(eq(schema.telegramAccounts.userId, req.user!.id))
      .limit(1);
    if (!rows[0]) return reply.send({ account: null });
    return reply.send({ account: accountDTO(rows[0]) });
  });

  app.delete("/telegram/account", async (req, reply) => {
    // Removes the Work-side account link. Does NOT touch the Telegram account
    // itself (ТЗ §24). channel_sources cascade via FK.
    await db
      .delete(schema.telegramAccounts)
      .where(eq(schema.telegramAccounts.userId, req.user!.id));
    return reply.send({ ok: true });
  });

  // ── Conversation selector (ТЗ §8, §9) ─────────────────────────────────────
  app.get("/telegram/chats", async (req, reply) => {
    const { query } = req.query as { query?: string };
    const rows = await db
      .select({ id: schema.telegramAccounts.id, status: schema.telegramAccounts.status })
      .from(schema.telegramAccounts)
      .where(eq(schema.telegramAccounts.userId, req.user!.id))
      .limit(1);
    const account = rows[0];
    if (!account || account.status !== "connected") {
      return reply.code(409).send({ error: "Telegram account not connected" });
    }
    const result = await workerClient.getChats(account.id, query);
    if (!result.ok) {
      return reply.code(result.status === 503 ? 503 : 502).send({
        error: "Could not load Telegram conversations",
      });
    }
    return reply.send({ chats: result.data.chats });
  });

  // ── Import: bind a Telegram peer to a new Work Channel (ТЗ §7, §10, §11) ────
  const importBody = z.object({
    workspaceId: z.string().uuid(),
    projectId: z.string().uuid().optional(),
    newProjectName: z.string().min(1).max(120).optional(),
    channelName: z.string().min(1).max(120),
    peerId: z.string().min(1),
    chatType: z.enum(["private", "group", "supergroup", "channel"]),
    title: z.string().min(1).max(200),
  });

  app.post("/telegram/import", async (req, reply) => {
    const parsed = importBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });
    const input = parsed.data;

    const role = await getMembership(req.user!.id, input.workspaceId);
    if (!role || !roleAtLeast(role, "member")) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    const accountRows = await db
      .select({ id: schema.telegramAccounts.id, status: schema.telegramAccounts.status })
      .from(schema.telegramAccounts)
      .where(eq(schema.telegramAccounts.userId, req.user!.id))
      .limit(1);
    const account = accountRows[0];
    if (!account || account.status !== "connected") {
      return reply.code(409).send({ error: "Telegram account not connected" });
    }

    // Resolve or create the project.
    let projectId = input.projectId ?? null;
    if (!projectId) {
      if (!input.newProjectName) {
        return reply.code(400).send({ error: "projectId or newProjectName required" });
      }
      const [project] = await db
        .insert(schema.projects)
        .values({
          workspaceId: input.workspaceId,
          name: input.newProjectName,
          slug: slugify(input.newProjectName),
        })
        .returning();
      projectId = project!.id;
    }

    // Upsert the telegram_chat_source (accountId + peerId is the identity).
    const [chatSource] = await db
      .insert(schema.telegramChatSources)
      .values({
        telegramAccountId: account.id,
        telegramChatId: BigInt(input.peerId),
        chatType: input.chatType,
        title: input.title,
      })
      .onConflictDoUpdate({
        target: [
          schema.telegramChatSources.telegramAccountId,
          schema.telegramChatSources.telegramChatId,
        ],
        set: { title: input.title, updatedAt: new Date() },
      })
      .returning();

    // Create the Work Channel (name is independent of the Telegram title — ТЗ §11).
    const [channel] = await db
      .insert(schema.channels)
      .values({
        workspaceId: input.workspaceId,
        projectId,
        name: input.channelName.replace(/^#/, ""),
        slug: slugify(input.channelName),
        type: "telegram",
      })
      .returning();

    await db.insert(schema.channelSources).values({
      channelId: channel!.id,
      telegramChatSourceId: chatSource!.id,
      sourceType: "telegram_chat",
    });

    logger.info(
      { channelId: channel!.id, accountId: account.id },
      "Telegram peer bound to work channel",
    );

    return reply.code(201).send({
      channel,
      source: { type: "telegram", accountId: account.id, peerId: input.peerId },
    });
  });
};
