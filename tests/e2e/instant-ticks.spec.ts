import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { markWatchedViaApi, signUpViaApi, uniqueUsername, useOwnClientIp, waitForSync, watchCspViolations, type SeedStep } from "./helpers";

/**
 * Package 2.1: a tick shows at once and is saved in the background (one request at a time, in
 * order), the checkpoint toast offers Undo, an un-watch asks first only when later progress would
 * go with it and lists exactly that, and a change the server refuses is undone on screen and named.
 * The sizes (1440, 1366 and 390 px) come from the three Playwright projects.
 */

const card = (page: Page, id: string) => page.locator(`#timeline-item-${id}`);
const markButton = (page: Page, id: string) => card(page, id).getByRole("button", { name: "Mark watched", exact: true });
const watchedButton = (page: Page, id: string) => card(page, id).getByRole("button", { name: "Watched", exact: true });
const movie = (contentId: string): SeedStep => ({ contentId, episode: -1 });

async function openDashboard(page: Page, testInfo: TestInfo, seed: SeedStep[] = []) {
  await signUpViaApi(page.request, uniqueUsername(testInfo));
  if (seed.length) await markWatchedViaApi(page.request, seed);
  await page.goto("/");
  await expect(page.locator(".timeline-card").first()).toBeVisible();
}

async function savedKeys(page: Page) {
  const { state } = await (await page.request.get("/api/progress")).json();
  return (state.rows as { contentId: string; episode: number }[]).map((row) => `${row.contentId}:${row.episode}`).sort();
}

test("ticks show before the server answers, go out one at a time, and are all saved", async ({ page }, testInfo) => {
  const cspViolations = watchCspViolations(page);
  await useOwnClientIp(page, testInfo);
  await openDashboard(page, testInfo);

  // A very slow network: every save waits until the test lets it through.
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let saves = 0;
  await page.route("**/api/progress", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    saves += 1;
    await released;
    await route.continue();
  });

  await markButton(page, "iron-man").click();
  // On screen at once and marked as saving, while its request is still held.
  await expect(watchedButton(page, "iron-man")).toBeVisible();
  await expect(watchedButton(page, "iron-man")).toHaveAttribute("data-saving", "true");
  await expect(page.locator("main.app-shell")).toHaveAttribute("data-sync", "saving");

  // The next titles unlock at once and can be ticked straight away.
  await markButton(page, "incredible-hulk").click();
  await markButton(page, "iron-man-2").click();
  await expect(watchedButton(page, "iron-man-2")).toBeVisible();
  await expect.poll(() => saves).toBe(1);
  await page.waitForTimeout(300);
  expect(saves, "only one request is in flight at a time").toBe(1);

  release();
  await waitForSync(page);
  expect(saves).toBe(3);
  await expect(watchedButton(page, "iron-man")).not.toHaveAttribute("data-saving");
  expect(await savedKeys(page)).toEqual(["incredible-hulk:-1", "iron-man-2:-1", "iron-man:-1"]);

  await page.reload();
  for (const id of ["iron-man", "incredible-hulk", "iron-man-2"]) await expect(watchedButton(page, id)).toBeVisible();
  expect(cspViolations, "Content Security Policy violations").toEqual([]);
});

test("the checkpoint toast offers Undo for six seconds", async ({ page }, testInfo) => {
  await useOwnClientIp(page, testInfo);
  await page.clock.install();
  await openDashboard(page, testInfo);

  await markButton(page, "iron-man").click();
  const toast = page.locator(".delight-toast.checkpoint");
  await expect(toast).toContainText("Checkpoint secured");
  // Phones show only the newest two toasts; the one with Undo is always among them.
  await expect(page.locator(".delight-toast.unlock")).toBeVisible();
  await page.clock.runFor(5_500);
  await expect(toast.getByRole("button", { name: "Undo" })).toBeVisible();
  await page.clock.runFor(600);
  await expect(toast).toHaveCount(0);

  // Tick the next title and undo it: it goes back, and so does the toast that said it unlocked Iron Man 2.
  await markButton(page, "incredible-hulk").click();
  await expect(page.locator(".delight-toast.unlock")).toContainText("Iron Man 2 is ready to watch.");
  await page.locator(".delight-toast.checkpoint").getByRole("button", { name: "Undo" }).click();
  await expect(markButton(page, "incredible-hulk")).toBeVisible();
  await expect(page.locator(".delight-toast.checkpoint")).toContainText("Removed from watched");
  await expect(page.locator(".delight-toast.unlock")).toHaveCount(0);
  await waitForSync(page);
  expect(await savedKeys(page)).toEqual(["iron-man:-1"]);
});

