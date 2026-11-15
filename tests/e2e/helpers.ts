import type { APIRequestContext, Page, TestInfo } from "@playwright/test";

export const TEST_PASSWORD = "e2e-password-1";

/** A username no earlier test used (3-24 chars; letters, digits, `_` and `-` only). */
export function uniqueUsername(testInfo: TestInfo) {
  const project = testInfo.project.name.replace(/[^a-z0-9]/gi, "").slice(0, 4);
  return `e2e-${project}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.slice(0, 24);
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
