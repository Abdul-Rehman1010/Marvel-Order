/**
 * Account recovery and the account panel endpoints (NEXT_LEVEL_PLAN.md package 1.5). Each
 * endpoint is tested for success, a wrong password or code, and its rate limit.
 */
import bcrypt from "bcryptjs";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { generateRecoveryCode, hashRecoveryCode, normalizeRecoveryCode, recoveryCodeMatches } from "@/lib/account";

import {
  apiRequest,
  cleanUpApps,
  count,
  newApp,
  prepareDatabaseFolder,
  removeAppDatabases,
  sessionCookie,
  signUp,
  tokenHash,
  type App,
} from "../helpers/api-app";

// Real bcrypt at cost 12 (about a quarter of a second per check); some tests make many attempts.
vi.setConfig({ testTimeout: 60_000 });

const FOLDER = prepareDatabaseFolder("test-dbs-account");
afterEach(cleanUpApps);
afterAll(removeAppDatabases);

const PASSWORD = "correct-horse";
const NEW_PASSWORD = "battery-staple";
const CODE_FORMAT = /^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}$/;

const login = (app: App, username: string, password: string, ip = "198.51.100.1") =>
  app.login(apiRequest("/api/auth/login", { username, password }, { ip }));
const recover = (app: App, body: Record<string, unknown>, ip = "198.51.100.1") => app.recover(apiRequest("/api/auth/recover", body, { ip }));
const progressOf = (app: App, cookie: string) => app.getProgress(apiRequest("/api/progress", undefined, { method: "GET", cookie }));

describe("recovery codes", () => {
  it("are 20 Crockford base-32 symbols in four groups of five, and random", () => {
    const codes = new Set(Array.from({ length: 200 }, generateRecoveryCode));
    expect(codes.size).toBe(200);
    for (const code of codes) expect(code).toMatch(CODE_FORMAT);
  });

  it("are read back forgiving case, spaces, dashes, O for 0 and I or L for 1", () => {
    const code = "7K2QM-0XRTB-H4ZPA-9WCNE";
    const hash = hashRecoveryCode(code);
    for (const typed of ["7k2qm0xrtbh4zpa9wcne", " 7K2QM 0XRTB H4ZPA 9WCNE ", "7K2QM-OXRTB-H4ZPA-9WCNE"]) {
      expect(recoveryCodeMatches(typed, hash), typed).toBe(true);
    }
    expect(normalizeRecoveryCode("1111I-LLLLL-iiiii-lllll")).toBe("11111111111111111111");
    expect(recoveryCodeMatches("7K2QM-0XRTB-H4ZPA-9WCNF", hash)).toBe(false);
    expect(recoveryCodeMatches("7K2QM-0XRTB-H4ZPA", hash)).toBe(false);
    expect(recoveryCodeMatches("7K2QM-0XRTB-H4ZPA-9WCNU", hash)).toBe(false); // U is not in the alphabet
    expect(recoveryCodeMatches(code, null)).toBe(false);
  });
});

describe("sign-up", () => {
  it("returns a recovery code once and stores only its hash", async () => {
    const app = await newApp(FOLDER);
    const { recoveryCode, userId } = await signUp(app, "peggy", PASSWORD);

    expect(recoveryCode).toMatch(CODE_FORMAT);
    const stored = String((await app.client.execute({ sql: "SELECT recovery_hash FROM users WHERE id = ?", args: [userId] })).rows[0].recovery_hash);
    expect(stored).toBe(hashRecoveryCode(recoveryCode));
    expect(stored).not.toContain(recoveryCode.replace(/-/g, ""));

    const body = await (await progressOf(app, (await signUp(app, "sharon", PASSWORD, "198.51.100.2")).cookie)).json();
    expect(body.account).toEqual({ hasRecoveryCode: true });
  });

  it("an account from before 1.5 reports that it has no recovery code", async () => {
    const app = await newApp(FOLDER);
    const { cookie, userId } = await signUp(app, "peggy", PASSWORD);
    await app.client.execute({ sql: "UPDATE users SET recovery_hash = NULL WHERE id = ?", args: [userId] });
    expect((await (await progressOf(app, cookie)).json()).account).toEqual({ hasRecoveryCode: false });
  });
});

