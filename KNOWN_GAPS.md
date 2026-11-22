# Known gaps after packages 0.1–0.6 and 1.2–1.4

Written 2026-11-17, last updated 2026-11-22 (after 1.4), from what was found while implementing `NEXT_LEVEL_PLAN.md`. Nothing here has been fixed by this file; it is a list. Each item says **what is wrong**, **how it was found**, **what it affects** and **where it is meant to be dealt with** (a plan package, an owner step, or nobody yet).

Severity: **High** = could lose or hide user data, or break the live site. **Medium** = wrong or fragile behaviour that a user or a deploy could hit. **Low** = untidy, informational, or already scheduled.

Status of the work itself: 0.1–0.6 and 1.2 are committed locally (four commits, **not pushed**). 1.3 and 1.4 are finished but **not committed**. Vercel is still serving the commit before all of it.

Solved gaps are removed rather than marked, so numbers can skip (B3 and the old F2 were solved by 1.4).

---

## A. Before you push or deploy (owner steps and deploy risks)

| # | Gap | Severity | Detail | Where to handle |
| --- | --- | --- | --- | --- |
| A1 | **Nothing has run against Turso.** | High | Every test used local SQLite files. Production uses the remote (HTTP) driver, which is a different code path. The library source supports everything the new code uses (interactive write transactions, batches, `pragma_table_info`), but none of it has been exercised. The row-value delete `(content_id, episode) IN (VALUES …)` and the rate-limit upsert with `RETURNING` (1.4) were run on local SQLite only. The security headers and CSP (1.4) were checked on a local production build, not on the real domain. | Owner step: run this build once against a Turso **branch** or copy and click through sign-up, sign-in, tick, un-tick, reload; check the response headers on the deployed site. |
| A2 | **No production backup / trial migration yet.** | High | Migration 2 is the first change to a table that holds data (`progress` gains a column); migration 3 (1.4) only adds the empty `rate_limits` table. Both are additive, so risk is low, but the plan's required step (backup, trial run, compare row counts for `users`, `sessions`, `progress`) has not been done. | Owner step, recorded under 0.5 and 1.3 in the plan. |
| A3 | **Open browser tabs will show empty progress after the 1.3 deploy.** | Medium | The server's `GET`/`POST /api/progress` reply changed from `{ progress: [...] }` to `{ state: { rows, skips }, … }`. A tab (or installed app window) loaded before the deploy runs the old JavaScript, which reads `payload.progress ?? []` and so shows nothing until it is refreshed. No data is lost. | Not handled. Cheapest fix: also send the old `progress` field for one release. |
| A4 | **`.vitest/` stray folder** | Low | A test-report run of mine created it; it was deleted. Worth adding `.vitest/` to `.gitignore` if reporters are used again. | — |
| A5 | **Your local `marvel-vault.db` will be migrated when you run the 1.3/1.4 code locally.** | Low | It will gain `schema_migrations` versions 2 and 3 (the `backfilled` column, the `skips` table and the `rate_limits` table). Additive and safe to roll back, but it is your real data, so take a copy first if you care. It has changed twice while this work was in progress, both times when no agent command could open it: 73,728 → 77,824 bytes on 2026-11-16 (consistent with your dev server creating `schema_migrations`), and → 94,208 bytes at 2026-11-17 00:30 (consistent with your dev server running the uncommitted 1.3 code, which applies migration 2, plus normal use). Neither was confirmed by opening the file. Running the 1.4 code will add `rate_limits` the same way. | Owner awareness. |
| A6 | **GitHub CI has never run.** | Medium | `.github/workflows/ci.yml` was validated locally only. The first push will be its first run. | First push. |
| A7 | **Timing-based test may be flaky on a slow CI machine.** | Low | `tests/api/progress.test.ts` ("waits for another PROCESS…") asserts the write waited more than 100 ms for a second process that holds the lock for 400 ms, and spawns `node -e` with `process.execPath`. Fine locally; not seen on Linux/GitHub runners. | Watch the first CI run. |

---

## B. Problems found in the database library and the engine's persistence

