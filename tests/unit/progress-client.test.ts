/**
 * The client progress store (NEXT_LEVEL_PLAN.md §4.6, package 2.1): the outbox fold, the drain
 * loop with its rejection and retry rules, the remote gateway, and what the user is told.
 *
 * The "server" here is `FakeServer`: the same reducer and the same `confirmCleared` rule as
 * `src/lib/progress-store.ts`, holding its own state, so a test can play a second device by
 * changing that state behind the store's back.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  actionToasts,
  describeAction,
  needsConfirmation,
  rejectionNotice,
  removedNotice,
  skipImpact,
  unwatchImpact,
} from "@/lib/client/feedback";
import { createRemoteGateway, type LoadResult, type ProgressGateway, type SendResult } from "@/lib/client/gateway";
import { foldOutbox, isTitlePending, isUnitPending, pendingKeysOf, recheckOutbox, type OutboxEntry } from "@/lib/client/outbox";
import { createProgressStore, RETRY_BACKOFF_MS, type SyncEvent } from "@/lib/client/use-progress";
import { MCU_CONTENT, XMEN_CONTENT } from "@/lib/content";
import { newlyUnlocked } from "@/lib/engine/milestones";
import { applyAction, type Action } from "@/lib/engine/reducer";
import { EMPTY_STATE, indexOf, type ViewingState } from "@/lib/engine/state";
import { getStats } from "@/lib/engine/stats";

import { NOW, apply, item, keysOf, requiredThrough, watchedState } from "../helpers/viewing";

const watch = (contentId: string, episode = -1): Action => ({ type: "watch", contentId, episode });
const unwatch = (contentId: string, episode = -1): Action => ({ type: "unwatch", contentId, episode });
const skip = (contentId: string): Action => ({ type: "skip", contentId });

const USER = { id: "user-1", username: "tester" };

/** Plays the server: the same rules as `applyActionWithClient`, with its own state. */
class FakeServer {
  state: ViewingState;
  readonly received: { action: Action; confirmCleared?: readonly string[] }[] = [];

  constructor(state: ViewingState) {
    this.state = state;
  }

  handle(action: Action, confirmCleared?: readonly string[]): SendResult {
    this.received.push(confirmCleared === undefined ? { action } : { action, confirmCleared });
    const outcome = applyAction(this.state, action, NOW);
    if (!outcome.ok) {
      return { kind: "rejected", status: 409, code: outcome.code, message: outcome.message, contentId: outcome.contentId, missingId: outcome.missingId };
    }
    if (confirmCleared && outcome.cleared.some((id) => !confirmCleared.includes(id))) {
      return { kind: "confirm-required", state: this.state, cleared: outcome.cleared, message: "This would also remove progress on other titles." };
    }
    this.state = outcome.state;
    return { kind: "ok", state: this.state };
  }

  load(): LoadResult {
    return { kind: "ok", user: USER, state: this.state, databaseMode: "TEST VAULT", hasRecoveryCode: true };
  }

  /** Another device's change, made directly on the server. */
  otherDevice(action: Action) {
    this.state = apply(this.state, action).state;
  }
}

type SendHook = (server: FakeServer, action: Action, confirmCleared: readonly string[] | undefined) => SendResult | Promise<SendResult>;

function setup(initial: ViewingState = EMPTY_STATE, hook?: SendHook) {
  const server = new FakeServer(initial);
  const stats = { sends: 0, loads: 0, inFlight: 0, maxInFlight: 0 };
  const gateway: ProgressGateway = {
    async load() {
      stats.loads += 1;
      return server.load();
    },
    async send(action, confirmCleared) {
      stats.sends += 1;
      stats.inFlight += 1;
      stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
      try {
        return await (hook ? hook(server, action, confirmCleared) : server.handle(action, confirmCleared));
      } finally {
        stats.inFlight -= 1;
      }
    },
  };
  const store = createProgressStore(gateway, { clock: () => NOW });
  store.reset(initial);
  const events: SyncEvent[] = [];
  store.onEvent((event) => events.push(event));
  return { server, store, stats, events };
}

/** Requests wait here until the test lets them through, one at a time. */
function gate() {
  const waiting: (() => void)[] = [];
  return {
    wait: () => new Promise<void>((resolve) => waiting.push(resolve)),
    openOne: () => waiting.shift()?.(),
    get waiting() {
      return waiting.length;
    },
  };
}

/** Lets every pending promise and zero-delay timer run (real timers only). */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function until(check: () => boolean, label = "the condition") {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (check()) return;
    await settle();
  }
  throw new Error(`Timed out waiting for ${label}`);
}

