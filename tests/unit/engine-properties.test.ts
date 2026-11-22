/**
 * Properties of the reducer checked over long random action sequences (NEXT_LEVEL_PLAN.md §4.7,
 * "Properties"). The generator is seeded, so a failure reproduces exactly.
 *
 * The last block replays every step through a replica of the PRE-1.3 server code and checks that
 * the new reducer gives the same result except for the bug fixes the plan lists.
 */
import { describe, expect, it } from "vitest";

import { CONTENT, CONTENT_BY_ID, MCU_CONTENT, UNIVERSE_CONTENT, type ContentItem } from "@/lib/content";
import { dependents, directPrerequisites } from "@/lib/engine/graph";
import { applyAction, type Action, type ActionSuccess } from "@/lib/engine/reducer";
import {
  EMPTY_STATE,
  indexOf,
  isWatchedComplete,
  lockReason,
  outOfOrderTitles,
  progressKey,
  unitEpisodes,
  type ViewingState,
} from "@/lib/engine/state";

import { NOW, WATCHABLE_IDS, fullAccount, keysOf } from "../helpers/viewing";

/** A small seeded generator (mulberry32), so every run draws the same sequences. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The walks are CPU work; the default 5 s limit is too tight when every test file runs at once. */
const WALK_TIMEOUT_MS = 60_000;

const pick = <T,>(rnd: () => number, values: readonly T[]) => values[Math.floor(rnd() * values.length)];
const ALL_IDS = CONTENT.map((item) => item.id);

/** One random action. `withSkips: false` draws only watch and un-watch of units that exist. */
function drawAction(rnd: () => number, state: ViewingState, withSkips: boolean): Action {
  const index = indexOf(state);
  const roll = rnd();

  // Most of the time: the next unit of a title that can be watched now, so sequences go deep.
  if (roll < 0.5) {
    const open = CONTENT.filter((item) => !isWatchedComplete(item, index) && lockReason(item, index, NOW) === null);
    if (open.length) {
      const item = pick(rnd, open);
      const episode = unitEpisodes(item).find((candidate) => !index.watched.has(progressKey(item.id, candidate)))!;
      return { type: "watch", contentId: item.id, episode };
    }
  }
  if (roll < 0.68 && state.rows.length) {
    const row = pick(rnd, state.rows);
    return { type: "unwatch", contentId: row.contentId, episode: row.episode };
  }
  if (roll < 0.8) {
    // Any unit at all: usually refused (locked, or out of episode order).
    const item = CONTENT_BY_ID.get(pick(rnd, ALL_IDS))!;
    return { type: rnd() < 0.7 ? "watch" : "unwatch", contentId: item.id, episode: pick(rnd, unitEpisodes(item)) };
  }
  if (!withSkips) {
    const item = CONTENT_BY_ID.get(pick(rnd, WATCHABLE_IDS))!;
    return { type: "watch", contentId: item.id, episode: pick(rnd, unitEpisodes(item)) };
  }
  if (roll < 0.86) {
    // Half the time skip a title that is open right now: that opens later titles, which is what
    // makes "unskip" refusals (has-dependents) reachable.
    const open = CONTENT.filter((item) => !isWatchedComplete(item, index) && lockReason(item, index, NOW) === null);
    const contentId = open.length && rnd() < 0.5 ? pick(rnd, open).id : pick(rnd, ALL_IDS);
    return { type: "skip", contentId, reason: rnd() < 0.5 ? "manual" : "triage" };
  }
  if (roll < 0.9) return { type: "unskip", contentId: state.skips.length ? pick(rnd, state.skips).contentId : pick(rnd, ALL_IDS) };
  if (roll < 0.95) return { type: "watchAll", contentId: pick(rnd, ALL_IDS) };
  if (roll < 0.98) {
    const count = 1 + Math.floor(rnd() * 12);
    const watch = WATCHABLE_IDS.slice(0, Math.floor(rnd() * 40)).filter(() => rnd() < 0.9).slice(0, count * 4);
    const skip = Array.from({ length: Math.floor(rnd() * 3) }, () => pick(rnd, ALL_IDS)).filter((id) => !watch.includes(id));
    return { type: "bulk", watch, skip, backfilled: rnd() < 0.5 };
  }
  // Nonsense: a unit the title does not have, or a title that does not exist.
  return rnd() < 0.5
    ? { type: rnd() < 0.5 ? "watch" : "unwatch", contentId: pick(rnd, ALL_IDS), episode: 99 }
    : { type: "watch", contentId: "no-such-title", episode: -1 };
}

