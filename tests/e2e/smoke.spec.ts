import { expect, test } from "@playwright/test";

import { TEST_PASSWORD, uniqueUsername, useOwnClientIp, watchCspViolations } from "./helpers";

test("sign up, mark Iron Man, reload, un-watch, sign out", async ({ page }, testInfo) => {
  await useOwnClientIp(page, testInfo);
  const cspViolations = watchCspViolations(page);
  const username = uniqueUsername(testInfo);

  // Sign up from the sign-in screen.
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Resume your mission" })).toBeVisible();
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[name="password"]').fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Initialize profile" }).click();

  // A new account is shown its recovery code once, before anything else.
  const codeDialog = page.getByRole("alertdialog", { name: "Save your recovery code" });
  await expect(codeDialog).toBeVisible();
  await expect(codeDialog.locator(".recovery-code")).toHaveText(/^[0-9A-Z]{5}(-[0-9A-Z]{5}){3}$/);
  await codeDialog.getByLabel("I have saved this code somewhere safe").check();
  await codeDialog.getByRole("button", { name: "Continue" }).click();

  // A new account lands on the lore guide first; close it to reach the dashboard.
  const guide = page.getByRole("dialog", { name: "Doom Flix guide" });
  await expect(guide).toBeVisible();
  await page.getByRole("button", { name: "Back to dashboard" }).click();
  await expect(guide).toBeHidden();
  // The operator name is hidden on phones, so use the Log out button to know we are signed in.
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();

  // Mark Iron Man watched.
  const ironMan = () => page.locator("#timeline-item-iron-man");
  await ironMan().getByRole("button", { name: "Mark watched", exact: true }).click();
  await expect(ironMan().getByRole("button", { name: "Watched", exact: true })).toBeVisible();

  // A reload fetches progress from the server again, so this proves it was saved.
  await page.reload();
  await expect(ironMan().getByRole("button", { name: "Watched", exact: true })).toBeVisible();

  // Un-watch it (it is the newest checkpoint, so no confirmation appears) and confirm that persists too.
  await ironMan().getByRole("button", { name: "Watched", exact: true }).click();
  await expect(ironMan().getByRole("button", { name: "Mark watched", exact: true })).toBeVisible();
  await page.reload();
  await expect(ironMan().getByRole("button", { name: "Mark watched", exact: true })).toBeVisible();

  // Sign out returns to the sign-in screen, and the session is really gone after a reload.
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("heading", { name: "Resume your mission" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Resume your mission" })).toBeVisible();

  expect(cspViolations, "Content Security Policy violations").toEqual([]);
});