| # | Gap | Severity | Detail | Where to handle |
| --- | --- | --- | --- | --- |
| B1 | **Local SQLite driver bug: a failed write BEGIN breaks its connection.** | Medium | `libsql` 0.5.29 (under `@libsql/client` 0.18, local `file:` only). After `transaction("write")` fails with `SQLITE_BUSY`, later transactions on that pooled connection fail at COMMIT ("SQL statements in progress") until garbage collection, and a plain `INSERT` on it reported success but the row was gone. Remote Turso is not affected. Reproduced outside the app with two clients on one file. | Mitigated: since 1.4 every local write, transaction or single statement, goes through `withWriteLock` (see B2). Not reported upstream. Re-check when the library is upgraded. |
| B2 | **Plan §4.5 "retry SQLITE_BUSY three times" does not work locally.** | Low | Because of B1, a retry cannot repair a local busy error. The retry remains in the code and helps a remote database. | Plan text should say so (see D1). |
| B4 | **The 3-second local busy wait blocks the Node process.** | Low | `db.ts` sets `timeout: 3000` so a write waits for another *process*. For a local file this is synchronous inside the driver. Acceptable for development; irrelevant on Vercel (remote). | Informational. |
| B5 | **Write lock is per process only.** | Low | On Vercel many serverless instances run at once; the lock does nothing there (by design; Turso serialises writers server-side). | Informational. |
| B6 | **Migration 0.5's contention note is out of date.** | Low | The 0.5 record says "with retries switched off, 15 of 20 starters fail with SQLITE_BUSY". Since 1.3, starters inside one process are queued, so that no longer describes in-process behaviour. | Plan record could be tidied. |
| B7 | **Round-trip count on a remote database is unmeasured.** | Low | §4.5 promises "three round trips". Locally the statement count is fixed (2 reads in one batch, writes in batches of 200 rows, commit). Over HTTP the library also does a version request and BEGIN handling; the real count was not measured. | Measure during A1. |
| B8 | **Housekeeping only runs on a successful sign-in.** | Low | Rate-limit rows from failed attempts and session rows whose cookie can no longer exist are deleted only when somebody signs in successfully. Sessions now live until sign-out or 400 days without a visit, so `sessions` keeps one row per signed-in browser. Growth is small for this app. | Informational; a scheduled clean-up would be new work. |

---

## C. App behaviour gaps (found in code or screenshots)

| # | Gap | Severity | Detail | Where to handle |
| --- | --- | --- | --- | --- |
| C1 | **Un-watch confirmation can overstate what will be removed.** | Medium | `UnwatchConfirmation` lists every row watched *after* the one being un-ticked ("N newer checkpoints"), by timestamp order. The real cascade is now by dependency, so after 1.3 it can name titles that will **not** be cleared (for example Moon Knight or X-Men titles after an MCU un-tick). The server's `confirmCleared` safeguard exists, but the client does not send it yet. | **Package 2.1** (client store, accurate confirmations). |
| C2 | **No UI yet for skip, un-skip, bulk marking or catch-up.** | Low | The engine, store and API support them and are tested; no screen uses them. `backfilled` and `skips` are stored but nothing reads them in the UI. Expected. | Packages 2.2, 2.3. |
| C3 | **MCU counts changed on screen.** | Low | The unpublished series *Your Friendly Neighborhood Spider-Man S2* no longer counts, so the MCU tab shows 139 episodes / 20 seasons (was 149 / 21) and can reach 100%. Intended by the plan, but visible. | Informational. |
| C4 | **Out-of-order rows left by the old bugs still exist in any real account that hit them.** | Medium | They are reported (`outOfOrder`) and labelled "Watched out of order", and can be removed one at a time. There is no bulk "fix my progress" action, and nothing tells the user on the dashboard that such rows exist. | A notice or a one-tap clean-up would be new work; not planned. |
| C5 | **An unpublished series is not drawn as locked.** | Low | The server refuses it (`pending`), as the plan requires, but on screen it keeps its old look (episode rows disabled, "metadata pending"). The client, command palette and shelf all hide the `pending` lock on purpose, so the characterisation snapshots stay byte-identical. | Decide in 2.x whether to show "Pending" explicitly. |
| C6 | **Phone label collision "REMAINING93".** | Low | Visible in the 390 px screenshot (label runs into the number). | **Package 1.6**. |
| C7 | **"Ready to watch" shows on watched cards; the "+ 0 specials" and "SYNCED" captions; inert top-bar buttons.** | Low | Visible in the screenshots. | **Package 1.6**. |
| C8 | **Text under 11 px.** | Low | 29 / 29 / 35 visible text nodes at the three sizes. The plan quoted 24; that count is not reproducible with the rule used. Compare future runs against these numbers. | **Package 2.8**. |
| C9 | **Tests depend on the current markup.** | Low | The browser specs use `#timeline-item-<id>`, `.card-visual`, `.timeline-card`, button and dialog names. Changing the markup (2.4–2.7) will break them until updated. | Update with those packages. |

---

## D. Differences between the plan text and the code

The plan's implementation record explains these, but the **body text** (§4.4, §4.5) still says the older thing. A later agent reading only the body could undo a deliberate decision.

