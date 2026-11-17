import { NextResponse } from "next/server";
import { appQuery } from "@/lib/database/app-db";
import {
  requireApiSession,
  writeAuditLog,
} from "@/modules/authentication/service";
import { deleteDatasetCompletely } from "@/modules/datasets/maintenance";

export async function PATCH(
  req: Request,
  context: { params: Promise<{ datasetId: string }> }
) {
  const auth = await requireApiSession(["admin", "analyst"]);
  if (!auth.ok) return auth.response;

  const { datasetId } = await context.params;
  const body = (await req.json()) as { archive?: boolean };

  const nextStatus = body.archive ? "ARCHIVED" : "COMPLETED";
  const nowIso = new Date().toISOString();
  const res = await appQuery(
    `
    UPDATE datasets
    SET status = $2,
        archived_at = $3,
        updated_at = $4
    WHERE id = $1
    RETURNING id, name, status
    `,
    [datasetId, nextStatus, body.archive ? nowIso : null, nowIso]
  );

  if (res.rows.length === 0) {
    return NextResponse.json({ error: "Dataset not found" }, { status: 404 });
  }

  await writeAuditLog({
    actorUserId: auth.session.userId,
    actorEmail: auth.session.email,
    action: body.archive ? "DATASET_ARCHIVED" : "DATASET_UNARCHIVED",
    resourceType: "datasets",
    resourceId: datasetId,
  });

  return NextResponse.json({ dataset: res.rows[0] });
}

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ datasetId: string }> }
) {
  const auth = await requireApiSession(["admin"]);
  if (!auth.ok) return auth.response;

  const { datasetId } = await context.params;
  try {
    const result = await deleteDatasetCompletely(datasetId, {
      userId: auth.session.userId,
      email: auth.session.email,
    });
    return NextResponse.json(
      { ok: true, ...result },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Dataset deletion failed";
    const status = message === "Dataset not found" ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
