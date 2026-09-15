import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { schema } from "@workos/database";

import { db } from "../db.js";
import { isProd } from "../env.js";
import {
  createSession,
  destroySession,
} from "../auth/session.js";
import {
  hashPassword,
  verifyPassword,
  SESSION_COOKIE,
  SESSION_TTL_MS,
} from "../auth/tokens.js";

const registerBody = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120),
  password: z.string().min(8).max(200),
});

const loginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function setSessionCookie(reply: import("fastify").FastifyReply, token: string) {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  // POST /auth/register
  app.post("/auth/register", async (req, reply) => {
    const parsed = registerBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid input", details: parsed.error.flatten() });
    }
    const { email, name, password } = parsed.data;

    const existing = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);
    if (existing.length > 0) {
      return reply.code(409).send({ error: "Email already registered" });
    }

    const passwordHash = await hashPassword(password);
    const [user] = await db
      .insert(schema.users)
      .values({ email, name, passwordHash })
      .returning({
        id: schema.users.id,
        email: schema.users.email,
        name: schema.users.name,
        avatarUrl: schema.users.avatarUrl,
      });

    const token = await createSession(user!.id);
    setSessionCookie(reply, token);
    return reply.code(201).send({ user });
  });

  // POST /auth/login
  app.post("/auth/login", async (req, reply) => {
    const parsed = loginBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid input" });
    }
    const { email, password } = parsed.data;

    const rows = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);
    const user = rows[0];

    // Constant-ish behavior: always run a hash comparison path.
    const ok =
      user?.passwordHash != null &&
      (await verifyPassword(password, user.passwordHash));
    if (!user || !ok) {
      return reply.code(401).send({ error: "Invalid credentials" });
    }

    const token = await createSession(user.id);
    setSessionCookie(reply, token);
    return reply.send({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
      },
    });
  });

  // POST /auth/logout
  app.post("/auth/logout", async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await destroySession(token);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.send({ ok: true });
  });

  // GET /auth/me
  app.get("/auth/me", { preHandler: app.requireAuth }, async (req, reply) => {
    return reply.send({ user: req.user });
  });
};
