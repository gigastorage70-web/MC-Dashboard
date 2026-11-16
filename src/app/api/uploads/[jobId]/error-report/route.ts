import { NextResponse } from "next/server";
import { appQuery } from "@/lib/database/app-db";
import { createPresignedDownloadTarget } from "@/lib/storage";
import {
  requireApiSession,
  writeAuditLog,
} from "@/modules/authentication/service";

export async function GET(
  _req: Request,
  context: { params: Promise<{ jobId: string }> }
) {
  const auth = await requireApiSession(["admin", "analyst"]);
  if (!auth.ok) return auth.response;

  const { jobId } = await context.params;
  const res = await appQuery<{
    storage_bucket: string;
    error_report_storage_key: string | null;
  }>(
    `
    SELECT j.storage_bucket, dqr.error_report_storage_key
    FROM upload_jobs j
    JOIN data_quality_reports dqr ON dqr.upload_job_id = j.id
    WHERE j.id = $1
    `,
    [jobId]
  );

  const row = res.rows[0];
  if (!row || !row.error_report_storage_key) {
    return NextResponse.json(
      { error: "No error report is available for this upload job." },
      { status: 404 }
    );
  }

  const downloadUrl = await createPresignedDownloadTarget({
    bucket: row.storage_bucket,
    key: row.error_report_storage_key,
    filename: `error-report-${jobId}.csv`,
    expiresInSeconds: 300,
  });

  await writeAuditLog({
    actorUserId: auth.session.userId,
    actorEmail: auth.session.email,
    action: "ERROR_REPORT_DOWNLOADED",
    resourceType: "upload_jobs",
    resourceId: jobId,
  });

  return NextResponse.json({ downloadUrl, expiresInSeconds: 300 });
}
