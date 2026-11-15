import "server-only";

import { createClient } from "@libsql/client";

import { migrate, onceUntilFailure } from "@/lib/migrations";

const databaseUrl = process.env.TURSO_DATABASE_URL ?? "file:marvel-vault.db";
const databaseAuthToken =
  process.env.TURSO_AUTH_TOKEN ?? process.env.TURSO_DATABASE_TURSO_AUTH_TOKEN;

export const db = createClient({
  url: databaseUrl,
  authToken: databaseAuthToken,
});

/**
 * Brings the schema up to date (see `src/lib/migrations.ts`). Concurrent callers in one process
 * share a single run; if it fails, the next request tries again rather than failing until restart.
 */
const runMigrations = onceUntilFailure(async () => {
  await migrate(db);
});

export function ensureDatabase(): Promise<void> {
  return runMigrations();
}

export function databaseMode() {
  return databaseUrl.startsWith("file:") ? "LOCAL VAULT" : "SYNCED VAULT";
}
