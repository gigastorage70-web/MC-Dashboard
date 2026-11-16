import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getEnv } from "@/lib/config/env";
import { appQuery } from "@/lib/database/app-db";
import { sanitizeCsvCell } from "@/lib/metrics/definitions";
import {
  createPresignedDownloadTarget,
  putStorageObject,
} from "@/lib/storage";
import { parseAuthenticatedFilter } from "@/modules/analytics/api-helper";
import {
  queryDimensionBreakdown,
  queryExplorerMessages,
  queryGlobalKpis,
  type AnalyticsDimension,
} from "@/modules/analytics/service";
import {
  requireApiSession,
  writeAuditLog,
} from "@/modules/authentication/service";

const CreateExportSchema = z.object({
  reportType: z.enum([
    "daily_qos_summary",
    "op_performance",
    "tp_performance",
    "applicant_performance",
    "country_performance",
    "rejection_reasons",
    "filtered_messages",
  ]),
});

export async function GET() {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const env = getEnv();
  const res = await appQuery<{
    id: string;
    report_type: string;
    format: string;
    status: string;
    row_count: number;
    file_size_bytes: number;
    storage_key: string | null;
    expires_at: string | null;
    created_at: string;
  }>(
    `
    SELECT id, report_type, format, status, row_count, file_size_bytes,
           storage_key, expires_at, created_at
    FROM report_exports
    ORDER BY created_at DESC
    LIMIT 50
    `
  );

  const exportsWithUrls = await Promise.all(
    res.rows.map(async (row) => {
      let downloadUrl: string | null = null;
      if (row.storage_key && row.status === "COMPLETED") {
        downloadUrl = await createPresignedDownloadTarget({
          bucket: env.S3_BUCKET,
          key: row.storage_key,
          filename: `${row.report_type}-${row.id.slice(0, 8)}.csv`,
          expiresInSeconds: 900,
        }).catch(() => null);
      }
      return { ...row, downloadUrl };
    })
  );

  return NextResponse.json({ exports: exportsWithUrls });
}

export async function POST(req: Request) {
  const parsed = await parseAuthenticatedFilter(req, CreateExportSchema);
  if (!parsed.ok) return parsed.response;

  const env = getEnv();
  const exportId = crypto.randomUUID();
  const reportType = parsed.extra.reportType;

  try {
    let csvLines: string[] = [];
    let rowCount = 0;

    if (reportType === "daily_qos_summary") {
      const kpis = await queryGlobalKpis(parsed.filter);
      csvLines = [
        "Metric,Value",
        ...Object.entries(kpis).map(([k, v]) =>
          [sanitizeCsvCell(k), sanitizeCsvCell(v ?? "N/A")].join(",")
        ),
      ];
      rowCount = csvLines.length - 1;
    } else if (reportType === "filtered_messages") {
      const result = await queryExplorerMessages(parsed.filter, {
        pageSize: 500,
        sortDir: "DESC",
        maskPii: parsed.maskPii,
      });
      const headers = [
        "event_timestamp",
        "op_name",
        "tp_name",
        "op_ani",
        "tp_ani",
        "destination_number",
        "country",
        "raw_status",
        "normalized_status",
        "reason",
        "route",
      ];
      csvLines = [
        headers.join(","),
        ...result.rows.map((r) =>
          headers.map((h) => sanitizeCsvCell(r[h])).join(",")
        ),
      ];
      rowCount = result.rows.length;
    } else {
      const dimMap: Record<string, AnalyticsDimension> = {
        op_performance: "op",
        tp_performance: "tp",
        applicant_performance: "applicant",
        country_performance: "country",
        rejection_reasons: "raw_status",
      };
      const breakdown = await queryDimensionBreakdown(
        parsed.filter,
        dimMap[reportType],
        { limit: 200 }
      );
      csvLines = [
        "Dimension,Total,Delivered,Rejected,Failed,Pending,Success Rate %,Rejection Rate %,Failure Rate %,Failure Contribution %,Top Reason",
        ...breakdown.rows.map((r) =>
          [
            sanitizeCsvCell(r.dimensionValue),
            r.totalMessages,
            r.successMessages,
            r.rejectedMessages,
            r.failedMessages,
            r.pendingMessages,
            r.successRatePct ?? "N/A",
            r.rejectionRatePct ?? "N/A",
            r.failureRatePct ?? "N/A",
            r.failureContributionPct ?? "N/A",
            sanitizeCsvCell(r.topReason ?? ""),
          ].join(",")
        ),
      ];
      rowCount = breakdown.rows.length;
    }

    const csvPayload = csvLines.join("\n");
    const storageKey = `exports/${exportId}-${reportType}.csv`;
    const byteSize = Buffer.byteLength(csvPayload, "utf8");

    await putStorageObject({
      bucket: env.S3_BUCKET,
      key: storageKey,
      body: csvPayload,
      contentType: "text/csv",
    });

    const nowIso = new Date().toISOString();
    const expiresIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    await appQuery(
      `
      INSERT INTO report_exports (
        id, requested_by, report_type, format, filter_payload,
        status, row_count, file_size_bytes, storage_key, expires_at, completed_at
      )
      VALUES ($1, $2, $3, 'CSV', $4, 'COMPLETED', $5, $6, $7, $8, $9)
      `,
      [
        exportId,
        parsed.userId,
        reportType,
        JSON.stringify(parsed.filter),
        rowCount,
        byteSize,
        storageKey,
        expiresIso,
        nowIso,
      ]
    );

    const downloadUrl = await createPresignedDownloadTarget({
      bucket: env.S3_BUCKET,
      key: storageKey,
      filename: `${reportType}-${exportId.slice(0, 8)}.csv`,
      expiresInSeconds: 900,
    });

    await writeAuditLog({
      actorUserId: parsed.userId,
      action: "REPORT_EXPORTED",
      resourceType: "report_exports",
      resourceId: exportId,
      details: { reportType, rowCount },
    });

    return NextResponse.json({ exportId, rowCount, downloadUrl }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Export failed" },
      { status: 500 }
    );
  }
}
