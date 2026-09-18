import { getDatabase } from "@workos/database";

import { env } from "./env.js";

export const db = getDatabase(env.DATABASE_URL);
