/**
 * What the user is told about a progress action (NEXT_LEVEL_PLAN.md 2.1): the toasts after it,
 * the confirmation before an un-watch that would remove more, and the message when the server
 * refused something. Pure; the words follow ground rule 9 (plain words for actions and errors).
 */
import { CONTENT, CONTENT_BY_ID, MCU_CONTENT, XMEN_CONTENT } from "@/lib/catalogue";
import type { ContentItem } from "@/lib/catalogue/types";
import { formatDuration } from "@/lib/engine/format";
import { milestonesReached, newlyUnlocked } from "@/lib/engine/milestones";
import { applyAction, type Action } from "@/lib/engine/reducer";
import { getStats } from "@/lib/engine/stats";
import {
  indexOf,
  isWatchedComplete,
  progressKey,
  unitEpisodes,
  watchedUnitCount,
  type SkipReason,
  type SkipRow,
  type ViewingIndex,
  type ViewingState,
} from "@/lib/engine/state";

import type { DroppedAction } from "./outbox";

/**
 * What a toast's Undo reverses: the un-watch of `episode` (and, for a series, the episodes after
 * it). `restoreSkip` is set when the action ended a skip, so the Undo puts the skip back too.
 * `addedEpisodes` lists every episode the action added ("Mark all N remaining"): removing those
 * is what the Undo is for, so it does not ask about them.
 */
export type UndoTarget = { contentId: string; episode: number; restoreSkip?: SkipReason; addedEpisodes?: number[] };

export type ToastSpec =
  | { kind: "unlock"; item: ContentItem; more: number }
  | { kind: "checkpoint"; title: string; detail: string; undo?: UndoTarget }
  | { kind: "milestone"; title: string; detail: string };

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const titleOf = (id: string) => CONTENT_BY_ID.get(id)?.title ?? id;
/** The titles Doomsday readiness is measured over (the required ones among them), as on the dashboard. */
const DOOMSDAY_TITLES = [...MCU_CONTENT, ...XMEN_CONTENT];

/** "Iron Man", or "WandaVision E03" for an episode. */
function unitLabel(contentId: string, episode: number) {
  const item = CONTENT_BY_ID.get(contentId);
  if (!item) return contentId;
  return item.kind === "series" && episode > 0 ? `${item.title} E${String(episode).padStart(2, "0")}` : item.title;
}

/** A short name for an action, used in messages about it. */
export function describeAction(action: Action): string {
  switch (action.type) {
    case "watch":
      return unitLabel(action.contentId, action.episode);
    case "unwatch":
      return `un-watching ${unitLabel(action.contentId, action.episode)}`;
    case "watchAll": {
      const item = CONTENT_BY_ID.get(action.contentId);
      return item?.kind === "series" ? `${item.title} (all episodes)` : titleOf(action.contentId);
    }
    case "skip":
      return `skipping ${titleOf(action.contentId)}`;
    case "unskip":
      return `un-skipping ${titleOf(action.contentId)}`;
    case "bulk":
      return `marking ${plural(new Set([...action.watch, ...action.skip]).size, "title")}`;
    case "import":
      return "the import";
  }
}

function reasonText(failure: DroppedAction["failure"]) {
  switch (failure.code) {
    case "locked":
      return failure.missingId ? `needs ${titleOf(failure.missingId)}` : "a title before it is not watched yet";
    case "unreleased":
      return "not released yet";
    case "pending":
      return "its episode list is not published yet";
    case "episode-order":
      return "an earlier episode is not watched";
    case "has-dependents":
      return "later titles you watched depend on it";
    case "confirm-required":
      return "it would also remove progress on other titles";
    case "unknown-title":
    case "unknown-episode":
    case "invalid":
      return "that change is not valid";
    default:
      return failure.message.replace(/[.\s]+$/, "") || "the server refused it";
  }
}

/**
 * One message for a refused action and every queued action removed with it, so nothing
 * disappears silently: "Couldn't save: Thor — needs Iron Man 2. Also not saved: …".
 */
export function rejectionNotice(rejected: DroppedAction, removed: readonly DroppedAction[]): string {
  const notice = `Couldn't save: ${describeAction(rejected.entry.action)} — ${reasonText(rejected.failure)}.`;
  return removed.length ? `${notice} Also not saved: ${removed.map(({ entry }) => describeAction(entry.action)).join(", ")}.` : notice;
}

/** For queued actions removed without a refusal of their own (after the server asked to confirm an un-watch). */
export function removedNotice(removed: readonly DroppedAction[]): string {
  return `Not saved: ${removed.map(({ entry }) => describeAction(entry.action)).join(", ")} (${removed.length === 1 ? "it no longer applies" : "they no longer apply"}).`;
}

export type UnwatchImpact = {
  /** Later episodes of the same series that would be removed with it. */
  laterEpisodes: number[];
  /** Other titles whose progress would be removed, and how many watched units each has. */
  cleared: { item: ContentItem; units: number }[];
};

