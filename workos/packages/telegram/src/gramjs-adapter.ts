import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { Api } from "telegram/tl/index.js";

import type {
  GetMessagesParams,
  SignInParams,
  TelegramAdapterConfig,
  TelegramChat,
  TelegramClientAdapter,
  TelegramMessage,
  TelegramUpdate,
  TelegramUser,
} from "./adapter.js";

// GramJS implementation of the adapter. All GramJS-specific code lives here so
// the rest of the system stays library-agnostic (swappable for TDLib later).
//
// Login is split across requestLoginCode / signIn because our auth flow is a
// multi-step API sequence (phone -> code -> optional 2FA), not an interactive
// prompt. We stash the phoneCodeHash between the two calls.

function chatTypeOf(entity: Api.TypeChat | Api.TypeUser): TelegramChat["type"] {
  if (entity instanceof Api.User) return "private";
  if (entity instanceof Api.Chat) return "group";
  if (entity instanceof Api.Channel) {
    return entity.megagroup ? "supergroup" : "channel";
  }
  return "group";
}

function toMessage(chatId: string, m: Api.Message): TelegramMessage {
  return {
    id: String(m.id),
    chatId,
    senderId: m.senderId ? String(m.senderId) : null,
    text: m.message ?? null,
    date: new Date((m.date ?? 0) * 1000).toISOString(),
    replyToMessageId: m.replyTo?.replyToMsgId
      ? String(m.replyTo.replyToMsgId)
      : null,
  };
}

export class GramJsAdapter implements TelegramClientAdapter {
  private client: TelegramClient;
  private session: StringSession;
  private phoneCodeHash: string | null = null;
  private pendingPhone: string | null = null;
  private updateCallback: ((u: TelegramUpdate) => void) | null = null;

  constructor(config: TelegramAdapterConfig) {
    this.session = new StringSession(config.session ?? "");
    this.client = new TelegramClient(this.session, config.apiId, config.apiHash, {
      connectionRetries: 5,
      autoReconnect: true,
    });
  }

  async connect(): Promise<void> {
    await this.client.connect();
    this.client.addEventHandler((event: unknown) => this.dispatchUpdate(event));
  }

  async disconnect(): Promise<void> {
    await this.client.disconnect();
    this.emit({ kind: "connection.changed", status: "disconnected" });
  }

  // A fresh login adapter is never connect()ed by the worker, so every entry
  // point makes sure the MTProto connection is up first.
  private async ensureConnected(): Promise<void> {
    if (!this.client.connected) await this.connect();
  }

  async requestLoginCode(phone: string): Promise<void> {
    await this.ensureConnected();
    this.pendingPhone = phone;
    const result = await this.client.invoke(
      new Api.auth.SendCode({
        phoneNumber: phone,
        apiId: this.client.apiId,
        apiHash: this.client.apiHash,
        settings: new Api.CodeSettings({}),
      }),
    );
    // result is auth.SentCode with a phoneCodeHash we need for sign-in.
    this.phoneCodeHash = (result as Api.auth.SentCode).phoneCodeHash;
  }

  async signIn(params: SignInParams): Promise<TelegramUser> {
    await this.ensureConnected();
    if (!this.phoneCodeHash || !this.pendingPhone) {
      throw new Error("requestLoginCode must be called before signIn");
    }
    try {
      const res = await this.client.invoke(
        new Api.auth.SignIn({
          phoneNumber: params.phone,
          phoneCodeHash: this.phoneCodeHash,
          phoneCode: params.code,
        }),
      );
      return this.userFromAuth(res);
    } catch (err) {
      // 2FA enabled: caller must retry via signIn with password.
      if (
        params.password &&
        err instanceof Error &&
        err.message.includes("SESSION_PASSWORD_NEEDED")
      ) {
        const me = await this.client.signInWithPassword(
          { apiId: this.client.apiId, apiHash: this.client.apiHash },
          {
            password: async () => params.password!,
            onError: (e) => {
              throw e;
            },
          },
        );
        if (me instanceof Api.User) return this.userFromEntity(me);
        throw new Error("Sign-in returned an unexpected user type");
      }
      throw err;
    }
  }

