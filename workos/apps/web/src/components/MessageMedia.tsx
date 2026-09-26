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

// Renders a message attachment inline: images as images, video/audio with a
// player, and only genuine files (pdf, docx, …) as a download chip. Bytes are
// proxied through the backend and streamed with range support for seeking.
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

  const isImage = media.kind === "photo" || (media.mimeType?.startsWith("image/") ?? false);
  const isVideo = media.kind === "video" || (media.mimeType?.startsWith("video/") ?? false);
  const isAudio = media.kind === "audio" || (media.mimeType?.startsWith("audio/") ?? false);

  // ── Image: show it inline; click opens the full-resolution original. ──
  if (isImage && !failed) {
    return (
      <a href={full} target="_blank" rel="noreferrer" className="mt-1 block w-fit">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={media.kind === "photo" ? thumb : full}
          alt={media.fileName ?? "image"}
          onError={() => setFailed(true)}
          className="max-h-80 max-w-[320px] rounded-lg border border-border object-cover"
        />
      </a>
    );
  }

  // ── Video: inline player. ──
  if (isVideo && !failed) {
    return (
      <video
        controls
        preload="metadata"
        poster={media.hasThumb ? thumb : undefined}
        onError={() => setFailed(true)}
        className="mt-1 max-h-80 max-w-[320px] rounded-lg border border-border"
      >
        <source src={full} type={media.mimeType ?? "video/mp4"} />
      </video>
    );
  }

  // ── Audio: inline player. ──
  if (isAudio && !failed) {
    return (
      <audio controls preload="metadata" onError={() => setFailed(true)} className="mt-1 w-[280px]">
        <source src={full} type={media.mimeType ?? "audio/mpeg"} />
      </audio>
    );
  }

  // ── Everything else (or a failed inline render): a download chip. ──
  const icon = isVideo ? "🎬" : isAudio ? "🎵" : "📎";
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
