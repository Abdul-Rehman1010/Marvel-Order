import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { db, ensureDatabase } from "@/lib/db";
import { assertSameOrigin, clientIp, errorResponse, jsonError, RuleError } from "@/lib/http";
import { verifyPassword } from "@/lib/passwords";
import { clearLimit, deleteEndedWindows, enforceLimits, LIMITS } from "@/lib/rate-limit";
import { createSession, deleteForgottenSessions } from "@/lib/session";

export const runtime = "nodejs";

// Sign-in accepts any existing password, including ones shorter than today's 8-character rule.
const credentials = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(200),
});

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    await ensureDatabase();

    let input: z.infer<typeof credentials>;
    try {
      input = credentials.parse(await request.json());
    } catch {
      return jsonError(400, "Enter both username and password.", { code: "invalid" });
    }
    const usernameKey = input.username.toLocaleLowerCase();

    // Every attempt counts; a successful one clears the username's count below.
    await enforceLimits(db, [
      { limit: LIMITS.loginPerUsername, key: usernameKey },
      { limit: LIMITS.loginPerIp, key: clientIp(request) },
    ]);

    const result = await db.execute({
      sql: "SELECT id, username, password_hash FROM users WHERE username_key = ?",
      args: [usernameKey],
    });
    const row = result.rows[0];
    // Always runs bcrypt, against a dummy hash when there is no such user, so the time taken
    // does not reveal whether the username exists.
    const valid = await verifyPassword(input.password, row ? String(row.password_hash) : null);
    if (!row || !valid) throw new RuleError(401, "wrong-credentials", "Username or password is incorrect.");

    await clearLimit(db, LIMITS.loginPerUsername, usernameKey);
    // Housekeeping: rows whose cookie no browser can still hold, and rate-limit windows that ended.
    await deleteForgottenSessions();
    await deleteEndedWindows(db);

    const user = { id: String(row.id), username: String(row.username) };
    const response = NextResponse.json({ user });
    await createSession(user.id, response);
    return response;
  } catch (error) {
    return errorResponse(error, "POST /api/auth/login", "Could not sign in.");
  }
}
