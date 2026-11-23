/**
 * The client progress store and its React hook (NEXT_LEVEL_PLAN.md §4.6). The app's progress
 * lives here, not in components.
 *
 * The store keeps `confirmed` (the last state the server returned) and the outbox (actions the
 * server has not acknowledged yet). The UI renders the outbox folded over `confirmed`, so a tick
 * shows at once and no code path waits for the server first. One drain loop sends the queued
 * actions one at a time, in order:
 *
 * - 200: `confirmed` becomes the server's state and the action leaves the queue.
 * - 409 `confirm-required`: the action leaves the queue, `confirmed` becomes the server's state,
 *   and a `confirm-required` event asks the UI to show the confirmation again with the server's list.
 * - any other refusal (409, 400, 403): only that action leaves the queue; `confirmed` becomes the
 *   server's state (fetched when the reply has none); the rest of the queue is re-checked in order
 *   and what no longer applies is removed. One `rejected` event names all of them. The queue is
 *   never dropped wholesale.
 * - 401: the queue is dropped and a `signed-out` event is sent.
 * - network failure, 5xx, 408 or 429: the queue is kept, `status` becomes "offline", and the head
 *   is tried again after 2 s, 5 s, 15 s and then every 60 s, or at once on `retryNow()` (the hook
 *   calls it on the browser's `online` event and when the tab becomes visible again).
 *
 * Retrying is safe: watching a watched unit and un-watching an absent one change nothing.
 *
 * The React docs' `useOptimistic` (node_modules/next/dist/docs/01-app/02-guides/interactive-apps.md)
 * is not used: its optimistic value lasts only while one transition is pending, while this queue
 * has to outlive failed requests, keep its order and be retried with back-off.
 */
import { useEffect, useState, useSyncExternalStore } from "react";

import type { Action, ActionSuccess } from "@/lib/engine/reducer";
import { EMPTY_STATE, indexOf, type ViewingIndex, type ViewingState } from "@/lib/engine/state";

import type { LoadResult, ProgressGateway, SendResult } from "./gateway";
import {
  applyEntry,
  foldOutbox,
  pendingKeysOf,
  recheckOutbox,
  type DroppedAction,
  type EntryFailure,
  type OutboxEntry,
  type PendingKeys,
} from "./outbox";

/** Delays between attempts while the server cannot be reached; the last one repeats. */
export const RETRY_BACKOFF_MS = [2_000, 5_000, 15_000, 60_000] as const;

export type SyncStatus = "online" | "offline";

export type ProgressSnapshot = {
  /** The last state the server returned. */
  confirmed: ViewingState;
  /** `confirmed` with every queued action applied: what the UI shows. */
  state: ViewingState;
  /** Lookup sets for `state`. */
  index: ViewingIndex;
  /** Actions the server has not acknowledged yet, oldest first. */
  outbox: readonly OutboxEntry[];
  /** Units and titles with an action in the outbox, for the saving indicator. */
  pending: PendingKeys;
  /** "offline" after a failed attempt, until the server is reached again. */
  status: SyncStatus;
};

export type SyncEvent =
  /** The server refused `rejected`; `removed` are queued actions that no longer applied after it. */
  | { type: "rejected"; rejected: DroppedAction; removed: DroppedAction[] }
  /** An un-watch would clear titles the user did not confirm. Ask again with the server's `cleared`. */
  | { type: "confirm-required"; entry: OutboxEntry; cleared: string[]; removed: DroppedAction[] }
  /** The session ended; `lost` queued actions could not be saved. */
  | { type: "signed-out"; lost: number };

export type DispatchResult =
  /**
   * `before` and `after` are the viewing indexes on screen just before and just after this action,
   * captured before the optimistic update: compute toasts from this pair. `changed` is false when
   * the action changed nothing; such an action is not queued.
   */
  | { ok: true; changed: boolean; before: ViewingIndex; after: ViewingIndex; outcome: ActionSuccess }
  /** Not allowed by the rules (or an un-watch that needs confirming first). Nothing was queued. */
  | { ok: false; failure: EntryFailure };

