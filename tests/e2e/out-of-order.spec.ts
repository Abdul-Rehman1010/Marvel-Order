import { createClient } from "@libsql/client";
import { expect, test } from "@playwright/test";

import { E2E_DATABASE_URL } from "../../playwright.config";
import { signUpViaApi, uniqueUsername, useOwnClientIp } from "./helpers";

/**
 * Before package 1.3 an un-watch could leave rows behind for titles whose prerequisite was no
 * longer watched, and those rows could not be removed (un-ticking was disabled on locked titles).
 * They are never deleted automatically. This checks they are labelled and can be removed by hand.
 */
test("progress left out of order is labelled and can be removed", async ({ page }) => {
  await useOwnClientIp(page, test.info());
  await signUpViaApi(page.request, uniqueUsername(test.info()));
  const { user } = await (await page.request.get("/api/progress")).json();

  // Write the rows straight into the scratch database: the API would (rightly) refuse them.
  const db = createClient({ url: E2E_DATABASE_URL, timeout: 5_000 });
  try {
    await db.batch(
      [
        // Daredevil Season 2, episode 1, with Season 1 never watched.
        { sql: "INSERT INTO progress (user_id, content_id, episode, watched_at) VALUES (?, ?, ?, ?)", args: [user.id, "defenders-daredevil-2", 1, "2026-06-01T00:00:00.000Z"] },
        // The Incredible Hulk, with Iron Man never watched.
        { sql: "INSERT INTO progress (user_id, content_id, episode, watched_at) VALUES (?, ?, ?, ?)", args: [user.id, "incredible-hulk", -1, "2026-06-02T00:00:00.000Z"] },
      ],
      "write",
    );
  } finally {
    db.close();
  }

  const reported = await (await page.request.get("/api/progress")).json();
  expect(reported.outOfOrder).toEqual(["incredible-hulk", "defenders-daredevil-2"]);

  await page.goto("/");
  const hulk = page.locator("#timeline-item-incredible-hulk");
  await expect(hulk.getByText("Watched out of order")).toBeVisible();

  // The movie card: its "Watched" control is enabled although the title is locked.
  const hulkToggle = hulk.getByRole("button", { name: "Watched", exact: true });
  await expect(hulkToggle).toBeEnabled();
  await hulkToggle.click();
  await expect(hulk.getByText("Watched out of order")).toBeHidden();
  await expect(hulk.getByText("Locked", { exact: true })).toBeVisible();
  await expect(hulk.getByRole("button", { name: "Complete prerequisite" })).toBeDisabled();

  // The series: card label, drawer notice, and an episode row that can be un-ticked.
  await page.getByRole("tab", { name: "Street-Level saga" }).click();
  const seasonTwo = page.locator("#timeline-item-defenders-daredevil-2");
  await expect(seasonTwo.getByText("Watched out of order")).toBeVisible();
  await seasonTwo.locator(".card-visual").click();
  const drawer = page.getByRole("dialog", { name: "Daredevil — Season 2" });
  await expect(drawer.getByText("WATCHED OUT OF ORDER")).toBeVisible();

  const episodes = drawer.locator(".episode-row");
  await expect(episodes.nth(0)).toHaveClass(/checked/);
  await expect(episodes.nth(0)).toBeEnabled();
  await expect(episodes.nth(1)).toBeDisabled(); // an unwatched episode of a locked title stays locked
  await episodes.nth(0).click();
  await expect(episodes.nth(0)).not.toHaveClass(/checked/);
  await expect(drawer.getByText("WATCHED OUT OF ORDER")).toBeHidden();

  // Both removals were saved.
  const after = await (await page.request.get("/api/progress")).json();
  expect(after.outOfOrder).toEqual([]);
  expect(after.state.rows).toEqual([]);
});
