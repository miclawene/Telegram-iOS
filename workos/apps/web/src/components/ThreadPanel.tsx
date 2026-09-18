"use client";

import { useUIStore } from "@/lib/store";
import { threadFor } from "@/lib/demo";
import { Avatar } from "./Avatar";

function timeOf(iso: string): string {
  return new Date(iso).toLocaleString([], {
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  });
}

// Right-hand thread panel (ТЗ §17): root message + replies + composer.
// On mobile the /thread/[messageId] route renders the same content fullscreen.
export function ThreadPanel() {
  const threadMessageId = useUIStore((s) => s.threadMessageId);
  const openThread = useUIStore((s) => s.openThread);

  if (!threadMessageId) return null;
  const { root, replies } = threadFor(threadMessageId);

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
        {root && (
          <div className="mb-4 flex gap-3 border-b border-border pb-4">
            <Avatar name={root.senderName} size={36} />
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-semibold">{root.senderName}</span>
                <span className="text-xs text-muted">{timeOf(root.date)}</span>
              </div>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">{root.text}</p>
            </div>
          </div>
        )}

        {replies.length === 0 ? (
          <p className="text-sm text-muted">No replies yet.</p>
        ) : (
          replies.map((r) => (
            <div key={r.id} className="mb-3 flex gap-3">
              <Avatar name={r.senderName} size={28} />
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-medium">{r.senderName}</span>
                  <span className="text-xs text-muted">{timeOf(r.date)}</span>
                </div>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">{r.text}</p>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="border-t border-border p-3">
        <form
          onSubmit={(e) => e.preventDefault()}
          className="rounded-lg border border-border bg-bg px-3 py-2"
        >
          <input
            placeholder="Reply…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted"
          />
        </form>
      </div>
    </aside>
  );
}
