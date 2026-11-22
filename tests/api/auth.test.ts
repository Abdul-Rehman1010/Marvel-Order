/**
 * Account security (NEXT_LEVEL_PLAN.md package 1.4) and the owner's change to it: sessions never
 * expire. Every test uses its own temp FILE database under `.tmp/test-dbs-auth/`, never
 * `marvel-vault.db`, and loads fresh copies of the route modules pointed at it.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

import { createClient, type Client } from "@libsql/client";
import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { migrate } from "@/lib/migrations";

// Sign-in runs real bcrypt at cost 12 (about a quarter of a second per check), and some tests make
// dozens of attempts, so the default 5-second limit is too tight, more so on a shared CI machine.
vi.setConfig({ testTimeout: 60_000 });

const DB_DIR = path.join(process.cwd(), ".tmp", "test-dbs-auth");
mkdirSync(DB_DIR, { recursive: true });
for (const stale of readdirSync(DB_DIR)) removeQuietly(path.join(DB_DIR, stale));

/** Best-effort delete: on Windows SQLite can keep a closed file open until garbage collection. */
function removeQuietly(file: string) {
  try {
    rmSync(file, { force: true });
  } catch {
    // removed at the start of the next run instead
  }
}

const openClients: Client[] = [];
const createdFiles: string[] = [];

afterEach(() => {
  for (const client of openClients.splice(0)) client.close();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
});

afterAll(() => {
  for (const file of createdFiles) {
    for (const suffix of ["", "-journal", "-wal", "-shm"]) removeQuietly(`${file}${suffix}`);
  }
});

const DAY = 24 * 60 * 60 * 1000;
const FOUR_HUNDRED_DAYS_SECONDS = 400 * 24 * 60 * 60;
const PASSWORD = "correct-horse";

/** A migrated temp database plus fresh copies of every route, all pointed at it. */
async function newApp() {
  const name = `auth-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.db`;
  createdFiles.push(path.join(DB_DIR, name));
  const url = `file:.tmp/test-dbs-auth/${name}`;
  const client = createClient({ url });
  openClients.push(client);
  await migrate(client);

  vi.stubEnv("TURSO_DATABASE_URL", url);
  vi.resetModules();
  const login = await import("@/app/api/auth/login/route");
  const signup = await import("@/app/api/auth/signup/route");
  const logout = await import("@/app/api/auth/logout/route");
  const progress = await import("@/app/api/progress/route");
  const { db } = await import("@/lib/db");
  openClients.push(db);
  return { client, login: login.POST, signup: signup.POST, logout: logout.POST, getProgress: progress.GET, postProgress: progress.POST };
}

type RequestOptions = { ip?: string; origin?: string | null; cookie?: string; host?: string; method?: "GET" | "POST" };

