import { createHash } from "node:crypto";

import { expect, type APIRequestContext, type Page, type TestInfo } from "@playwright/test";

export const TEST_PASSWORD = "e2e-password-1";

/** A username no earlier test used (3-24 chars; letters, digits, `_` and `-` only). */
export function uniqueUsername(testInfo: TestInfo) {
  const project = testInfo.project.name.replace(/[^a-z0-9]/gi, "").slice(0, 4);
  return `e2e-${project}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.slice(0, 24);
}

/**
 * Makes every request of this test (page loads, fetches and `page.request` calls) come from its
 * own client IP. Sign-up is limited to 5 per hour per IP (package 1.4), and one full run creates
 * more accounts than that from the same machine. The server reads the IP from `x-forwarded-for`,
 * which Vercel sets in production; locally the test can set it. Call it first in each test.
 */
export async function useOwnClientIp(page: Page, testInfo: TestInfo) {
  const digest = createHash("sha256").update(`${testInfo.testId}:${testInfo.retry}:${Date.now()}`).digest();
  const ip = `10.${digest[0]}.${digest[1]}.${digest[2]}`;
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": ip });
}

/**
 * Records every Content Security Policy violation the page reports, from the browser console and
 * from `securitypolicyviolation` events. Call before the first navigation; assert the list is
 * empty at the end of the test.
 */
export function watchCspViolations(page: Page) {
  const violations: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (/Content Security Policy|Refused to (load|execute|apply|connect|frame|create)/i.test(text)) violations.push(text);
  });
  page.on("pageerror", (error) => {
    if (/Content Security Policy/i.test(error.message)) violations.push(error.message);
  });
  void page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      console.error(`Content Security Policy violation: ${event.violatedDirective} blocked ${event.blockedURI}`);
    });
  });
  return violations;
}

/** Creates an account through the API; the session cookie lands in the request's cookie jar. */
export async function signUpViaApi(request: APIRequestContext, username: string) {
  const response = await request.post("/api/auth/signup", { data: { username, password: TEST_PASSWORD } });
  if (!response.ok()) throw new Error(`Sign-up failed (${response.status()}): ${await response.text()}`);
}

export type SeedStep = { contentId: string; episode: number };

/** Marks units watched through the API, one at a time and in order, like the UI does. */
export async function markWatchedViaApi(request: APIRequestContext, steps: SeedStep[]) {
  for (const step of steps) {
    const response = await request.post("/api/progress", { data: { ...step, watched: true } });
    if (!response.ok()) {
      throw new Error(`Seeding ${step.contentId}:${step.episode} failed (${response.status()}): ${await response.text()}`);
    }
  }
}

/**
 * Waits until every progress change made in the page has reached the server. Since package 2.1
 * a tick shows at once and is saved in the background, so a test must wait for this before it
 * reloads or reads progress through the API. (`data-sync` on the app shell is "saving" or
 * "offline" until then.)
 */
export async function waitForSync(page: Page) {
  await expect(page.locator("main.app-shell")).toHaveAttribute("data-sync", "idle");
}

/** Waits for web fonts and for the images currently on screen, then lets layout settle. */
export async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const onScreen = (element: Element) => {
      const box = element.getBoundingClientRect();
      return box.bottom > 0 && box.top < window.innerHeight && box.right > 0 && box.left < window.innerWidth;
    };
    const pending = [...document.images]
      .filter((image) => !image.complete && onScreen(image))
      .map(
        (image) =>
          new Promise<void>((resolve) => {
            const done = () => resolve();
            image.addEventListener("load", done, { once: true });
            image.addEventListener("error", done, { once: true });
            window.setTimeout(done, 10_000);
          }),
      );
    await Promise.all(pending);
  });
  await page.waitForTimeout(300);
}
