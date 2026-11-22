/**
 * Account operations (NEXT_LEVEL_PLAN.md package 1.5): recovery codes, password changes, signing
 * out everywhere and deleting an account.
 *
 * Recovery codes are 20 Crockford base-32 characters (100 random bits), shown as four groups of
 * five, for example `7K2QM-0XRTB-H4ZPA-9WCNE`. Only their SHA-256 is stored. A plain hash is enough
 * here, unlike for passwords: the code is random and far too long to guess. Reading a code back
 * forgives what people get wrong when typing one: case, spaces and dashes, `O` for `0`, and `I`
 * or `L` for `1`.
 */
import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { db, ensureDatabase } from "@/lib/db";
import { assertSameOrigin, RuleError } from "@/lib/http";
import { verifyPassword } from "@/lib/passwords";
import { clearLimit, enforceLimits, LIMITS } from "@/lib/rate-limit";
import { getSession, type Session } from "@/lib/session";
import { withWriteLock } from "@/lib/write-lock";

/** Crockford's base-32 alphabet: digits and capitals without I, L, O and U. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 20;
const GROUP = 5;

/** A new random recovery code, formatted for display (`XXXXX-XXXXX-XXXXX-XXXXX`). */
export function generateRecoveryCode(): string {
  // 256 is a multiple of 32, so taking the low five bits of each byte keeps every symbol equally likely.
  const symbols = Array.from(randomBytes(CODE_LENGTH), (byte) => ALPHABET[byte & 31]).join("");
  return symbols.match(new RegExp(`.{${GROUP}}`, "g"))!.join("-");
}

/** The 20 canonical symbols of a typed code, or `null` if it cannot be a recovery code. */
export function normalizeRecoveryCode(input: string): string | null {
  const cleaned = input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (cleaned.length !== CODE_LENGTH) return null;
  for (const symbol of cleaned) if (!ALPHABET.includes(symbol)) return null;
  return cleaned;
}

/** SHA-256 (hex) of a code's canonical form. Accepts a formatted or a typed code. */
export function hashRecoveryCode(code: string): string {
  const canonical = normalizeRecoveryCode(code);
  if (!canonical) throw new Error("Not a recovery code.");
  return createHash("sha256").update(canonical).digest("hex");
}

/** Compares a typed code with a stored hash in constant time. */
export function recoveryCodeMatches(input: string, storedHash: string | null): boolean {
  const canonical = normalizeRecoveryCode(input);
  if (!canonical || !storedHash) return false;
  const typed = Buffer.from(createHash("sha256").update(canonical).digest("hex"));
  const stored = Buffer.from(storedHash);
  return typed.length === stored.length && timingSafeEqual(typed, stored);
}

/** Issues a new recovery code for a user (the old one stops working) and returns it for display. */
export async function issueRecoveryCode(userId: string): Promise<string> {
  const code = generateRecoveryCode();
  await withWriteLock(db, () =>
    db.execute({ sql: "UPDATE users SET recovery_hash = ? WHERE id = ?", args: [hashRecoveryCode(code), userId] }),
  );
  return code;
}

/** Ends every session of a user, on every device. */
export async function deleteUserSessions(userId: string) {
  await withWriteLock(db, () => db.execute({ sql: "DELETE FROM sessions WHERE user_id = ?", args: [userId] }));
}

/** The rate-limit buckets named after a username. */
function usernameBuckets(usernameKey: string) {
  return [`${LIMITS.loginPerUsername.name}:${usernameKey}`, `${LIMITS.recoverPerUsername.name}:${usernameKey}`];
}

/**
 * Deletes an account and everything stored for it, in one atomic batch. Every table that holds
 * user data is listed here explicitly; the schema does not rely on ON DELETE CASCADE (§4.3).
 * Add any new user table here and in `scripts/reset-users.mjs`.
 */
export async function deleteAccount(userId: string, usernameKey: string) {
  const [loginBucket, recoverBucket] = usernameBuckets(usernameKey);
  await withWriteLock(db, () =>
    db.batch(
      [
        { sql: "DELETE FROM skips WHERE user_id = ?", args: [userId] },
        { sql: "DELETE FROM progress WHERE user_id = ?", args: [userId] },
        { sql: "DELETE FROM sessions WHERE user_id = ?", args: [userId] },
        { sql: "DELETE FROM rate_limits WHERE bucket IN (?, ?)", args: [loginBucket, recoverBucket] },
        { sql: "DELETE FROM users WHERE id = ?", args: [userId] },
      ],
      "write",
    ),
  );
}

/** The username as stored for look-ups (`users.username_key`). */
export const usernameKeyOf = (username: string) => username.toLocaleLowerCase();

export const currentPasswordField = z.string().min(1, "Enter your current password.").max(200);

/**
 * The checks every account change makes before doing anything: same origin, a signed-in session,
 * a well-formed body, the password-attempt limit (shared with sign-in: 8 per 15 minutes per
 * username), and the current password. Throws a `RuleError` for each refusal:
 * 403 cross-origin, 401 not signed in, 400 invalid body, 429 too many attempts, 403 wrong password.
 */
export async function authorizeAccountChange<Schema extends z.ZodType<{ currentPassword: string }>>(
  request: NextRequest,
  schema: Schema,
): Promise<{ session: Session; input: z.infer<Schema> }> {
  assertSameOrigin(request);
  await ensureDatabase();
  const session = await getSession(request);
  if (!session) throw new RuleError(401, "signed-out", "Not signed in.");

  let input: z.infer<Schema>;
  try {
    input = schema.parse(await request.json());
  } catch (error) {
    const message = error instanceof z.ZodError ? error.issues[0]?.message : undefined;
    throw new RuleError(400, "invalid", message ?? "Invalid request.");
  }

  const usernameKey = usernameKeyOf(session.user.username);
  await enforceLimits(db, [{ limit: LIMITS.loginPerUsername, key: usernameKey }]);
  const row = (await db.execute({ sql: "SELECT password_hash FROM users WHERE id = ?", args: [session.user.id] })).rows[0];
  const valid = await verifyPassword(input.currentPassword, row ? String(row.password_hash) : null);
  if (!valid) throw new RuleError(403, "wrong-password", "Your current password is incorrect.");
  await clearLimit(db, LIMITS.loginPerUsername, usernameKey);

  return { session, input };
}
