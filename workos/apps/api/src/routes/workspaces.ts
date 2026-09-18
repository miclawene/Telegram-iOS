import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { schema } from "@workos/database";

import { db } from "../db.js";
import { getMembership } from "../auth/membership.js";

const slugify = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "workspace";

const createBody = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(60).optional(),
});

export const workspaceRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.requireAuth);

  // GET /workspaces — workspaces the current user belongs to.
  app.get("/workspaces", async (req, reply) => {
    const userId = req.user!.id;
    const rows = await db
      .select({
        id: schema.workspaces.id,
        name: schema.workspaces.name,
        slug: schema.workspaces.slug,
        createdBy: schema.workspaces.createdBy,
        createdAt: schema.workspaces.createdAt,
        updatedAt: schema.workspaces.updatedAt,
        role: schema.workspaceMembers.role,
      })
      .from(schema.workspaceMembers)
      .innerJoin(
        schema.workspaces,
        eq(schema.workspaces.id, schema.workspaceMembers.workspaceId),
      )
      .where(eq(schema.workspaceMembers.userId, userId));
    return reply.send({ workspaces: rows });
  });

  // POST /workspaces — create, and make the creator owner.
  app.post("/workspaces", async (req, reply) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });
    const userId = req.user!.id;
    const slug = slugify(parsed.data.slug ?? parsed.data.name);

    const [ws] = await db
      .insert(schema.workspaces)
      .values({ name: parsed.data.name, slug, createdBy: userId })
      .returning();
    if (!ws) return reply.code(500).send({ error: "Failed to create workspace" });

    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId: ws.id, userId, role: "owner" });

    return reply.code(201).send({ workspace: ws });
  });

  // GET /workspaces/:id
  app.get("/workspaces/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const role = await getMembership(req.user!.id, id);
    if (!role) return reply.code(404).send({ error: "Not found" });

    const rows = await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, id))
      .limit(1);
    if (!rows[0]) return reply.code(404).send({ error: "Not found" });
    return reply.send({ workspace: rows[0], role });
  });
};
