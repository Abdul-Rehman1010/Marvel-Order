/**
 * The one place that changes a viewing state (NEXT_LEVEL_PLAN.md §4.4). Pure: `applyAction`
 * never mutates its input, does no I/O and takes the clock as an argument. The server runs it
 * inside a database transaction; the client runs the same code to predict the result.
 *
 * A failed action changes nothing. A successful one returns the new state plus the exact
 * difference from the old one, so the persistence layer writes only that difference.
 *
 * Rules worth knowing before changing anything here:
 * - Locks look at every transitive prerequisite and at "satisfied" (watched-complete OR skipped).
 * - Un-watching is always allowed, even on a locked title, so out-of-order rows can be removed.
 * - Un-watching clears the watched rows of every dependent title, but only when it makes a
 *   satisfied title unsatisfied. Skips are never removed by a cascade.
 * - Rows and skips the catalogue does not recognise are carried through untouched.
 */
import { CONTENT_BY_ID } from "../catalogue";
import type { ContentItem } from "../catalogue/types";
import { dependents, graphRank } from "./graph";
import { formatReleaseDate } from "./release";
import {
  isSatisfied,
  isUnitOf,
  isWatchedComplete,
  lockReason,
  progressKey,
  unitEpisodes,
  type ProgressRow,
  type SkipReason,
  type SkipRow,
  type ViewingState,
} from "./state";

export type Action =
  | { type: "watch"; contentId: string; episode: number }
  | { type: "unwatch"; contentId: string; episode: number }
  /** Every remaining unit of one title. */
  | { type: "watchAll"; contentId: string }
  | { type: "skip"; contentId: string; reason?: SkipReason }
  | { type: "unskip"; contentId: string }
  | { type: "bulk"; watch: string[]; skip: string[]; skipReason?: SkipReason; backfilled: boolean }
  /** Guest claim / JSON import: best effort, never all-or-nothing. */
  | { type: "import"; rows: ProgressRow[]; skips: SkipRow[] };

export type RuleCode =
  | "locked"
  | "unreleased"
  | "pending"
  | "episode-order"
  | "has-dependents"
  | "unknown-title"
  | "unknown-episode"
  | "invalid";

/** A row or skip an `import` left out, and why. A rejected skip has `episode: -1`. */
export type RejectedRow = { contentId: string; episode: number; reason: RuleCode };

export type ActionSuccess = {
  ok: true;
  state: ViewingState;
  addedRows: ProgressRow[];
  /** `progressKey`s of the watched rows that were removed. */
  removedKeys: string[];
  addedSkips: SkipRow[];
  /** Title ids whose skip was removed. */
  removedSkips: string[];
  /** OTHER titles whose watched rows were removed because they depended on the un-watched one. */
  cleared: string[];
  /** Only for `import`: what was left out. */
  rejected?: RejectedRow[];
};

export type ActionFailure = {
  ok: false;
  code: RuleCode;
  /** Plain words, safe to show to the user. */
  message: string;
  contentId?: string;
  /** For `locked`: the prerequisite to go and watch. */
  missingId?: string;
};

export type Outcome = ActionSuccess | ActionFailure;

/** A private working copy. It doubles as a `ViewingIndex`, kept in step with every change. */
class Draft {
  rows: ProgressRow[];
  skips: SkipRow[];
  readonly watched = new Set<string>();
  readonly skipped = new Set<string>();
  readonly addedRows: ProgressRow[] = [];
  readonly removedKeys: string[] = [];
  addedSkips: SkipRow[] = [];
  readonly removedSkips: string[] = [];
  readonly cleared: string[] = [];

  constructor(state: ViewingState) {
    this.rows = [...state.rows];
    this.skips = [...state.skips];
    for (const row of state.rows) {
      const item = CONTENT_BY_ID.get(row.contentId);
      if (item && isUnitOf(item, row.episode)) this.watched.add(progressKey(row.contentId, row.episode));
    }
    for (const skip of state.skips) {
      if (CONTENT_BY_ID.has(skip.contentId)) this.skipped.add(skip.contentId);
    }
  }

