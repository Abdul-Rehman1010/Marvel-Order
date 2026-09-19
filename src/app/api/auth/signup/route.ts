import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";

import { apiJson, apiPreflight, isCapacitorRequest, withApiCors } from "@/lib/api-cors";
import { db, ensureDatabase } from "@/lib/db";
import { createSession } from "@/lib/session";

export const runtime = "nodejs";

export function OPTIONS(request: Request) {
  return apiPreflight(request, ["POST"]);
}

const credentials = z.object({
  username: z.string().trim().min(3, "Username must be at least 3 characters.").max(24, "Username must be 24 characters or fewer.").regex(/^[a-zA-Z0-9_-]+$/, "Use only letters, numbers, underscores, and hyphens."),
  password: z.string().min(4, "Password must be at least 4 characters.").max(72, "Password is too long."),
});

export async function POST(request: Request) {
  try {
    await ensureDatabase();
    const input = credentials.parse(await request.json());
    const id = randomUUID();
    const passwordHash = await bcrypt.hash(input.password, 12);

    await db.execute({
      sql: "INSERT INTO users (id, username, username_key, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
      args: [id, input.username, input.username.toLocaleLowerCase(), passwordHash, new Date().toISOString()],
    });

    const response = NextResponse.json({ user: { id, username: input.username } }, { status: 201 });
    const sessionToken = await createSession(id, response);
    if (isCapacitorRequest(request)) response.headers.set("X-Nexus-Session", sessionToken);
    return withApiCors(request, response);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return apiJson(request, { error: error.issues[0]?.message ?? "Invalid account details." }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Account creation failed.";
    if (message.toLowerCase().includes("unique")) {
      return apiJson(request, { error: "That username is already registered." }, { status: 409 });
    }
    return apiJson(request, { error: "Could not create the account." }, { status: 500 });
  }
}
