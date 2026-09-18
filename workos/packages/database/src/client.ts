import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema.js";

export type Database = ReturnType<typeof createDatabase>;

let singleton: Database | null = null;

export function createDatabase(url: string) {
  const client = postgres(url, {
    max: 10,
    idle_timeout: 20,
    // bigint columns come back as strings by default with mode:"bigint" in schema.
  });
  return drizzle(client, { schema });
}

/** Lazily-initialized shared connection using DATABASE_URL. */
export function getDatabase(url = process.env.DATABASE_URL): Database {
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  if (!singleton) {
    singleton = createDatabase(url);
  }
  return singleton;
}
