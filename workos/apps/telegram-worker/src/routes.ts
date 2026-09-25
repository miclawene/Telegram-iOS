import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import { env } from "./env.js";
import type { TelegramService } from "./service.js";

// Internal control API — called ONLY by the backend, guarded by the shared
// secret. Never exposed to browsers. The backend drives login and messaging
// through these endpoints; Telegram sessions stay inside the worker (ТЗ §29).
export function controlRoutes(service: TelegramService): FastifyPluginAsync {
  return async (app) => {
    app.addHook("preHandler", async (req: FastifyRequest, reply: FastifyReply) => {
      if (req.headers["x-internal-secret"] !== env.API_INTERNAL_SECRET) {
        await reply.code(401).send({ error: "Unauthorized" });
      }
    });

    // Auth
    app.post("/accounts/:accountId/auth/request-code", async (req, reply) => {
      const { accountId } = req.params as { accountId: string };
      const { phone } = (req.body ?? {}) as { phone?: string };
      if (!phone) return reply.code(400).send({ error: "phone required" });
      await service.requestCode(accountId, phone);
      return reply.send({ ok: true });
    });

    app.post("/accounts/:accountId/auth/sign-in", async (req, reply) => {
      const { accountId } = req.params as { accountId: string };
      const body = (req.body ?? {}) as { phone?: string; code?: string; password?: string };
      if (!body.phone || !body.code) {
        return reply.code(400).send({ error: "phone and code required" });
      }
      try {
        const result = await service.signIn(accountId, {
          phone: body.phone,
          code: body.code,
          password: body.password,
        });
        return reply.send(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : "sign-in failed";
        // Surface the 2FA-needed signal so the backend can prompt for password.
        const needs2fa = message.includes("SESSION_PASSWORD_NEEDED");
        return reply.code(needs2fa ? 409 : 400).send({
          error: needs2fa ? "password_required" : "sign_in_failed",
        });
      }
    });

    // Conversation selector
    app.get("/accounts/:accountId/chats", async (req, reply) => {
      const { accountId } = req.params as { accountId: string };
      const { query } = req.query as { query?: string };
      const chats = await service.getChats(accountId, query);
      return reply.send({ chats });
    });

    // Forum topics
    app.get("/accounts/:accountId/peers/:peerId/topics", async (req, reply) => {
      const { accountId, peerId } = req.params as { accountId: string; peerId: string };
      const topics = await service.getTopics(accountId, peerId);
      return reply.send({ topics });
    });

    // History
    app.get("/accounts/:accountId/peers/:peerId/messages", async (req, reply) => {
      const { accountId, peerId } = req.params as { accountId: string; peerId: string };
      const { limit, beforeId, topicId } = req.query as {
        limit?: string;
        beforeId?: string;
        topicId?: string;
      };
      const messages = await service.getMessages(accountId, peerId, {
        limit: limit ? Number(limit) : undefined,
        beforeMessageId: beforeId,
        topicId,
      });
      return reply.send({ messages });
    });

    // Send / reply
    app.post("/accounts/:accountId/peers/:peerId/messages", async (req, reply) => {
      const { accountId, peerId } = req.params as { accountId: string; peerId: string };
      const body = (req.body ?? {}) as {
        text?: string;
        replyToMessageId?: string;
        topicId?: string;
      };
      if (!body.text?.trim()) return reply.code(400).send({ error: "text required" });
      const message = await service.send(
        accountId,
        peerId,
        body.text,
        body.replyToMessageId,
        body.topicId,
      );
      return reply.send({ message });
    });

    // Source resolution
    app.get("/accounts/:accountId/peers/:peerId", async (req, reply) => {
      const { accountId, peerId } = req.params as { accountId: string; peerId: string };
      const result = await service.resolvePeer(accountId, peerId);
      return reply.send(result);
    });
  };
}
