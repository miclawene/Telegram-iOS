import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";

import { resolveSession, type AuthUser } from "./session.js";
import { SESSION_COOKIE } from "./tokens.js";

declare module "fastify" {
  interface FastifyRequest {
    user: AuthUser | null;
  }
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

// Populates req.user from the session cookie on every request, and exposes a
// `requireAuth` preHandler that 401s when there is no valid session.
const authPluginImpl: FastifyPluginAsync = async (app) => {
  app.decorateRequest("user", null);

  app.addHook("onRequest", async (req) => {
    const token = req.cookies[SESSION_COOKIE];
    req.user = token ? await resolveSession(token) : null;
  });

  app.decorate(
    "requireAuth",
    async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
      if (!req.user) {
        await reply.code(401).send({ error: "Unauthorized" });
      }
    },
  );
};

export const authPlugin = fp(authPluginImpl, { name: "auth" });
