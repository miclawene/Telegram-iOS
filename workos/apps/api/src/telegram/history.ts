import type { ChannelSourceState } from "@workos/types";
import { resolveSourceState } from "@workos/types";

import { getChannelSource } from "./sourceMapping.js";
import { workerClient } from "./workerClient.js";

export interface HistoryMessage {
  id: string;
  telegramMessageId: string;
  senderTelegramUserId: string | null;
  replyToMessageId: string | null;
  date: string;
  text: string | null;
}

export interface ChannelHistory {
  state: ChannelSourceState;
  source: { accountId: string; peerId: string } | null;
  messages: HistoryMessage[];
}

// Loads live Telegram history for a channel on open (ТЗ §13, §41). Never
// duplicates history into our DB (ТЗ §42) — this reads through the worker each
// time. Returns a non-crashing state for unavailable sources (ТЗ §22).
export async function getChannelHistory(
  channelId: string,
  params: { limit?: number; beforeId?: string } = {},
): Promise<ChannelHistory> {
  const source = await getChannelSource(channelId);
  if (!source) {
    return { state: "no_source", source: null, messages: [] };
  }

  const result = await workerClient.getMessages(source.accountId, source.peerId, {
    ...params,
    topicId: source.topicId ?? undefined,
  });
  if (!result.ok) {
    // Distinguish "account not connected" from other failures for the UI.
    const accountLoggedOut = result.status === 409 || result.status === 503;
    const state = resolveSourceState({
      hasSource: true,
      accountLoggedOut,
      accessDenied: !accountLoggedOut,
      peerFound: false,
    });
    return { state, source, messages: [] };
  }

  const messages: HistoryMessage[] = result.data.messages
    .map((m) => ({
      id: m.id,
      telegramMessageId: m.id,
      senderTelegramUserId: m.senderId,
      replyToMessageId: m.replyToMessageId,
      date: m.date,
      text: m.text,
    }))
    .sort((a, b) => +new Date(a.date) - +new Date(b.date));

  return { state: "available", source, messages };
}
