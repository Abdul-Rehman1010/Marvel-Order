/**
 * Loads fresh copies of the app's route handlers pointed at a new, migrated temp FILE database,
 * for API tests. Never `marvel-vault.db`. Call `cleanUpApps()` in `afterEach` and
 * `removeAppDatabases()` in `afterAll`.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

import { createClient, type Client } from "@libsql/client";
import { NextRequest } from "next/server";
import { expect, vi } from "vitest";

import { migrate } from "@/lib/migrations";

const openClients: Client[] = [];
const createdFiles: string[] = [];

/** Best-effort delete: on Windows SQLite can keep a closed file open until garbage collection. */
function removeQuietly(file: string) {
  try {
    rmSync(file, { force: true });
  } catch {
    // removed at the start of the next run instead
  }
}

/** Prepares `.tmp/<folder>/` and clears what an earlier run could not delete. */
export function prepareDatabaseFolder(folder: string) {
  const dir = path.join(process.cwd(), ".tmp", folder);
  mkdirSync(dir, { recursive: true });
  for (const stale of readdirSync(dir)) removeQuietly(path.join(dir, stale));
  return folder;
}

export async function newApp(folder: string) {
  const name = `app-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.db`;
  createdFiles.push(path.join(process.cwd(), ".tmp", folder, name));
  const url = `file:.tmp/${folder}/${name}`;
  const client = createClient({ url });
  openClients.push(client);
  await migrate(client);

  vi.stubEnv("TURSO_DATABASE_URL", url);
  vi.resetModules();
  const routes = {
    login: (await import("@/app/api/auth/login/route")).POST,
    signup: (await import("@/app/api/auth/signup/route")).POST,
    logout: (await import("@/app/api/auth/logout/route")).POST,
    recover: (await import("@/app/api/auth/recover/route")).POST,
    changePassword: (await import("@/app/api/account/password/route")).POST,
    newRecoveryCode: (await import("@/app/api/account/recovery-code/route")).POST,
    revokeSessions: (await import("@/app/api/account/sessions/revoke/route")).POST,
    deleteAccount: (await import("@/app/api/account/route")).DELETE,
    getProgress: (await import("@/app/api/progress/route")).GET,
    postProgress: (await import("@/app/api/progress/route")).POST,
  };
  const { db } = await import("@/lib/db");
  openClients.push(db);
  return { url, client, ...routes };
}

export type App = Awaited<ReturnType<typeof newApp>>;

export function cleanUpApps() {
  for (const client of openClients.splice(0)) client.close();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
}

export function removeAppDatabases() {
  for (const file of createdFiles) {
    for (const suffix of ["", "-journal", "-wal", "-shm"]) removeQuietly(`${file}${suffix}`);
  }
}

export type RequestOptions = { ip?: string; origin?: string | null; cookie?: string; method?: "GET" | "POST" | "DELETE" };

export function apiRequest(pathname: string, body?: unknown, options: RequestOptions = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", host: "localhost:3000" };
  if (options.ip) headers["x-forwarded-for"] = options.ip;
  if (options.origin) headers.origin = options.origin;
  if (options.cookie) headers.cookie = options.cookie;
  const method = options.method ?? "POST";
  return new NextRequest(`http://localhost:3000${pathname}`, {
    method,
    headers,
    body: method !== "GET" && body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/** The `nexus_session` cookie a response sets, or `null`. */
export function sessionCookie(response: Response) {
  const header = response.headers.getSetCookie().find((value) => value.startsWith("nexus_session="));
  if (!header) return null;
  const [pair, ...attributes] = header.split(";").map((part) => part.trim());
  const maxAge = attributes.map((attribute) => attribute.toLowerCase()).find((attribute) => attribute.startsWith("max-age="));
  return { value: pair.slice("nexus_session=".length), maxAge: maxAge ? Number(maxAge.split("=")[1]) : undefined };
}

export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

/** Signs up through the route; returns the session cookie header value and the recovery code. */
export async function signUp(app: App, username: string, password: string, ip = "198.51.100.1") {
  const response = await app.signup(apiRequest("/api/auth/signup", { username, password }, { ip }));
  expect(response.status, await response.clone().text()).toBe(201);
  const body = await response.json();
  return { cookie: `nexus_session=${sessionCookie(response)!.value}`, recoveryCode: body.recoveryCode as string, userId: body.user.id as string };
}

export async function count(client: Client, sql: string, args: (string | number)[] = []) {
  return Number((await client.execute({ sql, args })).rows[0].n);
}
