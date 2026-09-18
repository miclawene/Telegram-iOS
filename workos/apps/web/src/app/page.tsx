"use client";

import { useUIStore } from "@/lib/store";
import { WorkspaceRail } from "@/components/WorkspaceRail";
import { ProjectPane } from "@/components/ProjectPane";
import { ChannelView } from "@/components/ChannelView";
import { ThreadPanel } from "@/components/ThreadPanel";
import { channel } from "@/lib/demo";

export default function HomePage() {
  const mobileView = useUIStore((s) => s.mobileView);
  const setMobileView = useUIStore((s) => s.setMobileView);
  const activeChannelId = useUIStore((s) => s.activeChannelId);
  const threadMessageId = useUIStore((s) => s.threadMessageId);
  const ch = activeChannelId ? channel(activeChannelId) : undefined;

  return (
    <div className="flex h-screen w-full overflow-hidden">
      {/* ── Desktop: 3-column layout (ТЗ §14) ── */}
      <div className="hidden h-full w-full md:flex">
        <WorkspaceRail />
        <ProjectPane />
        <ChannelView />
        {threadMessageId && <ThreadPanel />}
      </div>

      {/* ── Mobile: single-column stack (ТЗ §15) ── */}
      <div className="flex h-full w-full flex-col md:hidden">
        {mobileView === "channel" && ch ? (
          <>
            <div className="flex items-center gap-2 border-b border-border bg-surface px-3 py-2">
              <button
                type="button"
                onClick={() => setMobileView("channels")}
                className="rounded p-1 text-muted hover:bg-surface-2"
                aria-label="Back"
              >
                ‹ Back
              </button>
              <span className="text-sm font-semibold">
                <span className="text-muted">#</span> {ch.name}
              </span>
            </div>
            <div className="flex-1 overflow-hidden">
              <ChannelView />
            </div>
          </>
        ) : (
          <div className="flex-1 overflow-hidden">
            <ProjectPane />
          </div>
        )}
      </div>
    </div>
  );
}
