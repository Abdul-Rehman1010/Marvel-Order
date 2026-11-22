/**
 * Progress persistence and `/api/progress` (NEXT_LEVEL_PLAN.md package 1.3, §4.5 and the
 * §4.7 "Persistence" and "Unrecognised rows" rows). Every test uses its own temp FILE database
 * under `.tmp/test-dbs-progress/`, never `marvel-vault.db`.
 *
 * The first block is one regression test per bug the pre-1.3 code had (numbered as in the plan).
 */
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

import { createClient, type Client, type InStatement, type Transaction, type TransactionMode } from "@libsql/client";
import { NextRequest } from "next/server";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { MCU_CONTENT } from "@/lib/content";
import { dependents } from "@/lib/engine/graph";
import type { Action } from "@/lib/engine/reducer";
import { releaseMoment } from "@/lib/engine/release";
import { indexOf, lockReason, outOfOrderTitles, type ViewingState } from "@/lib/engine/state";
import { getStats } from "@/lib/engine/stats";
import { migrate } from "@/lib/migrations";
import { applyActionWithClient, readViewingState, type ApplyOptions } from "@/lib/progress-store";

import { NOW, WATCHABLE_IDS, item, keysOf, requiredThrough, titlesWithRows } from "../helpers/viewing";

const DB_DIR = path.join(process.cwd(), ".tmp", "test-dbs-progress");
mkdirSync(DB_DIR, { recursive: true });
for (const stale of readdirSync(DB_DIR)) removeQuietly(path.join(DB_DIR, stale));

/** Best-effort delete: on Windows SQLite can keep a closed file open until garbage collection. */
function removeQuietly(file: string) {
  try {
    rmSync(file, { force: true });
  } catch {
    // removed at the start of the next run instead
  }
}

const openClients: Client[] = [];
const createdFiles: string[] = [];

function open(url: string) {
  const client = createClient({ url });
  openClients.push(client);
  return client;
}

afterEach(() => {
  for (const client of openClients.splice(0)) client.close();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
});

afterAll(() => {
  for (const file of createdFiles) {
    for (const suffix of ["", "-journal", "-wal", "-shm"]) removeQuietly(`${file}${suffix}`);
  }
});

const USER = "user-1";
const TOKEN = "test-session-token";

/** A migrated temp database with one user and one valid session. */
async function newDatabase() {
  const name = `progress-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.db`;
  createdFiles.push(path.join(DB_DIR, name));
  const url = `file:.tmp/test-dbs-progress/${name}`;
  const client = open(url);
  await migrate(client);
  await client.batch(
    [
      { sql: "INSERT INTO users (id, username, username_key, password_hash, created_at) VALUES (?, ?, ?, ?, ?)", args: [USER, "Tester", "tester", "not-a-real-hash", NOW.toISOString()] },
      {
        sql: "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
        args: [createHash("sha256").update(TOKEN).digest("hex"), USER, "2099-01-01T00:00:00.000Z", NOW.toISOString()],
      },
    ],
    "write",
  );
  return { url, client };
}

/** Applies an action that must succeed, at the fixed test clock unless told otherwise. */
async function act(client: Client, action: Action, options: ApplyOptions = {}) {
  const result = await applyActionWithClient(client, USER, action, { now: NOW, ...options });
  if (!result.ok) throw new Error(`Expected ${JSON.stringify(action).slice(0, 80)} to succeed, got ${result.code}`);
  return result;
}

const watch = (contentId: string, episode = -1): Action => ({ type: "watch", contentId, episode });
const unwatch = (contentId: string, episode = -1): Action => ({ type: "unwatch", contentId, episode });
const bulk = (ids: string[], skip: string[] = []): Action => ({ type: "bulk", watch: ids, skip, backfilled: true });

const stored = (client: Client) => readViewingState(client, USER);
const storedKeys = async (client: Client) => keysOf(await stored(client));
const rowsOf = (state: ViewingState, id: string) => state.rows.filter((row) => row.contentId === id).map((row) => row.episode);

/** Everything in the two user tables, exactly as stored, to prove "nothing changed". */
async function rawDump(client: Client) {
  const progress = await client.execute("SELECT user_id, content_id, episode, watched_at, backfilled FROM progress ORDER BY user_id, content_id, episode");
  const skips = await client.execute("SELECT user_id, content_id, reason, skipped_at FROM skips ORDER BY user_id, content_id");
  return JSON.parse(JSON.stringify({ progress: progress.rows.map((row) => ({ ...row })), skips: skips.rows.map((row) => ({ ...row })) }));
}

