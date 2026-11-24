/**
 * The catch-up wizard's selection rules (NEXT_LEVEL_PLAN.md 2.3), pure so they are tested without
 * React. The wizard (src/components/nexus/catch-up-wizard.tsx) only draws what this works out.
 *
 * The user picks the latest MCU and X-Men title they have seen and ticks the Street-Level seasons.
 * Everything required up to a picked title counts as seen. The selection is always closed over
 * every prerequisite, across universes, so the server never has to refuse it: picking an MCU title
 * from Multiverse of Madness on adds X-Men (2000); ticking Hawkeye adds the MCU through Endgame.
 * In Review, "Haven't seen this" turns a required title into a skip (later titles stay unlocked)
 * and simply leaves an optional title out. The result is one `bulk` action with `backfilled: true`.
 */
import { CONTENT_BY_ID, UNIVERSE_CONTENT } from "@/lib/catalogue";
import type { ContentItem, Universe } from "@/lib/catalogue/types";
import { formatDuration } from "@/lib/engine/format";
import { ancestors, graphRank } from "@/lib/engine/graph";
import type { Action } from "@/lib/engine/reducer";
import { isReleased } from "@/lib/engine/release";
import { indexOf, isSkipped, isWatchedComplete, progressKey, unitEpisodes, type ViewingState } from "@/lib/engine/state";

export type CatchUpStep = "mcu" | "xmen" | "street" | "review";
export const CATCH_UP_STEPS: readonly CatchUpStep[] = ["mcu", "xmen", "street", "review"];

/** Everything the wizard needs to rebuild itself (it is reopened from this after a refusal). */
export type CatchUpDraft = {
  step: CatchUpStep;
  /** The latest MCU title the user has seen, or null for none. */
  mcuPoint: string | null;
  xmenPoint: string | null;
  /** Street-Level titles the user ticked; their prerequisites are added for them. */
  streetPicks: readonly string[];
  /** Titles added with "Add {title}" after a refusal named them as missing. */
  extra: readonly string[];
  /** Review choices by title id: true = seen, false = haven't seen. Absent = the row's default. */
  seen: Readonly<Record<string, boolean>>;
};

export const EMPTY_CATCH_UP: CatchUpDraft = { step: "mcu", mcuPoint: null, xmenPoint: null, streetPicks: [], extra: [], seen: {} };

const unique = (ids: Iterable<string>) => [...new Set(ids)];
const byGraphOrder = (a: string, b: string) => graphRank(a) - graphRank(b);
const titleOf = (id: string) => CONTENT_BY_ID.get(id)!;

/** A title the wizard offers: released, and not a series whose episode list is unpublished. */
export function isSelectable(item: ContentItem, now: Date | number): boolean {
  return isReleased(item, now) && !(item.kind === "series" && item.dataPending);
}

/** The titles of one universe the wizard offers, in release order. */
export function selectableTitles(universe: Universe, now: Date | number): ContentItem[] {
  return UNIVERSE_CONTENT[universe].filter((item) => isSelectable(item, now));
}

/** "Everything released": the last released required title of the universe. */
export function lastReleasedRequired(universe: Universe, now: Date | number): string | null {
  return selectableTitles(universe, now).filter((item) => item.required).at(-1)?.id ?? null;
}

/** The titles a pick covers: every required title up to it, and the picked title itself. */
export function titlesThrough(universe: Universe, pointId: string | null, now: Date | number): string[] {
  if (!pointId) return [];
  const list = selectableTitles(universe, now);
  const end = list.findIndex((item) => item.id === pointId);
  if (end < 0) return [];
  return list.slice(0, end + 1).filter((item, position) => item.required || position === end).map((item) => item.id);
}

/** Optional titles released before the pick. Review lists them un-ticked. */
export function optionalBefore(universe: Universe, pointId: string | null, now: Date | number): string[] {
  if (!pointId) return [];
  const list = selectableTitles(universe, now);
  const end = list.findIndex((item) => item.id === pointId);
  return list.slice(0, Math.max(0, end)).filter((item) => !item.required).map((item) => item.id);
}

/**
 * Adds every prerequisite of the chosen titles, across universes. Returns the closed list in graph
 * order and, for each title that was added, the first chosen title (in graph order) that needs it.
 */
export function closeOverPrerequisites(chosen: Iterable<string>): { ids: string[]; neededBy: Map<string, string> } {
  const direct = unique(chosen).filter((id) => CONTENT_BY_ID.has(id)).sort(byGraphOrder);
  const inDirect = new Set(direct);
  const neededBy = new Map<string, string>();
  for (const id of direct) {
    for (const prerequisite of ancestors(id)) {
      if (!inDirect.has(prerequisite) && !neededBy.has(prerequisite)) neededBy.set(prerequisite, id);
    }
  }
  return { ids: [...direct, ...neededBy.keys()].sort(byGraphOrder), neededBy };
}

/**
 * The Street-Level step: which titles are ticked (picked, or needed by a pick) and, for each pick,
 * the titles outside Street-Level it adds that the MCU and X-Men picks do not already cover.
 */
export function streetChoices(draft: CatchUpDraft, now: Date | number) {
  const { ids, neededBy } = closeOverPrerequisites(draft.streetPicks);
  const covered = new Set([...titlesThrough("mcu", draft.mcuPoint, now), ...titlesThrough("xmen", draft.xmenPoint, now)]);
  const crossFor = new Map<string, ContentItem[]>();
  for (const pick of draft.streetPicks) {
    const cross = ancestors(pick).filter((id) => titleOf(id).universe !== "street" && !covered.has(id)).map(titleOf);
    if (cross.length) crossFor.set(pick, cross);
  }
  const checked = new Set(ids.filter((id) => titleOf(id).universe === "street"));
  return { checked, neededBy, crossFor };
}

