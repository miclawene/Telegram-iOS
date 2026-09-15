import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { schema } from "@workos/database";

import { db } from "../db.js";
import { getMembership, roleAtLeast } from "../auth/membership.js";

const slugify = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "project";

const createBody = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
});

const updateBody = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  status: z.enum(["active", "archived"]).optional(),
});

export const projectRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.requireAuth);

  // GET /projects?workspaceId=...
  app.get("/projects", async (req, reply) => {
    const q = z
      .object({ workspaceId: z.string().uuid() })
      .safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "workspaceId is required" });

    const role = await getMembership(req.user!.id, q.data.workspaceId);
    if (!role) return reply.code(403).send({ error: "Forbidden" });

    const rows = await db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.workspaceId, q.data.workspaceId));
    return reply.send({ projects: rows });
  });

  // POST /projects
  app.post("/projects", async (req, reply) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });

    const role = await getMembership(req.user!.id, parsed.data.workspaceId);
    if (!role || !roleAtLeast(role, "member")) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    const [project] = await db
      .insert(schema.projects)
      .values({
        workspaceId: parsed.data.workspaceId,
        name: parsed.data.name,
        slug: slugify(parsed.data.name),
        description: parsed.data.description ?? null,
      })
      .returning();
    return reply.code(201).send({ project });
  });

  // GET /projects/:id
  app.get("/projects/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const rows = await db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, id))
      .limit(1);
    const project = rows[0];
    if (!project) return reply.code(404).send({ error: "Not found" });

    const role = await getMembership(req.user!.id, project.workspaceId);
    if (!role) return reply.code(404).send({ error: "Not found" });
    return reply.send({ project });
  });

  // PATCH /projects/:id
  app.patch("/projects/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = updateBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });

    const rows = await db
      .select({ workspaceId: schema.projects.workspaceId })
      .from(schema.projects)
      .where(eq(schema.projects.id, id))
      .limit(1);
    if (!rows[0]) return reply.code(404).send({ error: "Not found" });

    const role = await getMembership(req.user!.id, rows[0].workspaceId);
    if (!role || !roleAtLeast(role, "member")) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    const [project] = await db
      .update(schema.projects)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(schema.projects.id, id))
      .returning();
    return reply.send({ project });
  });
};
