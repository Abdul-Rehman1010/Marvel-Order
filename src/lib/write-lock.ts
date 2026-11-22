/**
 * One interactive write transaction at a time, per process, for a LOCAL (`file:`) database.
 *
 * Why this exists. SQLite allows one writer. With the local libSQL client the busy timeout is 0
 * by default, so a second `transaction("write")` fails at once with SQLITE_BUSY. Worse, in
 * `libsql` 0.5.29 that failed BEGIN leaves a statement open on its pooled connection: until it
 * is garbage-collected, every later transaction on that connection fails at COMMIT ("cannot
 * commit transaction - SQL statements in progress") and a plain write on it can be rolled back
 * silently. So a retry cannot repair a local busy error; the BEGIN must not fail in the first place.
 *
 * - Inside one process, `withWriteLock` queues interactive write transactions so two never overlap.
 * - Between processes, `src/lib/db.ts` gives the client a busy timeout, so a BEGIN waits for the
 *   other process instead of failing.
 *
 * A remote (Turso) database queues writers on the server and is not affected, so the lock does
 * nothing there.
 *
 * The queue lives on `globalThis`: Next.js dev reloads and the test runner can load this module
 * more than once in one process, and every copy must share the same queue.
 */
import type { Client } from "@libsql/client";

type Queue = { tail: Promise<unknown> };

const QUEUE_KEY = Symbol.for("doomflix.localWriteQueue");

function queue(): Queue {
  const store = globalThis as typeof globalThis & { [QUEUE_KEY]?: Queue };
  return (store[QUEUE_KEY] ??= { tail: Promise.resolve() });
}

/**
 * Runs `run` when no other locked section is running in this process (local databases only).
 * Keep the section short and never wait for the lock from inside it.
 */
export function withWriteLock<T>(client: Pick<Client, "protocol">, run: () => Promise<T>): Promise<T> {
  if (client.protocol !== "file") return run();
  const state = queue();
  const result = state.tail.then(run);
  // The next section starts whether this one succeeded or failed.
  state.tail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
