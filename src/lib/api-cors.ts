import "server-only";

import { NextResponse } from "next/server";

const CAPACITOR_ORIGINS = new Set([
  "capacitor://localhost",
  "https://localhost",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

function allowedOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return origin && CAPACITOR_ORIGINS.has(origin) ? origin : null;
}

export function isCapacitorRequest(request: Request) {
  return request.headers.get("x-nexus-client") === "capacitor" && Boolean(allowedOrigin(request));
}

export function withApiCors(request: Request, response: NextResponse) {
  const origin = allowedOrigin(request);
  if (!origin) return response;

  response.headers.set("Access-Control-Allow-Origin", origin);
  response.headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Nexus-Client");
  response.headers.set("Access-Control-Expose-Headers", "X-Nexus-Session");
  response.headers.set("Vary", "Origin");
  return response;
}

export function apiJson(request: Request, body: unknown, init?: ResponseInit) {
  return withApiCors(request, NextResponse.json(body, init));
}

export function apiPreflight(request: Request, methods: string[]) {
  const response = new NextResponse(null, { status: 204 });
  response.headers.set("Access-Control-Allow-Methods", [...methods, "OPTIONS"].join(", "));
  response.headers.set("Access-Control-Max-Age", "86400");
  return withApiCors(request, response);
}