/**
 * Exactly what un-watching one unit would remove besides that unit, from the reducer itself.
 * `null` when it is not a valid un-watch (an episode the title does not have). `restoreSkip` is
 * the Undo of a watch that ended a skip: the skip comes back, so nothing later is cleared.
 */
export function unwatchImpact(state: ViewingState, contentId: string, episode: number, now: Date, restoreSkip?: SkipReason): UnwatchImpact | null {
  const outcome = applyAction(state, { type: "unwatch", contentId, episode, ...(restoreSkip ? { restoreSkip } : {}) }, now);
  if (!outcome.ok) return null;
  const laterEpisodes: number[] = [];
  const units = new Map<string, number>();
  for (const key of outcome.removedKeys) {
    const split = key.lastIndexOf(":");
    const id = key.slice(0, split);
    const removedEpisode = Number(key.slice(split + 1));
    if (id === contentId) {
      if (removedEpisode !== episode) laterEpisodes.push(removedEpisode);
    } else {
      units.set(id, (units.get(id) ?? 0) + 1);
    }
  }
  return {
    laterEpisodes: laterEpisodes.sort((a, b) => a - b),
    cleared: outcome.cleared.map((id) => ({ item: CONTENT_BY_ID.get(id)!, units: units.get(id) ?? 0 })),
  };
}

/** Ask first only when later episodes or other titles would go too. */
export function needsConfirmation(impact: UnwatchImpact): boolean {
  return impact.laterEpisodes.length > 0 || impact.cleared.length > 0;
}

export type SkipImpact = {
  /** Titles that can be watched once this one is skipped (catalogue order). */
  unlocks: ContentItem[];
  /** Units of this title already watched; a skip keeps them. */
  keptUnits: number;
};

/** What skipping a title would do, for the confirmation: which titles open, and what is kept. */
export function skipImpact(state: ViewingState, contentId: string, now: Date): SkipImpact | null {
  const item = CONTENT_BY_ID.get(contentId);
  if (!item) return null;
  const outcome = applyAction(state, { type: "skip", contentId }, now);
  if (!outcome.ok) return null;
  const before = indexOf(state);
  return { unlocks: newlyUnlocked(before, indexOf(outcome.state), now), keptUnits: watchedUnitCount(item, before) };
}

function unitRuntime(item: ContentItem, episode: number) {
  return item.kind === "series" ? (item.episodes?.find((candidate) => candidate.id === episode)?.runtimeSec ?? 0) : item.runtimeSec;
}

/** Units of `item` watched after the action that were not watched before it. */
function addedUnits(item: ContentItem, before: ViewingIndex, after: ViewingIndex) {
  return unitEpisodes(item).filter((episode) => !before.watched.has(progressKey(item.id, episode)) && after.watched.has(progressKey(item.id, episode)));
}

const hasRows = (item: ContentItem, index: ViewingIndex) => unitEpisodes(item).some((episode) => index.watched.has(progressKey(item.id, episode)));

/**
 * @param endedSkip The reason of the skip this action ended (the title was skipped and is now
 *   fully watched). The Undo then puts the skip back, so later titles keep their progress.
 */
function checkpointToast(item: ContentItem, added: number[], countEpisodes: boolean, endedSkip?: SkipReason): ToastSpec {
  const seconds = added.reduce((sum, episode) => sum + unitRuntime(item, episode), 0);
  const prefix = countEpisodes ? `${plural(added.length, "episode")} · ` : "";
  const towardDoomsday = item.required && item.universe !== "street";
  const logged = seconds > 0
    ? `${prefix}${formatDuration(seconds)} ${towardDoomsday ? "closer to Doomsday" : "logged in your archive"}`
    : `${prefix}${item.title} logged in your archive`;
  const undo: UndoTarget = {
    contentId: item.id,
    episode: Math.min(...added),
    ...(endedSkip ? { restoreSkip: endedSkip } : {}),
    ...(added.length > 1 ? { addedEpisodes: [...added].sort((a, b) => a - b) } : {}),
  };
  return { kind: "checkpoint", title: "Checkpoint secured", detail: endedSkip ? `${logged} · no longer skipped` : logged, undo };
}

/** The reason of the skip on `item` that the action ended, if it ended one. */
function endedSkipOf(item: ContentItem, before: ViewingIndex, after: ViewingIndex, previousSkips: readonly SkipRow[]): SkipReason | undefined {
  if (!before.skipped.has(item.id) || after.skipped.has(item.id)) return undefined;
  return previousSkips.find((skip) => skip.contentId === item.id)?.reason ?? "manual";
}

function celebrationToasts(before: ViewingIndex, after: ViewingIndex, now: Date | number): ToastSpec[] {
  const toasts: ToastSpec[] = [];
  const revealed = newlyUnlocked(before, after, now);
  if (revealed.length) toasts.push({ kind: "unlock", item: revealed[0], more: revealed.length - 1 });
  for (const milestone of milestonesReached(before, after)) toasts.push({ kind: "milestone", title: milestone.title, detail: milestone.detail });
  return toasts;
}