function request(pathname: string, body?: unknown, options: RequestOptions = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", host: options.host ?? "localhost:3000" };
  if (options.ip) headers["x-forwarded-for"] = `${options.ip}, 10.0.0.1`;
  if (options.origin) headers.origin = options.origin;
  if (options.cookie) headers.cookie = options.cookie;
  const method = options.method ?? "POST";
  return new NextRequest(`http://localhost:3000${pathname}`, {
    method,
    headers,
    body: method === "POST" && body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/** The `nexus_session` cookie a response sets, parsed. */
function sessionCookie(response: Response) {
  const header = response.headers.getSetCookie().find((value) => value.startsWith("nexus_session="));
  if (!header) return null;
  const [pair, ...attributes] = header.split(";").map((part) => part.trim());
  const lower = attributes.map((attribute) => attribute.toLowerCase());
  return {
    value: pair.slice("nexus_session=".length),
    maxAge: Number(lower.find((attribute) => attribute.startsWith("max-age="))?.split("=")[1]),
    httpOnly: lower.includes("httponly"),
    sameSite: lower.find((attribute) => attribute.startsWith("samesite="))?.split("=")[1],
    path: lower.find((attribute) => attribute.startsWith("path="))?.split("=")[1],
  };
}

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

async function storedExpiry(client: Client, token: string) {
  const result = await client.execute({ sql: "SELECT expires_at FROM sessions WHERE token_hash = ?", args: [tokenHash(token)] });
  return result.rows[0] ? String(result.rows[0].expires_at) : null;
}

/** Signs up through the route and returns the session cookie value. */
async function signUp(app: Awaited<ReturnType<typeof newApp>>, username: string, ip = "198.51.100.1") {
  const response = await app.signup(request("/api/auth/signup", { username, password: PASSWORD }, { ip }));
  expect(response.status, await response.clone().text()).toBe(201);
  return sessionCookie(response)!.value;
}

const login = (app: Awaited<ReturnType<typeof newApp>>, username: string, password: string, ip = "198.51.100.1") =>
  app.login(request("/api/auth/login", { username, password }, { ip }));

describe("rate limits", () => {
  it("the ninth wrong sign-in for one username within 15 minutes is refused with 429 and Retry-After", async () => {
    const app = await newApp();
    await signUp(app, "peggy");

    for (let attempt = 1; attempt <= 8; attempt += 1) {
      // Different IPs, so only the per-username limit is in play.
      const response = await login(app, "peggy", "wrong-password", `203.0.113.${attempt}`);
      expect(response.status, `attempt ${attempt}`).toBe(401);
    }
    const ninth = await login(app, "Peggy", "wrong-password", "203.0.113.99"); // usernames are case-insensitive
    expect(ninth.status).toBe(429);
    const retryAfter = Number(ninth.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThan(14 * 60);
    expect(retryAfter).toBeLessThanOrEqual(15 * 60);
    expect(await ninth.json()).toMatchObject({ code: "rate-limited", error: "Too many attempts. Try again in 15 minutes." });

    // While limited, even the right password is refused: the limit is checked first.
    expect((await login(app, "peggy", PASSWORD, "203.0.113.100")).status).toBe(429);
  });

  it("the window ends after 15 minutes", async () => {
    const app = await newApp();
    await signUp(app, "peggy");
    for (let attempt = 1; attempt <= 9; attempt += 1) await login(app, "peggy", "wrong-password", `203.0.113.${attempt}`);
    expect((await login(app, "peggy", "wrong-password", "203.0.113.50")).status).toBe(429);

    // Move the window's end into the past, as if 15 minutes had gone by.
    await app.client.execute({ sql: "UPDATE rate_limits SET reset_at = ? WHERE bucket = ?", args: [Date.now() - 1, "login:user:peggy"] });
    expect((await login(app, "peggy", "wrong-password", "203.0.113.51")).status).toBe(401);
    expect((await app.client.execute("SELECT count FROM rate_limits WHERE bucket = 'login:user:peggy'")).rows[0].count).toBe(1);
  });

  it("a successful sign-in clears that username's count", async () => {
    const app = await newApp();
    await signUp(app, "peggy");
    for (let attempt = 1; attempt <= 7; attempt += 1) expect((await login(app, "peggy", "wrong-password")).status).toBe(401);
    expect((await login(app, "peggy", PASSWORD)).status).toBe(200);

    // A fresh allowance of eight.
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      expect((await login(app, "peggy", "wrong-password", `203.0.113.${attempt}`)).status, `attempt ${attempt}`).toBe(401);
    }
    expect((await login(app, "peggy", "wrong-password", "203.0.113.9")).status).toBe(429);
  });

  it("one IP gets 40 sign-in attempts per 15 minutes across all usernames", async () => {
    const app = await newApp();
    for (let attempt = 1; attempt <= 40; attempt += 1) {
      expect((await login(app, `nobody-${attempt}`, "wrong-password", "192.0.2.7")).status, `attempt ${attempt}`).toBe(401);
    }
    expect((await login(app, "nobody-41", "wrong-password", "192.0.2.7")).status).toBe(429);
    expect((await login(app, "nobody-41", "wrong-password", "192.0.2.8")).status).toBe(401);
  });

  it("one IP can create 5 accounts per hour", async () => {
    const app = await newApp();
    for (let account = 1; account <= 5; account += 1) await signUp(app, `recruit-${account}`, "192.0.2.20");

    const sixth = await app.signup(request("/api/auth/signup", { username: "recruit-6", password: PASSWORD }, { ip: "192.0.2.20" }));
    expect(sixth.status).toBe(429);
    expect(Number(sixth.headers.get("retry-after"))).toBeGreaterThan(59 * 60);
    expect((await sixth.json()).error).toBe("Too many attempts. Try again in 60 minutes.");
    expect((await app.client.execute("SELECT COUNT(*) AS n FROM users")).rows[0].n).toBe(5);

    await signUp(app, "recruit-6", "192.0.2.21");
  });

  it("reads the client IP from the first x-forwarded-for entry, then x-real-ip, else one shared bucket", async () => {
    const { clientIp } = await import("@/lib/http");
    const with_ = (headers: Record<string, string>) => clientIp(new Request("http://localhost/", { headers }));
    expect(with_({ "x-forwarded-for": "203.0.113.4, 10.0.0.1", "x-real-ip": "198.51.100.9" })).toBe("203.0.113.4");
    expect(with_({ "x-real-ip": "198.51.100.9" })).toBe("198.51.100.9");
    expect(with_({})).toBe("unknown");
  });
});

describe("sign-in", () => {
  it("compares against a dummy bcrypt hash when the username does not exist, so the timing is the same", async () => {
    const app = await newApp();
    await signUp(app, "peggy");
    const compare = vi.spyOn(bcrypt, "compare");

    const unknown = await login(app, "nobody-at-all", "some-password");
    const wrong = await login(app, "peggy", "some-password");

    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(await unknown.json()).toEqual(await wrong.json());
    expect(compare).toHaveBeenCalledTimes(2);
    const [unknownHash, realHash] = compare.mock.calls.map((call) => String(call[1]));
    expect(unknownHash).toMatch(/^\$2[aby]\$12\$/); // the same cost as a real account
    expect(realHash).toMatch(/^\$2[aby]\$12\$/);
    expect(unknownHash).not.toBe(realHash);
  });

  it("still accepts an existing password shorter than the new 8-character rule", async () => {
    const app = await newApp();
    await app.client.execute({
      sql: "INSERT INTO users (id, username, username_key, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
      args: ["old-user", "OldTimer", "oldtimer", await bcrypt.hash("abcd", 4), "2026-01-01T00:00:00.000Z"],
    });
    const response = await login(app, "OldTimer", "abcd");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ user: { id: "old-user", username: "OldTimer" } });
  });

  it("a malformed body is 400", async () => {
    const app = await newApp();
    expect((await app.login(request("/api/auth/login", { username: "" }))).status).toBe(400);
  });
});

describe("sign-up passwords", () => {
  it("a 7-character password is refused with 400; 8 and 72 characters are accepted; 73 is refused", async () => {
    const app = await newApp();
    const attempt = (username: string, password: string, ip: string) =>
      app.signup(request("/api/auth/signup", { username, password }, { ip }));

    const seven = await attempt("short-one", "1234567", "192.0.2.30");
    expect(seven.status).toBe(400);
    expect(await seven.json()).toEqual({ error: "Password must be at least 8 characters.", code: "invalid" });
    expect((await attempt("eight-ok", "12345678", "192.0.2.31")).status).toBe(201);
    expect((await attempt("long-ok", "x".repeat(72), "192.0.2.32")).status).toBe(201);
    expect((await attempt("too-long", "x".repeat(73), "192.0.2.33")).status).toBe(400);
  });

  it("a taken username is 409 with a plain message", async () => {
    const app = await newApp();
    await signUp(app, "peggy", "192.0.2.40");
    const again = await app.signup(request("/api/auth/signup", { username: "PEGGY", password: PASSWORD }, { ip: "192.0.2.41" }));
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "That username is already registered.", code: "username-taken" });
  });
});

