import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

// Phase 2-4 API surface (ТЗ §26). Endpoints are declared now so the contract is
// stable and the frontend can be built against them; each returns 501 until its
// phase is implemented:
//   Phase 2: /telegram/* (auth, chats, import)
//   Phase 3: /messages/:id/reply, /messages/:id/reactions
//   Phase 4: /tasks, /activity, /saved, /search
function notImplemented(feature: string) {
  return async (_req: FastifyRequest, reply: FastifyReply) =>
    reply.code(501).send({ error: "Not implemented", feature });
}

export const placeholderRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.requireAuth);

  // ── Telegram (Phase 2) ─────────────────────────────────────────────────────
  app.post("/telegram/auth/request-code", notImplemented("telegram.auth.request-code"));
  app.post("/telegram/auth/sign-in", notImplemented("telegram.auth.sign-in"));
  app.post("/telegram/auth/2fa", notImplemented("telegram.auth.2fa"));
  app.get("/telegram/account", notImplemented("telegram.account.get"));
  app.delete("/telegram/account", notImplemented("telegram.account.delete"));
  app.get("/telegram/chats", notImplemented("telegram.chats"));
  app.post("/telegram/import", notImplemented("telegram.import"));

  // ── Messaging (Phase 3) ─────────────────────────────────────────────────────
  app.post("/messages/:id/reply", notImplemented("messages.reply"));
  app.post("/messages/:id/reactions", notImplemented("messages.reactions"));

  // ── Tasks / Activity / Saved / Search (Phase 4) ────────────────────────────
  app.get("/tasks", notImplemented("tasks.list"));
  app.post("/tasks", notImplemented("tasks.create"));
  app.get("/activity", notImplemented("activity.list"));
  app.get("/saved", notImplemented("saved.list"));
  app.get("/search", notImplemented("search"));
};