  addRow(item: ContentItem, row: ProgressRow) {
    this.rows.push(row);
    this.watched.add(progressKey(row.contentId, row.episode));
    this.addedRows.push(row);
    // A skip ends by itself only when the title becomes fully watched.
    if (this.skipped.has(item.id) && isWatchedComplete(item, this)) this.removeSkip(item.id);
  }

  /** Removes the watched rows of `item` for the given episode numbers (only units the title really has). */
  removeUnits(item: ContentItem, episodes: number[]) {
    const keys = new Set(episodes.map((episode) => progressKey(item.id, episode)).filter((key) => this.watched.has(key)));
    if (!keys.size) return 0;
    this.rows = this.rows.filter((row) => !(row.contentId === item.id && keys.has(progressKey(row.contentId, row.episode))));
    for (const key of keys) {
      this.watched.delete(key);
      this.removedKeys.push(key);
    }
    return keys.size;
  }

  addSkip(skip: SkipRow) {
    this.skips.push(skip);
    this.skipped.add(skip.contentId);
    this.addedSkips.push(skip);
  }

  removeSkip(contentId: string) {
    this.skips = this.skips.filter((skip) => skip.contentId !== contentId);
    this.skipped.delete(contentId);
    // A skip added and removed inside the same action (an import) was never stored.
    if (this.addedSkips.some((skip) => skip.contentId === contentId)) {
      this.addedSkips = this.addedSkips.filter((skip) => skip.contentId !== contentId);
    } else {
      this.removedSkips.push(contentId);
    }
  }

  hasWatchedRows(item: ContentItem) {
    return unitEpisodes(item).some((episode) => this.watched.has(progressKey(item.id, episode)));
  }

  success(rejected?: RejectedRow[]): ActionSuccess {
    return {
      ok: true,
      state: { rows: this.rows, skips: this.skips },
      addedRows: this.addedRows,
      removedKeys: this.removedKeys,
      addedSkips: this.addedSkips,
      removedSkips: this.removedSkips,
      cleared: this.cleared,
      ...(rejected ? { rejected } : {}),
    };
  }
}

function fail(code: RuleCode, message: string, extra: { contentId?: string; missingId?: string } = {}): ActionFailure {
  return { ok: false, code, message, ...extra };
}

const unknownTitle = (contentId: string) => fail("unknown-title", "That title is not in the catalogue.", { contentId });

function unknownEpisode(item: ContentItem, episode: number) {
  const message =
    item.kind === "series"
      ? `${item.title} has no episode ${episode}.`
      : `${item.title} is marked as a whole, not by episode.`;
  return fail("unknown-episode", message, { contentId: item.id });
}

/** The lock on a title, as a failure, or `null` when it can be watched now. */
function lockFailure(draft: Draft, item: ContentItem, now: Date): ActionFailure | null {
  const lock = lockReason(item, draft, now);
  if (!lock) return null;
  if (lock.kind === "prerequisite") {
    return fail("locked", `Watch ${lock.item.title} first to unlock ${item.title}.`, { contentId: item.id, missingId: lock.item.id });
  }
  if (lock.kind === "unreleased") {
    return fail("unreleased", `${item.title} is not out until ${formatReleaseDate(lock.date)}.`, { contentId: item.id });
  }
  return fail("pending", `The episode list for ${item.title} has not been published yet.`, { contentId: item.id });
}

/** Marks one unit watched. An already-watched unit is left exactly as it is. */
function watchUnit(draft: Draft, item: ContentItem, episode: number, now: Date, row: Pick<ProgressRow, "watchedAt" | "backfilled">) {
  if (!isUnitOf(item, episode)) return unknownEpisode(item, episode);
  if (draft.watched.has(progressKey(item.id, episode))) return null;
  const locked = lockFailure(draft, item, now);
  if (locked) return locked;
  if (item.kind === "series" && episode > 1 && !draft.watched.has(progressKey(item.id, episode - 1))) {
    return fail("episode-order", `Watch episode ${episode - 1} of ${item.title} first.`, { contentId: item.id });
  }
  draft.addRow(item, { contentId: item.id, episode, watchedAt: row.watchedAt, backfilled: row.backfilled });
  return null;
}

