import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db, ensureDatabase } from "@/lib/db";
import { createSession } from "@/lib/session";

export const runtime = "nodejs";

const credentials = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    await ensureDatabase();
    const input = credentials.parse(await request.json());
    const result = await db.execute({
      sql: "SELECT id, username, password_hash FROM users WHERE username_key = ?",
      args: [input.username.toLocaleLowerCase()],
    });
    const row = result.rows[0];
    if (!row || !(await bcrypt.compare(input.password, String(row.password_hash)))) {
      return NextResponse.json({ error: "Username or password is incorrect." }, { status: 401 });
    }

    const user = { id: String(row.id), username: String(row.username) };
    const response = NextResponse.json({ user });
    await createSession(user.id, response);
    return response;
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Enter both username and password." }, { status: 400 });
    }
    return NextResponse.json({ error: "Could not sign in." }, { status: 500 });
  }
}

