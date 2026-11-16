import { NextResponse } from "next/server";
import { z } from "zod";
import { appQuery } from "@/lib/database/app-db";
import {
  getUserPreferences,
  requireApiSession,
} from "@/modules/authentication/service";

const PreferencesPatchSchema = z.object({
  theme: z.enum(["light", "dark", "system"]).optional(),
  maskSensitiveIdentifiers: z.boolean().optional(),
  defaultPageSize: z.number().int().min(10).max(500).optional(),
  timezone: z.string().min(2).max(64).optional(),
});

export async function GET() {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const preferences = await getUserPreferences(auth.session.userId);
  return NextResponse.json({ preferences });
}

export async function PATCH(req: Request) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const body = await req.json();
  const parsed = PreferencesPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid preferences payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const current = await getUserPreferences(auth.session.userId);
  const next = {
    theme: parsed.data.theme ?? current.theme,
    maskSensitiveIdentifiers:
      parsed.data.maskSensitiveIdentifiers ?? current.maskSensitiveIdentifiers,
    defaultPageSize: parsed.data.defaultPageSize ?? current.defaultPageSize,
    timezone: parsed.data.timezone ?? current.timezone,
  };

  await appQuery(
    `
    INSERT INTO user_preferences (user_id, theme, mask_sensitive_identifiers, default_page_size, timezone, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (user_id) DO UPDATE SET
      theme = EXCLUDED.theme,
      mask_sensitive_identifiers = EXCLUDED.mask_sensitive_identifiers,
      default_page_size = EXCLUDED.default_page_size,
      timezone = EXCLUDED.timezone,
      updated_at = EXCLUDED.updated_at
    `,
    [
      auth.session.userId,
      next.theme,
      next.maskSensitiveIdentifiers,
      next.defaultPageSize,
      next.timezone,
      new Date().toISOString(),
    ]
  );

  return NextResponse.json({ preferences: next });
}