describe("POST /api/auth/recover", () => {
  it("resets the password, issues a new code, ends every session and signs this device in", async () => {
    const app = await newApp(FOLDER);
    const { cookie: firstDevice, recoveryCode } = await signUp(app, "peggy", PASSWORD);
    const secondDevice = `nexus_session=${sessionCookie(await login(app, "peggy", PASSWORD))!.value}`;

    const response = await recover(app, { username: "Peggy", recoveryCode: recoveryCode.toLowerCase(), newPassword: NEW_PASSWORD });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.user.username).toBe("peggy");
    expect(body.recoveryCode).toMatch(CODE_FORMAT);
    expect(body.recoveryCode).not.toBe(recoveryCode);

    // Every earlier session is gone; the reply carries a fresh one.
    expect((await progressOf(app, firstDevice)).status).toBe(401);
    expect((await progressOf(app, secondDevice)).status).toBe(401);
    const fresh = sessionCookie(response)!;
    expect((await progressOf(app, `nexus_session=${fresh.value}`)).status).toBe(200);
    expect(await count(app.client, "SELECT COUNT(*) AS n FROM sessions")).toBe(1);

    // The old password and the used code no longer work; the new ones do.
    expect((await login(app, "peggy", PASSWORD, "203.0.113.1")).status).toBe(401);
    expect((await login(app, "peggy", NEW_PASSWORD, "203.0.113.2")).status).toBe(200);
    expect((await recover(app, { username: "peggy", recoveryCode, newPassword: "another-one" })).status).toBe(401);
    expect((await recover(app, { username: "peggy", recoveryCode: body.recoveryCode, newPassword: "another-one" })).status).toBe(200);
  });

  it("refuses a wrong code, an unknown username and an account without a code with the same reply", async () => {
    const app = await newApp(FOLDER);
    const { recoveryCode } = await signUp(app, "peggy", PASSWORD);
    const { userId: legacyId } = await signUp(app, "legacy", PASSWORD, "198.51.100.2");
    await app.client.execute({ sql: "UPDATE users SET recovery_hash = NULL WHERE id = ?", args: [legacyId] });
    const before = await app.client.execute("SELECT id, password_hash, recovery_hash FROM users ORDER BY id");

    const replies = [
      await recover(app, { username: "peggy", recoveryCode: generateRecoveryCode(), newPassword: NEW_PASSWORD }),
      await recover(app, { username: "nobody", recoveryCode, newPassword: NEW_PASSWORD }),
      await recover(app, { username: "legacy", recoveryCode, newPassword: NEW_PASSWORD }),
      await recover(app, { username: "peggy", recoveryCode: "not a code", newPassword: NEW_PASSWORD }),
    ];
    for (const reply of replies) {
      expect(reply.status).toBe(401);
      expect(await reply.json()).toEqual({ error: "Username or recovery code is incorrect.", code: "wrong-recovery-code" });
    }
    const after = await app.client.execute("SELECT id, password_hash, recovery_hash FROM users ORDER BY id");
    expect(after.rows.map((row) => ({ ...row }))).toEqual(before.rows.map((row) => ({ ...row })));
  });

  it("applies the new-password rules", async () => {
    const app = await newApp(FOLDER);
    const { recoveryCode } = await signUp(app, "peggy", PASSWORD);
    const reply = await recover(app, { username: "peggy", recoveryCode, newPassword: "1234567" });
    expect(reply.status).toBe(400);
    expect(await reply.json()).toEqual({ error: "Password must be at least 8 characters.", code: "invalid" });
    expect((await login(app, "peggy", PASSWORD)).status).toBe(200);
  });

  it("allows 5 attempts per username per hour; the 6th is 429 even with the right code", async () => {
    const app = await newApp(FOLDER);
    const { recoveryCode } = await signUp(app, "peggy", PASSWORD);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const reply = await recover(app, { username: "peggy", recoveryCode: generateRecoveryCode(), newPassword: NEW_PASSWORD }, `203.0.113.${attempt}`);
      expect(reply.status, `attempt ${attempt}`).toBe(401);
    }
    const sixth = await recover(app, { username: "PEGGY", recoveryCode, newPassword: NEW_PASSWORD }, "203.0.113.99");
    expect(sixth.status).toBe(429);
    expect(Number(sixth.headers.get("retry-after"))).toBeGreaterThan(59 * 60);
    expect((await sixth.json()).code).toBe("rate-limited");
    expect((await login(app, "peggy", PASSWORD)).status).toBe(200); // nothing changed
  });

  it("works while sign-in is rate-limited, and clears that limit", async () => {
    const app = await newApp(FOLDER);
    const { recoveryCode } = await signUp(app, "peggy", PASSWORD);
    for (let attempt = 1; attempt <= 9; attempt += 1) await login(app, "peggy", "wrong-password", `203.0.113.${attempt}`);
    expect((await login(app, "peggy", PASSWORD, "203.0.113.50")).status).toBe(429);

    expect((await recover(app, { username: "peggy", recoveryCode, newPassword: NEW_PASSWORD })).status).toBe(200);
    expect((await login(app, "peggy", NEW_PASSWORD, "203.0.113.51")).status).toBe(200);
  });

  it("refuses a request from another site", async () => {
    const app = await newApp(FOLDER);
    const { recoveryCode } = await signUp(app, "peggy", PASSWORD);
    const reply = await app.recover(apiRequest("/api/auth/recover", { username: "peggy", recoveryCode, newPassword: NEW_PASSWORD }, { origin: "https://evil.example" }));
    expect(reply.status).toBe(403);
    expect((await login(app, "peggy", PASSWORD)).status).toBe(200);
  });
});

