import { NextResponse } from "next/server";
import { appQuery, parseJsonField } from "@/lib/database/app-db";
import { requireApiSession } from "@/modules/authentication/service";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  context: { params: Promise<{ jobId: string }> }
) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const { jobId } = await context.params;

  const [jobRes, dqrRes, logsRes] = await Promise.all([
    appQuery<Record<string, unknown>>(
      `
      SELECT j.*, d.name AS dataset_name, d.status AS dataset_status,
             d.coverage_start, d.coverage_end, d.available_dimensions,
             u.email AS uploaded_by_email, sp.name AS schema_profile_name
      FROM upload_jobs j
      JOIN datasets d ON d.id = j.dataset_id
      LEFT JOIN users u ON u.id = j.uploaded_by
      LEFT JOIN schema_profiles sp ON sp.id = j.schema_profile_id
      WHERE j.id = $1
      `,
      [jobId]
    ),
    appQuery<Record<string, unknown>>(
      "SELECT * FROM data_quality_reports WHERE upload_job_id = $1",
      [jobId]
    ),
    appQuery<Record<string, unknown>>(
      `
      SELECT id, level, stage, message, metadata, created_at
      FROM processing_logs
      WHERE upload_job_id = $1
      ORDER BY created_at DESC
      LIMIT 200
      `,
      [jobId]
    ),
  ]);

  if (jobRes.rows.length === 0) {
    return NextResponse.json({ error: "Upload job not found" }, { status: 404 });
  }

  const jobRow = jobRes.rows[0];
  const dqrRow = dqrRes.rows[0] ?? null;

  return NextResponse.json({
    job: {
      ...jobRow,
      available_dimensions: parseJsonField(jobRow.available_dimensions, []),
    },
    qualityReport: dqrRow
      ? {
          ...dqrRow,
          unrecognized_columns: parseJsonField(dqrRow.unrecognized_columns, []),
          mapped_columns: parseJsonField(dqrRow.mapped_columns, {}),
          error_breakdown: parseJsonField(dqrRow.error_breakdown, {}),
        }
      : null,
    logs: logsRes.rows.map((l) => ({
      ...l,
      metadata: parseJsonField(l.metadata, {}),
    })),
  });
}
