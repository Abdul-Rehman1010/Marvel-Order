/**
 * The rules engine: state.ts, reducer.ts, release.ts, format.ts and stats.ts
 * (NEXT_LEVEL_PLAN.md §4.4; the cases are the §4.7 matrix rows for Watch, Unwatch, Skip, Bulk,
 * Stats and Unrecognised rows). Random-sequence properties are in engine-properties.test.ts.
 *
 * "Full account" means every unit of every title that can be watched.
 */
import { describe, expect, it } from "vitest";

import { CONTENT, MCU_CONTENT, STREET_CONTENT, XMEN_CONTENT } from "@/lib/content";
import { formatDuration, formatLockReason, formatRuntimeOf } from "@/lib/engine/format";
import { dependents } from "@/lib/engine/graph";
import { applyAction, type Action } from "@/lib/engine/reducer";
import { formatReleaseDate, isReleased, releaseMoment } from "@/lib/engine/release";
import {
  EMPTY_STATE,
  indexOf,
  isOutstanding,
  isSatisfied,
  isWatchedComplete,
  lockReason,
  missingPrerequisite,
  outOfOrderTitles,
  unrecognisedIds,
  type ViewingState,
} from "@/lib/engine/state";
import { getStats } from "@/lib/engine/stats";

import {
  EARLIER,
  NOW,
  WATCHABLE_IDS,
  apply,
  fullAccount,
  item,
  keysOf,
  refuse,
  requiredThrough,
  rowsFor,
  skippedIds,
  titlesWithRows,
  watchedState,
} from "../helpers/viewing";

const watch = (contentId: string, episode = -1): Action => ({ type: "watch", contentId, episode });
const unwatch = (contentId: string, episode = -1): Action => ({ type: "unwatch", contentId, episode });
const skip = (contentId: string): Action => ({ type: "skip", contentId });
const unskip = (contentId: string): Action => ({ type: "unskip", contentId });

const lockOf = (state: ViewingState, id: string, now: Date = NOW) => lockReason(item(id), indexOf(state), now);
const rowsOf = (state: ViewingState, id: string) => state.rows.filter((row) => row.contentId === id).map((row) => row.episode);

/** The 23 Infinity Saga films: every required MCU title up to Far From Home. */
const SAGA_FILMS = requiredThrough(MCU_CONTENT, "far-from-home");