/** Checks that `outcome` describes exactly how `before` became `outcome.state`. */
function expectDiffMatches(before: ViewingState, outcome: ActionSuccess, action: Action, label: string) {
  const beforeKeys = new Set(keysOf(before));
  const afterKeys = new Set(keysOf(outcome.state));
  const added = outcome.addedRows.map((row) => progressKey(row.contentId, row.episode));

  expect([...afterKeys].filter((key) => !beforeKeys.has(key)).sort(), `${label}: addedRows`).toEqual([...added].sort());
  expect([...beforeKeys].filter((key) => !afterKeys.has(key)).sort(), `${label}: removedKeys`).toEqual([...outcome.removedKeys].sort());
  expect(new Set(added).size, `${label}: a row added twice`).toBe(added.length);

  const beforeSkips = new Set(before.skips.map((skip) => skip.contentId));
  const afterSkips = new Set(outcome.state.skips.map((skip) => skip.contentId));
  expect([...afterSkips].filter((id) => !beforeSkips.has(id)).sort(), `${label}: addedSkips`).toEqual(outcome.addedSkips.map((skip) => skip.contentId).sort());
  expect([...beforeSkips].filter((id) => !afterSkips.has(id)).sort(), `${label}: removedSkips`).toEqual([...outcome.removedSkips].sort());

  // `cleared` = the OTHER titles that lost rows.
  const target = "contentId" in action ? action.contentId : null;
  const lostRows = new Set(outcome.removedKeys.map((key) => key.slice(0, key.lastIndexOf(":"))));
  lostRows.delete(target ?? "");
  expect([...lostRows].sort(), `${label}: cleared`).toEqual([...outcome.cleared].sort());

  // Rows that stay keep their values: nothing is re-stamped.
  const beforeByKey = new Map(before.rows.map((row) => [progressKey(row.contentId, row.episode), row]));
  const restamped = outcome.state.rows.filter((row) => {
    const earlier = beforeByKey.get(progressKey(row.contentId, row.episode));
    return earlier !== undefined && (earlier.watchedAt !== row.watchedAt || earlier.backfilled !== row.backfilled);
  });
  expect(restamped, `${label}: an existing row changed`).toEqual([]);
}

/**
 * The invariants of every state the reducer can produce from an empty one. Problems are
 * collected and asserted once: this runs thousands of times, and one assertion per title per
 * step made the test slow enough to time out when the whole suite runs in parallel.
 */
function expectValid(state: ViewingState, label: string) {
  const problems: string[] = [];
  for (const id of outOfOrderTitles(state)) problems.push(`${id} has rows while a prerequisite is unsatisfied`);
  const index = indexOf(state);
  for (const item of CONTENT) {
    if (item.kind === "series") {
      const watched = unitEpisodes(item).filter((episode) => index.watched.has(progressKey(item.id, episode)));
      if (watched.some((episode, position) => episode !== position + 1)) problems.push(`${item.id} episodes are not a 1..n prefix: ${watched.join(",")}`);
    }
    if (index.skipped.has(item.id) && isWatchedComplete(item, index)) problems.push(`${item.id} is skipped and fully watched`);
  }
  if (new Set(keysOf(state)).size !== state.rows.length) problems.push("duplicate rows");
  if (new Set(state.skips.map((skip) => skip.contentId)).size !== state.skips.length) problems.push("duplicate skips");
  expect(problems, label).toEqual([]);
}