const sqlOf = (statement: InStatement) => (typeof statement === "string" ? statement : statement.sql).trim().split(/\s+/).slice(0, 3).join(" ");

/**
 * Wraps a client so every statement run inside a transaction is recorded. With `failAfterFirstWrite`
 * the first writing statement really runs and then an error is thrown, as if the connection died.
 */
function instrument(client: Client, options: { failAfterFirstWrite?: boolean } = {}) {
  const statements: string[] = [];
  const bind = (target: object, property: string | symbol) => {
    const value = Reflect.get(target, property) as unknown;
    return typeof value === "function" ? value.bind(target) : value;
  };
  const wrapTransaction = (tx: Transaction): Transaction =>
    new Proxy(tx, {
      get(target, property) {
        if (property === "execute") {
          return async (statement: InStatement) => {
            statements.push(sqlOf(statement));
            return target.execute(statement);
          };
        }
        if (property === "batch") {
          return async (batch: InStatement[]) => {
            for (const statement of batch) statements.push(sqlOf(statement));
            const writes = batch.length > 0 && !sqlOf(batch[0]).startsWith("SELECT");
            if (writes && options.failAfterFirstWrite) {
              await target.execute(batch[0]);
              throw new Error("injected failure after the first write");
            }
            return target.batch(batch);
          };
        }
        return bind(target, property);
      },
    });
  const wrapped = new Proxy(client, {
    get(target, property) {
      if (property === "transaction") {
        return async (mode: TransactionMode) => wrapTransaction(await target.transaction(mode));
      }
      return bind(target, property);
    },
  });
  return { client: wrapped as Client, statements };
}

