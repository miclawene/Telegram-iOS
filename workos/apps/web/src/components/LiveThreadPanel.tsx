"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { api, type HistoryMessageDTO } from "@/lib/api";
import { useUIStore } from "@/lib/store";
import { Avatar } from "./Avatar";

function timeOf(iso: string): string {
  return new Date(iso).toLocaleString([], {
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  });
}

// Live thread panel for a real channel (a forum topic): shows a root message,
// the messages replying to it, and a composer that sends a Telegram reply into
// the same topic (ТЗ §17, §34 — reply relation is preserved).
export function LiveThreadPanel({ channelId }: { channelId: string }) {
  const qc = useQueryClient();
  const threadMessageId = useUIStore((s) => s.threadMessageId);
  const openThread = useUIStore((s) => s.openThread);
  const [draft, setDraft] = useState("");

  // Reuse the channel's message list (already loaded/polled by LiveChannelView).
  const { data } = useQuery({
    queryKey: ["channel-messages", channelId],
    queryFn: () => api.messages(channelId),
    refetchInterval: 15_000,
  });

  const reply = useMutation({
    mutationFn: (text: string) => api.send(channelId, text, threadMessageId ?? undefined),
    onSuccess: () => {
      setDraft("");
      void qc.invalidateQueries({ queryKey: ["channel-messages", channelId] });
    },
  });

  if (!threadMessageId) return null;
  const messages = data?.messages ?? [];
  const root = messages.find((m) => m.id === threadMessageId);
  const replies = messages.filter((m) => m.replyToMessageId === threadMessageId);

  return (
    <aside className="flex h-full w-[340px] shrink-0 flex-col border-l border-border bg-surface">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="text-sm font-semibold">Thread</span>
        <button
          type="button"
          onClick={() => openThread(null)}
          className="rounded p-1 text-muted hover:bg-surface-2 hover:text-text"
          aria-label="Close thread"
        >
          ✕
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {root ? (
          <ThreadMessage message={root} size={36} border />
        ) : (
          <p className="mb-4 border-b border-border pb-4 text-sm text-muted">
            Original message isn&apos;t loaded.
          </p>
        )}

        {replies.length === 0 ? (
          <p className="text-sm text-muted">No replies yet.</p>
        ) : (
          replies.map((r) => <ThreadMessage key={r.id} message={r} size={28} />)
        )}
      </div>

      <div className="border-t border-border p-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) reply.mutate(draft.trim());
          }}
          className="flex items-end gap-2 rounded-lg border border-border bg-bg px-3 py-2"
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Reply…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted"
          />
          <button
            type="submit"
            disabled={!draft.trim() || reply.isPending}
            className="rounded-md bg-accent px-2.5 py-1 text-sm font-medium text-accent-fg disabled:opacity-40"
          >
            {reply.isPending ? "…" : "Send"}
          </button>
        </form>
      </div>
    </aside>
  );
}

function ThreadMessage({
  message,
  size,
  border,
}: {
  message: HistoryMessageDTO;
  size: number;
  border?: boolean;
}) {
  return (
    <div className={border ? "mb-4 flex gap-3 border-b border-border pb-4" : "mb-3 flex gap-3"}>
      <Avatar name={message.senderTelegramUserId ?? "?"} size={size} />
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium">
            {message.senderTelegramUserId ?? "Unknown"}
          </span>
          <span className="text-xs text-muted">{timeOf(message.date)}</span>
        </div>
        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">{message.text}</p>
      </div>
    </div>
  );
}
