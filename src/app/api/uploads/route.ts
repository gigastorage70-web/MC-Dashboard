import { NextResponse } from "next/server";
import { appQuery } from "@/lib/database/app-db";
import { requireApiSession } from "@/modules/authentication/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const res = await appQuery(
    `
    SELECT
      j.id AS job_id,
      j.dataset_id,
      d.name AS dataset_name,
      d.status AS dataset_status,
      d.coverage_start,
      d.coverage_end,
      j.file_name,
      j.file_size_bytes,
      j.stage,
      j.stage_label,
      j.progress_pct,
      j.queue_status,
      j.rows_processed,
      j.rows_inserted,
      j.rows_rejected,
      j.rows_skipped,
      j.duration_ms,
      j.error_message,
      j.created_at,
      j.completed_at,
      u.email AS uploaded_by_email,
      u.full_name AS uploaded_by_name,
      sp.name AS schema_profile_name,
      dqr.error_report_storage_key
    FROM upload_jobs j
    JOIN datasets d ON d.id = j.dataset_id
    LEFT JOIN users u ON u.id = j.uploaded_by
    LEFT JOIN schema_profiles sp ON sp.id = j.schema_profile_id
    LEFT JOIN data_quality_reports dqr ON dqr.upload_job_id = j.id
    ORDER BY j.created_at DESC
    LIMIT 100
    `
  );

  return NextResponse.json({ uploads: res.rows });
}
