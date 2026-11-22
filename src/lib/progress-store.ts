/**
 * Reading and changing a user's viewing state in the database (NEXT_LEVEL_PLAN.md §4.5).
 *
 * Every change goes through `applyUserAction`: one interactive WRITE transaction that reads the
 * user's rows and skips, runs the pure reducer, writes only the difference and commits. A rule
 * failure, a refused confirmation or a thrown error leaves the database exactly as it was.
 * On a remote database that is three round trips (read, write, commit), however many titles change.
 *
 * Rows the catalogue does not recognise are read and returned like any other row and are never
 * written to: deletes name exact (title, episode) pairs taken from the reducer's own diff.
 */
import "server-only";

import type { Client, InStatement, InValue, ResultSet } from "@libsql/client";

import { db, ensureDatabase } from "@/lib/db";
import { applyAction, type Action, type ActionFailure, type ActionSuccess } from "@/lib/engine/reducer";
import { outOfOrderTitles, unrecognisedIds, type ViewingState } from "@/lib/engine/state";
import { withWriteLock } from "@/lib/write-lock";

/** The reducer refused nothing, but the action would clear titles the client did not confirm. */
export type ConfirmRequired = {
  ok: false;
  code: "confirm-required";
  message: string;
  /** Every title the action would clear, so the client can ask again with the fresh list. */
  cleared: string[];
  /** The state as stored (nothing was written). */
  state: ViewingState;
};

export type StoreResult = ActionSuccess | ActionFailure | ConfirmRequired;

export type ApplyOptions = {
  /**
   * Titles the user has agreed to lose. When given, an action that would clear any OTHER title
   * writes nothing and returns `confirm-required`. When omitted, no confirmation is enforced.
   */
  confirmCleared?: readonly string[];
  /** The moment the action happens. Defaults to the current time. */
  now?: Date;
};

/** Rows per multi-row statement. Keeps each statement far below SQLite's bound-parameter limit. */
const CHUNK = 200;
/**
 * A busy database is retried this many times before the error is surfaced. This helps a remote
 * database. On a local file a busy error should not happen at all (see `write-lock.ts`), and a
 * retry cannot repair it there.
 */
const BUSY_RETRIES = 3;

const selectProgress = (userId: string): InStatement => ({
  sql: "SELECT content_id, episode, watched_at, backfilled FROM progress WHERE user_id = ? ORDER BY watched_at ASC, rowid ASC",
  args: [userId],
});

const selectSkips = (userId: string): InStatement => ({
  sql: "SELECT content_id, reason, skipped_at FROM skips WHERE user_id = ? ORDER BY skipped_at ASC, rowid ASC",
  args: [userId],
});

function toState(progress: ResultSet, skips: ResultSet): ViewingState {
  return {
    rows: progress.rows.map((row) => ({
      contentId: String(row.content_id),
      episode: Number(row.episode),
      watchedAt: String(row.watched_at),
      backfilled: Number(row.backfilled) === 1,
    })),
    skips: skips.rows.map((row) => ({
      contentId: String(row.content_id),
      reason: row.reason === "triage" ? "triage" : "manual",
      skippedAt: String(row.skipped_at),
    })),
  };
}

function chunks<T>(values: readonly T[]): T[][] {
  const result: T[][] = [];
  for (let start = 0; start < values.length; start += CHUNK) result.push(values.slice(start, start + CHUNK));
  return result;
}