describe("regressions: bugs the pre-1.3 code had", () => {
  it("1. un-watching Iron Man keeps Moon Knight's episodes (it has no prerequisites)", async () => {
    const { client } = await newDatabase();
    for (const action of [watch("iron-man"), watch("moon-knight", 1), watch("moon-knight", 2)]) await act(client, action);

    const result = await act(client, unwatch("iron-man"));

    expect(result.cleared).toEqual([]);
    expect(await storedKeys(client)).toEqual(["moon-knight:1", "moon-knight:2"]);
  });

  it("2. un-watching Daredevil S1 episode 13 removes the Season 2 episodes that depended on it", async () => {
    const { client } = await newDatabase();
    await act(client, { type: "watchAll", contentId: "defenders-daredevil-1" });
    await act(client, watch("defenders-daredevil-2", 1));
    await act(client, watch("defenders-daredevil-2", 2));

    const result = await act(client, unwatch("defenders-daredevil-1", 13));

    expect(result.cleared).toEqual(["defenders-daredevil-2"]);
    const state = await stored(client);
    expect(rowsOf(state, "defenders-daredevil-2")).toEqual([]);
    expect(rowsOf(state, "defenders-daredevil-1")).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(outOfOrderTitles(state)).toEqual([]);
  });

  it("3a. un-watching Iron Man with later films watched runs a fixed handful of statements, not one per title", async () => {
    const elevenFilms = requiredThrough(MCU_CONTENT, "age-of-ultron"); // Iron Man plus ten later films
    expect(elevenFilms).toHaveLength(11);

    const small = await newDatabase();
    await act(small.client, bulk(elevenFilms));
    const counted = instrument(small.client);
    const result = await act(counted.client, unwatch("iron-man"));
    expect(result.cleared).toHaveLength(10);
    expect(counted.statements).toEqual(["SELECT content_id, episode,", "SELECT content_id, reason,", "DELETE FROM progress"]);
    expect(await storedKeys(small.client)).toEqual([]);

    // Building a full account (91 titles, 382 rows) is two reads and two inserts.
    const full = await newDatabase();
    const countedBulk = instrument(full.client);
    const built = await act(countedBulk.client, bulk(WATCHABLE_IDS));
    expect(built.addedRows).toHaveLength(382);
    expect(countedBulk.statements).toEqual([
      "SELECT content_id, episode,",
      "SELECT content_id, reason,",
      ...Array.from({ length: Math.ceil(built.addedRows.length / 200) }, () => "INSERT INTO progress"),
    ]);
    const before = await storedKeys(full.client);
    expect(before).toHaveLength(built.addedRows.length);

    // Un-watching Iron Man there clears 59 titles: still two reads and one delete.
    const countedFull = instrument(full.client);
    const cleared = await act(countedFull.client, unwatch("iron-man"));
    expect(cleared.cleared).toHaveLength(59);
    expect(cleared.removedKeys.length).toBeGreaterThan(150);
    expect(countedFull.statements).toEqual(["SELECT content_id, episode,", "SELECT content_id, reason,", "DELETE FROM progress"]);
    expect((await storedKeys(full.client)).length).toBe(before.length - cleared.removedKeys.length);
  });

  it("3b. the change is atomic: a failure after the first write leaves every row as it was", async () => {
    const { client } = await newDatabase();
    await act(client, bulk(requiredThrough(MCU_CONTENT, "age-of-ultron")));
    const before = await rawDump(client);

    const failing = instrument(client, { failAfterFirstWrite: true });
    await expect(applyActionWithClient(failing.client, USER, unwatch("iron-man"), { now: NOW })).rejects.toThrow("injected failure");
    expect(failing.statements).toContain("DELETE FROM progress"); // the delete really ran, then was rolled back
    expect(await rawDump(client)).toEqual(before);

    // Same for an action that writes to both tables.
    const failingBulk = instrument(client, { failAfterFirstWrite: true });
    await expect(applyActionWithClient(failingBulk.client, USER, bulk(["ant-man"], ["civil-war"]), { now: NOW })).rejects.toThrow("injected failure");
    expect(await rawDump(client)).toEqual(before);

    // The database is not left locked: the next write works.
    await act(client, watch("ant-man"));
    expect(await storedKeys(client)).toContain("ant-man:-1");
  });

  it("4. the MCU tab reads 100% with every watchable unit watched, although one series is unpublished", async () => {
    const { client } = await newDatabase();
    await act(client, bulk([...WATCHABLE_IDS.filter((id) => item(id).universe === "mcu"), "xmen-2000"]));

    const stats = getStats(MCU_CONTENT, indexOf(await stored(client)), { includeOptional: true });

    expect(item("friendly-spider-man-2").dataPending).toBe(true);
    expect(stats).toMatchObject({ percent: 100, complete: true, remainingUnits: 0, remainingRuntime: 0 });
  });

  it("5. the release lock opens at UTC midnight for the server and the client alike", async () => {
    const { client } = await newDatabase();
    await act(client, bulk(WATCHABLE_IDS.filter((id) => id !== "visionquest")));
    const release = releaseMoment(item("visionquest"));

    for (const [now, open] of [[new Date(release - 1), false], [new Date(release), true]] as const) {
      const clientSaysOpen = lockReason(item("visionquest"), indexOf(await stored(client)), now) === null;
      const server = await applyActionWithClient(client, USER, watch("visionquest", 1), { now });
      expect({ clientSaysOpen, serverAccepted: server.ok }, now.toISOString()).toEqual({ clientSaysOpen: open, serverAccepted: open });
      if (!server.ok) expect(server.code).toBe("unreleased");
    }
  });

  it("6. full account, un-watching Iron Man also clears Hawkeye and Echo", async () => {
    const { client } = await newDatabase();
    await act(client, bulk(WATCHABLE_IDS));

    const result = await act(client, unwatch("iron-man"));

    const left = new Set(titlesWithRows(await stored(client)));
    expect(result.cleared).toEqual(expect.arrayContaining(["endgame", "hawkeye", "echo"]));
    expect(left.has("hawkeye") || left.has("echo") || left.has("endgame")).toBe(false);
    expect(left.has("moon-knight")).toBe(true);
    expect(left.has("defenders-daredevil-3")).toBe(true);
    expect(left.has("xmen-2000")).toBe(true);
    expect(outOfOrderTitles(await stored(client))).toEqual([]);
  });

  it("7. un-watch with an episode number the title does not have changes nothing", async () => {
    const { url, client } = await newDatabase();
    await act(client, bulk(requiredThrough(MCU_CONTENT, "age-of-ultron")));
    const before = await rawDump(client);
    const { POST } = await server(url);

    // The pre-1.3 request body, as an old client sends it.
    for (const body of [{ contentId: "iron-man", episode: 99, watched: false }, { contentId: "iron-man", episode: 1, watched: false }]) {
      const response = await POST(request("POST", body));
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "unknown-episode", contentId: "iron-man" });
    }
    expect(await rawDump(client)).toEqual(before);
  });
});

