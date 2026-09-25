import { sql } from "drizzle-orm";

import { db } from "./db.js";
import { logger } from "./logger.js";

// Idempotent schema guards applied at startup. drizzle-kit push proved
// unreliable for incremental column adds on Railway, so columns added after the
// initial table creation are ensured here with ADD COLUMN IF NOT EXISTS. Each
// statement is safe to run repeatedly.
const STATEMENTS = [
  sql`ALTER TABLE "channel_sources" ADD COLUMN IF NOT EXISTS "telegram_topic_id" bigint`,
];

export async function ensureSchema(): Promise<void> {
  for (const stmt of STATEMENTS) {
    await db.execute(stmt);
  }
  logger.info("Schema guards applied");
}
