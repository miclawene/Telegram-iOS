"use client";

import { useState } from "react";

import { cn } from "@workos/ui";

import { useUIStore } from "@/lib/store";
import { channelsForProject, dmUsers, projects, workspace } from "@/lib/demo";
import { Avatar } from "./Avatar";
import { AddTelegramChannel } from "./AddTelegramChannel";

// Middle column: the project + channel tree, and DMs. This is where the user
// feels Workspace → Project → Channel rather than a flat Telegram chat list.
export function ProjectPane() {
  const activeProjectId = useUIStore((s) => s.activeProjectId);
  const activeChannelId = useUIStore((s) => s.activeChannelId);
  const selectProject = useUIStore((s) => s.selectProject);
  const selectChannel = useUIStore((s) => s.selectChannel);
  const [showAdd, setShowAdd] = useState(false);

  return (
    <aside className="flex h-full w-full shrink-0 flex-col border-r border-border bg-surface md:w-[240px]">
      <div className="flex items-center justify-between px-4 py-4">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted">
          Projects
        </span>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="rounded-md border border-border px-1.5 py-0.5 text-xs text-muted hover:bg-surface-2 hover:text-text"
          title="Add Telegram Channel"
        >
          + Add
        </button>
      </div>

      {showAdd && (
        <AddTelegramChannel
          workspaceId={workspace.id}
          onClose={() => setShowAdd(false)}
        />
      )}

      <div className="flex-1 overflow-y-auto px-2">
        {projects.map((p) => {
          const open = activeProjectId === p.id;
          const channels = channelsForProject(p.id);
          return (
            <div key={p.id} className="mb-1">
              <button
                type="button"
                onClick={() => selectProject(open ? null : p.id)}
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm font-medium hover:bg-surface-2"
              >
                <span className={cn("text-xs transition-transform", open && "rotate-90")}>
                  ▸
                </span>
                <span className="truncate">{p.name}</span>
              </button>

              {open && (
                <ul className="ml-4 mt-0.5">
                  {channels.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => selectChannel(c.id)}
                        className={cn(
                          "flex w-full items-center gap-1 rounded-md px-2 py-1 text-left text-sm text-muted hover:bg-surface-2 hover:text-text",
                          activeChannelId === c.id && "bg-accent/15 font-medium text-text",
                        )}
                      >
                        <span className="opacity-60">#</span>
                        {c.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}

        <div className="mt-4 px-2 py-1 text-xs font-semibold uppercase tracking-wider text-muted">
          Direct Messages
        </div>
        <ul>
          {dmUsers.map((u) => (
            <li key={u.id}>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm text-muted hover:bg-surface-2 hover:text-text"
              >
                <Avatar name={u.name} size={20} />
                {u.name}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
