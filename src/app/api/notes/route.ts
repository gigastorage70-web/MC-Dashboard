import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { appQuery } from "@/lib/database/app-db";
import { requireApiSession } from "@/modules/authentication/service";

const CreateNoteSchema = z.object({
  datasetId: z.string().uuid().optional().nullable(),
  title: z.string().min(2).max(255),
  body: z.string().min(2).max(5000),
  dimensionTag: z.string().max(120).optional(),
  filterContext: z.record(z.unknown()).default({}),
});

export async function GET() {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const res = await appQuery(
    `
    SELECT n.*, u.full_name AS author_name, d.name AS dataset_name
    FROM investigation_notes n
    LEFT JOIN users u ON u.id = n.author_id
    LEFT JOIN datasets d ON d.id = n.dataset_id
    ORDER BY n.created_at DESC
    LIMIT 50
    `
  );
  return NextResponse.json({ notes: res.rows });
}

export async function POST(req: Request) {
  const auth = await requireApiSession(["admin", "analyst", "operator"]);
  if (!auth.ok) return auth.response;

  const body = await req.json();
  const parsed = CreateNoteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid note payload" }, { status: 400 });
  }

  const id = crypto.randomUUID();
  const res = await appQuery(
    `
    INSERT INTO investigation_notes (id, dataset_id, author_id, title, body, dimension_tag, filter_context)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
    `,
    [
      id,
      parsed.data.datasetId ?? null,
      auth.session.userId,
      parsed.data.title.trim(),
      parsed.data.body.trim(),
      parsed.data.dimensionTag ?? null,
      JSON.stringify(parsed.data.filterContext),
    ]
  );

  return NextResponse.json({ note: res.rows[0] }, { status: 201 });
}