/** Marks every remaining unit of one title watched. Units already watched are left as they are. */
function watchAllUnits(draft: Draft, item: ContentItem, now: Date, backfilled: boolean) {
  const remaining = unitEpisodes(item).filter((episode) => !draft.watched.has(progressKey(item.id, episode)));
  if (!remaining.length) return null;
  const locked = lockFailure(draft, item, now);
  if (locked) return locked;
  const watchedAt = now.toISOString();
  for (const episode of remaining) draft.addRow(item, { contentId: item.id, episode, watchedAt, backfilled });
  return null;
}

function unwatchUnit(draft: Draft, item: ContentItem, episode: number) {
  if (!isUnitOf(item, episode)) return unknownEpisode(item, episode);
  if (!draft.watched.has(progressKey(item.id, episode))) return null; // nothing to remove, and no cascade

  const wasSatisfied = isSatisfied(item, draft);
  // A series keeps a 1..n prefix: removing episode k also removes the later ones.
  draft.removeUnits(item, item.kind === "series" ? unitEpisodes(item).filter((candidate) => candidate >= episode) : [episode]);

  if (wasSatisfied && !isSatisfied(item, draft)) {
    for (const id of dependents(item.id)) {
      const dependent = CONTENT_BY_ID.get(id)!;
      if (draft.removeUnits(dependent, unitEpisodes(dependent)) > 0) draft.cleared.push(id);
    }
  }
  return null;
}

function skipTitle(draft: Draft, item: ContentItem, reason: SkipReason, skippedAt: string) {
  // Idempotent, and pointless on a fully watched title (a skip there would end at once).
  if (draft.skipped.has(item.id) || isWatchedComplete(item, draft)) return;
  draft.addSkip({ contentId: item.id, reason, skippedAt });
}

function unskipTitle(draft: Draft, item: ContentItem) {
  if (!draft.skipped.has(item.id)) return null;
  if (!isWatchedComplete(item, draft)) {
    const blocking = dependents(item.id).some((id) => draft.hasWatchedRows(CONTENT_BY_ID.get(id)!));
    if (blocking) {
      return fail(
        "has-dependents",
        `Later titles you have watched depend on ${item.title}. Mark it watched instead, or remove the later progress first.`,
        { contentId: item.id },
      );
    }
  }
  draft.removeSkip(item.id);
  return null;
}

const unique = (ids: string[]) => [...new Set(ids)];
const isSkipReason = (value: unknown): value is SkipReason => value === "manual" || value === "triage";
const byGraphOrder = (a: string, b: string) => graphRank(a) - graphRank(b);

function applyBulk(draft: Draft, action: Extract<Action, { type: "bulk" }>, now: Date) {
  const watch = unique(action.watch);
  const skip = unique(action.skip);
  const both = watch.find((id) => skip.includes(id));
  if (both !== undefined) return fail("invalid", "A title cannot be both watched and skipped in one request.", { contentId: both });
  const unknown = [...watch, ...skip].find((id) => !CONTENT_BY_ID.has(id));
  if (unknown !== undefined) return unknownTitle(unknown);

  const stamp = now.toISOString();
  for (const id of skip) skipTitle(draft, CONTENT_BY_ID.get(id)!, action.skipReason ?? "manual", stamp);
  // Graph order, so each title's prerequisites are handled before it.
  for (const id of watch.sort(byGraphOrder)) {
    const failure = watchAllUnits(draft, CONTENT_BY_ID.get(id)!, now, action.backfilled);
    if (failure) return failure;
  }
  return null;
}