/** Runs queued promise callbacks while timers are faked. */
async function flushMicrotasks() {
  for (let index = 0; index < 50; index += 1) await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

describe("outbox (pure)", () => {
  const entry = (id: number, action: Action, confirmCleared?: string[]): OutboxEntry => ({
    id,
    action,
    at: NOW.getTime(),
    ...(confirmCleared ? { confirmCleared } : {}),
  });

  it("folds the queued actions over the confirmed state, in order, without changing either", () => {
    const confirmed = watchedState(["iron-man"]);
    const copy = structuredClone(confirmed);
    const queue = [entry(1, watch("incredible-hulk")), entry(2, watch("iron-man-2"))];
    expect(keysOf(foldOutbox(confirmed, queue))).toEqual(["incredible-hulk:-1", "iron-man-2:-1", "iron-man:-1"]);
    expect(confirmed).toEqual(copy);
    expect(queue.map((queued) => queued.id)).toEqual([1, 2]);
  });

  it("leaves out an action that no longer applies, and keeps the independent ones after it", () => {
    // The confirmed state has no Iron Man (another device removed it): Hulk cannot apply, X-Men can.
    expect(keysOf(foldOutbox(EMPTY_STATE, [entry(1, watch("incredible-hulk")), entry(2, watch("xmen-2000"))]))).toEqual(["xmen-2000:-1"]);
  });

  it("does not show an un-watch that would clear more than the user confirmed", () => {
    const confirmed = watchedState(["iron-man", "incredible-hulk"]);
    expect(keysOf(foldOutbox(confirmed, [entry(1, unwatch("iron-man"), [])]))).toEqual(keysOf(confirmed));
    expect(keysOf(foldOutbox(confirmed, [entry(1, unwatch("iron-man"), ["incredible-hulk"])]))).toEqual([]);
  });

  it("re-checks the queue in order: removes what no longer applies, keeps the rest and anything the server must confirm", () => {
    const confirmed = watchedState(["iron-man", "incredible-hulk"]);
    const queue = [
      entry(1, watch("iron-man-2")),
      entry(2, unwatch("iron-man"), []), // would clear Hulk and Iron Man 2: the server will ask again
      entry(3, watch("captain-america-first-avenger")), // needs Thor, which is not watched yet
      entry(4, watch("thor")),
      entry(5, watch("xmen-2000")),
    ];
    const { kept, removed } = recheckOutbox(confirmed, queue, NOW);
    expect(kept.map((queued) => queued.id)).toEqual([1, 2, 4, 5]);
    expect(removed.map(({ entry: queued, failure }) => [queued.id, failure.code, failure.missingId])).toEqual([[3, "locked", "thor"]]);
  });

  it("marks the units and titles that have an action waiting", () => {
    const pending = pendingKeysOf([
      entry(1, watch("iron-man")),
      entry(2, watch("wandavision", 3)),
      entry(3, skip("eternals")),
      entry(4, { type: "bulk", watch: ["thor"], skip: ["ant-man"], backfilled: true }),
    ]);
    expect([...pending.units].sort()).toEqual(["iron-man:-1", "wandavision:3"]);
    expect([...pending.titles].sort()).toEqual(["ant-man", "eternals", "thor"]);
    expect(isUnitPending(pending, "wandavision", 3)).toBe(true);
    expect(isUnitPending(pending, "wandavision", 4)).toBe(false);
    expect(isUnitPending(pending, "thor", -1)).toBe(true);
    expect(isTitlePending(pending, item("wandavision"))).toBe(true);
    expect(isTitlePending(pending, item("loki-1"))).toBe(false);
  });
});

describe("progress store", () => {
  it("shows a tick at once, before the server answers, and marks it as saving", async () => {
    const held = gate();
    const { store } = setup(EMPTY_STATE, async (server, action, confirmCleared) => {
      await held.wait();
      return server.handle(action, confirmCleared);
    });

    expect(store.dispatch(watch("iron-man")).ok).toBe(true);
    const shown = store.getSnapshot();
    expect(keysOf(shown.state)).toEqual(["iron-man:-1"]);
    expect(shown.confirmed.rows).toEqual([]);
    expect(isUnitPending(shown.pending, "iron-man", -1)).toBe(true);

    await until(() => held.waiting === 1, "the request");
    held.openOne();
    await until(() => store.getSnapshot().outbox.length === 0, "the queue to drain");
    expect(keysOf(store.getSnapshot().confirmed)).toEqual(["iron-man:-1"]);
    expect(store.getSnapshot().pending.units.size).toBe(0);
  });

  it("keeps later ticks on screen when a slow reply arrives, and sends them one at a time, in order", async () => {
    const held = gate();
    const { store, server, stats } = setup(EMPTY_STATE, async (server, action, confirmCleared) => {
      await held.wait();
      return server.handle(action, confirmCleared);
    });

    for (const id of ["iron-man", "incredible-hulk", "iron-man-2"]) expect(store.dispatch(watch(id)).ok).toBe(true);
    await until(() => held.waiting === 1, "the first request");
    expect(stats.sends).toBe(1);

    // The server answers the first action only: its state has Iron Man and nothing else.
    held.openOne();
    await until(() => store.getSnapshot().outbox.length === 2, "the first reply");
    expect(keysOf(store.getSnapshot().confirmed)).toEqual(["iron-man:-1"]);
    expect(keysOf(store.getSnapshot().state)).toEqual(["incredible-hulk:-1", "iron-man-2:-1", "iron-man:-1"]);

    for (let reply = 0; reply < 2; reply += 1) {
      await until(() => held.waiting === 1, "the next request");
      held.openOne();
    }
    await until(() => store.getSnapshot().outbox.length === 0, "the queue to drain");
    expect(server.received.map(({ action }) => action)).toEqual([watch("iron-man"), watch("incredible-hulk"), watch("iron-man-2")]);
    expect(stats.maxInFlight).toBe(1);
    expect(keysOf(store.getSnapshot().state)).toEqual(keysOf(server.state));
  });

  it("returns the before and after indexes, captured before the optimistic update", () => {
    const { store } = setup(watchedState(["iron-man"]));
    const shownBefore = store.getSnapshot().index;
    const result = store.dispatch(watch("incredible-hulk"));
    if (!result.ok) throw new Error(result.failure.message);
    expect(result.changed).toBe(true);
    expect(result.before).toBe(shownBefore);
    expect(result.before.watched.has("incredible-hulk:-1")).toBe(false);
    expect(result.after.watched.has("incredible-hulk:-1")).toBe(true);
    expect(store.getSnapshot().index).toBe(result.after);
    // So a toast computed from the pair sees the change (computing it from the updated state alone would not).
    expect(newlyUnlocked(result.before, result.after, NOW).map((unlocked) => unlocked.id)).toEqual(["iron-man-2"]);
  });

  it("refuses an action the rules do not allow, without queueing or sending it", async () => {
    const { store, stats } = setup();
    expect(store.dispatch(watch("incredible-hulk"))).toMatchObject({ ok: false, failure: { code: "locked", missingId: "iron-man" } });
    expect(store.getSnapshot().outbox).toEqual([]);
    await settle();
    expect(stats.sends).toBe(0);
  });

  it("does not queue an action that changes nothing", async () => {
    const { store, stats } = setup(watchedState(["iron-man"]));
    expect(store.dispatch(watch("iron-man"))).toMatchObject({ ok: true, changed: false });
    expect(store.dispatch(unwatch("thor"))).toMatchObject({ ok: true, changed: false });
    expect(store.getSnapshot().outbox).toEqual([]);
    await settle();
    expect(stats.sends).toBe(0);
  });

  it("will not clear other titles the user has not confirmed, and sends the confirmed list", async () => {
    const { store, server } = setup(watchedState(["iron-man", "incredible-hulk"]));
    expect(store.dispatch(unwatch("iron-man"))).toMatchObject({ ok: false, failure: { code: "confirm-required", cleared: ["incredible-hulk"] } });
    expect(store.getSnapshot().outbox).toEqual([]);

    expect(store.dispatch(unwatch("iron-man"), { confirmCleared: ["incredible-hulk"] })).toMatchObject({ ok: true, changed: true });
    await until(() => store.getSnapshot().outbox.length === 0, "the queue to drain");
    expect(server.received).toEqual([{ action: unwatch("iron-man"), confirmCleared: ["incredible-hulk"] }]);
    expect(server.state.rows).toEqual([]);
  });

  it("skip, watch anyway, then Undo with the skip restored: later titles keep their progress on the server too", async () => {
    const { store, server } = setup(watchedState(["iron-man"]));
    store.dispatch({ type: "skip", contentId: "incredible-hulk" });
    store.dispatch(watch("iron-man-2"));
    store.dispatch(watch("incredible-hulk"));
    expect(store.getSnapshot().index.skipped.has("incredible-hulk")).toBe(false);

    // The plain un-watch would clear Iron Man 2, so it is not allowed without confirming...
    expect(store.dispatch(unwatch("incredible-hulk"))).toMatchObject({ ok: false, failure: { code: "confirm-required" } });
    // ...the Undo puts the skip back instead, and clears nothing.
    const undo: Action = { type: "unwatch", contentId: "incredible-hulk", episode: -1, restoreSkip: "manual" };
    expect(store.dispatch(undo)).toMatchObject({ ok: true, changed: true, outcome: { cleared: [] } });
    expect(store.getSnapshot().index.skipped.has("incredible-hulk")).toBe(true);

    await until(() => store.getSnapshot().outbox.length === 0, "the queue to drain");
    expect(server.received.at(-1)).toEqual({ action: undo, confirmCleared: [] });
    expect(keysOf(server.state)).toEqual(["iron-man-2:-1", "iron-man:-1"]);
    expect(server.state.skips.map((row) => row.contentId)).toEqual(["incredible-hulk"]);
  });

  it("sends an empty confirmed list with an un-watch that should clear nothing, and none with other actions", async () => {
    const { store, server } = setup(watchedState(["iron-man"]));
    store.dispatch(unwatch("iron-man"));
    store.dispatch(watch("xmen-2000"));
    await until(() => store.getSnapshot().outbox.length === 0, "the queue to drain");
    expect(server.received).toEqual([{ action: unwatch("iron-man"), confirmCleared: [] }, { action: watch("xmen-2000") }]);
  });

  it("five queued, the second refused: the independent ones still sync; the refused one and those that needed it are removed and named", async () => {
    let release!: () => void;
    const firstReply = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { store, server, stats, events } = setup(EMPTY_STATE, async (server, action, confirmCleared) => {
      await firstReply;
      // While this device was sending, another one removed Iron Man.
      if (action.type === "watch" && action.contentId === "incredible-hulk") server.otherDevice(unwatch("iron-man"));
      return server.handle(action, confirmCleared);
    });

    for (const id of ["iron-man", "incredible-hulk", "iron-man-2", "thor", "xmen-2000"]) expect(store.dispatch(watch(id)).ok).toBe(true);
    expect(store.getSnapshot().outbox).toHaveLength(5);
    release();
    await until(() => store.getSnapshot().outbox.length === 0, "the queue to drain");

    expect(server.received.map(({ action }) => action)).toEqual([watch("iron-man"), watch("incredible-hulk"), watch("xmen-2000")]);
    expect(keysOf(server.state)).toEqual(["xmen-2000:-1"]);
    expect(keysOf(store.getSnapshot().state)).toEqual(["xmen-2000:-1"]);
    expect(stats.loads).toBe(1); // the refusal carried no state, so it was fetched once

    expect(events).toHaveLength(1);
    const [event] = events;
    if (event.type !== "rejected") throw new Error(`Expected a rejection, got ${event.type}`);
    expect(event.rejected.entry.action).toEqual(watch("incredible-hulk"));
    expect(event.rejected.failure).toMatchObject({ code: "locked", missingId: "iron-man" });
    expect(event.removed.map(({ entry }) => entry.action)).toEqual([watch("iron-man-2"), watch("thor")]);
    expect(rejectionNotice(event.rejected, event.removed)).toBe(
      "Couldn't save: The Incredible Hulk — needs Iron Man. Also not saved: Iron Man 2, Thor.",
    );
  });

  it("does not fetch the state again when the refusal includes it", async () => {
    const { store, stats, events } = setup(EMPTY_STATE, (server, action, confirmCleared) => {
      const reply = server.handle(action, confirmCleared);
      return reply.kind === "rejected" ? { ...reply, state: server.state } : reply;
    });
    // Accepted locally (this device thinks Iron Man is watched), refused by the server.
    store.reset(watchedState(["iron-man"]));
    store.dispatch(watch("incredible-hulk"));
    await until(() => events.length === 1, "the rejection");
    expect(stats.loads).toBe(0);
    expect(store.getSnapshot().state.rows).toEqual([]);
  });

  it("confirm-required: drops the action, takes the server's state and asks again with the server's list", async () => {
    const { store, server, events } = setup(watchedState(["iron-man"]));
    // Another device watched The Incredible Hulk; this one has not heard about it.
    server.otherDevice(watch("incredible-hulk"));

    expect(store.dispatch(unwatch("iron-man"))).toMatchObject({ ok: true, changed: true });
    expect(store.getSnapshot().state.rows).toEqual([]);
    await until(() => events.length === 1, "the server's answer");
    expect(events[0]).toMatchObject({ type: "confirm-required", cleared: ["incredible-hulk"], removed: [] });
    expect(store.getSnapshot().outbox).toEqual([]);
    expect(keysOf(store.getSnapshot().state)).toEqual(["incredible-hulk:-1", "iron-man:-1"]);
    expect(keysOf(server.state)).toEqual(["incredible-hulk:-1", "iron-man:-1"]);

    // Confirmed with the server's list, it goes through.
    expect(store.dispatch(unwatch("iron-man"), { confirmCleared: ["incredible-hulk"] }).ok).toBe(true);
    await until(() => store.getSnapshot().outbox.length === 0, "the queue to drain");
    expect(server.state.rows).toEqual([]);
  });

  it("signed out (401): drops the queue and says so", async () => {
    const { store, stats, events } = setup(EMPTY_STATE, () => ({ kind: "signed-out" }));
    store.dispatch(watch("iron-man"));
    store.dispatch(watch("xmen-2000"));
    await until(() => events.length === 1, "the sign-out");
    expect(events).toEqual([{ type: "signed-out", lost: 2 }]);
    expect(store.getSnapshot().outbox).toEqual([]);
    expect(store.getSnapshot().state).toEqual(EMPTY_STATE);
    await settle();
    expect(stats.sends).toBe(1);
  });

  it("ignores a late reply for a session that was reset", async () => {
    const held = gate();
    const { store } = setup(EMPTY_STATE, async (server, action, confirmCleared) => {
      await held.wait();
      return server.handle(action, confirmCleared);
    });
    store.dispatch(watch("iron-man"));
    await until(() => held.waiting === 1, "the request");
    store.reset(watchedState(["xmen-2000"]));
    held.openOne();
    await settle();
    await settle();
    expect(keysOf(store.getSnapshot().confirmed)).toEqual(["xmen-2000:-1"]);
    expect(store.getSnapshot().outbox).toEqual([]);
  });

  it("whenIdle resolves when the queue is empty, or gives up after the timeout", async () => {
    const held = gate();
    const { store } = setup(EMPTY_STATE, async (server, action, confirmCleared) => {
      await held.wait();
      return server.handle(action, confirmCleared);
    });
    await expect(store.whenIdle(10)).resolves.toBe(true);

    store.dispatch(watch("iron-man"));
    await expect(store.whenIdle(20)).resolves.toBe(false);
    const idle = store.whenIdle(5_000);
    await until(() => held.waiting === 1, "the request");
    held.openOne();
    await expect(idle).resolves.toBe(true);
  });

  describe("network failures (fake timers)", () => {
    it("a lost reply is retried, and the retry changes nothing twice", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      let lose = true;
      const { store, server, stats } = setup(EMPTY_STATE, (server, action, confirmCleared) => {
        const reply = server.handle(action, confirmCleared); // the server saves it...
        if (lose) {
          lose = false;
          return { kind: "unavailable" }; // ...but the reply never arrives
        }
        return reply;
      });

      store.dispatch(watch("iron-man"));
      await flushMicrotasks();
      expect(store.getSnapshot().status).toBe("offline");
      expect(store.getSnapshot().outbox).toHaveLength(1);
      expect(keysOf(store.getSnapshot().state)).toEqual(["iron-man:-1"]); // the tick stays on screen
      const saved = server.state.rows;

      await vi.advanceTimersByTimeAsync(RETRY_BACKOFF_MS[0]);
      await flushMicrotasks();
      expect(stats.sends).toBe(2);
      expect(store.getSnapshot()).toMatchObject({ status: "online", outbox: [] });
      expect(server.state.rows).toEqual(saved); // one row, with its first timestamp
    });

    it("retries after 2 s, 5 s, 15 s, 60 s and then every minute, and at once when asked", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const { store, stats } = setup(EMPTY_STATE, () => ({ kind: "unavailable" }));
      expect(RETRY_BACKOFF_MS).toEqual([2_000, 5_000, 15_000, 60_000]);

      store.dispatch(watch("iron-man"));
      await flushMicrotasks();
      expect(stats.sends).toBe(1);
      for (const [delay, sends] of [[2_000, 2], [5_000, 3], [15_000, 4], [60_000, 5], [60_000, 6]] as const) {
        await vi.advanceTimersByTimeAsync(delay - 1);
        expect(stats.sends).toBe(sends - 1);
        await vi.advanceTimersByTimeAsync(1);
        await flushMicrotasks();
        expect(stats.sends).toBe(sends);
      }

      // The browser says the connection is back (the "online" event) or the tab is shown again.
      store.retryNow();
      await flushMicrotasks();
      expect(stats.sends).toBe(7);
      expect(store.getSnapshot().status).toBe("offline");
    });

    it("while offline, new ticks show at once and wait for the next retry; then everything syncs in order", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      let online = false;
      const { store, server, stats } = setup(EMPTY_STATE, (server, action, confirmCleared) =>
        online ? server.handle(action, confirmCleared) : { kind: "unavailable" },
      );

      store.dispatch(watch("iron-man"));
      await flushMicrotasks();
      expect(store.getSnapshot().status).toBe("offline");
      store.dispatch(watch("incredible-hulk"));
      store.dispatch(watch("xmen-2000"));
      await flushMicrotasks();
      expect(stats.sends).toBe(1); // no extra attempt per tick
      expect(keysOf(store.getSnapshot().state)).toEqual(["incredible-hulk:-1", "iron-man:-1", "xmen-2000:-1"]);

      online = true;
      await vi.advanceTimersByTimeAsync(RETRY_BACKOFF_MS[0]);
      await flushMicrotasks();
      expect(store.getSnapshot()).toMatchObject({ status: "online", outbox: [] });
      expect(server.received.map(({ action }) => action).slice(-3)).toEqual([watch("iron-man"), watch("incredible-hulk"), watch("xmen-2000")]);
      expect(keysOf(server.state)).toEqual(["incredible-hulk:-1", "iron-man:-1", "xmen-2000:-1"]);
    });

    it("a refusal whose state cannot be fetched is retried later instead of guessing", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const { store, server, events } = setup(watchedState(["iron-man"]));
      server.otherDevice(unwatch("iron-man"));
      const realLoad = server.load.bind(server);
      let loadWorks = false;
      server.load = () => (loadWorks ? realLoad() : { kind: "unavailable", message: "offline" });

      store.dispatch(watch("incredible-hulk"));
      await flushMicrotasks();
      expect(store.getSnapshot().status).toBe("offline");
      expect(store.getSnapshot().outbox).toHaveLength(1);
      expect(events).toEqual([]);

      loadWorks = true;
      await vi.advanceTimersByTimeAsync(RETRY_BACKOFF_MS[0]);
      await flushMicrotasks();
      expect(store.getSnapshot()).toMatchObject({ status: "online", outbox: [] });
      expect(events.map((event) => event.type)).toEqual(["rejected"]);
      expect(store.getSnapshot().state.rows).toEqual([]);
    });
  });
});

