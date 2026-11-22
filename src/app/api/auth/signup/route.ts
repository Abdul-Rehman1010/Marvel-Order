import { randomUUID } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { generateRecoveryCode, hashRecoveryCode } from "@/lib/account";
import { db, ensureDatabase } from "@/lib/db";
import { assertSameOrigin, clientIp, errorResponse, jsonError, RuleError } from "@/lib/http";
import { hashPassword, newPasswordSchema } from "@/lib/passwords";
import { enforceLimits, LIMITS } from "@/lib/rate-limit";
import { createSession } from "@/lib/session";
import { withWriteLock } from "@/lib/write-lock";

export const runtime = "nodejs";

const credentials = z.object({
  username: z.string().trim().min(3, "Username must be at least 3 characters.").max(24, "Username must be 24 characters or fewer.").regex(/^[a-zA-Z0-9_-]+$/, "Use only letters, numbers, underscores, and hyphens."),
  password: newPasswordSchema,
});

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    await ensureDatabase();
    await enforceLimits(db, [{ limit: LIMITS.signupPerIp, key: clientIp(request) }]);

    let input: z.infer<typeof credentials>;
    try {
      input = credentials.parse(await request.json());
    } catch (error) {
      const message = error instanceof z.ZodError ? error.issues[0]?.message : undefined;
      return jsonError(400, message ?? "Invalid account details.", { code: "invalid" });
    }

    const id = randomUUID();
    const passwordHash = await hashPassword(input.password);
    // Shown to the user exactly once, in this response; only its hash is stored.
    const recoveryCode = generateRecoveryCode();
    try {
      await withWriteLock(db, () =>
        db.execute({
          sql: "INSERT INTO users (id, username, username_key, password_hash, recovery_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)",
          args: [id, input.username, input.username.toLocaleLowerCase(), passwordHash, hashRecoveryCode(recoveryCode), new Date().toISOString()],
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.toLowerCase().includes("unique")) throw new RuleError(409, "username-taken", "That username is already registered.");
      throw error;
    }

    const response = NextResponse.json({ user: { id, username: input.username }, recoveryCode }, { status: 201 });
    await createSession(id, response);
    return response;
  } catch (error) {
    return errorResponse(error, "POST /api/auth/signup", "Could not create the account.");
  }
}
