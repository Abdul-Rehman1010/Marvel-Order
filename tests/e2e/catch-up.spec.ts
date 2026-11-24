import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { markWatchedViaApi, signUpViaApi, TEST_PASSWORD, uniqueUsername, useOwnClientIp, waitForSync, watchCspViolations } from "./helpers";

/**
 * Package 2.3: the catch-up wizard marks everything already seen in one `bulk` action, and series
 * can be marked an episode at a time from their card or all at once from the drawer. The sizes
 * (1440, 1366 and 390 px) come from the three Playwright projects.
 */

const WIZARD = "Catch up on what you've watched";
const card = (page: Page, id: string) => page.locator(`#timeline-item-${id}`);
const readiness = (page: Page) => page.locator(".doomsday-progress .reactor-readout strong");

async function savedRows(page: Page) {
  const { state } = await (await page.request.get("/api/progress")).json();
  return state.rows as { contentId: string; episode: number; backfilled: boolean }[];
}

async function signUpThroughTheScreen(page: Page, testInfo: TestInfo) {
  await page.goto("/");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.locator('input[name="username"]').fill(uniqueUsername(testInfo));
  await page.locator('input[name="password"]').fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Initialize profile" }).click();
  const codeDialog = page.getByRole("alertdialog", { name: "Save your recovery code" });
  await codeDialog.getByLabel("I have saved this code somewhere safe").check();
  await codeDialog.getByRole("button", { name: "Continue" }).click();
}

/** Steps from wherever the wizard is to Review. */
async function toReview(page: Page) {
  const wizard = page.getByRole("dialog", { name: WIZARD });
  for (;;) {
    const review = wizard.getByRole("button", { name: "Review", exact: true });
    if (await review.isVisible()) {
      await review.click();
      break;
    }
    await wizard.getByRole("button", { name: "Next", exact: true }).click();
  }
  await expect(wizard.getByRole("heading", { name: "Check the list, then save it" })).toBeVisible();
}

test("a new account catches up 'Through Endgame' in under a minute; readiness jumps and survives a reload", async ({ page }, testInfo) => {
  const cspViolations = watchCspViolations(page);
  await useOwnClientIp(page, testInfo);
  await signUpThroughTheScreen(page, testInfo);

  // Straight after sign-up, the wizard (not the lore guide) is waiting.
  const wizard = page.getByRole("dialog", { name: WIZARD });
  await expect(wizard).toBeVisible();
  const started = Date.now();
  await expect(readiness(page)).toHaveText("0%");

  await wizard.getByRole("button", { name: "Through Endgame" }).click();
  await expect(wizard).toContainText("22 titles, through Avengers: Endgame");
  await toReview(page);
  await expect(wizard).toContainText(/Will mark 22 movies \(\d+h \d{2}m\) as watched\./);
  await wizard.getByRole("button", { name: "Mark 22 titles watched" }).click();
  await expect(wizard).toBeHidden();
  const elapsed = Date.now() - started;

  // One summary toast, and the readiness ring shows the same number.
  const toast = page.locator(".delight-toast").filter({ hasText: "Caught up: 22 titles" });
  await expect(toast).toBeVisible();
  const percent = Number((await toast.locator("strong").textContent())?.match(/readiness now (\d+)%/)?.[1]);
  expect(percent).toBeGreaterThan(30);
  await expect(readiness(page)).toHaveText(`${percent}%`);
  await expect(card(page, "endgame").getByRole("button", { name: "Watched", exact: true })).toBeVisible();
  expect(elapsed, "time from the wizard opening to the catch-up being applied").toBeLessThan(60_000);

  // Saved as one backfilled batch; a reload shows the same.
  await waitForSync(page);
  const rows = await savedRows(page);
  expect(rows).toHaveLength(22);
  expect(rows.every((row) => row.backfilled)).toBe(true);
  await page.reload();
  await expect(readiness(page)).toHaveText(`${percent}%`);
  await expect(page.locator(".catchup-prompt")).toHaveCount(0);
  expect(cspViolations, "Content Security Policy violations").toEqual([]);
});

