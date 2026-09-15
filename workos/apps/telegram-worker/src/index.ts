import Fastify from "fastify";

import { env, logger } from "./env.js";
import { AccountManager } from "./manager.js";
import { TelegramService } from "./service.js";
import { controlRoutes } from "./routes.js";

const manager = new AccountManager();
const service = new TelegramService(manager);

async function main() {
  const app = Fastify({ loggerInstance: logger });

  // ТЗ §35: worker health includes Telegram connection state.
  app.get("/health", async (_req, reply) => {
    const connected = service.connectedCount();
    return reply.send({
      status: "ok",
      telegram: connected > 0 ? "connected" : "idle",
      accounts: connected,
    });
  });

  await app.register(controlRoutes(service));

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Worker shutting down");
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await app.listen({ port: env.WORKER_PORT, host: "0.0.0.0" });
  logger.info(`Telegram worker listening on :${env.WORKER_PORT}`);

  // Restore previously-connected accounts so realtime updates resume (ТЗ §18).
  // Non-fatal on failure — health will report idle and accounts show "error".
  void service.restoreConnectedAccounts().catch((err) => {
    logger.warn({ err }, "Account restore pass failed");
  });
}

main().catch((err) => {
  logger.error({ err }, "Fatal worker startup error");
  process.exit(1);
});
