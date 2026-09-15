"use client";

import { create } from "zustand";

type ThemeMode = "light" | "dark";

interface UIState {
  theme: ThemeMode;
  // Selected navigation state (Workspace → Project → Channel).
  activeProjectId: string | null;
  activeChannelId: string | null;
  // Right-hand thread panel (ТЗ §17).
  threadMessageId: string | null;
  // Mobile navigation level.
  mobileView: "projects" | "channels" | "channel";

  setTheme: (t: ThemeMode) => void;
  toggleTheme: () => void;
  selectProject: (id: string | null) => void;
  selectChannel: (id: string | null) => void;
  openThread: (messageId: string | null) => void;
  setMobileView: (v: UIState["mobileView"]) => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  theme: "dark",
  activeProjectId: null,
  activeChannelId: null,
  threadMessageId: null,
  mobileView: "projects",

  setTheme: (theme) => {
    set({ theme });
    if (typeof document !== "undefined") {
      document.documentElement.classList.toggle("dark", theme === "dark");
      try {
        localStorage.setItem("workos-theme", theme);
      } catch {
        /* ignore */
      }
    }
  },
  toggleTheme: () => get().setTheme(get().theme === "dark" ? "light" : "dark"),

  selectProject: (activeProjectId) =>
    set({ activeProjectId, activeChannelId: null, mobileView: "channels" }),
  selectChannel: (activeChannelId) =>
    set({ activeChannelId, mobileView: "channel", threadMessageId: null }),
  openThread: (threadMessageId) => set({ threadMessageId }),
  setMobileView: (mobileView) => set({ mobileView }),
}));
