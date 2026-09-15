import type { Config } from "drizzle-kit";

export default {
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://workos:workos@localhost:5432/workos",
  },
  strict: true,
  verbose: true,
} satisfies Config;
