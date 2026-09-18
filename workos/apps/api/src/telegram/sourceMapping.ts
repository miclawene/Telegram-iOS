import { and, eq } from "drizzle-orm";

import { schema } from "@workos/database";
import type { TelegramChannelSource } from "@workos/types";

import { db } from "../db.js";

// Resolves the Work Channel ↔ Telegram peer mapping in both directions.
// Source of truth: telegram_chat_sources (accountId + peerId), NOT the title
// (ТЗ §5, §6). peerId is stored as bigint; we expose it as a string everywhere.

export interface ChannelTelegramMapping {
  channelId: string;
  workspaceId: string;
  projectId: string | null;
  source: TelegramChannelSource;
}

/** Forward: a channel's Telegram source, or null if it has no telegram source. */
export async function getChannelSource(
  channelId: string,
): Promise<TelegramChannelSource | null> {
  const rows = await db
    .select({
      accountId: schema.telegramChatSources.telegramAccountId,
      peerId: schema.telegramChatSources.telegramChatId,
    })
    .from(schema.channelSources)
    .innerJoin(
      schema.telegramChatSources,
      eq(schema.telegramChatSources.id, schema.channelSources.telegramChatSourceId),
    )
    .where(eq(schema.channelSources.channelId, channelId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return { type: "telegram", accountId: row.accountId, peerId: String(row.peerId) };
}

/** Reverse: channels mapped to an (accountId, peerId). Multi-account safe. */
export async function getChannelsForPeer(
  accountId: string,
  peerId: string,
): Promise<ChannelTelegramMapping[]> {
  const rows = await db
    .select({
      channelId: schema.channels.id,
      workspaceId: schema.channels.workspaceId,
      projectId: schema.channels.projectId,
    })
    .from(schema.telegramChatSources)
    .innerJoin(
      schema.channelSources,
      eq(schema.channelSources.telegramChatSourceId, schema.telegramChatSources.id),
    )
    .innerJoin(
      schema.channels,
      eq(schema.channels.id, schema.channelSources.channelId),
    )
    .where(
      and(
        eq(schema.telegramChatSources.telegramAccountId, accountId),
        eq(schema.telegramChatSources.telegramChatId, BigInt(peerId)),
      ),
    );

  return rows.map((r) => ({
    channelId: r.channelId,
    workspaceId: r.workspaceId,
    projectId: r.projectId,
    source: { type: "telegram", accountId, peerId },
  }));
}
