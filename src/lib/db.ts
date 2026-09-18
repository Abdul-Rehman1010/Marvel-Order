import "server-only";

import { createClient } from "@libsql/client";

const databaseUrl = process.env.TURSO_DATABASE_URL ?? "file:marvel-vault.db";

export const db = createClient({
  url: databaseUrl,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

let setupPromise: Promise<void> | null = null;

export function ensureDatabase() {
  if (!setupPromise) {
    setupPromise = (async () => {
      await db.batch(
        [
          `CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            username_key TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL
          )`,
          `CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL
          )`,
          `CREATE TABLE IF NOT EXISTS progress (
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            content_id TEXT NOT NULL,
            episode INTEGER NOT NULL DEFAULT -1,
            watched_at TEXT NOT NULL,
            PRIMARY KEY (user_id, content_id, episode)
          )`,
          "CREATE INDEX IF NOT EXISTS progress_user_idx ON progress(user_id)",
          "CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id)",
        ],
        "write",
      );
    })();
  }
  return setupPromise;
}

export function databaseMode() {
  return databaseUrl.startsWith("file:") ? "LOCAL VAULT" : "SYNCED VAULT";
}