/** Titles of another universe that a pick needs, for a note on the later steps. */
export function addedFromOtherUniverses(draft: CatchUpDraft, universe: Universe, now: Date | number): ContentItem[] {
  const own = new Set(titlesThrough(universe, universe === "mcu" ? draft.mcuPoint : universe === "xmen" ? draft.xmenPoint : null, now));
  const chosen = [...titlesThrough("mcu", draft.mcuPoint, now), ...titlesThrough("xmen", draft.xmenPoint, now)];
  const { neededBy } = closeOverPrerequisites(chosen);
  return [...neededBy.keys()].filter((id) => titleOf(id).universe === universe && !own.has(id)).map(titleOf);
}

export type CatchUpRow = {
  item: ContentItem;
  /** Will be marked watched (true), or skipped / left out (false). */
  seen: boolean;
  /** The picked title that needs this one, when the user did not pick it directly. */
  neededBy?: ContentItem;
  /** Skipped already: "Haven't seen this" starts on, so the skip stays. */
  alreadySkipped: boolean;
  /** Units still to mark, and their runtime in seconds. */
  units: number;
  seconds: number;
};

export type CatchUpPlan = {
  rows: CatchUpRow[];
  watch: string[];
  skip: string[];
  movies: number;
  specials: number;
  episodes: number;
  seconds: number;
  /** Titles the selection covers that are fully watched already; they are left as they are. */
  alreadyWatched: number;
  /** The one action to send, or null when there is nothing to do. */
  action: Extract<Action, { type: "bulk" }> | null;
};

function remainingUnits(item: ContentItem, watched: ReadonlySet<string>) {
  const missing = unitEpisodes(item).filter((episode) => !watched.has(progressKey(item.id, episode)));
  const seconds = item.kind === "series"
    ? missing.reduce((sum, episode) => sum + (item.episodes?.find((candidate) => candidate.id === episode)?.runtimeSec ?? 0), 0)
    : missing.length ? item.runtimeSec : 0;
  return { units: missing.length, seconds };
}

/** Works out the rows, the totals and the bulk action for the current draft. */
export function planCatchUp(draft: CatchUpDraft, state: ViewingState, now: Date | number): CatchUpPlan {
  const index = indexOf(state);
  const optional = [...optionalBefore("mcu", draft.mcuPoint, now), ...optionalBefore("xmen", draft.xmenPoint, now)];
  const direct = [
    ...titlesThrough("mcu", draft.mcuPoint, now),
    ...titlesThrough("xmen", draft.xmenPoint, now),
    ...draft.streetPicks,
    ...draft.extra,
    ...optional.filter((id) => draft.seen[id] === true),
  ];
  const { ids: closed, neededBy } = closeOverPrerequisites(direct);
  const inClosure = new Set(closed);
  let alreadyWatched = 0;
  const rows: CatchUpRow[] = [];
  for (const id of unique([...closed, ...optional]).sort(byGraphOrder)) {
    const item = titleOf(id);
    if (!isSelectable(item, now)) continue;
    if (isWatchedComplete(item, index)) {
      alreadyWatched += 1;
      continue;
    }
    const alreadySkipped = isSkipped(item, index);
    const fallback = inClosure.has(id) && !alreadySkipped;
    const by = neededBy.get(id);
    rows.push({
      item,
      seen: draft.seen[id] ?? fallback,
      ...(by ? { neededBy: titleOf(by) } : {}),
      alreadySkipped,
      ...remainingUnits(item, index.watched),
    });
  }

  const watched = rows.filter((row) => row.seen);
  const watch = watched.map((row) => row.item.id);
  // "Haven't seen this" on a required title is a skip, so the titles after it stay unlocked.
  const skip = rows.filter((row) => !row.seen && row.item.required && inClosure.has(row.item.id)).map((row) => row.item.id);
  const count = (kind: ContentItem["kind"]) => watched.filter((row) => row.item.kind === kind).length;
  return {
    rows,
    watch,
    skip,
    movies: count("movie"),
    specials: count("special"),
    episodes: watched.filter((row) => row.item.kind === "series").reduce((sum, row) => sum + row.units, 0),
    seconds: watched.reduce((sum, row) => sum + row.seconds, 0),
    alreadyWatched,
    action: watch.length || skip.length ? { type: "bulk", watch, skip, backfilled: true } : null,
  };
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function listOf(parts: string[]) {
  return parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/** "Will mark 22 movies and 9 episodes (52h 10m) as watched, and skip 1 title." */
export function catchUpSummary(plan: CatchUpPlan): string {
  const parts = [
    ...(plan.movies ? [plural(plan.movies, "movie")] : []),
    ...(plan.specials ? [plural(plan.specials, "special")] : []),
    ...(plan.episodes ? [plural(plan.episodes, "episode")] : []),
  ];
  const skips = plan.skip.length ? plural(plan.skip.length, "title") : "";
  if (!parts.length) return skips ? `Will skip ${skips}.` : "Nothing to mark yet.";
  return `Will mark ${listOf(parts)} (${formatDuration(plan.seconds)}) as watched${skips ? `, and skip ${skips}` : ""}.`;
}