describe("watch", () => {
  it("an unlocked movie gets exactly one row, stamped with the action's time", () => {
    const outcome = apply(EMPTY_STATE, watch("iron-man"));
    expect(outcome.state.rows).toEqual([{ contentId: "iron-man", episode: -1, watchedAt: NOW.toISOString(), backfilled: false }]);
    expect(outcome.addedRows).toEqual(outcome.state.rows);
    expect(outcome.removedKeys).toEqual([]);
  });

  it("a locked title is refused and names the prerequisite to watch", () => {
    const failure = refuse(EMPTY_STATE, watch("incredible-hulk"));
    expect(failure).toMatchObject({ code: "locked", contentId: "incredible-hulk", missingId: "iron-man" });
    expect(failure.message).toBe("Watch Iron Man first to unlock The Incredible Hulk.");
  });

  it("episodes go in order: episode 3 needs episode 2", () => {
    const state = watchedState([...SAGA_FILMS, ["wandavision", [1]]]);
    expect(lockOf(state, "wandavision")).toBeNull();
    expect(refuse(state, watch("wandavision", 3))).toMatchObject({ code: "episode-order", contentId: "wandavision" });
    expect(apply(state, watch("wandavision", 2)).addedRows).toHaveLength(1);
  });

  it("a unit the title does not have is refused and changes nothing", () => {
    const state = watchedState(SAGA_FILMS);
    for (const action of [watch("iron-man", 1), watch("wandavision", -1), watch("wandavision", 10), watch("wandavision", 0)]) {
      expect(refuse(state, action).code, JSON.stringify(action)).toBe("unknown-episode");
    }
    expect(refuse(state, watch("not-a-title")).code).toBe("unknown-title");
  });

  it("watching a unit again is a successful no-op that keeps the original timestamp and flag", () => {
    const state: ViewingState = { rows: rowsFor("iron-man", undefined, EARLIER, true), skips: [] };
    const outcome = apply(state, watch("iron-man"));
    expect(outcome.addedRows).toEqual([]);
    expect(outcome.state.rows).toEqual([{ contentId: "iron-man", episode: -1, watchedAt: EARLIER, backfilled: true }]);
  });

  it("a release lock opens at 00:00 UTC on the release date, to the millisecond", () => {
    const state = watchedState(WATCHABLE_IDS.filter((id) => id !== "visionquest"));
    const release = releaseMoment(item("visionquest"));
    expect(new Date(release).toISOString()).toBe("2026-10-14T00:00:00.000Z");

    const early = refuse(state, watch("visionquest", 1), new Date(release - 1));
    expect(early).toMatchObject({ code: "unreleased", contentId: "visionquest" });
    expect(early.message).toBe("VisionQuest is not out until October 14, 2026.");
    expect(apply(state, watch("visionquest", 1), new Date(release)).addedRows).toHaveLength(1);
  });

  it("a series whose episode list is not published cannot be ticked", () => {
    const state = fullAccount();
    expect(missingPrerequisite(item("friendly-spider-man-2"), indexOf(state))).toBeNull();
    expect(lockOf(state, "friendly-spider-man-2")).toEqual({ kind: "pending" });
    expect(refuse(state, watch("friendly-spider-man-2", 1)).code).toBe("pending");
    expect(refuse(state, { type: "watchAll", contentId: "friendly-spider-man-2" }).code).toBe("pending");
  });

  it("Multiverse of Madness also needs X-Men (2000): watched or skipped both open it", () => {
    const earlierMcu = requiredThrough(MCU_CONTENT, "no-way-home");
    const state = watchedState(earlierMcu);
    expect(refuse(state, watch("multiverse-of-madness"))).toMatchObject({ code: "locked", missingId: "xmen-2000" });

    expect(apply(apply(state, watch("xmen-2000")).state, watch("multiverse-of-madness")).addedRows).toHaveLength(1);
    expect(apply(apply(state, skip("xmen-2000")).state, watch("multiverse-of-madness")).addedRows).toHaveLength(1);
  });

  it("a skipped prerequisite counts: Endgame skipped opens Hawkeye, once the films before Endgame are done", () => {
    const beforeEndgame = requiredThrough(MCU_CONTENT, "captain-marvel");
    const skipped = apply(watchedState(beforeEndgame), skip("endgame")).state;
    expect(apply(skipped, watch("hawkeye", 1)).addedRows).toHaveLength(1);

    // Skipping Endgame alone is not enough: locks look at every transitive prerequisite.
    const onlyEndgame = apply(EMPTY_STATE, skip("endgame")).state;
    expect(refuse(onlyEndgame, watch("hawkeye", 1))).toMatchObject({ code: "locked", missingId: "iron-man" });
  });

  it("watchAll marks every remaining unit and leaves the ones already watched alone", () => {
    const state = watchedState([...SAGA_FILMS, ["wandavision", [1, 2]]]);
    const outcome = apply(state, { type: "watchAll", contentId: "wandavision" });
    expect(outcome.addedRows.map((row) => row.episode)).toEqual([3, 4, 5, 6, 7, 8, 9]);
    expect(outcome.state.rows.filter((row) => row.contentId === "wandavision" && row.watchedAt === EARLIER)).toHaveLength(2);
    expect(apply(outcome.state, { type: "watchAll", contentId: "wandavision" }).addedRows).toEqual([]);
  });
});

