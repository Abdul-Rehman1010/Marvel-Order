import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { authorizeAccountChange, currentPasswordField, deleteUserSessions } from "@/lib/account";
import { errorResponse } from "@/lib/http";
import { clearSessionCookie } from "@/lib/session";

export const runtime = "nodejs";

const body = z.object({ currentPassword: currentPasswordField });

/**
 * Signs the account out on every device, including this one. Sessions never expire (package 1.4),
 * so this is how a user ends a session on a lost or shared device.
 */
export async function POST(request: NextRequest) {
  try {
    const { session } = await authorizeAccountChange(request, body);
    await deleteUserSessions(session.user.id);
    const response = NextResponse.json({ ok: true });
    clearSessionCookie(response);
    return response;
  } catch (error) {
    return errorResponse(error, "POST /api/account/sessions/revoke", "Could not sign out everywhere.");
  }
}
