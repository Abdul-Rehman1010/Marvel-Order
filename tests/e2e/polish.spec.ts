import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { CONTENT } from "../../src/lib/catalogue";
import { markWatchedViaApi, signUpViaApi, uniqueUsername, useOwnClientIp, watchCspViolations } from "./helpers";

/**
 * Package 1.6: the small visual and accessibility fixes. The sizes (1440, 1366 and 390 px) come
 * from the three Playwright projects.
 */

const SEED = ["iron-man", "incredible-hulk", "iron-man-2"].map((contentId) => ({ contentId, episode: -1 }));

async function signInAndOpenDashboard(page: Page, testInfo: TestInfo) {
  await signUpViaApi(page.request, uniqueUsername(testInfo));
  await markWatchedViaApi(page.request, SEED);
  await page.goto("/");
  await expect(page.locator(".timeline-card").first()).toBeVisible();
}

test("dashboard: no leftover captions or dead buttons, credit in the footer", async ({ page }, testInfo) => {
  const cspViolations = watchCspViolations(page);
  await useOwnClientIp(page, testInfo);
  await signInAndOpenDashboard(page, testInfo);

  // Watched cards no longer say "Ready to watch"; the strip is only for locked titles.
  const watched = page.locator("#timeline-item-iron-man");
  await expect(watched.getByRole("button", { name: "Watched", exact: true })).toBeVisible();
  await expect(watched.locator(".card-availability")).toHaveCount(0);
  await expect(page.getByText("Ready to watch")).toHaveCount(0);
  await expect(page.locator("#timeline-item-endgame .card-availability")).toContainText("Locked");

  // No "SYNCED" under the rings, no "+ 0 specials", no inert top-bar buttons.
  await expect(page.getByText("SYNCED", { exact: true })).toHaveCount(0);
  await expect(page.locator(".status-copy > p").filter({ hasText: /\b0 (movies|specials|episodes)\b/ })).toHaveCount(0);
  await expect(page.locator("header.topbar nav").getByRole("button", { name: "Timeline" })).toHaveCount(0);
  await expect(page.locator("header.topbar nav .topbar-tab")).toHaveCount(0);

  // The universe switch below still works, and so do the 1/2/3 keys.
  await page.getByRole("tab", { name: "Street-Level saga" }).click();
  await expect(page.getByRole("tab", { name: "Street-Level saga" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("1");
  await expect(page.getByRole("tab", { name: "MCU timeline" })).toHaveAttribute("aria-selected", "true");

  // The developer credit moved out of the band under the top bar into the footer.
  await expect(page.locator(".developer-carousel")).toHaveCount(0);
  await expect(page.locator("footer")).toContainText("Developed by Abdul Rehman Shahid");

  // The filter rows are named groups.
  for (const name of ["Filter by Doomsday necessity", "Filter by format", "Filter by viewing progress"]) {
    await expect(page.getByRole("group", { name })).toBeVisible();
  }

  expect(cspViolations, "Content Security Policy violations").toEqual([]);
});

test("the Watched and Remaining labels never run into their numbers", async ({ page }, testInfo) => {
  await useOwnClientIp(page, testInfo);
  await signInAndOpenDashboard(page, testInfo);
  const cells = page.locator(".checkpoint-counts > div");
  for (let index = 0; index < (await cells.count()); index += 1) {
    const cell = cells.nth(index);
    const label = await cell.locator("dt").boundingBox();
    const number = await cell.locator("dd").boundingBox();
    expect(label, "label box").not.toBeNull();
    expect(number, "number box").not.toBeNull();
    // The label ends before the number begins, and the cell does not scroll sideways.
    expect(label!.x + label!.width).toBeLessThanOrEqual(number!.x + 0.5);
    expect(await cell.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  }
});

test("a locked title's drawer offers 'Go to <prerequisite>' instead of a disabled button", async ({ page }, testInfo) => {
  await useOwnClientIp(page, testInfo);
  await signInAndOpenDashboard(page, testInfo);

  // Thor is next after Iron Man 2, so Avengers: Endgame is locked behind an earlier film.
  await page.locator("#timeline-item-endgame .card-visual").click();
  const drawer = page.getByRole("dialog", { name: "Avengers: Endgame" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("button", { name: /Complete prerequisite/ })).toHaveCount(0);
  const go = drawer.locator(".drawer-go");
  await expect(go).toBeEnabled();
  const target = ((await go.textContent()) ?? "").replace(/^Go to /, "").trim();
  expect(target.length).toBeGreaterThan(0);

  // It opens that prerequisite's own drawer.
  await go.click();
  await expect(page.getByRole("dialog", { name: target })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Avengers: Endgame" })).toHaveCount(0);
});

test("a scheduled title's drawer shows the release date as plain text", async ({ page }, testInfo) => {
  await useOwnClientIp(page, testInfo);
  await signUpViaApi(page.request, uniqueUsername(testInfo));

  // Watch every MCU and X-Men title released before VisionQuest, then look at the app as it was on 1 Oct 2026.
  const before = CONTENT.filter((item) => item.universe !== "street" && item.releaseDate < "2026-10-14" && !item.dataPending).map((item) => item.id);
  const response = await page.request.post("/api/progress", { data: { action: { type: "bulk", watch: before, skip: [], backfilled: false } } });
  expect(response.ok(), await response.text()).toBe(true);
  await page.clock.setFixedTime(new Date("2026-10-01T12:00:00Z"));
  await page.goto("/");
  await expect(page.locator(".timeline-card").first()).toBeVisible();

  await page.locator("#timeline-item-visionquest .card-visual").click();
  const drawer = page.getByRole("dialog", { name: "VisionQuest" });
  await expect(drawer).toBeVisible();
  await expect(drawer.locator(".drawer-release-note")).toHaveText("Releases Oct 14, 2026");
  await expect(drawer.getByRole("button", { name: /Mark as watched|Go to|Complete prerequisite/ })).toHaveCount(0);
});

test("sign-in carousel: silent for screen readers, pauses on hover and on focus", async ({ page }) => {
  // The test config defaults to reduced motion (which stops the rotation); this one needs it on.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.clock.install();
  await page.goto("/");
  const carousel = page.getByRole("region", { name: "Doom Flix introduction" });
  await expect(carousel).toBeVisible();
  await expect(carousel.locator("[aria-live]")).toHaveCount(0);

  const message = carousel.locator(".carousel-message");
  const first = (await message.textContent()) ?? "";
  await page.clock.runFor(4700);
  await expect(message).not.toHaveText(first);

  // Hovering it freezes the slide.
  const hovered = (await message.textContent()) ?? "";
  await carousel.hover();
  await page.clock.runFor(15_000);
  await expect(message).toHaveText(hovered);

  // So does keyboard focus inside it.
  await page.mouse.move(0, 0);
  await carousel.getByRole("button").first().focus();
  await page.clock.runFor(15_000);
  await expect(message).toHaveText(hovered);
});

test("sign-in carousel does not rotate under reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install();
  await page.goto("/");
  const message = page.getByRole("region", { name: "Doom Flix introduction" }).locator(".carousel-message");
  const first = (await message.textContent()) ?? "";
  await page.clock.runFor(20_000);
  await expect(message).toHaveText(first);
});