describe("unwatch", () => {
  it("full account, un-watch Iron Man: Moon Knight stays; every later MCU title, Hawkeye and Echo are cleared", () => {
    const outcome = apply(fullAccount(), unwatch("iron-man"));
    const left = new Set(titlesWithRows(outcome.state));

    expect(left.has("iron-man")).toBe(false);
    expect(left.has("moon-knight")).toBe(true);
    expect(rowsOf(outcome.state, "moon-knight")).toHaveLength(6);
    expect(MCU_CONTENT.filter((candidate) => left.has(candidate.id)).map((candidate) => candidate.id)).toEqual(["moon-knight"]);
    expect(left.has("hawkeye") || left.has("echo")).toBe(false);
    // Nothing that does not depend on Iron Man is touched.
    for (const candidate of XMEN_CONTENT) expect(left.has(candidate.id), candidate.id).toBe(true);
    for (const candidate of STREET_CONTENT.filter((entry) => !["hawkeye", "echo"].includes(entry.id))) {
      expect(left.has(candidate.id), candidate.id).toBe(true);
    }
    // `cleared` lists exactly the dependents that had rows (the unpublished series had none).
    expect(outcome.cleared).toEqual(dependents("iron-man").filter((id) => id !== "friendly-spider-man-2"));
    expect(outOfOrderTitles(outcome.state)).toEqual([]);
  });

  it("Daredevil S1 complete with S2 episodes 1-2: un-watching S1 episode 13 removes the S2 rows", () => {
    const state = watchedState(["defenders-daredevil-1", ["defenders-daredevil-2", [1, 2]]]);
    const outcome = apply(state, unwatch("defenders-daredevil-1", 13));
    expect(rowsOf(outcome.state, "defenders-daredevil-1")).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(rowsOf(outcome.state, "defenders-daredevil-2")).toEqual([]);
    expect(outcome.cleared).toEqual(["defenders-daredevil-2"]);
  });

  it("un-watching episode 3 of a finished series removes episodes 3-9 and everything that depends on it", () => {
    const state = watchedState([...requiredThrough(MCU_CONTENT, "loki-1"), "moon-knight"]);
    const outcome = apply(state, unwatch("wandavision", 3));
    expect(rowsOf(outcome.state, "wandavision")).toEqual([1, 2]);
    expect(outcome.cleared).toEqual(["falcon-winter-soldier", "loki-1"]);
    expect(rowsOf(outcome.state, "moon-knight")).toHaveLength(6);
    expect(titlesWithRows(outcome.state)).toEqual([...SAGA_FILMS, "wandavision", "moon-knight"]);
  });

  it("un-watching the last watched episode of an unfinished series removes one row and nothing else", () => {
    const state = watchedState([...SAGA_FILMS, ["wandavision", [1, 2, 3]]]);
    const outcome = apply(state, unwatch("wandavision", 3));
    expect(outcome.removedKeys).toEqual(["wandavision:3"]);
    expect(outcome.cleared).toEqual([]);
    expect(outcome.state.rows).toHaveLength(state.rows.length - 1);
  });

  it("a unit the title does not have is refused: zero rows removed", () => {
    const state = fullAccount();
    for (const action of [unwatch("iron-man", 99), unwatch("iron-man", 1), unwatch("wandavision", -1), unwatch("wandavision", 10)]) {
      expect(refuse(state, action).code, JSON.stringify(action)).toBe("unknown-episode");
    }
  });

  it("un-watching a row that is not there is a successful no-op with no cascade", () => {
    const state = watchedState(["incredible-hulk", "iron-man-2"]); // out of order: Iron Man is missing
    const outcome = apply(state, unwatch("iron-man"));
    expect(outcome.removedKeys).toEqual([]);
    expect(outcome.cleared).toEqual([]);
    expect(keysOf(outcome.state)).toEqual(keysOf(state));
  });

  it("full account, un-watch Endgame: Hawkeye and Echo go, the Defenders-era shows stay", () => {
    const outcome = apply(fullAccount(), unwatch("endgame"));
    const left = new Set(titlesWithRows(outcome.state));
    expect(outcome.cleared).toContain("hawkeye");
    expect(outcome.cleared).toContain("echo");
    const defendersEra = STREET_CONTENT.filter((candidate) => !["hawkeye", "echo"].includes(candidate.id));
    for (const candidate of defendersEra) expect(left.has(candidate.id), candidate.id).toBe(true);
    expect(outcome.cleared).toHaveLength(dependents("endgame").length - 1); // all but the unpublished series
  });

  it("full account, un-watch X-Men (2000): the 13 later X-Men films and the MCU from Multiverse of Madness on", () => {
    const outcome = apply(fullAccount(), unwatch("xmen-2000"));
    const left = new Set(titlesWithRows(outcome.state));
    const cleared = outcome.cleared.map((id) => item(id).universe);

    expect(cleared.filter((universe) => universe === "xmen")).toHaveLength(13);
    // 28 MCU titles depend on it; 27 had rows (the unpublished series cannot be watched).
    expect(dependents("xmen-2000").filter((id) => item(id).universe === "mcu")).toHaveLength(28);
    expect(cleared.filter((universe) => universe === "mcu")).toHaveLength(27);
    expect(cleared.filter((universe) => universe === "street")).toHaveLength(0);
    for (const id of ["endgame", "hawkeye", "moon-knight", "no-way-home"]) expect(left.has(id), id).toBe(true);
    expect(left.has("multiverse-of-madness")).toBe(false);
  });

  it("an optional title has no dependents, so un-watching it clears nothing else", () => {
    const state = fullAccount();
    const outcome = apply(state, unwatch("she-hulk", 9));
    expect(outcome.removedKeys).toEqual(["she-hulk:9"]);
    expect(outcome.cleared).toEqual([]);
  });

  it("a skipped title stays satisfied: un-watching one of its episodes does not cascade", () => {
    const base = watchedState([...SAGA_FILMS, ["wandavision", [1, 2, 3]]]);
    const skipped = apply(base, skip("wandavision")).state;
    const withLater = apply(skipped, { type: "watchAll", contentId: "falcon-winter-soldier" }).state;

    const outcome = apply(withLater, unwatch("wandavision", 2));
    expect(rowsOf(outcome.state, "wandavision")).toEqual([1]);
    expect(outcome.cleared).toEqual([]);
    expect(rowsOf(outcome.state, "falcon-winter-soldier")).toHaveLength(6);
    expect(skippedIds(outcome.state)).toEqual(["wandavision"]);
  });

  it("an out-of-order (locked) title can always be un-watched, and it is reported until then", () => {
    // What the old un-watch bug left behind: Daredevil S2 rows while S1 is unfinished.
    const state = watchedState([["defenders-daredevil-1", [1, 2, 3]], ["defenders-daredevil-2", [1, 2]]]);
    expect(outOfOrderTitles(state)).toEqual(["defenders-daredevil-2"]);
    expect(lockOf(state, "defenders-daredevil-2")).toMatchObject({ kind: "prerequisite" });

    const outcome = apply(state, unwatch("defenders-daredevil-2", 1));
    expect(rowsOf(outcome.state, "defenders-daredevil-2")).toEqual([]);
    expect(outOfOrderTitles(outcome.state)).toEqual([]);
  });

  it("out-of-order rows are not wiped by an unrelated un-watch of a title that was already unfinished", () => {
    const state = watchedState([["defenders-daredevil-1", [1, 2, 3]], ["defenders-daredevil-2", [1, 2]]]);
    const outcome = apply(state, unwatch("defenders-daredevil-1", 3));
    expect(outcome.cleared).toEqual([]);
    expect(rowsOf(outcome.state, "defenders-daredevil-2")).toEqual([1, 2]);
  });
});

