/**
 * Builders for viewing states used by the engine and API tests.
 */
import { CONTENT, CONTENT_BY_ID, type ContentItem } from "@/lib/content";
import { graphRank } from "@/lib/engine/graph";
import { applyAction, type Action, type ActionFailure, type ActionSuccess } from "@/lib/engine/reducer";
import { unitEpisodes, type ProgressRow, type ViewingState } from "@/lib/engine/state";

/** The fixed clock most tests use. Nothing in the catalogue is unreleased on this date. */
export const NOW = new Date("2026-11-15T12:00:00.000Z");
/** The timestamp fixture rows carry, so a test can tell them from rows an action adds at `NOW`. */
export const EARLIER = "2026-01-01T00:00:00.000Z";

export function item(id: string): ContentItem {
  const found = CONTENT_BY_ID.get(id);
  if (!found) throw new Error(`Unknown catalogue id in test: ${id}`);
  return found;
}

const isPending = (candidate: ContentItem) => candidate.kind === "series" && Boolean(candidate.dataPending);

/** Every title that can be fully watched (so not the series whose episode list is unpublished), in graph order. */
export const WATCHABLE_IDS = CONTENT.filter((candidate) => !isPending(candidate))
  .map((candidate) => candidate.id)
  .sort((a, b) => graphRank(a) - graphRank(b));

/** Watched rows for a whole title, or only the listed episodes of a series. */
export function rowsFor(id: string, episodes?: number[], watchedAt = EARLIER, backfilled = false): ProgressRow[] {
  return (episodes ?? unitEpisodes(item(id))).map((episode) => ({ contentId: id, episode, watchedAt, backfilled }));
}

/**
 * A state with the listed titles fully watched. An entry can also be `[id, episodes]` to watch
 * only some episodes of a series. Rows are written directly: no rule is checked.
 */
export function watchedState(entries: (string | [string, number[]])[]): ViewingState {
  return {
    rows: entries.flatMap((entry) => (typeof entry === "string" ? rowsFor(entry) : rowsFor(entry[0], entry[1]))),
    skips: [],
  };
}

/** Every unit of every watchable title. */
export function fullAccount(): ViewingState {
  return watchedState(WATCHABLE_IDS);
}

/** Every required title of one universe list up to and including `id`, in list order. */
export function requiredThrough(list: ContentItem[], id: string): string[] {
  const end = list.findIndex((candidate) => candidate.id === id);
  if (end < 0) throw new Error(`${id} is not in that list`);
  return list.slice(0, end + 1).filter((candidate) => candidate.required).map((candidate) => candidate.id);
}

/** Applies an action that must succeed. */
export function apply(state: ViewingState, action: Action, now: Date = NOW): ActionSuccess {
  const outcome = applyAction(state, action, now);
  if (!outcome.ok) throw new Error(`Expected ${JSON.stringify(action)} to succeed, got ${outcome.code}: ${outcome.message}`);
  return outcome;
}

/** Applies an action that must be refused. */
export function refuse(state: ViewingState, action: Action, now: Date = NOW): ActionFailure {
  const outcome = applyAction(state, action, now);
  if (outcome.ok) throw new Error(`Expected ${JSON.stringify(action)} to be refused`);
  return outcome;
}

export const keysOf = (state: ViewingState) => state.rows.map((row) => `${row.contentId}:${row.episode}`).sort();
export const titlesWithRows = (state: ViewingState) => [...new Set(state.rows.map((row) => row.contentId))];
export const skippedIds = (state: ViewingState) => state.skips.map((skip) => skip.contentId).sort();
