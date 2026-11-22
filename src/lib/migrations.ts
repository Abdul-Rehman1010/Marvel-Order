/**
 * Versioned schema migrations (NEXT_LEVEL_PLAN.md §4.3, package 0.5).
 *
 * `MIGRATIONS` is an ordered list. `migrate(client)` applies the ones that are missing and
 * records each in `schema_migrations(version, applied_at)`. Rules for adding a migration:
 *
 * - Append a new entry with the next version number. Never edit or reorder an entry that may
 *   already have run somewhere: a database records only the version, not what it contained.
 * - Write `ALTER TABLE ... ADD COLUMN` as an `addColumn` step, never as SQL. That step checks
 *   `pragma_table_info` first, so a half-applied database can never wedge start-up.
 * - Use `IF NOT EXISTS` on every `CREATE TABLE` / `CREATE INDEX`.
 * - When a migration adds a table, also clear it in `scripts/reset-users.mjs` and in account deletion.
 *
 * This module never imports `db.ts`, so it can run against any client (tests use temp files).
 */
import type { Client, Transaction } from "@libsql/client";

import { withWriteLock } from "./write-lock";

export type AddColumnStep = {
  kind: "addColumn";
  table: string;
  column: string;
  /** Everything after the column name, e.g. `INTEGER NOT NULL DEFAULT 0`. */
  definition: string;
};

export type MigrationStep = string | AddColumnStep;

export type Migration = {
  version: number;
  name: string;
  steps: MigrationStep[];
};

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "baseline: users, sessions, progress",
    // Today's schema, unchanged. Every statement is IF NOT EXISTS, so on a database created
    // before migrations existed this only records version 1 and touches no data.
    steps: [
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
  },
  {
    version: 2,
    name: "progress.backfilled and the skips table (package 1.3)",
    // `backfilled` marks rows created by catch-up or bulk marking, so pace statistics can ignore
    // them. The pre-1.3 app still works against this schema (the new column has a default), so
    // rolling the app back after this migration is safe.
    steps: [
      { kind: "addColumn", table: "progress", column: "backfilled", definition: "INTEGER NOT NULL DEFAULT 0" },
      `CREATE TABLE IF NOT EXISTS skips (
            user_id TEXT NOT NULL,
            content_id TEXT NOT NULL,
            reason TEXT NOT NULL DEFAULT 'manual',
            skipped_at TEXT NOT NULL,
            PRIMARY KEY (user_id, content_id)
          )`,
    ],
  },
  {
    version: 3,
    name: "rate_limits table (package 1.4)",
    // Fixed-window counters for sign-in and sign-up attempts (src/lib/rate-limit.ts). Holds no user
    // data; `reset_at` is epoch milliseconds.
    steps: ["CREATE TABLE IF NOT EXISTS rate_limits (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL)"],
  },
];

const CREATE_VERSION_TABLE =
  "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)";

export type MigrateOptions = {
  /** Defaults to `MIGRATIONS`. Tests pass their own list to exercise later-style migrations. */
  migrations?: readonly Migration[];
  /** How many times one migration is retried after a lock or race error. */
  maxAttempts?: number;
};

export type MigrateResult = {
  /** Versions this call applied. Empty when another starter (or an earlier start) already had. */
  applied: number[];
  /** Highest version recorded in the database afterwards. */
  current: number;
};

/**
 * Brings the database up to the latest version. Safe to run from several processes at once:
 * the "is it applied?" check happens inside the same write transaction that applies it, so
 * the second starter waits, re-reads, finds the version recorded and does nothing.
 */
