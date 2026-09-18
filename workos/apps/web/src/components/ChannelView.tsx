"use client";

import { useMemo, useState } from "react";

import { cn } from "@workos/ui";
import type { Message } from "@workos/types";

import { useUIStore } from "@/lib/store";
import { channel, messagesForChannel, project } from "@/lib/demo";
import { useWorkspaceData } from "@/lib/live";
import { Avatar } from "./Avatar";
import { LiveChannelView, isDemoChannel } from "./LiveChannelView";

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Groups consecutive messages by the same sender (ТЗ §16).
function groupBySender(messages: Message[]): Message[][] {
  const groups: Message[][] = [];
  for (const m of messages) {
    const last = groups[groups.length - 1];
    if (last && last[0]?.senderTelegramUserId === m.senderTelegramUserId) {
      last.push(m);
    } else {
      groups.push([m]);
    }
  }
  return groups;
}

export function ChannelView() {
  const activeChannelId = useUIStore((s) => s.activeChannelId);
  const openThread = useUIStore((s) => s.openThread);
  const [draft, setDraft] = useState("");
  const live = useWorkspaceData();

  const ch = activeChannelId ? channel(activeChannelId) : undefined;
  const proj = ch?.projectId ? project(ch.projectId) : undefined;
  const groups = useMemo(
    () => (activeChannelId ? groupBySender(messagesForChannel(activeChannelId)) : []),
    [activeChannelId],
  );

  // Real (non-demo) channels load live Telegram history via the backend.
  if (activeChannelId && !isDemoChannel(activeChannelId)) {
    const liveCh = live.channel(activeChannelId);
    const liveProj = liveCh?.projectId ? live.project(liveCh.projectId) : undefined;
    return (
      <section className="flex h-full flex-1 flex-col bg-bg">
        <header className="flex items-center gap-2 border-b border-border px-5 py-3">
          <span className="text-lg font-semibold text-text">
            <span className="text-muted">#</span> {liveCh?.name ?? "channel"}
          </span>
          {liveProj && <span className="text-sm text-muted">· {liveProj.name}</span>}
        </header>
        <LiveChannelView channelId={activeChannelId} />
      </section>
    );
  }

  if (!ch) {
    return (
      <section className="flex h-full flex-1 items-center justify-center text-muted">
        <div className="text-center">
          <p className="text-lg font-medium text-text">No channel selected</p>
          <p className="text-sm">Pick a project and channel to see messages.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="flex h-full flex-1 flex-col bg-bg">
      {/* Header */}
      <header className="flex items-center gap-2 border-b border-border px-5 py-3">
        <span className="text-lg font-semibold">
          <span className="text-muted">#</span> {ch.name}
        </span>
        {proj && <span className="text-sm text-muted">· {proj.name}</span>}
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {groups.map((group, gi) => {
          const first = group[0]!;
          return (
            <div key={gi} className="mb-4 flex gap-3">
              <Avatar name={first.senderName} size={36} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold">{first.senderName}</span>
                  <span className="text-xs text-muted">{timeOf(first.date)}</span>
                </div>
                {group.map((m) => (
                  <MessageRow key={m.id} message={m} onOpenThread={() => openThread(m.id)} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Composer */}
      <div className="border-t border-border p-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            // Phase 3: POST to /channels/:id/messages -> Telegram sendMessage.
            setDraft("");
          }}
          className="flex items-end gap-2 rounded-lg border border-border bg-surface px-3 py-2"
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={1}
            placeholder={`Message #${ch.name}`}
            className="max-h-32 flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted"
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg disabled:opacity-40"
          >
            Send
          </button>
        </form>
      </div>
    </section>
  );
}

function MessageRow({
  message,
  onOpenThread,
}: {
  message: Message;
  onOpenThread: () => void;
}) {
  return (
    <div className="group relative rounded px-1 py-0.5 hover:bg-surface/60">
      <p className="whitespace-pre-wrap break-words text-sm text-text">{message.text}</p>
      <div className="mt-0.5 flex items-center gap-2">
        {message.requiresResponse && (
          <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent">
            Needs response
          </span>
        )}
        <button
          type="button"
          onClick={onOpenThread}
          className={cn(
            "text-xs text-muted opacity-0 transition-opacity hover:text-accent group-hover:opacity-100",
          )}
        >
          Reply in thread
        </button>
      </div>
    </div>
  );
}
