# Doom Flix — "Next Level" implementation plan

*Version of 2026-11-15, latest. If your copy has no §8 ("Which model runs each work package") it is an older one. This version adds: the model assignment (§8); the migration race fix and production backup step (0.5); handling of unrecognised saved rows (§4.4); the "never discard the queue" rule (§4.6); the M0 and stricter M1 gates (§6).*

## 0. Context

Doom Flix (`d:\Doomflix`, Next.js 16.3.5 / React 19 / libSQL) is a spoiler-safe Marvel watch-order tracker built around a countdown to *Avengers: Doomsday* (2026-12-18). A full review on 2026-11-15 (code read end to end, app run against a scratch database, screenshots at 1440 / 1366 / 390 px) found a strong product with four structural problems:

1. **The premise expires in 33 days.** The release date is hard-coded in three files and nothing is designed for the day after.
2. **Starting takes 100+ clicks.** 103 required checkpoints, one click and one server round trip each, episodes strictly one at a time, no bulk action.
3. **The list is buried.** At 1440×900 the first title card starts 1,379 px down a 12,900 px page; each card stacks three full-width bars.
4. **The progress rules have real bugs and no tests.** Un-watching wipes unrelated progress, leaves orphaned rows, and runs ~59 separate deletes with no transaction. An independent check of the redesign in §4.4 (2026-11-15) confirmed it reproduces today's prerequisites for all 92 titles and turned up one more live bug, listed in 1.3.

This plan turns every recommendation from that review into ordered work packages that an implementing agent can execute without the original conversation. It also carries the shareable roadmap (§1), which is published as a page in work package 0.1.

**Changes from the review, made deliberately:** the "skipped" state moves earlier (the catch-up wizard needs it); the Stats view moves earlier (Wrapped depends on it); posters stay bundled by default (offline support needs same-origin art, see decision D2); Tailwind stays as the CSS reset only (removing it would change base styles everywhere).

---

## 1. Roadmap at a glance (the shareable roadmap)

Dates are targets counted from 2026-11-15; M0–M3 must land before the film releases.

| Milestone | Target | What the user gets | Work packages |
| --- | --- | --- | --- |
| **M0 Foundations** | Nov 17 | Nothing visible. Tests, CI, screenshots, migrations: the safety net for everything after. | 0.1–0.6 |
| **M1 Correct and safe** | Nov 20 | Progress can no longer be lost or orphaned; accounts get throttling, recovery, password change, deletion. | 1.2–1.6 |
| **M2 Fast start, fast flow** | Nov 29 | Catch up in under a minute; skip a title without getting stuck; instant ticks with Undo; "Up next" with one-tap marking on the first screen; denser cards; shareable links; Back button works. | 2.1–2.8 |
| **M3 The deadline** | Dec 10 | Doomsday becomes a mission with a finale checkpoint; Essential-path triage; a dated nightly schedule; stats, achievements, Doomsday Wrapped and a share card. | 3.1–3.5 |
| **M4 Reach** | early Jan | Try without an account; mobile app shell; works offline; push reminders. | 4.1–4.4 |
| **M5 Depth** | Jan–Feb | Auto-refreshed catalogue and real where-to-watch; post-credit counts, trailers, notes, character threads; interactive timeline map; "Road to Secret Wars". | 5.1–5.5 |

Status is tracked in the in-repo copy of this plan (work package 0.1) by ticking each package's acceptance list.

---

## 2. Ground rules for every implementing agent

1. **Read before writing.** `AGENTS.md` is binding: this Next.js version differs from training data. Before using any Next API, read the bundled doc. Root: `node_modules/next/dist/docs/01-app/`.

   | Topic | Doc (relative to that root) |
   | --- | --- |
   | Reading the session cookie in a Server Component | `03-api-reference/04-functions/cookies.md` (`cookies()` is async; it makes the route dynamic), `02-guides/authentication.md` (§ Database Sessions, § Data Access Layer) |
   | Server/client split, hydration | `01-getting-started/05-server-and-client-components.md`, `02-guides/preventing-flash-before-hydration.md` |
   | Route handlers | `01-getting-started/15-route-handlers.md`, `03-api-reference/03-file-conventions/route.md` |
   | URL state without navigation | `02-guides/single-page-applications.md` § "Shallow routing on the client", `03-api-reference/04-functions/use-search-params.md` |
   | Security headers, CSP | `03-api-reference/05-config/01-next-config-js/headers.md`, `02-guides/content-security-policy.md` § "Without Nonces" |
   | Request interception (only if needed) | `03-api-reference/03-file-conventions/proxy.md` (`middleware` was renamed `proxy`) |
   | Manifest, service worker, web push | `02-guides/progressive-web-apps.md`, `02-guides/offline-support.md` |
   | Tests | `02-guides/testing/vitest.md`, `02-guides/testing/playwright.md` |
   | Generated images | `03-api-reference/04-functions/image-response.md` |
   | Error files | `01-getting-started/10-error-handling.md`, `03-api-reference/03-file-conventions/error.md`, `not-found.md` |
   | Optimistic UI patterns | `02-guides/interactive-apps.md` |

2. **Never touch the owner's data.** `marvel-vault.db` in the repo root is the owner's real local database. Every dev server, test and script run by an agent must set `TURSO_DATABASE_URL=file:.tmp/<name>.db` (`.tmp/` is git-ignored in 0.3). Before running any `db:*` script, confirm no `.env` / `.env.local` points at a remote database.
3. **One work package at a time, in order.** Packages list their dependencies. Finish a package's acceptance list before starting the next.
4. **Definition of done for every package:** `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build` all pass; for any UI change, `npm run shots` is run and the screenshots are looked at (1440×900, 1366×768, 390×844); the in-repo plan's acceptance boxes are ticked with a one-line implementation note.
5. **Git.** Do not commit or push unless the owner asks. Never rewrite history.
6. **Stability contracts.** Content IDs never change (they are database keys). Existing `progress` rows must keep working. Keep the visual identity: the `:root` tokens, fonts and green cinematic look in `src/app/globals.css`.
7. **Styling convention.** New UI uses the existing semantic-class CSS (e.g. `.timeline-card`), not Tailwind utilities. `@import "tailwindcss"` stays because its reset is load-bearing.
8. **Dependencies.** Only add what a package names. Prefer no new runtime dependency.
9. **Copy.** Actions and errors use plain words ("Mark watched", "Skip"); the in-universe flavour ("transmission", "operator") stays in headings and eyebrows only.
10. **Minimum text size** is 11 px everywhere; touch targets are at least 44×44 px on phones.
11. **Watch-link handling is off limits.** Do not edit `src/lib/watch-links.ts` or `public/watch-links.csv`, and do not add tests for them. The owner will change this themselves once the plan is complete (see §9, Future plans).

---

## 3. Owner decisions (defaults are chosen so work is never blocked)

| # | Decision | Default used unless the owner says otherwise |
| --- | --- | --- |
| D1 | Which required titles are "Essential" (3.2) | The draft list in 3.2; the owner edits one file. |
| D2 | TMDB as a data source (5.1) | Dev-time script only, needs `TMDB_API_KEY`; skipped if absent. Posters stay bundled in `public/`. |
| D3 | Analytics | Off. If opted in, add `@vercel/analytics` in `layout.tsx` only. |
| D4 | Push reminders (4.4) | Built behind env vars; nothing is sent until VAPID keys and a cron secret exist. |
| D5 | "Road to Secret Wars" date and required set (5.4) | Placeholder mission, hidden until the owner confirms. |
| D6 | Password length | Minimum 8 for new passwords; existing accounts keep working. |
| D8 | *Avengers: Doomsday* poster, backdrop, runtime | Generated placeholder art and "TBD" runtime until supplied. |

---

## 4. Target architecture (shared by all packages)

### 4.1 Vocabulary

- **Unit**: one tickable thing: a movie, a special, or one episode.
- **Watched row**: a row in `progress` (`episode = -1` for a movie/special).
- **Skipped**: the user chose not to watch a title; stored in a new `skips` table.
- **Satisfied**: a title is fully watched *or* skipped. Locks look at "satisfied"; watch-time statistics look at "watched".
- **Backfilled**: a watched row created by catch-up/bulk, not by watching now. Pace and streak statistics ignore backfilled rows.
- **Viewing state**: `{ rows, skips }` for one user. **Viewing index**: the lookup sets derived from it.

### 4.2 File layout

```
src/lib/catalogue/   types.ts  mcu.ts  xmen.ts  street.ts  tiers.ts  extras.ts  index.ts
src/lib/engine/      graph.ts  state.ts  reducer.ts  stats.ts  release.ts  format.ts
                     schedule.ts  achievements.ts  wrapped.ts  map-layout.ts
src/lib/missions.ts
src/lib/content.ts   # becomes a re-export barrel so existing imports keep compiling; deleted in 5.5
src/lib/db.ts  migrations.ts  session.ts  progress-store.ts  rate-limit.ts  http.ts  account.ts
src/lib/client/      gateway.ts  use-progress.ts  use-url-state.ts  prefs.ts
src/components/nexus/  (marvel-nexus.tsx is split into this folder in 2.4)
src/styles/          tokens.css base.css topbar.css hero.css dashboard.css archive.css drawer.css
                     overlays.css lore.css auth.css responsive.css   (split of globals.css, 2.4)
tests/unit  tests/api  tests/e2e
scripts/             catalogue-check.mjs  sync-tmdb.mjs  (existing: reset-users.mjs, extract-poster-tints.mjs)
```

### 4.3 Data model (migrations, added by the package named)

`src/lib/migrations.ts` holds an ordered list; `ensureDatabase()` applies the missing ones and records them in `schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`.

