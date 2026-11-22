/**
 * Shared pieces for route handlers (NEXT_LEVEL_PLAN.md §4.5, package 1.4).
 *
 * - `assertSameOrigin(request)`: every state-changing handler calls it first. A browser always
 *   sends `Origin` on a cross-site POST, so a request whose `Origin` names another host is
 *   refused with 403. A request without `Origin` (curl, server-to-server) is allowed: it cannot
 *   carry another site's user's cookie, which is what this guards against.
 * - `RuleError`: thrown for an expected refusal (wrong password, rate limit, taken username).
 *   `errorResponse` turns it into JSON with its own status; anything else is logged and becomes
 *   a generic 500, so internal messages never reach the client.
 */
import "server-only";

import { NextResponse } from "next/server";

export type ErrorBody = { error: string; code?: string } & Record<string, unknown>;

/** An expected refusal with a message written for the user. */
export class RuleError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Record<string, unknown>;
  readonly headers: Record<string, string>;

  constructor(
    status: number,
    code: string,
    message: string,
    options: { extra?: Record<string, unknown>; headers?: Record<string, string> } = {},
  ) {
    super(message);
    this.name = "RuleError";
    this.status = status;
    this.code = code;
    this.extra = options.extra ?? {};
    this.headers = options.headers ?? {};
  }
}

/** A JSON error reply: `{ error, code?, ...extra }`. */
export function jsonError(
  status: number,
  error: string,
  options: { code?: string; extra?: Record<string, unknown>; headers?: Record<string, string> } = {},
) {
  const body: ErrorBody = { error, ...(options.code ? { code: options.code } : {}), ...(options.extra ?? {}) };
  return NextResponse.json(body, { status, headers: options.headers });
}

/**
 * The reply for anything a handler throws. A `RuleError` keeps its status and message;
 * anything else is logged with `context` and answered with `fallback` as a 500.
 */
export function errorResponse(error: unknown, context: string, fallback = "Something went wrong. Try again.") {
  if (error instanceof RuleError) {
    return jsonError(error.status, error.message, { code: error.code, extra: error.extra, headers: error.headers });
  }
  console.error(`${context} failed`, error);
  return jsonError(500, fallback);
}

/**
 * The host the browser asked for: the first `x-forwarded-host` (set by Vercel's proxy), else
 * `host`, else the host of the request URL.
 */
export function requestHost(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const header = forwarded || request.headers.get("host")?.trim();
  if (header) return header.toLowerCase();
  try {
    return new URL(request.url).host.toLowerCase();
  } catch {
    return null;
  }
}

/** Throws a 403 `RuleError` when the request carries an `Origin` for a different host. */
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin === null) return;
  let originHost: string | null = null;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    originHost = null; // "null" (a sandboxed frame or a privacy redirect) or garbage
  }
  if (!originHost || originHost !== requestHost(request)) {
    throw new RuleError(403, "cross-origin", "This request came from another site and was refused.");
  }
}

/**
 * The client's IP address for rate limiting: the first entry of `x-forwarded-for` (Vercel puts
 * the real client there), else `x-real-ip`, else `"unknown"` (every such request shares one bucket).
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}
