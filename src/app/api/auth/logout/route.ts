import { type NextRequest, NextResponse } from "next/server";

import { apiPreflight, withApiCors } from "@/lib/api-cors";
import { deleteSession } from "@/lib/session";

export const runtime = "nodejs";

export function OPTIONS(request: Request) {
  return apiPreflight(request, ["POST"]);
}

export async function POST(request: NextRequest) {
  const response = NextResponse.json({ ok: true });
  await deleteSession(request, response);
  return withApiCors(request, response);
}