describe("skip and unskip", () => {
  it("a skip has no precondition and does not hide an earlier unfinished title", () => {
    const outcome = apply(EMPTY_STATE, skip("incredible-hulk"));
    expect(outcome.addedSkips).toEqual([{ contentId: "incredible-hulk", reason: "manual", skippedAt: NOW.toISOString() }]);
    expect(lockOf(outcome.state, "iron-man-2")).toMatchObject({ kind: "prerequisite", item: { id: "iron-man" } });
  });

  it("skipping Daredevil S2 does not open The Punisher S1 while Daredevil S1 is unfinished", () => {
    const state = apply(watchedState([["defenders-daredevil-1", [1, 2, 3, 4, 5]]]), skip("defenders-daredevil-2")).state;
    expect(refuse(state, watch("defenders-punisher-1", 1))).toMatchObject({ code: "locked", missingId: "defenders-daredevil-1" });
  });

  it("a partly watched title can be skipped: rows kept, satisfied, the next title opens", () => {
    const base = watchedState([...SAGA_FILMS, ["wandavision", [1, 2, 3]]]);
    expect(lockOf(base, "falcon-winter-soldier")).toMatchObject({ kind: "prerequisite", item: { id: "wandavision" } });

    const state = apply(base, skip("wandavision")).state;
    expect(rowsOf(state, "wandavision")).toEqual([1, 2, 3]);
    expect(isSatisfied(item("wandavision"), indexOf(state))).toBe(true);
    expect(isWatchedComplete(item("wandavision"), indexOf(state))).toBe(false);
    expect(isOutstanding(item("wandavision"), indexOf(state))).toBe(false);
    expect(lockOf(state, "falcon-winter-soldier")).toBeNull();
  });

  it("the skip ends by itself when the title becomes fully watched", () => {
    const base = apply(watchedState([...SAGA_FILMS, ["wandavision", [1, 2, 3]]]), skip("wandavision")).state;
    const outcome = apply(base, { type: "watchAll", contentId: "wandavision" });
    expect(outcome.removedSkips).toEqual(["wandavision"]);
    expect(outcome.state.skips).toEqual([]);

    // One episode at a time ends it on the last one only.
    let state = base;
    for (const episode of [4, 5, 6, 7, 8]) state = apply(state, watch("wandavision", episode)).state;
    expect(skippedIds(state)).toEqual(["wandavision"]);
    expect(skippedIds(apply(state, watch("wandavision", 9)).state)).toEqual([]);
  });

  it("unskip never clears anything: it is refused while later titles depend on the skip", () => {
    const state = apply(watchedState(WATCHABLE_IDS.filter((id) => id !== "iron-man-2")), skip("iron-man-2")).state;
    expect(outOfOrderTitles(state)).toEqual([]);

    const failure = refuse(state, unskip("iron-man-2"));
    expect(failure).toMatchObject({ code: "has-dependents", contentId: "iron-man-2" });
    expect(skippedIds(state)).toEqual(["iron-man-2"]);
  });

  it("unskip is allowed when nothing later was watched", () => {
    const state = apply(watchedState(["iron-man", "incredible-hulk"]), skip("iron-man-2")).state;
    const outcome = apply(state, unskip("iron-man-2"));
    expect(outcome.removedSkips).toEqual(["iron-man-2"]);
    expect(outcome.state.skips).toEqual([]);
  });

  it("an un-watch cascade removes watched rows but never a skip", () => {
    const base = watchedState(["defenders-daredevil-1"]);
    const skipped = apply(base, skip("defenders-daredevil-2")).state;
    const state = apply(skipped, watch("defenders-punisher-1", 1)).state;

    const outcome = apply(state, unwatch("defenders-daredevil-1", 13));
    expect(outcome.cleared).toEqual(["defenders-punisher-1"]);
    expect(rowsOf(outcome.state, "defenders-punisher-1")).toEqual([]);
    expect(skippedIds(outcome.state)).toEqual(["defenders-daredevil-2"]);
  });

  it("skip and unskip are idempotent", () => {
    const once = apply(EMPTY_STATE, skip("thor"));
    const twice = apply(once.state, { type: "skip", contentId: "thor", reason: "triage" }, new Date(NOW.getTime() + 1000));
    expect(twice.addedSkips).toEqual([]);
    expect(twice.state.skips).toEqual(once.state.skips);

    const removed = apply(twice.state, unskip("thor"));
    expect(apply(removed.state, unskip("thor")).removedSkips).toEqual([]);
  });

  it("skipping a fully watched title does nothing", () => {
    const outcome = apply(watchedState(["iron-man"]), skip("iron-man"));
    expect(outcome.state.skips).toEqual([]);
  });
});

