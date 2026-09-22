import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Enum values are defined here (not imported from @workos/types) because
// drizzle-kit loads this file through a CJS require hook, and @workos/types
// ships ESM-only exports. Keep these in sync with packages/types/src/enums.ts.
const WORKSPACE_ROLES = ["owner", "admin", "member", "viewer"] as const;
const PROJECT_STATUSES = ["active", "archived"] as const;
const CHANNEL_TYPES = ["telegram", "virtual"] as const;
const TELEGRAM_CHAT_TYPES = ["private", "group", "supergroup", "channel"] as const;
const CHANNEL_SOURCE_TYPES = ["telegram_chat", "telegram_topic", "telegram_filter"] as const;
const TELEGRAM_ACCOUNT_STATUSES = ["pending", "connected", "disconnected", "error"] as const;
const MESSAGE_CLASSIFICATIONS = ["mention", "dm", "reply", "file", "normal"] as const;
const TASK_STATUSES = ["todo", "in_progress", "done", "cancelled"] as const;
const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
const TASK_SOURCE_TYPES = ["telegram_message", "manual"] as const;

// ─── Enums ────────────────────────────────────────────────────────────────────

export const workspaceRoleEnum = pgEnum("workspace_role", WORKSPACE_ROLES);
export const projectStatusEnum = pgEnum("project_status", PROJECT_STATUSES);
export const channelTypeEnum = pgEnum("channel_type", CHANNEL_TYPES);
export const telegramChatTypeEnum = pgEnum("telegram_chat_type", TELEGRAM_CHAT_TYPES);
export const channelSourceTypeEnum = pgEnum("channel_source_type", CHANNEL_SOURCE_TYPES);
export const telegramAccountStatusEnum = pgEnum(
  "telegram_account_status",
  TELEGRAM_ACCOUNT_STATUSES,
);
export const messageClassificationEnum = pgEnum(
  "message_classification",
  MESSAGE_CLASSIFICATIONS,
);
export const taskStatusEnum = pgEnum("task_status", TASK_STATUSES);
export const taskPriorityEnum = pgEnum("task_priority", TASK_PRIORITIES);
export const taskSourceTypeEnum = pgEnum("task_source_type", TASK_SOURCE_TYPES);

// Shared timestamp columns.
const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

// ─── Users ────────────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  // Nullable: demo/passwordless users may have no local credential.
  passwordHash: text("password_hash"),
  ...timestamps,
});

// ─── Sessions (auth) ──────────────────────────────────────────────────────────
// Server-side sessions (ТЗ §32: no localStorage for auth tokens; secure cookies).

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // The cookie carries this opaque token (hashed at rest).
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamps.createdAt,
  },
  (t) => ({
    userIdx: index("sessions_user_idx").on(t.userId),
  }),
);

// ─── Telegram accounts ────────────────────────────────────────────────────────

export const telegramAccounts = pgTable(
  "telegram_accounts",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    telegramUserId: bigint("telegram_user_id", { mode: "bigint" }),
    phone: text("phone"),
    username: text("username"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    // Stored ONLY encrypted (ТЗ §5). Never selected into API DTOs.
    encryptedSession: text("encrypted_session"),
    status: telegramAccountStatusEnum("status").notNull().default("pending"),
    lastConnectedAt: timestamp("last_connected_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    userIdx: index("telegram_accounts_user_idx").on(t.userId),
  }),
);

// ─── Workspaces ───────────────────────────────────────────────────────────────

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  ...timestamps,
});

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: workspaceRoleEnum("role").notNull().default("member"),
    createdAt: timestamps.createdAt,
  },
  (t) => ({
    uniqueMember: uniqueIndex("workspace_members_unique").on(t.workspaceId, t.userId),
    workspaceIdx: index("workspace_members_workspace_idx").on(t.workspaceId),
  }),
);

// ─── Projects ─────────────────────────────────────────────────────────────────

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    status: projectStatusEnum("status").notNull().default("active"),
    ...timestamps,
  },
  (t) => ({
    uniqueSlug: uniqueIndex("projects_workspace_slug_unique").on(t.workspaceId, t.slug),
    workspaceIdx: index("projects_workspace_idx").on(t.workspaceId),
  }),
);

// ─── Channels ─────────────────────────────────────────────────────────────────

export const channels = pgTable(
  "channels",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    type: channelTypeEnum("type").notNull().default("virtual"),
    ...timestamps,
  },
  (t) => ({
    uniqueSlug: uniqueIndex("channels_project_slug_unique").on(t.projectId, t.slug),
    workspaceIdx: index("channels_workspace_idx").on(t.workspaceId),
    projectIdx: index("channels_project_idx").on(t.projectId),
  }),
);

// ─── Telegram chat sources ────────────────────────────────────────────────────

export const telegramChatSources = pgTable(
  "telegram_chat_sources",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    telegramAccountId: uuid("telegram_account_id")
      .notNull()
      .references(() => telegramAccounts.id, { onDelete: "cascade" }),
    telegramChatId: bigint("telegram_chat_id", { mode: "bigint" }).notNull(),
    chatType: telegramChatTypeEnum("chat_type").notNull(),
    title: text("title").notNull(),
    ...timestamps,
  },
  (t) => ({
    uniqueChat: uniqueIndex("telegram_chat_sources_unique").on(
      t.telegramAccountId,
      t.telegramChatId,
    ),
  }),
);

// ─── Channel sources (channel <-> telegram chat, many-to-one) ─────────────────

export const channelSources = pgTable(
  "channel_sources",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    telegramChatSourceId: uuid("telegram_chat_source_id")
      .notNull()
      .references(() => telegramChatSources.id, { onDelete: "cascade" }),
    sourceType: channelSourceTypeEnum("source_type").notNull().default("telegram_chat"),
    createdAt: timestamps.createdAt,
  },
  (t) => ({
    channelIdx: index("channel_sources_channel_idx").on(t.channelId),
  }),
);

