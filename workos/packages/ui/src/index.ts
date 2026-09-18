import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// Tailwind-aware className combiner used across the web app.
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// Shared design tokens (kept in sync with the Tailwind theme in apps/web).
export const TOKENS = {
  sidebarWidth: "260px",
  projectPaneWidth: "240px",
} as const;
