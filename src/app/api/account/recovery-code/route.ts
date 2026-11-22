import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { authorizeAccountChange, currentPasswordField, issueRecoveryCode } from "@/lib/account";
import { errorResponse } from "@/lib/http";

export const runtime = "nodejs";

const body = z.object({ currentPassword: currentPasswordField });

/** Issues a new recovery code; the previous one stops working. The code is in the reply, shown once. */
export async function POST(request: NextRequest) {
  try {
    const { session } = await authorizeAccountChange(request, body);
    const recoveryCode = await issueRecoveryCode(session.user.id);
    return NextResponse.json({ recoveryCode });
  } catch (error) {
    return errorResponse(error, "POST /api/account/recovery-code", "Could not create a recovery code.");
  }
}