// ─── Message metadata + cache ─────────────────────────────────────────────────

export const messageMetadata = pgTable(
  "message_metadata",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    telegramChatId: bigint("telegram_chat_id", { mode: "bigint" }).notNull(),
    telegramMessageId: bigint("telegram_message_id", { mode: "bigint" }).notNull(),
    channelId: uuid("channel_id").references(() => channels.id, {
      onDelete: "set null",
    }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    senderTelegramUserId: bigint("sender_telegram_user_id", { mode: "bigint" }),
    replyToMessageId: bigint("reply_to_message_id", { mode: "bigint" }),
    date: timestamp("date", { withTimezone: true }).notNull(),
    classification: messageClassificationEnum("classification")
      .notNull()
      .default("normal"),
    requiresResponse: boolean("requires_response").notNull().default(false),
    ...timestamps,
  },
  (t) => ({
    uniqueMessage: uniqueIndex("message_metadata_unique").on(
      t.telegramChatId,
      t.telegramMessageId,
    ),
    channelIdx: index("message_metadata_channel_idx").on(t.channelId),
    projectIdx: index("message_metadata_project_idx").on(t.projectId),
  }),
);

export const messageCache = pgTable("message_cache", {
  messageMetadataId: uuid("message_metadata_id")
    .primaryKey()
    .references(() => messageMetadata.id, { onDelete: "cascade" }),
  text: text("text"),
  entitiesJson: jsonb("entities_json"),
  // Generated tsvector column is added via migration for full-text search (ТЗ §21).
  cachedAt: timestamp("cached_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── Tasks ────────────────────────────────────────────────────────────────────

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    description: text("description"),
    status: taskStatusEnum("status").notNull().default("todo"),
    priority: taskPriorityEnum("priority").notNull().default("normal"),
    assigneeUserId: uuid("assignee_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    sourceType: taskSourceTypeEnum("source_type").notNull().default("manual"),
    // References message_metadata; kept as uuid to open the source Telegram message.
    sourceMessageId: uuid("source_message_id").references(() => messageMetadata.id, {
      onDelete: "set null",
    }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    workspaceIdx: index("tasks_workspace_idx").on(t.workspaceId),
    projectIdx: index("tasks_project_idx").on(t.projectId),
    assigneeIdx: index("tasks_assignee_idx").on(t.assigneeUserId),
  }),
);

// ─── Saved items (Save for later) ─────────────────────────────────────────────

export const savedItems = pgTable(
  "saved_items",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    messageMetadataId: uuid("message_metadata_id")
      .notNull()
      .references(() => messageMetadata.id, { onDelete: "cascade" }),
    createdAt: timestamps.createdAt,
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => ({
    uniqueSave: uniqueIndex("saved_items_unique").on(t.userId, t.messageMetadataId),
    userIdx: index("saved_items_user_idx").on(t.userId),
  }),
);

// ─── Files (attachment metadata) ──────────────────────────────────────────────

export const files = pgTable(
  "files",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    channelId: uuid("channel_id").references(() => channels.id, {
      onDelete: "set null",
    }),
    telegramChatId: bigint("telegram_chat_id", { mode: "bigint" }).notNull(),
    telegramMessageId: bigint("telegram_message_id", { mode: "bigint" }).notNull(),
    telegramFileId: text("telegram_file_id").notNull(),
    name: text("name").notNull(),
    mimeType: text("mime_type"),
    size: integer("size"),
    createdAt: timestamps.createdAt,
  },
  (t) => ({
    workspaceIdx: index("files_workspace_idx").on(t.workspaceId),
    projectIdx: index("files_project_idx").on(t.projectId),
  }),
);

// ─── Relations ────────────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(workspaceMembers),
  telegramAccounts: many(telegramAccounts),
}));

export const workspacesRelations = relations(workspaces, ({ many, one }) => ({
  members: many(workspaceMembers),
  projects: many(projects),
  channels: many(channels),
  creator: one(users, {
    fields: [workspaces.createdBy],
    references: [users.id],
  }),
}));

export const projectsRelations = relations(projects, ({ many, one }) => ({
  workspace: one(workspaces, {
    fields: [projects.workspaceId],
    references: [workspaces.id],
  }),
  channels: many(channels),
}));

export const channelsRelations = relations(channels, ({ many, one }) => ({
  workspace: one(workspaces, {
    fields: [channels.workspaceId],
    references: [workspaces.id],
  }),
  project: one(projects, {
    fields: [channels.projectId],
    references: [projects.id],
  }),
  sources: many(channelSources),
}));

export const channelSourcesRelations = relations(channelSources, ({ one }) => ({
  channel: one(channels, {
    fields: [channelSources.channelId],
    references: [channels.id],
  }),
  telegramChatSource: one(telegramChatSources, {
    fields: [channelSources.telegramChatSourceId],
    references: [telegramChatSources.id],
  }),
}));

export const messageMetadataRelations = relations(messageMetadata, ({ one }) => ({
  cache: one(messageCache, {
    fields: [messageMetadata.id],
    references: [messageCache.messageMetadataId],
  }),
  channel: one(channels, {
    fields: [messageMetadata.channelId],
    references: [channels.id],
  }),
}));

export const tasksRelations = relations(tasks, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [tasks.workspaceId],
    references: [workspaces.id],
  }),
  project: one(projects, {
    fields: [tasks.projectId],
    references: [projects.id],
  }),
  sourceMessage: one(messageMetadata, {
    fields: [tasks.sourceMessageId],
    references: [messageMetadata.id],
  }),
}));