/** The four account endpoints, each called with a body (the current password is merged in). */
const ENDPOINTS = {
  password: (app: App, cookie: string, body: Record<string, unknown>, origin?: string) =>
    app.changePassword(apiRequest("/api/account/password", { newPassword: NEW_PASSWORD, ...body }, { cookie, origin })),
  recoveryCode: (app: App, cookie: string, body: Record<string, unknown>, origin?: string) =>
    app.newRecoveryCode(apiRequest("/api/account/recovery-code", body, { cookie, origin })),
  revoke: (app: App, cookie: string, body: Record<string, unknown>, origin?: string) =>
    app.revokeSessions(apiRequest("/api/account/sessions/revoke", body, { cookie, origin })),
  delete: (app: App, cookie: string, body: Record<string, unknown>, origin?: string) =>
    app.deleteAccount(apiRequest("/api/account", { confirmUsername: "peggy", ...body }, { method: "DELETE", cookie, origin })),
} as const;

describe("every account endpoint", () => {
  for (const [name, call] of Object.entries(ENDPOINTS)) {
    describe(name, () => {
      it("needs a session (401) and the same origin (403)", async () => {
        const app = await newApp(FOLDER);
        const { cookie } = await signUp(app, "peggy", PASSWORD);
        const signedOut = await call(app, "", { currentPassword: PASSWORD });
        expect(signedOut.status).toBe(401);
        const crossSite = await call(app, cookie, { currentPassword: PASSWORD }, "https://evil.example");
        expect(crossSite.status).toBe(403);
        expect(await count(app.client, "SELECT COUNT(*) AS n FROM users")).toBe(1);
      });

      it("refuses a wrong current password with 403 and changes nothing", async () => {
        const app = await newApp(FOLDER);
        const { cookie } = await signUp(app, "peggy", PASSWORD);
        const before = await app.client.execute("SELECT id, password_hash, recovery_hash FROM users");
        const sessionsBefore = await count(app.client, "SELECT COUNT(*) AS n FROM sessions");

        const reply = await call(app, cookie, { currentPassword: "not-my-password" });

        expect(reply.status).toBe(403);
        expect(await reply.json()).toEqual({ error: "Your current password is incorrect.", code: "wrong-password" });
        expect((await app.client.execute("SELECT id, password_hash, recovery_hash FROM users")).rows.map((row) => ({ ...row }))).toEqual(
          before.rows.map((row) => ({ ...row })),
        );
        expect(await count(app.client, "SELECT COUNT(*) AS n FROM sessions")).toBe(sessionsBefore);
      });

      it("counts wrong passwords against the sign-in limit: the 9th attempt is 429", async () => {
        const app = await newApp(FOLDER);
        const { cookie } = await signUp(app, "peggy", PASSWORD);
        for (let attempt = 1; attempt <= 8; attempt += 1) {
          expect((await call(app, cookie, { currentPassword: `wrong-${attempt}` })).status, `attempt ${attempt}`).toBe(403);
        }
        const ninth = await call(app, cookie, { currentPassword: PASSWORD });
        expect(ninth.status).toBe(429);
        expect(ninth.headers.get("retry-after")).not.toBeNull();
        // Shared with sign-in: signing in is limited too.
        expect((await login(app, "peggy", PASSWORD, "203.0.113.200")).status).toBe(429);
      });
    });
  }
});

