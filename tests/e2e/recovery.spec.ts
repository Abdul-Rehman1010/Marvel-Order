import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { TEST_PASSWORD, uniqueUsername, useOwnClientIp, watchCspViolations } from "./helpers";

const NEW_PASSWORD = "recovered-password-2";

async function signUpThroughTheScreen(page: Page, username: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[name="password"]').fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Initialize profile" }).click();
}

async function confirmCode(page: Page, heading: string) {
  const dialog = page.getByRole("alertdialog", { name: heading });
  await expect(dialog).toBeVisible();
  const code = (await dialog.locator(".recovery-code").textContent())?.trim() ?? "";
  expect(code).toMatch(/^[0-9A-Z]{5}(-[0-9A-Z]{5}){3}$/);
  // "Continue" stays disabled until the user confirms they saved the code.
  await expect(dialog.getByRole("button", { name: "Continue" })).toBeDisabled();
  await dialog.getByLabel("I have saved this code somewhere safe").check();
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(dialog).toBeHidden();
  return code;
}

/** A new account lands on the catch-up wizard (package 2.3); close it to reach the dashboard. */
async function closeCatchUp(page: Page) {
  const wizard = page.getByRole("dialog", { name: "Catch up on what you've watched" });
  await expect(wizard).toBeVisible();
  await wizard.getByRole("button", { name: "Close catch-up" }).click();
  await expect(wizard).toBeHidden();
}

async function signIn(page: Page, username: string, password: string) {
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Enter Doom Flix" }).click();
}

test("sign up, save the recovery code, recover with it; the old password stops working", async ({ page }, testInfo) => {
  await useOwnClientIp(page, testInfo);
  const cspViolations = watchCspViolations(page);
  const username = uniqueUsername(testInfo);

  await signUpThroughTheScreen(page, username);

  // The code can be downloaded as a text file that contains it.
  const codeDialog = page.getByRole("alertdialog", { name: "Save your recovery code" });
  await expect(codeDialog).toBeVisible();
  const shownCode = (await codeDialog.locator(".recovery-code").textContent())?.trim() ?? "";
  const downloading = page.waitForEvent("download");
  await codeDialog.getByRole("button", { name: "Download" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe(`doom-flix-recovery-code-${username}.txt`);
  expect(readFileSync(await download.path(), "utf8")).toContain(`Recovery code: ${shownCode}`);

  const code = await confirmCode(page, "Save your recovery code");
  expect(code).toBe(shownCode);
  await closeCatchUp(page);
  await page.getByRole("button", { name: "Log out" }).click();

  // Forgot password: username, the saved code (typed in lower case, as people do), a new password.
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[name="recoveryCode"]').fill(code.toLowerCase());
  await page.locator('input[name="password"]').fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Reset password" }).click();

  // A new code replaces the used one, then the user is signed in.
  const newCode = await confirmCode(page, "Password changed. Save your new recovery code");
  expect(newCode).not.toBe(code);
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
  await page.getByRole("button", { name: "Log out" }).click();

  // The old password fails; the new one works.
  await signIn(page, username, TEST_PASSWORD);
  await expect(page.locator(".auth-panel .form-error")).toHaveText(/Username or password is incorrect\./);
  await signIn(page, username, NEW_PASSWORD);
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();

  // The used code no longer works.
  await page.getByRole("button", { name: "Log out" }).click();
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[name="recoveryCode"]').fill(code);
  await page.locator('input[name="password"]').fill("yet-another-password");
  await page.getByRole("button", { name: "Reset password" }).click();
  await expect(page.locator(".auth-panel .form-error")).toHaveText(/Username or recovery code is incorrect\./);

  expect(cspViolations, "Content Security Policy violations").toEqual([]);
});

test("account panel: sign out everywhere, then delete the account", async ({ page }, testInfo) => {
  await useOwnClientIp(page, testInfo);
  const cspViolations = watchCspViolations(page);
  const username = uniqueUsername(testInfo);

  await signUpThroughTheScreen(page, username);
  await confirmCode(page, "Save your recovery code");
  await closeCatchUp(page);

  // Sign out everywhere: needs the current password, and lands on the sign-in screen.
  await page.getByRole("button", { name: `Open account: ${username}` }).click();
  let panel = page.getByRole("dialog", { name: username });
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "Sign out everywhere" }).click();
  await expect(panel.getByRole("alert")).toHaveText("Enter your current password first.");
  await panel.getByLabel("Current password").fill("wrong-password");
  await panel.getByRole("button", { name: "Sign out everywhere" }).click();
  await expect(panel.getByRole("alert")).toHaveText("Your current password is incorrect.");
  await panel.getByLabel("Current password").fill(TEST_PASSWORD);
  await panel.getByRole("button", { name: "Sign out everywhere" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Signed out on every device." })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Resume your mission" })).toBeVisible();

  // Delete: the button stays disabled until the username is typed.
  await signIn(page, username, TEST_PASSWORD);
  await page.getByRole("button", { name: `Open account: ${username}` }).click();
  panel = page.getByRole("dialog", { name: username });
  await panel.getByLabel("Current password").fill(TEST_PASSWORD);
  const deleteButton = panel.getByRole("button", { name: "Delete account" });
  await expect(deleteButton).toBeDisabled();
  await panel.getByLabel(/Type .* to confirm/).fill(username.toUpperCase());
  await deleteButton.click();
  await expect(page.getByRole("status").filter({ hasText: "Your account and all its progress were deleted." })).toBeVisible();

  // The account is gone.
  await signIn(page, username, TEST_PASSWORD);
  await expect(page.locator(".auth-panel .form-error")).toHaveText(/Username or password is incorrect\./);

  expect(cspViolations, "Content Security Policy violations").toEqual([]);
});
