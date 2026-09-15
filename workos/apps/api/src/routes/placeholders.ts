import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

// Remaining API surface (ТЗ §26). Telegram auth/chats/import, message send and
// reply are implemented in Phase 2 (see routes/telegram.ts, channels.ts,
// messages.ts). What stays here is deferred to later phases and returns 501:
//   Phase 3: /messages/:id/reactions
//   Phase 4: /tasks, /activity, /saved, /search
function notImplemented(feature: string) {
  return async (_req: FastifyRequest, reply: FastifyReply) =>
    reply.code(501).send({ error: "Not implemented", feature });
}

export const placeholderRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.requireAuth);

  // ── Messaging (Phase 3) ─────────────────────────────────────────────────────
  app.post("/messages/:id/reactions", notImplemented("messages.reactions"));

  // ── Tasks / Activity / Saved / Search (Phase 4) ────────────────────────────
  app.get("/tasks", notImplemented("tasks.list"));
  app.post("/tasks", notImplemented("tasks.create"));
  app.get("/activity", notImplemented("activity.list"));
  app.get("/saved", notImplemented("saved.list"));
  app.get("/search", notImplemented("search"));
};