describe("random action sequences", () => {
  it("every reachable state is valid, the input is never mutated, and the diff is exact", () => {
    let succeeded = 0;
    let refused = 0;
    const kinds = new Set<string>();

    for (let seed = 1; seed <= 12; seed += 1) {
      const rnd = random(seed);
      // A third of the walks start from a full account, so deep states and large cascades are covered.
      let state: ViewingState = seed % 3 === 0 ? fullAccount() : EMPTY_STATE;
      expectValid(state, `seed ${seed} start`);
      for (let step = 0; step < 450; step += 1) {
        // From a full account, first try the one series whose episode list is unpublished.
        const action: Action =
          seed % 3 === 0 && step === 0 ? { type: "watch", contentId: "friendly-spider-man-2", episode: 1 } : drawAction(rnd, state, true);
        const label = `seed ${seed} step ${step} ${JSON.stringify(action).slice(0, 120)}`;
        const frozen = JSON.stringify(state);

        const outcome = applyAction(state, action, new Date(NOW.getTime() + step * 1000));

        if (JSON.stringify(state) !== frozen) throw new Error(`${label}: the input state was mutated`);
        if (!outcome.ok) {
          refused += 1;
          kinds.add(outcome.code);
          expect(outcome.message.length, label).toBeGreaterThan(0);
          continue;
        }
        succeeded += 1;
        expectDiffMatches(state, outcome, action, label);
        expectValid(outcome.state, label);
        state = outcome.state;
      }
    }

    // The sequences really exercise both outcomes and most refusal kinds.
    expect(succeeded).toBeGreaterThan(2000);
    expect(refused).toBeGreaterThan(300);
    expect([...kinds].sort()).toEqual(["episode-order", "has-dependents", "locked", "pending", "unknown-episode", "unknown-title"]);
  }, WALK_TIMEOUT_MS);

  it("merging any two reachable states gives a valid state, and merging again changes nothing", () => {
    const walk = (seed: number, steps: number) => {
      const rnd = random(seed);
      let state: ViewingState = EMPTY_STATE;
      for (let step = 0; step < steps; step += 1) {
        const outcome = applyAction(state, drawAction(rnd, state, true), new Date(NOW.getTime() + step * 1000));
        if (outcome.ok) state = outcome.state;
      }
      return state;
    };

    for (let pair = 0; pair < 8; pair += 1) {
      const mine = walk(100 + pair, 200);
      const theirs = walk(200 + pair, 260);
      const label = `pair ${pair}`;

      const merged = applyAction(mine, { type: "import", rows: theirs.rows, skips: theirs.skips }, NOW);
      if (!merged.ok) throw new Error(`${label}: import was refused`);
      expectValid(merged.state, label);
      // Nothing the account already had is lost.
      for (const key of keysOf(mine)) expect(keysOf(merged.state), label).toContain(key);

      const again = applyAction(merged.state, { type: "import", rows: theirs.rows, skips: theirs.skips }, NOW);
      if (!again.ok) throw new Error(`${label}: second import was refused`);
      expect(again.addedRows, label).toEqual([]);
      expect(again.addedSkips, label).toEqual([]);
      expect(keysOf(again.state), label).toEqual(keysOf(merged.state));
    }
  }, WALK_TIMEOUT_MS);
});

/* ------------------------------------------------------------------------------------------ *
 * A replica of the server code before package 1.3 (`updateProgress`, `clearDependents` and
 * `clearInvalidCompletedItems` in src/lib/progress-store.ts, with the lock rule of
 * src/lib/content.ts), working on a set of keys instead of a database. Do not "fix" it:
 * it is here to show which results changed, and that only the listed bugs did.
 * ------------------------------------------------------------------------------------------ */
const legacyComplete = (item: ContentItem, watched: Set<string>) =>
  item.kind !== "series" ? watched.has(progressKey(item.id)) : (item.episodes ?? []).every((episode) => watched.has(progressKey(item.id, episode.id)));

function legacyMissing(item: ContentItem, watched: Set<string>): ContentItem | null {
  for (const id of directPrerequisites(item.id)) {
    const prerequisite = CONTENT_BY_ID.get(id)!;
    if (legacyComplete(prerequisite, watched)) continue;
    return legacyMissing(prerequisite, watched) ?? prerequisite;
  }
  return null;
}

const removeTitle = (watched: Set<string>, id: string) => {
  for (const key of [...watched]) if (key.startsWith(`${id}:`)) watched.delete(key);
};

function legacyClearInvalid(watched: Set<string>, universe: ContentItem["universe"]) {
  let cleared = true;
  while (cleared) {
    cleared = false;
    for (const candidate of UNIVERSE_CONTENT[universe]) {
      if (!legacyComplete(candidate, watched) || !legacyMissing(candidate, watched)) continue;
      removeTitle(watched, candidate.id);
      cleared = true;
    }
  }
}

