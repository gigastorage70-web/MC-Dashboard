import { NextResponse } from "next/server";
import { z } from "zod";
import { setupInitialAdmin } from "@/modules/authentication/service";
import {
  getSessionCookieOptions,
  signSessionToken,
} from "@/lib/security/session";

const SetupSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(2).max(120),
  password: z.string().min(8).max(128),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = SetupSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid setup input", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const session = await setupInitialAdmin(parsed.data);
    const token = await signSessionToken(session);

    const response = NextResponse.json({ user: session }, { status: 201 });
    response.cookies.set({
      ...getSessionCookieOptions(),
      value: token,
    });
    return response;
  } catch (err) {
    if (
      err instanceof Error &&
      err.message === "INITIAL_SETUP_ALREADY_COMPLETED"
    ) {
      return NextResponse.json(
        { error: "Initial admin setup is already complete. Please sign in." },
        { status: 409 }
      );
    }
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to complete admin setup",
      },
      { status: 500 }
    );
  }
}