/** The statements that turn the stored state into `outcome.state`: a fixed handful, never one per title. */
function diffStatements(userId: string, outcome: ActionSuccess): InStatement[] {
  const statements: InStatement[] = [];

  for (const keys of chunks(outcome.removedKeys)) {
    const args: InValue[] = [userId];
    for (const key of keys) {
      const split = key.lastIndexOf(":");
      args.push(key.slice(0, split), Number(key.slice(split + 1)));
    }
    statements.push({
      sql: `DELETE FROM progress WHERE user_id = ? AND (content_id, episode) IN (VALUES ${keys.map(() => "(?, ?)").join(", ")})`,
      args,
    });
  }

  for (const rows of chunks(outcome.addedRows)) {
    statements.push({
      sql: `INSERT INTO progress (user_id, content_id, episode, watched_at, backfilled) VALUES ${rows.map(() => "(?, ?, ?, ?, ?)").join(", ")}
            ON CONFLICT(user_id, content_id, episode) DO NOTHING`,
      args: rows.flatMap((row): InValue[] => [userId, row.contentId, row.episode, row.watchedAt, row.backfilled ? 1 : 0]),
    });
  }

  for (const ids of chunks(outcome.removedSkips)) {
    statements.push({
      sql: `DELETE FROM skips WHERE user_id = ? AND content_id IN (${ids.map(() => "?").join(", ")})`,
      args: [userId, ...ids],
    });
  }

  for (const skips of chunks(outcome.addedSkips)) {
    statements.push({
      sql: `INSERT INTO skips (user_id, content_id, reason, skipped_at) VALUES ${skips.map(() => "(?, ?, ?, ?)").join(", ")}
            ON CONFLICT(user_id, content_id) DO NOTHING`,
      args: skips.flatMap((skip): InValue[] => [userId, skip.contentId, skip.reason, skip.skippedAt]),
    });
  }

  return statements;
}

async function applyOnce(client: Client, userId: string, action: Action, options: ApplyOptions): Promise<StoreResult> {
  const tx = await client.transaction("write");
  try {
    const [progress, skips] = await tx.batch([selectProgress(userId), selectSkips(userId)]);
    const state = toState(progress, skips);
    const outcome = applyAction(state, action, options.now ?? new Date());
    if (!outcome.ok) return outcome; // `finally` rolls back

    if (options.confirmCleared) {
      const confirmed = new Set(options.confirmCleared);
      if (outcome.cleared.some((id) => !confirmed.has(id))) {
        return {
          ok: false,
          code: "confirm-required",
          message: "This would also remove progress on other titles. Confirm to continue.",
          cleared: outcome.cleared,
          state,
        };
      }
    }

    const writes = diffStatements(userId, outcome);
    if (writes.length) await tx.batch(writes);
    await tx.commit();
    return outcome;
  } finally {
    tx.close(); // no-op after commit, otherwise rolls back
  }
}

function isBusy(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;
  const text = `${error instanceof Error ? error.message : String(error)} ${typeof code === "string" ? code : ""}`;
  return /SQLITE_BUSY|SQLITE_LOCKED|database is locked/i.test(text);
}

/**
 * Applies one action for one user on the given client. The schema must already be migrated.
 * Exported so tests can run it against a temp database; the app calls `applyUserAction`.
 */
export async function applyActionWithClient(client: Client, userId: string, action: Action, options: ApplyOptions = {}): Promise<StoreResult> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await withWriteLock(client, () => applyOnce(client, userId, action, options));
    } catch (error) {
      // Another write holds the database. Nothing was changed, so trying again is safe.
      if (attempt >= BUSY_RETRIES || !isBusy(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * 3 ** attempt + Math.random() * 25));
    }
  }
}

export async function readViewingState(client: Client, userId: string): Promise<ViewingState> {
  const [progress, skips] = await client.batch([selectProgress(userId), selectSkips(userId)], "read");
  return toState(progress, skips);
}

/** What the API sends alongside a state: problems worth showing, derived from the state itself. */
export function describeState(state: ViewingState) {
  return { state, outOfOrder: outOfOrderTitles(state), unrecognised: unrecognisedIds(state) };
}

export async function getViewingState(userId: string): Promise<ViewingState> {
  await ensureDatabase();
  return readViewingState(db, userId);
}

export async function applyUserAction(userId: string, action: Action, confirmCleared?: readonly string[]): Promise<StoreResult> {
  await ensureDatabase(); // before the transaction, never inside it
  return applyActionWithClient(db, userId, action, { confirmCleared });
}