describe("bulk", () => {
  const bulk = (watchIds: string[], skipIds: string[] = [], backfilled = true): Action => ({ type: "bulk", watch: watchIds, skip: skipIds, backfilled });

  it("applies the watch list in graph order, whatever order it arrives in", () => {
    const outcome = apply(EMPTY_STATE, bulk(["thor", "iron-man", "incredible-hulk", "iron-man-2"]));
    expect(outcome.addedRows.map((row) => row.contentId)).toEqual(["iron-man", "incredible-hulk", "iron-man-2", "thor"]);
    expect(outcome.addedRows.every((row) => row.backfilled && row.watchedAt === NOW.toISOString())).toBe(true);
  });

  it("fails as a whole and names the title and what it is missing", () => {
    expect(refuse(EMPTY_STATE, bulk(["endgame"]))).toMatchObject({ code: "locked", contentId: "endgame", missingId: "iron-man" });
    // The titles before the failing one are not kept either.
    expect(refuse(EMPTY_STATE, bulk(["iron-man", "thor"]))).toMatchObject({ code: "locked", contentId: "thor", missingId: "incredible-hulk" });
  });

  it("MCU Phases One to Four without X-Men (2000) stops at Multiverse of Madness", () => {
    const phasesOneToFour = MCU_CONTENT.filter((candidate) => ["Phase One", "Phase Two", "Phase Three", "Phase Four"].includes(candidate.phase)).map((candidate) => candidate.id);
    expect(refuse(EMPTY_STATE, bulk(phasesOneToFour))).toMatchObject({ code: "locked", contentId: "multiverse-of-madness", missingId: "xmen-2000" });
    const withXmen = apply(EMPTY_STATE, bulk([...phasesOneToFour, "xmen-2000"]));
    expect(titlesWithRows(withXmen.state).sort()).toEqual([...phasesOneToFour, "xmen-2000"].sort());
  });

  it("skips are applied first, so a skipped prerequisite opens the titles after it", () => {
    const outcome = apply(EMPTY_STATE, bulk(["iron-man", "iron-man-2"], ["incredible-hulk"]));
    expect(titlesWithRows(outcome.state)).toEqual(["iron-man", "iron-man-2"]);
    expect(skippedIds(outcome.state)).toEqual(["incredible-hulk"]);
  });

  it("the same id in both lists is invalid, and an unknown id is refused", () => {
    expect(refuse(EMPTY_STATE, bulk(["iron-man"], ["iron-man"]))).toMatchObject({ code: "invalid", contentId: "iron-man" });
    expect(refuse(EMPTY_STATE, bulk(["iron-man", "nope"]))).toMatchObject({ code: "unknown-title", contentId: "nope" });
  });

  it("rows that already exist keep their timestamp and flag, and replaying the bulk adds nothing", () => {
    const state: ViewingState = { rows: rowsFor("iron-man", undefined, EARLIER, false), skips: [] };
    const first = apply(state, bulk(["iron-man", "incredible-hulk"]));
    expect(first.state.rows).toEqual([
      { contentId: "iron-man", episode: -1, watchedAt: EARLIER, backfilled: false },
      { contentId: "incredible-hulk", episode: -1, watchedAt: NOW.toISOString(), backfilled: true },
    ]);
    const replay = apply(first.state, bulk(["iron-man", "incredible-hulk"]), new Date(NOW.getTime() + 60_000));
    expect(replay.addedRows).toEqual([]);
    expect(replay.state.rows).toEqual(first.state.rows);
  });

  it("can build a full account in one action", () => {
    const outcome = apply(EMPTY_STATE, bulk([...WATCHABLE_IDS].reverse()));
    expect(keysOf(outcome.state)).toEqual(keysOf(fullAccount()));
    expect(outOfOrderTitles(outcome.state)).toEqual([]);
  });
});

