import { and, eq } from "drizzle-orm";

import { schema } from "@workos/database";
import type { WorkspaceRole } from "@workos/types";

import { db } from "../db.js";

/** Returns the user's role in the workspace, or null if not a member. */
export async function getMembership(
  userId: string,
  workspaceId: string,
): Promise<WorkspaceRole | null> {
  const rows = await db
    .select({ role: schema.workspaceMembers.role })
    .from(schema.workspaceMembers)
    .where(
      and(
        eq(schema.workspaceMembers.userId, userId),
        eq(schema.workspaceMembers.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  return rows[0]?.role ?? null;
}

const ROLE_RANK: Record<WorkspaceRole, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

export function roleAtLeast(role: WorkspaceRole, min: WorkspaceRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}
