import { defineConfig, devices } from "@playwright/test";

const PORT = 3210;
const BASE_URL = `http://localhost:${PORT}`;

/**
 * End-to-end and screenshot tests run against a throwaway database. NEVER point this at
 * `marvel-vault.db`, which is the owner's real local data. `tests/e2e/global-setup.ts`
 * deletes the file before every run so each run starts with no users.
 */
export const E2E_DATABASE_URL = "file:.tmp/e2e.db";

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  // Everything the run produces (screenshots, traces, reports, database) lives in the git-ignored `.tmp/`.
  outputDir: ".tmp/test-results",
  // One shared dev server and database: run one test at a time, with a unique username per test.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // `next dev` compiles each route on first request, so the first tests are slow.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never", outputFolder: ".tmp/playwright-report" }]]
    : [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    // Deterministic screenshots: no entrance animations or motion effects.
    reducedMotion: "reduce",
  },
  projects: [
    { name: "desktop-1440", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "laptop-1366", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 768 } } },
    // A Chromium touch device (the Pixel 7 profile) at an iPhone-sized 390x844 viewport.
    { name: "phone-390", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: BASE_URL,
    timeout: 180_000,
    // Never attach to a server that is already running: it could be using the owner's database.
    // If port 3210 is taken, or another `next dev` holds the project lock, stop it first.
    reuseExistingServer: false,
    stdout: "ignore",
    stderr: "pipe",
    env: {
      TURSO_DATABASE_URL: E2E_DATABASE_URL,
      TURSO_AUTH_TOKEN: "",
      TURSO_DATABASE_TURSO_AUTH_TOKEN: "",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
