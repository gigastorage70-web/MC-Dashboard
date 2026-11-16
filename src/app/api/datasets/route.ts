import { NextResponse } from "next/server";
import { appQuery, parseJsonField } from "@/lib/database/app-db";
import { requireApiSession } from "@/modules/authentication/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const res = await appQuery<Record<string, unknown>>(
    `
    SELECT id, name, status, coverage_start, coverage_end,
           total_rows, valid_rows, invalid_rows, available_dimensions, created_at
    FROM datasets
    WHERE status IN ('COMPLETED', 'PARTIAL', 'ARCHIVED')
    ORDER BY created_at DESC
    LIMIT 200
    `
  );

  return NextResponse.json({
    datasets: res.rows.map((r) => ({
      ...r,
      available_dimensions: parseJsonField(r.available_dimensions, []),
    })),
  });
}