describe("import", () => {
  it("replays rows oldest first, keeps their timestamps and flags, and rejects only what breaks a rule", () => {
    const outcome = apply(EMPTY_STATE, {
      type: "import",
      skips: [],
      rows: [
        { contentId: "incredible-hulk", episode: -1, watchedAt: "2026-02-02T00:00:00.000Z", backfilled: true },
        { contentId: "iron-man", episode: -1, watchedAt: "2026-02-01T00:00:00.000Z", backfilled: false },
        { contentId: "thor", episode: -1, watchedAt: "2026-02-03T00:00:00.000Z", backfilled: false }, // Iron Man 2 is missing
        { contentId: "gone", episode: -1, watchedAt: "2026-02-04T00:00:00.000Z", backfilled: false },
        { contentId: "iron-man", episode: 4, watchedAt: "2026-02-05T00:00:00.000Z", backfilled: false },
      ],
    });
    expect(outcome.state.rows).toEqual([
      { contentId: "iron-man", episode: -1, watchedAt: "2026-02-01T00:00:00.000Z", backfilled: false },
      { contentId: "incredible-hulk", episode: -1, watchedAt: "2026-02-02T00:00:00.000Z", backfilled: true },
    ]);
    expect(outcome.rejected).toEqual([
      { contentId: "gone", episode: -1, reason: "unknown-title" },
      { contentId: "iron-man", episode: 4, reason: "unknown-episode" },
      { contentId: "thor", episode: -1, reason: "locked" }, // rows still waiting at the end come last
    ]);
  });

  it("does not depend on timestamps being in rule order", () => {
    // The other account skipped The Incredible Hulk, watched Iron Man 2, then went back and
    // watched the Hulk (which ended the skip). Iron Man 2 is therefore OLDER than its prerequisite.
    const theirs: ViewingState = {
      rows: [
        { contentId: "iron-man", episode: -1, watchedAt: "2026-03-01T00:00:00.000Z", backfilled: false },
        { contentId: "iron-man-2", episode: -1, watchedAt: "2026-03-02T00:00:00.000Z", backfilled: false },
        { contentId: "incredible-hulk", episode: -1, watchedAt: "2026-03-03T00:00:00.000Z", backfilled: false },
      ],
      skips: [],
    };
    expect(outOfOrderTitles(theirs)).toEqual([]);

    const merged = apply(EMPTY_STATE, { type: "import", rows: theirs.rows, skips: [] });
    expect(merged.rejected).toEqual([]);
    expect(keysOf(merged.state)).toEqual(keysOf(theirs));
    expect(merged.state.rows.find((row) => row.contentId === "iron-man-2")?.watchedAt).toBe("2026-03-02T00:00:00.000Z");
  });

  it("merging two valid states gives a valid state, and importing twice changes nothing", () => {
    const mine = watchedState(["iron-man", "incredible-hulk", "xmen-2000"]);
    const theirs = apply(watchedState(["iron-man", "incredible-hulk", "iron-man-2", "defenders-daredevil-1"]), skip("thor")).state;

    const merged = apply(mine, { type: "import", rows: theirs.rows, skips: theirs.skips });
    expect(merged.rejected).toEqual([]);
    expect(titlesWithRows(merged.state).sort()).toEqual(["defenders-daredevil-1", "incredible-hulk", "iron-man", "iron-man-2", "xmen-2000"]);
    expect(skippedIds(merged.state)).toEqual(["thor"]);
    expect(outOfOrderTitles(merged.state)).toEqual([]);

    const again = apply(merged.state, { type: "import", rows: theirs.rows, skips: theirs.skips });
    expect(again.addedRows).toEqual([]);
    expect(again.addedSkips).toEqual([]);
    expect(again.state).toEqual(merged.state);
  });
});

