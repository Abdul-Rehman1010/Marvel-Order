/**
 * What an action revealed, for the celebration toasts (NEXT_LEVEL_PLAN.md 2.1): titles it
 * unlocked and the phase, universe and Doomsday completions it reached. Both compare the viewing
 * index from before an action with the one after it, so any action type works, bulk included.
 */
import { describe, expect, it } from "vitest";

import { MCU_CONTENT, STREET_CONTENT, XMEN_CONTENT } from "@/lib/content";
import { milestonesReached, newlyUnlocked } from "@/lib/engine/milestones";
import { applyAction, type Action } from "@/lib/engine/reducer";
import { EMPTY_STATE, indexOf, type ViewingState } from "@/lib/engine/state";

import { NOW, apply, requiredThrough, watchedState } from "../helpers/viewing";

/** The before and after indexes of one action that must succeed. */
function step(state: ViewingState, action: Action, now: Date = NOW) {
  const outcome = apply(state, action, now);
  return { before: indexOf(state), after: indexOf(outcome.state) };
}

const ids = (items: { id: string }[]) => items.map((item) => item.id);
const titles = (milestones: { title: string }[]) => milestones.map((milestone) => milestone.title);

const PHASE_ONE = requiredThrough(MCU_CONTENT, "avengers");
const PHASE_TWO = requiredThrough(MCU_CONTENT, "ant-man").filter((id) => !PHASE_ONE.includes(id));
const REQUIRED_MCU = MCU_CONTENT.filter((item) => item.required).map((item) => item.id);
const REQUIRED_XMEN = XMEN_CONTENT.filter((item) => item.required).map((item) => item.id);
const REQUIRED_STREET = STREET_CONTENT.filter((item) => item.required).map((item) => item.id);

describe("newlyUnlocked", () => {
  it("names the title a watch unlocks", () => {
    const { before, after } = step(EMPTY_STATE, { type: "watch", contentId: "iron-man", episode: -1 });
    expect(ids(newlyUnlocked(before, after, NOW))).toEqual(["incredible-hulk"]);
  });

  it("is empty when nothing new opens", () => {
    // Moon Knight needs nothing, so watching an episode of it unlocks nothing else.
    const { before, after } = step(EMPTY_STATE, { type: "watch", contentId: "moon-knight", episode: 1 });
    expect(newlyUnlocked(before, after, NOW)).toEqual([]);
  });

  it("leaves out titles the action itself watched or skipped", () => {
    const bulk = step(EMPTY_STATE, { type: "bulk", watch: ["iron-man", "incredible-hulk"], skip: [], backfilled: true });
    expect(ids(newlyUnlocked(bulk.before, bulk.after, NOW))).toEqual(["iron-man-2"]);

    const skip = step(watchedState(["iron-man"]), { type: "skip", contentId: "incredible-hulk" });
    expect(ids(newlyUnlocked(skip.before, skip.after, NOW))).toEqual(["iron-man-2"]);
  });

  it("lists every title a skip unlocks, in catalogue order", () => {
    // Skipping Daredevil Season 1 unlocks Season 2 only; The Defenders also needs four other shows.
    const { before, after } = step(EMPTY_STATE, { type: "skip", contentId: "defenders-daredevil-1" });
    expect(ids(newlyUnlocked(before, after, NOW))).toEqual(["defenders-daredevil-2"]);
  });

  it("never calls a series with an unpublished episode list ready to watch", () => {
    // Your Friendly Neighborhood Spider-Man S2 follows VisionQuest but has no episode list yet.
    const start = watchedState([...requiredThrough(MCU_CONTENT, "brand-new-day"), "xmen-2000", ["visionquest", [1, 2, 3, 4, 5, 6, 7]]]);
    const { before, after } = step(start, { type: "watch", contentId: "visionquest", episode: 8 });
    expect(newlyUnlocked(before, after, NOW)).toEqual([]);
  });

  it("does not announce a title whose release date is still ahead", () => {
    const early = new Date("2026-10-01T12:00:00Z"); // VisionQuest releases on 14 October 2026
    // The Fantastic Four opens the optional shows after it and Brand New Day, all released by then.
    const start = watchedState([...requiredThrough(MCU_CONTENT, "thunderbolts"), "xmen-2000"]);
    const { before, after } = step(start, { type: "watch", contentId: "fantastic-four-first-steps", episode: -1 }, early);
    expect(ids(newlyUnlocked(before, after, early))).toEqual(["eyes-of-wakanda", "marvel-zombies", "wonder-man", "brand-new-day"]);
    // Brand New Day is the last title before VisionQuest, which is not out yet.
    const last = step(watchedState([...requiredThrough(MCU_CONTENT, "fantastic-four-first-steps"), "xmen-2000"]), { type: "watch", contentId: "brand-new-day", episode: -1 }, early);
    expect(newlyUnlocked(last.before, last.after, early)).toEqual([]);
  });

  it("is empty for an un-watch", () => {
    const { before, after } = step(watchedState(["iron-man", "incredible-hulk"]), { type: "unwatch", contentId: "iron-man", episode: -1 });
    expect(newlyUnlocked(before, after, NOW)).toEqual([]);
  });
});

