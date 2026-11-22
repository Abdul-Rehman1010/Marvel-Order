import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { authorizeAccountChange, currentPasswordField } from "@/lib/account";
import { db } from "@/lib/db";
import { errorResponse } from "@/lib/http";
import { hashPassword, newPasswordSchema } from "@/lib/passwords";
import { withWriteLock } from "@/lib/write-lock";

export const runtime = "nodejs";

const body = z.object({ currentPassword: currentPasswordField, newPassword: newPasswordSchema });

/** Changes the password. Every session stays signed in; "Sign out everywhere" is a separate action. */
export async function POST(request: NextRequest) {
  try {
    const { session, input } = await authorizeAccountChange(request, body);
    const passwordHash = await hashPassword(input.newPassword);
    await withWriteLock(db, () =>
      db.execute({ sql: "UPDATE users SET password_hash = ? WHERE id = ?", args: [passwordHash, session.user.id] }),
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, "POST /api/account/password", "Could not change the password.");
  }
}
