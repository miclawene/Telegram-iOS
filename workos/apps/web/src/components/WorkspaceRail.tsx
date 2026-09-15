"use client";

import { cn } from "@workos/ui";

import { useUIStore } from "@/lib/store";
import { workspace } from "@/lib/demo";

// Left rail: workspace switcher + attention navigation (Home / Activity / Threads / Later).
const NAV = [
  { key: "home", label: "Home", icon: "◇" },
  { key: "activity", label: "Activity", icon: "◈" },
  { key: "threads", label: "Threads", icon: "≡" },
  { key: "later", label: "Later", icon: "☾" },
] as const;

export function WorkspaceRail() {
  const theme = useUIStore((s) => s.theme);
  const toggleTheme = useUIStore((s) => s.toggleTheme);

  return (
    <nav className="flex h-full w-[240px] shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex items-center gap-2 px-4 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent font-bold text-accent-fg">
          C
        </div>
        <span className="truncate text-sm font-semibold uppercase tracking-wide">
          {workspace.name}
        </span>
      </div>

      <ul className="px-2">
        {NAV.map((item) => (
          <li key={item.key}>
            <button
              type="button"
              className={cn(
                "flex w-full items-center gap-3 rounded-md px-3 py-1.5 text-sm text-muted",
                "hover:bg-surface-2 hover:text-text",
              )}
            >
              <span className="w-4 text-center opacity-70">{item.icon}</span>
              {item.label}
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-auto flex items-center justify-between px-4 py-3 text-xs text-muted">
        <span>Demo workspace</span>
        <button
          type="button"
          onClick={toggleTheme}
          className="rounded-md border border-border px-2 py-1 hover:bg-surface-2"
          aria-label="Toggle theme"
        >
          {theme === "dark" ? "Light" : "Dark"}
        </button>
      </div>
    </nav>
  );
}