test("the archive prompt and the account panel open the wizard; ticking Hawkeye brings in what it needs", async ({ page }, testInfo) => {
  await useOwnClientIp(page, testInfo);
  const username = uniqueUsername(testInfo);
  await signUpViaApi(page.request, username);
  await page.goto("/");
  const wizard = page.getByRole("dialog", { name: WIZARD });

  // With no progress yet, the archive offers the wizard.
  const prompt = page.locator(".catchup-prompt");
  await expect(prompt).toContainText("Already watched some of these?");
  await prompt.getByRole("button", { name: "Catch up" }).click();
  await expect(wizard).toBeVisible();
  await wizard.getByRole("button", { name: "Close catch-up" }).click();
  await expect(wizard).toBeHidden();

  // So does the account panel.
  await page.getByRole("button", { name: `Open account: ${username}` }).click();
  await page.getByRole("dialog", { name: username }).getByRole("button", { name: "Catch up on what you've watched" }).click();
  await expect(wizard).toBeVisible();

  // Nothing from the films, only Hawkeye: the MCU through Endgame comes with it, and Review says why.
  await wizard.getByRole("button", { name: "Next", exact: true }).click();
  await wizard.getByRole("button", { name: "Next", exact: true }).click();
  await wizard.getByRole("checkbox", { name: /^Hawkeye/ }).check();
  await expect(wizard).toContainText("Also adds 22 earlier titles it needs, through Avengers: Endgame");
  await wizard.getByRole("button", { name: "Review", exact: true }).click();
  await expect(wizard.getByRole("region", { name: "MCU" }).getByText("Added: Hawkeye needs it")).toHaveCount(22);
  // Not seen Iron Man after all: it becomes a skip, and everything after it stays unlocked.
  await wizard.getByRole("button", { name: "Haven't seen Iron Man", exact: true }).click();
  await expect(wizard).toContainText("and skip 1 title.");
  await wizard.getByRole("button", { name: "Mark 22 titles watched and skip 1" }).click();
  await expect(wizard).toBeHidden();

  await expect(card(page, "iron-man").locator(".skip-chip")).toHaveText("Skipped");
  await expect(card(page, "endgame").getByRole("button", { name: "Watched", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Street-Level saga" }).click();
  await expect(card(page, "hawkeye").getByRole("button", { name: "Season complete" })).toBeVisible();
  await expect(page.locator(".catchup-prompt")).toHaveCount(0);
  await waitForSync(page);
  const { state } = await (await page.request.get("/api/progress")).json();
  expect(state.skips.map((skip: { contentId: string }) => skip.contentId)).toEqual(["iron-man"]);
});

test("a series card marks its next episode; the drawer marks all the rest, and Undo takes them back", async ({ page }, testInfo) => {
  await useOwnClientIp(page, testInfo);
  await signUpViaApi(page.request, uniqueUsername(testInfo));
  await markWatchedViaApi(page.request, [1, 2, 3].map((episode) => ({ contentId: "defenders-daredevil-1", episode })));
  await page.goto("/");
  await page.getByRole("tab", { name: "Street-Level saga" }).click();
  const daredevil = card(page, "defenders-daredevil-1");

  await daredevil.getByRole("button", { name: "Mark E04 watched" }).click();
  await expect(daredevil.getByRole("button", { name: "Mark E05 watched" })).toBeVisible();
  await expect(daredevil.getByRole("button", { name: "Open Daredevil — Season 1: 4 of 13 episodes watched" })).toBeVisible();

  await daredevil.getByRole("button", { name: /^Open Daredevil — Season 1: 4 of 13/ }).click();
  const drawer = page.getByRole("dialog", { name: "Daredevil — Season 1" });
  await drawer.getByRole("button", { name: "Mark all 9 remaining episodes watched" }).click();
  await expect(drawer.locator(".episode-row.checked")).toHaveCount(13);
  const checkpoint = page.locator(".delight-toast.checkpoint");
  await expect(checkpoint).toContainText("9 episodes · 9h 00m logged in your archive");

  // Undo removes the nine it added, and only those.
  await checkpoint.getByRole("button", { name: "Undo" }).click();
  await expect(drawer.locator(".episode-row.checked")).toHaveCount(4);
  await waitForSync(page);
  const keys = (await savedRows(page)).map((row) => `${row.contentId}:${row.episode}`).sort();
  expect(keys).toEqual([1, 2, 3, 4].map((episode) => `defenders-daredevil-1:${episode}`));
});

test("if the server refuses a catch-up, the wizard comes back at Review and says why", async ({ page }, testInfo) => {
  await useOwnClientIp(page, testInfo);
  const username = uniqueUsername(testInfo);
  await signUpViaApi(page.request, username);
  await markWatchedViaApi(page.request, [{ contentId: "iron-man", episode: -1 }]);
  await page.goto("/");
  await expect(card(page, "iron-man").getByRole("button", { name: "Watched", exact: true })).toBeVisible();

  // Another device removes Iron Man; this page still shows it watched, so its catch-up leaves it out.
  const removal = await page.request.post("/api/progress", { data: { action: { type: "unwatch", contentId: "iron-man", episode: -1 } } });
  expect(removal.ok()).toBe(true);

  await page.getByRole("button", { name: `Open account: ${username}` }).click();
  await page.getByRole("dialog", { name: username }).getByRole("button", { name: "Catch up on what you've watched" }).click();
  const wizard = page.getByRole("dialog", { name: WIZARD });
  await wizard.getByRole("button", { name: "Through Endgame" }).click();
  await toReview(page);
  await expect(wizard).toContainText("1 title you already marked watched stays as it is.");
  await wizard.getByRole("button", { name: "Mark 21 titles watched" }).click();

  // The server says no (The Incredible Hulk needs Iron Man). The wizard reopens at Review with the
  // reason, now knowing Iron Man is not watched, and the catch-up goes through on the second try.
  await expect(wizard.getByRole("alert")).toContainText("The Incredible Hulk needs Iron Man. Your progress had changed elsewhere; the list now includes it");
  await wizard.getByRole("button", { name: "Mark 22 titles watched" }).click();
  await expect(wizard).toBeHidden();
  await expect(page.locator(".delight-toast").filter({ hasText: "Caught up: 22 titles" })).toBeVisible();
  await waitForSync(page);
  expect(await savedRows(page)).toHaveLength(22);
});