describe("same-origin check", () => {
  it("refuses a POST from another site on every state-changing route, and changes nothing", async () => {
    const app = await newApp();
    const cookie = `nexus_session=${await signUp(app, "peggy")}`;
    const evil = { origin: "https://evil.example", cookie };

    const responses = [
      await app.login(request("/api/auth/login", { username: "peggy", password: PASSWORD }, evil)),
      await app.signup(request("/api/auth/signup", { username: "intruder", password: PASSWORD }, evil)),
      await app.postProgress(request("/api/progress", { action: { type: "watch", contentId: "iron-man", episode: -1 } }, evil)),
      await app.logout(request("/api/auth/logout", undefined, evil)),
    ];
    for (const response of responses) {
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "This request came from another site and was refused.", code: "cross-origin" });
    }

    expect((await app.client.execute("SELECT COUNT(*) AS n FROM users")).rows[0].n).toBe(1);
    expect((await app.client.execute("SELECT COUNT(*) AS n FROM progress")).rows[0].n).toBe(0);
    expect((await app.client.execute("SELECT COUNT(*) AS n FROM sessions")).rows[0].n).toBe(1); // logout did not run
  });

  it("allows the app's own origin, a request without Origin, and the host Vercel forwards", async () => {
    const app = await newApp();
    const token = await signUp(app, "peggy");
    const action = { action: { type: "watch", contentId: "iron-man", episode: -1 } };

    expect((await app.postProgress(request("/api/progress", action, { origin: "http://localhost:3000", cookie: `nexus_session=${token}` }))).status).toBe(200);
    expect((await app.postProgress(request("/api/progress", action, { cookie: `nexus_session=${token}` }))).status).toBe(200);

    const { assertSameOrigin } = await import("@/lib/http");
    const forwarded = new Request("http://internal:3000/api/progress", {
      method: "POST",
      headers: { origin: "https://doomflix.example", host: "internal:3000", "x-forwarded-host": "doomflix.example" },
    });
    expect(() => assertSameOrigin(forwarded)).not.toThrow();
    // An opaque origin ("null") and a different port are refused.
    expect(() => assertSameOrigin(new Request("http://localhost:3000/", { method: "POST", headers: { origin: "null", host: "localhost:3000" } }))).toThrow();
    expect(() => assertSameOrigin(new Request("http://localhost:3000/", { method: "POST", headers: { origin: "http://localhost:4000", host: "localhost:3000" } }))).toThrow();
  });
});

