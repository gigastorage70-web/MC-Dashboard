import { NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/security/session";
import {
  getUserPreferences,
  hasAnyUser,
} from "@/modules/authentication/service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [anyUser, session] = await Promise.all([
      hasAnyUser(),
      getSessionFromCookies(),
    ]);

    const preferences = session
      ? await getUserPreferences(session.userId)
      : null;

    return NextResponse.json({
      dbUnavailable: false,
      needsSetup: !anyUser,
      authenticated: Boolean(session),
      user: session,
      preferences,
    });
  } catch (err) {
    return NextResponse.json(
      {
        dbUnavailable: true,
        needsSetup: false,
        authenticated: false,
        user: null,
        error:
          err instanceof Error
            ? err.message
            : "PostgreSQL unavailable. Start Docker or check DATABASE_URL.",
      },
      { status: 503 }
    );
  }
}