| Version | Package | Change |
| --- | --- | --- |
| 1 | 0.5 | Baseline: today's three `CREATE TABLE IF NOT EXISTS` plus two indexes, unchanged. |
| 2 | 1.3 | `ALTER TABLE progress ADD COLUMN backfilled INTEGER NOT NULL DEFAULT 0`; `CREATE TABLE skips (user_id TEXT NOT NULL, content_id TEXT NOT NULL, reason TEXT NOT NULL DEFAULT 'manual', skipped_at TEXT NOT NULL, PRIMARY KEY (user_id, content_id))` |
| 3 | 1.4 | `CREATE TABLE rate_limits (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL)` |
| 4 | 1.5 | `ALTER TABLE users ADD COLUMN recovery_hash TEXT`; `ALTER TABLE users ADD COLUMN prefs TEXT NOT NULL DEFAULT '{}'` |
| 5 | 5.2 | `CREATE TABLE title_notes (user_id TEXT NOT NULL, content_id TEXT NOT NULL, rating INTEGER, note TEXT, updated_at TEXT NOT NULL, PRIMARY KEY (user_id, content_id))` |
| 6 | 4.4 | `CREATE TABLE push_subscriptions (endpoint TEXT PRIMARY KEY, user_id TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at TEXT NOT NULL)` |

Do not rely on `ON DELETE CASCADE` (SQLite only enforces it when foreign keys are switched on per connection). Account deletion and `scripts/reset-users.mjs` delete from every table explicitly; update the script whenever a table is added.

### 4.4 Rules engine (pure, no I/O; used by server, client and guest mode)

`src/lib/engine/graph.ts`

- Each universe has a policy. `mcu` and `xmen` are **release-chain**: a title directly requires every earlier `required` title in its own universe list. `street` is **explicit**.
- Per-title overrides live on the catalogue item: `requires: string[]` replaces the policy result; `alsoRequires: string[]` adds to it.

  | Title | Override |
  | --- | --- |
  | `deadpool` | `requires: ["xmen-2000"]` |
  | `deadpool-2` | `requires: ["deadpool"]` |
  | `moon-knight` | `requires: []` |
  | `multiverse-of-madness` | `alsoRequires: ["xmen-2000"]` |
  | `hawkeye` | `requires: ["endgame"]` |
  | every other Street title | `requires` = its list in today's `STREET_PREREQUISITE_IDS` |

- Computed once at module load: `DIRECT` (id → direct prerequisite ids), `ANCESTORS` (id → all transitive prerequisites, in watch order), `DESCENDANTS` (id → every title that transitively depends on it). Module load throws if an id is unknown or the graph has a cycle.
- Exports: `directPrerequisites(id)`, `prerequisiteChain(id)` (replaces `getPrerequisiteChain`, same output), `dependents(id)`, `reducedEdges()` (transitive reduction, for the map in 5.3).
- Verified on 2026-11-15 by running both against the live catalogue: these rules reproduce today's direct **and** transitive prerequisite sets for all 92 titles, order included. Spot values to assert (they grow by one where relevant once 3.1 adds the finale): prerequisites — `endgame` 21, `multiverse-of-madness` 30, `hawkeye` 22, `echo` 23, `deadpool` 1, `deadpool-2` 2, `logan` 8, `deadpool-wolverine` 10, `born-again-1` 7, `visionquest` 44, `moon-knight` 0; dependents — `iron-man` 60, `xmen-2000` 41 (13 X-Men + 28 MCU), `endgame` 39. No optional title has dependents.

`src/lib/engine/state.ts`

```ts
type ProgressRow = { contentId: string; episode: number; watchedAt: string; backfilled: boolean };
type SkipRow     = { contentId: string; reason: "manual" | "triage"; skippedAt: string };
type ViewingState = { rows: ProgressRow[]; skips: SkipRow[] };          // serialisable
type ViewingIndex = { watched: ReadonlySet<string>; skipped: ReadonlySet<string> }; // watched keys are "id:episode"
indexOf(state): ViewingIndex
isWatchedComplete(item, index)   // today's itemComplete; always false for a dataPending series (never "complete" via an empty list)
isSatisfied(item, index)         // watched-complete OR skipped
isOutstanding(item, index)       // !isSatisfied — what "remaining", "next up" and "unwatched" mean from now on
missingPrerequisite(item, index) // earliest unsatisfied title in ANCESTORS[item.id] (same answer as today for skip-free states)
lockReason(item, index, now)     // { kind: "prerequisite", item } | { kind: "unreleased", date } | { kind: "pending" } | null
outOfOrderTitles(state)          // titles that have watched rows while an ancestor is unsatisfied (left behind by the old bugs)
```

Locks check **every transitive prerequisite**, not only the direct ones. For states without skips this is identical to today. With skips it matters in the Street graph, where direct lists are not transitive: skipping *Daredevil* S2 must not unlock *The Punisher* S1 while *Daredevil* S1 is still unwatched.

`kind: "pending"` applies to a series flagged `dataPending` (its episode list is unknown, so it cannot be ticked). The server enforces it too (it does not today). A movie with an unknown runtime is **not** pending: it is one tickable unit that shows "TBD". Catalogue invariant: no required series is `dataPending`.

**Stored rows the catalogue does not recognise.** A saved row or skip may name a title id, or an episode number, that the current catalogue does not have (a title removed or an episode list shortened later). The engine must never throw on these and never delete them: `indexOf`, `applyAction`, the statistics and the server's read path all ignore such rows, the persistence layer leaves them in the database untouched, and `GET /api/progress` reports their ids in `unrecognised: string[]` so the problem is visible. (The graph still throws at module load for an unknown id **in the catalogue's own `requires` lists**; that is a build-time mistake, not user data.)

`src/lib/engine/release.ts`: `isReleased(item, now)` compares against `Date.parse(item.releaseDate + "T00:00:00Z")`. Client and server both use it (today they use different local midnights). Every place that prints a release date formats it with `timeZone: "UTC"` so the label matches the lock; the "Scheduled transmission: releases …" message in today's `unlockReason` does not, and would show the previous day west of UTC. Nothing in the catalogue is unreleased on 2026-11-15, so tests inject `now` (for example 2026-10-01, when `visionquest` is still two weeks away).

`src/lib/engine/reducer.ts`

```ts
type Action =
  | { type: "watch";    contentId: string; episode: number }
  | { type: "unwatch";  contentId: string; episode: number }
  | { type: "watchAll"; contentId: string }                       // every remaining unit of one title
  | { type: "skip";     contentId: string; reason?: "manual" | "triage" }
  | { type: "unskip";   contentId: string }
  | { type: "bulk";     watch: string[]; skip: string[]; skipReason?: "manual" | "triage"; backfilled: boolean }
  | { type: "import";   rows: ProgressRow[]; skips: SkipRow[] };  // guest claim / JSON import

type Outcome =
  | { ok: true; state: ViewingState; addedRows: ProgressRow[]; removedKeys: string[];
      addedSkips: SkipRow[]; removedSkips: string[]; cleared: string[] /* other titles whose progress was removed */ }
  | { ok: false; code: "locked" | "unreleased" | "pending" | "episode-order" | "has-dependents" | "unknown-title" | "unknown-episode" | "invalid";
      message: string; contentId?: string; missingId?: string /* the prerequisite to go and watch */ };
// "import" additionally returns rejected: { contentId, episode, reason }[] (see below)

applyAction(state, action, now): Outcome
```

Semantics:

- **Unit validation (watch and unwatch)**: movies and specials accept only `episode: -1`; a series accepts only its own episode numbers. Anything else fails with `unknown-episode` and changes nothing. (Today `unwatch` with a bogus episode on a film keeps the film and wipes every later title.)
- **watch**: the title must have no `lockReason`; a lock failure reports both the title and `missingId`. Series: episode N needs episode N−1 watched. Movies/specials use `episode: -1`. Watching an already-watched unit is a successful no-op that leaves the existing row's timestamp and `backfilled` flag untouched (makes retries safe; today a repeat overwrites `watched_at`). When a skipped title becomes fully watched its skip row is removed.
- **unwatch(id, k)**: removes that row; for a series also removes episodes greater than k. If the title is then not satisfied, removes **all watched rows** (complete or partial) of every title in `DESCENDANTS[id]` and reports those titles in `cleared`. Skips are never removed by this. Un-watching an absent row is a successful no-op **with no cascade**. Un-watching is allowed on a locked title, so rows that are out of order can always be removed.
- **skip**: a declaration that the user will not watch the title. It has **no precondition** (a locked title can be skipped; that is what lets triage skip the whole non-essential set up front). Keeps any watched episodes. Idempotent. A skip is removed automatically only when the title becomes fully watched.
- **unskip**: removes the skip. It **never clears anything**: if the title would then be unsatisfied while any descendant has watched rows, the action fails with code `has-dependents` and the UI tells the user to mark the title watched instead (or remove the later progress first).
- **watchAll / bulk**: `bulk` applies all its skips first (order irrelevant), then sorts its watch ids in graph order (release date breaks ties) and applies watch-all-units one title at a time against the accumulating state. If any title is not allowed at its turn the whole action fails, changes nothing, and names both the title and its `missingId`. An id present in both `watch` and `skip` is `invalid`. Units already watched are left exactly as they are; new rows get `backfilled` from the action and all share the action's `now` as `watchedAt` (graph order is the tie-break wherever order matters).
- **import** (best effort, never all-or-nothing): applies the supplied skips, then the supplied rows one by one in `watchedAt` order (graph order breaks ties) through the normal `watch` rule. Rows that are not allowed are left out and returned in `rejected` with the reason, so clock skew or a later change to the catalogue's rules cannot discard a whole profile. Accepted rows keep their original timestamps and flags. Importing merges with what the account already has and is idempotent (two valid states merged are still valid).

`src/lib/engine/stats.ts`: today's `getStats` moved here and extended. Series flagged `dataPending` contribute 0 units and 0 runtime (their episodes cannot be ticked). For a skipped title, its watched units count as watched and its **unwatched** units are "skipped runtime". Percent = watched runtime ÷ (total runtime − skipped runtime), capped at 99 until every counted title is satisfied, then 100; if the denominator is 0 the result is 100 when everything is satisfied, else 0. "Remaining" time and unit counts exclude skipped units. Returns `skippedTitles` and `skippedRuntime` as well.

`src/lib/engine/format.ts`: `formatDuration(seconds)` → `"124h 14m"`, `"2h 06m"`, `"45m"`; `"TBD"` for unknown. Replaces every `formatRuntime(...).replace(" 00s", "")` call (the data is minute-level; the seconds were always `00`).