export async function migrate(client: Client, options: MigrateOptions = {}): Promise<MigrateResult> {
  const migrations = [...(options.migrations ?? MIGRATIONS)].sort((a, b) => a.version - b.version);
  assertWellFormed(migrations);
  const maxAttempts = options.maxAttempts ?? 10;

  // Fast path for every start after the first: one read, no write lock.
  let recorded = await readRecordedVersions(client);
  if (migrations.every((migration) => recorded.has(migration.version))) {
    return { applied: [], current: highest(recorded) };
  }

  // Local databases: one writer at a time in this process (see write-lock.ts).
  await withRetry(() => withWriteLock(client, () => client.execute(CREATE_VERSION_TABLE)), maxAttempts);

  const applied: number[] = [];
  for (const migration of migrations) {
    if (recorded.has(migration.version)) continue;
    const didApply = await withRetry(() => withWriteLock(client, () => applyIfMissing(client, migration)), maxAttempts);
    if (didApply) applied.push(migration.version);
  }

  recorded = await readRecordedVersions(client);
  return { applied, current: highest(recorded) };
}

/** Opens a write transaction, re-checks the version inside it, applies and records it, commits. */
async function applyIfMissing(client: Client, migration: Migration): Promise<boolean> {
  const tx = await client.transaction("write");
  try {
    const existing = await tx.execute({
      sql: "SELECT 1 FROM schema_migrations WHERE version = ?",
      args: [migration.version],
    });
    if (existing.rows.length > 0) return false; // another starter got here first; `close` rolls back

    for (const step of migration.steps) {
      if (typeof step === "string") await tx.execute(step);
      else await addColumnIfMissing(tx, step);
    }

    await tx.execute({
      sql: "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
      args: [migration.version, new Date().toISOString()],
    });
    await tx.commit();
    return true;
  } finally {
    tx.close(); // no-op after commit, otherwise rolls back
  }
}

async function addColumnIfMissing(tx: Transaction, step: AddColumnStep) {
  assertIdentifier(step.table);
  assertIdentifier(step.column);
  const present = await tx.execute({
    sql: "SELECT 1 FROM pragma_table_info(?) WHERE name = ?",
    args: [step.table, step.column],
  });
  if (present.rows.length > 0) return;
  await tx.execute(`ALTER TABLE ${step.table} ADD COLUMN ${step.column} ${step.definition}`);
}

async function readRecordedVersions(client: Client): Promise<Set<number>> {
  try {
    const result = await client.execute("SELECT version FROM schema_migrations");
    return new Set(result.rows.map((row) => Number(row.version)));
  } catch (error) {
    if (/no such table/i.test(errorText(error))) return new Set();
    throw error;
  }
}

/**
 * Errors that mean "someone else is migrating right now" rather than "this migration is broken".
 * Retrying re-runs `applyIfMissing`, which re-reads the version table inside a fresh transaction.
 */
export function isRetryableMigrationError(error: unknown) {
  return /SQLITE_BUSY|SQLITE_LOCKED|database is locked|database table is locked|duplicate column|already exists/i.test(
    errorText(error),
  );
}

async function withRetry<T>(operation: () => Promise<T>, maxAttempts: number): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryableMigrationError(error)) throw error;
      const backoff = Math.min(1_000, 20 * 2 ** (attempt - 1));
      await sleep(backoff / 2 + Math.random() * backoff);
    }
  }
}

/**
 * Wraps an async setup step so concurrent callers share one run, but a failure is not cached:
 * the next call after a rejection tries again instead of failing until the process restarts.
 */
export function onceUntilFailure<T>(run: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    if (!pending) {
      const attempt = run();
      pending = attempt;
      attempt.catch(() => {
        if (pending === attempt) pending = null;
      });
    }
    return pending;
  };
}

function assertWellFormed(migrations: readonly Migration[]) {
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new Error(`Migration versions must be 1, 2, 3 ... without gaps; found ${migration.version} at position ${index + 1}.`);
    }
  });
}

function assertIdentifier(name: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`Unsafe SQL identifier in migration: ${name}`);
}

function highest(versions: Set<number>) {
  return versions.size ? Math.max(...versions) : 0;
}

function errorText(error: unknown) {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    const cause = (error as { cause?: unknown }).cause;
    return [error.message, typeof code === "string" ? code : "", cause instanceof Error ? cause.message : ""].join(" ");
  }
  return String(error);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
