/**
 * Migration framework (NEXT_LEVEL_PLAN.md package 0.5). Every test uses its own temp FILE
 * database under `.tmp/test-dbs/` (never `:memory:`, whose single connection rejects other
 * statements while a transaction is open, and never `marvel-vault.db`).
 */
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

import { createClient, type Client } from "@libsql/client";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import {
  MIGRATIONS,
  isRetryableMigrationError,
  migrate,
  onceUntilFailure,
  type Migration,
} from "@/lib/migrations";

const DB_DIR = path.join(process.cwd(), ".tmp", "test-dbs");
mkdirSync(DB_DIR, { recursive: true });
// Remove files an earlier run could not delete (see afterAll), now that their process has exited.
for (const stale of readdirSync(DB_DIR)) removeQuietly(path.join(DB_DIR, stale));

/**
 * Best-effort delete. On Windows SQLite may keep a closed database's file handle until the
 * last prepared statement is garbage-collected, so an immediate delete can fail with EPERM.
 * Such a file is removed at the start of the next run instead.
 */
function removeQuietly(file: string) {
  try {
    rmSync(file, { force: true });
  } catch {
    // still held open by this process; the next run removes it
  }
}

const openClients: Client[] = [];
const createdFiles: string[] = [];

function newDatabaseUrl() {
  const name = `migrations-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.db`;
  createdFiles.push(path.join(DB_DIR, name));
  return `file:.tmp/test-dbs/${name}`;
}

function open(url: string) {
  const client = createClient({ url });
  openClients.push(client);
  return client;
}

afterEach(() => {
  for (const client of openClients.splice(0)) client.close();
  vi.unstubAllEnvs();
  vi.resetModules();
});

afterAll(() => {
  for (const file of createdFiles) {
    for (const suffix of ["", "-journal", "-wal", "-shm"]) removeQuietly(`${file}${suffix}`);
  }
});

/**
 * A literal copy of the schema `ensureDatabase()` created before migrations existed
 * (src/lib/db.ts at commit ae0a3a7). This is the shape of every database in use today,
 * including the owner's local `marvel-vault.db` and the production Turso database.
 */
const LEGACY_SCHEMA = [
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
];

async function createLegacyDatabaseWithData(client: Client) {
  await client.batch(LEGACY_SCHEMA, "write");
  await client.batch(
    [
      "INSERT INTO users VALUES ('u1', 'Watcher_616', 'watcher_616', '$2b$12$abcdefghijklmnopqrstuuJ1kV9mXr0o7m0Yq1v8Y2h3Qe0hQ1x2', '2026-10-01T10:00:00.000Z')",
      "INSERT INTO users VALUES ('u2', 'peggy', 'peggy', '$2b$12$zyxwvutsrqponmlkjihgfeO2mN4bC5dE6fG7hI8jK9lM0nO1pQ2r3', '2026-10-02T11:30:00.000Z')",
      "INSERT INTO sessions VALUES ('hash-a', 'u1', '2026-12-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z')",
      "INSERT INTO sessions VALUES ('hash-b', 'u2', '2026-12-02T00:00:00.000Z', '2026-11-02T00:00:00.000Z')",
      "INSERT INTO progress VALUES ('u1', 'iron-man', -1, '2026-10-01T20:00:00.000Z')",
      "INSERT INTO progress VALUES ('u1', 'incredible-hulk', -1, '2026-10-02T20:00:00.000Z')",
      "INSERT INTO progress VALUES ('u1', 'defenders-daredevil-1', 1, '2026-10-03T20:00:00.000Z')",
      "INSERT INTO progress VALUES ('u1', 'defenders-daredevil-1', 2, '2026-10-03T21:00:00.000Z')",
      "INSERT INTO progress VALUES ('u2', 'xmen-2000', -1, '2026-10-04T20:00:00.000Z')",
      // A row the catalogue may not know any more must survive untouched as well.
      "INSERT INTO progress VALUES ('u2', 'removed-title', -1, '2026-10-05T20:00:00.000Z')",
    ],
    "write",
  );
}

