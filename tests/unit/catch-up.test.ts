/**
 * The catch-up wizard's selection rules (package 2.3, src/lib/client/catch-up.ts): what a pick
 * covers, how the selection is closed over prerequisites across universes, what "Haven't seen
 * this" does, and that every action the wizard can build is one the rules accept.
 */
import { describe, expect, it } from "vitest";

import { CONTENT, MCU_CONTENT, STREET_CONTENT, XMEN_CONTENT } from "@/lib/catalogue";
import {
  EMPTY_CATCH_UP,
  catchUpSummary,
  closeOverPrerequisites,
  isSelectable,
  lastReleasedRequired,
  optionalBefore,
  planCatchUp,
  selectableTitles,
  streetChoices,
  titlesThrough,
  type CatchUpDraft,
} from "@/lib/client/catch-up";
import { ancestors } from "@/lib/engine/graph";
import { applyAction } from "@/lib/engine/reducer";
import { EMPTY_STATE, indexOf, isSatisfied, isWatchedComplete, outOfOrderTitles, type ViewingState } from "@/lib/engine/state";

import { NOW, apply, item, requiredThrough, watchedState } from "../helpers/viewing";

const draft = (change: Partial<CatchUpDraft>): CatchUpDraft => ({ ...EMPTY_CATCH_UP, ...change });
const THROUGH_ENDGAME = requiredThrough(MCU_CONTENT, "endgame");

describe("what a pick covers", () => {
  it("is every required title up to the pick, and the pick itself", () => {
    expect(THROUGH_ENDGAME).toHaveLength(22);
    expect(titlesThrough("mcu", "endgame", NOW)).toEqual(THROUGH_ENDGAME);
    // An optional pick is included; the optional titles before it are not.
    expect(titlesThrough("mcu", "eternals", NOW).at(-1)).toBe("eternals");
    expect(titlesThrough("mcu", "eternals", NOW)).not.toContain("what-if-1");
    expect(titlesThrough("mcu", null, NOW)).toEqual([]);
    expect(titlesThrough("mcu", "no-such-title", NOW)).toEqual([]);
  });

  it("lists the optional titles released before the pick, for Review to show un-ticked", () => {
    expect(optionalBefore("mcu", "multiverse-of-madness", NOW)).toEqual(["what-if-1", "eternals", "moon-knight"]);
    expect(optionalBefore("xmen", "deadpool-wolverine", NOW)).toEqual(["apocalypse", "dark-phoenix", "new-mutants"]);
    expect(optionalBefore("mcu", "endgame", NOW)).toEqual([]);
  });

  it("never offers an unreleased title or a series whose episode list is unpublished", () => {
    expect(isSelectable(item("friendly-spider-man-2"), NOW)).toBe(false);
    const before = new Date("2026-10-01T00:00:00Z"); // VisionQuest is two weeks away
    expect(isSelectable(item("visionquest"), before)).toBe(false);
    expect(selectableTitles("mcu", before).map((title) => title.id)).not.toContain("visionquest");
    expect(lastReleasedRequired("mcu", NOW)).toBe("visionquest");
    expect(lastReleasedRequired("mcu", before)).not.toBe("visionquest");
    expect(lastReleasedRequired("xmen", NOW)).toBe("deadpool-wolverine");
  });
});

describe("closing the selection over prerequisites", () => {
  it("an MCU pick from Multiverse of Madness on adds X-Men (2000), and says which pick needed it", () => {
    const { ids, neededBy } = closeOverPrerequisites(titlesThrough("mcu", "multiverse-of-madness", NOW));
    expect(ids).toContain("xmen-2000");
    expect(neededBy.get("xmen-2000")).toBe("multiverse-of-madness");
    // Nothing else from the X-Men films is needed.
    expect(ids.filter((id) => item(id).universe === "xmen")).toEqual(["xmen-2000"]);
  });

  it("Hawkeye adds everything through Endgame", () => {
    const { ids, neededBy } = closeOverPrerequisites(["hawkeye"]);
    expect(ids.filter((id) => item(id).universe === "mcu")).toEqual(THROUGH_ENDGAME);
    expect(neededBy.get("endgame")).toBe("hawkeye");
    expect(neededBy.get("iron-man")).toBe("hawkeye");
  });

  it("the Street-Level step ticks what a ticked season needs and notes what it adds from the MCU", () => {
    const choices = streetChoices(draft({ streetPicks: ["defenders-the-defenders", "hawkeye"] }), NOW);
    const defendersNeeds = ancestors("defenders-the-defenders");
    expect(defendersNeeds.length).toBeGreaterThan(0);
    for (const id of defendersNeeds) {
      expect(choices.checked.has(id)).toBe(true);
      expect(choices.neededBy.get(id)).toBe("defenders-the-defenders");
    }
    expect(choices.crossFor.get("hawkeye")?.at(-1)?.id).toBe("endgame");
    // With the MCU already picked through Endgame, Hawkeye adds nothing new from it.
    expect(streetChoices(draft({ mcuPoint: "endgame", streetPicks: ["hawkeye"] }), NOW).crossFor.has("hawkeye")).toBe(false);
  });
});

