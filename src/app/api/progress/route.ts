import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { databaseMode } from "@/lib/db";
import { getProgress, updateProgress } from "@/lib/progress-store";
import { getSessionUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.object({
  contentId: z.string().min(1),
  episode: z.number().int(),
  watched: z.boolean(),
});

export async function GET(request: NextRequest) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const progress = await getProgress(user.id);
  return NextResponse.json({ user, progress, databaseMode: databaseMode() });
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const input = updateSchema.parse(await request.json());
    const progress = await updateProgress(user.id, input.contentId, input.episode, input.watched);
    return NextResponse.json({ progress });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid progress update." }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Progress update failed." },
      { status: 409 },
    );
  }
}

