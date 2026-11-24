// @vitest-environment jsdom
/**
 * The two new pieces of skip UI (package 2.2), rendered on their own: the card's "more actions"
 * menu (keyboard and pointer behaviour) and the skip confirmation (what it says, and the recap
 * behind its spoiler toggle). The whole flow runs in the browser in tests/e2e/skip.spec.ts.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CardMenu } from "@/components/nexus/card-menu";
import { SkipConfirmation } from "@/components/nexus/skip-confirmation";

import { item } from "../helpers/viewing";

afterEach(cleanup);

/** Lets the dialog's requestAnimationFrame focus step run. */
const nextFrame = () => act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

describe("card menu", () => {
  const twoItems = (onSkip = vi.fn(), onOther = vi.fn()) => [
    { key: "skip", label: "Skip this title", onSelect: onSkip },
    { key: "other", label: "Something else", onSelect: onOther },
  ];

  it("opens with focus on the first item; Escape closes it and returns focus to the button", () => {
    render(<CardMenu label="More actions for Thor" items={twoItems()} />);
    const trigger = screen.getByRole("button", { name: "More actions for Thor" });
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("menu", { name: "More actions for Thor" })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Skip this title" }));

    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("arrow keys, Home and End move between items, wrapping round", () => {
    render(<CardMenu label="More actions for Thor" items={twoItems()} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "More actions for Thor" }), { key: "ArrowDown" });
    const [first, second] = screen.getAllByRole("menuitem");
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second, { key: "ArrowDown" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "ArrowUp" });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second, { key: "Home" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "End" });
    expect(document.activeElement).toBe(second);
  });

  it("choosing an item closes the menu, puts focus on the button, then runs the item", () => {
    let focusedWhenRun: Element | null = null;
    const onSkip = vi.fn(() => {
      focusedWhenRun = document.activeElement;
    });
    render(<CardMenu label="More actions for Thor" items={twoItems(onSkip)} />);
    const trigger = screen.getByRole("button", { name: "More actions for Thor" });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "Skip this title" }));
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(focusedWhenRun).toBe(trigger);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("a press anywhere else closes it without choosing anything", () => {
    const onSkip = vi.fn();
    render(
      <div>
        <p>Elsewhere</p>
        <CardMenu label="More actions for Thor" items={twoItems(onSkip)} />
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "More actions for Thor" }));
    fireEvent.pointerDown(screen.getByText("Elsewhere"));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(onSkip).not.toHaveBeenCalled();
  });

  it("focus moving to another control closes it; focus moving nowhere does not", () => {
    render(
      <div>
        <input aria-label="Search" />
        <CardMenu label="More actions for Thor" items={twoItems()} />
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "More actions for Thor" }));
    const entry = screen.getByRole("menuitem", { name: "Skip this title" });
    // Safari leaves focus nowhere when a non-focusable spot is pressed: the menu stays for the click.
    fireEvent.focusOut(entry, { relatedTarget: null });
    expect(screen.getByRole("menu")).toBeTruthy();
    act(() => screen.getByRole("textbox", { name: "Search" }).focus());
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("skip confirmation", () => {
  it("says a skip clears the title for unlocking but is not 'watched', and what it opens and keeps", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <SkipConfirmation
        item={item("wandavision")}
        impact={{ unlocks: [item("falcon-winter-soldier"), item("loki-1")], keptUnits: 3 }}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );
    const dialog = screen.getByRole("alertdialog", { name: "Skip WandaVision?" });
    expect(dialog.textContent).toContain("It will count as cleared for unlocking later titles, but not as watched.");
    expect(screen.getAllByRole("listitem").map((entry) => entry.textContent)).toEqual([
      "Skipping it unlocks The Falcon and the Winter Soldier and 1 more.",
      "Your 3 watched episodes stay.",
      "You can un-skip it later, or still mark it watched.",
    ]);
    // Focus starts on the safe choice.
    await nextFrame();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
    // No recap is written for this title, so there is nothing to reveal.
    expect(screen.queryByRole("button", { name: /Reveal/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Skip title" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("an optional title says it never locks anything", () => {
    render(<SkipConfirmation item={item("eternals")} impact={{ unlocks: [], keptUnits: 0 }} onCancel={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getAllByRole("listitem").map((entry) => entry.textContent)).toEqual([
      "Optional titles never lock anything, so this only takes it off your list.",
      "You can un-skip it later, or still mark it watched.",
    ]);
  });

  it("keeps a recap hidden behind the spoiler toggle until it is asked for", () => {
    render(
      <SkipConfirmation
        item={item("incredible-hulk")}
        impact={{ unlocks: [], keptUnits: 0 }}
        recap="A test recap with spoilers."
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByText("What you need to know")).toBeTruthy();
    const toggle = screen.getByRole("button", { name: "Reveal (spoilers for this title)" });
    const recap = screen.getByText("A test recap with spoilers.");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-controls")).toBe(recap.id);
    expect(recap.hidden).toBe(true);

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(recap.hidden).toBe(false);
    expect(screen.getByRole("button", { name: "Hide the recap" })).toBe(toggle);
  });
});
