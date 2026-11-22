/**
 * Compatibility barrel (NEXT_LEVEL_PLAN.md §4.2); deleted in package 5.5.
 * - Catalogue data and types come from `src/lib/catalogue`.
 * - Prerequisite structure comes from `src/lib/engine/graph.ts`.
 * - The helpers below keep their pre-1.3 names and their bare `Set<string>` argument, but since
 *   package 1.3 they only forward to the rules engine (`src/lib/engine/state.ts`). New code should
 *   import the engine directly and pass a viewing index. They stay because the characterisation
 *   tests pin them, which proves the engine still gives the old answers for watched-only states.
 *
 * Imports are relative so `scripts/catalogue-check.mjs` can load this file without the `@/` alias.
 */
import { CONTENT_BY_ID, type ContentItem } from "./catalogue";
import { formatLockReason } from "./engine/format";
import { directPrerequisites, prerequisiteChain } from "./engine/graph";
import * as engine from "./engine/state";

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
export { progressKey } from "./engine/state";

function toItems(ids: string[]): ContentItem[] {
  return ids.flatMap((id) => {
    const item = CONTENT_BY_ID.get(id);
    return item ? [item] : [];
  });
}

export function itemUnits(item: ContentItem) {
  return item.kind === "series" ? item.episodes?.length ?? 0 : 1;
}

/** @deprecated Use `isWatchedComplete(item, index)` from `@/lib/engine/state`. */
export function itemComplete(item: ContentItem, watched: Set<string>) {
  return engine.isWatchedComplete(item, engine.indexOfKeys(watched));
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

/** @deprecated Use `missingPrerequisite(item, index)` from `@/lib/engine/state`. */
export function missingPrerequisite(item: ContentItem, watched: Set<string>): ContentItem | null {
  return engine.missingPrerequisite(item, engine.indexOfKeys(watched));
}

/**
 * The pre-1.3 lock: an unfinished prerequisite or a future release date. It does NOT report the
 * newer "episode list not published" lock, so a `dataPending` series still reads as unlocked here,
 * exactly as it did before.
 */
function legacyLock(item: ContentItem, watched: Set<string>) {
  const lock = engine.lockReason(item, engine.indexOfKeys(watched), Date.now());
  return lock && lock.kind !== "pending" ? lock : null;
}

/** @deprecated Use `lockReason` from `@/lib/engine/state` with `formatLockReason` from `@/lib/engine/format`. */
export function unlockReason(item: ContentItem, watched: Set<string>) {
  const lock = legacyLock(item, watched);
  return lock ? formatLockReason(item, lock) : null;
}

/** @deprecated Use `lockReason(item, index, now) === null` from `@/lib/engine/state`. */
export function isUnlocked(item: ContentItem, watched: Set<string>) {
  return legacyLock(item, watched) === null;
}
