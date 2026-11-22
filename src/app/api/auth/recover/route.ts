import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { generateRecoveryCode, hashRecoveryCode, recoveryCodeMatches, usernameKeyOf } from "@/lib/account";
import { db, ensureDatabase } from "@/lib/db";
import { assertSameOrigin, errorResponse, jsonError, RuleError } from "@/lib/http";
import { hashPassword, newPasswordSchema } from "@/lib/passwords";
import { clearLimit, enforceLimits, LIMITS } from "@/lib/rate-limit";
import { createSession } from "@/lib/session";
import { withWriteLock } from "@/lib/write-lock";

export const runtime = "nodejs";

const body = z.object({
  username: z.string().trim().min(1, "Enter your username.").max(100),
  recoveryCode: z.string().trim().min(1, "Enter your recovery code.").max(100),
  newPassword: newPasswordSchema,
});

/**
 * Resets a forgotten password with the account's recovery code (package 1.5). On success: the new
 * password is set, a new recovery code replaces the used one, every session of the account is
 * ended (on all devices), and this device is signed in with a fresh session. The new code is in
 * the reply and is shown once.
 */
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    await ensureDatabase();

    let input: z.infer<typeof body>;
    try {
      input = body.parse(await request.json());
    } catch (error) {
      const message = error instanceof z.ZodError ? error.issues[0]?.message : undefined;
      return jsonError(400, message ?? "Invalid recovery request.", { code: "invalid" });
    }
    const usernameKey = usernameKeyOf(input.username);
    await enforceLimits(db, [{ limit: LIMITS.recoverPerUsername, key: usernameKey }]);

    const row = (
      await db.execute({ sql: "SELECT id, username, recovery_hash FROM users WHERE username_key = ?", args: [usernameKey] })
    ).rows[0];
    const storedHash = row?.recovery_hash === null || row?.recovery_hash === undefined ? null : String(row.recovery_hash);
    // One message for an unknown username, an account without a code and a wrong code, so the
    // reply does not reveal which usernames exist or which accounts have a code.
    if (!row || !recoveryCodeMatches(input.recoveryCode, storedHash)) {
      throw new RuleError(401, "wrong-recovery-code", "Username or recovery code is incorrect.");
    }

    const userId = String(row.id);
    const passwordHash = await hashPassword(input.newPassword);
    const recoveryCode = generateRecoveryCode();
    // One atomic batch: new password, new code (the used one stops working), every session ended.
    await withWriteLock(db, () =>
      db.batch(
        [
          { sql: "UPDATE users SET password_hash = ?, recovery_hash = ? WHERE id = ?", args: [passwordHash, hashRecoveryCode(recoveryCode), userId] },
          { sql: "DELETE FROM sessions WHERE user_id = ?", args: [userId] },
        ],
        "write",
      ),
    );
    await clearLimit(db, LIMITS.recoverPerUsername, usernameKey);
    await clearLimit(db, LIMITS.loginPerUsername, usernameKey);

    const response = NextResponse.json({ user: { id: userId, username: String(row.username) }, recoveryCode });
    await createSession(userId, response);
    return response;
  } catch (error) {
    return errorResponse(error, "POST /api/auth/recover", "Could not reset the password.");
  }
}