| # | Plan says | Code does | Why |
| --- | --- | --- | --- |
| D1 | §4.5: retry `SQLITE_BUSY` up to three times. | Retries, but local busy errors are prevented by a write lock and a busy timeout instead. | B1. |
| D2 | §4.4 un-watch: "if the title is then not satisfied, remove all dependents' rows". | Cascades only when the title goes from satisfied to unsatisfied. | Otherwise un-ticking one more episode of an already unfinished series would wipe the out-of-order rows of its dependents. |
| D3 | §4.4 import: apply rows "in `watchedAt` order". | Rows are retried until a pass accepts nothing more. | Timestamp order alone rejected valid data (a title watched while its prerequisite was skipped is older than that prerequisite's rows if it was watched later). Found by the random-sequence test. |
| D4 | §4.4 stats: pending series contribute 0 units and runtime. | Also left out of every count (movies, series, seasons, episodes). | Otherwise the MCU tab could not read 100%. |
| D5 | §4.4 `formatDuration`: "TBD" for unknown. | `0` seconds prints "0m"; "TBD" is for a missing or invalid value; `formatRuntimeOf` maps the catalogue's 0 to "TBD". | "Time left" should read "0m" when nothing is left. |
| D6 | 0.2 text predicts 2 released titles with placeholder data. | `catalogue:check` reports 12. | See E3. |
| D7 | 0.3 text: 24 text nodes under 11 px. | 29 / 29 / 35 with the stated counting rule. | C8. |
| D8 | §4.4 skip: no mention of fully watched titles. | Skipping a fully watched title does nothing. | A skip there would end at once. |
| D9 | §4.2 file layout. | Extra files: `catalogue/build.ts`, `catalogue/summaries.ts`, `lib/write-lock.ts`, `lib/passwords.ts`, `tests/helpers/viewing.ts`. | Needed by the split, by B1, and to share the password rules between sign-up now and recovery and password change in 1.5. |
| D10 | 1.4 rate limits: "login 8 per 15 min per username …" (does not say which attempts count). | Every attempt counts, successful or not, including malformed sign-ups; a successful sign-in clears its username's count. | Counting before the password check stops the expensive bcrypt work from being used to flood the server. See F8. |

---

## E. Content and data

| # | Gap | Severity | Detail | Where to handle |
| --- | --- | --- | --- | --- |
| E1 | **Unpublished series.** | Low | *Your Friendly Neighborhood Spider-Man S2* has `dataPending` and zero runtimes. Optional, so it never gates anything. | Update when data exists. |
| E2 | **Episode titles are placeholders ("Episode N") for 11 released series.** | Medium | what-if-1, she-hulk, what-if-2, agatha, what-if-3, friendly-spider-man-1, ironheart, eyes-of-wakanda, marvel-zombies, wonder-man, born-again-2. **`agatha` and `born-again-2` are required** (Agatha for Doomsday). `npm run catalogue:check` lists them; `--strict` would fail on them. | Content work; **package 5.1** (TMDB sync) or by hand. |
| E3 | **`catalogue:check` reports 12 titles, not 2.** | Low | See E1 + E2 (11 placeholders + the pending one, with `friendly-spider-man-2` counted in both reasons). | Informational. |

---

## F. Security and dependencies

| # | Gap | Severity | Detail | Where to handle |
| --- | --- | --- | --- | --- |
| F1 | **`npm audit`: `next` 16.3.5 has a critical finding.** | High | Remote code execution in `next/og` `ImageResponse`; the audit lists 16.4.6 as a non-major fix. The app uses `ImageResponse` for its icons, and 3.5 plans to use it for the share card. Also `zod` and `sharp` (high) and the typescript-eslint / minimatch chain (moderate). All were already installed before this work; none come from the test tooling. | **Owner decision.** `AGENTS.md` warns that Next.js upgrades can break conventions, so read the bundled docs first. |
| F5 | **No way to recover an account, change a password, sign out other devices or delete an account.** | Medium (pre-existing) | A forgotten password means a lost account. Because sessions no longer expire (F6), "sign out everywhere" is now the only way to end a session on a lost or shared device. | **Package 1.5**. |
| F6 | **Sessions never expire (owner decision, 1.4).** | Low | A session ends only on sign-out, when browser data is cleared, or after 400 days without opening the app. A cookie copied from someone's browser keeps working until they sign out on that device. Accepted because the app holds no confidential data. | Owner decision. 1.5's "sign out everywhere" (F5) is the remedy. |
| F7 | **"Forever" is capped by the browser at 400 days.** | Low | Chrome and Edge cut any cookie lifetime to 400 days, so someone who does not open the app for more than 400 days, or who clears site data, has to sign in again. An http-only cookie cannot do better. Other browsers were not checked. | Cannot be fixed with cookies; informational. |
| F8 | **Shared IP addresses share the limits.** | Low | Sign-up allows 5 accounts per IP per hour and sign-in 40 attempts per IP per 15 minutes, and failed attempts count (D10). A household, school or office behind one IP shares that allowance, and 5 mistyped sign-ups block new accounts from that IP for an hour. | Owner to judge; the numbers are in `src/lib/rate-limit.ts`. |
| F9 | **Anyone can lock a username out of signing in for 15 minutes.** | Low | Eight wrong attempts for a username block that username for everyone (the plan's per-username limit). Devices already signed in are unaffected, and with never-expiring sessions few people need to sign in. | Accepted by the plan; informational. |
| F10 | **IP limits trust `x-forwarded-for`.** | Low | Safe on Vercel, whose proxy sets the header. On a host without such a proxy, a client could send a fake header and get a fresh per-IP allowance each time (the per-username limit still applies). The browser tests use exactly this to act as separate clients. | Re-check if the app moves off Vercel. |
| F11 | **The CSP still allows inline scripts and styles.** | Low | The plan chose the guide's no-nonce policy (`'unsafe-inline'`), so the CSP does not stop an injected inline script. It does block anything loaded from another origin, framing, and plugins. Nonces or the experimental SRI option would be stricter. | Not planned. |
| F12 | **HSTS includes subdomains for two years.** | Low | `Strict-Transport-Security: max-age=63072000; includeSubDomains` (production only). On a `*.vercel.app` address this only affects the app itself. On a custom domain, any subdomain served over plain http would stop loading for two years. | Check before adding a custom domain. |
| F13 | **The 72-character password limit counts characters, but bcrypt uses the first 72 bytes.** | Low | A password with many non-ASCII characters (accents, emoji) can exceed 72 bytes; bcrypt ignores the rest. | Not planned. Would need a byte-length check in `newPasswordSchema`. |
| F3 | **Dev-only dependencies grew by 108 packages.** | Low | Vitest, Playwright, jsdom, Testing Library, `@vitejs/plugin-react`. `@types/node` moved from ^20 to ^22. They install on Vercel but are not in the app bundle. Vitest 5 wants Node 22+, so set Vercel's Node version to 22 or newer to avoid install warnings. | Check Vercel project settings. |
| F4 | **Watch-link checks are deliberately untouched.** | Low | By your instruction `src/lib/watch-links.ts` and `public/watch-links.csv` are off limits. The lint warning `APPROVED_WATCH_HOSTS is assigned a value but never used` remains. | Plan §9.1, yours to change later. |

---

## G. Tooling and environment

| # | Gap | Severity | Detail | Where to handle |
| --- | --- | --- | --- | --- |
| G1 | **The browser tests cannot run while another `next dev` holds this folder's lock.** | Low | `playwright.config.ts` starts its own `next dev -p 3210` and refuses to attach to a running server (so it can never touch the wrong database). If you have `npm run dev` open (it was on port 3000 earlier), the run fails with "Another next dev server is already running". I worked around it once with a production build and a temporary config. | Stop your dev server first, or give Playwright its own `distDir` later. |
| G2 | **Windows path quirks.** | Low | A lowercase drive letter (`d:\…`, as Git Bash reports it) made Vitest load twice, fixed with an alias in `vitest.config.mts`. SQLite can keep a closed test database open until garbage collection, so tests delete their files best-effort and clear leftovers at the next run. Both are workarounds, not root-cause fixes. | Informational. |
| G3 | **CI runs only the smoke browser spec.** | Low | The out-of-order spec and the screenshots are not in CI. | Add to CI if wanted. |
| G4 | **The roadmap page is private and manually updated.** | Low | `docs/roadmap.html` is published as a private artifact; counts and chips are edited by hand at each package. It is not shared with anyone until you do it from its Share menu. | Informational. |
| G5 | **Property tests are CPU-heavy.** | Low | `tests/unit/engine-properties.test.ts` runs long random walks (about 3 s alone; they once hit the default 5 s limit when the whole suite ran in parallel, so they now have an explicit 60 s limit). | Informational. |

---

## H. Not gaps, but worth knowing

- This client **enforces foreign keys** on local files (a test insert for a missing user failed). The plan's rule stands: do not rely on `ON DELETE CASCADE`. `skips` has no foreign key and is cleared explicitly.
- `tests/e2e/helpers.ts` still seeds progress through the **old POST body** on purpose, so that compatibility path stays exercised.
- `src/lib/content.ts` still exports the old helper names (they forward to the engine) so the characterisation tests keep proving the engine gives the old answers for watched-only states. It is deleted in package 5.5.
- `priorRequiredItems` in `content.ts` is deprecated and now returns the true direct prerequisites, which differs for four titles (`deadpool`, `deadpool-2`, `hawkeye`, `multiverse-of-madness`). The app does not use it.
- No agent has touched `marvel-vault.db`; every run used a database under `.tmp/`.
