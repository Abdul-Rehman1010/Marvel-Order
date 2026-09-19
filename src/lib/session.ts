import "server-only";

import { createHash, randomBytes } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";

import { db, ensureDatabase } from "@/lib/db";

export const SESSION_COOKIE = "nexus_session";
const SESSION_LIFETIME_SECONDS = 60 * 60 * 24 * 30;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function requestToken(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    const token = authorization.slice("Bearer ".length).trim();
    if (token) return token;
  }
  return request.cookies.get(SESSION_COOKIE)?.value;
}

export async function createSession(userId: string, response: NextResponse) {
  await ensureDatabase();
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_LIFETIME_SECONDS * 1000);

  await db.execute({
    sql: "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
    args: [hashToken(token), userId, expires.toISOString(), now.toISOString()],
  });

  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_LIFETIME_SECONDS,
  });

  return token;
}

export async function deleteSession(request: NextRequest, response: NextResponse) {
  await ensureDatabase();
  const token = requestToken(request);
  if (token) {
    await db.execute({
      sql: "DELETE FROM sessions WHERE token_hash = ?",
      args: [hashToken(token)],
    });
  }
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export type SessionUser = { id: string; username: string };

export async function getSessionUser(request: NextRequest): Promise<SessionUser | null> {
  await ensureDatabase();
  const token = requestToken(request);
  if (!token) return null;

  const result = await db.execute({
    sql: `SELECT users.id, users.username, sessions.expires_at
          FROM sessions
          JOIN users ON users.id = sessions.user_id
          WHERE sessions.token_hash = ?`,
    args: [hashToken(token)],
  });
  const row = result.rows[0];
  if (!row) return null;

  if (new Date(String(row.expires_at)).getTime() <= Date.now()) {
    await db.execute({
      sql: "DELETE FROM sessions WHERE token_hash = ?",
      args: [hashToken(token)],
    });
    return null;
  }

  return { id: String(row.id), username: String(row.username) };
}
