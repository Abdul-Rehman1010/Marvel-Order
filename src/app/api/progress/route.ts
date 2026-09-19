import { type NextRequest } from "next/server";
import { z } from "zod";

import { apiJson, apiPreflight } from "@/lib/api-cors";
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

export function OPTIONS(request: Request) {
  return apiPreflight(request, ["GET", "POST"]);
}

export async function GET(request: NextRequest) {
  try {
    const user = await getSessionUser(request);
    if (!user) return apiJson(request, { error: "Not signed in." }, { status: 401 });
    const progress = await getProgress(user.id);
    return apiJson(request, { user, progress, databaseMode: databaseMode() });
  } catch {
    return apiJson(request, { error: "Timeline vault unavailable." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  let user: Awaited<ReturnType<typeof getSessionUser>>;
  try {
    user = await getSessionUser(request);
  } catch {
    return apiJson(request, { error: "Timeline vault unavailable." }, { status: 500 });
  }
  if (!user) return apiJson(request, { error: "Not signed in." }, { status: 401 });

  try {
    const input = updateSchema.parse(await request.json());
    const progress = await updateProgress(user.id, input.contentId, input.episode, input.watched);
    return apiJson(request, { progress });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return apiJson(request, { error: "Invalid progress update." }, { status: 400 });
    }
    return apiJson(
      request,
      { error: error instanceof Error ? error.message : "Progress update failed." },
      { status: 409 },
    );
  }
}