describe("persistence", () => {
  it("writes only the difference: rows that are not part of the action keep their stored timestamp", async () => {
    const { client } = await newDatabase();
    await act(client, watch("iron-man"), { now: new Date("2026-05-01T10:00:00.000Z") });
    await act(client, watch("incredible-hulk"), { now: new Date("2026-05-02T10:00:00.000Z") });
    await act(client, watch("iron-man"), { now: new Date("2026-05-03T10:00:00.000Z") }); // a retry

    expect((await stored(client)).rows).toEqual([
      { contentId: "iron-man", episode: -1, watchedAt: "2026-05-01T10:00:00.000Z", backfilled: false },
      { contentId: "incredible-hulk", episode: -1, watchedAt: "2026-05-02T10:00:00.000Z", backfilled: false },
    ]);
  });

  it("stores the backfilled flag and skips, and removes a skip when its title is finished", async () => {
    const { client } = await newDatabase();
    await act(client, bulk(["iron-man"], ["incredible-hulk"]));
    await act(client, watch("iron-man-2"));
    let state = await stored(client);
    expect(state.rows.map((row) => [row.contentId, row.backfilled])).toEqual([["iron-man", true], ["iron-man-2", false]]);
    expect(state.skips).toEqual([{ contentId: "incredible-hulk", reason: "manual", skippedAt: NOW.toISOString() }]);

    await act(client, watch("incredible-hulk"));
    state = await stored(client);
    expect(state.skips).toEqual([]);
    expect((await client.execute("SELECT COUNT(*) AS n FROM skips")).rows[0].n).toBe(0);
  });

  it("reads rows written by the pre-1.3 app (no backfilled value given) as not backfilled", async () => {
    const { client } = await newDatabase();
    await client.execute({ sql: "INSERT INTO progress (user_id, content_id, episode, watched_at) VALUES (?, ?, ?, ?)", args: [USER, "iron-man", -1, "2026-04-01T00:00:00.000Z"] });
    expect((await stored(client)).rows).toEqual([{ contentId: "iron-man", episode: -1, watchedAt: "2026-04-01T00:00:00.000Z", backfilled: false }]);
  });

  it("a rule failure writes nothing", async () => {
    const { client } = await newDatabase();
    await act(client, watch("iron-man"));
    const before = await rawDump(client);

    const result = await applyActionWithClient(client, USER, bulk(["incredible-hulk", "thor"]), { now: NOW });

    expect(result).toMatchObject({ ok: false, code: "locked", contentId: "thor", missingId: "iron-man-2" });
    expect(await rawDump(client)).toEqual(before);
  });

  it("one user's actions never touch another user's rows", async () => {
    const { client } = await newDatabase();
    await client.execute({ sql: "INSERT INTO users (id, username, username_key, password_hash, created_at) VALUES (?, ?, ?, ?, ?)", args: ["someone-else", "Other", "other", "not-a-real-hash", NOW.toISOString()] });
    await client.execute({ sql: "INSERT INTO progress (user_id, content_id, episode, watched_at) VALUES (?, ?, ?, ?)", args: ["someone-else", "iron-man", -1, "2026-04-01T00:00:00.000Z"] });
    await client.execute({ sql: "INSERT INTO progress (user_id, content_id, episode, watched_at) VALUES (?, ?, ?, ?)", args: ["someone-else", "incredible-hulk", -1, "2026-04-02T00:00:00.000Z"] });

    await act(client, bulk(["iron-man", "incredible-hulk"]));
    await act(client, unwatch("iron-man"));

    expect(await storedKeys(client)).toEqual([]);
    expect(keysOf(await readViewingState(client, "someone-else"))).toEqual(["incredible-hulk:-1", "iron-man:-1"]);
  });

  it("confirmCleared: clearing a title the client did not confirm writes nothing and returns the fresh list", async () => {
    const { client } = await newDatabase();
    await act(client, bulk(["iron-man", "incredible-hulk", "iron-man-2"]));
    const before = await rawDump(client);

    // The client only knew about The Incredible Hulk; another device added Iron Man 2 since.
    const refused = await applyActionWithClient(client, USER, unwatch("iron-man"), { now: NOW, confirmCleared: ["incredible-hulk"] });
    expect(refused).toMatchObject({ ok: false, code: "confirm-required", cleared: ["incredible-hulk", "iron-man-2"] });
    if (refused.ok || refused.code !== "confirm-required") throw new Error("expected confirm-required");
    expect(keysOf(refused.state)).toEqual(["incredible-hulk:-1", "iron-man-2:-1", "iron-man:-1"]);
    expect(await rawDump(client)).toEqual(before);

    const confirmed = await act(client, unwatch("iron-man"), { confirmCleared: refused.cleared });
    expect(confirmed.cleared).toEqual(["incredible-hulk", "iron-man-2"]);
    expect(await storedKeys(client)).toEqual([]);
  });

  it("confirmCleared: an empty list still allows an action that clears nothing", async () => {
    const { client } = await newDatabase();
    await act(client, bulk(["iron-man", "incredible-hulk"]));
    await act(client, unwatch("incredible-hulk"), { confirmCleared: [] });
    expect(await storedKeys(client)).toEqual(["iron-man:-1"]);
  });

  it("two writes at the same moment through two clients both succeed", async () => {
    const { url, client } = await newDatabase();
    const other = open(url);

    const results = await Promise.all([
      applyActionWithClient(client, USER, watch("iron-man"), { now: NOW }),
      applyActionWithClient(other, USER, watch("xmen-2000"), { now: NOW }),
    ]);

    expect(results.map((result) => result.ok)).toEqual([true, true]);
    expect(await storedKeys(client)).toEqual(["iron-man:-1", "xmen-2000:-1"]);
  });

  it("many writes at the same moment all succeed, and none is lost", async () => {
    const { url, client } = await newDatabase();
    const clients = [client, open(url), open(url)];
    // Seven units with no prerequisites, so every one of them is allowed in any order.
    const independent: [string, number][] = [
      ["iron-man", -1],
      ["xmen-2000", -1],
      ["moon-knight", 1],
      ["defenders-daredevil-1", 1],
      ["defenders-jessica-jones-1", 1],
      ["defenders-luke-cage-1", 1],
      ["defenders-iron-fist-1", 1],
    ];

    const results = await Promise.all(
      independent.map(([id, episode], position) => applyActionWithClient(clients[position % clients.length], USER, watch(id, episode), { now: NOW })),
    );

    expect(results.every((result) => result.ok)).toBe(true);
    expect(await storedKeys(client)).toEqual(independent.map(([id, episode]) => `${id}:${episode}`).sort());

    // The connections are still healthy afterwards: a further write on each client commits.
    for (const [position, each] of clients.entries()) await act(each, watch("moon-knight", position + 2));
    expect(rowsOf(await stored(client), "moon-knight")).toEqual([1, 2, 3, 4]);
  });

  it("a write waits for another PROCESS that holds the write lock instead of failing", async () => {
    const { url, client } = await newDatabase();
    // The app client is created with a busy timeout (src/lib/db.ts); do the same here.
    const patient = createClient({ url, timeout: 5_000 });
    openClients.push(patient);

    // A second process takes the write lock, holds it for 400 ms, then commits a row of its own.
    const holder = spawn(
      process.execPath,
      [
        "-e",
        `const { createClient } = require("@libsql/client");
         (async () => {
           const db = createClient({ url: ${JSON.stringify(url)} });
           const tx = await db.transaction("write");
           await tx.execute("INSERT INTO skips (user_id, content_id, reason, skipped_at) VALUES ('other-process', 'thor', 'manual', '2026-01-01T00:00:00.000Z')");
           console.log("locked");
           setTimeout(async () => { await tx.commit(); db.close(); }, 400);
         })().catch((error) => { console.error(error); process.exit(1); });`,
      ],
      { cwd: process.cwd(), stdio: ["ignore", "pipe", "inherit"] },
    );
    const exited = new Promise<number | null>((resolve) => holder.on("exit", resolve));
    await new Promise<void>((resolve, reject) => {
      holder.stdout.on("data", (chunk: Buffer) => {
        if (String(chunk).includes("locked")) resolve();
      });
      holder.on("exit", (code) => reject(new Error(`lock holder exited early with code ${code}`)));
    });

    const started = Date.now();
    const result = await applyActionWithClient(patient, USER, watch("iron-man"), { now: NOW });
    const waited = Date.now() - started;

    expect(result.ok).toBe(true);
    expect(waited).toBeGreaterThan(100); // it really had to wait for the other process
    expect(await exited).toBe(0);
    expect(await storedKeys(client)).toEqual(["iron-man:-1"]);
    expect((await client.execute("SELECT COUNT(*) AS n FROM skips WHERE user_id = 'other-process'")).rows[0].n).toBe(1);
    // And the waiting connection is healthy: its next write commits too.
    await act(patient, watch("incredible-hulk"));
    expect(await storedKeys(client)).toEqual(["incredible-hulk:-1", "iron-man:-1"]);
  });

  it("conflicting writes at the same moment end in a valid state whichever goes first", async () => {
    for (let round = 0; round < 6; round += 1) {
      const { url, client } = await newDatabase();
      await act(client, bulk(["iron-man", "incredible-hulk"]));
      const other = open(url);

      // Un-watch Iron Man while another request marks Iron Man 2 (which needs Iron Man).
      const [removal, addition] = await Promise.all([
        applyActionWithClient(client, USER, unwatch("iron-man"), { now: NOW }),
        applyActionWithClient(other, USER, watch("iron-man-2"), { now: NOW }),
      ]);

      const state = await stored(client);
      expect(removal.ok, `round ${round}`).toBe(true);
      expect(outOfOrderTitles(state), `round ${round}`).toEqual([]);
      // Either the watch went first and was then cleared, or it came second and was refused.
      expect(keysOf(state), `round ${round}`).toEqual([]);
      if (!addition.ok) expect(addition.code).toBe("locked");
    }
  });

  it("rows the catalogue does not recognise stay in the database through every kind of write", async () => {
    const { client } = await newDatabase();
    await act(client, bulk(requiredThrough(MCU_CONTENT, "wandavision")));
    await client.batch(
      [
        { sql: "INSERT INTO progress (user_id, content_id, episode, watched_at) VALUES (?, ?, ?, ?)", args: [USER, "removed-title", -1, "2026-04-01T00:00:00.000Z"] },
        { sql: "INSERT INTO progress (user_id, content_id, episode, watched_at) VALUES (?, ?, ?, ?)", args: [USER, "wandavision", 99, "2026-04-02T00:00:00.000Z"] },
        { sql: "INSERT INTO skips (user_id, content_id, reason, skipped_at) VALUES (?, ?, ?, ?)", args: [USER, "another-removed-title", "manual", "2026-04-03T00:00:00.000Z"] },
      ],
      "write",
    );
    const strange = async () => ({
      progress: (await client.execute("SELECT content_id, episode, watched_at FROM progress WHERE content_id = 'removed-title' OR episode = 99 ORDER BY content_id")).rows.map((row) => ({ ...row })),
      skips: (await client.execute("SELECT content_id, skipped_at FROM skips WHERE content_id = 'another-removed-title'")).rows.map((row) => ({ ...row })),
    });
    const before = JSON.parse(JSON.stringify(await strange()));
    expect(before.progress).toHaveLength(2);

    // A watch, a skip, and an un-watch that clears WandaVision itself.
    await act(client, watch("falcon-winter-soldier", 1));
    await act(client, { type: "skip", contentId: "loki-1" });
    const cascade = await act(client, unwatch("iron-man"));
    expect(cascade.cleared).toContain("wandavision");

    expect(JSON.parse(JSON.stringify(await strange()))).toEqual(before);
    expect(titlesWithRows(await stored(client)).sort()).toEqual(["removed-title", "wandavision"]);
  });
});

