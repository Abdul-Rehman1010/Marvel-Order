import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { authorizeAccountChange, currentPasswordField, deleteAccount, usernameKeyOf } from "@/lib/account";
import { errorResponse, RuleError } from "@/lib/http";
import { clearSessionCookie } from "@/lib/session";

export const runtime = "nodejs";

const body = z.object({
  currentPassword: currentPasswordField,
  confirmUsername: z.string().trim().min(1, "Type your username to confirm.").max(100),
});

/**
 * Deletes the signed-in account and everything stored for it (progress, skips, sessions, its
 * rate-limit counters) in one atomic batch. Requires the current password and the username typed
 * out (any letter case).
 */
export async function DELETE(request: NextRequest) {
  try {
    const { session, input } = await authorizeAccountChange(request, body);
    const usernameKey = usernameKeyOf(session.user.username);
    if (usernameKeyOf(input.confirmUsername) !== usernameKey) {
      throw new RuleError(400, "confirm-mismatch", "The username you typed does not match this account.");
    }
    await deleteAccount(session.user.id, usernameKey);
    const response = NextResponse.json({ ok: true });
    clearSessionCookie(response);
    return response;
  } catch (error) {
    return errorResponse(error, "DELETE /api/account", "Could not delete the account.");
  }
}