describe("remote gateway", () => {
  const STATE = watchedState(["iron-man"]);
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  function fakeRequest(reply: () => Response | Error) {
    const calls: { path: string; init?: RequestInit }[] = [];
    const request = async (path: string, init?: RequestInit) => {
      calls.push({ path, init });
      const response = reply();
      if (response instanceof Error) throw response;
      return response;
    };
    return { request, calls };
  }

  it("posts the action, and the confirmed list for an un-watch, as a request that survives the page closing", async () => {
    const { request, calls } = fakeRequest(() => json(200, { state: STATE, outOfOrder: [], unrecognised: [], cleared: [] }));
    const gateway = createRemoteGateway(request);
    await expect(gateway.send(unwatch("iron-man"), ["incredible-hulk"])).resolves.toEqual({ kind: "ok", state: STATE });
    expect(calls[0].path).toBe("/api/progress");
    expect(calls[0].init).toMatchObject({ method: "POST", keepalive: true });
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ action: unwatch("iron-man"), confirmCleared: ["incredible-hulk"] });

    await gateway.send(watch("thor"));
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ action: watch("thor") });
  });

  it("sorts every reply into ok, confirm-required, rejected, signed-out or unavailable", async () => {
    const cases: [() => Response | Error, SendResult][] = [
      [
        () => json(409, { error: "Confirm to continue.", code: "confirm-required", cleared: ["incredible-hulk"], state: STATE, outOfOrder: [], unrecognised: [] }),
        { kind: "confirm-required", state: STATE, cleared: ["incredible-hulk"], message: "Confirm to continue." },
      ],
      [
        () => json(409, { error: "Watch Iron Man first to unlock The Incredible Hulk.", code: "locked", contentId: "incredible-hulk", missingId: "iron-man" }),
        { kind: "rejected", status: 409, code: "locked", message: "Watch Iron Man first to unlock The Incredible Hulk.", contentId: "incredible-hulk", missingId: "iron-man" },
      ],
      [() => json(400, { error: "Invalid progress update.", code: "invalid" }), { kind: "rejected", status: 400, code: "invalid", message: "Invalid progress update." }],
      [() => json(403, { error: "Cross-origin request refused.", code: "cross-origin" }), { kind: "rejected", status: 403, code: "cross-origin", message: "Cross-origin request refused." }],
      [() => json(401, { error: "Not signed in." }), { kind: "signed-out" }],
      [() => json(500, { error: "Progress could not be saved. Try again." }), { kind: "unavailable" }],
      [() => json(503, {}), { kind: "unavailable" }],
      [() => json(429, { error: "Too many attempts." }), { kind: "unavailable" }],
      [() => new Response("<html>Bad gateway</html>", { status: 200 }), { kind: "unavailable" }],
      [() => new TypeError("Failed to fetch"), { kind: "unavailable" }],
    ];
    for (const [reply, expected] of cases) {
      const gateway = createRemoteGateway(fakeRequest(reply).request);
      await expect(gateway.send(watch("incredible-hulk"))).resolves.toEqual(expected);
    }
  });

  it("loads the user, the state and the account line, tolerating missing fields", async () => {
    const full = fakeRequest(() =>
      json(200, { user: USER, state: STATE, outOfOrder: [], unrecognised: [], databaseMode: "LOCAL VAULT", account: { hasRecoveryCode: false } }),
    );
    await expect(createRemoteGateway(full.request).load()).resolves.toEqual({
      kind: "ok",
      user: USER,
      state: STATE,
      databaseMode: "LOCAL VAULT",
      hasRecoveryCode: false,
    });
    expect(full.calls[0]).toMatchObject({ path: "/api/progress", init: { cache: "no-store" } });

    const sparse = fakeRequest(() => json(200, { user: USER }));
    await expect(createRemoteGateway(sparse.request).load()).resolves.toEqual({
      kind: "ok",
      user: USER,
      state: { rows: [], skips: [] },
      databaseMode: "TIMELINE VAULT",
      hasRecoveryCode: true,
    });
  });

  it("reports a load as signed-out, unavailable or aborted", async () => {
    const load = (reply: () => Response | Error) => createRemoteGateway(fakeRequest(reply).request).load();
    await expect(load(() => json(401, { error: "Not signed in." }))).resolves.toEqual({ kind: "signed-out" });
    await expect(load(() => json(500, { error: "Timeline vault unavailable." }))).resolves.toMatchObject({ kind: "unavailable" });
    await expect(load(() => new TypeError("Failed to fetch"))).resolves.toMatchObject({ kind: "unavailable" });
    await expect(load(() => new DOMException("The operation was aborted.", "AbortError"))).resolves.toEqual({ kind: "aborted" });
  });
});

