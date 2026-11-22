import { type NextRequest, NextResponse } from "next/server";

import { assertSameOrigin, errorResponse } from "@/lib/http";
import { deleteSession } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const response = NextResponse.json({ ok: true });
    await deleteSession(request, response);
    return response;
  } catch (error) {
    return errorResponse(error, "POST /api/auth/logout", "Could not sign out.");
  }
}