describe("POST /api/account/password", () => {
  it("changes the password; sessions stay signed in", async () => {
    const app = await newApp(FOLDER);
    const { cookie } = await signUp(app, "peggy", PASSWORD);

    const reply = await ENDPOINTS.password(app, cookie, { currentPassword: PASSWORD });

    expect(reply.status).toBe(200);
    expect((await login(app, "peggy", PASSWORD, "203.0.113.1")).status).toBe(401);
    expect((await login(app, "peggy", NEW_PASSWORD, "203.0.113.2")).status).toBe(200);
    expect((await progressOf(app, cookie)).status).toBe(200);
  });

  it("applies the new-password rules", async () => {
    const app = await newApp(FOLDER);
    const { cookie } = await signUp(app, "peggy", PASSWORD);
    const reply = await ENDPOINTS.password(app, cookie, { currentPassword: PASSWORD, newPassword: "short" });
    expect(reply.status).toBe(400);
    expect((await reply.json()).error).toBe("Password must be at least 8 characters.");
    expect((await login(app, "peggy", PASSWORD)).status).toBe(200);
  });

  it("an existing short password is accepted as the current password", async () => {
    const app = await newApp(FOLDER);
    const { cookie, userId } = await signUp(app, "peggy", PASSWORD);
    await app.client.execute({ sql: "UPDATE users SET password_hash = ? WHERE id = ?", args: [await bcrypt.hash("abcd", 4), userId] });
    expect((await ENDPOINTS.password(app, cookie, { currentPassword: "abcd" })).status).toBe(200);
  });
});

describe("POST /api/account/recovery-code", () => {
  it("issues a new code; the old one stops working", async () => {
    const app = await newApp(FOLDER);
    const { cookie, recoveryCode } = await signUp(app, "peggy", PASSWORD);

    const reply = await ENDPOINTS.recoveryCode(app, cookie, { currentPassword: PASSWORD });

    expect(reply.status).toBe(200);
    const { recoveryCode: fresh } = await reply.json();
    expect(fresh).toMatch(CODE_FORMAT);
    expect((await recover(app, { username: "peggy", recoveryCode, newPassword: NEW_PASSWORD })).status).toBe(401);
    expect((await recover(app, { username: "peggy", recoveryCode: fresh, newPassword: NEW_PASSWORD })).status).toBe(200);
  });

  it("gives an account from before 1.5 its first code", async () => {
    const app = await newApp(FOLDER);
    const { cookie, userId } = await signUp(app, "peggy", PASSWORD);
    await app.client.execute({ sql: "UPDATE users SET recovery_hash = NULL WHERE id = ?", args: [userId] });

    expect((await ENDPOINTS.recoveryCode(app, cookie, { currentPassword: PASSWORD })).status).toBe(200);
    expect((await (await progressOf(app, cookie)).json()).account).toEqual({ hasRecoveryCode: true });
  });
});

describe("POST /api/account/sessions/revoke", () => {
  it("ends every session of the account, this device included, and leaves other accounts alone", async () => {
    const app = await newApp(FOLDER);
    const { cookie } = await signUp(app, "peggy", PASSWORD);
    const otherDevice = `nexus_session=${sessionCookie(await login(app, "peggy", PASSWORD))!.value}`;
    const { cookie: someoneElse } = await signUp(app, "sharon", PASSWORD, "198.51.100.2");

    const reply = await ENDPOINTS.revoke(app, cookie, { currentPassword: PASSWORD });

    expect(reply.status).toBe(200);
    expect(sessionCookie(reply)).toMatchObject({ value: "", maxAge: 0 });
    expect((await progressOf(app, cookie)).status).toBe(401);
    expect((await progressOf(app, otherDevice)).status).toBe(401);
    expect((await progressOf(app, someoneElse)).status).toBe(200);
  });
});

