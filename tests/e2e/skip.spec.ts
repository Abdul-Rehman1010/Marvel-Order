import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { markWatchedViaApi, signUpViaApi, uniqueUsername, useOwnClientIp, waitForSync, watchCspViolations, type SeedStep } from "./helpers";

/**
 * Package 2.2: a title can be skipped (from the card's menu or the drawer) after a confirmation.
 * A skipped title counts as cleared for unlocking later titles, but not as watched; it can be
 * watched anyway, or un-skipped while nothing watched later relies on it. The sizes (1440, 1366
 * and 390 px) come from the three Playwright projects.
 */

const card = (page: Page, id: string) => page.locator(`#timeline-item-${id}`);
const button = (page: Page, id: string, name: string) => card(page, id).getByRole("button", { name, exact: true });
const movie = (contentId: string): SeedStep => ({ contentId, episode: -1 });

async function openDashboard(page: Page, testInfo: TestInfo, seed: (request: Page["request"]) => Promise<void> = async () => {}) {
  await signUpViaApi(page.request, uniqueUsername(testInfo));
  await seed(page.request);
  await page.goto("/");
  await expect(page.locator(".timeline-card").first()).toBeVisible();
}

async function skipViaApi(request: Page["request"], contentId: string) {
  const response = await request.post("/api/progress", { data: { action: { type: "skip", contentId } } });
  expect(response.ok(), `skipping ${contentId}`).toBe(true);
}

async function saved(page: Page) {
  const { state } = await (await page.request.get("/api/progress")).json();
  return {
    keys: (state.rows as { contentId: string; episode: number }[]).map((row) => `${row.contentId}:${row.episode}`).sort(),
    skips: (state.skips as { contentId: string }[]).map((row) => row.contentId).sort(),
  };
}

