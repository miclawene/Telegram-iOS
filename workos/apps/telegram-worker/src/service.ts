import { eq } from "drizzle-orm";

import { schema, encryptSession } from "@workos/database";
import type {
  TelegramConversation,
  WorkTelegramMessageReference,
} from "@workos/types";
import type { TelegramMessage } from "@workos/telegram";

import { env, logger } from "./env.js";
import { db } from "./db.js";
import { AccountManager } from "./manager.js";

// Worker-side Telegram operations. The manager owns adapter lifecycle; this
// service adds DB persistence (encrypted sessions) and normalization. The
// backend never receives the Telegram session (ТЗ §29) — only this worker
// encrypts/decrypts it.
export class TelegramService {
  constructor(private readonly manager: AccountManager) {}

  connectedCount(): number {
    return this.manager.connectedCount();
  }

  // ── Auth ────────────────────────────────────────────────────────────────
  async requestCode(accountId: string, phone: string): Promise<void> {
    const adapter =
      this.manager.get(accountId) ?? this.manager.createAdapter(accountId);
    await adapter.requestLoginCode(phone);
  }

  async signIn(
    accountId: string,
    params: { phone: string; code: string; password?: string },
  ): Promise<{ telegramUserId: string }> {
    const adapter = this.manager.get(accountId);
    if (!adapter) throw new Error("No pending login for this account");

    const user = await adapter.signIn(params);

    // Persist the encrypted session + profile; never store plaintext (ТЗ §5).
    const encryptedSession = encryptSession(
      adapter.exportSession(),
      env.SESSION_ENCRYPTION_KEY,
    );
    await db
      .update(schema.telegramAccounts)
      .set({
        encryptedSession,
        telegramUserId: BigInt(user.id),
        username: user.username ?? null,
        firstName: user.firstName ?? null,
        lastName: user.lastName ?? null,
        status: "connected",
        lastConnectedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.telegramAccounts.id, accountId));

    logger.info({ accountId }, "Telegram account connected");
    return { telegramUserId: user.id };
  }

  // ── Conversation selector (ТЗ §8, §9) ─────────────────────────────────────
  async getChats(accountId: string, query?: string): Promise<TelegramConversation[]> {
    const adapter = this.requireAdapter(accountId);
    const chats = await adapter.getChats();
    const q = query?.trim().toLowerCase();
    return chats
      .filter((c) => !q || c.title.toLowerCase().includes(q) || (c.username ?? "").toLowerCase().includes(q))
      .map((c) => ({
        peerId: c.id,
        accountId,
        title: c.title,
        username: c.username ?? null,
        chatType: c.type,
      }));
  }

  // ── History (load on open — ТЗ §13, §41) ──────────────────────────────────
  async getMessages(
    accountId: string,
    peerId: string,
    params: { limit?: number; beforeMessageId?: string },
  ): Promise<TelegramMessage[]> {
    const adapter = this.requireAdapter(accountId);
    return adapter.getMessages(peerId, params);
  }

  // ── Send / reply (ТЗ §16, §17) ────────────────────────────────────────────
  async send(
    accountId: string,
    peerId: string,
    text: string,
    replyToMessageId?: string,
  ): Promise<TelegramMessage> {
    const adapter = this.requireAdapter(accountId);
    return replyToMessageId
      ? adapter.sendReply(peerId, replyToMessageId, text)
      : adapter.sendMessage(peerId, text);
  }

  // ── Source resolution (ТЗ §21, §22) ───────────────────────────────────────
  async resolvePeer(
    accountId: string,
    peerId: string,
  ): Promise<{ found: boolean; title?: string; accessDenied?: boolean }> {
    const adapter = this.manager.get(accountId);
    if (!adapter) return { found: false }; // account not connected / logged out
    try {
      const chats = await adapter.getChats();
      const match = chats.find((c) => c.id === peerId);
      return match ? { found: true, title: match.title } : { found: false };
    } catch {
      return { found: false, accessDenied: true };
    }
  }

  // ── Startup restore (ТЗ §18 realtime needs live adapters) ─────────────────
  async restoreConnectedAccounts(): Promise<void> {
    const rows = await db
      .select({
        id: schema.telegramAccounts.id,
        encryptedSession: schema.telegramAccounts.encryptedSession,
      })
      .from(schema.telegramAccounts)
      .where(eq(schema.telegramAccounts.status, "connected"));

    for (const row of rows) {
      if (!row.encryptedSession) continue;
      try {
        await this.manager.restore(row.id, row.encryptedSession);
      } catch (err) {
        logger.warn({ accountId: row.id, err }, "Failed to restore account");
        await db
          .update(schema.telegramAccounts)
          .set({ status: "error", updatedAt: new Date() })
          .where(eq(schema.telegramAccounts.id, row.id));
      }
    }
    logger.info({ count: rows.length }, "Restore pass complete");
  }

  private requireAdapter(accountId: string) {
    const adapter = this.manager.get(accountId);
    if (!adapter) throw new Error("Telegram account not connected");
    return adapter;
  }
}

export type { WorkTelegramMessageReference };
