/**
 * Per-title extras (NEXT_LEVEL_PLAN.md §4.2). Data only, keyed by catalogue id.
 *
 * - `recap`: "What you need to know" if you skip the title. The skip confirmation (package 2.2)
 *   shows it behind a "Reveal (spoilers for this title)" toggle. None are written yet: package 3.2
 *   writes them for the titles triage skips, only where the facts are certain, and lists the rest
 *   for the owner instead of guessing.
 *
 * Package 5.2 adds `postCredits`, `characters` and `trailerYouTubeId` here.
 */
export type TitleExtras = {
  /** A short spoiler recap of what later titles rely on. Plain text, one or two short paragraphs. */
  recap?: string;
};

export const EXTRAS: Readonly<Record<string, TitleExtras>> = {};

/** The recap for a title, if one has been written. */
export function recapOf(contentId: string): string | undefined {
  return EXTRAS[contentId]?.recap?.trim() || undefined;
}
