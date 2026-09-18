import { type NextRequest, NextResponse } from "next/server";

import { deleteSession } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const response = NextResponse.json({ ok: true });
  await deleteSession(request, response);
  return response;
}

