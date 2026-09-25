import type { TelegramConversation } from "@workos/types";

import { env } from "../env.js";

// Thin client for the telegram-worker internal control API. All Telegram access
// from the backend goes through here; the backend never touches MTProto or the
// Telegram session directly (ТЗ §2, §29).

interface WorkerMessage {
  id: string;
  chatId: string;
  senderId: string | null;
  text: string | null;
  date: string;
  replyToMessageId: string | null;
  media?: {
    kind: "photo" | "video" | "document" | "audio" | "other";
    mimeType: string | null;
    fileName: string | null;
    size: number | null;
    hasThumb: boolean;
  } | null;
}

async function workerFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<{ ok: true; status: number; data: T } | { ok: false; status: number; error: string }> {
  try {
    const res = await fetch(`${env.WORKER_URL}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        "x-internal-secret": env.API_INTERNAL_SECRET,
        ...(init.headers ?? {}),
      },
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, status: res.status, error: String(body.error ?? "worker_error") };
    }
    return { ok: true, status: res.status, data: body as T };
  } catch {
    // Worker unreachable — distinct from an application error (ТЗ §22, §49).
    return { ok: false, status: 503, error: "worker_unavailable" };
  }
}

export const workerClient = {
  requestCode(accountId: string, phone: string) {
    return workerFetch<{ ok: boolean }>(
      `/accounts/${accountId}/auth/request-code`,
      { method: "POST", body: JSON.stringify({ phone }) },
    );
  },

  signIn(accountId: string, params: { phone: string; code: string; password?: string }) {
    return workerFetch<{ telegramUserId: string }>(
      `/accounts/${accountId}/auth/sign-in`,
      { method: "POST", body: JSON.stringify(params) },
    );
  },

  getChats(accountId: string, query?: string) {
    const qs = query ? `?query=${encodeURIComponent(query)}` : "";
    return workerFetch<{ chats: TelegramConversation[] }>(
      `/accounts/${accountId}/chats${qs}`,
    );
  },

  async getMedia(
    accountId: string,
    peerId: string,
    messageId: string,
    thumb: boolean,
  ): Promise<
    | { ok: true; buffer: Buffer; contentType: string; disposition: string | null }
    | { ok: false; status: number }
  > {
    try {
      const res = await fetch(
        `${env.WORKER_URL}/accounts/${accountId}/peers/${peerId}/messages/${messageId}/media${thumb ? "?thumb=1" : ""}`,
        { headers: { "x-internal-secret": env.API_INTERNAL_SECRET } },
      );
      if (!res.ok) return { ok: false, status: res.status };
      const buffer = Buffer.from(await res.arrayBuffer());
      return {
        ok: true,
        buffer,
        contentType: res.headers.get("content-type") ?? "application/octet-stream",
        disposition: res.headers.get("content-disposition"),
      };
    } catch {
      return { ok: false, status: 503 };
    }
  },

  getTopics(accountId: string, peerId: string) {
    return workerFetch<{ topics: { id: string; title: string }[] }>(
      `/accounts/${accountId}/peers/${peerId}/topics`,
    );
  },

  getMessages(
    accountId: string,
    peerId: string,
    params: { limit?: number; beforeId?: string; topicId?: string } = {},
  ) {
    const qs = new URLSearchParams();
    if (params.limit) qs.set("limit", String(params.limit));
    if (params.beforeId) qs.set("beforeId", params.beforeId);
    if (params.topicId) qs.set("topicId", params.topicId);
    const suffix = qs.toString() ? `?${qs}` : "";
    return workerFetch<{ messages: WorkerMessage[] }>(
      `/accounts/${accountId}/peers/${peerId}/messages${suffix}`,
    );
  },

  send(
    accountId: string,
    peerId: string,
    text: string,
    opts: { replyToMessageId?: string; topicId?: string } = {},
  ) {
    return workerFetch<{ message: WorkerMessage }>(
      `/accounts/${accountId}/peers/${peerId}/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          text,
          replyToMessageId: opts.replyToMessageId,
          topicId: opts.topicId,
        }),
      },
    );
  },

  resolvePeer(accountId: string, peerId: string) {
    return workerFetch<{ found: boolean; title?: string; accessDenied?: boolean }>(
      `/accounts/${accountId}/peers/${peerId}`,
    );
  },
};

export type { WorkerMessage };
