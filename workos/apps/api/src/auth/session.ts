import { and, eq, gt } from "drizzle-orm";

import { schema } from "@workos/database";

import { db } from "../db.js";
import {
  generateSessionToken,
  hashSessionToken,
  SESSION_TTL_MS,
} from "./tokens.js";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

/** Create a DB-backed session; returns the raw token for the cookie. */
export async function createSession(userId: string): Promise<string> {
  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(schema.sessions).values({ userId, tokenHash, expiresAt });
  return token;
}

/** Resolve a raw cookie token to a user, or null if invalid/expired. */
export async function resolveSession(token: string): Promise<AuthUser | null> {
  const tokenHash = hashSessionToken(token);
  const rows = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      avatarUrl: schema.users.avatarUrl,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(
      and(
        eq(schema.sessions.tokenHash, tokenHash),
        gt(schema.sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function destroySession(token: string): Promise<void> {
  const tokenHash = hashSessionToken(token);
  await db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, tokenHash));
}