/** Every row of the three data tables, in a stable order, as plain JSON. */
async function dumpData(client: Client) {
  const dump: Record<string, unknown[]> = {};
  for (const [table, order] of [
    ["users", "id"],
    ["sessions", "token_hash"],
    ["progress", "user_id, content_id, episode"],
  ] as const) {
    const result = await client.execute(`SELECT * FROM ${table} ORDER BY ${order}`);
    dump[table] = result.rows.map((row) => ({ ...row }));
  }
  return JSON.parse(JSON.stringify(dump));
}

async function schemaObjects(client: Client) {
  const result = await client.execute(
    "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
  );
  return result.rows.map((row) => ({ type: String(row.type), name: String(row.name), sql: row.sql === null ? null : String(row.sql) }));
}

async function recordedVersions(client: Client) {
  const result = await client.execute("SELECT version, applied_at FROM schema_migrations ORDER BY version");
  return result.rows.map((row) => ({ version: Number(row.version), appliedAt: String(row.applied_at) }));
}

async function columnsOf(client: Client, table: string) {
  const result = await client.execute({ sql: "SELECT name FROM pragma_table_info(?)", args: [table] });
  return result.rows.map((row) => String(row.name));
}

/**
 * The later migrations exactly as §4.3 of the plan defines them (versions 2-4). They shipped in
 * packages 1.3, 1.4 and 1.5; a test below checks the real ones create the same columns. Here they exercise `addColumn`
 * steps and new tables against a database made by the pre-migration app.
 */
const PLANNED_2_TO_4: Migration[] = [
  {
    version: 2,
    name: "backfilled flag and skips",
    steps: [
      { kind: "addColumn", table: "progress", column: "backfilled", definition: "INTEGER NOT NULL DEFAULT 0" },
      "CREATE TABLE IF NOT EXISTS skips (user_id TEXT NOT NULL, content_id TEXT NOT NULL, reason TEXT NOT NULL DEFAULT 'manual', skipped_at TEXT NOT NULL, PRIMARY KEY (user_id, content_id))",
    ],
  },
  {
    version: 3,
    name: "rate limits",
    steps: ["CREATE TABLE IF NOT EXISTS rate_limits (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL)"],
  },
  {
    version: 4,
    name: "recovery code and prefs",
    steps: [
      { kind: "addColumn", table: "users", column: "recovery_hash", definition: "TEXT" },
      { kind: "addColumn", table: "users", column: "prefs", definition: "TEXT NOT NULL DEFAULT '{}'" },
    ],
  },
];
/** Version 1 only: what a database looked like before any later migration. */
const BASELINE = MIGRATIONS.slice(0, 1);
const WITH_PLANNED = [...BASELINE, ...PLANNED_2_TO_4];
const LATEST = MIGRATIONS.length;
const ALL_VERSIONS = MIGRATIONS.map((migration) => migration.version);

/** `after` cut down to the columns `before` had, so new columns do not hide a changed old value. */
function originalColumns(before: Record<string, unknown[]>, after: Record<string, unknown[]>) {
  return Object.fromEntries(
    Object.entries(after).map(([table, rows]) => {
      const keys = Object.keys((before[table]?.[0] ?? {}) as object);
      return [table, rows.map((row) => Object.fromEntries(keys.map((key) => [key, (row as Record<string, unknown>)[key]])))];
    }),
  );
}