/* ------------------------------- the route handlers ------------------------------- */

/** Loads a fresh copy of the route module (and its database client) pointed at `url`. */
async function server(url: string) {
  vi.stubEnv("TURSO_DATABASE_URL", url);
  vi.resetModules();
  const route = await import("@/app/api/progress/route");
  const { db } = await import("@/lib/db");
  openClients.push(db);
  return route;
}

function request(method: "GET" | "POST", body?: unknown, options: { signedIn?: boolean; raw?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.signedIn !== false) headers.cookie = `nexus_session=${TOKEN}`;
  return new NextRequest("http://localhost/api/progress", {
    method,
    headers,
    body: method === "POST" ? options.raw ?? JSON.stringify(body) : undefined,
  });
}

describe("GET /api/progress", () => {
  it("returns the user, the viewing state and the storage mode", async () => {
    const { url, client } = await newDatabase();
    await act(client, bulk(["iron-man"], ["thor"]));
    const { GET } = await server(url);

    const response = await GET(request("GET"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      user: { id: USER, username: "Tester" },
      state: {
        rows: [{ contentId: "iron-man", episode: -1, watchedAt: NOW.toISOString(), backfilled: true }],
        skips: [{ contentId: "thor", reason: "manual", skippedAt: NOW.toISOString() }],
      },
      outOfOrder: [],
      unrecognised: [],
      databaseMode: "LOCAL VAULT",
      account: { hasRecoveryCode: false }, // this test's user was inserted directly, without a code
    });
  });

  it("is 401 without a session", async () => {
    const { url } = await newDatabase();
    const { GET, POST } = await server(url);
    expect((await GET(request("GET", undefined, { signedIn: false }))).status).toBe(401);
    expect((await POST(request("POST", { action: { type: "watch", contentId: "iron-man", episode: -1 } }, { signedIn: false }))).status).toBe(401);
  });

  it("reports rows left out of order by the old bugs, and unrecognised rows, without failing", async () => {
    const { url, client } = await newDatabase();
    // What bug 2 left behind, plus a row for a title that no longer exists and an impossible episode.
    await client.batch(
      [
        ...[1, 2, 3].map((episode) => ({ sql: "INSERT INTO progress (user_id, content_id, episode, watched_at) VALUES (?, ?, ?, ?)", args: [USER, "defenders-daredevil-1", episode, `2026-04-0${episode}T00:00:00.000Z`] })),
        ...[1, 2].map((episode) => ({ sql: "INSERT INTO progress (user_id, content_id, episode, watched_at) VALUES (?, ?, ?, ?)", args: [USER, "defenders-daredevil-2", episode, `2026-04-1${episode}T00:00:00.000Z`] })),
        { sql: "INSERT INTO progress (user_id, content_id, episode, watched_at) VALUES (?, ?, ?, ?)", args: [USER, "removed-title", -1, "2026-04-20T00:00:00.000Z"] },
        { sql: "INSERT INTO progress (user_id, content_id, episode, watched_at) VALUES (?, ?, ?, ?)", args: [USER, "wandavision", 99, "2026-04-21T00:00:00.000Z"] },
      ],
      "write",
    );
    const { GET, POST } = await server(url);

    const body = await (await GET(request("GET"))).json();
    expect(body.outOfOrder).toEqual(["defenders-daredevil-2"]);
    expect(body.unrecognised).toEqual(["removed-title", "wandavision"]);
    expect(body.state.rows).toHaveLength(7); // nothing was deleted automatically

    // The out-of-order rows can be removed by the user, although the title is locked.
    const removed = await POST(request("POST", { action: { type: "unwatch", contentId: "defenders-daredevil-2", episode: 1 } }));
    expect(removed.status).toBe(200);
    const after = await removed.json();
    expect(after.outOfOrder).toEqual([]);
    expect(after.unrecognised).toEqual(["removed-title", "wandavision"]);
    expect(after.state.rows).toHaveLength(5);
  });
});

