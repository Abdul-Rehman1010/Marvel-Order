/**
 * Release dates (NEXT_LEVEL_PLAN.md §4.4). A title is released from 00:00 UTC on its
 * `releaseDate`. The client and the server both use this file, so a lock can never show as open
 * on one side and closed on the other, and every printed date uses UTC so it matches the lock.
 */
import type { ContentItem } from "../catalogue/types";

/** The instant (epoch milliseconds) a title becomes available: 00:00 UTC on its release date. */
export function releaseMoment(item: Pick<ContentItem, "releaseDate">): number {
  return Date.parse(`${item.releaseDate}T00:00:00Z`);
}

export function isReleased(item: Pick<ContentItem, "releaseDate">, now: Date | number): boolean {
  return (typeof now === "number" ? now : now.getTime()) >= releaseMoment(item);
}

const LONG = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const SHORT = new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit", year: "numeric", timeZone: "UTC" });

/** Formats a `YYYY-MM-DD` release date in UTC: "October 14, 2026" (long) or "Oct 14, 2026" (short). */
export function formatReleaseDate(releaseDate: string, style: "long" | "short" = "long"): string {
  return (style === "long" ? LONG : SHORT).format(new Date(`${releaseDate}T00:00:00Z`));
}