describe("milestonesReached", () => {
  it("reports a phase completed by its last required title, with the same words as before", () => {
    const { before, after } = step(watchedState(PHASE_ONE.slice(0, -1)), { type: "watch", contentId: "avengers", episode: -1 });
    expect(milestonesReached(before, after)).toEqual([
      { id: "phase:Phase One", kind: "phase", title: "Phase One complete", detail: "Every required entry in this phase is watched." },
    ]);
  });

  it("reports nothing for a watch that completes nothing", () => {
    const { before, after } = step(EMPTY_STATE, { type: "watch", contentId: "iron-man", episode: -1 });
    expect(milestonesReached(before, after)).toEqual([]);
  });

  it("reports every milestone a bulk action reaches, phases first", () => {
    const { before, after } = step(EMPTY_STATE, { type: "bulk", watch: [...PHASE_ONE, ...PHASE_TWO], skip: [], backfilled: true });
    expect(titles(milestonesReached(before, after))).toEqual(["Phase One complete", "Phase Two complete"]);
  });

  it("reports a universe, and Doomsday once MCU and X-Men are both done", () => {
    const xmen = step(watchedState(REQUIRED_XMEN.slice(0, -1)), { type: "watch", contentId: "deadpool-wolverine", episode: -1 });
    expect(milestonesReached(xmen.before, xmen.after)).toEqual([
      { id: "universe:xmen", kind: "universe", title: "X-Men complete", detail: "Every required entry in this archive is watched." },
    ]);

    const doomsday = step(watchedState([...REQUIRED_MCU, ...REQUIRED_XMEN.slice(0, -1)]), { type: "watch", contentId: "deadpool-wolverine", episode: -1 });
    expect(milestonesReached(doomsday.before, doomsday.after)).toEqual([
      { id: "universe:xmen", kind: "universe", title: "X-Men complete", detail: "Every required entry in this archive is watched." },
      { id: "doomsday", kind: "doomsday", title: "Doomsday protocol complete", detail: "You are ready for Avengers: Doomsday." },
    ]);
  });

  it("reports the Street-Level saga by its own name", () => {
    const last = REQUIRED_STREET.at(-1)!;
    const { before, after } = step(watchedState([...REQUIRED_MCU.slice(0, REQUIRED_MCU.indexOf("endgame") + 1), ...REQUIRED_STREET.slice(0, -1)]), {
      type: "watch",
      contentId: last,
      episode: -1,
    });
    expect(titles(milestonesReached(before, after))).toEqual(["Street-Level Saga complete"]);
  });

  it("counts watched titles only: a skip completes no milestone", () => {
    const { before, after } = step(watchedState(PHASE_ONE.slice(0, -1)), { type: "skip", contentId: "avengers" });
    expect(milestonesReached(before, after)).toEqual([]);
  });

  it("reports nothing when progress is removed", () => {
    const outcome = applyAction(watchedState(PHASE_ONE), { type: "unwatch", contentId: "avengers", episode: -1 }, NOW);
    if (!outcome.ok) throw new Error(outcome.message);
    expect(milestonesReached(indexOf(watchedState(PHASE_ONE)), indexOf(outcome.state))).toEqual([]);
  });
});
