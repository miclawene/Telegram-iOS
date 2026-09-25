"use client";

import { useState } from "react";

import { mediaUrl, type MediaInfoDTO } from "@/lib/api";

function humanSize(bytes: number | null): string {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

// Renders a message attachment: photos/video thumbnails inline (click to open
// full), files as a download chip. Bytes are proxied through the backend.
export function MessageMedia({
  channelId,
  messageId,
  media,
}: {
  channelId: string;
  messageId: string;
  media: MediaInfoDTO;
}) {
  const [failed, setFailed] = useState(false);
  const full = mediaUrl(channelId, messageId);
  const thumb = mediaUrl(channelId, messageId, true);

  if ((media.kind === "photo" || media.kind === "video") && media.hasThumb && !failed) {
    return (
      <a href={full} target="_blank" rel="noreferrer" className="mt-1 block w-fit">
        <span className="relative block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={thumb}
            alt={media.fileName ?? media.kind}
            onError={() => setFailed(true)}
            className="max-h-64 max-w-[280px] rounded-lg border border-border object-cover"
          />
          {media.kind === "video" && (
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/55 text-white">
                ▶
              </span>
            </span>
          )}
        </span>
      </a>
    );
  }

  const icon = media.kind === "video" ? "🎬" : media.kind === "audio" ? "🎵" : "📎";
  return (
    <a
      href={full}
      target="_blank"
      rel="noreferrer"
      className="mt-1 flex w-fit max-w-[280px] items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 hover:bg-surface-2"
    >
      <span className="text-lg">{icon}</span>
      <span className="min-w-0">
        <span className="block truncate text-sm">{media.fileName ?? media.kind}</span>
        <span className="block text-xs text-muted">
          {[media.mimeType, humanSize(media.size)].filter(Boolean).join(" · ") || "Download"}
        </span>
      </span>
    </a>
  );
}