### 4.5 Server API

All state-changing handlers call `assertSameOrigin(request)` (403 when an `Origin` header is present and its host differs from the request host) and return typed errors: rule failures are HTTP 409 `{ error, code, contentId?, missingId? }`; validation failures 400; anything unexpected is logged and returned as a generic 500 (today any thrown message leaks as a 409).

| Route | Purpose |
| --- | --- |
| `GET /api/progress` | `{ user, state: { rows, skips }, databaseMode }` |
| `POST /api/progress` | Body `{ action: Action, confirmCleared?: string[] }` → `{ state }`. Also accepts today's `{ contentId, episode, watched }` and maps it to watch/unwatch. If `confirmCleared` is present and the action would clear a title that is not in it, nothing is written and the reply is 409 `{ code: "confirm-required", cleared, state }`; the client shows the confirmation again with the fresh list. This covers a second device having added progress the first one has not seen. Requests without the field (today's client, until 2.1 ships) are applied without this check. |
| `POST /api/progress/import`, `GET /api/progress/export` | Guest claim and JSON backup (4.1). |
| `POST /api/auth/signup`, `login`, `logout`, `recover` | `signup` also returns a one-time `recoveryCode`. |
| `POST /api/account/password`, `POST /api/account/recovery-code`, `POST /api/account/sessions/revoke`, `DELETE /api/account` | Account panel (1.5). All require the current password. |
| `GET /api/share-card` | PNG for the signed-in user (3.5). |
| `PUT /api/notes/[contentId]` | Rating and private note (5.2). |
| `POST` / `DELETE /api/push/subscription`, `GET /api/cron/reminders` | Push (4.4). |

Persistence (`src/lib/progress-store.ts`): one function `applyUserAction(userId, action, confirmCleared)` that, inside a single interactive write transaction, reads the user's rows and skips, calls `applyAction`, writes only the diff, commits and returns the new state. Shape (the `@libsql/client` 0.18 API, same for `file:` and remote URLs):

```ts
await ensureDatabase();                       // before the transaction, never inside it
const tx = await db.transaction("write");     // pass the mode explicitly
try {
  const [rows, skips] = await tx.batch([selectProgress, selectSkips]);
  const outcome = applyAction(toState(rows, skips), action, new Date());
  if (!outcome.ok) return outcome;            // finally rolls back
  if (writes.length) await tx.batch(writes);  // multi-row INSERT ... ON CONFLICT DO NOTHING; DELETE ... WHERE content_id IN (...)
  await tx.commit();
  return outcome;
} finally { tx.close(); }                     // no-op after commit, otherwise rolls back
```

That is three round trips on a remote database instead of today's 59+. Do nothing slow between `transaction()` and `commit()`. A `SQLITE_BUSY` error is retried up to three times with a short delay instead of surfacing as a 500. A plain `db.batch` is not enough here: it is atomic but cannot read, decide, then write.

### 4.6 Client state

`src/lib/client/use-progress.ts` owns progress for the whole app:

- `confirmed`: the last state the server returned. `outbox`: actions not yet acknowledged. The state the UI renders is `outbox` folded over `confirmed` with `applyAction`.
- `dispatch(action)` validates locally with `applyAction`; on failure it returns the error for a toast; on success it appends to the outbox, the UI updates immediately, and a single drain loop posts actions one at a time in order.
- Drain results: 200 → replace `confirmed`, drop the action. 409 `confirm-required` → drop that action, replace `confirmed`, reopen the confirmation with the server's list. Any other 409/400 → drop **only the rejected action**, replace `confirmed` (refetch if the body has no state), then re-check each remaining queued action against the new state with `applyAction`, in order: the ones that still apply stay queued and keep syncing; the ones that no longer apply are removed. Show one message naming the rejected action and every action removed with it ("Couldn't save: Thor — needs Iron Man 2. Also not saved: Captain America: The First Avenger"), so nothing disappears silently. Never discard the queue wholesale: with offline mode it can hold a whole evening of ticks. 401 → sign-out screen. Network failure or 5xx → keep the outbox, set `status: "offline"`, retry with backoff (2 s, 5 s, 15 s, 60 s) and on the `online` and `visibilitychange` events.
- `src/lib/client/gateway.ts` defines `ProgressGateway { load(), send(action) }` with a remote implementation (fetch) and, in 4.1, a local one (localStorage). The existing `request` prop on `MarvelNexus` is the seam to replace.

`src/lib/client/use-url-state.ts`: query parameters are the source of truth for navigation-like state: `u` (`mcu` | `xmen` | `street`), `title` (content id; opens the drawer and switches universe), `view` (`lore` | `stats` | `plan` | `map` | `wrapped` | `account` | `catchup`). Opening an overlay calls `window.history.pushState`; closing from the UI calls `history.back()` when this session pushed the entry, otherwise `replaceState` to strip the parameter; switching universe uses `replaceState`. Read with `useSearchParams()` inside a `<Suspense>` boundary. This replaces `useHistoryClose` (which hard-codes `?lore`).

`src/lib/client/prefs.ts`: per-device preferences in localStorage behind `useSyncExternalStore`, following the pattern already in `src/components/nexus/pace-planner.tsx`. Keys: `doomflix.view.mode`, `doomflix.view.collapsed.v1`, `doomflix.plan.budget.v1`.

### 4.7 Required engine tests (write these with 1.2 and 1.3; extend in 2.2 and 2.3)

Titles in `code` are catalogue ids. "Full account" means every released unit watched.

| Area | Given → when → then |
| --- | --- |
| Graph | New closure equals the 0.2 characterisation fixture for all 92 ids; spot values from §4.4 hold. |
| Graph | Empty state: missing prerequisite is `iron-man` for `hawkeye`, `echo` and `multiverse-of-madness`; `xmen-2000` for `deadpool-2`; `defenders-daredevil-1` for `born-again-2`; none for `moon-knight`. |
| Graph | Acyclic; every referenced id exists; each universe list is date-sorted; no prerequisite releases after its dependent; no required series is `dataPending`. |
| Watch | Empty → watch `iron-man` → one row. Empty → watch `incredible-hulk` → `locked`, `missingId: "iron-man"`. |
| Watch | `wandavision` unlocked with episode 1 → watch episode 3 → `episode-order`. |
| Watch | watch(`iron-man`, 1), watch(`wandavision`, -1), watch(`wandavision`, 10) → `unknown-episode`, nothing changes. |
| Watch | Row already present → watch again → ok, nothing added, timestamp untouched. |
| Watch | `now` one millisecond before a title's UTC release → `unreleased`; at the instant → ok. |
| Watch | Prerequisites done → watch(`friendly-spider-man-2`, 1) → `pending`. |
| Watch | All earlier MCU done, no `xmen-2000` → watch `multiverse-of-madness` → `locked`, `missingId: "xmen-2000"`; after `xmen-2000` is watched **or skipped** → ok. `endgame` skipped → watch(`hawkeye`, 1) → ok. |
| Unwatch | Full account → unwatch `iron-man` → Moon Knight kept; every other later MCU title **and** `hawkeye` and `echo` cleared. |
| Unwatch | `defenders-daredevil-1` complete + S2 episodes 1–2 → unwatch(S1, 13) → S2 rows removed. |
| Unwatch | `wandavision` 1–9 plus later titles → unwatch(`wandavision`, 3) → episodes 4–9 and all dependents removed. Only episodes 1–3 watched → unwatch 3 → one row removed, no cascade. |
| Unwatch | Full account → unwatch(`iron-man`, 99) or unwatch(`wandavision`, -1) → error, zero rows removed. |
| Unwatch | Full account → unwatch `endgame` → `hawkeye` and `echo` cleared, Defenders-era titles kept. Unwatch `xmen-2000` → 13 X-Men and 28 MCU titles cleared (29 once 3.1 adds the finale); `endgame`, `hawkeye`, `moon-knight` kept. |
| Unwatch | Optional title (`she-hulk`) unwatched → no cascade. `wandavision` skipped with episodes 1–3 and dependents watched → unwatch episode 2 → episodes 2–3 removed, no cascade. An out-of-order (locked) title can be unwatched. |
| Skip | Empty → skip `incredible-hulk` → ok, and `iron-man-2` is still locked on `iron-man`. |
| Skip | `defenders-daredevil-1` episodes 1–5 → skip S2 → ok; watch(`defenders-punisher-1`, 1) → `locked` naming Daredevil S1. |
| Skip | `wandavision` 1–3 → skip → rows kept, satisfied, `falcon-winter-soldier` unlocks. Skipped title later fully watched → skip row gone. |
| Skip | `iron-man-2` skipped, everything else watched → unskip → `has-dependents`, nothing removed. Daredevil S1 complete, S2 skipped, Punisher S1 episode 1 → unwatch(S1, 13) → Punisher row removed, S2's skip kept. Skip and unskip are idempotent. |
| Bulk | watch [`thor`, `iron-man`, `incredible-hulk`, `iron-man-2`] → applied in graph order. [`endgame`] alone → rejected, names `endgame` and `missingId: "iron-man"`, nothing written. |
| Bulk | MCU Phases One–Four without `xmen-2000` → rejected at `multiverse-of-madness` naming `xmen-2000`. Same id in both lists → `invalid`. Rows that already exist keep timestamp and flag. Replaying the same bulk adds nothing. |
| Stats | All required titles skipped → finite, complete. 23 saga films + `wandavision` 1–8, then skip `wandavision` → ratio ≤ 1 and no double counting. Ratio is 1 exactly when complete. A `dataPending` series adds 0 units and is never complete. Remaining time excludes skipped units. |
| Properties (random action sequences) | Every title with watched rows has all ancestors satisfied; episodes form a 1..n prefix; input state is never mutated; the returned diff equals the state delta; for skip-free sequences the result equals a replica of today's algorithm except for the listed fixes; merging two valid states gives a valid state. |
| Unrecognised rows | State containing a row for an id not in the catalogue, and a row for `wandavision` episode 99 → every engine function and `GET /api/progress` succeed, the ids appear in `unrecognised`, and after any other action both rows are still in the database. |
| Persistence | Rule failure → 409 and nothing written. Thrown database error → 500 with a generic message. Two concurrent writes for one user both end in a valid state. Clearing more than `confirmCleared` allows → `confirm-required`. |

