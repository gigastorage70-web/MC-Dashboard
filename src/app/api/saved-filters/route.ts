import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { appQuery, asBool, parseJsonField } from "@/lib/database/app-db";
import { GlobalFilterSchema } from "@/modules/analytics/filter-schema";
import { requireApiSession } from "@/modules/authentication/service";

const SaveFilterSchema = z.object({
  name: z.string().min(2).max(150),
  description: z.string().max(500).optional(),
  filterPayload: GlobalFilterSchema,
  isShared: z.boolean().default(false),
});

export async function GET() {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const res = await appQuery<{
    id: string;
    name: string;
    description: string | null;
    filter_payload: unknown;
    share_token: string | null;
    is_shared: boolean | number;
    created_at: string;
  }>(
    `
    SELECT id, name, description, filter_payload, share_token, is_shared, created_at
    FROM saved_filters
    WHERE owner_id = $1 OR is_shared = $2
    ORDER BY created_at DESC
    `,
    [auth.session.userId, true]
  );

  return NextResponse.json({
    filters: res.rows.map((r) => ({
      ...r,
      is_shared: asBool(r.is_shared),
      filter_payload: parseJsonField(r.filter_payload, {}),
    })),
  });
}

export async function POST(req: Request) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const body = await req.json();
  const parsed = SaveFilterSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid filter preset payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const id = crypto.randomUUID();
  const shareToken = crypto.randomBytes(12).toString("hex");
  await appQuery(
    `
    INSERT INTO saved_filters (id, name, description, filter_payload, share_token, is_shared, owner_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      id,
      parsed.data.name.trim(),
      parsed.data.description ?? null,
      JSON.stringify(parsed.data.filterPayload),
      shareToken,
      parsed.data.isShared,
      auth.session.userId,
    ]
  );

  return NextResponse.json({ id, shareToken }, { status: 201 });
}

export async function DELETE(req: Request) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Preset id is required" }, { status: 400 });
  }

  await appQuery("DELETE FROM saved_filters WHERE id = $1 AND owner_id = $2", [
    id,
    auth.session.userId,
  ]);
  return NextResponse.json({ ok: true });
}