test("skipping The Incredible Hulk from its card unlocks Iron Man 2, and the skip is saved", async ({ page }, testInfo) => {
  const cspViolations = watchCspViolations(page);
  await useOwnClientIp(page, testInfo);
  await openDashboard(page, testInfo, (request) => markWatchedViaApi(request, [movie("iron-man")]));
  await expect(button(page, "iron-man-2", "Complete prerequisite")).toBeDisabled();

  await card(page, "incredible-hulk").getByRole("button", { name: "More actions for The Incredible Hulk" }).click();
  await page.getByRole("menuitem", { name: "Skip this title" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Skip The Incredible Hulk?" });
  await expect(dialog).toContainText("It will count as cleared for unlocking later titles, but not as watched.");
  await expect(dialog).toContainText("Skipping it unlocks Iron Man 2.");
  await dialog.getByRole("button", { name: "Skip title" }).click();
  await expect(dialog).toBeHidden();

  // The skipped card, and the title it opened.
  await expect(card(page, "incredible-hulk").locator(".skip-chip")).toHaveText("Skipped");
  await expect(button(page, "incredible-hulk", "Watch anyway")).toBeEnabled();
  await expect(button(page, "incredible-hulk", "Un-skip")).toBeEnabled();
  await expect(button(page, "iron-man-2", "Mark watched")).toBeEnabled();
  await expect(page.locator(".delight-toast.checkpoint")).toContainText("Skipped — later titles unlocked");
  await expect(page.locator(".delight-toast.checkpoint")).toContainText("Iron Man 2 is ready to watch.");

  // The readiness counts show it beside watched and remaining.
  await expect(page.locator(".doomsday-progress .skipped-count")).toContainText("Skipped");
  await expect(page.locator(".doomsday-progress .skipped-count dd")).toHaveText("1");

  // The "Skipped" filter shows exactly that title; "Unwatched" leaves it out.
  const progressFilter = page.getByRole("group", { name: "Filter by viewing progress" });
  await progressFilter.getByRole("button", { name: "Skipped" }).click();
  await expect(page.locator(".timeline-card")).toHaveCount(1);
  await expect(card(page, "incredible-hulk")).toBeVisible();
  await progressFilter.getByRole("button", { name: "Unwatched" }).click();
  await expect(card(page, "incredible-hulk")).toHaveCount(0);
  await expect(card(page, "iron-man-2")).toBeVisible();

  await waitForSync(page);
  expect(await saved(page)).toEqual({ keys: ["iron-man:-1"], skips: ["incredible-hulk"] });
  await page.reload();
  await expect(card(page, "incredible-hulk").locator(".skip-chip")).toHaveText("Skipped");
  await expect(button(page, "iron-man-2", "Mark watched")).toBeEnabled();
  expect(cspViolations, "Content Security Policy violations").toEqual([]);
});

test("Un-skip waits while a watched title relies on the skip; Watch anyway and its Undo keep later progress", async ({ page }, testInfo) => {
  await useOwnClientIp(page, testInfo);
  await openDashboard(page, testInfo, async (request) => {
    await markWatchedViaApi(request, [movie("iron-man")]);
    await skipViaApi(request, "incredible-hulk");
    await markWatchedViaApi(request, [movie("iron-man-2")]);
  });

  // Un-skipping would leave Iron Man 2 watched with its prerequisite unfinished, so it is not offered.
  await expect(button(page, "incredible-hulk", "Un-skip")).toBeDisabled();
  await expect(card(page, "incredible-hulk")).toContainText("Can't un-skip: you watched Iron Man 2, which needs it. Mark it watched instead.");

  // Watch it anyway: watched, and no longer skipped.
  await button(page, "incredible-hulk", "Watch anyway").click();
  await expect(button(page, "incredible-hulk", "Watched")).toBeVisible();
  await expect(card(page, "incredible-hulk").locator(".skip-chip")).toHaveCount(0);
  const checkpoint = page.locator(".delight-toast.checkpoint");
  await expect(checkpoint).toContainText("no longer skipped");

  // Undo puts the skip back in the same step, so nothing later is cleared and nothing needs confirming.
  await checkpoint.getByRole("button", { name: "Undo" }).click();
  await expect(card(page, "incredible-hulk").locator(".skip-chip")).toHaveText("Skipped");
  await expect(page.getByRole("alertdialog", { name: "Remove later progress too?" })).toHaveCount(0);
  await expect(button(page, "iron-man-2", "Watched")).toBeVisible();
  await expect(page.locator(".delight-toast.checkpoint")).toContainText("skipped again");

  await waitForSync(page);
  expect(await saved(page)).toEqual({ keys: ["iron-man-2:-1", "iron-man:-1"], skips: ["incredible-hulk"] });
});

test("a partly watched series is skipped from its drawer, keeps its episodes, and can be un-skipped", async ({ page }, testInfo) => {
  await useOwnClientIp(page, testInfo);
  await openDashboard(page, testInfo, (request) =>
    markWatchedViaApi(request, [1, 2, 3].map((episode) => ({ contentId: "defenders-daredevil-1", episode }))),
  );
  await page.getByRole("tab", { name: "Street-Level saga" }).click();
  await expect(page.locator(".multiverse-shelf")).toContainText("Daredevil — Season 1");

  await card(page, "defenders-daredevil-1").locator(".card-visual").click();
  const drawer = page.getByRole("dialog", { name: "Daredevil — Season 1" });
  await drawer.getByRole("button", { name: "Skip this title" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Skip Daredevil — Season 1?" });
  await expect(dialog).toContainText("Your 3 watched episodes stay.");
  await expect(dialog).toContainText("Skipping it unlocks Daredevil — Season 2");
  await dialog.getByRole("button", { name: "Skip title" }).click();
  await expect(dialog).toBeHidden();

  // Still in the drawer: the skip is explained, the episodes are kept, and it can be undone.
  await expect(drawer.locator(".skip-alert")).toContainText("SKIPPED");
  await expect(drawer.locator(".episode-row.checked")).toHaveCount(3);
  await expect(drawer.getByRole("button", { name: "Un-skip" })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();

  // Season 2 is open now, and the skipped season left the "in progress" shelf.
  await expect(card(page, "defenders-daredevil-2").locator(".card-availability.locked")).toHaveCount(0);
  await expect(page.locator(".multiverse-shelf")).not.toContainText("Daredevil — Season 1");

  // Un-skip from the drawer: nothing later was watched, so it is allowed straight away.
  await card(page, "defenders-daredevil-1").locator(".card-visual").click();
  await drawer.getByRole("button", { name: "Un-skip" }).click();
  await expect(page.locator(".delight-toast.checkpoint")).toContainText("Skip removed");
  await expect(drawer.locator(".skip-alert")).toHaveCount(0);
  await expect(drawer.getByRole("button", { name: "Skip this title" })).toBeVisible();

  await waitForSync(page);
  const { keys, skips } = await saved(page);
  expect(skips).toEqual([]);
  expect(keys).toEqual(["defenders-daredevil-1:1", "defenders-daredevil-1:2", "defenders-daredevil-1:3"]);
});
