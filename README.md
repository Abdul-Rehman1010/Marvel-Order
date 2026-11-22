# Doom Flix

A local-first MCU, X-Men, and Street-Level Saga release-order tracker for the road to *Avengers: Doomsday*. It includes password-protected local profiles, database-backed progress, enforced spoiler-safe prerequisites, individual episode tracking, exact remaining runtime, optional-content handling, and a live Doomsday countdown.

## Run locally

Requirements: Node.js 20.19 or newer.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). No environment variables or database setup are needed locally. The app automatically creates `marvel-vault.db`, which is ignored by Git.

## Quality checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

- `npm test` runs the unit and API tests (Vitest, `tests/unit` and `tests/api`); `npm run test:watch` re-runs them as you edit.
- `npm run e2e` runs the Playwright smoke and screen specs in Chromium at three screen sizes (the first time, run `npx playwright install chromium`). `npm run shots` runs only the screenshot spec and writes images and `metrics.json` to `.tmp/shots/`.
- `npm run catalogue:check` lists released titles that still carry placeholder data (`-- --strict` makes it fail when there are any).

### Never point a test or build at your own database

`marvel-vault.db` holds your real accounts and progress. Anything that is not the running app itself (tests, builds, scripts, experiments) must use a throwaway database under `.tmp/` (ignored by Git):

```bash
mkdir -p .tmp
TURSO_DATABASE_URL=file:.tmp/scratch.db npm run build
```

`npm test` and `npm run e2e` already do this. `npm run build` opens the database too, so give it a scratch file as above. In PowerShell set `$env:TURSO_DATABASE_URL = "file:.tmp/scratch.db"` first.

### Styling note

Tailwind CSS is installed only for its CSS reset (`@import "tailwindcss"` in `src/app/globals.css`). All styling is plain CSS in that file; there are no Tailwind utility classes.

## Data and progression

- MCU movies and required series use one unified release-order chain.
- Required series must be completed episode by episode.
- Optional entries appear in release order but never block the next required entry.
- *Eternals* is optional and does not gate later MCU releases.
- *Agatha All Along* and *VisionQuest* are required for Doomsday and sit in the unified MCU chain.
- *Moon Knight* has no prerequisites and can be watched at any time.
- Archive filters can be combined by Doomsday necessity, format, and unwatched status.
- A "Jump to next" pill appears whenever the next required unwatched title scrolls out of view, and jumps straight to it.
- Removing the latest watched checkpoint is immediate; removing an older checkpoint requires confirmation because dependent progress may also be cleared.
- X-Men films retain their release-order locks. *Deadpool* requires only *X-Men* (2000), and *Deadpool 2* requires only *Deadpool*. *Deadpool & Wolverine* retains its existing gate: every earlier required X-Men movie plus *Deadpool 2*.
- *Deadpool 2* and *Deadpool & Wolverine* are required for universal Doomsday readiness.
- The Street-Level Saga contains the 13 original Defenders-era seasons followed by *Hawkeye*, *Echo*, *Daredevil: Born Again*, and *The Punisher: One Last Kill*.
- Street-Level entries are displayed by release date, but unrelated shows do not lock one another. Seasons of the same show remain sequential.
- *The Defenders* requires *Daredevil* Seasons 1–2, *Jessica Jones* Season 1, *Luke Cage* Season 1, and *Iron Fist* Season 1; the four heroes' later seasons additionally require the crossover.
- *The Punisher* Season 1 requires *Daredevil* Season 2, and *The Punisher* Season 2 follows Season 1.
- *Hawkeye* retains its *Avengers: Endgame* prerequisite, *Echo* requires *Hawkeye*, *Daredevil: Born Again* follows *Daredevil* Season 3, and *The Punisher: One Last Kill* requires *The Punisher* Season 2.
- Street-Level progress never gates later MCU releases, and removing progress clears only entries that actually depend on it.
- The highlighted global Doomsday watch-time clock counts only non-optional MCU and X-Men entries. A second local clock shows the complete archive time remaining, including optional entries such as *Eternals*; Street-Level time never contributes to Doomsday readiness.
- Universal Doomsday progress excludes optional content, while each tab's separate archive progress includes both required and optional entries.
- Progress checkpoints are counted as `movies + specials + individual episodes`; series are also shown separately as completion containers so every total visibly reconciles.
- *Doctor Strange in the Multiverse of Madness* additionally requires *X-Men* (2000).
- Passwords are stored as bcrypt hashes; session cookies are HTTP-only.

## Accounts and sign-in

- **New passwords need 8 to 72 characters.** Accounts created earlier with a shorter password can still sign in.
- **Sessions do not expire.** The app holds no confidential data, so nobody is signed out for being away. The session cookie lasts 400 days, the longest browsers allow, and every visit pushes it back to the full 400 days. You only need to sign in again after more than 400 days without opening the app, after clearing your browser data, or after signing out.
- **Attempts are limited.** Sign-in allows 8 attempts per username and 40 per IP address every 15 minutes, and sign-up allows 5 new accounts per IP address per hour. Going over returns "Too many attempts" with how long to wait. A successful sign-in resets that username's count.
- **Recovery code.** Every new account is shown a recovery code once (copy it or download it). If you forget your password, use **Forgot password?** on the sign-in screen with your username and that code to set a new one; this signs out every other device and gives you a new code. Accounts created before recovery codes existed can make one in the account panel.
- **Account panel.** Select your name in the top bar (the person icon on phones) to change your password, make a new recovery code, sign out on every device, or delete your account and all its progress. Each needs your current password. The panel also says where your progress is stored.
- **Requests from other sites are refused.** Every request that changes data must come from the app's own address.
- **Security headers.** The site sends a Content Security Policy and the usual protective headers (see `next.config.ts`).
- Every indexed entry has a locally cached, optimized vertical poster and widescreen backdrop, so artwork is stable during local use and after deployment.
- Every movie card includes a researched, spoiler-free premise; optional entries are explicitly marked as safe to skip and never gate required progress.

## Reset all users and progress

To remove every user account, active session, watched-progress record and skipped-title record while preserving the database schema and the complete movie/show catalogue, run:

```bash
npm run db:reset-users
```

The command uses the local `marvel-vault.db` by default. If `.env.local` or `.env` contains `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`, it resets that configured database instead. This operation cannot be undone, so verify which environment file is active before running it against a deployed database.

## Deploy to Vercel

A local SQLite file cannot persist in a serverless Vercel function. This project therefore uses the libSQL client: locally it writes to `marvel-vault.db`, while production can use Turso without changing application code or the schema.

1. Push the repository to GitHub and import it into Vercel.
2. Create a Turso database (directly or through Vercel Marketplace).
3. Add these Vercel environment variables:

```text
TURSO_DATABASE_URL=libsql://your-database-name.turso.io
TURSO_AUTH_TOKEN=your-token
```

4. Deploy. Tables are created and upgraded automatically on the first request (see `src/lib/migrations.ts`). Back up the database before deploying a build that adds a migration.

The production build uses Node.js route handlers for password hashing, sessions, database access, and server-authoritative progression checks.

## Watch-source CSV

Optional legal watch links are loaded from `public/watch-links.csv` by the web app. The file starts with a header and no data rows:

```csv
title,url
```

Add one row per movie, special, or complete TV series. `title` must match the title displayed in Doom Flix; series use one link for the complete series, not separate episode links. Values containing commas must be enclosed in double quotes. Only HTTPS links from supported licensed providers and availability services are accepted. Missing titles or URLs, unknown catalogue titles, duplicates, invalid links, and unsupported providers are surfaced in the UI instead of creating a broken Watch button.
