/**
 * The client's queue of progress actions the server has not acknowledged yet, as pure functions
 * (NEXT_LEVEL_PLAN.md §4.6). `use-progress.ts` holds the queue and does the sending.
 *
 * What the user sees is the queue folded over the last state the server confirmed, with the same
 * reducer the server runs, so a tick appears at once and survives any reply that arrives meanwhile.
 */
import type { ContentItem } from "@/lib/catalogue/types";
import { applyAction, type Action, type ActionSuccess, type RuleCode } from "@/lib/engine/reducer";
import { progressKey, unitEpisodes, type ViewingState } from "@/lib/engine/state";

export type OutboxEntry = {
  /** Unique within one store. */
  id: number;
  action: Action;
  /** When it was dispatched (epoch milliseconds): the clock the fold applies it with. */
  at: number;
  /**
   * Only for `unwatch`: the titles the user agreed to lose. The server refuses with
   * `confirm-required` if the un-watch would clear anything else.
   */
  confirmCleared?: readonly string[];
};

/** Why an entry cannot be applied: a rule, or an un-watch that would clear more than was confirmed. */
export type EntryFailure = {
  ok: false;
  code: RuleCode | "confirm-required";
  message: string;
  contentId?: string;
  missingId?: string;
  /** For `confirm-required`: every title the un-watch would clear. */
  cleared?: string[];
};

/** A queued action that was not saved, and why: a server refusal, or a re-check after one. */
export type DroppedAction = {
  entry: OutboxEntry;
  failure: { code: string; message: string; contentId?: string; missingId?: string };
};

/** The reducer's answer for one queued entry, including the `confirmCleared` rule the server applies. */
export function applyEntry(state: ViewingState, entry: OutboxEntry, now: Date = new Date(entry.at)): ActionSuccess | EntryFailure {
  const outcome = applyAction(state, entry.action, now);
  if (!outcome.ok) return outcome;
  if (entry.confirmCleared) {
    const confirmed = new Set(entry.confirmCleared);
    if (outcome.cleared.some((id) => !confirmed.has(id))) {
      return {
        ok: false,
        code: "confirm-required",
        message: "This would also remove progress on other titles. Confirm to continue.",
        cleared: outcome.cleared,
      };
    }
  }
  return outcome;
}

/**
 * The state the UI shows: every queued action applied in order on top of `confirmed`. An entry
 * that no longer applies (the server's state moved on) is left out of the picture but stays
 * queued; the server refuses it when it is sent, and the user is told then.
 */
export function foldOutbox(confirmed: ViewingState, entries: readonly OutboxEntry[]): ViewingState {
  let state = confirmed;
  for (const entry of entries) {
    const outcome = applyEntry(state, entry);
    if (outcome.ok) state = outcome.state;
  }
  return state;
}

/**
 * After the server refused an action: checks the rest of the queue against the server's state,
 * in order. Entries that still apply stay queued; so does an un-watch that now needs a fresh
 * confirmation (the server asks for it when the entry is sent). Everything else is removed and
 * returned, so the user can be told what was not saved. The queue is never dropped wholesale.
 */
export function recheckOutbox(confirmed: ViewingState, entries: readonly OutboxEntry[], now: Date) {
  const kept: OutboxEntry[] = [];
  const removed: { entry: OutboxEntry; failure: EntryFailure }[] = [];
  let state = confirmed;
  for (const entry of entries) {
    const outcome = applyEntry(state, entry, now);
    if (outcome.ok) {
      kept.push(entry);
      state = outcome.state;
    } else if (outcome.code === "confirm-required") {
      kept.push(entry);
    } else {
      removed.push({ entry, failure: outcome });
    }
  }
  return { kept, removed };
}

/** The units (`progressKey`s) and whole titles that have an action waiting to be saved. */
export type PendingKeys = { units: ReadonlySet<string>; titles: ReadonlySet<string> };

export function pendingKeysOf(entries: readonly OutboxEntry[]): PendingKeys {
  const units = new Set<string>();
  const titles = new Set<string>();
  for (const { action } of entries) {
    switch (action.type) {
      case "watch":
      case "unwatch":
        units.add(progressKey(action.contentId, action.episode));
        break;
      case "watchAll":
      case "skip":
      case "unskip":
        titles.add(action.contentId);
        break;
      case "bulk":
        for (const id of [...action.watch, ...action.skip]) titles.add(id);
        break;
      case "import":
        for (const row of action.rows) units.add(progressKey(row.contentId, row.episode));
        for (const skip of action.skips) titles.add(skip.contentId);
        break;
    }
  }
  return { units, titles };
}

/** One unit (`episode` -1 for a movie or special) has an action waiting. */
export function isUnitPending(pending: PendingKeys, contentId: string, episode: number): boolean {
  return pending.titles.has(contentId) || pending.units.has(progressKey(contentId, episode));
}

/** Any unit of the title, or the title as a whole, has an action waiting. */
export function isTitlePending(pending: PendingKeys, item: ContentItem): boolean {
  return pending.titles.has(item.id) || unitEpisodes(item).some((episode) => pending.units.has(progressKey(item.id, episode)));
}