describe("what the user is told", () => {
  /** The before and after indexes of one action that must succeed. */
  function step(state: ViewingState, action: Action) {
    return { before: indexOf(state), after: indexOf(apply(state, action).state) };
  }

  const PHASE_ONE = requiredThrough(MCU_CONTENT, "avengers");
  const SAGA = requiredThrough(MCU_CONTENT, "far-from-home");

  it("names each kind of action in plain words", () => {
    expect(describeAction(watch("iron-man"))).toBe("Iron Man");
    expect(describeAction(watch("wandavision", 3))).toBe("WandaVision E03");
    expect(describeAction(unwatch("thor"))).toBe("un-watching Thor");
    expect(describeAction(unwatch("wandavision", 3))).toBe("un-watching WandaVision E03");
    expect(describeAction({ type: "watchAll", contentId: "loki-1" })).toBe("Loki — Season 1 (all episodes)");
    expect(describeAction(skip("eternals"))).toBe("skipping Eternals");
    expect(describeAction({ type: "unskip", contentId: "eternals" })).toBe("un-skipping Eternals");
    expect(describeAction({ type: "bulk", watch: ["thor", "iron-man"], skip: ["eternals"], backfilled: true })).toBe("marking 3 titles");
  });

  it("gives a short reason for each refusal", () => {
    const entry: OutboxEntry = { id: 1, action: watch("thor"), at: NOW.getTime() };
    const reason = (failure: { code: string; message: string; missingId?: string }) => rejectionNotice({ entry, failure }, []);
    expect(reason({ code: "locked", message: "…", missingId: "iron-man-2" })).toBe("Couldn't save: Thor — needs Iron Man 2.");
    expect(reason({ code: "unreleased", message: "…" })).toBe("Couldn't save: Thor — not released yet.");
    expect(reason({ code: "episode-order", message: "…" })).toBe("Couldn't save: Thor — an earlier episode is not watched.");
    expect(reason({ code: "has-dependents", message: "…" })).toBe("Couldn't save: Thor — later titles you watched depend on it.");
    expect(reason({ code: "cross-origin", message: "Cross-origin request refused." })).toBe("Couldn't save: Thor — Cross-origin request refused.");
    expect(removedNotice([{ entry, failure: { code: "locked", message: "…" } }])).toBe("Not saved: Thor (it no longer applies).");
  });

  it("asks before un-watching only when something else would go, and lists exactly that", () => {
    const alone = unwatchImpact(watchedState(["iron-man", "xmen-2000", ["moon-knight", [1, 2]]]), "iron-man", -1, NOW)!;
    expect(alone).toEqual({ laterEpisodes: [], cleared: [] });
    expect(needsConfirmation(alone)).toBe(false);

    const withHulk = unwatchImpact(watchedState(["iron-man", "incredible-hulk", "xmen-2000"]), "iron-man", -1, NOW)!;
    expect(withHulk.laterEpisodes).toEqual([]);
    expect(withHulk.cleared.map(({ item: cleared, units }) => [cleared.id, units])).toEqual([["incredible-hulk", 1]]);
    expect(needsConfirmation(withHulk)).toBe(true);

    const series = unwatchImpact(watchedState([...SAGA, "wandavision", ["falcon-winter-soldier", [1, 2]]]), "wandavision", 3, NOW)!;
    expect(series.laterEpisodes).toEqual([4, 5, 6, 7, 8, 9]);
    expect(series.cleared.map(({ item: cleared, units }) => [cleared.id, units])).toEqual([["falcon-winter-soldier", 2]]);

    // Only episodes 1-3 watched: un-watching 3 removes one row and asks nothing; un-watching 2 also takes 3.
    const partial = watchedState([...SAGA, ["wandavision", [1, 2, 3]]]);
    expect(needsConfirmation(unwatchImpact(partial, "wandavision", 3, NOW)!)).toBe(false);
    expect(unwatchImpact(partial, "wandavision", 2, NOW)).toEqual({ laterEpisodes: [3], cleared: [] });

    // An episode the title does not have is not an un-watch at all.
    expect(unwatchImpact(partial, "wandavision", 99, NOW)).toBeNull();
  });

  it("watch: a checkpoint toast with Undo, then the unlock, then any milestone", () => {
    const { before, after } = step(watchedState(PHASE_ONE.slice(0, -1)), watch("avengers"));
    expect(actionToasts(watch("avengers"), before, after, NOW)).toEqual([
      { kind: "checkpoint", title: "Checkpoint secured", detail: "2h 23m closer to Doomsday", undo: { contentId: "avengers", episode: -1 } },
      { kind: "unlock", item: item("iron-man-3"), more: 0 },
      { kind: "milestone", title: "Phase One complete", detail: "Every required entry in this phase is watched." },
    ]);

    // An optional or Street-Level title is logged, not counted toward Doomsday; an episode counts its own runtime.
    const optional = step(EMPTY_STATE, watch("moon-knight", 1));
    expect(actionToasts(watch("moon-knight", 1), optional.before, optional.after, NOW)[0]).toEqual({
      kind: "checkpoint",
      title: "Checkpoint secured",
      detail: "47m logged in your archive",
      undo: { contentId: "moon-knight", episode: 1 },
    });
  });

  it("watchAll: one checkpoint for the episodes it added, undone from the first of them", () => {
    const start = watchedState([...SAGA, ["wandavision", [1, 2, 3, 4, 5, 6, 7]]]);
    const { before, after } = step(start, { type: "watchAll", contentId: "wandavision" });
    expect(actionToasts({ type: "watchAll", contentId: "wandavision" }, before, after, NOW)[0]).toEqual({
      kind: "checkpoint",
      title: "Checkpoint secured",
      detail: "2 episodes · 1h 37m closer to Doomsday",
      undo: { contentId: "wandavision", episode: 8, addedEpisodes: [8, 9] },
    });
  });

  it("skip: says when later titles were unlocked", () => {
    const unlocking = step(watchedState(["iron-man"]), skip("incredible-hulk"));
    expect(actionToasts(skip("incredible-hulk"), unlocking.before, unlocking.after, NOW)).toEqual([
      { kind: "checkpoint", title: "Skipped — later titles unlocked", detail: "Iron Man 2 is ready to watch." },
    ]);
    const quiet = step(EMPTY_STATE, skip("eternals"));
    expect(actionToasts(skip("eternals"), quiet.before, quiet.after, NOW)).toEqual([
      { kind: "checkpoint", title: "Skipped Eternals", detail: "It counts as cleared for unlocking later titles, not as watched." },
    ]);
  });

  it("bulk: exactly one toast, listing every milestone reached", () => {
    const action: Action = { type: "bulk", watch: requiredThrough(MCU_CONTENT, "ant-man"), skip: [], backfilled: false };
    const { before, after } = step(EMPTY_STATE, action);
    expect(actionToasts(action, before, after, NOW)).toEqual([
      { kind: "milestone", title: "Marked 12 titles watched", detail: "Phase One complete · Phase Two complete" },
    ]);
    const small: Action = { type: "bulk", watch: ["iron-man", "incredible-hulk"], skip: ["eternals"], backfilled: false };
    const smallStep = step(EMPTY_STATE, small);
    expect(actionToasts(small, smallStep.before, smallStep.after, NOW)).toEqual([
      { kind: "checkpoint", title: "Marked 2 titles watched, skipped 1", detail: "3h 58m logged in your archive" },
    ]);
  });

  it("catch-up (a backfilled bulk): 'Caught up: N titles · readiness now P%', with every milestone", () => {
    const readiness = (after: ReturnType<typeof indexOf>) => getStats([...MCU_CONTENT, ...XMEN_CONTENT], after).percent;
    const action: Action = { type: "bulk", watch: requiredThrough(MCU_CONTENT, "ant-man"), skip: [], backfilled: true };
    const { before, after } = step(EMPTY_STATE, action);
    expect(readiness(after)).toBeGreaterThan(0);
    expect(actionToasts(action, before, after, NOW)).toEqual([
      { kind: "milestone", title: `Caught up: 12 titles · readiness now ${readiness(after)}%`, detail: "Phase One complete · Phase Two complete" },
    ]);
    const small: Action = { type: "bulk", watch: ["iron-man", "thor"], skip: ["incredible-hulk", "iron-man-2"], backfilled: true };
    const smallStep = step(EMPTY_STATE, small);
    expect(actionToasts(small, smallStep.before, smallStep.after, NOW)).toEqual([
      { kind: "checkpoint", title: `Caught up: 2 titles, skipped 2 · readiness now ${readiness(smallStep.after)}%`, detail: "4h 01m logged in your archive" },
    ]);
  });

  it("watching a skipped title: the Undo puts the skip back with its reason, and says so", () => {
    const start = apply(watchedState(["iron-man", "iron-man-2"]), { type: "skip", contentId: "incredible-hulk", reason: "triage" }).state;
    // (Iron Man 2 was watched while The Incredible Hulk was skipped.)
    const { before, after } = step(start, watch("incredible-hulk"));
    const [checkpoint] = actionToasts(watch("incredible-hulk"), before, after, NOW, start.skips);
    expect(checkpoint).toEqual({
      kind: "checkpoint",
      title: "Checkpoint secured",
      detail: "1h 52m closer to Doomsday · no longer skipped",
      undo: { contentId: "incredible-hulk", episode: -1, restoreSkip: "triage" },
    });

    // That Undo clears nothing, so it needs no confirmation; a plain un-watch would ask.
    const watched = apply(start, watch("incredible-hulk")).state;
    expect(unwatchImpact(watched, "incredible-hulk", -1, NOW, "triage")).toEqual({ laterEpisodes: [], cleared: [] });
    expect(unwatchImpact(watched, "incredible-hulk", -1, NOW)!.cleared.map(({ item: cleared }) => cleared.id)).toEqual(["iron-man-2"]);

    const undo: Action = { type: "unwatch", contentId: "incredible-hulk", episode: -1, restoreSkip: "triage" };
    const undone = step(watched, undo);
    expect(actionToasts(undo, undone.before, undone.after, NOW)).toEqual([
      { kind: "checkpoint", title: "Removed from watched", detail: "The Incredible Hulk · skipped again" },
    ]);

    // A title that was not skipped gets a plain Undo.
    const plain = step(watchedState(["iron-man"]), watch("incredible-hulk"));
    expect(actionToasts(watch("incredible-hulk"), plain.before, plain.after, NOW, [])[0]).toMatchObject({ undo: { contentId: "incredible-hulk", episode: -1 } });
    expect(actionToasts(watch("incredible-hulk"), plain.before, plain.after, NOW, [])[0]).not.toHaveProperty("undo.restoreSkip");
  });

  it("skipImpact says what a skip would unlock and keep", () => {
    expect(skipImpact(watchedState(["iron-man"]), "incredible-hulk", NOW)).toEqual({ unlocks: [item("iron-man-2")], keptUnits: 0 });
    // Iron Man is not watched, so Iron Man 2 stays locked on it.
    expect(skipImpact(EMPTY_STATE, "incredible-hulk", NOW)).toEqual({ unlocks: [], keptUnits: 0 });
    const partial = watchedState([...SAGA, ["wandavision", [1, 2, 3]]]);
    expect(skipImpact(partial, "wandavision", NOW)).toEqual({ unlocks: [item("falcon-winter-soldier")], keptUnits: 3 });
    expect(skipImpact(EMPTY_STATE, "no-such-title", NOW)).toBeNull();
  });

  it("un-watch and un-skip say what changed; an action that changed nothing says nothing", () => {
    const cascade = step(watchedState(["iron-man", "incredible-hulk"]), unwatch("iron-man"));
    expect(actionToasts(unwatch("iron-man"), cascade.before, cascade.after, NOW)).toEqual([
      { kind: "checkpoint", title: "Removed from watched", detail: "Iron Man · also cleared 1 later title" },
    ]);
    const skipped = { rows: [], skips: [{ contentId: "eternals", reason: "manual" as const, skippedAt: NOW.toISOString() }] };
    const unskip = step(skipped, { type: "unskip", contentId: "eternals" });
    expect(actionToasts({ type: "unskip", contentId: "eternals" }, unskip.before, unskip.after, NOW)).toEqual([
      { kind: "checkpoint", title: "Skip removed", detail: "Eternals counts as still to watch again." },
    ]);
    const same = indexOf(watchedState(["iron-man"]));
    expect(actionToasts(watch("iron-man"), same, same, NOW)).toEqual([]);
  });
});
