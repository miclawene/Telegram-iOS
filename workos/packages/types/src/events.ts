// Realtime WebSocket event envelope (backend -> frontend) and the internal
// event bus messages (telegram-worker -> backend).

export const REALTIME_EVENT_TYPES = [
  "message.created",
  "message.updated",
  "message.deleted",
  "reaction.updated",
  "channel.updated",
  "task.created",
  "task.updated",
  "telegram.connection.changed",
] as const;
export type RealtimeEventType = (typeof REALTIME_EVENT_TYPES)[number];

export interface RealtimeEvent<T = unknown> {
  type: RealtimeEventType | string;
  workspaceId: string;
  channelId?: string;
  data: T;
  timestamp: string;
}

// ─── Internal event bus (worker -> backend) ──────────────────────────────────
// The worker never knows about workspaces/projects/channels. It emits raw,
// normalized Telegram events; the backend maps them onto workspace entities.

export const INTERNAL_EVENT_TYPES = [
  "telegram.message.created",
  "telegram.message.updated",
  "telegram.message.deleted",
  "telegram.reaction.updated",
  "telegram.connection.changed",
] as const;
export type InternalEventType = (typeof INTERNAL_EVENT_TYPES)[number];

export interface InternalTelegramMessage {
  id: string;
  senderId: string | null;
  text: string | null;
  date: string;
  replyToMessageId: string | null;
  entitiesJson?: unknown;
}

export interface InternalEvent {
  type: InternalEventType | string;
  accountId: string;
  telegramChatId?: string;
  message?: InternalTelegramMessage;
  // For connection.changed:
  status?: string;
  timestamp: string;
}
