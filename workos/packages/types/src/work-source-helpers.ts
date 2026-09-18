// Pure helpers for Work↔Telegram source mapping. No runtime deps so they are
// trivially unit-testable (ТЗ §50) and shared by api + web.

import type {
  ChannelSourceState,
  TelegramChannelSource,
  WorkChannelSource,
  WorkTelegramMessageReference,
} from "./work-source.js";

// ─── Serialization ────────────────────────────────────────────────────────────

export function serializeSource(source: WorkChannelSource): string {
  // Compact, stable form. Telegram is the only variant today.
  return JSON.stringify({
    type: source.type,
    accountId: source.accountId,
    peerId: source.peerId,
  });
}

export function parseSource(raw: string): WorkChannelSource | null {
  try {
    const obj = JSON.parse(raw) as Partial<TelegramChannelSource>;
    if (obj.type === "telegram" && obj.accountId && obj.peerId) {
      return { type: "telegram", accountId: obj.accountId, peerId: obj.peerId };
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Multi-account identity ──────────────────────────────────────────────────
// Two sources are the same conversation only if BOTH account and peer match
// (ТЗ §6, §56): identical numeric peerIds across accounts must NOT collide.

export function sameSource(a: WorkChannelSource, b: WorkChannelSource): boolean {
  return a.type === b.type && a.accountId === b.accountId && a.peerId === b.peerId;
}

export function sourceKey(source: WorkChannelSource): string {
  return `${source.type}:${source.accountId}:${source.peerId}`;
}

// ─── Message references ──────────────────────────────────────────────────────

export function messageRefFromSource(
  source: TelegramChannelSource,
  messageId: string,
): WorkTelegramMessageReference {
  return { accountId: source.accountId, peerId: source.peerId, messageId };
}

export function sameMessageRef(
  a: WorkTelegramMessageReference,
  b: WorkTelegramMessageReference,
): boolean {
  return (
    a.accountId === b.accountId &&
    a.peerId === b.peerId &&
    a.messageId === b.messageId
  );
}

// ─── Source state mapping ────────────────────────────────────────────────────
// Maps a worker/resolver outcome to a UI-facing state (ТЗ §22). Never throws.

export interface SourceResolutionOutcome {
  hasSource: boolean;
  accountLoggedOut?: boolean;
  peerFound?: boolean;
  accessDenied?: boolean;
  peerDeleted?: boolean;
}

export function resolveSourceState(o: SourceResolutionOutcome): ChannelSourceState {
  if (!o.hasSource) return "no_source";
  if (o.accountLoggedOut) return "account_logged_out";
  if (o.peerDeleted) return "peer_deleted";
  if (o.accessDenied) return "access_denied";
  if (o.peerFound) return "available";
  return "peer_unavailable";
}