function applyImport(draft: Draft, action: Extract<Action, { type: "import" }>, now: Date): RejectedRow[] {
  const rejected: RejectedRow[] = [];

  for (const skip of action.skips) {
    const item = CONTENT_BY_ID.get(skip.contentId);
    if (!item) rejected.push({ contentId: skip.contentId, episode: -1, reason: "unknown-title" });
    else if (!isSkipReason(skip.reason) || Number.isNaN(Date.parse(skip.skippedAt))) {
      rejected.push({ contentId: skip.contentId, episode: -1, reason: "invalid" });
    } else skipTitle(draft, item, skip.reason, skip.skippedAt);
  }

  // Oldest first; graph order, then episode number, where timestamps are equal.
  const rows = action.rows
    .map((row) => ({ row, time: Date.parse(row.watchedAt) }))
    .sort((a, b) => {
      if (Number.isNaN(a.time) || Number.isNaN(b.time)) return Number(Number.isNaN(a.time)) - Number(Number.isNaN(b.time));
      return a.time - b.time || byGraphOrder(a.row.contentId, b.row.contentId) || a.row.episode - b.row.episode;
    });

  // Rows waiting on something another row may still provide (a prerequisite or an earlier
  // episode) are tried again until a whole pass accepts nothing. Timestamps alone are not a safe
  // order: a title watched while its prerequisite was skipped is older than the prerequisite's
  // rows if that prerequisite was watched afterwards. Retrying makes the result independent of
  // the order and makes a repeated import a no-op.
  let waiting: { row: ProgressRow; reason: RuleCode }[] = [];
  for (const { row, time } of rows) {
    const item = CONTENT_BY_ID.get(row.contentId);
    if (!item) {
      rejected.push({ contentId: row.contentId, episode: row.episode, reason: "unknown-title" });
    } else if (Number.isNaN(time) || typeof row.backfilled !== "boolean") {
      rejected.push({ contentId: row.contentId, episode: row.episode, reason: "invalid" });
    } else {
      waiting.push({ row, reason: "locked" });
    }
  }

  for (let progressed = true; progressed && waiting.length; ) {
    progressed = false;
    const stillWaiting: typeof waiting = [];
    for (const { row } of waiting) {
      // The normal watch rule, but the row keeps its own timestamp and flag.
      const failure = watchUnit(draft, CONTENT_BY_ID.get(row.contentId)!, row.episode, now, row);
      if (!failure) progressed = true;
      else if (failure.code === "locked" || failure.code === "episode-order") stillWaiting.push({ row, reason: failure.code });
      else rejected.push({ contentId: row.contentId, episode: row.episode, reason: failure.code });
    }
    waiting = stillWaiting;
  }
  for (const { row, reason } of waiting) rejected.push({ contentId: row.contentId, episode: row.episode, reason });
  return rejected;
}

/**
 * Applies one action to a viewing state.
 * @param now The moment the action happens: it stamps new rows and decides release locks.
 */
export function applyAction(state: ViewingState, action: Action, now: Date): Outcome {
  const draft = new Draft(state);

  if (action.type === "bulk") {
    return applyBulk(draft, action, now) ?? draft.success();
  }
  if (action.type === "import") {
    return draft.success(applyImport(draft, action, now));
  }

  const item = CONTENT_BY_ID.get(action.contentId);
  if (!item) return unknownTitle(action.contentId);

  let failure: ActionFailure | null = null;
  switch (action.type) {
    case "watch":
      failure = watchUnit(draft, item, action.episode, now, { watchedAt: now.toISOString(), backfilled: false });
      break;
    case "unwatch":
      failure = unwatchUnit(draft, item, action.episode);
      break;
    case "watchAll":
      failure = watchAllUnits(draft, item, now, false);
      break;
    case "skip":
      skipTitle(draft, item, action.reason ?? "manual", now.toISOString());
      break;
    case "unskip":
      failure = unskipTitle(draft, item);
      break;
    default:
      return fail("invalid", "That action is not supported.");
  }
  return failure ?? draft.success();
}