---

## 5. Work packages

### M0 — Foundations

#### 0.1 Put the plan in the repo and publish the roadmap page
- Copy this file to `NEXT_LEVEL_PLAN.md` in the repo root (the repo already keeps `UI_REDESIGN_PLAN.md` and `MOBILE_SCALING_PLAN.md` there, each with an implementation record). Add an "Implementation record" section at the bottom; every later package appends to it.
- Publish §1 as a private, shareable page with the Artifact tool (load the `artifact-design` skill first; one HTML file kept at `docs/roadmap.html`; use the app's palette from `:root` in `globals.css`). Content: the six milestones, what the user gets, target date, a status chip per milestone, and the four problems from §0 in one sentence each. **Describe security work only as "account security hardening"**; do not list unfixed weaknesses on a shareable page. Give the owner the link; republish the same file at each milestone.
- If the Artifact tool is unavailable in the implementing session, keep `docs/roadmap.html` as the deliverable and say so.
- [x] Acceptance: file exists in repo; owner has the link; no security specifics on the page. *(Done 2026-11-15: `NEXT_LEVEL_PLAN.md` and `docs/roadmap.html` are in the repo; the page is published as a private artifact (link in the Implementation record); security work appears only as "account security hardening".)*

#### 0.2 Unit-test harness and characterisation tests
- Add dev dependencies per `02-guides/testing/vitest.md`: `vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/dom vite-tsconfig-paths`. Create `vitest.config.mts` (default environment `node`; component tests opt into jsdom with a file-level comment; alias `server-only` to an empty stub so server modules import under test). Scripts: `"test": "vitest run"`, `"test:watch": "vitest"`, `"typecheck": "tsc --noEmit"`.
- `tests/unit/characterisation.test.ts`, written **before any refactor**, pinning today's behaviour from `src/lib/content.ts`: for all 92 titles, the ordered output of `getPrerequisiteChain(item)`; and for a fixed set of watched states (empty; Phase One complete; everything through `endgame`; `xmen-2000` only; Daredevil S1 complete), the `isUnlocked` result and `missingPrerequisite` id for every title. Store as an inline snapshot.
- `tests/unit/catalogue.test.ts`: ids unique; every `requires` id exists; each universe list is sorted by `releaseDate`; every series has one title per episode; every id has `public/posters/<id>.webp` and `public/backdrops/<id>.webp` unless listed in an explicit placeholder allow-list.
- `scripts/catalogue-check.mjs` + `"catalogue:check"` script: prints titles whose `releaseDate` has passed but still have `dataPending` or placeholder episode titles (`/^Episode \d+$/`). Today that reports `friendly-spider-man-2` and `born-again-2`.
- [x] Acceptance: `npm test` green; snapshot committed to the working tree. *(Done 2026-11-15: 33 tests pass in two files; six inline snapshots are in `tests/unit/characterisation.test.ts`.)*

#### 0.3 End-to-end and screenshot harness
- Add `@playwright/test`. `playwright.config.ts` starts `next dev -p 3210` with `TURSO_DATABASE_URL=file:.tmp/e2e.db`, projects for 1440×900, 1366×768 and a 390×844 touch device. Add `.tmp/` to `.gitignore`; a global-setup step creates the folder and deletes any previous `e2e.db` so every run starts empty.
- `tests/e2e/smoke.spec.ts`: sign up → mark Iron Man → reload → still watched → un-watch → sign out.
- `tests/e2e/screens.spec.ts` (`npm run shots`): seeds a profile through the API (nine MCU films, `xmen-2000`, four Daredevil S1 episodes) and saves screenshots of: sign-in, dashboard top, archive, movie drawer, locked drawer, series drawer, command palette, lore guide — each at the three sizes — into `.tmp/shots/`. Also asserts no horizontal overflow and records the first card's top offset and the count of visible text nodes under 11 px (baseline today: 1,379 px and 24 at 1440×900).
- [x] Acceptance: both specs pass; baseline screenshots produced and viewed. *(Done 2026-11-15: both specs pass at all three sizes; 24 baseline images in `.tmp/shots/` were produced and viewed, see the baseline table in the Implementation record.)*

#### 0.4 Continuous integration
- `.github/workflows/ci.yml`: on push and pull request, Node 22, `npm ci`, lint, typecheck, `npm test`, `npm run build`, then the Playwright smoke spec with browsers cached.
- [x] Acceptance: workflow file validates locally with the same commands. *(Done 2026-11-15: the YAML parses and every step is well-formed; lint, typecheck, `npm test`, `npm run build` and the smoke spec (with `CI=true`) all pass locally; `npm ci --dry-run` confirms the lockfile matches. The workflow itself has not run on GitHub yet.)*

#### 0.5 Migration framework
- Implement §4.3 with version 1 only. `ensureDatabase()` keeps its single-promise guard. Each migration runs in its own transaction and records itself.
- **Two servers starting at once.** On a serverless host two cold starts can both see a migration as missing. The "is this version applied?" check must therefore happen **inside** the same write transaction that applies it (open the write transaction, read `schema_migrations`, apply only what is still missing, record, commit). The second starter then waits for the first, finds the version recorded and does nothing. A `SQLITE_BUSY` or "duplicate column" error during migration is retried by re-reading the version table, never surfaced as a failed request. Test it: run `ensureDatabase` from two clients on the same temp file at the same time; both succeed and each migration is recorded once.
- **Before the first production deploy of any migration** (an owner step; agents do not have production access): take a backup of the production database (a Turso dump or branch), run the new build once against a copy of it, and confirm row counts for `users`, `sessions` and `progress` are unchanged. Record this in the implementation record. Checked locally on 2026-11-15: migrations 2–4 applied to a database with today's schema left every existing row byte-identical, and today's code still ran against the migrated schema, so rolling back the app is safe.
- Two hazards to design out: (a) today `ensureDatabase` caches its promise forever, so one failed setup would make every later request fail until the process restarts — clear the cached promise on rejection; (b) `ALTER TABLE … ADD COLUMN` is not repeatable — besides the version record, guard each `ALTER` with a `pragma_table_info` check so a half-applied state can never wedge start-up.
- `tests/api/migrations.test.ts`: fresh temp database reaches the latest version; a database created by today's code (tables present, no `schema_migrations`) upgrades without data loss; running twice is a no-op. Use a temp **file** database in tests, not `:memory:` (the in-memory client has a single connection and rejects other statements while a transaction is open).
- [ ] Acceptance: the owner's existing database shape upgrades cleanly in the test (never run against the real file).

#### 0.6 Housekeeping
- Remove unused dev dependencies `@fontsource/inter`, `@fontsource/space-grotesk` (fonts come from `next/font/google` in `src/app/layout.tsx`).
- Delete unused `public/file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg` and the empty `marvel-checklist/` folder.
- Rename the package to `doom-flix`. Fix the mis-encoded dash in `README.md` ("Seasons 1â€“2"). Document in the README: the scratch-database rule, the test commands, and that Tailwind is kept only for its reset.
- Add `src/app/error.tsx`, `global-error.tsx`, `not-found.tsx` styled like the existing `.loading-screen.error-screen`.
- [ ] Acceptance: build and screenshots unchanged.

### M1 — Correct and safe

*Package numbers are stable references used throughout this plan, so M1 starts at 1.2.*

#### 1.2 Split catalogue and engine; make prerequisites declarative (pure refactor)
- Depends on 0.2. Move the data arrays to `src/lib/catalogue/*`, add the override fields from §4.4, build `graph.ts`, and re-export everything from `src/lib/content.ts` under today's names so no other file changes.
- Remove the hard-coded special cases from `priorRequiredItems` / `directPrerequisiteItems` (`["deadpool","deadpool-2","moon-knight"]`, the `hawkeye`, `deadpool`, `deadpool-2`, `multiverse-of-madness` branches) in favour of the data.
- [ ] Acceptance: the characterisation snapshot from 0.2 is **byte-identical**; `graph.ts` has tests for cycle detection and unknown ids.

#### 1.3 Reducer, transactional persistence and the progress bug fixes
- Depends on 0.5, 1.2. Implement `state.ts`, `release.ts`, `reducer.ts`, `stats.ts`, `format.ts` (§4.4), migration 2, and `applyUserAction` (§4.5). Rewrite `POST /api/progress` on top of it; delete `clearDependents` and `clearInvalidCompletedItems`.
- Bugs this must fix, each with a regression test in `tests/api/progress.test.ts` against a temp database:
  1. Watch `iron-man`, watch `moon-knight` episodes 1–2, un-watch `iron-man` → Moon Knight's two rows remain (today they are deleted).
  2. Watch all 13 of `defenders-daredevil-1`, watch `defenders-daredevil-2` episodes 1–2, un-watch Daredevil S1 episode 13 → S2 has no rows (today two orphaned rows remain).
  3. Un-watching `iron-man` with ten later films watched issues a bounded number of statements (assert via a counting wrapper: no per-title loop) and is atomic (inject a failure after the first write and assert nothing changed).
  4. A user with every other MCU unit watched reads 100% for the MCU tab even though `friendly-spider-man-2` is `dataPending`.
  5. Release lock agrees between `isReleased` on client and server for a fixed `now` either side of UTC midnight.
  6. Full account, un-watch `iron-man` → `hawkeye` and `echo` are cleared too. (Found by replaying today's `clearDependents` logic: the Street clean-up only runs when the title un-watched is literally `endgame`, so un-watching any of the 21 earlier films deletes Endgame but leaves Hawkeye and Echo watched.)
  7. `unwatch` with an episode number the title does not have changes nothing (today, a bogus episode on a film keeps the film and deletes every later title).
- Rows already left out of order by the old bugs: do **not** delete them automatically. `GET /api/progress` includes `outOfOrder: string[]` from `outOfOrderTitles`; those cards show "Watched out of order" and their un-watch control stays enabled (today un-ticking is disabled on locked titles at three places in `marvel-nexus.tsx`: the card action, the episode rows, and the drawer action, so such rows cannot be removed at all).
- Everything that reads progress must take the viewing index, not a bare `Set<string>`: besides `marvel-nexus.tsx`, that is `src/components/nexus/command-palette.tsx`, `multiverse-shelf.tsx`, `lore-scenes.tsx` and `lore-experience.tsx`.
- `GET /api/progress` returns the new shape; the client (`marvel-nexus.tsx`) is adapted minimally: build the viewing index from `state`, keep its current request flow (the outbox arrives in 2.1). Replace all `formatRuntime` call sites. Update `scripts/reset-users.mjs` to clear `skips`.
- [ ] Acceptance: all regression tests and the §4.7 matrix rows for graph, watch, unwatch, stats, properties and persistence are green; characterisation snapshot still identical for watched-only states; e2e smoke green.

#### 1.4 Account security hardening
- `src/lib/rate-limit.ts` (migration 3), fixed-window counters with one upsert per check. Limits: login 8 per 15 min per username and 40 per 15 min per IP; signup 5 per hour per IP; recover 5 per hour per username. IP = first entry of `x-forwarded-for`, else `x-real-ip`, else `"unknown"`. Over the limit → 429 with `Retry-After`; a successful login clears that username's bucket.
- Login compares against a fixed dummy bcrypt hash when the username does not exist, so timing does not reveal which usernames exist.
- New passwords need 8–72 characters (`signup`, `recover`, change-password). The sign-in form keeps accepting existing shorter passwords; the signup form's `minLength` becomes 8.
- `src/lib/http.ts`: `assertSameOrigin`, `jsonError`, a `RuleError` class. Apply to every POST/PUT/DELETE handler.
- Sessions: delete expired sessions on each login; extend a session (row and cookie) when under 15 days remain, in route handlers only (cookies cannot be set during a Server Component render).
- `next.config.ts` `headers()`: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, `Strict-Transport-Security` in production, and the no-nonce CSP from the bundled guide extended with `connect-src 'self'; worker-src 'self'; manifest-src 'self'`.
- Tests: the ninth wrong login within the window returns 429; cross-origin POST returns 403; signup with a 7-character password returns 400. E2E asserts no CSP violations in the console on every screen.
- [ ] Acceptance: tests green; headers present on `curl -I`.

#### 1.5 Account panel and recovery
- Migration 4. Signup generates a recovery code (20 Crockford-base32 characters shown as four groups of five), stores its SHA-256, and returns it once; the client shows it in a dialog with Copy and Download and an "I saved it" confirmation.
- `POST /api/auth/recover { username, recoveryCode, newPassword }` resets the password, issues a new code, deletes all of that user's sessions.
- `src/components/nexus/account-panel.tsx` (dialog using `useDialogBehavior` from `src/lib/use-motion.ts`), opened from the operator name in the top bar: change password, generate a new recovery code, sign out everywhere, delete account (type the username to confirm; deletes rows from every table in one batch), storage mode line (replaces the "LOCAL VAULT" label in the top bar).
- Sign-in screen gains "Forgot password?" → recover form.
- [ ] Acceptance: API tests for each endpoint including wrong-password and rate-limit cases; e2e: sign up, save code, recover with it, old password fails.

#### 1.6 Quick visual and accessibility fixes (small, independent)
- Phone collision: in `.checkpoint-counts > div` the label overruns its number at 390 px ("REMAINING93"). Let the label truncate (`overflow: hidden; text-overflow: ellipsis; white-space: nowrap` on `dt`) and stop the number shrinking (`flex: 0 0 auto` on `dd`).
- Watched cards say "Ready to watch": show `.card-availability` only for locked or scheduled titles.
- Locked drawer: the primary button reads "Complete prerequisite first" and is disabled but styled as the main action. Make it "Go to {prerequisite.title}" calling `onOpenPrerequisite(prerequisite)`; for a scheduled title show "Releases {date}" as plain text.
- Remove "+ 0 specials" (omit zero-count parts), the "SYNCED" caption under both progress rings, and the top bar's inert "Timeline" button and three universe buttons (the universe switch below and keys 1/2/3 remain).
- Developer credit: remove `<DeveloperCarousel placement="dashboard" />`; add "Developed by Abdul Rehman Shahid" to the footer. On the sign-in screen keep the carousel but drop `aria-live`, pause rotation on hover/focus and under reduced motion (today a screen reader hears it every 4.6 s).
- Filter groups get `role="group"`.
- [ ] Acceptance: screenshots at all three sizes; first-card offset drops by at least the 54 px credit band.

### M2 — Fast start, fast flow

#### 2.1 Client progress store: instant ticks, Undo, accurate confirmations
- Depends on 1.3. Implement `gateway.ts` (remote) and `use-progress.ts` (§4.6); `MarvelNexus` stops owning `progress`, `busyKey` and `persistToggle`.
- Buttons are no longer disabled while saving; a unit with a pending action shows a subtle saving indicator. An "offline — changes will sync" chip appears in the top bar when `status` is offline.
- The "Checkpoint secured" toast gains **Undo** (dispatches the matching `unwatch`) for 6 s.
- Un-watch confirmation is shown only when `applyAction` reports `cleared.length > 0` or later episodes would be removed, and lists exactly what will be cleared (today it fires whenever the row is not the newest, even if nothing depends on it).
- The confirmed list is sent as `confirmCleared`; on a `confirm-required` reply the dialog reopens with the server's list (§4.5).
- Move `detectNewlyUnlocked` / `detectMilestones` to the engine. `dispatch` returns `{ before, after }` viewing indexes captured **before** the optimistic update is applied; toasts are computed from that pair. (Computing them from component state after an optimistic update would compare the new state with itself and never fire.)
- Toasts for every action type: watch (as today, plus Undo); skip ("Skipped — later titles unlocked" when any were); bulk and catch-up get **one** summary toast that lists all milestones reached, since the existing stack keeps only one toast per kind.
- Tests: reducer-fold unit tests (pending actions survive a slow response; retries are idempotent; with five actions queued and the second rejected, the independent ones still sync, only the rejected one and those that depended on it are removed, and the message names each of them). E2E: tick three titles rapidly, all persist after reload; throttle the network and confirm the tick shows immediately.
- [ ] Acceptance: tests green; no code path awaits the server before updating the UI.

#### 2.2 Skipped state
- Depends on 2.1. Wire `skip` / `unskip` end to end (table from migration 2).
- Card overflow menu and drawer secondary action "Skip this title" → confirmation explaining "It will count as cleared for unlocking later titles, but not as watched", with an optional "What you need to know" recap behind a "Reveal (spoilers for this title)" toggle when `extras.ts` has one.
- Skipped card state: "Skipped" chip, muted poster, actions "Watch anyway" (normal marking; the skip disappears once fully watched) and "Un-skip". Un-skip is disabled, with the reason shown, when later watched titles depend on this one ("Mark it watched instead").
- New archive filter value under Progress: "Skipped". Stats and rings show "N skipped" beside watched/remaining.
- Switch every "is there more to do?" consumer from watched-complete to `isOutstanding`, otherwise a skipped title keeps showing as next or remaining: `doomsdayComplete`; the remaining runtime fed to the pace planner; the Remaining figure in `CheckpointCounts`; `nextRequired`, `nextUnlocked`, `nextByUniverse`; the "Unwatched" filter; `inProgressSeries` (a skipped, partly watched series must leave the in-progress list); the lock and complete icons in the command palette, shelf and lore scenes.
- [ ] Acceptance: reducer tests for: skipping a locked title; skip → watch → auto-removal; skip keeps watched episodes; unskip refused with `has-dependents`; unwatch never removes skips. E2E: skip *The Incredible Hulk*, *Iron Man 2* unlocks.

#### 2.3 Bulk marking and the catch-up wizard
- Depends on 2.2. Wire `watchAll` and `bulk`.
- Series drawer: "Mark all N remaining episodes watched" beside the per-episode button. Series cards get a direct "Mark E05 watched" button (today you must open the drawer).
- `src/components/nexus/catch-up-wizard.tsx` (dialog, `view=catchup`):
  1. **MCU**: "Pick the latest title you've seen" — phase-grouped list with posters, plus quick picks "Nothing yet", "Through Endgame", "Everything released".
  2. **X-Men** (same pattern) and **Street-Level** (checkbox list of seasons; ticking a season auto-ticks its prerequisites from `prerequisiteChain`, with a note saying so).
  3. **Review**: "Will mark N movies and M episodes (Xh) as watched". Each title has a "Haven't seen this" toggle: for a required title that becomes a **skip** (so later titles stay unlocked; it is labelled clearly); for an optional title it is simply left out. Optional titles released before the chosen point are listed un-ticked.
  4. Confirm → one `bulk` action with `backfilled: true` → toast "Caught up: N titles · readiness now P%".
- The wizard builds its list so the server never has to refuse it: the selection is always closed over `prerequisiteChain`, **across universes** (choosing an MCU title at or after *Multiverse of Madness* pulls in *X-Men* (2000); choosing *Hawkeye* pulls in everything through *Endgame*), and the Review step says which titles were added for that reason. Unreleased titles and `dataPending` series are not selectable. If the server still rejects, show the title and the missing prerequisite it names, with a button that adds it.
- Entry points: straight after signup (replacing the automatic lore guide; the wizard links to "How it works"), the account menu, and an inline prompt above the archive while the profile has no progress.
- Tests: bulk ordering, whole-action failure naming the offender, backfilled rows excluded from pace. E2E: new account → "Through Endgame" → readiness jumps, reload persists, under 60 s of interaction.
- [ ] Acceptance: tests green.

#### 2.4 Split the monolith and server-render the first screen
- Depends on 2.1. Pure restructuring in three steps; run `npm run shots` and compare after **each** step before starting the next.
- **Step A, components.** Split `src/components/marvel-nexus.tsx` (1,175 lines) into `src/components/nexus/`: `auth-screen`, `loading-screen`, `topbar`, `universe-switch`, `status-panels`, `archive-toolbar`, `timeline-card`, `watch-source`, `prerequisite-chain`, `detail-drawer`, `unwatch-confirmation`, `developer-carousel`, plus `nexus-app.tsx` as the remaining shell. Move code, do not rewrite it.
- **Step B, styles.** Split `src/app/globals.css` (one 100 KB file) into `src/styles/*.css` imported from `globals.css` **in the original order** (the responsive overrides must stay last). No selector or value changes.
- **Step C, server render.** `src/app/page.tsx` becomes an async Server Component: read the session cookie with `await cookies()`, load user and viewing state through a new `getSessionUserByToken(token)` in `src/lib/session.ts` (shared with route handlers), read and parse `public/watch-links.csv` on the server (cache in module scope), pass plain serialisable props (arrays and objects, not `Map`/`Set`) to the client shell. Signed-out visitors get the sign-in screen with no loading flash. After login/signup/logout the client keeps using the gateway (no full reload).
- Hydration (step C): anything that depends on the current time (countdown digits, days left, release locks, pace) must not differ between server HTML and first client render. Pass a `serverNow` ISO string for the first render and render the ticking countdown only after mount.
- [ ] Acceptance: screenshots identical after steps A and B; after step C no hydration warnings in the e2e console check, and a signed-in first paint shows the dashboard without the "Calibrating the timeline" screen.

#### 2.5 URL state and the Back button
- Depends on 2.4. Implement `use-url-state.ts` (§4.6) and move `selected`, `loreOpen`, `universe` and the new overlays onto it. Remove `useHistoryClose`.
- Acceptance (e2e): `/?u=xmen&title=logan` opens Logan's drawer on the X-Men tab; opening a drawer then pressing Back closes it without leaving the app; on the phone project the same holds for the lore guide; Forward reopens.

#### 2.6 Page top: top bar, "Up next" billboard, status strip
- Depends on 2.4. This replaces the hero, both stat rows, the "next required checkpoint" panel and the shelf.
- **Top bar**: brand · Lore · Stats · Plan · search · account button (menu: Account, Catch up, Install app, Log out).
- **Up-next billboard** (`up-next-hero.tsx`, about 250 px tall on desktop) over the next title's backdrop: eyebrow "UP NEXT · MCU · 10 of 60"; the title; release date, duration and phase; a one-line summary; primary **Mark watched** (or "Mark E05 watched" for a series) calling `dispatch` directly; secondary "Details"; a watch-provider button when a link exists. If the next required title is locked by another universe, the primary action is "Go to {prerequisite}". Under the buttons, chips for the next title in the other two universes and any series in progress (this absorbs `MultiverseShelf`). The countdown sits on the right in a compact form.
- **Status strip** (`status-strip.tsx`, one row): Doomsday readiness ring with watched / remaining / skipped; required time left with a pace chip that opens the Plan; the active tab's completion bar; a "Details" disclosure revealing today's counter grid and local time panel.
- Phone: billboard with the action visible on first paint; countdown collapses to a chip ("32d 17h to Doomsday"); strip becomes two compact tiles.
- [ ] Acceptance: at 1440×900 the first card's top is ≤ 720 px (was 1,379); at 1366×768 it is inside the first viewport; at 390×844 the billboard's primary action is fully visible without scrolling; marking from the billboard advances it to the next title.

#### 2.7 Cards, toolbar, phase collapse, view modes
- Depends on 2.6.
- **Card**: poster (96×144) · meta line (number, date, duration, phase) · title · two-line summary · **one** state row:

  | State | Row |
  | --- | --- |
  | Available movie/special | "Mark watched" (primary) |
  | Available series | progress bar "4/13" · "Mark E05 watched" · "Open" |
  | Watched | "Watched · {date}" in muted text; poster dimmed; overflow menu holds "Remove watched status" |
  | Locked | "Needs {prerequisite}" (opens it) |
  | Scheduled | "Releases {date}" |
  | Skipped | "Skipped" · "Watch anyway" |

  Required/Optional badge and the watch-provider icon sit top-right. Target card height ≤ 190 px on desktop.
- **Toolbar** (`archive-toolbar.tsx`, one sticky row): archive title and count · search · Mission, Format and Progress as segmented controls with their labels attached (today the labels float ~350 px from their buttons) · view-mode switch. On phones the filters open in a sheet from a "Filters" button showing the active count.
- **Phase collapse**: `.era-heading` becomes a button showing "Phase One · 6/6"; phases whose titles are all satisfied start collapsed; state persists per universe and phase; search or any filter ignores collapse.
- **View modes** (persisted): Cards (above), Compact (56 px rows: status icon, number, title, duration, action), Posters (poster grid with a status overlay; tap opens the drawer).
- [ ] Acceptance: screenshots of all three modes at three sizes; MCU page height in Cards mode drops by at least 40% from 12,900 px at 1440 px width.

#### 2.8 Readability pass
- Raise every font size under 11 px (rules at 8–10.5 px in `globals.css`: brand small text, flap labels, clock caption, ring caption, viewing-path status, lore tags) to at least 11 px, adjusting spacing so nothing clips.
- [ ] Acceptance: the screenshot spec's "visible text under 11 px" count is 0 on every screen and size; no horizontal overflow.

### M3 — The deadline

#### 3.1 Mission model and the finale checkpoint
- `src/lib/missions.ts`: `type Mission = { id; title; shortTitle; finaleContentId; releaseDate; universes: Universe[] }`. `MISSIONS = [doomsday]` (`releaseDate: "2026-12-18"`, `universes: ["mcu","xmen"]`, `finaleContentId: "avengers-doomsday"`). A mission's **readiness set** is every `required` title in its universes released before the mission date, excluding the finale.
- Replace the three hard-coded dates/labels: `DOOMSDAY` in `marvel-nexus.tsx` (line 76 today), the caption in `src/components/nexus/doom-clock.tsx`, the finale beat in `src/components/nexus/lore-experience.tsx`. Replace `getStats([...MCU_CONTENT, ...XMEN_CONTENT], …)` with `missionStats(mission, index)`.
- Catalogue: add `avengers-doomsday` (movie, MCU, Phase Six, `2026-12-18`, required, runtime unknown). A movie with unknown runtime is still one tickable unit and shows "TBD". Add a `PosterImage` component that falls back to a generated tinted placeholder (title on the brand gradient) when an image is missing, and add the id to the placeholder allow-list in the catalogue test.
- After the countdown reaches zero the clock shows "DOOMSDAY IS HERE", the pace planner hides, and when the readiness set is satisfied the billboard's action becomes "Mark Avengers: Doomsday watched", which opens Wrapped (3.5).
- [ ] Acceptance: unit tests with a fake `now` before, on and after release; readiness numbers unchanged from before the package (47 movies + 56 episodes).

#### 3.2 Tiers and Essential-path triage
- `src/lib/catalogue/tiers.ts`: `ESSENTIAL_IDS`; each required title is `essential` or `recommended`; non-required titles are `optional`. **Draft list for the owner to edit (D1):** `iron-man`, `captain-america-first-avenger`, `avengers`, `winter-soldier`, `guardians-1`, `age-of-ultron`, `civil-war`, `doctor-strange`, `thor-ragnarok`, `black-panther`, `infinity-war`, `endgame`, `wandavision`, `loki-1`, `no-way-home`, `multiverse-of-madness`, `loki-2`, `agatha`, `thunderbolts`, `fantastic-four-first-steps`, `visionquest`, `xmen-2000`, `x2`, `days-future-past`, `logan`, `deadpool`, `deadpool-2`, `deadpool-wolverine`.
- Badge "Essential" on cards; Mission filter gains "Essential".
- `triage-dialog.tsx`, opened from the pace chip when behind and from the Plan: compares the full required path and the Essential path (hours left, hours per day needed, whether each fits before the date) and an "I have about N hours" slider. "Switch to the Essential path" dispatches one `bulk` skip with `skipReason: "triage"` for every unwatched required non-essential title, after a confirmation listing them (skips need no particular order and work on locked titles). Titles skipped this way stay individually watchable ("Watch anyway") and follow the normal un-skip rule. "Back to the full path" un-skips every triage skip that the un-skip rule allows and lists any it could not.
- Write `recap` text in `extras.ts` for the titles triage skips, only where the implementing agent is confident of the facts; list the rest for the owner instead of guessing.
- [ ] Acceptance: tests for tier derivation and the triage action; e2e: at 14% with the default budget the dialog shows the full path not fitting and the Essential path's numbers; switching updates readiness and unlocks.

#### 3.3 Schedule planner
- `src/lib/engine/schedule.ts` (pure): input = remaining readiness-set units in **watch-queue order**, a budget `{ weekdayMinutes, weekendMinutes }`, start date, deadline. Greedy fill per day: add the next unit while the day's total stays within 115% of the budget; a unit longer than the budget takes a day by itself. Output: `{ days: [{ date, units, minutes }], finishDate, fitsBeforeDeadline, spareDays }`.
- Watch-queue order (`watchQueue(mission, index)`, also used by "Up next" chips): MCU titles keep their release order. An X-Men title is placed as late as it is needed, not at its 2000s release date: give every title an *anchor date* — an MCU title's anchor is its own release date; an X-Men title's anchor is the earliest anchor among titles outside its universe that directly require it, otherwise the release date of the last required X-Men title in the readiness set. Sort by anchor, then prerequisites before dependents, then own release date; finish with a pass that guarantees every prerequisite precedes its dependents. Result today: `xmen-2000` lands immediately before `multiverse-of-madness`, and the rest of the X-Men chain forms one block ending in `deadpool-wolverine` at that film's 2024 slot. Unit-test exactly that.
- Actual pace: average minutes per day over the last 14 days from non-backfilled rows; projected finish date from it.
- `plan-panel.tsx` (`view=plan`): budget controls (weeknight / weekend, presets 1h, 2h, 3h, custom); "Tonight", "Tomorrow", then dated days; finish date against the deadline; "at your recent pace you finish on …"; "What fits in N minutes" (the next available unit per universe and per in-progress series that fits); "Add to calendar" downloading an `.ics` built client-side (one event per day, default 20:00 local, title lists the units). The existing `PacePlanner` chip stays as the summary and opens this panel.
- [ ] Acceptance: unit tests (budget boundaries, long films, weekend budget, finish date, empty queue); e2e downloads a valid `.ics`.

#### 3.4 Stats and achievements
- `stats-panel.tsx` (`view=stats`): hours watched; titles and episodes; current and longest streak (local days with at least one non-backfilled row); a burn-down chart of required hours remaining (actual stepped line, ideal line to the release date, projection from recent pace) drawn as inline SVG with no chart library (load the `dataviz` skill first if the session has it); per-phase and per-universe bars; a 12-week activity grid.
- `src/lib/engine/achievements.ts` (derived, no storage): six Infinity Stones for completing the required titles of Phases One to Six; "Mutant and Proud" (X-Men required set); "Hell's Kitchen" (Street-Level); "Completionist" (every optional title); streak badges at 3, 7 and 14 days. Shown as a gauntlet row in Stats; earning one upgrades the existing milestone toast to a short full-screen moment (static under reduced motion).
- [ ] Acceptance: unit tests for streaks across midnight, backfilled exclusion, each achievement; screenshots.

#### 3.5 Doomsday Wrapped and the share card
- `src/lib/engine/wrapped.ts`: totals, first and latest watch, days active, longest streak, biggest single day, readiness, skipped count, achievements.
- `wrapped-view.tsx` (`view=wrapped`), offered from Stats, on release day, and after the finale is marked.
- `GET /api/share-card?variant=progress|wrapped` → 1200×630 PNG via `ImageResponse` (as the icon routes in `src/app/icon-192.png/route.tsx` already do): brand mark, "P% ready for Doomsday", hours watched, days left; the username only if `name=1`. "Share" uses the Web Share API with the file where supported, otherwise downloads it.
- [ ] Acceptance: route test returns a PNG for a signed-in user and 401 otherwise; screenshot of the card.

### M4 — Reach

#### 4.1 Guest mode, import and export
- Local `ProgressGateway` storing the viewing state in localStorage key `doomflix.guest.v1` and applying `applyAction` directly. Sign-in screen gains "Try without an account"; a persistent banner says progress is on this device only.
- Creating an account (or signing in) while guest progress exists posts it to `POST /api/progress/import`; the local copy is cleared only after a 2xx reply. Import is unit-level, merges with what the account has, and is safe to repeat (§4.4).
- Account panel: "Download my data" (`GET /api/progress/export`) and "Import" (same endpoint). Any rows the server left out are listed to the user with the reason.
- [ ] Acceptance: e2e guest → mark five titles and three episodes of a series → sign up → exactly that progress is on the account and after reload; importing a file containing an impossible row keeps the valid rows and reports the invalid one; importing twice changes nothing.

#### 4.2 Mobile shell
- Bottom tab bar at ≤ 820 px: Timeline · Up next · Stats · Account (respects `env(safe-area-inset-bottom)`); the top bar keeps brand and search.
- Detail drawer on phones: drag handle and swipe-down to dismiss by extending `useSwipeToDismiss` in `src/lib/use-motion.ts` with an axis option (it is horizontal-only today).
- Swipe right on a card to mark watched (with the Undo toast); `navigator.vibrate?.(10)` on a successful mark.
- [ ] Acceptance: phone screenshots; e2e swipe-down closes the drawer and Back still works.

#### 4.3 Offline
- Hand-written `public/sw.js`, registered in production only as in the bundled PWA guide, with the `/sw.js` headers from that guide in `next.config.ts`. Strategies: navigations network-first with the cached page as fallback; `/_next/static/*` cache-first; `/posters/*`, `/backdrops/*` and `/_next/image*` stale-while-revalidate with a size cap; `GET /api/progress` network-first with cached fallback; every other `/api/*` network-only. A cache version constant is bumped on each release. (The guide names Serwist as the alternative if build-time precaching is ever wanted.)
- Persist the outbox per user (`doomflix.outbox.v1:<userId>`) and restore it on load so ticks made offline sync later. The rejection rule in §4.6 applies unchanged: one rejected action never discards the rest. Add an e2e case: queue six ticks offline, make one invalid from a second session, reconnect, and confirm the other five are saved and the user is told about the one that was not.
- Manifest (`src/app/manifest.ts`): add `id`, `shortcuts` (Up next, Stats), `screenshots`; remove the `orientation: "portrait"` lock.
- [ ] Acceptance: e2e with the network disabled after first load: reload shows the dashboard with last progress, a tick shows immediately, re-enabling the network syncs it.

#### 4.4 Push reminders
- Dependency `web-push`; env `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `CRON_SECRET`; migration 6. Follow `02-guides/progressive-web-apps.md` §2–5 for subscription and the `push` / `notificationclick` handlers in `sw.js`.
- Account panel toggle "Reminders". `GET /api/cron/reminders` (requires `Authorization: Bearer <CRON_SECRET>`) sends at most one message per user per day: days left, hours to go, tonight's title from the schedule; plus "now available" on a title's release day. `vercel.json` schedules it daily. Dead subscriptions (404/410) are deleted.
- With the env vars missing the toggle is hidden and the route returns 503.
- [ ] Acceptance: unit tests for message selection and the once-a-day rule with a mocked sender; manual check with `next dev --experimental-https` recorded in the implementation record.

### M5 — Depth

#### 5.1 TMDB sync (dev-time)
- `scripts/sync-tmdb.mjs`, run by hand with `TMDB_API_KEY`; exits with instructions if the key is missing. `src/lib/catalogue/tmdb-ids.json` maps each id to `{ type, tmdbId, season? }`; `--resolve` searches by title and year and writes candidates for the owner to confirm (do not guess ids).
- For each mapped title: runtimes, episode titles and runtimes, release date (report differences; never overwrite dates silently), trailer key, the watch-provider page link; download missing poster/backdrop, convert to WebP with `sharp`, then run the existing `npm run tints`.
- Output goes to `src/lib/catalogue/overrides.generated.json`, merged at module load; the script prints a diff. Add to the footer the attribution notice that TMDB's API terms require (read the current terms; do not paraphrase from memory).
- [ ] Acceptance: with a key, `friendly-spider-man-2` and `born-again-2` lose their pending/placeholder data and `npm run catalogue:check` is clean; without a key nothing changes.

#### 5.2 Per-title extras
- `extras.ts`: `postCredits` (number of mid/post-credit scenes), `characters` (tags), `trailerYouTubeId`, `recap`. Author post-credit counts and character tags only where confident; leave the rest empty and list them for the owner.
- Drawer: "Stay for N credit scenes" line; trailer as a click-to-load `youtube-nocookie.com` embed (add `frame-src https://www.youtube-nocookie.com` to the CSP); "Your log" with a 1–5 rating and a private note (migration 5, `PUT /api/notes/[contentId]`, notes included in `GET /api/progress`).
- Archive toolbar: "Thread" selector (e.g. Spider-Man, Loki) filtering to tagged titles; locks still apply and the card shows how many prerequisites sit outside the thread.
- [ ] Acceptance: API tests for notes; screenshots of the drawer sections.

#### 5.3 Timeline map
- `src/lib/engine/map-layout.ts` (pure): lanes for the MCU spine (optional titles offset below it), X-Men, and one lane per Street-Level show; x by release order; edges from `reducedEdges()` including the cross-universe links (`xmen-2000` → `multiverse-of-madness`, `endgame` → `hawkeye`).
- `timeline-map.tsx` (`view=map` and a fourth view mode): horizontally scrollable; nodes are poster chips coloured by state and open the drawer; "Centre on next" button; keyboard focus order follows watch order; a list alternative is always one click away.
- [ ] Acceptance: layout unit tests (no overlapping nodes, every edge connects existing nodes); screenshots.

#### 5.4 "Road to Secret Wars"
- Add the second mission to `MISSIONS` once the owner confirms its date and any new required titles (D5). The active mission is the first whose finale is not watched; the account menu can switch missions. All mission-specific copy comes from the mission object.
- [ ] Acceptance: with the Doomsday finale watched and a fake `now`, the app shows the new mission's countdown and readiness.

#### 5.5 Final cleanup
- Delete the `src/lib/content.ts` barrel and update imports; remove dead exports and unused CSS selectors left by the redesign; refresh the README and republish the roadmap page as complete.

---

## 6. Verification (end to end)

Run after every package, and in full before calling a milestone done:

1. `npm run lint && npx tsc --noEmit && npm test && npm run build`.
2. `npx playwright test` (smoke plus the package's own specs) against `file:.tmp/e2e.db`.
3. `npm run shots`, then open the images in `.tmp/shots/` at all three sizes and compare with the previous run. Check the numbers the spec prints: first-card offset, page height, text under 11 px, horizontal overflow.
4. Manual pass on a scratch database (`TURSO_DATABASE_URL=file:.tmp/manual.db npx next dev -p 3210`): sign up, catch up, tick, un-watch with dependents, skip, plan, stats. On Windows, stop the server by process id; `netstat` can show the port as CLOSED while it still answers.
5. Confirm `git status` shows no change to `marvel-vault.db` handling and that the file's modified time did not move.

Milestone gates: **M0** the two-clients migration test in 0.5. **M1** the seven regression tests in 1.3, the unrecognised-rows test, the auth tests in 1.4–1.5, and the owner's production backup and trial run from 0.5 before anything is deployed. **M2** catch-up in under 60 s, first card ≤ 720 px at 1440×900, deep link and Back specs. **M3** fake-clock tests around the release date, schedule and Wrapped specs. **M4** offline spec and guest-claim spec. **M5** catalogue check clean with a TMDB key.

## 7. Out of scope

Friends, leaderboards and public profiles; importing from Trakt or Letterboxd; a light theme; translations; chronological (in-universe) ordering; rewriting git history; native app builds.

## 8. Which model runs each work package

Fable is reserved for the one package where a subtle mistake loses users' progress. Everything else is specified tightly enough, and guarded by tests or screenshots, for Opus or Sonnet.

| Model | Packages | Why |
| --- | --- | --- |
| **Fable** | 1.3 | The reducer, the transaction and seven bug fixes on live user data. Everything after it trusts this code. |
| **Fable if tokens allow, otherwise Opus** | 2.1 | The client queue (ordering, retries, rejected actions) is the other place progress can silently go missing. Opus can do it from §4.6; it just needs its tests written first. |
| **Opus** | 0.5, 1.2, 1.4, 1.5, 2.2, 2.3, 2.4 step C, 2.5, 2.6, 2.7, 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 4.4, 5.2, 5.3 | Real design or judgement, but bounded by the spec: migrations, security, the wizard, the page and card redesign, missions, schedule, offline, the map. |
| **Sonnet** | 0.1, 0.2, 0.3, 0.4, 0.6, 1.6, 2.4 steps A and B, 2.8, 3.5, 5.1, 5.4, 5.5 | Token-heavy but mechanical: test and CI set-up, moving code and CSS without changing it, small fixes, font sizes, scripts, clean-up. |

If Fable tokens run out before 1.3, run it on Opus and have it finish the §4.7 test matrix before touching `progress-store.ts`.

## 9. Future plans (not part of this plan)

Work the owner has chosen to do themselves once everything above is complete. **Agents must not start any of it**, and must not edit `src/lib/watch-links.ts`, `public/watch-links.csv` or add tests for them in the meantime (ground rule 11).

### 9.1 Watch links: enforce the approved-provider list (owner)

Taken out of this plan on 2026-11-15 (it was package 1.1). What it would involve, kept here so nothing is lost:

- **The bug.** In `src/lib/watch-links.ts`, `approvedWatchUrl` has `const approved = hostname;;` (line 67), so every HTTPS host is accepted and `APPROVED_WATCH_HOSTS` is never consulted (ESLint reports it as an unused variable). The real check would be `APPROVED_WATCH_HOSTS.some((host) => hostname === host || hostname.endsWith("." + host))`.
- **The empty bar.** `WatchSource` in `marvel-nexus.tsx` (about line 368) shows a dashed "Watch link unavailable" bar on every card. It could render nothing while loading or when there is no link, keep the "unlocks after prerequisites" note in the drawer only, and give `.drawer-command-bar` the existing `single` class when no watch control renders. Packages 2.4, 2.6 and 2.7 move and rework this component, so check where it lives by then.
- **TMDB.** If 5.1 (TMDB sync) is used, add `themoviedb.org` to the approved hosts when the check is enforced.
- **The CSV.** `public/watch-links.csv` is the owner's own file (header only, uncommitted); leave it as it is.
- **Tests to write.** Accepts `https://www.disneyplus.com/x`; rejects `https://vidbox.vc/x`, `http://netflix.com/x`, `https://evil-netflix.com/x` and `https://netflix.com.evil.io/x`; a rejected row is reported in `issues`.
- **Acceptance.** Tests pass; screenshots show no empty watch bar.
- **History.** Old non-approved watch links in git history need no action.

---

## Implementation record

Each package appends here when it is done: what changed, anything that differs from the text above, and the numbers the next package needs.

### M0 — Foundations (in progress: 0.1–0.4 done on 2026-11-15; 0.5 and 0.6 not started; the M0 gate needs 0.5)

**Scope decision (2026-11-15).** The owner removed the watch-link package from this plan (now §9.1). `src/lib/watch-links.ts` is unchanged and no watch-link tests exist.

**0.1 Plan and roadmap page.**
- This file is the in-repo copy of the plan. The only change from the source is that each package's `Acceptance:` line is now a checkbox, plus the §9 and record sections and the removal described above.
- Roadmap page: source `docs/roadmap.html`; published as a **private** artifact at https://claude.ai/artifact/RKhUizA9J2c77DYpbVD2Yv (the owner has to share it from the page's Share menu). Republish the same file at each milestone after updating the chips and the "N of M work packages done" lines. Package counts per milestone: M0 6, M1 5 (1.2–1.6), M2 8, M3 5, M4 4, M5 5.

**0.2 Unit tests.**
- `vitest.config.mts` (environment `node`, `server-only` aliased to `tests/stubs/server-only.ts`, tests under `tests/unit` and `tests/api`). Scripts: `test`, `test:watch`, `typecheck`; also added `e2e`, `shots`, `catalogue:check`.
- `tests/unit/characterisation.test.ts`: six inline snapshots (ordered `getPrerequisiteChain` for all 92 titles; `isUnlocked` plus `missingPrerequisite` for 92 titles in each of the five states). The clock is pinned to 2026-11-15T12:00Z. Plan 1.2 requires these to stay **byte-identical**; never run `vitest -u` to make a refactor pass. The same file asserts every spot value quoted in §4.4 (prerequisite counts 21/30/22/23/1/2/8/10/7/44/0, dependents 60/41/39, no optional title has dependents); all are true today.
- `tests/unit/catalogue.test.ts`: unique kebab-case ids; sorted universe lists; real dates; episodes numbered 1..n with titles and matching runtime sums; posters and backdrops exist for all 92 titles (the placeholder allow-list is empty). There is no `requires` field yet, so the "every `requires` id exists" check runs against a literal copy of today's private `STREET_PREREQUISITE_IDS` table kept in the test. When 1.2 introduces `requires`, point that test at the real field.
- `npm run catalogue:check` prints released titles that still carry placeholder data (`--strict` exits 1 if any). **It reports 12 titles today, not the two the 0.2 text predicts** (`friendly-spider-man-2` and `born-again-2`): ten more released series use the "Episode N" fallback titles (`what-if-1`, `she-hulk`, `what-if-2`, `agatha`, `what-if-3`, `friendly-spider-man-1`, `ironheart`, `eyes-of-wakanda`, `marvel-zombies`, `wonder-man`). The rule is implemented as written. It loads the TypeScript catalogue through Vite's `runnerImport`, so it keeps working when `content.ts` becomes a barrel in 1.2.

**0.3 E2E and screenshots.**
- `playwright.config.ts` starts `next dev -p 3210` on `file:.tmp/e2e.db`, never reuses a running server, runs one worker, and has three projects: `desktop-1440`, `laptop-1366`, `phone-390` (the Pixel 7 touch profile at 390×844). `tests/e2e/global-setup.ts` creates `.tmp/` and deletes any previous `e2e.db*`. Everything the run produces lives in `.tmp/` (git-ignored, and ignored by ESLint).
- `smoke.spec.ts`: sign up, close the lore guide that new accounts land on, mark Iron Man, reload, un-watch, reload, sign out. `screens.spec.ts` (`npm run shots`): seeds the profile through the API and writes eight screenshots per size to `.tmp/shots/<project>/` plus `metrics.json`. 24 images were produced and viewed.
- Baseline (before any redesign work):

  | Size | First card top | Page height | Visible text nodes under 11 px | Horizontal overflow |
  | --- | --- | --- | --- | --- |
  | 1440×900 | 1,379 px | 12,917 px | 29 | none |
  | 1366×768 | 1,379 px | 12,939 px | 29 | none |
  | 390×844 | 2,242 px | 24,676 px | 35 | none |

  The first-card offset matches the plan's 1,379 px exactly. The plan's "24 under 11 px" is not reproducible with the counting rule used here (every rendered, visible text node whose computed font size is under 11 px, hidden text excluded; 29 of them); the sample list is in `metrics.json`. Compare later runs with this rule, not with 24. The phone view already shows the "REMAINING93" label collision from 1.6.
- Screenshots hide the Next.js dev badge through the screenshot `style` option. The specs depend on the current markup (`#timeline-item-<id>`, `.card-visual`, `.timeline-card`, `.archive-heading`, and button and dialog names); the redesign packages (2.4–2.7) must update those selectors when they change the markup.
- Before running e2e, stop any other `next dev` for this folder and anything on port 3210; the config deliberately refuses to attach to an existing server.

**0.4 CI.** `.github/workflows/ci.yml`: push and pull request, Node 22, `npm ci`, lint, typecheck, `npm test`, `mkdir -p .tmp`, `npm run build`, then the smoke spec with the Playwright browser cached per Playwright version (system libraries are installed on a cache hit too); the report is uploaded on failure. Build and tests run with `TURSO_DATABASE_URL=file:.tmp/ci.db`. Validated locally: the YAML parses, every step is well-formed, and the same commands pass (`CI=true` for the smoke spec); `npm ci --dry-run` confirms the lockfile matches. It has not run on GitHub yet.

**Deviations from the text above.**
1. `@types/node` moved from ^20 to ^22: vitest 5 declares an optional peer dependency on 22 or newer (matches the Node 22 used in CI). No runtime dependency changed; 108 packages were added, all for testing.
2. `vite-tsconfig-paths` is **not** installed: Vite 8 resolves tsconfig `paths` natively (`resolve.tsconfigPaths: true`) and warns that the plugin is redundant.
3. `vitest.config.mts` aliases the bare `vitest` import to a path built from the shell's working directory. Without it, a lowercase drive letter (`d:\Doomflix`, as Git Bash and cmd report it) makes Vitest load itself twice and every test fail with "failed to find the runner".
4. `npm run build` imports the database module, which opens the database file, so builds also need `TURSO_DATABASE_URL=file:.tmp/<name>.db` and an existing `.tmp/` folder (ground rule 2 applies to builds too).

**Verification on 2026-11-15** (scratch databases only): lint 0 errors (one existing warning: `APPROVED_WATCH_HOSTS` unused, see §9.1); typecheck clean; `npm test` 33 passed; `npm run build` OK; `npx playwright test` 6 passed; `marvel-vault.db` has the same SHA-256, size and modified time as before the work; `public/watch-links.csv` still shows only the owner's earlier modification.

**Observed, not acted on.** `npm audit` reports 10 findings, all in packages that were already installed (none come from the test tooling): `next` 16.3.5 (critical: remote code execution in `next/og` `ImageResponse`; the audit lists 16.4.6 as a non-major fix), `zod` and `sharp` (high), and the typescript-eslint and minimatch chain (moderate). The app uses `ImageResponse` for its icons and 3.5 plans to use it for the share card. Updating `next` is a decision for the owner; the `AGENTS.md` warning about breaking changes applies.
