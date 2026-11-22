/**
 * Text formatting shared by the client and the server (NEXT_LEVEL_PLAN.md §4.4).
 */
import type { ContentItem } from "../catalogue/types";
import { formatReleaseDate } from "./release";
import type { LockReason } from "./state";

/**
 * A length of time: `"124h 14m"`, `"2h 06m"`, `"45m"`, `"0m"`. The catalogue is minute-level,
 * so seconds are dropped. `"TBD"` when the value is unknown (missing, not a number, negative).
 */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return "TBD";
  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${String(minutes).padStart(2, "0")}m` : `${minutes}m`;
}

/** The runtime of one title or episode. The catalogue stores an unknown runtime as 0, shown as "TBD". */
export function formatRuntimeOf(seconds: number | null | undefined): string {
  return seconds ? formatDuration(seconds) : "TBD";
}

/** The sentence shown for a lock. The date is printed in UTC, the same clock the lock uses. */
export function formatLockReason(item: ContentItem, lock: LockReason): string {
  if (lock.kind === "prerequisite") {
    return item.universe === "street"
      ? `Complete ${lock.item.title} next; it is the earliest unfinished prerequisite in this character or crossover path.`
      : `Complete ${lock.item.title} next; it is the earliest unfinished prerequisite for ${item.title}.`;
  }
  if (lock.kind === "unreleased") return `Scheduled transmission: releases ${formatReleaseDate(lock.date)}.`;
  return "The episode list has not been published yet.";
}
