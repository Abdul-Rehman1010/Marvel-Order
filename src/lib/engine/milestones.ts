/**
 * What an action revealed, for the celebration toasts (NEXT_LEVEL_PLAN.md 2.1). Pure.
 *
 * Both functions compare the viewing index from before an action with the one after it, so they
 * work for any action type, a bulk catch-up included. The client captures that pair when it
 * dispatches an action, before the optimistic update is applied; comparing the updated state with
 * itself would never find anything.
 */
import { CONTENT, MCU_CONTENT, UNIVERSE_CONTENT, XMEN_CONTENT } from "../catalogue";
import type { ContentItem, Universe } from "../catalogue/types";
import { isOutstanding, isWatchedComplete, lockReason, type ViewingIndex } from "./state";

export type Milestone = {
  /** Stable key: `phase:<name>`, `universe:<id>` or `doomsday`. */
  id: string;
  kind: "phase" | "universe" | "doomsday";
  title: string;
  detail: string;
};

/**
 * Titles that were locked before the action and can be watched now, in catalogue order.
 * A title the action itself watched or skipped is left out (there is nothing left to watch), and
 * so is a title whose release date is still ahead or whose episode list is not published yet:
 * neither is "ready to watch".
 */
export function newlyUnlocked(before: ViewingIndex, after: ViewingIndex, now: Date | number): ContentItem[] {
  return CONTENT.filter(
    (item) => isOutstanding(item, after) && lockReason(item, after, now) === null && lockReason(item, before, now) !== null,
  );
}

const UNIVERSE_LABEL: Record<Universe, string> = { mcu: "MCU", xmen: "X-Men", street: "Street-Level Saga" };
const UNIVERSES: Universe[] = ["mcu", "xmen", "street"];

/** The required MCU titles of each phase, in release order. */
const MCU_PHASES: { phase: string; items: ContentItem[] }[] = [];
for (const item of MCU_CONTENT) {
  if (!item.required) continue;
  const group = MCU_PHASES.find((candidate) => candidate.phase === item.phase);
  if (group) group.items.push(item);
  else MCU_PHASES.push({ phase: item.phase, items: [item] });
}

const DOOMSDAY_ITEMS = [...MCU_CONTENT, ...XMEN_CONTENT].filter((item) => item.required);

/**
 * The completions the action reached, in this order: MCU phases, universes, Doomsday readiness.
 * "Complete" means every required title is fully watched; a skip does not count, as before.
 * Completions only ever go from false to true here, so removing progress reports nothing.
 */
export function milestonesReached(before: ViewingIndex, after: ViewingIndex): Milestone[] {
  const justCompleted = (items: readonly ContentItem[]) =>
    items.length > 0 && items.every((item) => isWatchedComplete(item, after)) && !items.every((item) => isWatchedComplete(item, before));

  const milestones: Milestone[] = [];
  for (const { phase, items } of MCU_PHASES) {
    if (justCompleted(items)) {
      milestones.push({ id: `phase:${phase}`, kind: "phase", title: `${phase} complete`, detail: "Every required entry in this phase is watched." });
    }
  }
  for (const universe of UNIVERSES) {
    if (justCompleted(UNIVERSE_CONTENT[universe].filter((item) => item.required))) {
      milestones.push({
        id: `universe:${universe}`,
        kind: "universe",
        title: `${UNIVERSE_LABEL[universe]} complete`,
        detail: "Every required entry in this archive is watched.",
      });
    }
  }
  if (justCompleted(DOOMSDAY_ITEMS)) {
    milestones.push({ id: "doomsday", kind: "doomsday", title: "Doomsday protocol complete", detail: "You are ready for Avengers: Doomsday." });
  }
  return milestones;
}
