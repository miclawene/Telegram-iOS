import { Redis } from "ioredis";

import { env } from "./env.js";
import { logger } from "./logger.js";

// Two connections: one for commands, one dedicated to subscribe mode
// (ioredis requires a separate connection for SUBSCRIBE).
export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: false,
});

export const redisSub = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  lazyConnect: false,
});

for (const [name, conn] of [
  ["redis", redis],
  ["redisSub", redisSub],
] as const) {
  conn.on("error", (err) => logger.error({ err, conn: name }, "Redis error"));
}

export async function redisHealthy(): Promise<boolean> {
  try {
    const pong = await redis.ping();
    return pong === "PONG";
  } catch {
    return false;
  }
}
