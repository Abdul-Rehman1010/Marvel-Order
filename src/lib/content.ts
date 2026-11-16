/**
 * Compatibility barrel (NEXT_LEVEL_PLAN.md §4.2). Every name the app imported from here before
 * package 1.2 still works:
 * - catalogue data and types come from `src/lib/catalogue`;
 * - prerequisite structure comes from `src/lib/engine/graph.ts`;
 * - the progress helpers below are today's lock rules, unchanged. Package 1.3 replaces them with
 *   `engine/state.ts`, `engine/release.ts` and `engine/format.ts`; this file is deleted in 5.5.
 *
 * Imports are relative so `scripts/catalogue-check.mjs` can load this file without the `@/` alias.
 */
import { CONTENT_BY_ID, type ContentItem } from "./catalogue";
import { directPrerequisites, prerequisiteChain } from "./engine/graph";

export {
  CONTENT,
  CONTENT_BY_ID,
  MCU_CONTENT,
  STREET_CONTENT,
  UNIVERSE_CONTENT,
  XMEN_CONTENT,
  type ContentItem,
  type ContentKind,
  type Episode,
  type Universe,
} from "./catalogue";

function toItems(ids: string[]): ContentItem[] {
  return ids.flatMap((id) => {
    const item = CONTENT_BY_ID.get(id);
    return item ? [item] : [];
  });
}

export function progressKey(contentId: string, episode = -1) {
  return `${contentId}:${episode}`;
}

export function itemUnits(item: ContentItem) {
  return item.kind === "series" ? item.episodes?.length ?? 0 : 1;
}

export function itemComplete(item: ContentItem, watched: Set<string>) {
  if (item.kind !== "series") return watched.has(progressKey(item.id));
  return (item.episodes ?? []).every((episode) => watched.has(progressKey(item.id, episode.id)));
}

/**
 * The titles `item` directly requires, in the order they are checked.
 * @deprecated Use `directPrerequisites(id)` from `@/lib/engine/graph`. Since 1.2 this includes the
 * per-title overrides (Hawkeye needs Endgame, Deadpool needs X-Men, and so on), which the old
 * version left out and re-added in a separate hard-coded step.
 */
export function priorRequiredItems(item: ContentItem) {
  return toItems(directPrerequisites(item.id));
}

/** Every prerequisite in watch order, then the title itself. */
export function getPrerequisiteChain(item: ContentItem) {
  return toItems(prerequisiteChain(item.id));
}

/**
 * The earliest unfinished prerequisite: the first unfinished direct prerequisite, followed down
 * to its own first unfinished prerequisite. The graph is acyclic (checked when it is built).
 */
export function missingPrerequisite(item: ContentItem, watched: Set<string>): ContentItem | null {
  for (const prerequisite of toItems(directPrerequisites(item.id))) {
    if (itemComplete(prerequisite, watched)) continue;
    return missingPrerequisite(prerequisite, watched) ?? prerequisite;
  }
  return null;
}

export function unlockReason(item: ContentItem, watched: Set<string>) {
  const missing = missingPrerequisite(item, watched);
  if (missing) {
    if (item.universe === "street") {
      return `Complete ${missing.title} next; it is the earliest unfinished prerequisite in this character or crossover path.`;
    }
    return `Complete ${missing.title} next; it is the earliest unfinished prerequisite for ${item.title}.`;
  }

  const releaseMoment = new Date(`${item.releaseDate}T00:00:00`).getTime();
  if (releaseMoment > Date.now()) {
    return `Scheduled transmission: releases ${new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(new Date(releaseMoment))}.`;
  }

  return null;
}

export function isUnlocked(item: ContentItem, watched: Set<string>) {
  return unlockReason(item, watched) === null;
}

export function formatRuntime(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutesLeft = Math.floor((seconds % 3600) / 60);
  const secondsLeft = seconds % 60;
  return `${String(hours).padStart(2, "0")}h ${String(minutesLeft).padStart(2, "0")}m ${String(secondsLeft).padStart(2, "0")}s`;
}
