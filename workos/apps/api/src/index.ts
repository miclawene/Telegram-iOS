import { buildServer } from "./server.js";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { ensureSchema } from "./schema-guard.js";

async function main() {
  await ensureSchema();
  const app = await buildServer();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutting down");
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await app.listen({ port: env.API_PORT, host: "0.0.0.0" });
  logger.info(`API listening on :${env.API_PORT}`);
}

main().catch((err) => {
  logger.error({ err }, "Fatal startup error");
  process.exit(1);
});
