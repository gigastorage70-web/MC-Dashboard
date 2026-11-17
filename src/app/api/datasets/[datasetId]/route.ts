import { NextResponse } from "next/server";
import { z } from "zod";
import { commandAnalytics, getAnalyticsEngine } from "@/lib/database/analytics-db";
import { appQuery } from "@/lib/database/app-db";
import { deleteTinybirdDatasetRows } from "@/lib/database/tinybird";
import { deleteStorageObject } from "@/lib/storage";
import {
  requireApiSession,
  writeAuditLog,
} from "@/modules/authentication/service";

const DeleteConfirmSchema = z.object({
  confirmName: z.string().min(1),
});

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
  req: Request,
  context: { params: Promise<{ datasetId: string }> }
) {
  const auth = await requireApiSession(["admin"]);
  if (!auth.ok) return auth.response;

  const { datasetId } = await context.params;
  const body = await req.json().catch(() => ({}));
  const parsed = DeleteConfirmSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "confirmName is required to safely delete a dataset." },
      { status: 400 }
    );
  }

  const dsRes = await appQuery<{ id: string; name: string }>(
    "SELECT id, name FROM datasets WHERE id = $1",
    [datasetId]
  );
  if (dsRes.rows.length === 0) {
    return NextResponse.json({ error: "Dataset not found" }, { status: 404 });
  }
  const dataset = dsRes.rows[0];
  if (dataset.name !== parsed.data.confirmName) {
    return NextResponse.json(
      { error: "Confirmation dataset name does not match." },
      { status: 400 }
    );
  }

  await appQuery("UPDATE datasets SET status = 'DELETING' WHERE id = $1", [
    datasetId,
  ]);

  const keysRes = await appQuery<{
    storage_bucket: string;
    storage_key: string;
    error_report_storage_key: string | null;
  }>(
    `
    SELECT j.storage_bucket, j.storage_key, dqr.error_report_storage_key
    FROM upload_jobs j
    LEFT JOIN data_quality_reports dqr ON dqr.upload_job_id = j.id
    WHERE j.dataset_id = $1
    `,
    [datasetId]
  );

  // Delete analytical rows across active analytical engine (DuckDB, Tinybird, or ClickHouse)
  const engine = getAnalyticsEngine();
  if (engine === "duckdb") {
    await commandAnalytics("DELETE FROM sms_records WHERE dataset_id = $datasetId", {
      datasetId,
    });
    await commandAnalytics("DELETE FROM sms_hourly_rollup WHERE dataset_id = $datasetId", {
      datasetId,
    });
    await commandAnalytics("DELETE FROM ingestion_batches WHERE dataset_id = $datasetId", {
      datasetId,
    });
  } else if (engine === "tinybird") {
    await Promise.all([
      deleteTinybirdDatasetRows("sms_records", datasetId),
      deleteTinybirdDatasetRows("sms_hourly_rollup", datasetId),
      deleteTinybirdDatasetRows("ingestion_batches", datasetId),
    ]);
  } else {
    await commandAnalytics(
      "ALTER TABLE mc_analytics.sms_records DELETE WHERE dataset_id = {datasetId:UUID} SETTINGS mutations_sync = 1",
      { datasetId }
    );
    await commandAnalytics(
      "ALTER TABLE mc_analytics.sms_hourly_rollup DELETE WHERE dataset_id = {datasetId:UUID} SETTINGS mutations_sync = 1",
      { datasetId }
    );
    await commandAnalytics(
      "ALTER TABLE mc_analytics.ingestion_batches DELETE WHERE dataset_id = {datasetId:UUID} SETTINGS mutations_sync = 1",
      { datasetId }
    );
  }

  // Delete raw CSV & error reports from storage
  for (const row of keysRes.rows) {
    await deleteStorageObject(row.storage_bucket, row.storage_key).catch(
      () => undefined
    );
    if (row.error_report_storage_key) {
      await deleteStorageObject(
        row.storage_bucket,
        row.error_report_storage_key
      ).catch(() => undefined);
    }
  }

  await appQuery("DELETE FROM datasets WHERE id = $1", [datasetId]);

  await writeAuditLog({
    actorUserId: auth.session.userId,
    actorEmail: auth.session.email,
    action: "DATASET_DELETED",
    resourceType: "datasets",
    resourceId: datasetId,
    details: { name: dataset.name },
  });

  return NextResponse.json({ ok: true, deletedDatasetId: datasetId });
}
