"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import type { ChannelSourceState } from "@workos/types";

import { api, type HistoryMessageDTO } from "@/lib/api";
import { useUIStore } from "@/lib/store";
import { Avatar } from "./Avatar";

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Renders a Work channel backed by a real Telegram source: loads live history on
// open (ТЗ §13), shows non-crashing source states (ТЗ §22), and sends through the
// backend -> worker -> Telegram (ТЗ §16, §17). No local message DB (ТЗ §42).
export function LiveChannelView({ channelId }: { channelId: string }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const openThread = useUIStore((s) => s.openThread);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["channel-messages", channelId],
    queryFn: () => api.messages(channelId),
    refetchInterval: 15_000,
    retry: 1,
  });

  const send = useMutation({
    mutationFn: (text: string) => api.send(channelId, text),
    onSuccess: () => {
      setDraft("");
      void qc.invalidateQueries({ queryKey: ["channel-messages", channelId] });
    },
  });

  if (isLoading) {
    return <CenterNote title="Loading…" subtitle="Fetching Telegram history." />;
  }
  if (isError) {
    const detail = error instanceof Error ? error.message : String(error);
    return (
      <section className="flex h-full flex-1 items-center justify-center bg-bg text-center">
        <div className="max-w-md px-6">
          <p className="text-lg font-medium">Couldn&apos;t load this channel</p>
          <p className="mt-1 break-words text-sm text-muted">{detail}</p>
          <button
            onClick={() => void refetch()}
            className="mt-4 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-2"
          >
            Retry
          </button>
        </div>
      </section>
    );
  }

  const state: ChannelSourceState = data?.state ?? "no_source";
  if (state !== "available") {
    return <SourceStateNote state={state} />;
  }

  const messages = data?.messages ?? [];

  return (
    <section className="flex h-full flex-1 flex-col bg-bg">
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {messages.length === 0 && (
          <p className="text-sm text-muted">No messages yet.</p>
        )}
        {messages.map((m) => (
          <LiveRow key={m.id} message={m} onReply={() => openThread(m.id)} />
        ))}
      </div>

      <div className="border-t border-border p-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) send.mutate(draft.trim());
          }}
          className="flex items-end gap-2 rounded-lg border border-border bg-surface px-3 py-2"
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={1}
            placeholder="Message"
            className="max-h-32 flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted"
          />
          <button
            type="submit"
            disabled={!draft.trim() || send.isPending}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg disabled:opacity-40"
          >
            {send.isPending ? "…" : "Send"}
          </button>
        </form>
      </div>
    </section>
  );
}

function LiveRow({
  message,
  onReply,
}: {
  message: HistoryMessageDTO;
  onReply: () => void;
}) {
  return (
    <div className="group mb-3 flex gap-3">
      <Avatar name={message.senderTelegramUserId ?? "?"} size={32} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium">
            {message.senderTelegramUserId ?? "Unknown"}
          </span>
          <span className="text-xs text-muted">{timeOf(message.date)}</span>
        </div>
        <p className="whitespace-pre-wrap break-words text-sm">{message.text}</p>
        <button
          onClick={onReply}
          className="text-xs text-muted opacity-0 hover:text-accent group-hover:opacity-100"
        >
          Reply in thread
        </button>
      </div>
    </div>
  );
}

// ТЗ §22: unavailable states never crash; offer recover actions.
function SourceStateNote({ state }: { state: ChannelSourceState }) {
  const copy: Record<ChannelSourceState, { title: string; subtitle: string }> = {
    available: { title: "", subtitle: "" },
    no_source: {
      title: "No Telegram source",
      subtitle: "This channel isn't linked to a Telegram conversation yet.",
    },
    peer_unavailable: {
      title: "Telegram conversation unavailable",
      subtitle: "The linked conversation could not be found right now.",
    },
    account_logged_out: {
      title: "Telegram account disconnected",
      subtitle: "Reconnect your Telegram account to see messages.",
    },
    peer_deleted: {
      title: "Conversation deleted",
      subtitle: "The linked Telegram conversation no longer exists.",
    },
    access_denied: {
      title: "No access to this conversation",
      subtitle: "You may have been removed from the Telegram group.",
    },
  };
  const c = copy[state];
  return (
    <section className="flex h-full flex-1 items-center justify-center bg-bg text-center">
      <div>
        <p className="text-lg font-medium">{c.title}</p>
        <p className="mt-1 text-sm text-muted">{c.subtitle}</p>
        <div className="mt-4 flex justify-center gap-2">
          <button className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-2">
            Reconnect
          </button>
          <button className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-2">
            Change source
          </button>
        </div>
      </div>
    </section>
  );
}

function CenterNote({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <section className="flex h-full flex-1 items-center justify-center bg-bg text-center">
      <div>
        <p className="text-lg font-medium">{title}</p>
        <p className="mt-1 text-sm text-muted">{subtitle}</p>
      </div>
    </section>
  );
}

// Referenced by ChannelView to detect demo vs live channels.
export function isDemoChannel(channelId: string): boolean {
  return channelId.startsWith("demo-");
}
