/**
 * Progress statistics for a set of titles (NEXT_LEVEL_PLAN.md §4.4). Pure.
 *
 * - A series flagged `dataPending` counts for nothing: 0 units, 0 runtime, and it is not one of
 *   the titles that have to be finished. Its episodes cannot be ticked, so counting them would
 *   make 100% unreachable.
 * - For a skipped title, the units already watched count as watched; the rest are "skipped".
 *   Skipped units are left out of the totals, the remaining time and the percentage.
 * - Percent is by runtime: watched ÷ (watched + remaining). It is capped at 99 until every
 *   counted title is satisfied (watched or skipped), and is exactly 100 from then on.
 */
import type { ContentItem } from "../catalogue/types";
import { isSatisfied, isWatchedComplete, progressKey, type ViewingIndex } from "./state";

export type Stats = {
  /** 0–100. 100 exactly when `complete`. */
  percent: number;
  /** 0–1. 1 exactly when `complete`. */
  ratio: number;
  /** Every counted title is watched or skipped. */
  complete: boolean;
  /** Units that count: watched + remaining. Skipped units are not included. */
  totalUnits: number;
  watchedUnits: number;
  remainingUnits: number;
  skippedUnits: number;
  watchedRuntime: number;
  remainingRuntime: number;
  skippedRuntime: number;
  /** Titles that are skipped and not fully watched. */
  skippedTitles: number;
  movies: number;
  watchedMovies: number;
  series: number;
  watchedSeries: number;
  specials: number;
  watchedSpecials: number;
  totalEpisodes: number;
  watchedEpisodes: number;
  /** Episodes still to watch (skipped ones excluded). */
  remainingEpisodes: number;
  /** The set includes a series whose episodes are not published yet, so more runtime is coming. */
  pendingRuntime: boolean;
};

const isPending = (item: ContentItem) => item.kind === "series" && Boolean(item.dataPending);

export function getStats(items: readonly ContentItem[], index: ViewingIndex, options: { includeOptional?: boolean } = {}): Stats {
  const tracked = options.includeOptional ? [...items] : items.filter((item) => item.required);
  const counted = tracked.filter((item) => !isPending(item));

  let watchedUnits = 0;
  let remainingUnits = 0;
  let skippedUnits = 0;
  let watchedRuntime = 0;
  let remainingRuntime = 0;
  let skippedRuntime = 0;
  let skippedTitles = 0;
  let totalEpisodes = 0;
  let watchedEpisodes = 0;
  let remainingEpisodes = 0;

  for (const item of counted) {
    const skipped = index.skipped.has(item.id) && !isWatchedComplete(item, index);
    if (skipped) skippedTitles += 1;
    const units =
      item.kind === "series"
        ? (item.episodes ?? []).map((episode) => ({ key: progressKey(item.id, episode.id), runtime: episode.runtimeSec }))
        : [{ key: progressKey(item.id), runtime: item.runtimeSec }];

    for (const unit of units) {
      const isEpisode = item.kind === "series";
      if (isEpisode) totalEpisodes += 1;
      if (index.watched.has(unit.key)) {
        watchedUnits += 1;
        watchedRuntime += unit.runtime;
        if (isEpisode) watchedEpisodes += 1;
      } else if (skipped) {
        skippedUnits += 1;
        skippedRuntime += unit.runtime;
      } else {
        remainingUnits += 1;
        remainingRuntime += unit.runtime;
        if (isEpisode) remainingEpisodes += 1;
      }
    }
  }

  const complete = counted.every((item) => isSatisfied(item, index));
  const countedRuntime = watchedRuntime + remainingRuntime;
  const ratio = complete ? 1 : countedRuntime > 0 ? Math.min(0.99, watchedRuntime / countedRuntime) : 0;

  const ofKind = (kind: ContentItem["kind"]) => counted.filter((item) => item.kind === kind);
  const watchedOfKind = (kind: ContentItem["kind"]) => ofKind(kind).filter((item) => isWatchedComplete(item, index)).length;

  return {
    percent: complete ? 100 : Math.min(99, Math.round(ratio * 100)),
    ratio,
    complete,
    totalUnits: watchedUnits + remainingUnits,
    watchedUnits,
    remainingUnits,
    skippedUnits,
    watchedRuntime,
    remainingRuntime,
    skippedRuntime,
    skippedTitles,
    movies: ofKind("movie").length,
    watchedMovies: watchedOfKind("movie"),
    series: ofKind("series").length,
    watchedSeries: watchedOfKind("series"),
    specials: ofKind("special").length,
    watchedSpecials: watchedOfKind("special"),
    totalEpisodes,
    watchedEpisodes,
    remainingEpisodes,
    pendingRuntime: tracked.some(isPending),
  };
}
