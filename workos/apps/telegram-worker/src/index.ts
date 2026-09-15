import Fastify from "fastify";

import { env, logger } from "./env.js";
import { AccountManager } from "./manager.js";

const manager = new AccountManager();

async function main() {
  const app = Fastify({ loggerInstance: logger });

  // ТЗ §35: worker health includes Telegram connection state.
  app.get("/health", async (_req, reply) => {
    const connected = manager.connectedCount();
    return reply.send({
      status: "ok",
      telegram: connected > 0 ? "connected" : "idle",
      accounts: connected,
    });
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Worker shutting down");
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  // Phase 2: on startup, load telegram_accounts with encrypted sessions and
  // call manager.restore(accountId, encryptedSession) for each connected one.

  await app.listen({ port: env.WORKER_PORT, host: "0.0.0.0" });
  logger.info(`Telegram worker listening on :${env.WORKER_PORT}`);
}

main().catch((err) => {
  logger.error({ err }, "Fatal worker startup error");
  process.exit(1);
});
