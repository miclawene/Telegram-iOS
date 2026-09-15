import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";

import { env } from "./env.js";
import { logger } from "./logger.js";
import { authPlugin } from "./auth/plugin.js";
import { initRealtime } from "./realtime/hub.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { workspaceRoutes } from "./routes/workspaces.js";
import { projectRoutes } from "./routes/projects.js";
import { channelRoutes } from "./routes/channels.js";
import { telegramRoutes } from "./routes/telegram.js";
import { messageRoutes } from "./routes/messages.js";
import { wsRoutes } from "./routes/ws.js";
import { internalRoutes } from "./routes/internal.js";
import { placeholderRoutes } from "./routes/placeholders.js";

export async function buildServer() {
  const app = Fastify({ loggerInstance: logger, trustProxy: true });

  // CORS — the web app runs on a different origin (Vercel) and sends cookies.
  await app.register(cors, {
    origin: env.NODE_ENV === "development" ? true : [/\.vercel\.app$/],
    credentials: true,
  });

  await app.register(cookie, {
    // Cookies are httpOnly + signed transport handled by TLS; secret rotates via env.
    secret: env.API_INTERNAL_SECRET,
  });

  await app.register(websocket);
  await app.register(authPlugin);

  await initRealtime();

  // Routes
  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(workspaceRoutes);
  await app.register(projectRoutes);
  await app.register(channelRoutes);
  await app.register(telegramRoutes);
  await app.register(messageRoutes);
  await app.register(wsRoutes);
  await app.register(internalRoutes);
  await app.register(placeholderRoutes);

  return app;
}
