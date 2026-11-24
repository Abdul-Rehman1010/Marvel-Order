// @vitest-environment jsdom
/**
 * The catch-up wizard (package 2.3) rendered on its own: the steps, the quick picks, the Street-Level
 * auto-ticks, "Haven't seen this", the one bulk action it sends, and what it shows after a refusal.
 * The whole flow runs in the browser in tests/e2e/catch-up.spec.ts.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { CatchUpWizard } from "@/components/nexus/catch-up-wizard";
import { MCU_CONTENT } from "@/lib/catalogue";
import { EMPTY_CATCH_UP, type CatchUpDraft } from "@/lib/client/catch-up";
import { EMPTY_STATE } from "@/lib/engine/state";

import { NOW, requiredThrough } from "../helpers/viewing";

afterEach(cleanup);

beforeAll(() => {
  // jsdom has no layout, so it has no scrolling either; in a browser each step starts at its top.
  Element.prototype.scrollTo = () => {};
});

function renderWizard(options: { initial?: CatchUpDraft; failure?: { code: string; message: string; contentId?: string; missingId?: string } } = {}) {
  const onConfirm = vi.fn(() => null);
  const onClose = vi.fn();
  const onHowItWorks = vi.fn();
  render(
    <CatchUpWizard
      state={EMPTY_STATE}
      now={NOW.getTime()}
      initial={options.initial ?? EMPTY_CATCH_UP}
      failure={options.failure ?? null}
      onClose={onClose}
      onHowItWorks={onHowItWorks}
      onConfirm={onConfirm}
    />,
  );
  return { onConfirm, onClose, onHowItWorks, dialog: screen.getByRole("dialog", { name: "Catch up on what you've watched" }) };
}

const next = () => fireEvent.click(screen.getByRole("button", { name: /^(Next|Review)$/ }));

describe("catch-up wizard", () => {
  it("Through Endgame, then Review: one backfilled bulk with the 22 films; 'Haven't seen this' turns one into a skip", () => {
    const { onConfirm } = renderWizard();
    expect(screen.getByRole("heading", { name: "What is the latest MCU title you've seen?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Through Endgame" }));
    expect(screen.getByRole("button", { name: "Through Endgame" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("radio", { name: /Avengers: Endgame/ })).toHaveProperty("checked", true);
    expect(screen.getByText("22 titles, through Avengers: Endgame")).toBeTruthy();

    next();
    expect(screen.getByRole("heading", { name: "What is the latest X-Men film you've seen?" })).toBeTruthy();
    next();
    expect(screen.getByRole("heading", { name: "Which Street-Level seasons have you seen?" })).toBeTruthy();
    next();
    expect(screen.getByRole("heading", { name: "Check the list, then save it" })).toBeTruthy();
    expect(screen.getByText(/^Will mark 22 movies \(\d+h \d{2}m\) as watched\.$/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Haven't seen Iron Man" }));
    expect(screen.getByRole("button", { name: "Haven't seen Iron Man" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/Will be skipped, so later titles stay unlocked/)).toBeTruthy();
    expect(screen.getByText(/as watched, and skip 1 title\.$/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Mark 21 titles watched and skip 1" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const [action] = onConfirm.mock.calls[0] as unknown as [{ watch: string[]; skip: string[]; backfilled: boolean; type: string }];
    expect(action).toEqual({ type: "bulk", watch: requiredThrough(MCU_CONTENT, "endgame").filter((id) => id !== "iron-man"), skip: ["iron-man"], backfilled: true });
  });

  it("Street-Level: a ticked season ticks the seasons it needs, and says why", () => {
    renderWizard({ initial: { ...EMPTY_CATCH_UP, step: "street" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Daredevil — Season 2/ }));
    const seasonOne = screen.getByRole("checkbox", { name: /Daredevil — Season 1/ });
    expect(seasonOne).toHaveProperty("checked", true);
    expect(seasonOne).toHaveProperty("disabled", true);
    expect(screen.getByText("Ticked because Daredevil — Season 2 needs it")).toBeTruthy();

    // Hawkeye needs the MCU through Endgame: the note says so, and Review lists them as added.
    fireEvent.click(screen.getByRole("checkbox", { name: /^Hawkeye/ }));
    expect(screen.getByText("Also adds 22 earlier titles it needs, through Avengers: Endgame")).toBeTruthy();
    next();
    const mcu = screen.getByRole("region", { name: "MCU" });
    expect(within(mcu).getAllByText("Added: Hawkeye needs it")).toHaveLength(22);
  });

  it("after a refusal it opens at Review, names the missing title and adds it with one button", () => {
    renderWizard({
      initial: { ...EMPTY_CATCH_UP, step: "review", mcuPoint: "thor" },
      failure: { code: "locked", message: "Watch X-Men (2000) first.", contentId: "multiverse-of-madness", missingId: "xmen-2000" },
    });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Doctor Strange in the Multiverse of Madness needs X-Men, which is not in this list.");
    fireEvent.click(within(alert).getByRole("button", { name: "Add X-Men" }));
    expect(screen.queryByRole("alert")).toBeNull();
    // X-Men (2000), whose catalogue title is "X-Men", is now in the list, ticked.
    const added = within(screen.getByRole("region", { name: "X-Men" })).getByRole("button", { name: "Haven't seen X-Men" });
    expect(added.getAttribute("aria-pressed")).toBe("false");
  });

  it("'How it works' hands back the draft so the wizard can return after the lore guide", () => {
    const { onHowItWorks } = renderWizard();
    fireEvent.click(screen.getByRole("button", { name: "Everything released" }));
    fireEvent.click(screen.getByRole("button", { name: "How it works" }));
    expect(onHowItWorks).toHaveBeenCalledWith(expect.objectContaining({ step: "mcu", mcuPoint: "visionquest" }));
  });

  it("Nothing picked: Review says so and there is nothing to confirm", () => {
    renderWizard({ initial: { ...EMPTY_CATCH_UP, step: "review" } });
    expect(screen.getByText("Nothing to mark yet.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Nothing to mark" })).toHaveProperty("disabled", true);
  });
});