test("un-watching asks only when later progress would go with it, and lists exactly that", async ({ page }, testInfo) => {
  await useOwnClientIp(page, testInfo);
  await openDashboard(page, testInfo, [
    movie("iron-man"),
    movie("incredible-hulk"),
    ...[1, 2, 3, 4].map((episode) => ({ contentId: "defenders-daredevil-1", episode })),
  ]);
  const confirmation = page.getByRole("alertdialog", { name: "Remove later progress too?" });

  // Nothing watched depends on The Incredible Hulk: no question.
  await watchedButton(page, "incredible-hulk").click();
  await expect(markButton(page, "incredible-hulk")).toBeVisible();
  await expect(confirmation).toHaveCount(0);

  // Watch it again; now un-watching Iron Man takes The Incredible Hulk with it, and only that.
  await markButton(page, "incredible-hulk").click();
  await watchedButton(page, "iron-man").click();
  await expect(confirmation).toBeVisible();
  await expect(confirmation.getByRole("listitem")).toHaveText(["The Incredible Hulk"]);
  await confirmation.getByRole("button", { name: "Yes, remove all" }).click();
  await expect(markButton(page, "iron-man")).toBeVisible();
  await expect(card(page, "incredible-hulk").getByRole("button", { name: "Complete prerequisite" })).toBeVisible();

  // A series: un-watching episode 2 of the four watched also takes episodes 3 and 4.
  await page.getByRole("tab", { name: "Street-Level saga" }).click();
  await card(page, "defenders-daredevil-1").locator(".card-visual").click();
  const drawer = page.getByRole("dialog", { name: "Daredevil — Season 1" });
  await drawer.locator(".episode-row").nth(1).click();
  await expect(confirmation.getByRole("listitem")).toHaveText([/Daredevil — Season 1\s*episodes 3–4/]);
  await confirmation.getByRole("button", { name: "Yes, remove all" }).click();
  await expect(drawer.locator(".episode-row.checked")).toHaveCount(1);

  // The last watched episode has nothing after it: no question.
  await drawer.locator(".episode-row").nth(0).click();
  await expect(drawer.locator(".episode-row.checked")).toHaveCount(0);
  await expect(confirmation).toHaveCount(0);

  await waitForSync(page);
  expect(await savedKeys(page)).toEqual([]);
});

test("when another device added progress, the confirmation comes back with the server's list", async ({ page }, testInfo) => {
  await useOwnClientIp(page, testInfo);
  await openDashboard(page, testInfo, [movie("iron-man")]);
  // Another device watches The Incredible Hulk; this page has not heard about it.
  await markWatchedViaApi(page.request, [movie("incredible-hulk")]);

  // As far as this page knows, nothing depends on Iron Man, so it does not ask...
  await watchedButton(page, "iron-man").click();
  // ...but the server refuses to clear what it was not told about, and the question comes back.
  const confirmation = page.getByRole("alertdialog", { name: "Remove later progress too?" });
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText("Progress was added on another device.");
  await expect(confirmation.getByRole("listitem")).toHaveText(["The Incredible Hulk"]);
  // Nothing was removed, and the page now shows the other device's tick.
  await expect(watchedButton(page, "iron-man")).toBeVisible();
  await expect(watchedButton(page, "incredible-hulk")).toBeVisible();
  expect(await savedKeys(page)).toEqual(["incredible-hulk:-1", "iron-man:-1"]);

  await confirmation.getByRole("button", { name: "Yes, remove all" }).click();
  await expect(markButton(page, "iron-man")).toBeVisible();
  await waitForSync(page);
  expect(await savedKeys(page)).toEqual([]);
});

test("offline: ticks stay on screen, a chip says they will sync, and they do once the connection is back", async ({ page }, testInfo) => {
  await useOwnClientIp(page, testInfo);
  await openDashboard(page, testInfo);

  // Saves fail as if the network were down.
  await page.route("**/api/progress", (route) =>
    route.request().method() === "POST" ? route.abort("internetdisconnected") : route.continue(),
  );
  await markButton(page, "iron-man").click();
  await expect(watchedButton(page, "iron-man")).toBeVisible();
  await expect(page.getByText("Offline — changes will sync")).toBeVisible();
  await expect(page.locator("main.app-shell")).toHaveAttribute("data-sync", "offline");
  await markButton(page, "incredible-hulk").click();
  await expect(watchedButton(page, "incredible-hulk")).toBeVisible();

  // The connection comes back; the browser's "online" event makes the app try again at once.
  await page.unroute("**/api/progress");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await waitForSync(page);
  await expect(page.getByText("Offline — changes will sync")).toHaveCount(0);
  expect(await savedKeys(page)).toEqual(["incredible-hulk:-1", "iron-man:-1"]);
});

test("a change the server refuses is undone on screen and named in a message", async ({ page }, testInfo) => {
  await useOwnClientIp(page, testInfo);
  await openDashboard(page, testInfo, [movie("iron-man")]);
  // Another device removes Iron Man; this page still shows it watched.
  const removal = await page.request.post("/api/progress", { data: { action: { type: "unwatch", contentId: "iron-man", episode: -1 } } });
  expect(removal.ok()).toBe(true);

  await markButton(page, "incredible-hulk").click();
  await expect(page.locator(".toast")).toContainText("Couldn't save: The Incredible Hulk — needs Iron Man.");
  // The screen now shows what the server has.
  await expect(markButton(page, "iron-man")).toBeVisible();
  await expect(card(page, "incredible-hulk").getByRole("button", { name: "Complete prerequisite" })).toBeVisible();
  await waitForSync(page);
  expect(await savedKeys(page)).toEqual([]);
});
