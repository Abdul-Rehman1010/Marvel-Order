/**
 * A user's viewing state and the questions asked of it (NEXT_LEVEL_PLAN.md §4.1 and §4.4).
 * Pure: no I/O. The clock is always passed in.
 *
 * Vocabulary: a title is WATCHED-COMPLETE when every unit has a watched row, SKIPPED when the
 * user chose not to watch it, and SATISFIED when it is either. Locks look at "satisfied".
 *
 * Stored rows the catalogue does not recognise (a removed title, an episode number a series
 * no longer has) are never an error and never deleted. `indexOf` leaves them out, so every
 * rule ignores them, and `unrecognisedIds` lists them so the problem stays visible.
 */
import { CONTENT, CONTENT_BY_ID } from "../catalogue";
import type { ContentItem } from "../catalogue/types";
import { ancestors } from "./graph";
import { isReleased } from "./release";

export type ProgressRow = { contentId: string; episode: number; watchedAt: string; backfilled: boolean };
export type SkipReason = "manual" | "triage";
export type SkipRow = { contentId: string; reason: SkipReason; skippedAt: string };

/** Everything stored for one user. Plain data, safe to send as JSON. */
export type ViewingState = { rows: ProgressRow[]; skips: SkipRow[] };

/** Lookup sets derived from a `ViewingState`. `watched` holds `progressKey`s; `skipped` holds title ids. */
export type ViewingIndex = { watched: ReadonlySet<string>; skipped: ReadonlySet<string> };

export type LockReason =
  | { kind: "prerequisite"; item: ContentItem }
  | { kind: "unreleased"; date: string }
  | { kind: "pending" };

export const EMPTY_STATE: ViewingState = Object.freeze({ rows: [], skips: [] }) as ViewingState;
export const EMPTY_INDEX: ViewingIndex = Object.freeze({ watched: new Set<string>(), skipped: new Set<string>() });

/** The key of one unit: `"iron-man:-1"` for a movie or special, `"wandavision:3"` for an episode. */
export function progressKey(contentId: string, episode = -1) {
  return `${contentId}:${episode}`;
}

/** The episode numbers a title accepts: `[-1]` for a movie or special, `1..n` for a series. */
export function unitEpisodes(item: ContentItem): number[] {
  return item.kind === "series" ? (item.episodes ?? []).map((episode) => episode.id) : [-1];
}

/** True when `episode` is a unit this title really has. */
export function isUnitOf(item: ContentItem, episode: number): boolean {
  return item.kind === "series" ? (item.episodes ?? []).some((candidate) => candidate.id === episode) : episode === -1;
}

function isRecognisedRow(row: Pick<ProgressRow, "contentId" | "episode">): boolean {
  const item = CONTENT_BY_ID.get(row.contentId);
  return item !== undefined && isUnitOf(item, row.episode);
}

/** Builds the lookup sets. Rows and skips the catalogue does not recognise are left out. */
export function indexOf(state: ViewingState): ViewingIndex {
  const watched = new Set<string>();
  for (const row of state.rows) {
    if (isRecognisedRow(row)) watched.add(progressKey(row.contentId, row.episode));
  }
  const skipped = new Set<string>();
  for (const skip of state.skips) {
    if (CONTENT_BY_ID.has(skip.contentId)) skipped.add(skip.contentId);
  }
  return { watched, skipped };
}

/** Builds an index from bare progress keys, with nothing skipped. For callers that only have keys. */
export function indexOfKeys(keys: Iterable<string>): ViewingIndex {
  return { watched: new Set(keys), skipped: EMPTY_INDEX.skipped };
}

/** Title ids named by stored rows or skips that the catalogue does not recognise, each listed once. */
export function unrecognisedIds(state: ViewingState): string[] {
  const ids = new Set<string>();
  for (const row of state.rows) if (!isRecognisedRow(row)) ids.add(row.contentId);
  for (const skip of state.skips) if (!CONTENT_BY_ID.has(skip.contentId)) ids.add(skip.contentId);
  return [...ids];
}

/** How many of this title's units are watched. */
export function watchedUnitCount(item: ContentItem, index: ViewingIndex): number {
  return unitEpisodes(item).filter((episode) => index.watched.has(progressKey(item.id, episode))).length;
}

/**
 * Every unit watched. A series flagged `dataPending` is never complete: its episode list is
 * unknown, so it cannot be ticked (and an empty list must not count as "all watched").
 */
export function isWatchedComplete(item: ContentItem, index: ViewingIndex): boolean {
  if (item.kind !== "series") return index.watched.has(progressKey(item.id));
  if (item.dataPending) return false;
  const episodes = item.episodes ?? [];
  return episodes.length > 0 && episodes.every((episode) => index.watched.has(progressKey(item.id, episode.id)));
}

/** Watched-complete or skipped. This is what a lock checks. */
export function isSatisfied(item: ContentItem, index: ViewingIndex): boolean {
  return index.skipped.has(item.id) || isWatchedComplete(item, index);
}

/** Not satisfied: what "remaining", "next up" and "unwatched" mean. */
export function isOutstanding(item: ContentItem, index: ViewingIndex): boolean {
  return !isSatisfied(item, index);
}

/**
 * The earliest unsatisfied prerequisite, looking at EVERY transitive prerequisite in watch
 * order (not only the direct ones). For a state without skips and without out-of-order rows
 * this is the same title the pre-1.3 code named.
 */
export function missingPrerequisite(item: ContentItem, index: ViewingIndex): ContentItem | null {
  for (const id of ancestors(item.id)) {
    const prerequisite = CONTENT_BY_ID.get(id)!;
    if (!isSatisfied(prerequisite, index)) return prerequisite;
  }
  return null;
}

/**
 * Why a title cannot be marked watched right now, or `null` when it can.
 * Checked in this order: an unsatisfied prerequisite, a release date in the future, an
 * episode list that is not published yet (`dataPending` series).
 */
export function lockReason(item: ContentItem, index: ViewingIndex, now: Date | number): LockReason | null {
  const missing = missingPrerequisite(item, index);
  if (missing) return { kind: "prerequisite", item: missing };
  if (!isReleased(item, now)) return { kind: "unreleased", date: item.releaseDate };
  if (item.kind === "series" && item.dataPending) return { kind: "pending" };
  return null;
}

/**
 * Titles that have watched rows while one of their prerequisites is unsatisfied, in catalogue
 * order. The pre-1.3 un-watch bugs could leave such rows behind. They are never deleted
 * automatically: the app labels them "Watched out of order" and lets the user remove them.
 */
export function outOfOrderTitles(state: ViewingState): string[] {
  const index = indexOf(state);
  const withRows = new Set<string>();
  for (const key of index.watched) withRows.add(key.slice(0, key.lastIndexOf(":")));
  return CONTENT.filter((item) => withRows.has(item.id) && missingPrerequisite(item, index) !== null).map((item) => item.id);
}
