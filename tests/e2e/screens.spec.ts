/**
 * Screenshot and layout baseline. Run with `npm run shots`.
 *
 * Seeds a profile through the API (nine MCU films, X-Men (2000) and four Daredevil
 * Season 1 episodes), then saves screenshots at each project's viewport (1440x900,
 * 1366x768 and 390x844) into `.tmp/shots/<project>/` and records layout numbers in
 * `.tmp/shots/<project>/metrics.json`. Compare runs by opening the images.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { markWatchedViaApi, settle, signUpViaApi, TEST_PASSWORD, uniqueUsername, useOwnClientIp, waitForSync, watchCspViolations } from "./helpers";

const SEED = [
  // Nine MCU films, in release order.
  ...[
    "iron-man",
    "incredible-hulk",
    "iron-man-2",
    "thor",
    "captain-america-first-avenger",
    "avengers",
    "iron-man-3",
    "thor-dark-world",
    "winter-soldier",
  ].map((contentId) => ({ contentId, episode: -1 })),
  { contentId: "xmen-2000", episode: -1 },
  // Four episodes of Daredevil Season 1.
  ...[1, 2, 3, 4].map((episode) => ({ contentId: "defenders-daredevil-1", episode })),
];

type LayoutMetrics = {
  viewport: { width: number; height: number };
  /** Distance from the top of the page to the top of the first archive card. */
  firstCardTop: number;
  pageHeight: number;
  /** Text nodes that are rendered and visible but set smaller than 11px. */
  textNodesUnder11px: number;
  smallTextSamples: string[];
  scrollWidth: number;
  clientWidth: number;
};

async function measureLayout(page: Page): Promise<LayoutMetrics> {
  return page.evaluate(() => {
    const samples: string[] = [];
    let small = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = node.textContent?.trim() ?? "";
      const element = node.parentElement;
      if (!text || !element || element.closest("script, style, noscript")) continue;
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) continue;
      const box = element.getBoundingClientRect();
      if (box.width < 2 || box.height < 2) continue; // visually hidden (sr-only) text
      if (parseFloat(style.fontSize) < 11) {
        small += 1;
        if (samples.length < 40) samples.push(`${parseFloat(style.fontSize)}px "${text.slice(0, 40)}"`);
      }
    }
    const firstCard = document.querySelector(".timeline-card");
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      firstCardTop: firstCard ? Math.round(firstCard.getBoundingClientRect().top + window.scrollY) : -1,
      pageHeight: document.documentElement.scrollHeight,
      textNodesUnder11px: small,
      smallTextSamples: samples,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    };
  });
}

async function expectNoHorizontalOverflow(page: Page, where: string) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `horizontal overflow on ${where}`).toBeLessThanOrEqual(clientWidth + 1);
}

function shotWriter(testInfo: TestInfo) {
  const dir = path.resolve(process.cwd(), ".tmp", "shots", testInfo.project.name);
  mkdirSync(dir, { recursive: true });
  return {
    dir,
    async take(page: Page, name: string) {
      await settle(page);
      await page.screenshot({
        path: path.join(dir, `${name}.png`),
        animations: "disabled",
        // Hide the Next.js dev-mode badge so the images show only the app.
        style: "nextjs-portal { display: none !important; }",
      });
    },
  };
}

async function closeDialogWithEscape(page: Page, name: string | RegExp) {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name })).toBeHidden();
}

