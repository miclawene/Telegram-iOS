"use client";

import { openDB, type DBSchema, type IDBPDatabase } from "idb";

// Local cache (ТЗ §31): channels, recent messages, projects, user settings.
// Enables fast reload and offline display of previously-loaded data (ТЗ §30).

interface WorkOSDB extends DBSchema {
  projects: { key: string; value: unknown };
  channels: { key: string; value: unknown };
  messages: { key: string; value: unknown; indexes: { byChannel: string } };
  settings: { key: string; value: unknown };
}

type StoreName = "projects" | "channels" | "messages" | "settings";

let dbPromise: Promise<IDBPDatabase<WorkOSDB>> | null = null;

function getDB() {
  if (typeof indexedDB === "undefined") return null;
  if (!dbPromise) {
    dbPromise = openDB<WorkOSDB>("workos", 1, {
      upgrade(db) {
        db.createObjectStore("projects");
        db.createObjectStore("channels");
        const messages = db.createObjectStore("messages");
        messages.createIndex("byChannel", "channelId" as never);
        db.createObjectStore("settings");
      },
    });
  }
  return dbPromise;
}

export async function cachePut(
  store: StoreName,
  key: string,
  value: unknown,
): Promise<void> {
  const db = await getDB();
  if (!db) return;
  try {
    await db.put(store, value as never, key);
  } catch {
    /* offline / private mode — non-fatal */
  }
}

export async function cacheGet<T>(
  store: StoreName,
  key: string,
): Promise<T | undefined> {
  const db = await getDB();
  if (!db) return undefined;
  try {
    return (await db.get(store, key)) as T | undefined;
  } catch {
    return undefined;
  }
}
