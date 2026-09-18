import { GramJsAdapter, type TelegramClientAdapter, type TelegramUpdate } from "@workos/telegram";
import { decryptSession, encryptSession } from "@workos/database";
import type { InternalEvent } from "@workos/types";

import { env, logger } from "./env.js";

// Owns one TelegramClientAdapter per connected account. Restores sessions on
// startup and forwards normalized updates to the backend internal event bus
// (ТЗ §24, §25). Holds NO workspace/business logic.
export class AccountManager {
  private adapters = new Map<string, TelegramClientAdapter>();

  connectedCount(): number {
    return this.adapters.size;
  }

  /** Create an adapter for a fresh login (before session exists). */
  createAdapter(accountId: string): TelegramClientAdapter {
    const adapter = new GramJsAdapter({
      apiId: env.TELEGRAM_API_ID,
      apiHash: env.TELEGRAM_API_HASH,
    });
    this.register(accountId, adapter);
    return adapter;
  }

  /** Restore an adapter from an encrypted session string. */
  async restore(accountId: string, encryptedSession: string): Promise<void> {
    const session = decryptSession(encryptedSession, env.SESSION_ENCRYPTION_KEY);
    const adapter = new GramJsAdapter({
      apiId: env.TELEGRAM_API_ID,
      apiHash: env.TELEGRAM_API_HASH,
      session,
    });
    this.register(accountId, adapter);
    await adapter.connect();
    logger.info({ accountId }, "Restored Telegram account");
  }

  get(accountId: string): TelegramClientAdapter | undefined {
    return this.adapters.get(accountId);
  }

  /** Encrypt the current session for storage (never store plaintext — ТЗ §5). */
  exportEncryptedSession(accountId: string): string | null {
    const adapter = this.adapters.get(accountId);
    if (!adapter) return null;
    return encryptSession(adapter.exportSession(), env.SESSION_ENCRYPTION_KEY);
  }

  private register(accountId: string, adapter: TelegramClientAdapter): void {
    adapter.onUpdate((update) => this.forward(accountId, update));
    this.adapters.set(accountId, adapter);
  }

  private async forward(accountId: string, update: TelegramUpdate): Promise<void> {
    const event = toInternalEvent(accountId, update);
    if (!event) return;
    try {
      await fetch(`${env.API_URL}/internal/events`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-secret": env.API_INTERNAL_SECRET,
        },
        body: JSON.stringify(event),
      });
    } catch (err) {
      logger.warn({ err, accountId, type: event.type }, "Failed to forward event");
    }
  }
}

function toInternalEvent(
  accountId: string,
  update: TelegramUpdate,
): InternalEvent | null {
  const timestamp = new Date().toISOString();
  switch (update.kind) {
    case "message.new":
      return {
        type: "telegram.message.created",
        accountId,
        telegramChatId: update.message.chatId,
        message: {
          id: update.message.id,
          senderId: update.message.senderId,
          text: update.message.text,
          date: update.message.date,
          replyToMessageId: update.message.replyToMessageId,
        },
        timestamp,
      };
    case "message.edited":
      return {
        type: "telegram.message.updated",
        accountId,
        telegramChatId: update.message.chatId,
        message: {
          id: update.message.id,
          senderId: update.message.senderId,
          text: update.message.text,
          date: update.message.date,
          replyToMessageId: update.message.replyToMessageId,
        },
        timestamp,
      };
    case "message.deleted":
      return {
        type: "telegram.message.deleted",
        accountId,
        telegramChatId: update.chatId,
        timestamp,
      };
    case "connection.changed":
      return {
        type: "telegram.connection.changed",
        accountId,
        status: update.status,
        timestamp,
      };
    default:
      return null;
  }
}
