"use client";

import type {
  Channel,
  ChannelSourceState,
  Project,
  TelegramConversation,
  User,
  Workspace,
} from "@workos/types";

// Typed client for the Work backend. Cookies carry the session, so every call
// uses credentials: "include". The frontend never talks to Telegram directly
// (ТЗ §2) — all Telegram access is via these backend endpoints.

// Same-origin path proxied to the backend by next.config rewrites, so the
// session cookie is first-party in every browser.
const API_URL = "/api";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiError(res.status, String(body.error ?? "request_failed"));
  }
  return body as T;
}

export interface TelegramAccountDTO {
  id: string;
  telegramUserId: string | null;
  username: string | null;
  status: "pending" | "connected" | "disconnected" | "error";
}

export interface HistoryMessageDTO {
  id: string;
  telegramMessageId: string;
  senderTelegramUserId: string | null;
  replyToMessageId: string | null;
  date: string;
  text: string | null;
}

export const api = {
  // Auth (cookie session)
  me: () => req<{ user: User }>("/auth/me"),
  register: (email: string, name: string, password: string) =>
    req<{ user: User }>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, name, password }),
    }),
  login: (email: string, password: string) =>
    req<{ user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  logout: () => req<{ ok: boolean }>("/auth/logout", { method: "POST" }),

  // Work metadata
  workspaces: () => req<{ workspaces: Workspace[] }>("/workspaces"),
  createWorkspace: (name: string) =>
    req<{ workspace: Workspace }>("/workspaces", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  projects: (workspaceId: string) =>
    req<{ projects: Project[] }>(`/projects?workspaceId=${workspaceId}`),
  channels: (workspaceId: string) =>
    req<{ channels: Channel[] }>(`/channels?workspaceId=${workspaceId}`),

  // Telegram auth (ТЗ §7, §12)
  telegramAccount: () => req<{ account: TelegramAccountDTO | null }>("/telegram/account"),
  requestCode: (phone: string) =>
    req<{ accountId: string }>("/telegram/auth/request-code", {
      method: "POST",
      body: JSON.stringify({ phone }),
    }),
  signIn: (phone: string, code: string) =>
    req<{ ok: boolean }>("/telegram/auth/sign-in", {
      method: "POST",
      body: JSON.stringify({ phone, code }),
    }),
  twoFactor: (phone: string, code: string, password: string) =>
    req<{ ok: boolean }>("/telegram/auth/2fa", {
      method: "POST",
      body: JSON.stringify({ phone, code, password }),
    }),

  // Selector (ТЗ §8, §9)
  chats: (query?: string) =>
    req<{ chats: TelegramConversation[] }>(
      `/telegram/chats${query ? `?query=${encodeURIComponent(query)}` : ""}`,
    ),

  // Forum topics of a supergroup (ТЗ §8)
  topics: (peerId: string) =>
    req<{ topics: { id: string; title: string }[] }>(
      `/telegram/topics?peerId=${encodeURIComponent(peerId)}`,
    ),

  // Import a forum supergroup as a project (topic -> channel)
  importForum: (input: {
    workspaceId: string;
    peerId: string;
    title: string;
    projectName?: string;
  }) =>
    req<{ projectId: string; channels: { id: string; name: string }[] }>(
      "/telegram/import-forum",
      { method: "POST", body: JSON.stringify(input) },
    ),

  // Import: bind peer -> channel (ТЗ §7, §11)
  importChannel: (input: {
    workspaceId: string;
    projectId?: string;
    newProjectName?: string;
    channelName: string;
    peerId: string;
    chatType: TelegramConversation["chatType"];
    title: string;
  }) =>
    req<{ channel: { id: string; name: string; projectId: string | null } }>(
      "/telegram/import",
      { method: "POST", body: JSON.stringify(input) },
    ),

  // History + send (ТЗ §13, §16, §17)
  messages: (channelId: string) =>
    req<{ state: ChannelSourceState; messages: HistoryMessageDTO[] }>(
      `/channels/${channelId}/messages`,
    ),
  send: (channelId: string, text: string, replyToMessageId?: string) =>
    req<{ message: HistoryMessageDTO }>(`/channels/${channelId}/messages`, {
      method: "POST",
      body: JSON.stringify({ text, replyToMessageId }),
    }),
};