describe("sessions never expire (owner change to 1.4)", () => {
  it("sign-up and sign-in set the cookie for 400 days, the longest browsers keep one", async () => {
    const app = await newApp();
    const signup = await app.signup(request("/api/auth/signup", { username: "peggy", password: PASSWORD }, { ip: "192.0.2.60" }));
    const signin = await login(app, "peggy", PASSWORD, "192.0.2.61");

    for (const response of [signup, signin]) {
      const cookie = sessionCookie(response)!;
      expect(cookie).toMatchObject({ maxAge: FOUR_HUNDRED_DAYS_SECONDS, httpOnly: true, sameSite: "lax", path: "/" });
      const expiry = Date.parse((await storedExpiry(app.client, cookie.value))!);
      expect(Math.abs(expiry - (Date.now() + 400 * DAY))).toBeLessThan(60_000);
    }
  });

  it("a session is never refused for its age, and opening the app pushes it back to 400 days", async () => {
    const app = await newApp();
    const token = await signUp(app, "peggy");
    // As if it were last extended long ago (and even past the old 30-day expiry).
    await app.client.execute({ sql: "UPDATE sessions SET expires_at = ? WHERE token_hash = ?", args: ["2025-01-01T00:00:00.000Z", tokenHash(token)] });

    const response = await app.getProgress(request("/api/progress", undefined, { method: "GET", cookie: `nexus_session=${token}` }));

    expect(response.status).toBe(200);
    expect((await response.json()).user.username).toBe("peggy");
    const cookie = sessionCookie(response)!;
    expect(cookie).toMatchObject({ value: token, maxAge: FOUR_HUNDRED_DAYS_SECONDS, httpOnly: true });
    const expiry = Date.parse((await storedExpiry(app.client, token))!);
    expect(Math.abs(expiry - (Date.now() + 400 * DAY))).toBeLessThan(60_000);
  });

  it("is extended at most once a day: a recently extended session is left alone", async () => {
    const app = await newApp();
    const token = await signUp(app, "peggy");
    const before = await storedExpiry(app.client, token);

    const response = await app.getProgress(request("/api/progress", undefined, { method: "GET", cookie: `nexus_session=${token}` }));

    expect(response.status).toBe(200);
    expect(sessionCookie(response)).toBeNull();
    expect(await storedExpiry(app.client, token)).toBe(before);
  });

  it("a session from before this change (30-day expiry) keeps working and is upgraded", async () => {
    const app = await newApp();
    await app.client.execute({
      sql: "INSERT INTO users (id, username, username_key, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
      args: ["u-old", "Veteran", "veteran", "not-a-real-hash", "2026-01-01T00:00:00.000Z"],
    });
    const token = "an-old-session-token";
    const thirtyDays = new Date(Date.now() + 20 * DAY).toISOString(); // created 10 days ago with the old 30-day rule
    await app.client.execute({
      sql: "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
      args: [tokenHash(token), "u-old", thirtyDays, new Date(Date.now() - 10 * DAY).toISOString()],
    });

    const response = await app.getProgress(request("/api/progress", undefined, { method: "GET", cookie: `nexus_session=${token}` }));

    expect(response.status).toBe(200);
    expect(sessionCookie(response)?.maxAge).toBe(FOUR_HUNDRED_DAYS_SECONDS);
    expect(Date.parse((await storedExpiry(app.client, token))!)).toBeGreaterThan(Date.now() + 399 * DAY);
  });

  it("signing out still ends the session", async () => {
    const app = await newApp();
    const token = await signUp(app, "peggy");
    const cookie = `nexus_session=${token}`;

    const response = await app.logout(request("/api/auth/logout", undefined, { cookie }));

    expect(response.status).toBe(200);
    expect(sessionCookie(response)).toMatchObject({ value: "", maxAge: 0 });
    expect(await storedExpiry(app.client, token)).toBeNull();
    expect((await app.getProgress(request("/api/progress", undefined, { method: "GET", cookie }))).status).toBe(401);
  });

  it("each sign-in tidies away only rows whose cookie no browser can still hold", async () => {
    const app = await newApp();
    const current = await signUp(app, "peggy", "192.0.2.70");
    const insert = (token: string, expiresAt: string) =>
      app.client.execute({
        sql: "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, (SELECT id FROM users WHERE username_key = 'peggy'), ?, ?)",
        args: [tokenHash(token), expiresAt, "2025-01-01T00:00:00.000Z"],
      });
    await insert("long-gone", new Date(Date.now() - 3 * DAY).toISOString()); // the browser dropped this cookie days ago
    await insert("just-lapsed", new Date(Date.now() - 60_000).toISOString()); // within the one-day grace

    expect((await login(app, "peggy", PASSWORD, "192.0.2.71")).status).toBe(200);

    expect(await storedExpiry(app.client, "long-gone")).toBeNull();
    expect(await storedExpiry(app.client, "just-lapsed")).not.toBeNull();
    expect(await storedExpiry(app.client, current)).not.toBeNull();
  });
});

describe("unexpected failures", () => {
  it("are a generic 500: the detail is logged, not sent", async () => {
    const app = await newApp();
    await app.client.execute("DROP TABLE rate_limits");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await login(app, "peggy", PASSWORD);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: "Could not sign in." });
    expect(String(logged.mock.calls[0]?.[1])).toMatch(/no such table/i);
  });
});
