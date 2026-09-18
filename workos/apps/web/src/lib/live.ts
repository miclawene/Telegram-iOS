"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";

import type { Channel, Project, Workspace } from "@workos/types";

import { api } from "./api";
import * as demo from "./demo";

// Single source for "what workspace am I looking at". Live mode when the user
// has a session and a workspace on the backend; otherwise the offline demo
// workspace (ТЗ §31 — backend offline ≠ app unusable).

export function useSession() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => api.me(),
    retry: false,
    staleTime: 60_000,
  });
}

export interface WorkspaceData {
  mode: "live" | "demo";
  loading: boolean;
  loggedIn: boolean;
  needsWorkspace: boolean;
  user: { id: string; email: string; name: string } | null;
  workspace: Workspace;
  projects: Project[];
  channels: Channel[];
  channelsForProject: (projectId: string) => Channel[];
  channel: (channelId: string) => Channel | undefined;
  project: (projectId: string) => Project | undefined;
}

export function useWorkspaceData(): WorkspaceData {
  const session = useSession();
  const loggedIn = session.isSuccess && !!session.data?.user;

  const ws = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => api.workspaces(),
    enabled: loggedIn,
  });
  const workspace = ws.data?.workspaces[0] ?? null;

  const projects = useQuery({
    queryKey: ["projects", workspace?.id],
    queryFn: () => api.projects(workspace!.id),
    enabled: !!workspace,
  });
  const channels = useQuery({
    queryKey: ["channels", workspace?.id],
    queryFn: () => api.channels(workspace!.id),
    enabled: !!workspace,
  });

  const live = loggedIn && !!workspace;
  const wsList = live ? workspace : demo.workspace;
  const projectList = live ? (projects.data?.projects ?? []) : demo.projects;
  const channelList = live ? (channels.data?.channels ?? []) : demo.channels;

  return {
    mode: live ? "live" : "demo",
    loading: session.isLoading || (loggedIn && ws.isLoading),
    loggedIn,
    needsWorkspace: loggedIn && ws.isSuccess && !workspace,
    user: session.data?.user ?? null,
    workspace: wsList,
    projects: projectList,
    channels: channelList,
    channelsForProject: (projectId) => channelList.filter((c) => c.projectId === projectId),
    channel: (channelId) => channelList.find((c) => c.id === channelId),
    project: (projectId) => projectList.find((p) => p.id === projectId),
  };
}

/** Invalidate everything workspace-related (after login, import, etc.). */
export function useRefreshWorkspace() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["me"] });
    void qc.invalidateQueries({ queryKey: ["workspaces"] });
    void qc.invalidateQueries({ queryKey: ["projects"] });
    void qc.invalidateQueries({ queryKey: ["channels"] });
  };
}
