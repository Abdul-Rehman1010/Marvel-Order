import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { databaseMode } from "@/lib/db";
import type { Action } from "@/lib/engine/reducer";
import { assertSameOrigin, errorResponse } from "@/lib/http";
import { applyUserAction, describeState, getViewingState } from "@/lib/progress-store";
import { extendSession, getSession, type Session } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const contentId = z.string().min(1).max(100);
const episode = z.number().int();
const skipReason = z.enum(["manual", "triage"]);
const idList = z.array(contentId).max(500);

// `import` is deliberately absent: it gets its own route with its own limits in package 4.1.
const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("watch"), contentId, episode }),
  z.object({ type: z.literal("unwatch"), contentId, episode }),
  z.object({ type: z.literal("watchAll"), contentId }),
  z.object({ type: z.literal("skip"), contentId, reason: skipReason.optional() }),
  z.object({ type: z.literal("unskip"), contentId }),
  z.object({ type: z.literal("bulk"), watch: idList, skip: idList, skipReason: skipReason.optional(), backfilled: z.boolean() }),
]);

const bodySchema = z.union([
  z.object({ action: actionSchema, confirmCleared: idList.optional() }),
  // The pre-1.3 body, still sent by clients loaded before this version: one unit on or off.
  z.object({ contentId, episode, watched: z.boolean() }),
]);

const UNAVAILABLE = "Timeline vault unavailable.";

export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request);
    if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    const { user } = session;
    const state = await getViewingState(user.id);
    const response = NextResponse.json({
      user,
      ...describeState(state),
      databaseMode: databaseMode(),
      account: { hasRecoveryCode: session.hasRecoveryCode },
    });
    // The app calls this on every load: that is what keeps a session alive indefinitely.
    await extendSession(session, response);
    return response;
  } catch (error) {
    console.error("GET /api/progress failed", error);
    return NextResponse.json({ error: UNAVAILABLE }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  let session: Session | null;
  try {
    assertSameOrigin(request);
    session = await getSession(request);
  } catch (error) {
    return errorResponse(error, "POST /api/progress (session)", UNAVAILABLE);
  }
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { user } = session;

  let action: Action;
  let confirmCleared: string[] | undefined;
  try {
    const body = bodySchema.parse(await request.json());
    if ("action" in body) {
      action = body.action;
      confirmCleared = body.confirmCleared;
    } else {
      action = { type: body.watched ? "watch" : "unwatch", contentId: body.contentId, episode: body.episode };
    }
  } catch {
    // Malformed JSON or a body that does not match the schema.
    return NextResponse.json({ error: "Invalid progress update.", code: "invalid" }, { status: 400 });
  }

  try {
    const result = await applyUserAction(user.id, action, confirmCleared);
    if (result.ok) {
      return NextResponse.json({ ...describeState(result.state), cleared: result.cleared });
    }
    if (result.code === "confirm-required") {
      return NextResponse.json(
        { error: result.message, code: result.code, cleared: result.cleared, ...describeState(result.state) },
        { status: 409 },
      );
    }
    // A rule said no. The message is written for the user; nothing was changed.
    return NextResponse.json(
      {
        error: result.message,
        code: result.code,
        ...(result.contentId ? { contentId: result.contentId } : {}),
        ...(result.missingId ? { missingId: result.missingId } : {}),
      },
      { status: 409 },
    );
  } catch (error) {
    // Anything unexpected (database down, a bug): log the detail, tell the client nothing specific.
    console.error("POST /api/progress failed", error);
    return NextResponse.json({ error: "Progress could not be saved. Try again." }, { status: 500 });
  }
}
