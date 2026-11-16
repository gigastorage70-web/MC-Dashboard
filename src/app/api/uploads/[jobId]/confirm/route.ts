import { NextResponse } from "next/server";
import { z } from "zod";
import { appQuery } from "@/lib/database/app-db";
import { verifyObjectExists } from "@/lib/storage";
import {
  requireApiSession,
  writeAuditLog,
} from "@/modules/authentication/service";
import { triggerWorkerWebhook } from "@/modules/csv-ingestion/worker-trigger";
import { LOGICAL_FIELDS } from "@/modules/schema-mapping/constants";

const ConfirmUploadSchema = z.object({
  delimiter: z.enum([";", ",", "\t", "|"]),
  mapping: z.record(z.string().min(1), z.enum([...LOGICAL_FIELDS, "IGNORE"])),
  schemaProfileId: z.string().uuid().optional().nullable(),
});

export async function POST(
  req: Request,
  context: { params: Promise<{ jobId: string }> }
) {
  const auth = await requireApiSession(["admin", "analyst"]);
  if (!auth.ok) return auth.response;

  const { jobId } = await context.params;
  const body = await req.json();
  const parsed = ConfirmUploadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid schema confirmation payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const mappedFields = new Set(Object.values(parsed.data.mapping));
  if (!mappedFields.has("MESSAGE_TIMESTAMP")) {
    return NextResponse.json(
      { error: "Message Timestamp column must be mapped before processing." },
      { status: 400 }
    );
  }
  if (!mappedFields.has("OP_NAME") && !mappedFields.has("TP_NAME")) {
    return NextResponse.json(
      { error: "At least OP Name or TP Name must be mapped." },
      { status: 400 }
    );
  }

  const jobRes = await appQuery<{
    id: string;
    dataset_id: string;
    storage_bucket: string;
    storage_key: string;
  }>(
    "SELECT id, dataset_id, storage_bucket, storage_key FROM upload_jobs WHERE id = $1",
    [jobId]
  );

  if (jobRes.rows.length === 0) {
    return NextResponse.json({ error: "Upload job not found" }, { status: 404 });
  }
  const job = jobRes.rows[0];

  const exists = await verifyObjectExists(job.storage_bucket, job.storage_key);
  if (!exists) {
    return NextResponse.json(
      { error: "Uploaded file was not found in storage. Please retry the upload." },
      { status: 400 }
    );
  }

  const nowIso = new Date().toISOString();
  await appQuery(
    `
    UPDATE upload_jobs
    SET schema_profile_id = COALESCE($2, schema_profile_id),
        custom_mapping_override = $3,
        stage = 3,
        stage_label = 'Upload completed',
        progress_pct = 3,
        queue_status = 'QUEUED',
        updated_at = $4
    WHERE id = $1
    `,
    [
      jobId,
      parsed.data.schemaProfileId ?? null,
      JSON.stringify({
        delimiter: parsed.data.delimiter,
        mapping: parsed.data.mapping,
      }),
      nowIso,
    ]
  );

  await appQuery(
    "UPDATE datasets SET status = 'PENDING', updated_at = $2 WHERE id = $1",
    [job.dataset_id, nowIso]
  );

  await appQuery(
    `
    INSERT INTO processing_logs (upload_job_id, dataset_id, level, stage, message)
    VALUES ($1, $2, 'INFO', 3, 'Upload verified in storage and queued for streaming ingestion')
    `,
    [jobId, job.dataset_id]
  );

  await writeAuditLog({
    actorUserId: auth.session.userId,
    actorEmail: auth.session.email,
    action: "UPLOAD_CONFIRMED_QUEUED",
    resourceType: "upload_jobs",
    resourceId: jobId,
  });

  await triggerWorkerWebhook();

  return NextResponse.json({ ok: true, jobId, status: "QUEUED" });
}