describe("rows the catalogue does not recognise", () => {
  const strange: ViewingState = {
    rows: [
      ...rowsFor("iron-man"),
      { contentId: "removed-title", episode: -1, watchedAt: EARLIER, backfilled: false },
      { contentId: "wandavision", episode: 99, watchedAt: EARLIER, backfilled: false },
    ],
    skips: [{ contentId: "another-removed-title", reason: "manual", skippedAt: EARLIER }],
  };

  it("are ignored by every rule and reported by id", () => {
    const index = indexOf(strange);
    expect([...index.watched]).toEqual(["iron-man:-1"]);
    expect([...index.skipped]).toEqual([]);
    expect(unrecognisedIds(strange)).toEqual(["removed-title", "wandavision", "another-removed-title"]);
    expect(outOfOrderTitles(strange)).toEqual([]);
    expect(() => getStats(CONTENT, index, { includeOptional: true })).not.toThrow();
    expect(() => CONTENT.map((candidate) => lockReason(candidate, index, NOW))).not.toThrow();
  });

  it("survive every action untouched, including an un-watch that clears their own title", () => {
    const actions: Action[] = [watch("incredible-hulk"), skip("thor"), unwatch("iron-man"), { type: "bulk", watch: ["iron-man"], skip: [], backfilled: true }];
    let state = strange;
    for (const action of actions) {
      state = apply(state, action).state;
      expect(state.rows.filter((row) => row.contentId === "removed-title" || row.episode === 99), JSON.stringify(action)).toHaveLength(2);
      expect(state.skips.some((entry) => entry.contentId === "another-removed-title")).toBe(true);
    }

    // WandaVision fully watched plus its stray episode 99: clearing WandaVision leaves the stray row.
    const withWanda: ViewingState = { rows: [...watchedState([...SAGA_FILMS, "wandavision"]).rows, strange.rows[2]], skips: [] };
    const outcome = apply(withWanda, unwatch("iron-man"));
    expect(outcome.cleared).toContain("wandavision");
    expect(outcome.state.rows).toEqual([strange.rows[2]]);
  });
});

describe("release dates", () => {
  it("a title is released from 00:00 UTC on its date, wherever the clock is read", () => {
    const visionquest = item("visionquest");
    const midnightUtc = Date.UTC(2026, 9, 14);
    expect(releaseMoment(visionquest)).toBe(midnightUtc);
    expect(isReleased(visionquest, midnightUtc - 1)).toBe(false);
    expect(isReleased(visionquest, midnightUtc)).toBe(true);
    expect(isReleased(visionquest, new Date("2026-10-13T23:59:59.999Z"))).toBe(false);
    // 19:00 on the 13th in New York is already the 14th in UTC: released.
    expect(isReleased(visionquest, new Date("2026-10-13T20:00:00-04:00"))).toBe(true);
  });

  it("the lock the client shows and the answer the reducer gives agree on both sides of UTC midnight", () => {
    const state = watchedState(WATCHABLE_IDS.filter((id) => id !== "visionquest"));
    for (const [now, released] of [[new Date("2026-10-13T23:59:59.999Z"), false], [new Date("2026-10-14T00:00:00.000Z"), true]] as const) {
      const clientLocked = lockReason(item("visionquest"), indexOf(state), now) !== null;
      const serverRefused = !applyAction(state, watch("visionquest", 1), now).ok;
      expect({ clientLocked, serverRefused }, now.toISOString()).toEqual({ clientLocked: !released, serverRefused: !released });
    }
  });

  it("dates are printed in UTC, so the label matches the lock", () => {
    expect(formatReleaseDate("2026-10-14")).toBe("October 14, 2026");
    expect(formatReleaseDate("2026-10-14", "short")).toBe("Oct 14, 2026");
    expect(formatReleaseDate("2026-01-01")).toBe("January 1, 2026");
    expect(formatLockReason(item("visionquest"), { kind: "unreleased", date: "2026-10-14" })).toBe("Scheduled transmission: releases October 14, 2026.");
  });
});

describe("formatDuration", () => {
  it("prints hours and minutes without seconds", () => {
    expect(formatDuration(124 * 3600 + 14 * 60)).toBe("124h 14m");
    expect(formatDuration(2 * 3600 + 6 * 60)).toBe("2h 06m");
    expect(formatDuration(3600)).toBe("1h 00m");
    expect(formatDuration(45 * 60)).toBe("45m");
    expect(formatDuration(59)).toBe("0m");
    expect(formatDuration(0)).toBe("0m");
  });

  it("prints TBD for an unknown value", () => {
    for (const unknown of [null, undefined, Number.NaN, -60]) expect(formatDuration(unknown)).toBe("TBD");
    expect(formatRuntimeOf(0)).toBe("TBD");
    expect(formatRuntimeOf(126 * 60)).toBe("2h 06m");
  });
});