/**
 * The toasts for an action, from the viewing indexes before and after it. Empty when the action
 * changed nothing. A bulk action gets exactly one summary toast, since the stack keeps one toast
 * per kind and several milestones would replace each other.
 * @param previousSkips The skip rows before the action, so an Undo can restore a skip it ended
 *   with its original reason.
 */
export function actionToasts(
  action: Action,
  before: ViewingIndex,
  after: ViewingIndex,
  now: Date | number,
  previousSkips: readonly SkipRow[] = [],
): ToastSpec[] {
  if (action.type === "import") return [];

  if (action.type === "bulk") {
    const watched = [...new Set(action.watch)].flatMap((id) => CONTENT_BY_ID.get(id) ?? []);
    const completed = watched.filter((item) => !isWatchedComplete(item, before) && isWatchedComplete(item, after)).length;
    const skipped = [...new Set(action.skip)].filter((id) => after.skipped.has(id) && !before.skipped.has(id)).length;
    if (!completed && !skipped) return [];
    const seconds = watched.reduce((sum, item) => sum + addedUnits(item, before, after).reduce((total, episode) => total + unitRuntime(item, episode), 0), 0);
    const milestones = milestonesReached(before, after);
    if (action.backfilled) {
      // The catch-up wizard (2.3): one toast with the readiness the dashboard now shows.
      const readiness = getStats(DOOMSDAY_TITLES, after).percent;
      const title = `Caught up: ${plural(completed, "title")}${skipped ? `, skipped ${skipped}` : ""} · readiness now ${readiness}%`;
      const detail = milestones.length
        ? milestones.map((milestone) => milestone.title).join(" · ")
        : completed ? `${formatDuration(seconds)} logged in your archive` : "Skipped titles count as cleared for unlocking later titles.";
      return [{ kind: milestones.length ? "milestone" : "checkpoint", title, detail }];
    }
    const title = completed && skipped
      ? `Marked ${plural(completed, "title")} watched, skipped ${skipped}`
      : completed ? `Marked ${plural(completed, "title")} watched` : `Skipped ${plural(skipped, "title")}`;
    const detail = milestones.length
      ? milestones.map((milestone) => milestone.title).join(" · ")
      : completed ? `${formatDuration(seconds)} logged in your archive` : "They count as cleared for unlocking later titles, not as watched.";
    return [{ kind: milestones.length ? "milestone" : "checkpoint", title, detail }];
  }

  const item = CONTENT_BY_ID.get(action.contentId);
  if (!item) return [];

  switch (action.type) {
    case "watch": {
      if (!addedUnits(item, before, after).includes(action.episode)) return [];
      const endedSkip = endedSkipOf(item, before, after, previousSkips);
      return [checkpointToast(item, [action.episode], false, endedSkip), ...celebrationToasts(before, after, now)];
    }
    case "watchAll": {
      const added = addedUnits(item, before, after);
      if (!added.length) return [];
      const endedSkip = endedSkipOf(item, before, after, previousSkips);
      return [checkpointToast(item, added, item.kind === "series", endedSkip), ...celebrationToasts(before, after, now)];
    }
    case "unwatch": {
      const removed = unitEpisodes(item).filter((episode) => before.watched.has(progressKey(item.id, episode)) && !after.watched.has(progressKey(item.id, episode)));
      if (!removed.length) return [];
      const cleared = CONTENT.filter((candidate) => candidate.id !== item.id && hasRows(candidate, before) && !hasRows(candidate, after)).length;
      const label = removed.length > 1 ? `${unitLabel(item.id, removed[0])} and ${plural(removed.length - 1, "later episode")}` : unitLabel(item.id, removed[0]);
      const reskipped = after.skipped.has(item.id) && !before.skipped.has(item.id);
      const detail = cleared ? `${label} · also cleared ${plural(cleared, "later title")}` : reskipped ? `${label} · skipped again` : label;
      return [{ kind: "checkpoint", title: "Removed from watched", detail }];
    }
    case "skip": {
      if (!after.skipped.has(item.id) || before.skipped.has(item.id)) return [];
      const revealed = newlyUnlocked(before, after, now);
      if (!revealed.length) {
        return [{ kind: "checkpoint", title: `Skipped ${item.title}`, detail: "It counts as cleared for unlocking later titles, not as watched." }];
      }
      const more = revealed.length > 1 ? ` +${revealed.length - 1} more unlocked.` : "";
      return [{ kind: "checkpoint", title: "Skipped — later titles unlocked", detail: `${revealed[0].title} is ready to watch.${more}` }];
    }
    case "unskip": {
      if (!before.skipped.has(item.id) || after.skipped.has(item.id)) return [];
      return [{ kind: "checkpoint", title: "Skip removed", detail: `${item.title} counts as still to watch again.` }];
    }
  }
}
