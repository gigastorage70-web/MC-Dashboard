import { NextResponse } from "next/server";
import { appQuery } from "@/lib/database/app-db";
import {
  requireApiSession,
  writeAuditLog,
} from "@/modules/authentication/service";
import { triggerWorkerWebhook } from "@/modules/csv-ingestion/worker-trigger";

export async function POST(
  _req: Request,
  context: { params: Promise<{ jobId: string }> }
) {
  const auth = await requireApiSession(["admin", "analyst"]);
  if (!auth.ok) return auth.response;

  const { jobId } = await context.params;
  const res = await appQuery<{
    id: string;
    dataset_id: string;
    queue_status: string;
  }>("SELECT id, dataset_id, queue_status FROM upload_jobs WHERE id = $1", [
    jobId,
  ]);

  if (res.rows.length === 0) {
    return NextResponse.json({ error: "Upload job not found" }, { status: 404 });
  }
  const job = res.rows[0];
  if (!["FAILED", "PARTIAL"].includes(job.queue_status)) {
    return NextResponse.json(
      { error: `Job in state ${job.queue_status} cannot be retried.` },
      { status: 409 }
    );
  }

  await appQuery(
    `
    UPDATE upload_jobs
    SET queue_status = 'QUEUED',
        attempt_count = 0,
        next_retry_at = NULL,
        error_message = NULL,
        stage = 3,
        stage_label = 'Queued for recovery retry',
        updated_at = $2
    WHERE id = $1
    `,
    [jobId, new Date().toISOString()]
  );

  await appQuery(
    `
    INSERT INTO processing_logs (upload_job_id, dataset_id, level, stage, message)
    VALUES ($1, $2, 'INFO', 3, 'Manual retry triggered; previously committed batches will be skipped idempotently')
    `,
    [jobId, job.dataset_id]
  );

  await writeAuditLog({
    actorUserId: auth.session.userId,
    actorEmail: auth.session.email,
    action: "UPLOAD_RETRY_QUEUED",
    resourceType: "upload_jobs",
    resourceId: jobId,
  });

  await triggerWorkerWebhook();
  return NextResponse.json({ ok: true, jobId });
}
