import { sql } from "drizzle-orm";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

import {
  DEMO_CHANNELS,
  DEMO_PROJECTS,
  DEMO_WORKSPACE,
} from "@workos/types";

import * as schema from "./schema.js";

// Seeds a demo workspace + projects + channels (ТЗ §38) so the UI is usable
// without a Telegram login. Idempotent: safe to run repeatedly.
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const client = postgres(url, { max: 1 });
  const db = drizzle(client, { schema });

  console.log("Seeding demo data...");

  // Demo user (owner of the demo workspace).
  const [user] = await db
    .insert(schema.users)
    .values({
      email: "demo@workos.local",
      name: "Demo User",
    })
    .onConflictDoUpdate({
      target: schema.users.email,
      set: { name: "Demo User" },
    })
    .returning();

  if (!user) throw new Error("Failed to create demo user");

  // Workspace.
  const [ws] = await db
    .insert(schema.workspaces)
    .values({
      name: DEMO_WORKSPACE.name,
      slug: DEMO_WORKSPACE.slug,
      createdBy: user.id,
    })
    .onConflictDoUpdate({
      target: schema.workspaces.slug,
      set: { name: DEMO_WORKSPACE.name },
    })
    .returning();

  if (!ws) throw new Error("Failed to create demo workspace");

  await db
    .insert(schema.workspaceMembers)
    .values({ workspaceId: ws.id, userId: user.id, role: "owner" })
    .onConflictDoNothing();

  // Projects (keyed by slug within workspace).
  const projectIdBySlug = new Map<string, string>();
  for (const p of DEMO_PROJECTS) {
    const [row] = await db
      .insert(schema.projects)
      .values({
        workspaceId: ws.id,
        name: p.name,
        slug: p.slug,
        description: p.description,
        status: p.status,
      })
      .onConflictDoUpdate({
        target: [schema.projects.workspaceId, schema.projects.slug],
        set: { name: p.name, description: p.description },
      })
      .returning();
    if (row) projectIdBySlug.set(p.slug, row.id);
  }

  // Channels (map demo projectId -> real project id via slug).
  const demoProjectSlugById = new Map(DEMO_PROJECTS.map((p) => [p.id, p.slug]));
  for (const c of DEMO_CHANNELS) {
    const slug = c.projectId ? demoProjectSlugById.get(c.projectId) : undefined;
    const realProjectId = slug ? projectIdBySlug.get(slug) : null;
    await db
      .insert(schema.channels)
      .values({
        workspaceId: ws.id,
        projectId: realProjectId ?? null,
        name: c.name,
        slug: c.slug,
        type: "virtual", // demo channels have no real Telegram source
      })
      .onConflictDoNothing();
  }

  const projectCount = await db.execute(
    sql`SELECT count(*)::int AS n FROM projects WHERE workspace_id = ${ws.id}`,
  );
  console.log(`Seed complete. Workspace "${ws.name}" with ${projectCount[0]?.n} projects.`);

  await client.end();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
