// Provider-agnostic Telegram client abstraction (ТЗ §3, §24).
// GramJS today; TDLib later — both implement TelegramClientAdapter.

export interface TelegramChat {
  id: string;
  type: "private" | "group" | "supergroup" | "channel";
  title: string;
  username?: string | null;
}

export interface TelegramUser {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
}

export interface TelegramMessage {
  id: string;
  chatId: string;
  senderId: string | null;
  text: string | null;
  date: string; // ISO
  replyToMessageId: string | null;
  entitiesJson?: unknown;
}

export type TelegramUpdate =
  | { kind: "message.new"; message: TelegramMessage }
  | { kind: "message.edited"; message: TelegramMessage }
  | { kind: "message.deleted"; chatId: string; messageId: string }
  | { kind: "connection.changed"; status: "connected" | "disconnected" | "error" };

export interface SignInParams {
  phone: string;
  code: string;
  password?: string;
}

export interface GetMessagesParams {
  limit?: number;
  beforeMessageId?: string;
}

/**
 * The single seam between our system and any Telegram library.
 * The worker depends only on this interface — never on GramJS types directly.
 */
export interface TelegramClientAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;

  requestLoginCode(phone: string): Promise<void>;
  signIn(params: SignInParams): Promise<TelegramUser>;

  getChats(): Promise<TelegramChat[]>;
  /** Server-side search across all chats/contacts, not just the dialog list. */
  searchChats(query: string): Promise<TelegramChat[]>;
  getMessages(chatId: string, params?: GetMessagesParams): Promise<TelegramMessage[]>;

  sendMessage(chatId: string, text: string): Promise<TelegramMessage>;
  sendReply(
    chatId: string,
    replyToMessageId: string,
    text: string,
  ): Promise<TelegramMessage>;

  onUpdate(callback: (update: TelegramUpdate) => void): void;

  /** Serialize the current auth session for encrypted storage. */
  exportSession(): string;
}

export interface TelegramAdapterConfig {
  apiId: number;
  apiHash: string;
  /** Previously-exported session string, if resuming. */
  session?: string;
}
