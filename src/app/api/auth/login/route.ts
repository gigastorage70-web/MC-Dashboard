import { NextResponse } from "next/server";
import { z } from "zod";
import {
  authenticateUser,
  writeAuditLog,
} from "@/modules/authentication/service";
import {
  getSessionCookieOptions,
  signSessionToken,
} from "@/lib/security/session";

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = LoginSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Valid email and password are required" },
        { status: 400 }
      );
    }

    const session = await authenticateUser(
      parsed.data.email,
      parsed.data.password
    );
    if (!session) {
      await writeAuditLog({
        actorEmail: parsed.data.email.trim().toLowerCase(),
        action: "AUTH_LOGIN_FAILED",
        resourceType: "user",
      });
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    const token = await signSessionToken(session);
    const response = NextResponse.json({ user: session });
    response.cookies.set({
      ...getSessionCookieOptions(),
      value: token,
    });
    return response;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Authentication failed" },
      { status: 500 }
    );
  }
}