export type ProgressStore = ReturnType<typeof createProgressStore>;

function makeSnapshot(confirmed: ViewingState, outbox: readonly OutboxEntry[], status: SyncStatus): ProgressSnapshot {
  const state = outbox.length ? foldOutbox(confirmed, outbox) : confirmed;
  return { confirmed, state, index: indexOf(state), outbox, pending: pendingKeysOf(outbox), status };
}

const changesSomething = (outcome: ActionSuccess) =>
  outcome.addedRows.length + outcome.removedKeys.length + outcome.addedSkips.length + outcome.removedSkips.length > 0;

export function createProgressStore(gateway: ProgressGateway, options: { clock?: () => Date } = {}) {
  const clock = options.clock ?? (() => new Date());
  const listeners = new Set<() => void>();
  const eventListeners = new Set<(event: SyncEvent) => void>();
  let snapshot = makeSnapshot(EMPTY_STATE, [], "online");
  let nextId = 1;
  /** Bumped by `reset` and sign-out, so a reply that arrives later for the old session is ignored. */
  let generation = 0;
  let drainingGeneration = -1;
  let failures = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  function publish(next: ProgressSnapshot) {
    snapshot = next;
    for (const listener of [...listeners]) listener();
  }

  function emit(event: SyncEvent) {
    for (const listener of [...eventListeners]) listener(event);
  }

  function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function clearRetry() {
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
  }

  function goOffline() {
    failures += 1;
    if (snapshot.status !== "offline") publish({ ...snapshot, status: "offline" });
    clearRetry();
    const delay = RETRY_BACKOFF_MS[Math.min(failures, RETRY_BACKOFF_MS.length) - 1];
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void drain();
    }, delay);
  }

  /** The server answered: take its state and what is left of the queue. */
  function settle(confirmed: ViewingState, outbox: readonly OutboxEntry[]) {
    failures = 0;
    publish(makeSnapshot(confirmed, outbox, "online"));
  }

  function endSession() {
    const lost = snapshot.outbox.length;
    generation += 1;
    clearRetry();
    failures = 0;
    publish(makeSnapshot(EMPTY_STATE, [], "online"));
    emit({ type: "signed-out", lost });
  }

  async function send(entry: OutboxEntry): Promise<SendResult> {
    try {
      return await gateway.send(entry.action, entry.confirmCleared);
    } catch {
      return { kind: "unavailable" };
    }
  }

  async function load(): Promise<LoadResult> {
    try {
      return await gateway.load();
    } catch {
      return { kind: "unavailable", message: "" };
    }
  }

  async function drain(): Promise<void> {
    if (drainingGeneration === generation) return;
    const mine = generation;
    drainingGeneration = mine;
    try {
      for (;;) {
        const entry = snapshot.outbox[0];
        if (generation !== mine || !entry) return;
        const result = await send(entry);
        if (generation !== mine) return;

        if (result.kind === "ok") {
          settle(result.state, snapshot.outbox.slice(1));
        } else if (result.kind === "confirm-required") {
          const { kept, removed } = recheckOutbox(result.state, snapshot.outbox.slice(1), clock());
          settle(result.state, kept);
          emit({ type: "confirm-required", entry, cleared: result.cleared, removed });
        } else if (result.kind === "rejected") {
          // The refusal means the server's state differs from ours: get it before re-checking.
          let confirmed = result.state;
          if (!confirmed) {
            const fresh = await load();
            if (generation !== mine) return;
            if (fresh.kind === "signed-out") return endSession();
            // Without the server's state nothing can be re-checked safely: try the whole step again later.
            if (fresh.kind !== "ok") return goOffline();
            confirmed = fresh.state;
          }
          const { kept, removed } = recheckOutbox(confirmed, snapshot.outbox.slice(1), clock());
          settle(confirmed, kept);
          const failure = { code: result.code, message: result.message, contentId: result.contentId, missingId: result.missingId };
          emit({ type: "rejected", rejected: { entry, failure }, removed });
        } else if (result.kind === "signed-out") {
          return endSession();
        } else {
          return goOffline();
        }
      }
    } finally {
      if (drainingGeneration === mine) drainingGeneration = -1;
    }
  }

  /**
   * Applies an action on screen at once and queues it for the server. Refused without queueing
   * when the rules do not allow it, or when an un-watch would clear titles not in `confirmCleared`
   * (the UI asks first). For `unwatch`, `confirmCleared` is always sent, empty when nothing
   * should be cleared, so the server refuses if another device added progress that would be.
   */
  function dispatch(action: Action, options: { confirmCleared?: readonly string[] } = {}): DispatchResult {
    const now = clock();
    const entry: OutboxEntry = {
      id: nextId,
      action,
      at: now.getTime(),
      ...(action.type === "unwatch" ? { confirmCleared: [...(options.confirmCleared ?? [])] } : {}),
    };
    const outcome = applyEntry(snapshot.state, entry, now);
    if (!outcome.ok) return { ok: false, failure: outcome };
    const before = snapshot.index;
    if (!changesSomething(outcome)) return { ok: true, changed: false, before, after: before, outcome };

    nextId += 1;
    const after = indexOf(outcome.state);
    const outbox = [...snapshot.outbox, entry];
    publish({ ...snapshot, state: outcome.state, index: after, outbox, pending: pendingKeysOf(outbox) });
    // While offline, the scheduled retry (or the browser coming back online) sends it.
    if (retryTimer === null) void drain();
    return { ok: true, changed: true, before, after, outcome };
  }

  return {
    subscribe,
    getSnapshot: () => snapshot,
    /** Sync problems the UI has to tell the user about. Returns the unsubscribe function. */
    onEvent(listener: (event: SyncEvent) => void) {
      eventListeners.add(listener);
      return () => {
        eventListeners.delete(listener);
      };
    },
    dispatch,
    /** A fresh start from a loaded state (after sign-in or sign-out): the queue is dropped. */
    reset(state: ViewingState) {
      generation += 1;
      clearRetry();
      failures = 0;
      publish(makeSnapshot(state, [], "online"));
    },
    /** Try the queue now instead of waiting for the next scheduled retry. */
    retryNow() {
      if (!snapshot.outbox.length) return;
      clearRetry();
      void drain();
    },
    /** Resolves true once the queue is empty, or false after `timeoutMs`. */
    whenIdle(timeoutMs: number): Promise<boolean> {
      if (!snapshot.outbox.length) return Promise.resolve(true);
      return new Promise((resolve) => {
        const unsubscribe = subscribe(() => {
          if (snapshot.outbox.length) return;
          clearTimeout(timer);
          unsubscribe();
          resolve(true);
        });
        const timer = setTimeout(() => {
          unsubscribe();
          resolve(false);
        }, timeoutMs);
      });
    },
  };
}

/**
 * The progress store for the mounted app, plus the browser wiring: try again at once when the
 * connection or the tab comes back, and warn before the tab is closed or reloaded while changes
 * are still waiting to be saved. The gateway is fixed for the component's lifetime.
 */
export function useProgress(gateway: ProgressGateway) {
  const [store] = useState(() => createProgressStore(gateway));
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  useEffect(() => {
    const retry = () => store.retryNow();
    const retryWhenShown = () => {
      if (document.visibilityState === "visible") store.retryNow();
    };
    window.addEventListener("online", retry);
    document.addEventListener("visibilitychange", retryWhenShown);
    return () => {
      window.removeEventListener("online", retry);
      document.removeEventListener("visibilitychange", retryWhenShown);
    };
  }, [store]);

  const unsaved = snapshot.outbox.length > 0;
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = ""; // older browsers show the prompt only when this is set
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  return { store, ...snapshot };
}