  async getChats(): Promise<TelegramChat[]> {
    await this.ensureConnected();
    const dialogs = await this.client.getDialogs({ limit: 200 });
    return dialogs
      .filter((d) => d.entity)
      .map((d) => {
        const entity = d.entity!;
        return {
          id: String(d.id),
          type: chatTypeOf(entity),
          title: d.title ?? "",
          username: "username" in entity ? (entity.username ?? null) : null,
        };
      });
  }

  async searchChats(query: string): Promise<TelegramChat[]> {
    await this.ensureConnected();
    // Telegram's own search: finds chats/channels/users by name across the whole
    // account, not just the recent dialogs.
    const res = (await this.client.invoke(
      new Api.contacts.Search({ q: query, limit: 50 }),
    )) as Api.contacts.Found;

    const out: TelegramChat[] = [];
    for (const chat of res.chats) {
      if (chat instanceof Api.Chat || chat instanceof Api.Channel) {
        out.push({
          id: String(chat.id),
          type: chatTypeOf(chat),
          title: "title" in chat ? chat.title : "",
          username: "username" in chat ? (chat.username ?? null) : null,
        });
      }
    }
    for (const user of res.users) {
      if (user instanceof Api.User) {
        const name = [user.firstName, user.lastName].filter(Boolean).join(" ");
        out.push({
          id: String(user.id),
          type: "private",
          title: name || user.username || "",
          username: user.username ?? null,
        });
      }
    }
    return out;
  }

  async getMessages(
    chatId: string,
    params: GetMessagesParams = {},
  ): Promise<TelegramMessage[]> {
    await this.ensureConnected();
    const messages = await this.client.getMessages(chatId, {
      limit: params.limit ?? 50,
      offsetId: params.beforeMessageId ? Number(params.beforeMessageId) : undefined,
    });
    return messages
      .filter((m): m is Api.Message => m instanceof Api.Message)
      .map((m) => toMessage(chatId, m));
  }

  async sendMessage(chatId: string, text: string): Promise<TelegramMessage> {
    await this.ensureConnected();
    const sent = await this.client.sendMessage(chatId, { message: text });
    return toMessage(chatId, sent);
  }

  async sendReply(
    chatId: string,
    replyToMessageId: string,
    text: string,
  ): Promise<TelegramMessage> {
    await this.ensureConnected();
    const sent = await this.client.sendMessage(chatId, {
      message: text,
      replyTo: Number(replyToMessageId),
    });
    return toMessage(chatId, sent);
  }

  onUpdate(callback: (update: TelegramUpdate) => void): void {
    this.updateCallback = callback;
  }

  exportSession(): string {
    return this.session.save();
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private emit(update: TelegramUpdate) {
    this.updateCallback?.(update);
  }

  private dispatchUpdate(event: unknown) {
    // NewMessage events surface as objects with a `message` field.
    const maybe = event as { message?: Api.Message; className?: string };
    if (maybe.message instanceof Api.Message) {
      const chatId = String(maybe.message.chatId ?? maybe.message.peerId ?? "");
      this.emit({ kind: "message.new", message: toMessage(chatId, maybe.message) });
    }
  }

  private userFromAuth(res: Api.auth.TypeAuthorization): TelegramUser {
    if (res instanceof Api.auth.Authorization && res.user instanceof Api.User) {
      return this.userFromEntity(res.user);
    }
    throw new Error("Unexpected auth result");
  }

  private userFromEntity(user: Api.User): TelegramUser {
    return {
      id: String(user.id),
      firstName: user.firstName ?? null,
      lastName: user.lastName ?? null,
      username: user.username ?? null,
    };
  }
}