describe("migrate", () => {
  it("brings a fresh database to the latest version", async () => {
    const client = open(newDatabaseUrl());
    const result = await migrate(client);

    expect(result).toEqual({ applied: ALL_VERSIONS, current: LATEST });
    expect(ALL_VERSIONS).toEqual([1, 2, 3, 4]);
    expect((await recordedVersions(client)).map((row) => row.version)).toEqual([1, 2, 3, 4]);
    expect((await schemaObjects(client)).map(({ type, name }) => `${type}:${name}`)).toEqual([
      "index:progress_user_idx",
      "index:sessions_user_idx",
      "table:progress",
      "table:rate_limits",
      "table:schema_migrations",
      "table:sessions",
      "table:skips",
      "table:users",
    ]);
  });

  it("versions 2 to 4 as shipped create the same columns as the plan's definitions", async () => {
    const shipped = open(newDatabaseUrl());
    await migrate(shipped);
    const planned = open(newDatabaseUrl());
    await migrate(planned, { migrations: WITH_PLANNED });

    for (const table of ["users", "progress", "skips", "rate_limits"]) {
      const describeTable = async (client: Client) =>
        (await client.execute({ sql: "SELECT name, type, dflt_value, pk FROM pragma_table_info(?)", args: [table] })).rows.map((row) => ({ ...row }));
      expect(await describeTable(shipped), table).toEqual(await describeTable(planned));
    }
  });

  it("creates exactly the schema the app used before migrations existed", async () => {
    const legacy = open(newDatabaseUrl());
    await legacy.batch(LEGACY_SCHEMA, "write");
    const migrated = open(newDatabaseUrl());
    await migrate(migrated, { migrations: BASELINE });

    const withoutVersionTable = (await schemaObjects(migrated)).filter((object) => object.name !== "schema_migrations");
    expect(withoutVersionTable).toEqual(await schemaObjects(legacy));
  });

  it("version 1 on a database created by the pre-migration app changes no data and no schema", async () => {
    const client = open(newDatabaseUrl());
    await createLegacyDatabaseWithData(client);
    const dataBefore = await dumpData(client);
    const schemaBefore = await schemaObjects(client);

    const result = await migrate(client, { migrations: BASELINE });

    expect(result).toEqual({ applied: [1], current: 1 });
    expect(await dumpData(client)).toEqual(dataBefore);
    expect((await schemaObjects(client)).filter((object) => object.name !== "schema_migrations")).toEqual(schemaBefore);
  });

  it("the shipped migrations upgrade a pre-migration database: every old value is unchanged, new columns get defaults", async () => {
    const client = open(newDatabaseUrl());
    await createLegacyDatabaseWithData(client);
    const dataBefore = await dumpData(client);

    expect(await migrate(client)).toEqual({ applied: ALL_VERSIONS, current: LATEST });

    const dataAfter = await dumpData(client);
    expect(originalColumns(dataBefore, dataAfter)).toEqual(dataBefore);
    expect(dataAfter.progress.every((row: Record<string, unknown>) => row.backfilled === 0)).toBe(true);
    expect(await columnsOf(client, "skips")).toEqual(["user_id", "content_id", "reason", "skipped_at"]);
    expect((await client.execute("SELECT COUNT(*) AS n FROM skips")).rows[0].n).toBe(0);
  });

  it("is a no-op the second time, and does not even take the write lock", async () => {
    const client = open(newDatabaseUrl());
    await createLegacyDatabaseWithData(client);
    await migrate(client);
    const versionsAfterFirst = await recordedVersions(client);
    const dataAfterFirst = await dumpData(client);

    const executeSpy = vi.spyOn(client, "execute");
    const transactionSpy = vi.spyOn(client, "transaction");
    const second = await migrate(client);

    expect(second).toEqual({ applied: [], current: LATEST });
    expect(transactionSpy).not.toHaveBeenCalled();
    expect(executeSpy).toHaveBeenCalledTimes(1); // the single read of schema_migrations
    expect(await recordedVersions(client)).toEqual(versionsAfterFirst);
    expect(await dumpData(client)).toEqual(dataAfterFirst);
  });

  it("applies later migrations to today's data: old columns and rows unchanged, new columns get defaults", async () => {
    const client = open(newDatabaseUrl());
    await createLegacyDatabaseWithData(client);
    const before = await dumpData(client);

    expect(await migrate(client, { migrations: WITH_PLANNED })).toEqual({ applied: [1, 2, 3, 4], current: 4 });

    const after = await dumpData(client);
    const project = (rows: unknown[], keys: string[]) =>
      rows.map((row) => Object.fromEntries(keys.map((key) => [key, (row as Record<string, unknown>)[key]])));
    for (const table of ["users", "sessions", "progress"] as const) {
      const originalKeys = Object.keys((before[table][0] ?? {}) as object);
      expect(project(after[table], originalKeys), table).toEqual(before[table]);
    }
    expect(after.progress.every((row: Record<string, unknown>) => row.backfilled === 0)).toBe(true);
    expect(after.users.every((row: Record<string, unknown>) => row.recovery_hash === null && row.prefs === "{}")).toBe(true);
    expect(await columnsOf(client, "skips")).toEqual(["user_id", "content_id", "reason", "skipped_at"]);
    expect(await columnsOf(client, "rate_limits")).toEqual(["bucket", "count", "reset_at"]);

    // Today's queries still work against the migrated schema, so rolling the app back is safe.
    const legacyRead = await client.execute({
      sql: "SELECT content_id, episode FROM progress WHERE user_id = ? ORDER BY watched_at ASC",
      args: ["u1"],
    });
    expect(legacyRead.rows).toHaveLength(4);
    await client.execute({
      sql: "INSERT INTO progress (user_id, content_id, episode, watched_at) VALUES (?, ?, ?, ?)",
      args: ["u1", "iron-man-2", -1, "2026-11-15T00:00:00.000Z"],
    });
  });

  it("finishes a half-applied database: a column that already exists is not added twice", async () => {
    const client = open(newDatabaseUrl());
    await createLegacyDatabaseWithData(client);
    await migrate(client, { migrations: BASELINE });
    // Simulate a crash after the ALTER ran but before version 2 was recorded (or a hand-made fix).
    await client.execute("ALTER TABLE progress ADD COLUMN backfilled INTEGER NOT NULL DEFAULT 0");

    expect(await migrate(client, { migrations: WITH_PLANNED })).toEqual({ applied: [2, 3, 4], current: 4 });
    expect((await columnsOf(client, "progress")).filter((name) => name === "backfilled")).toHaveLength(1);
  });

  it("rolls a failing migration back completely and does not record it; a fixed migration then applies", async () => {
    const client = open(newDatabaseUrl());
    await migrate(client, { migrations: BASELINE });
    const broken: Migration = {
      version: 2,
      name: "broken",
      steps: [
        "CREATE TABLE IF NOT EXISTS half_done (id TEXT PRIMARY KEY)",
        { kind: "addColumn", table: "progress", column: "backfilled", definition: "INTEGER NOT NULL DEFAULT 0" },
        "THIS IS NOT SQL",
      ],
    };

    await expect(migrate(client, { migrations: [...BASELINE, broken] })).rejects.toThrow();
    expect((await recordedVersions(client)).map((row) => row.version)).toEqual([1]);
    expect((await schemaObjects(client)).some((object) => object.name === "half_done")).toBe(false);
    expect(await columnsOf(client, "progress")).not.toContain("backfilled");

    expect(await migrate(client, { migrations: WITH_PLANNED })).toEqual({ applied: [2, 3, 4], current: 4 });
  });

  it("refuses a migration list with a gap or a duplicate version", async () => {
    const client = open(newDatabaseUrl());
    await expect(migrate(client, { migrations: [...BASELINE, { ...PLANNED_2_TO_4[1] }] })).rejects.toThrow(/without gaps/);
    await expect(migrate(client, { migrations: [...BASELINE, { ...BASELINE[0] }] })).rejects.toThrow(/without gaps/);
  });

  it("rejects an unsafe identifier in an addColumn step", async () => {
    const client = open(newDatabaseUrl());
    const hostile: Migration = {
      version: 2,
      name: "hostile",
      steps: [{ kind: "addColumn", table: "progress; DROP TABLE users", column: "x", definition: "TEXT" }],
    };
    await expect(migrate(client, { migrations: [...BASELINE, hostile] })).rejects.toThrow(/Unsafe SQL identifier/);
    expect(await columnsOf(client, "users")).toContain("id");
  });
});

