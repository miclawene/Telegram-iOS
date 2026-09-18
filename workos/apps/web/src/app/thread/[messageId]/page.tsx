"use client";

import { use, useEffect } from "react";
import Link from "next/link";

import { useUIStore } from "@/lib/store";
import { ThreadPanel } from "@/components/ThreadPanel";

// Mobile thread route (ТЗ §17): /thread/:messageId renders the thread fullscreen.
export default function ThreadRoute({
  params,
}: {
  params: Promise<{ messageId: string }>;
}) {
  const { messageId } = use(params);
  const openThread = useUIStore((s) => s.openThread);

  useEffect(() => {
    openThread(messageId);
    return () => openThread(null);
  }, [messageId, openThread]);

  return (
    <div className="flex h-screen w-full flex-col">
      <div className="flex items-center gap-2 border-b border-border bg-surface px-3 py-2">
        <Link href="/" className="rounded p-1 text-muted hover:bg-surface-2">
          ‹ Back
        </Link>
        <span className="text-sm font-semibold">Thread</span>
      </div>
      <div className="flex-1 overflow-hidden">
        <ThreadPanel />
      </div>
    </div>
  );
}
