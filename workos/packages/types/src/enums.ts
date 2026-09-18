// Domain enums — shared across api, worker, and web.
// Kept as const arrays so they can be reused for validation and DB enum definitions.

export const WORKSPACE_ROLES = ["owner", "admin", "member", "viewer"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const PROJECT_STATUSES = ["active", "archived"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const CHANNEL_TYPES = ["telegram", "virtual"] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

export const TELEGRAM_CHAT_TYPES = [
  "private",
  "group",
  "supergroup",
  "channel",
] as const;
export type TelegramChatType = (typeof TELEGRAM_CHAT_TYPES)[number];

// MVP: only telegram_chat. Future: telegram_topic, telegram_filter, email, calendar, teable.
export const CHANNEL_SOURCE_TYPES = [
  "telegram_chat",
  "telegram_topic",
  "telegram_filter",
] as const;
export type ChannelSourceType = (typeof CHANNEL_SOURCE_TYPES)[number];

export const TELEGRAM_ACCOUNT_STATUSES = [
  "pending",
  "connected",
  "disconnected",
  "error",
] as const;
export type TelegramAccountStatus = (typeof TELEGRAM_ACCOUNT_STATUSES)[number];

// Message attention classification (rule-based in MVP; AI later).
export const MESSAGE_CLASSIFICATIONS = [
  "mention",
  "dm",
  "reply",
  "file",
  "normal",
] as const;
export type MessageClassification = (typeof MESSAGE_CLASSIFICATIONS)[number];

export const TASK_STATUSES = [
  "todo",
  "in_progress",
  "done",
  "cancelled",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_SOURCE_TYPES = ["telegram_message", "manual"] as const;
export type TaskSourceType = (typeof TASK_SOURCE_TYPES)[number];

// Activity categories for the attention-management model.
export const ACTIVITY_CATEGORIES = [
  "mentions",
  "dms",
  "requires_response",
  "files",
  "tasks",
  "all",
] as const;
export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number];