test("baseline screenshots and layout numbers", async ({ page }, testInfo) => {
  await useOwnClientIp(page, testInfo);
  // Every screen below is checked: the list must still be empty at the end.
  const cspViolations = watchCspViolations(page);
  const shots = shotWriter(testInfo);

  // 1. Sign-in screen (signed out).
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Resume your mission" })).toBeVisible();
  await expectNoHorizontalOverflow(page, "sign-in");
  await shots.take(page, "01-sign-in");

  // Seed the profile, then load the signed-in dashboard.
  const username = uniqueUsername(testInfo);
  await signUpViaApi(page.request, username);
  await markWatchedViaApi(page.request, SEED);
  await page.goto("/");
  await expect(page.locator(".timeline-card").first()).toBeVisible();
  await expect(page.locator("#timeline-item-winter-soldier").getByRole("button", { name: "Watched", exact: true })).toBeVisible();

  // 2. Dashboard top.
  await expectNoHorizontalOverflow(page, "dashboard");
  await shots.take(page, "02-dashboard-top");

  // Layout numbers are measured with the dashboard at rest, before any overlay opens.
  const metrics = await measureLayout(page);
  writeFileSync(path.join(shots.dir, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`);
  console.log(
    `[${testInfo.project.name}] first card top ${metrics.firstCardTop}px, page height ${metrics.pageHeight}px, ` +
      `${metrics.textNodesUnder11px} text nodes under 11px, horizontal overflow ${metrics.scrollWidth - metrics.clientWidth}px`,
  );
  expect(metrics.firstCardTop, "the archive has a first card").toBeGreaterThan(0);

  // 3. Archive: scroll so the first row of cards is in view.
  await page.locator("#timeline-panel").scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const top = document.querySelector(".archive-heading")!.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, top - 80);
  });
  await expectNoHorizontalOverflow(page, "archive");
  await shots.take(page, "03-archive");

  // 4. Movie drawer: Guardians of the Galaxy is the next unlocked film.
  await page.locator("#timeline-item-guardians-1 .card-visual").click();
  const drawer = page.getByRole("dialog", { name: "Guardians of the Galaxy" });
  await expect(drawer).toBeVisible();
  await shots.take(page, "04-drawer-movie");
  await closeDialogWithEscape(page, "Guardians of the Galaxy");

  // 5. Locked drawer: Avengers: Endgame still needs earlier films.
  await page.locator("#timeline-item-endgame .card-visual").click();
  await expect(page.getByRole("dialog", { name: "Avengers: Endgame" })).toBeVisible();
  await shots.take(page, "05-drawer-locked");
  await closeDialogWithEscape(page, "Avengers: Endgame");

  // 6. Series drawer: Daredevil Season 1 with four episodes watched (Street-Level tab).
  await page.getByRole("tab", { name: "Street-Level saga" }).click();
  await expect(page.locator("#timeline-item-defenders-daredevil-1")).toBeVisible();
  await page.locator("#timeline-item-defenders-daredevil-1 .card-visual").click();
  await expect(page.getByRole("dialog", { name: /^Daredevil/ })).toBeVisible();
  await shots.take(page, "06-drawer-series");
  await closeDialogWithEscape(page, /^Daredevil/);

  // 7. Command palette.
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Search the Doom Flix archive" });
  await expect(palette).toBeVisible();
  await shots.take(page, "07-command-palette");
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();

  // 8. Lore guide.
  await page.keyboard.press("l");
  await expect(page.getByRole("dialog", { name: "Doom Flix guide" })).toBeVisible();
  await shots.take(page, "08-lore-guide");
  await page.getByRole("button", { name: "Back to dashboard" }).click();
  await expect(page.getByRole("dialog", { name: "Doom Flix guide" })).toBeHidden();

  // 9. Account panel, opened from the operator name (an icon button on phones).
  await page.getByRole("button", { name: `Open account: ${username}` }).click();
  const panel = page.getByRole("dialog", { name: username });
  await expect(panel).toBeVisible();
  await shots.take(page, "09-account-panel");

  // 10. A new recovery code, made from the panel.
  await panel.getByLabel("Current password").fill(TEST_PASSWORD);
  await panel.getByRole("button", { name: "Make a new recovery code" }).click();
  const codeDialog = page.getByRole("alertdialog", { name: "Your new recovery code" });
  await expect(codeDialog).toBeVisible();
  await shots.take(page, "10-recovery-code");
  await codeDialog.getByLabel("I have saved this code somewhere safe").check();
  await codeDialog.getByRole("button", { name: "Continue" }).click();
  await expect(codeDialog).toBeHidden();
  await closeDialogWithEscape(page, username);

  // 11. Un-watch confirmation (package 2.1): Iron Man has eight later films watched, which would go with it.
  await page.getByRole("tab", { name: "MCU timeline" }).click();
  await page.locator("#timeline-item-iron-man").getByRole("button", { name: "Watched", exact: true }).click();
  const confirmation = page.getByRole("alertdialog", { name: "Remove later progress too?" });
  await expect(confirmation.getByRole("listitem")).toHaveCount(8);
  await shots.take(page, "11-unwatch-confirmation");
  await confirmation.getByRole("button", { name: "Keep watched" }).click();
  await expect(confirmation).toBeHidden();

  // 12. A tick that cannot be saved yet: on screen at once, with the saving dot, the Undo toast and
  // the offline chip. Then the connection comes back and it is saved.
  await page.route("**/api/progress", (route) => (route.request().method() === "POST" ? route.abort("internetdisconnected") : route.continue()));
  await page.locator("#timeline-item-guardians-1").getByRole("button", { name: "Mark watched", exact: true }).click();
  await expect(page.getByText("Offline — changes will sync")).toBeVisible();
  await expect(page.locator("#timeline-item-guardians-1 .card-action")).toHaveAttribute("data-saving", "true");
  await shots.take(page, "12-offline-tick");
  await page.unroute("**/api/progress");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await waitForSync(page);

  expect(cspViolations, "Content Security Policy violations").toEqual([]);
});
