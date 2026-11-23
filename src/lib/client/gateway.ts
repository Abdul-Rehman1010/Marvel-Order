/**
 * Where the client loads and saves progress (NEXT_LEVEL_PLAN.md §4.6). The remote gateway talks
 * to `/api/progress`; package 4.1 adds a local one (guest mode) with the same shape.
 *
 * A gateway never throws: every reply, including a network failure, becomes one of a few result
 * kinds that `use-progress.ts` knows how to handle.
 */
import type { Action } from "@/lib/engine/reducer";
import type { ViewingState } from "@/lib/engine/state";

export type ApiRequest = (path: string, init?: RequestInit) => Promise<Response>;

export type GatewayUser = { id: string; username: string };

export type LoadResult =
  | { kind: "ok"; user: GatewayUser; state: ViewingState; databaseMode: string; hasRecoveryCode: boolean }
  | { kind: "signed-out" }
  /** Network failure or a server error. */
  | { kind: "unavailable"; message: string }
  /** The caller cancelled the request. */
  | { kind: "aborted" };

export type SendResult =
  /** Saved; `state` is everything the server now holds for this user. */
  | { kind: "ok"; state: ViewingState }
  /** Nothing saved: the un-watch would clear titles the user did not confirm. Ask again with `cleared`. */
  | { kind: "confirm-required"; state: ViewingState; cleared: string[]; message: string }
  /** Nothing saved: a rule or the request itself was refused. Trying again would be refused again. */
  | { kind: "rejected"; status: number; code: string; message: string; contentId?: string; missingId?: string; state?: ViewingState }
  /** The session has ended. */
  | { kind: "signed-out" }
  /** Network failure, a server error or an unreadable reply: try again later. */
  | { kind: "unavailable" };

export interface ProgressGateway {
  load(signal?: AbortSignal): Promise<LoadResult>;
  send(action: Action, confirmCleared?: readonly string[]): Promise<SendResult>;
}

const UNAVAILABLE = "The local timeline vault is unavailable.";

type Payload = {
  state?: Partial<ViewingState>;
  user?: GatewayUser;
  databaseMode?: unknown;
  account?: { hasRecoveryCode?: unknown };
  error?: unknown;
  code?: unknown;
  cleared?: unknown;
  contentId?: unknown;
  missingId?: unknown;
};

/** The viewing state from an API reply, tolerating missing fields. */
function readState(payload: Payload): ViewingState {
  return { rows: payload.state?.rows ?? [], skips: payload.state?.skips ?? [] };
}

const hasState = (payload: Payload) => Array.isArray(payload.state?.rows);
const text = (value: unknown) => (typeof value === "string" ? value : undefined);

async function readJson(response: Response): Promise<Payload | null> {
  try {
    const payload: unknown = await response.json();
    return payload && typeof payload === "object" ? (payload as Payload) : null;
  } catch {
    return null;
  }
}

const isAbort = (error: unknown) => error instanceof Error && error.name === "AbortError";

export function createRemoteGateway(request: ApiRequest = (path, init) => fetch(path, init)): ProgressGateway {
  return {
    async load(signal) {
      let response: Response;
      try {
        response = await request("/api/progress", { cache: "no-store", signal });
      } catch (error) {
        return isAbort(error) ? { kind: "aborted" } : { kind: "unavailable", message: UNAVAILABLE };
      }
      if (response.status === 401) return { kind: "signed-out" };
      const payload = await readJson(response);
      if (!response.ok || !payload?.user) return { kind: "unavailable", message: text(payload?.error) ?? UNAVAILABLE };
      return {
        kind: "ok",
        user: payload.user,
        state: readState(payload),
        databaseMode: text(payload.databaseMode) ?? "TIMELINE VAULT",
        hasRecoveryCode: payload.account?.hasRecoveryCode !== false,
      };
    },

    async send(action, confirmCleared) {
      let response: Response;
      try {
        response = await request("/api/progress", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(confirmCleared ? { action, confirmCleared } : { action }),
          cache: "no-store",
          // The request finishes even if the tab is closed or reloaded right after a tick.
          keepalive: true,
        });
      } catch {
        return { kind: "unavailable" };
      }
      if (response.status === 401) return { kind: "signed-out" };
      // A server error, a gateway timeout or a rate limit: the action may be fine; try it again later.
      if (response.status >= 500 || response.status === 408 || response.status === 429) return { kind: "unavailable" };

      const payload = await readJson(response);
      if (response.ok) return payload && hasState(payload) ? { kind: "ok", state: readState(payload) } : { kind: "unavailable" };
      if (!payload) return { kind: "unavailable" };

      const message = text(payload.error) ?? "Timeline update rejected.";
      if (payload.code === "confirm-required" && hasState(payload)) {
        const cleared = Array.isArray(payload.cleared) ? payload.cleared.filter((id): id is string => typeof id === "string") : [];
        return { kind: "confirm-required", state: readState(payload), cleared, message };
      }
      return {
        kind: "rejected",
        status: response.status,
        code: text(payload.code) ?? "rejected",
        message,
        ...(text(payload.contentId) ? { contentId: text(payload.contentId) } : {}),
        ...(text(payload.missingId) ? { missingId: text(payload.missingId) } : {}),
        ...(hasState(payload) ? { state: readState(payload) } : {}),
      };
    },
  };
}