/** Returns the new key set, or `null` when the old server threw (HTTP 409). */
function legacyUpdate(keys: readonly string[], contentId: string, episode: number, value: boolean): Set<string> | null {
  const item = CONTENT_BY_ID.get(contentId);
  if (!item) return null;
  const watched = new Set(keys);

  if (value) {
    if (legacyMissing(item, watched)) return null;
    if (item.kind === "series") {
      if (!item.episodes?.some((candidate) => candidate.id === episode)) return null;
      if (episode > 1 && !watched.has(progressKey(item.id, episode - 1))) return null;
    } else if (episode !== -1) return null;
    watched.add(progressKey(contentId, episode));
    return watched;
  }

  watched.delete(progressKey(contentId, episode));
  if (item.kind === "series" && episode > 0) {
    for (const candidate of item.episodes ?? []) if (candidate.id > episode) watched.delete(progressKey(item.id, candidate.id));
  }
  if (!item.required) return watched;
  if (item.universe === "xmen" || item.universe === "street") {
    legacyClearInvalid(watched, item.universe);
  } else {
    const list = UNIVERSE_CONTENT[item.universe];
    for (const candidate of list.slice(list.findIndex((entry) => entry.id === item.id) + 1)) removeTitle(watched, candidate.id);
  }
  if (item.id === "xmen-2000") {
    for (const candidate of MCU_CONTENT.slice(MCU_CONTENT.findIndex((entry) => entry.id === "multiverse-of-madness"))) removeTitle(watched, candidate.id);
  }
  if (item.id === "endgame") legacyClearInvalid(watched, "street");
  return watched;
}

describe("agreement with the pre-1.3 server, one step at a time", () => {
  /**
   * From every state the new reducer reaches (no skips), the same single action is given to the
   * old replica. The two must agree, except for exactly these fixes:
   *  1. Moon Knight has no prerequisites: an MCU cascade no longer deletes its rows.
   *  2. A cascade removes partly watched dependents too (the old Street clean-up only removed
   *     finished titles, leaving orphaned episodes).
   *  6. Hawkeye and Echo are cleared when ANY film they depend on is un-watched, not only Endgame.
   * (Fix 7, a bogus episode number, and the unpublished series are left out of the draw: the old
   * code accepted both, and they have their own tests.)
   */
  it("gives the same result except for the listed fixes", () => {
    const street = new Set(UNIVERSE_CONTENT.street.map((item) => item.id));
    const titleOf = (key: string) => key.slice(0, key.lastIndexOf(":"));
    let compared = 0;
    let fixesSeen = { moonKnightKept: 0, streetOrphansRemoved: 0 };

    for (let seed = 21; seed <= 32; seed += 1) {
      const rnd = random(seed);
      let state: ViewingState = EMPTY_STATE;
      for (let step = 0; step < 500; step += 1) {
        const action = drawAction(rnd, state, false);
        if (action.type !== "watch" && action.type !== "unwatch") continue;
        if (CONTENT_BY_ID.get(action.contentId)?.dataPending) continue;
        const label = `seed ${seed} step ${step} ${JSON.stringify(action)}`;

        const outcome = applyAction(state, action, NOW);
        const legacy = legacyUpdate(keysOf(state), action.contentId, action.episode, action.type === "watch");
        compared += 1;

        expect(outcome.ok, `${label}: accepted by one and refused by the other`).toBe(legacy !== null);
        if (!outcome.ok || legacy === null) continue;

        const now = new Set(keysOf(outcome.state));
        const onlyLegacy = [...legacy].filter((key) => !now.has(key));
        const onlyNew = [...now].filter((key) => !legacy.has(key));

        if (action.type === "watch") {
          expect({ onlyLegacy, onlyNew }, label).toEqual({ onlyLegacy: [], onlyNew: [] });
        } else {
          // Fix 1: rows only the new code keeps are Moon Knight's.
          expect(onlyNew.filter((key) => titleOf(key) !== "moon-knight"), `${label}: kept something the old code removed`).toEqual([]);
          // Fixes 2 and 6: rows only the old code keeps are Street titles that depend on the target.
          const dependsOnTarget = new Set(dependents(action.contentId));
          expect(
            onlyLegacy.filter((key) => !(street.has(titleOf(key)) && dependsOnTarget.has(titleOf(key)))),
            `${label}: removed something the old code kept`,
          ).toEqual([]);
          if (onlyNew.length) fixesSeen = { ...fixesSeen, moonKnightKept: fixesSeen.moonKnightKept + 1 };
          if (onlyLegacy.length) fixesSeen = { ...fixesSeen, streetOrphansRemoved: fixesSeen.streetOrphansRemoved + 1 };
        }
        state = outcome.state;
      }
    }

    expect(compared).toBeGreaterThan(3000);
    // The sequences did run into the fixed bugs, so the allowances above were really used.
    expect(fixesSeen.moonKnightKept).toBeGreaterThan(0);
    expect(fixesSeen.streetOrphansRemoved).toBeGreaterThan(0);
  }, WALK_TIMEOUT_MS);
});