describe("two servers starting at once", () => {
  it("ensureDatabase() from two separate server instances on one file: both succeed, each version recorded once", async () => {
    const url = newDatabaseUrl();
    const seed = open(url);
    await createLegacyDatabaseWithData(seed);
    const dataBefore = await dumpData(seed);

    // Two independent copies of the db module = two clients = two cold-started servers.
    vi.stubEnv("TURSO_DATABASE_URL", url);
    vi.resetModules();
    const serverA = await import("@/lib/db");
    vi.resetModules();
    const serverB = await import("@/lib/db");
    openClients.push(serverA.db, serverB.db);
    expect(serverA.db).not.toBe(serverB.db);

    await expect(Promise.all([serverA.ensureDatabase(), serverB.ensureDatabase()])).resolves.toEqual([undefined, undefined]);

    expect((await recordedVersions(seed)).map((row) => row.version)).toEqual(ALL_VERSIONS);
    expect(originalColumns(dataBefore, await dumpData(seed))).toEqual(dataBefore);
  });

  it("many clients racing through later-style migrations: every call succeeds and each version is recorded once", async () => {
    for (let round = 0; round < 5; round += 1) {
      const url = newDatabaseUrl();
      const seed = open(url);
      await createLegacyDatabaseWithData(seed);
      const starters = Array.from({ length: 4 }, () => open(url));

      const results = await Promise.all(starters.map((client) => migrate(client, { migrations: WITH_PLANNED })));

      expect(results.every((result) => result.current === 4), `round ${round}`).toBe(true);
      const appliedEverywhere = results.flatMap((result) => result.applied).sort();
      expect(appliedEverywhere, `round ${round}: each version applied by exactly one starter`).toEqual([1, 2, 3, 4]);
      expect((await recordedVersions(seed)).map((row) => row.version)).toEqual([1, 2, 3, 4]);
      expect((await columnsOf(seed, "users")).filter((name) => name === "prefs")).toHaveLength(1);
    }
  });
});

