/**
 * Fixed-window rate limits stored in `rate_limits(bucket, count, reset_at)` (migration 3,
 * NEXT_LEVEL_PLAN.md package 1.4). One atomic upsert per check: it starts a new window when the
 * old one has ended, otherwise adds one, and returns the new count. Works the same on a local file
 * and on Turso, and across serverless instances, because the counter lives in the database.
 *
 * Every attempt counts, whether it succeeds or not; a successful sign-in clears its username's
 * bucket (`clearLimit`). Buckets are named `<action>:<kind>:<value>`, for example
 * `login:user:peggy` or `signup:ip:203.0.113.7`.
 */
import "server-only";

import type { Client } from "@libsql/client";

import { RuleError } from "@/lib/http";
import { withWriteLock } from "@/lib/write-lock";

export type Limit = { name: string; max: number; windowMs: number };

const MINUTE = 60_000;

export const LIMITS = {
  loginPerUsername: { name: "login:user", max: 8, windowMs: 15 * MINUTE },
  loginPerIp: { name: "login:ip", max: 40, windowMs: 15 * MINUTE },
  signupPerIp: { name: "signup:ip", max: 5, windowMs: 60 * MINUTE },
  /** Used by `POST /api/auth/recover` in package 1.5. */
  recoverPerUsername: { name: "recover:user", max: 5, windowMs: 60 * MINUTE },
} as const satisfies Record<string, Limit>;

export type LimitCheck = { allowed: boolean; count: number; resetAt: number; retryAfterSeconds: number };

const bucketOf = (limit: Limit, key: string) => `${limit.name}:${key}`;

/** Counts one attempt against `limit` for `key` and says whether it is still within the limit. */
export async function hitLimit(client: Client, limit: Limit, key: string, now = Date.now()): Promise<LimitCheck> {
  const resetAt = now + limit.windowMs;
  const result = await withWriteLock(client, () =>
    client.execute({
      sql: `INSERT INTO rate_limits (bucket, count, reset_at) VALUES (?, 1, ?)
            ON CONFLICT(bucket) DO UPDATE SET
              count = CASE WHEN rate_limits.reset_at <= ? THEN 1 ELSE rate_limits.count + 1 END,
              reset_at = CASE WHEN rate_limits.reset_at <= ? THEN excluded.reset_at ELSE rate_limits.reset_at END
            RETURNING count, reset_at`,
      args: [bucketOf(limit, key), resetAt, now, now],
    }),
  );
  const row = result.rows[0];
  const count = Number(row?.count ?? 1);
  const windowEnd = Number(row?.reset_at ?? resetAt);
  return {
    allowed: count <= limit.max,
    count,
    resetAt: windowEnd,
    retryAfterSeconds: Math.max(1, Math.ceil((windowEnd - now) / 1000)),
  };
}

/**
 * Counts one attempt against every given limit and throws a 429 `RuleError` (with `Retry-After`)
 * if any of them is exceeded. All buckets are counted even when the first one is already over,
 * so hammering one username still uses up the IP's allowance.
 */
export async function enforceLimits(client: Client, checks: { limit: Limit; key: string }[], now = Date.now()) {
  const results = [];
  for (const { limit, key } of checks) results.push(await hitLimit(client, limit, key, now));
  const blocked = results.filter((result) => !result.allowed);
  if (blocked.length) {
    const retryAfter = Math.max(...blocked.map((result) => result.retryAfterSeconds));
    const minutes = Math.ceil(retryAfter / 60);
    throw new RuleError(429, "rate-limited", `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`, {
      headers: { "Retry-After": String(retryAfter) },
      extra: { retryAfter },
    });
  }
}

/** Forgets the attempts counted for `key` under `limit` (after a successful sign-in). */
export async function clearLimit(client: Client, limit: Limit, key: string) {
  await withWriteLock(client, () => client.execute({ sql: "DELETE FROM rate_limits WHERE bucket = ?", args: [bucketOf(limit, key)] }));
}

/** Removes buckets whose window has ended. Called now and then; nothing depends on it running. */
export async function deleteEndedWindows(client: Client, now = Date.now()) {
  await withWriteLock(client, () => client.execute({ sql: "DELETE FROM rate_limits WHERE reset_at <= ?", args: [now] }));
}