describe("stats", () => {
  const doomsdaySet = [...MCU_CONTENT, ...XMEN_CONTENT];
  const required = doomsdaySet.filter((candidate) => candidate.required);

  it("nothing watched: 0%, everything remaining", () => {
    const stats = getStats(doomsdaySet, indexOf(EMPTY_STATE));
    expect(stats).toMatchObject({ percent: 0, ratio: 0, complete: false, watchedUnits: 0, skippedUnits: 0, watchedRuntime: 0 });
    expect(stats.totalUnits).toBe(stats.remainingUnits);
    expect(stats.totalUnits).toBe(103); // the 103 required checkpoints quoted in the plan
  });

  it("a series with an unpublished episode list adds 0 units and 0 runtime and is never complete", () => {
    const pending = item("friendly-spider-man-2");
    const everyPendingEpisode: ViewingState = { rows: rowsFor(pending.id), skips: [] };
    expect(isWatchedComplete(pending, indexOf(everyPendingEpisode))).toBe(false);

    const withPending = getStats(MCU_CONTENT, indexOf(EMPTY_STATE), { includeOptional: true });
    const without = getStats(MCU_CONTENT.filter((candidate) => candidate !== pending), indexOf(EMPTY_STATE), { includeOptional: true });
    expect({ ...withPending, pendingRuntime: false }).toEqual(without);
    expect(withPending.pendingRuntime).toBe(true);
  });

  it("every other MCU unit watched reads 100% for the MCU tab, although one series is unpublished", () => {
    const state = watchedState(WATCHABLE_IDS.filter((id) => item(id).universe === "mcu"));
    const stats = getStats(MCU_CONTENT, indexOf(state), { includeOptional: true });
    expect(stats).toMatchObject({ percent: 100, ratio: 1, complete: true, remainingUnits: 0, remainingRuntime: 0, remainingEpisodes: 0 });
    expect(stats.watchedSeries).toBe(stats.series);
  });

  it("percent stays at 99 until the last counted title is done, then reads exactly 100", () => {
    const allButLast = watchedState(required.map((candidate) => candidate.id).filter((id) => id !== "deadpool-wolverine"));
    const nearly = getStats(doomsdaySet, indexOf(allButLast));
    expect(nearly.complete).toBe(false);
    expect(nearly.percent).toBe(99);
    expect(nearly.ratio).toBeLessThan(1);

    const done = getStats(doomsdaySet, indexOf(watchedState(required.map((candidate) => candidate.id))));
    expect(done).toMatchObject({ percent: 100, ratio: 1, complete: true });
  });

  it("every required title skipped: finite numbers, and complete", () => {
    const state: ViewingState = { rows: [], skips: required.map((candidate) => ({ contentId: candidate.id, reason: "triage", skippedAt: EARLIER })) };
    const stats = getStats(doomsdaySet, indexOf(state));
    expect(stats).toMatchObject({ percent: 100, ratio: 1, complete: true, totalUnits: 0, watchedUnits: 0, remainingRuntime: 0, skippedUnits: 103 });
    expect(stats.skippedTitles).toBe(required.length);
    for (const value of Object.values(stats)) if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
  });

  it("skipping a partly watched series: its watched episodes still count once, the rest are skipped", () => {
    const before = watchedState([...SAGA_FILMS, ["wandavision", [1, 2, 3, 4, 5, 6, 7, 8]]]);
    const after = apply(before, skip("wandavision")).state;
    const a = getStats(doomsdaySet, indexOf(before));
    const b = getStats(doomsdaySet, indexOf(after));
    const finale = item("wandavision").episodes![8].runtimeSec;

    expect(b.watchedUnits).toBe(a.watchedUnits);
    expect(b.watchedRuntime).toBe(a.watchedRuntime);
    expect(b.skippedUnits).toBe(1);
    expect(b.skippedRuntime).toBe(finale);
    expect(b.skippedTitles).toBe(1);
    expect(b.remainingRuntime).toBe(a.remainingRuntime - finale); // remaining time excludes skipped units
    expect(b.totalUnits).toBe(a.totalUnits - 1);
    expect(b.ratio).toBeLessThanOrEqual(1);
    expect(b.ratio).toBeGreaterThan(a.ratio);
    // Every unit is counted exactly once.
    expect(b.watchedUnits + b.remainingUnits + b.skippedUnits).toBe(a.watchedUnits + a.remainingUnits);
    expect(b.watchedRuntime + b.remainingRuntime + b.skippedRuntime).toBe(a.watchedRuntime + a.remainingRuntime);
  });

  it("optional titles count only when asked for", () => {
    const state = watchedState(["iron-man"]);
    expect(getStats(MCU_CONTENT, indexOf(state)).movies).toBeLessThan(getStats(MCU_CONTENT, indexOf(state), { includeOptional: true }).movies);
  });
});
