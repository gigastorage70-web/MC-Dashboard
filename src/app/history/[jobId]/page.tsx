"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";

interface JobDetailPayload {
  job: {
    id: string;
    dataset_name: string;
    file_name: string;
    file_size_bytes: number;
    stage: number;
    stage_label: string;
    progress_pct: number;
    queue_status: string;
    duration_ms: number | null;
    error_message: string | null;
    available_dimensions: string[];
  };
  qualityReport: {
    total_rows_detected: number;
    valid_rows: number;
    invalid_rows: number;
    duplicate_rows: number;
    rows_skipped: number;
    repeated_header_rows: number;
    missing_critical_fields: number;
    unknown_status_rows: number;
    malformed_timestamps: number;
    unrecognized_columns: string[];
    error_report_storage_key: string | null;
    final_status: string;
  } | null;
  logs: Array<{
    id: number;
    level: string;
    stage: number;
    message: string;
    created_at: string;
  }>;
}

export default function UploadJobDetailPage() {
  const params = useParams<{ jobId: string }>();
  const [data, setData] = useState<JobDetailPayload | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!params.jobId) return;
    fetch(`/api/uploads/${params.jobId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: JobDetailPayload) => setData(d))
      .catch(() => setErrMsg("Failed to load upload report"));
  }, [params.jobId]);

  const downloadErrorCsv = async () => {
    if (!params.jobId) return;
    const res = await fetch(`/api/uploads/${params.jobId}/error-report`);
    const d = (await res.json()) as { downloadUrl?: string; error?: string };
    if (d.downloadUrl) {
      window.open(d.downloadUrl, "_blank", "noopener,noreferrer");
    } else {
      setErrMsg(d.error ?? "No error report available");
    }
  };

  if (!data) {
    return (
      <div className="mx-auto max-w-5xl text-xs text-[var(--text-secondary)]">
        {errMsg ?? "Loading upload report..."}
      </div>
    );
  }

  const qr = data.qualityReport;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-4">
        <div>
          <Link
            href="/history"
            className="mb-1 inline-flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Upload History
          </Link>
          <h1 className="text-xl font-semibold">{data.job.dataset_name}</h1>
          <p className="text-xs text-[var(--text-secondary)]">
            {data.job.file_name} • {data.job.stage_label} ({data.job.queue_status})
          </p>
        </div>

        {qr?.error_report_storage_key ? (
          <button
            type="button"
            onClick={downloadErrorCsv}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--bg-muted)]"
          >
            <Download className="h-3.5 w-3.5" /> Download Error Report CSV
          </button>
        ) : null}
      </div>

      {qr ? (
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
          <h2 className="mb-3 text-sm font-semibold">Data Quality Report</h2>
          <div className="grid gap-3 text-xs sm:grid-cols-3 lg:grid-cols-5">
            {[
              ["Total Rows Detected", qr.total_rows_detected],
              ["Valid Rows", qr.valid_rows],
              ["Invalid Rows", qr.invalid_rows],
              ["Duplicate Rows", qr.duplicate_rows],
              ["Skipped Rows", qr.rows_skipped],
              ["Repeated Headers", qr.repeated_header_rows],
              ["Missing Critical", qr.missing_critical_fields],
              ["Unknown Statuses", qr.unknown_status_rows],
              ["Malformed Timestamps", qr.malformed_timestamps],
              ["Final Status", qr.final_status],
            ].map(([label, val]) => (
              <div
                key={String(label)}
                className="rounded border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3"
              >
                <div className="text-[11px] text-[var(--text-secondary)]">
                  {label}
                </div>
                <div className="mt-1 text-sm font-semibold tabular-nums">
                  {typeof val === "number" ? val.toLocaleString() : val}
                </div>
              </div>
            ))}
          </div>

          {qr.unrecognized_columns.length > 0 ? (
            <p className="mt-4 text-xs text-[var(--text-secondary)]">
              Preserved Extra Columns: {qr.unrecognized_columns.join(", ")}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
        <h2 className="mb-3 text-sm font-semibold">Processing Logs</h2>
        <div className="max-h-80 space-y-1.5 overflow-y-auto font-mono text-[11px]">
          {data.logs.map((log) => (
            <div
              key={log.id}
              className="flex gap-3 border-b border-[var(--border-subtle)] py-1.5"
            >
              <span className="shrink-0 text-[var(--text-secondary)]">
                {new Date(log.created_at).toLocaleTimeString()}
              </span>
              <span className="shrink-0 font-semibold">[{log.level}]</span>
              <span>
                (Stage {log.stage}) {log.message}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