describe("the plan", () => {
  it("Through Endgame on a new account: 22 films marked, nothing skipped, one backfilled bulk", () => {
    const plan = planCatchUp(draft({ mcuPoint: "endgame" }), EMPTY_STATE, NOW);
    expect(plan.watch).toEqual(THROUGH_ENDGAME);
    expect(plan.skip).toEqual([]);
    expect([plan.movies, plan.specials, plan.episodes]).toEqual([22, 0, 0]);
    expect(plan.action).toEqual({ type: "bulk", watch: THROUGH_ENDGAME, skip: [], backfilled: true });
    expect(catchUpSummary(plan)).toMatch(/^Will mark 22 movies \(\d+h \d{2}m\) as watched\.$/);
    expect(catchUpSummary(planCatchUp(EMPTY_CATCH_UP, EMPTY_STATE, NOW))).toBe("Nothing to mark yet.");
    expect(planCatchUp(EMPTY_CATCH_UP, EMPTY_STATE, NOW).action).toBeNull();
  });

  it("'Haven't seen this' skips a required title (later titles stay unlocked) and leaves an optional one out", () => {
    const base = draft({ mcuPoint: "multiverse-of-madness" });
    const plan = planCatchUp({ ...base, seen: { "iron-man": false, "xmen-2000": false, "eternals": true } }, EMPTY_STATE, NOW);
    expect([...plan.skip].sort()).toEqual(["iron-man", "xmen-2000"]);
    expect(plan.watch).toContain("incredible-hulk");
    expect(plan.watch).toContain("multiverse-of-madness");
    expect(plan.watch).toContain("eternals");
    expect(plan.watch).not.toContain("what-if-1"); // optional and not ticked: left out, not skipped
    expect(plan.rows.find((row) => row.item.id === "xmen-2000")?.neededBy?.id).toBe("multiverse-of-madness");
    expect(catchUpSummary(plan)).toMatch(/as watched, and skip 2 titles\.$/);

    const outcome = applyAction(EMPTY_STATE, plan.action!, NOW);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const index = indexOf(outcome.state);
    expect(isSatisfied(item("iron-man"), index) && !isWatchedComplete(item("iron-man"), index)).toBe(true);
    expect(isWatchedComplete(item("multiverse-of-madness"), index)).toBe(true);
    expect(outcome.state.rows.every((row) => row.backfilled)).toBe(true);
  });

  it("counts the episodes still to watch of a partly watched series, and leaves watched titles as they are", () => {
    const state = watchedState(["iron-man", ["defenders-daredevil-1", [1, 2, 3]]]);
    const plan = planCatchUp(draft({ mcuPoint: "thor", streetPicks: ["defenders-daredevil-1"] }), state, NOW);
    expect(plan.alreadyWatched).toBe(1);
    expect(plan.watch).toEqual(["incredible-hulk", "iron-man-2", "thor", "defenders-daredevil-1"]);
    expect(plan.episodes).toBe(10);
    expect(plan.rows.find((row) => row.item.id === "defenders-daredevil-1")?.units).toBe(10);
  });

  it("a title that is skipped already stays skipped unless the user says they saw it", () => {
    const state = apply(watchedState(["iron-man"]), { type: "skip", contentId: "incredible-hulk" }).state;
    const plan = planCatchUp(draft({ mcuPoint: "thor" }), state, NOW);
    expect(plan.rows.find((row) => row.item.id === "incredible-hulk")).toMatchObject({ seen: false, alreadySkipped: true });
    expect(plan.skip).toEqual(["incredible-hulk"]);
    expect(planCatchUp(draft({ mcuPoint: "thor", seen: { "incredible-hulk": true } }), state, NOW).watch).toContain("incredible-hulk");
  });

  it("a title added after a refusal ('Add {title}') is included with its own prerequisites", () => {
    const plan = planCatchUp(draft({ extra: ["xmen-2000"] }), EMPTY_STATE, NOW);
    expect(plan.watch).toEqual(["xmen-2000"]);
  });

  it("every action the wizard can build is accepted by the rules, from an empty or a partly watched account", () => {
    const mcuPoints = [null, ...selectableTitles("mcu", NOW).map((title) => title.id)];
    const xmenPoints = [null, ...selectableTitles("xmen", NOW).map((title) => title.id)];
    const streetPicks = [[], ["hawkeye"], ["echo", "defenders-punisher-2"], STREET_CONTENT.map((title) => title.id)];
    const starts: ViewingState[] = [EMPTY_STATE, apply(watchedState(["iron-man", "xmen-2000"]), { type: "skip", contentId: "thor" }).state];
    let checked = 0;
    for (const start of starts) {
      for (const [position, mcuPoint] of mcuPoints.entries()) {
        const xmenPoint = xmenPoints[position % xmenPoints.length];
        const picks = streetPicks[position % streetPicks.length];
        // Every third title the user "has not seen": required ones become skips.
        const seen = Object.fromEntries(CONTENT.filter((_, index) => index % 3 === position % 3).map((title) => [title.id, false]));
        for (const candidate of [draft({ mcuPoint, xmenPoint, streetPicks: picks }), draft({ mcuPoint, xmenPoint, streetPicks: picks, seen })]) {
          const plan = planCatchUp(candidate, start, NOW);
          if (!plan.action) continue;
          const outcome = applyAction(start, plan.action, NOW);
          expect(outcome.ok, `${mcuPoint} / ${xmenPoint} / ${picks.join(",")}: ${outcome.ok ? "" : outcome.message}`).toBe(true);
          if (outcome.ok) expect(outOfOrderTitles(outcome.state)).toEqual([]);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(150);
  });

  it("every X-Men and MCU pick is reachable from the lists the wizard shows", () => {
    for (const title of [...MCU_CONTENT, ...XMEN_CONTENT]) {
      if (!isSelectable(title, NOW)) continue;
      expect(titlesThrough(title.universe, title.id, NOW).at(-1)).toBe(title.id);
    }
  });
});
