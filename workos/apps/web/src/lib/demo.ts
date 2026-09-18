// Demo-mode data source (ТЗ §38). When no backend/Telegram connection is
// configured the app runs entirely on these fixtures so the UI is fully
// navigable. Later phases swap this for TanStack Query calls to the API.

import {
  DEMO_CHANNELS,
  DEMO_DM_USERS,
  DEMO_MESSAGES,
  DEMO_PROJECTS,
  DEMO_TASKS,
  DEMO_WORKSPACE,
  type Channel,
  type Message,
  type Project,
} from "@workos/types";

export const workspace = DEMO_WORKSPACE;
export const projects = DEMO_PROJECTS;
export const channels = DEMO_CHANNELS;
export const dmUsers = DEMO_DM_USERS;
export const tasks = DEMO_TASKS;

export function channelsForProject(projectId: string): Channel[] {
  return channels.filter((c) => c.projectId === projectId);
}

export function project(projectId: string): Project | undefined {
  return projects.find((p) => p.id === projectId);
}

export function channel(channelId: string): Channel | undefined {
  return channels.find((c) => c.id === channelId);
}

export function messagesForChannel(channelId: string): Message[] {
  return DEMO_MESSAGES.filter((m) => m.channelId === channelId).sort(
    (a, b) => +new Date(a.date) - +new Date(b.date),
  );
}

export function message(messageId: string): Message | undefined {
  return DEMO_MESSAGES.find((m) => m.id === messageId);
}

// Thread = a root message + everything replying to it (ТЗ §17).
export function threadFor(messageId: string): { root: Message | undefined; replies: Message[] } {
  const root = message(messageId);
  const replies = DEMO_MESSAGES.filter((m) => m.replyToMessageId === messageId).sort(
    (a, b) => +new Date(a.date) - +new Date(b.date),
  );
  return { root, replies };
}
