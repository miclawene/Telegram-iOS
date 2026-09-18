import type { WebSocket } from "@fastify/websocket";

import type { RealtimeEvent } from "@workos/types";

import { redis, redisSub } from "../redis.js";
import { logger } from "../logger.js";

const CHANNEL = "realtime";

// In-process registry: workspaceId -> set of sockets. Combined with Redis pub/sub
// so events fan out across multiple API instances (ТЗ §22, §23).
const rooms = new Map<string, Set<WebSocket>>();

let subscribed = false;

export async function initRealtime(): Promise<void> {
  if (subscribed) return;
  subscribed = true;
  await redisSub.subscribe(CHANNEL);
  redisSub.on("message", (channel, payload) => {
    if (channel !== CHANNEL) return;
    try {
      const event = JSON.parse(payload) as RealtimeEvent;
      deliverLocal(event);
    } catch (err) {
      logger.warn({ err }, "Failed to parse realtime payload");
    }
  });
}

/** Publish an event to all subscribers across all instances. */
export async function publishRealtime(event: RealtimeEvent): Promise<void> {
  await redis.publish(CHANNEL, JSON.stringify(event));
}

/** Deliver to sockets connected to THIS instance. */
function deliverLocal(event: RealtimeEvent): void {
  const sockets = rooms.get(event.workspaceId);
  if (!sockets) return;
  const data = JSON.stringify(event);
  for (const socket of sockets) {
    if (socket.readyState === socket.OPEN) socket.send(data);
  }
}

export function joinRoom(workspaceId: string, socket: WebSocket): void {
  let set = rooms.get(workspaceId);
  if (!set) {
    set = new Set();
    rooms.set(workspaceId, set);
  }
  set.add(socket);
}

export function leaveRoom(workspaceId: string, socket: WebSocket): void {
  const set = rooms.get(workspaceId);
  if (!set) return;
  set.delete(socket);
  if (set.size === 0) rooms.delete(workspaceId);
}

export function roomStats(): { workspaces: number; sockets: number } {
  let sockets = 0;
  for (const set of rooms.values()) sockets += set.size;
  return { workspaces: rooms.size, sockets };
}
