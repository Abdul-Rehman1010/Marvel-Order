# Known gaps after packages 0.1–0.6, 1.2–1.6 and 2.1

Written 2026-11-17, last updated 2026-11-24 (after 2.1), from what was found while implementing `NEXT_LEVEL_PLAN.md`. Nothing here has been fixed by this file; it is a list. Each item says **what is wrong**, **how it was found**, **what it affects** and **where it is meant to be dealt with** (a plan package, an owner step, or nobody yet).

Severity: **High** = could lose or hide user data, or break the live site. **Medium** = wrong or fragile behaviour that a user or a deploy could hit. **Low** = untidy, informational, or already scheduled.

Status of the work itself: 0.1–0.6 and 1.2–1.6 are committed locally (**not pushed**; the branch is 7 commits ahead of `origin/master`). 2.1 is finished but **not committed**. Vercel is still serving the commit before all of it.

Solved gaps are removed rather than marked, so numbers can skip (B3 and the old F2 were solved by 1.4, F5 by 1.5, C6 and C7 by 1.6, C1 by 2.1).

---

## A. Before you push or deploy (owner steps and deploy risks)

| # | Gap | Severity | Detail | Where to handle |
| --- | --- | --- | --- | --- |
| A1 | **Nothing has run against Turso.** | High | Every test used local SQLite files. Production uses the remote (HTTP) driver, which is a different code path. The library source supports everything the new code uses (interactive write transactions, batches, `pragma_table_info`), but none of it has been exercised. The row-value delete `(content_id, episode) IN (VALUES …)` and the rate-limit upsert with `RETURNING` (1.4) were run on local SQLite only. The security headers and CSP (1.4) were checked on a local production build, not on the real domain. | Owner step: run this build once against a Turso **branch** or copy and click through sign-up, sign-in, tick, un-tick, reload; check the response headers on the deployed site. |
| A2 | **No production backup / trial migration yet.** | High | Migration 2 is the first change to a table that holds data (`progress` gains a column); migration 3 (1.4) adds the empty `rate_limits` table; migration 4 (1.5) adds two columns to `users`. All are additive, so risk is low, but the plan's required step (backup, trial run, compare row counts for `users`, `sessions`, `progress`) has not been done. | Owner step, recorded under 0.5 and 1.3 in the plan. |
| A3 | **Open browser tabs will show empty progress after the 1.3 deploy.** | Medium | The server's `GET`/`POST /api/progress` reply changed from `{ progress: [...] }` to `{ state: { rows, skips }, … }`. A tab (or installed app window) loaded before the deploy runs the old JavaScript, which reads `payload.progress ?? []` and so shows nothing until it is refreshed. No data is lost. | Not handled. Cheapest fix: also send the old `progress` field for one release. |
| A4 | **`.vitest/` stray folder** | Low | A test-report run of mine created it; it was deleted. Worth adding `.vitest/` to `.gitignore` if reporters are used again. | — |
| A5 | **Your local `marvel-vault.db` will be migrated when you run the 1.3–1.5 code locally.** | Low | It will gain `schema_migrations` versions 2–4 (the `backfilled` column, the `skips` and `rate_limits` tables, and the `recovery_hash` and `prefs` columns on `users`). Additive and safe to roll back, but it is your real data, so take a copy first if you care. It has changed three times while this work was in progress, each time when no agent command could open it: 73,728 → 77,824 bytes on 2026-11-16 (consistent with your dev server creating `schema_migrations`), → 94,208 bytes at 2026-11-17 00:30 (consistent with your dev server running the uncommitted 1.3 code, which applies migration 2, plus normal use), and → 102,400 bytes at 2026-11-22 21:31, two minutes before your "1.6" commit (consistent with your dev server running the 1.4–1.6 code, which applies migrations 3 and 4). None was confirmed by opening the file. | Owner awareness. |
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
| C2 | **No UI yet for skip, un-skip, bulk marking or catch-up.** | Low | The engine, store and API support them and are tested; no screen uses them. `backfilled` and `skips` are stored but nothing reads them in the UI. Expected. | Packages 2.2, 2.3. |
| C3 | **MCU counts changed on screen.** | Low | The unpublished series *Your Friendly Neighborhood Spider-Man S2* no longer counts, so the MCU tab shows 139 episodes / 20 seasons (was 149 / 21) and can reach 100%. Intended by the plan, but visible. | Informational. |
| C4 | **Out-of-order rows left by the old bugs still exist in any real account that hit them.** | Medium | They are reported (`outOfOrder`) and labelled "Watched out of order", and can be removed one at a time. There is no bulk "fix my progress" action, and nothing tells the user on the dashboard that such rows exist. | A notice or a one-tap clean-up would be new work; not planned. |
| C5 | **An unpublished series is not drawn as locked.** | Low | The server refuses it (`pending`), as the plan requires, but on screen it keeps its old look (episode rows disabled, "metadata pending"). The client, command palette and shelf all hide the `pending` lock on purpose, so the characterisation snapshots stay byte-identical. | Decide in 2.x whether to show "Pending" explicitly. |
| C8 | **Text under 11 px.** | Low | 26 / 26 / 32 visible text nodes at the three sizes after 1.6 (29 / 29 / 35 before it). The plan quoted 24; that count is not reproducible with the rule used. Compare future runs against these numbers. | **Package 2.8**. |
| C9 | **Tests depend on the current markup.** | Low | The browser specs use `#timeline-item-<id>`, `.card-visual`, `.timeline-card`, `.card-action`, `.episode-row`, `.recovery-code`, `.auth-panel .form-error`, `.drawer-go`, `.drawer-release-note`, `.toast`, `.delight-toast.checkpoint` / `.unlock`, the `data-sync` attribute on `main.app-shell` and `data-saving` on buttons (2.1), and button and dialog names (including "Open account: <username>", "Remove later progress too?", "Yes, remove all", "Keep watched" and "Undo"). Changing the markup (2.4–2.7) will break them until updated. | Update with those packages. |
| C10 | **Accounts created before 1.5 have no recovery code, and the only prompt is a small dot.** | Medium | Every account created before 1.5 (the copy of your local database checked on 2026-11-15 had 71) has no code until its owner opens the account panel and makes one. Until then a forgotten password means a lost account. The app shows only a gold dot on the account button, which is easy to miss. | Not planned. A one-time banner or a prompt after sign-in would be new work. |
| C11 | **The recovery code is lost if the tab is closed before "Continue".** | Low | Sign-up creates the account and signs it in before the code dialog appears. Closing or reloading the tab at that point enters the app without the code having been saved. A new code can be made from the panel with the password. | Not planned. |
| C12 | **On phones narrower than 430 px the Lore button is icon-only (and, since 1.6, the small icons in the Watched / Remaining boxes are hidden).** | Low | Added in 1.5 so the new account button fits without the brand wrapping onto two lines. It keeps its accessible name. | The top bar is redesigned in **2.6**. |
| C13 | **The desktop top bar is sparse.** | Low | 1.6 removed the inert Timeline and universe buttons, so the middle of the bar holds only "Lore brief". The universe switch lower on the page and keys 1/2/3 are the only ways to change universe. | The top bar is redesigned in **2.6**. |
| C14 | **Changes not saved yet are lost if the page is reloaded or closed while offline.** | Medium | Since 2.1 a tick shows at once and waits in an in-memory queue until the server takes it. While the server cannot be reached the queue can hold many ticks, and a reload or a closed tab drops them. The page warns before it is closed or reloaded while anything is unsaved, and the one request already in flight finishes on its own (`keepalive`). | **Package 4.3** (persists the queue per user). |
| C15 | **Undo after watching a skipped title does not bring the skip back.** | Low | Watching a skipped title to the end removes its skip (§4.4). Undo is the matching un-watch, so the title is then neither watched nor skipped, and if later titles depend on it the confirmation asks before clearing them. Nothing can be skipped in the app until 2.2. | **Package 2.2** (skip UI). |
| C16 | **A server error that never clears looks like being offline.** | Low | 5xx replies are retried every 60 s under the "Offline — changes will sync" chip, so a broken server and a lost connection look the same, and the queue keeps waiting while the tab is open. | Not planned. |
| C17 | **Undo is only on screen for 6 s.** | Low | The plan's 6 s toast; hovering or focusing it does not keep it open, so keyboard and screen-reader users have little time to reach the button. The same change can always be made by un-ticking the title. | Not planned. |

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
| D9 | §4.2 file layout. | Extra files: `catalogue/build.ts`, `catalogue/summaries.ts`, `lib/write-lock.ts`, `lib/passwords.ts`, `components/nexus/recovery-code-dialog.tsx`, `tests/helpers/viewing.ts`, `tests/helpers/api-app.ts`; since 2.1 also `lib/client/outbox.ts`, `lib/client/feedback.ts` and `lib/engine/milestones.ts`. | Needed by the split, by B1, and to share the password rules between sign-up now and recovery and password change in 1.5. The 2.1 files keep the queue, the messages and the milestone checks pure, so they are tested without React or the network. |
| D10 | 1.4 rate limits: "login 8 per 15 min per username …" (does not say which attempts count). | Every attempt counts, successful or not, including malformed sign-ups; a successful sign-in clears its username's count. | Counting before the password check stops the expensive bcrypt work from being used to flood the server. See F8. |
| D11 | 1.5 account endpoints: "All require the current password" (no limit, no status given). | They share the sign-in limit (8 per 15 minutes per username) and answer a wrong password with 403 `wrong-password`. | The acceptance asks for rate-limit cases on every endpoint; 401 already means "not signed in" in this app. See F9. |
| D12 | 1.5 recover: "resets the password, issues a new code, deletes all of that user's sessions". | Does that in one atomic batch, then signs the recovering device in with a fresh session. | Otherwise the user would have to sign in again right after proving who they are. |
| D13 | 2.1: "The confirmed list is sent as `confirmCleared`". | Every un-watch sends `confirmCleared`, empty when the client expected nothing else to go. `dispatch` also refuses an un-watch that would clear titles not in the list. | Otherwise an un-watch this device thought was harmless could silently clear progress another device had added. |
| D14 | §4.6 drain results: 409/400 drop the action; network failure or 5xx retry. | 403 is handled like 409/400; 408 and 429 like a network failure. A refusal whose state cannot be fetched is retried later instead of being dropped. | 403 will not change on a retry, a timeout or rate limit may. Dropping without the server's state would mean guessing which queued actions still apply. |
| D15 | 2.1: "Move `detectNewlyUnlocked` / `detectMilestones` to the engine". | `newlyUnlocked` also leaves out a series whose episode list is unpublished and titles the action itself satisfied; milestones are checked for every phase and universe, not only the title's own. | The old helper called the unpublished *Spider-Man S2* "ready to watch"; bulk actions complete several phases at once. |

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
| F6 | **Sessions never expire (owner decision, 1.4).** | Low | A session ends only on sign-out, when browser data is cleared, or after 400 days without opening the app. A cookie copied from someone's browser keeps working until they sign out on that device or use "Sign out everywhere". Changing the password does not sign other devices out (1.5, by design). | Owner decision. "Sign out everywhere" in the account panel (1.5) is the remedy. |
| F7 | **"Forever" is capped by the browser at 400 days.** | Low | Chrome and Edge cut any cookie lifetime to 400 days, so someone who does not open the app for more than 400 days, or who clears site data, has to sign in again. An http-only cookie cannot do better. Other browsers were not checked. | Cannot be fixed with cookies; informational. |
| F8 | **Shared IP addresses share the limits.** | Low | Sign-up allows 5 accounts per IP per hour and sign-in 40 attempts per IP per 15 minutes, and failed attempts count (D10). A household, school or office behind one IP shares that allowance, and 5 mistyped sign-ups block new accounts from that IP for an hour. | Owner to judge; the numbers are in `src/lib/rate-limit.ts`. |
| F9 | **Anyone can lock a username out of signing in for 15 minutes.** | Low | Eight wrong attempts for a username block that username for everyone (the plan's per-username limit). Since 1.5 the account panel's current-password checks share that count (D11), so eight wrong passwords typed in the panel also block sign-in for 15 minutes. Devices already signed in are unaffected, and recovery has its own limit, so a locked-out owner can still reset the password. | Accepted by the plan; informational. |
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
| G6 | **Browser tests must wait for background saves.** | Low | Since 2.1 a tick is saved after it shows. A test that reloads, or reads progress through the API, straight after a click can race the save, and while changes are queued a reload triggers the browser's "leave this page?" prompt. Call `waitForSync(page)` from `tests/e2e/helpers.ts` first. | Informational. |

---

## H. Not gaps, but worth knowing

- This client **enforces foreign keys** on local files (a test insert for a missing user failed). The plan's rule stands: do not rely on `ON DELETE CASCADE`. `skips` has no foreign key and is cleared explicitly.
- `tests/e2e/helpers.ts` still seeds progress through the **old POST body** on purpose, so that compatibility path stays exercised.
- `src/lib/content.ts` still exports the old helper names (they forward to the engine) so the characterisation tests keep proving the engine gives the old answers for watched-only states. It is deleted in package 5.5.
- `priorRequiredItems` in `content.ts` is deprecated and now returns the true direct prerequisites, which differs for four titles (`deadpool`, `deadpool-2`, `hawkeye`, `multiverse-of-madness`). The app does not use it.
- `users.prefs` (migration 4) exists but nothing reads or writes it yet.
- Next.js adds its own hidden `role="alert"` element (the route announcer), so browser tests should scope alert checks to the app's own error box.
- No agent has touched `marvel-vault.db`; every run used a database under `.tmp/`.