describe("DELETE /api/account", () => {
  async function accountWithData(app: App) {
    const { cookie, userId } = await signUp(app, "peggy", PASSWORD);
    for (const action of [
      { type: "watch", contentId: "iron-man", episode: -1 },
      { type: "skip", contentId: "incredible-hulk" },
      { type: "watch", contentId: "defenders-daredevil-1", episode: 1 },
    ]) {
      expect((await app.postProgress(apiRequest("/api/progress", { action }, { cookie }))).status).toBe(200);
    }
    await login(app, "peggy", "wrong-password"); // leaves a sign-in counter for this username
    return { cookie, userId };
  }

  it("deletes the account and every row stored for it, and nobody else's", async () => {
    const app = await newApp(FOLDER);
    const { cookie: sharon } = await signUp(app, "sharon", PASSWORD, "198.51.100.2");
    await app.postProgress(apiRequest("/api/progress", { action: { type: "watch", contentId: "iron-man", episode: -1 } }, { cookie: sharon }));
    const { cookie, userId } = await accountWithData(app);
    expect(await count(app.client, "SELECT COUNT(*) AS n FROM rate_limits WHERE bucket = 'login:user:peggy'")).toBe(1);

    const reply = await ENDPOINTS.delete(app, cookie, { currentPassword: PASSWORD, confirmUsername: "PEGGY" });

    expect(reply.status).toBe(200);
    expect(sessionCookie(reply)).toMatchObject({ value: "", maxAge: 0 });
    for (const table of ["users WHERE id", "sessions WHERE user_id", "progress WHERE user_id", "skips WHERE user_id"]) {
      expect(await count(app.client, `SELECT COUNT(*) AS n FROM ${table} = ?`, [userId]), table).toBe(0);
    }
    expect(await count(app.client, "SELECT COUNT(*) AS n FROM rate_limits WHERE bucket LIKE '%:user:peggy'")).toBe(0);
    expect((await progressOf(app, sharon)).status).toBe(200);
    expect(await count(app.client, "SELECT COUNT(*) AS n FROM progress")).toBe(1);
    // The username is free again.
    await signUp(app, "peggy", PASSWORD, "198.51.100.3");
  });

  it("refuses when the typed username does not match, and deletes nothing", async () => {
    const app = await newApp(FOLDER);
    const { cookie, userId } = await accountWithData(app);
    const reply = await ENDPOINTS.delete(app, cookie, { currentPassword: PASSWORD, confirmUsername: "peggie" });
    expect(reply.status).toBe(400);
    expect((await reply.json()).code).toBe("confirm-mismatch");
    expect(await count(app.client, "SELECT COUNT(*) AS n FROM progress WHERE user_id = ?", [userId])).toBe(2);
  });

  it("is all or nothing: a failure part-way deletes nothing", async () => {
    const app = await newApp(FOLDER);
    const { cookie, userId } = await accountWithData(app);
    // Make the last statement of the batch (DELETE FROM users) fail.
    await app.client.execute("CREATE TRIGGER block_user_delete BEFORE DELETE ON users BEGIN SELECT RAISE(ABORT, 'blocked for test'); END");
    vi.spyOn(console, "error").mockImplementation(() => {});

    const reply = await ENDPOINTS.delete(app, cookie, { currentPassword: PASSWORD });

    expect(reply.status).toBe(500);
    expect(await reply.json()).toEqual({ error: "Could not delete the account." });
    expect(await count(app.client, "SELECT COUNT(*) AS n FROM progress WHERE user_id = ?", [userId])).toBe(2);
    expect(await count(app.client, "SELECT COUNT(*) AS n FROM skips WHERE user_id = ?", [userId])).toBe(1);
    expect(await count(app.client, "SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?", [userId])).toBe(1);
    expect((await progressOf(app, cookie)).status).toBe(200);
  });
});

describe("sessions are hashed", () => {
  it("the session table never holds the raw cookie value", async () => {
    const app = await newApp(FOLDER);
    const { cookie } = await signUp(app, "peggy", PASSWORD);
    const raw = cookie.split("=")[1];
    expect(await count(app.client, "SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?", [raw])).toBe(0);
    expect(await count(app.client, "SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?", [tokenHash(raw)])).toBe(1);
  });
});
