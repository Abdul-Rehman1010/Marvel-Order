import "server-only";

import { createHash, randomBytes } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";

import { db, ensureDatabase } from "@/lib/db";
import { withWriteLock } from "@/lib/write-lock";

/**
 * Sessions never expire (owner decision, package 1.4): the app holds no confidential data, and
 * people come back after long breaks, so they should not have to sign in again.
 *
 * The one limit the app cannot change is the browser's: Chrome and Edge keep a cookie for at most
 * 400 days. So the cookie is set for the full 400 days at sign-in and pushed back to 400 days
 * again whenever the user opens the app (at most once a day, to avoid a database write per
 * request). Only someone who does not open the app for more than 400 days, or who clears their
 * browser data, has to sign in again.
 *
 * The server never refuses a session for its age. `sessions.expires_at` now records when the
 * browser will have dropped the cookie (last extension + 400 days); it is used only to tidy away
 * rows whose cookie can no longer exist. A rollback to the pre-1.4 code keeps working: it reads
 * `expires_at` as an expiry, and every extended row is far in the future.
 */
export const SESSION_COOKIE = "nexus_session";
/** The longest cookie lifetime browsers honour (Chrome and Edge cap `Max-Age` at 400 days). */
export const SESSION_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;
/** A session is pushed back to the full lifetime when it was last extended more than this long ago. */
const EXTEND_AFTER_MS = 24 * 60 * 60 * 1000;
/** Rows are tidied away only this long after their cookie must be gone, to allow for clock differences. */
const TIDY_GRACE_MS = 24 * 60 * 60 * 1000;

const LIFETIME_MS = SESSION_COOKIE_MAX_AGE_SECONDS * 1000;

export type SessionUser = { id: string; username: string };

/**
 * A signed-in request. `token` is the raw cookie value: never send it to the client.
 * `hasRecoveryCode` is false for accounts created before package 1.5 until they make one.
 */
export type Session = { user: SessionUser; token: string; expiresAt: string; hasRecoveryCode: boolean };

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function requestToken(request: NextRequest) {
  return request.cookies.get(SESSION_COOKIE)?.value;
}

function setSessionCookie(response: NextResponse, token: string) {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  });
}

export async function createSession(userId: string, response: NextResponse, now = new Date()) {
  await ensureDatabase();
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(now.getTime() + LIFETIME_MS);

  await withWriteLock(db, () =>
    db.execute({
      sql: "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
      args: [hashToken(token), userId, expires.toISOString(), now.toISOString()],
    }),
  );
  setSessionCookie(response, token);
}

export async function deleteSession(request: NextRequest, response: NextResponse) {
  await ensureDatabase();
  const token = requestToken(request);
  if (token) {
    await withWriteLock(db, () => db.execute({ sql: "DELETE FROM sessions WHERE token_hash = ?", args: [hashToken(token)] }));
  }
  clearSessionCookie(response);
}

/** Tells the browser to drop the session cookie. */
export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

/** The session behind the request's cookie, or `null`. A session is valid for as long as its row exists. */
export async function getSession(request: NextRequest): Promise<Session | null> {
  await ensureDatabase();
  const token = requestToken(request);
  if (!token) return null;

  const result = await db.execute({
    sql: `SELECT users.id, users.username, sessions.expires_at, users.recovery_hash IS NOT NULL AS has_recovery_code
          FROM sessions
          JOIN users ON users.id = sessions.user_id
          WHERE sessions.token_hash = ?`,
    args: [hashToken(token)],
  });
  const row = result.rows[0];
  if (!row) return null;
  return {
    user: { id: String(row.id), username: String(row.username) },
    token,
    expiresAt: String(row.expires_at),
    hasRecoveryCode: Number(row.has_recovery_code) === 1,
  };
}

export async function getSessionUser(request: NextRequest): Promise<SessionUser | null> {
  return (await getSession(request))?.user ?? null;
}

/**
 * Pushes the session's cookie (and its row) back to the full 400 days, if it was last extended
 * more than a day ago. Call it from route handlers only: a cookie can only be set on a response,
 * not while a Server Component renders. The app calls it on every load (`GET /api/progress`).
 */
export async function extendSession(session: Session, response: NextResponse, now = new Date()) {
  const due = Date.parse(session.expiresAt) < now.getTime() + LIFETIME_MS - EXTEND_AFTER_MS;
  // An unreadable stored date is treated as due, so the row is repaired.
  if (!due && !Number.isNaN(Date.parse(session.expiresAt))) return false;

  const expires = new Date(now.getTime() + LIFETIME_MS).toISOString();
  await withWriteLock(db, () =>
    db.execute({ sql: "UPDATE sessions SET expires_at = ? WHERE token_hash = ?", args: [expires, hashToken(session.token)] }),
  );
  setSessionCookie(response, session.token);
  return true;
}

/** Deletes session rows whose cookie the browser must already have dropped. Run on each sign-in. */
export async function deleteForgottenSessions(now = new Date()) {
  const cutoff = new Date(now.getTime() - TIDY_GRACE_MS).toISOString();
  await withWriteLock(db, () => db.execute({ sql: "DELETE FROM sessions WHERE expires_at < ?", args: [cutoff] }));
}
