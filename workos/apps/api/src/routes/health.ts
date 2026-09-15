import type { FastifyPluginAsync } from "fastify";
import { sql } from "drizzle-orm";

import { db } from "../db.js";
import { redisHealthy } from "../redis.js";

// ТЗ §35: each service exposes /health.
export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async (_req, reply) => {
    const [dbOk, redisOk] = await Promise.all([
      db
        .execute(sql`SELECT 1`)
        .then(() => true)
        .catch(() => false),
      redisHealthy(),
    ]);

    const status = dbOk && redisOk ? "ok" : "degraded";
    const code = status === "ok" ? 200 : 503;
    return reply.code(code).send({
      status,
      database: dbOk ? "ok" : "error",
      redis: redisOk ? "ok" : "error",
    });
  });
};
