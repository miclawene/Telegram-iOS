import type { FastifyPluginAsync } from "fastify";

import { resolveSession } from "../auth/session.js";
import { SESSION_COOKIE } from "../auth/tokens.js";
import { getMembership } from "../auth/membership.js";
import { joinRoom, leaveRoom } from "../realtime/hub.js";
import { logger } from "../logger.js";

// GET /ws?workspaceId=... — authenticated realtime stream for one workspace.
// The frontend updates without reload (ТЗ §22).
export const wsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/ws", { websocket: true }, async (socket, req) => {
    const workspaceId = (req.query as { workspaceId?: string }).workspaceId;
    const token = req.cookies[SESSION_COOKIE];

    if (!workspaceId || !token) {
      socket.close(4400, "workspaceId and session required");
      return;
    }

    const user = await resolveSession(token);
    if (!user) {
      socket.close(4401, "Unauthorized");
      return;
    }

    const role = await getMembership(user.id, workspaceId);
    if (!role) {
      socket.close(4403, "Forbidden");
      return;
    }

    joinRoom(workspaceId, socket);
    logger.debug({ workspaceId, userId: user.id }, "WS joined");

    socket.send(
      JSON.stringify({
        type: "connection.ready",
        workspaceId,
        data: { ok: true },
        timestamp: new Date().toISOString(),
      }),
    );

    socket.on("close", () => {
      leaveRoom(workspaceId, socket);
      logger.debug({ workspaceId, userId: user.id }, "WS left");
    });
  });
};
