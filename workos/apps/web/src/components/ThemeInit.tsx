"use client";

import { useEffect } from "react";

import { useUIStore } from "@/lib/store";

// Applies the persisted theme on first paint and keeps <html class="dark"> in sync.
export function ThemeInit() {
  const setTheme = useUIStore((s) => s.setTheme);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem("workos-theme");
    } catch {
      /* ignore */
    }
    const prefersDark =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    setTheme(stored === "light" || stored === "dark" ? stored : prefersDark ? "dark" : "light");
  }, [setTheme]);

  return null;
}
