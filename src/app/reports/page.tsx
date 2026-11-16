"use client";

import React, { useEffect, useState } from "react";
import { Download, FileSpreadsheet } from "lucide-react";
import { useGlobalFilters } from "@/components/filters/FilterContext";
import { GlobalFilterBar } from "@/components/filters/GlobalFilterBar";

interface ExportRow {
  id: string;
  report_type: string;
  format: string;
  status: string;
  row_count: number;
  file_size_bytes: number;
  created_at: string;
  downloadUrl: string | null;
}

const REPORT_TYPES = [
  { id: "daily_qos_summary", label: "Daily QoS Global Summary" },
  { id: "op_performance", label: "OP Performance Report" },
  { id: "tp_performance", label: "TP / Provider Performance Report" },
  { id: "applicant_performance", label: "Applicant Performance Report" },
  { id: "country_performance", label: "Country Performance Report" },
  { id: "rejection_reasons", label: "Rejection & Status Report" },
  { id: "filtered_messages", label: "Filtered Message Sample (Up to 500 rows)" },
] as const;

export default function ReportsPage() {
  const { filter } = useGlobalFilters();
  const [exports, setExports] = useState<ExportRow[]>([]);
  const [reportType, setReportType] = useState<string>("daily_qos_summary");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadExports = async () => {
    const res = await fetch("/api/exports", { cache: "no-store" });
    if (res.ok) {
      const d = (await res.json()) as { exports: ExportRow[] };
      setExports(d.exports ?? []);
    }
  };

  useEffect(() => {
    void loadExports();
  }, []);

  const generateReport = async () => {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/exports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...filter, reportType }),
      });
      const d = (await res.json()) as { downloadUrl?: string; error?: string };
      if (!res.ok) throw new Error(d.error ?? "Export failed");
      await loadExports();
      if (d.downloadUrl) {
        window.open(d.downloadUrl, "_blank", "noopener,noreferrer");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="border-b border-[var(--border-subtle)] pb-4">
        <h1 className="text-xl font-semibold tracking-tight">
          Reports &amp; Formula-Safe Exports
        </h1>
        <p className="text-sm text-[var(--text-secondary)]">
          Generate sanitized CSV reports stored securely with time-limited presigned download URLs.
        </p>
      </div>

      <GlobalFilterBar />

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
        <select
          value={reportType}
          onChange={(e) => setReportType(e.target.value)}
          className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-2 text-xs"
        >
          {REPORT_TYPES.map((rt) => (
            <option key={rt.id} value={rt.id}>
              {rt.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={creating}
          onClick={generateReport}
          className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-xs font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-950"
        >
          <FileSpreadsheet className="h-3.5 w-3.5" />
          {creating ? "Generating CSV..." : "Generate & Download CSV"}
        </button>
        {error ? (
          <span className="text-xs text-rose-600 dark:text-rose-400">{error}</span>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-muted)] text-[var(--text-secondary)]">
              <th className="px-3 py-2.5">Report Type</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5">Rows</th>
              <th className="px-3 py-2.5">Size</th>
              <th className="px-3 py-2.5">Created</th>
              <th className="px-3 py-2.5 text-right">Download</th>
            </tr>
          </thead>
          <tbody>
            {exports.map((ex) => (
              <tr key={ex.id} className="border-b border-[var(--border-subtle)]">
                <td className="px-3 py-2 font-medium">{ex.report_type}</td>
                <td className="px-3 py-2">{ex.status}</td>
                <td className="px-3 py-2 tabular-nums">{ex.row_count}</td>
                <td className="px-3 py-2 tabular-nums">
                  {(ex.file_size_bytes / 1024).toFixed(1)} KB
                </td>
                <td className="px-3 py-2 text-[var(--text-secondary)]">
                  {new Date(ex.created_at).toLocaleString()}
                </td>
                <td className="px-3 py-2 text-right">
                  {ex.downloadUrl ? (
                    <a
                      href={ex.downloadUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded border border-[var(--border-subtle)] px-2.5 py-1 hover:bg-[var(--bg-muted)]"
                    >
                      <Download className="h-3 w-3" /> CSV
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