describe("onceUntilFailure (the ensureDatabase guard)", () => {
  it("shares one run between concurrent callers and caches success", async () => {
    const run = vi.fn(async () => "ready");
    const ensure = onceUntilFailure(run);
    await expect(Promise.all([ensure(), ensure(), ensure()])).resolves.toEqual(["ready", "ready", "ready"]);
    await ensure();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failure: the next call tries again", async () => {
    const run = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("Turso unreachable"))
      .mockResolvedValue("ready");
    const ensure = onceUntilFailure(run);

    await expect(ensure()).rejects.toThrow("Turso unreachable");
    await expect(ensure()).resolves.toBe("ready");
    await expect(ensure()).resolves.toBe("ready");
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe("isRetryableMigrationError", () => {
  it.each([
    ["SQLITE_BUSY: database is locked"],
    ["database is locked"],
    ["SQLITE_LOCKED: database table is locked"],
    ["SQLITE_ERROR: duplicate column name: backfilled"],
    ["table skips already exists"],
  ])("retries %s", (message) => {
    expect(isRetryableMigrationError(new Error(message))).toBe(true);
  });

  it("uses the libSQL error code as well as the message", () => {
    expect(isRetryableMigrationError(Object.assign(new Error("busy"), { code: "SQLITE_BUSY" }))).toBe(true);
  });

  it.each([["SQLITE_ERROR: near \"THIS\": syntax error"], ["no such table: progress"], ["SQLITE_AUTH: not authorized"]])(
    "does not retry %s",
    (message) => {
      expect(isRetryableMigrationError(new Error(message))).toBe(false);
    },
  );
});