describe("POST /api/progress", () => {
  it("applies an action and returns the new state with what was cleared", async () => {
    const { url, client } = await newDatabase();
    await act(client, bulk(["iron-man", "incredible-hulk"]));
    const { POST } = await server(url);

    const response = await POST(request("POST", { action: { type: "unwatch", contentId: "iron-man", episode: -1 } }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: { rows: [], skips: [] }, outOfOrder: [], unrecognised: [], cleared: ["incredible-hulk"] });
    expect(await storedKeys(client)).toEqual([]);
  });

  it("still accepts the pre-1.3 body and maps it to watch / un-watch", async () => {
    const { url, client } = await newDatabase();
    const { POST } = await server(url);

    const watched = await POST(request("POST", { contentId: "iron-man", episode: -1, watched: true }));
    expect(watched.status).toBe(200);
    expect((await watched.json()).state.rows).toHaveLength(1);

    const unwatched = await POST(request("POST", { contentId: "iron-man", episode: -1, watched: false }));
    expect(unwatched.status).toBe(200);
    expect(await storedKeys(client)).toEqual([]);
  });

  it("accepts skip, unskip, watchAll and bulk", async () => {
    const { url, client } = await newDatabase();
    const { POST } = await server(url);
    const send = async (action: Action) => {
      const response = await POST(request("POST", { action }));
      expect(response.status, JSON.stringify(action)).toBe(200);
    };

    await send({ type: "bulk", watch: ["incredible-hulk", "iron-man"], skip: [], backfilled: true });
    await send({ type: "skip", contentId: "iron-man-2", reason: "triage" });
    await send({ type: "watch", contentId: "thor", episode: -1 });
    await send({ type: "watchAll", contentId: "moon-knight" });

    const state = await stored(client);
    expect(titlesWithRows(state).sort()).toEqual(["incredible-hulk", "iron-man", "moon-knight", "thor"]);
    expect(state.skips.map((skip) => [skip.contentId, skip.reason])).toEqual([["iron-man-2", "triage"]]);

    const refused = await POST(request("POST", { action: { type: "unskip", contentId: "iron-man-2" } }));
    expect(refused.status).toBe(409);
    expect((await refused.json()).code).toBe("has-dependents");
  });

  it("a rule failure is 409 with a code, a plain message and the prerequisite to watch; nothing is written", async () => {
    const { url, client } = await newDatabase();
    const { POST } = await server(url);

    const response = await POST(request("POST", { action: { type: "watch", contentId: "incredible-hulk", episode: -1 } }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Watch Iron Man first to unlock The Incredible Hulk.",
      code: "locked",
      contentId: "incredible-hulk",
      missingId: "iron-man",
    });
    expect(await storedKeys(client)).toEqual([]);
  });

  it("a series whose episodes are unpublished is refused by the server too", async () => {
    const { url, client } = await newDatabase();
    await act(client, bulk(WATCHABLE_IDS));
    const { POST } = await server(url);

    const response = await POST(request("POST", { contentId: "friendly-spider-man-2", episode: 1, watched: true }));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("pending");
  });

  it("a malformed body is 400 and writes nothing", async () => {
    const { url, client } = await newDatabase();
    const { POST } = await server(url);
    const bodies: unknown[] = [
      {},
      { contentId: "iron-man", episode: -1 },
      { contentId: "iron-man", episode: 1.5, watched: true },
      { action: { type: "watch", contentId: "iron-man" } },
      { action: { type: "explode", contentId: "iron-man" } },
      { action: { type: "skip", contentId: "iron-man", reason: "because" } },
      { action: { type: "bulk", watch: "iron-man", skip: [], backfilled: true } },
      // `import` has its own route (package 4.1) and is not accepted here.
      { action: { type: "import", rows: [], skips: [] } },
    ];
    for (const body of bodies) {
      const response = await POST(request("POST", body));
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await response.json()).toEqual({ error: "Invalid progress update.", code: "invalid" });
    }
    expect((await POST(request("POST", undefined, { raw: "{not json" }))).status).toBe(400);
    expect(await storedKeys(client)).toEqual([]);
  });

  it("confirmCleared that misses a title is 409 confirm-required with the full list and the current state", async () => {
    const { url, client } = await newDatabase();
    await act(client, bulk(["iron-man", "incredible-hulk", "iron-man-2"]));
    const { POST } = await server(url);
    const action = { type: "unwatch", contentId: "iron-man", episode: -1 };

    const response = await POST(request("POST", { action, confirmCleared: ["incredible-hulk"] }));
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toMatchObject({ code: "confirm-required", cleared: ["incredible-hulk", "iron-man-2"], outOfOrder: [], unrecognised: [] });
    expect(body.state.rows).toHaveLength(3);
    expect(await storedKeys(client)).toHaveLength(3);

    const confirmed = await POST(request("POST", { action, confirmCleared: body.cleared }));
    expect(confirmed.status).toBe(200);
    expect(await storedKeys(client)).toEqual([]);
  });

  it("an unexpected database error is a generic 500: the detail is logged, not sent", async () => {
    const { url, client } = await newDatabase();
    const { POST, GET } = await server(url);
    expect((await GET(request("GET"))).status).toBe(200); // the schema is in place
    await client.execute("DROP TABLE skips"); // now every read of the state throws inside the store
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(request("POST", { action: { type: "watch", contentId: "iron-man", episode: -1 } }));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: "Progress could not be saved. Try again." });
    expect(JSON.stringify(body)).not.toMatch(/skips|no such table|SQLITE/i);
    expect(logged).toHaveBeenCalled();
    expect(String(logged.mock.calls[0]?.[1])).toMatch(/no such table/i);

    const read = await GET(request("GET"));
    expect(read.status).toBe(500);
    expect(await read.json()).toEqual({ error: "Timeline vault unavailable." });
  });
});

describe("the full account fixture", () => {
  it("is every dependent the plan counts", () => {
    // Guards the numbers the regression tests above rely on.
    expect(dependents("iron-man")).toHaveLength(60);
    expect(WATCHABLE_IDS).toHaveLength(91);
  });
});
