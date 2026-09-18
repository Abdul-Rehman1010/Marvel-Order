# Nexus Watch Protocol

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
npm run build
```

## Data and progression

- MCU movies and required series use one unified release-order chain.
- Required series must be completed episode by episode.
- Optional entries appear in release order but never block the next required entry.
- *Eternals* is optional and does not gate later MCU releases.
- X-Men films retain their release-order locks. *Deadpool* requires only *X-Men* (2000), and *Deadpool 2* requires only *Deadpool*. *Deadpool & Wolverine* rejoins the normal gate and requires every earlier non-optional X-Men movie.
- *Deadpool & Wolverine* is catalogued in the X-Men tab, while still counting as required X-Men content for universal Doomsday readiness.
- The Street-Level Saga contains the 13 original Defenders-era seasons followed by *Hawkeye*, *Echo*, *Daredevil: Born Again*, and *The Punisher: One Last Kill*.
- *Hawkeye* requires *Avengers: Endgame*, but the Street-Level Saga never gates later MCU releases.
- The highlighted global Doomsday watch-time clock counts only non-optional MCU and X-Men entries. A second local clock shows the required time remaining for whichever tab is open; Street-Level time never contributes to Doomsday readiness.
- Universal Doomsday progress excludes optional content, while each tab's separate archive progress includes both required and optional entries.
- Progress checkpoints are counted as `movies + specials + individual episodes`; series are also shown separately as completion containers so every total visibly reconciles.
- *Doctor Strange in the Multiverse of Madness* additionally requires *X-Men* (2000).
- Passwords are stored as bcrypt hashes; session cookies are HTTP-only.
- Every indexed entry has a locally cached, optimized vertical poster and widescreen backdrop, so artwork is stable during local use and after deployment.
- Every movie card includes a researched, spoiler-free premise; optional entries are explicitly marked as safe to skip and never gate required progress.

## Reset all users and progress

To remove every user account, active session, and watched-progress record while preserving the database schema and the complete movie/show catalogue, run:

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

4. Deploy. Tables are initialized automatically on first request.

The production build uses Node.js route handlers for password hashing, sessions, database access, and server-authoritative progression checks.
