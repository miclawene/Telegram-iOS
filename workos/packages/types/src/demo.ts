// Shared demo dataset (ТЗ §38). Pure data, no runtime deps, so it can be used by
// the database seed (server) AND the web app's offline demo mode (browser).
//
// User does not feel Telegram as a chaotic chat list — they feel:
//   Workspace → Project → Channel → Thread → Task

import type {
  Channel,
  Message,
  Project,
  Task,
  Workspace,
} from "./entities.js";

export const DEMO_WORKSPACE: Workspace = {
  id: "demo-workspace",
  name: "Cityscape",
  slug: "cityscape",
  createdBy: "demo-user",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

export const DEMO_PROJECTS: Project[] = [
  {
    id: "demo-project-hail",
    workspaceId: DEMO_WORKSPACE.id,
    name: "Ha'il Airport",
    slug: "hail-airport",
    description: "New terminal — architecture & BIM coordination.",
    status: "active",
    createdAt: "2026-01-02T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  },
  {
    id: "demo-project-riyadh",
    workspaceId: DEMO_WORKSPACE.id,
    name: "Riyadh Terminal",
    slug: "riyadh-terminal",
    description: "Facade package and site works.",
    status: "active",
    createdAt: "2026-01-03T00:00:00.000Z",
    updatedAt: "2026-01-03T00:00:00.000Z",
  },
  {
    id: "demo-project-kurpaty",
    workspaceId: DEMO_WORKSPACE.id,
    name: "Kurpaty",
    slug: "kurpaty",
    description: "Resort masterplan.",
    status: "active",
    createdAt: "2026-01-04T00:00:00.000Z",
    updatedAt: "2026-01-04T00:00:00.000Z",
  },
];

function channel(
  id: string,
  projectId: string,
  name: string,
  slug: string,
): Channel {
  return {
    id,
    workspaceId: DEMO_WORKSPACE.id,
    projectId,
    name,
    slug,
    type: "telegram",
    createdAt: "2026-01-05T00:00:00.000Z",
    updatedAt: "2026-01-05T00:00:00.000Z",
  };
}

export const DEMO_CHANNELS: Channel[] = [
  channel("demo-ch-hail-general", "demo-project-hail", "general", "general"),
  channel("demo-ch-hail-arch", "demo-project-hail", "architecture", "architecture"),
  channel("demo-ch-hail-bim", "demo-project-hail", "bim", "bim"),
  channel("demo-ch-hail-client", "demo-project-hail", "client", "client"),
  channel("demo-ch-riyadh-general", "demo-project-riyadh", "general", "general"),
  channel("demo-ch-riyadh-facade", "demo-project-riyadh", "facade", "facade"),
  channel("demo-ch-riyadh-site", "demo-project-riyadh", "site", "site"),
  channel("demo-ch-kurpaty-general", "demo-project-kurpaty", "general", "general"),
];

// A few realistic senders for grouping/avatars.
const SENDERS = {
  bill: { id: "1001", name: "Bill Ahmed" },
  rustam: { id: "1002", name: "Rustam" },
  natalya: { id: "1003", name: "Natalya" },
  me: { id: "9000", name: "You" },
} as const;

function msg(
  id: string,
  channelId: string,
  projectId: string,
  sender: { id: string; name: string },
  text: string,
  minutesAgo: number,
  extra: Partial<Message> = {},
): Message {
  const date = new Date(Date.UTC(2026, 8, 15, 9, 0, 0) - minutesAgo * 60_000).toISOString();
  return {
    id,
    telegramChatId: channelId,
    telegramMessageId: id,
    channelId,
    projectId,
    senderTelegramUserId: sender.id,
    replyToMessageId: null,
    date,
    classification: "normal",
    requiresResponse: false,
    createdAt: date,
    updatedAt: date,
    text,
    entitiesJson: null,
    senderName: sender.name,
    senderAvatarUrl: null,
    ...extra,
  };
}

export const DEMO_MESSAGES: Message[] = [
  msg("m1", "demo-ch-hail-arch", "demo-project-hail", SENDERS.bill,
    "Morning all — revised terminal roof plan is uploaded to the shared drive.", 240),
  msg("m2", "demo-ch-hail-arch", "demo-project-hail", SENDERS.natalya,
    "Thanks Bill. The clerestory detail still clashes with the truss at grid F.", 232),
  msg("m3", "demo-ch-hail-arch", "demo-project-hail", SENDERS.bill,
    "Good catch. Can you mark it up on the BIM model?", 230,
    { replyToMessageId: "m2" }),
  msg("m4", "demo-ch-hail-arch", "demo-project-hail", SENDERS.rustam,
    "Please submit the revised programme by Friday.", 60,
    { classification: "reply", requiresResponse: true }),
  msg("m5", "demo-ch-hail-client", "demo-project-hail", SENDERS.natalya,
    "Client confirmed the material palette for the check-in hall.", 120),
  msg("m6", "demo-ch-riyadh-facade", "demo-project-riyadh", SENDERS.rustam,
    "Facade mock-up approved on site today. Photos coming.", 200),
  msg("m7", "demo-ch-riyadh-site", "demo-project-riyadh", SENDERS.bill,
    "Crane arrives Sunday, access road must be clear by 6am.", 90,
    { classification: "mention", requiresResponse: true }),
  msg("m8", "demo-ch-hail-general", "demo-project-hail", SENDERS.natalya,
    "Weekly coordination call moved to 3pm.", 30),
];

export const DEMO_TASKS: Task[] = [
  {
    id: "demo-task-1",
    workspaceId: DEMO_WORKSPACE.id,
    projectId: "demo-project-hail",
    title: "Submit revised programme",
    description: "Requested by Rustam in #architecture.",
    status: "todo",
    priority: "high",
    assigneeUserId: "demo-user",
    sourceType: "telegram_message",
    sourceMessageId: "m4",
    dueAt: new Date(Date.UTC(2026, 8, 18, 17, 0, 0)).toISOString(),
    createdAt: "2026-09-15T08:00:00.000Z",
    updatedAt: "2026-09-15T08:00:00.000Z",
  },
];

export const DEMO_DM_USERS = [
  { id: "1001", name: "Bill" },
  { id: "1002", name: "Rustam" },
  { id: "1003", name: "Natalya" },
];
