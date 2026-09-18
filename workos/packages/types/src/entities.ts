// Core domain entity shapes (API-facing DTOs). These are the normalized shapes
// the frontend consumes — Telegram terminology is deliberately hidden.

import type {
  ChannelSourceType,
  ChannelType,
  MessageClassification,
  ProjectStatus,
  TaskPriority,
  TaskStatus,
  TaskSourceType,
  TelegramAccountStatus,
  TelegramChatType,
  WorkspaceRole,
} from "./enums.js";

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceMember {
  id: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  createdAt: string;
}

export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  description: string | null;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Channel {
  id: string;
  workspaceId: string;
  projectId: string | null;
  name: string;
  slug: string;
  type: ChannelType;
  createdAt: string;
  updatedAt: string;
}

export interface TelegramAccount {
  id: string;
  userId: string;
  telegramUserId: string | null;
  phone: string | null;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  status: TelegramAccountStatus;
  lastConnectedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // NOTE: encryptedSession is intentionally never part of any API DTO.
}

export interface TelegramChatSource {
  id: string;
  telegramAccountId: string;
  telegramChatId: string;
  chatType: TelegramChatType;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelSource {
  id: string;
  channelId: string;
  telegramChatSourceId: string;
  sourceType: ChannelSourceType;
  createdAt: string;
}

export interface MessageMetadata {
  id: string;
  telegramChatId: string;
  telegramMessageId: string;
  channelId: string | null;
  projectId: string | null;
  senderTelegramUserId: string | null;
  replyToMessageId: string | null;
  date: string;
  classification: MessageClassification;
  requiresResponse: boolean;
  createdAt: string;
  updatedAt: string;
}

// A message as delivered to the frontend: metadata + cached text/sender.
export interface Message extends MessageMetadata {
  text: string | null;
  entitiesJson: unknown | null;
  senderName: string | null;
  senderAvatarUrl: string | null;
}

export interface Task {
  id: string;
  workspaceId: string;
  projectId: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeUserId: string | null;
  sourceType: TaskSourceType;
  sourceMessageId: string | null;
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SavedItem {
  id: string;
  userId: string;
  messageMetadataId: string;
  createdAt: string;
  completedAt: string | null;
}

export interface FileEntity {
  id: string;
  workspaceId: string;
  projectId: string | null;
  channelId: string | null;
  telegramChatId: string;
  telegramMessageId: string;
  telegramFileId: string;
  name: string;
  mimeType: string | null;
  size: number | null;
  createdAt: string;
}
