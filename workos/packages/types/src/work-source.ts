// Phase 2: canonical references and DTOs that bind a Work Channel to a Telegram
// peer. Source of truth is ALWAYS accountId + peerId (never the display title),
// and multi-account safe (ТЗ §5, §6, §36, §56).

// A stable, strongly-typed reference to one Telegram message. String parsing is
// avoided — callers pass the three identity fields explicitly.
export interface WorkTelegramMessageReference {
  accountId: string;
  peerId: string;
  messageId: string;
}

// The Telegram-specific source payload stored against a channel.
// topicId is set when the channel maps to one forum topic of a supergroup
// (supergroup = project, each topic = a channel/thread inside it).
export interface TelegramChannelSource {
  type: "telegram";
  accountId: string;
  peerId: string;
  topicId?: string | null;
}

// One forum topic of a supergroup, as offered in the import flow.
export interface TelegramForumTopic {
  id: string;
  title: string;
}

// Discriminated union so email/calendar/other sources can be added later
// without touching the core channel model (ТЗ §12).
export type WorkChannelSource = TelegramChannelSource;

// Resolution state of a channel's Telegram source (ТЗ §22). The UI renders a
// non-crashing state for anything other than "available".
export const CHANNEL_SOURCE_STATES = [
  "available",
  "peer_unavailable",
  "account_logged_out",
  "peer_deleted",
  "access_denied",
  "no_source",
] as const;
export type ChannelSourceState = (typeof CHANNEL_SOURCE_STATES)[number];

// Presentation info for a Telegram conversation in the selector (ТЗ §8).
// Pulled live from the Telegram stack — never persisted as source of truth.
export interface TelegramConversation {
  peerId: string;
  accountId: string;
  title: string;
  username: string | null;
  chatType: "private" | "group" | "supergroup" | "channel";
  // True for a supergroup that has topics enabled (a forum). Such a peer can be
  // imported as a whole project with one channel per topic.
  isForum?: boolean;
  // Optional presentation extras (may be absent depending on peer).
  lastMessagePreview?: string | null;
  unreadCount?: number;
}

// Backend <-> client DTO for a channel's source mapping (ТЗ §28).
export interface ChannelSourceDTO {
  channelId: string;
  source: WorkChannelSource;
}
