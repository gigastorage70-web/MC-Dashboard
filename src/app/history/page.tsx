"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Archive, RefreshCw, RotateCcw, Trash2 } from "lucide-react";

interface UploadHistoryRow {
  job_id: string;
  dataset_id: string;
  dataset_name: string;
  dataset_status: string;
  coverage_start: string | null;
  coverage_end: string | null;
  file_name: string;
  file_size_bytes: number;
  stage: number;
  stage_label: string;
  progress_pct: number;
  queue_status: string;
  rows_processed: number;
  rows_inserted: number;
  rows_rejected: number;
  rows_skipped: number;
  duration_ms: number | null;
  created_at: string;
  uploaded_by_email: string | null;
  schema_profile_name: string | null;
}

export default function UploadHistoryPage() {
  const [uploads, setUploads] = useState<UploadHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<UploadHistoryRow | null>(null);
  const [confirmName, setConfirmName] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const loadUploads = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/uploads", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { uploads: UploadHistoryRow[] };
        setUploads(data.uploads);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadUploads();
  }, []);

  const handleRetry = async (jobId: string) => {
    setActionError(null);
    const res = await fetch(`/api/uploads/${jobId}/retry`, { method: "POST" });
    if (!res.ok) {
      const d = (await res.json()) as { error?: string };
      setActionError(d.error ?? "Retry failed");
    }
    await loadUploads();
  };

  const handleArchive = async (row: UploadHistoryRow) => {
    const archive = row.dataset_status !== "ARCHIVED";
    await fetch(`/api/datasets/${row.dataset_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archive }),
    });
    await loadUploads();
  };

  const handleDelete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deleteTarget) return;
    setActionError(null);
    const res = await fetch(`/api/datasets/${deleteTarget.dataset_id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmName }),
    });
    const d = (await res.json()) as { error?: string };
    if (!res.ok) {
      setActionError(d.error ?? "Dataset deletion failed");
      return;
    }
    setDeleteTarget(null);
    setConfirmName("");
    await loadUploads();
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] pb-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Dataset &amp; Upload History
          </h1>
          <p className="text-sm text-[var(--text-secondary)]">
            Track ingestion stages, row lineage, data quality reports, retries, and safe multi-store deletion.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadUploads()}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--bg-muted)]"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <Link
            href="/upload"
            className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-950"
          >
            + New Upload
          </Link>
        </div>
      </div>

      {actionError ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
          {actionError}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-muted)] text-[var(--text-secondary)]">
              <th className="px-3 py-2.5 font-medium">Dataset / File</th>
              <th className="px-3 py-2.5 font-medium">Status / Stage</th>
              <th className="px-3 py-2.5 font-medium">Size</th>
              <th className="px-3 py-2.5 font-medium">Valid / Rejected / Skipped</th>
              <th className="px-3 py-2.5 font-medium">Coverage</th>
              <th className="px-3 py-2.5 font-medium">Duration</th>
              <th className="px-3 py-2.5 font-medium">Uploaded</th>
              <th className="px-3 py-2.5 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {uploads.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-8 text-center text-xs text-[var(--text-secondary)]"
                >
                  {loading
                    ? "Loading upload history..."
                    : "No datasets uploaded yet. Upload a MediaCore CSV to get started."}
                </td>
              </tr>
            ) : (
              uploads.map((u) => (
                <tr key={u.job_id} className="border-b border-[var(--border-subtle)]">
                  <td className="px-3 py-2.5">
                    <Link
                      href={`/history/${u.job_id}`}
                      className="font-semibold hover:underline"
                    >
                      {u.dataset_name}
                    </Link>
                    <div className="text-[11px] text-[var(--text-secondary)]">
                      {u.file_name}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="inline-block rounded border border-[var(--border-subtle)] bg-[var(--bg-muted)] px-1.5 py-0.5 text-[11px] font-medium">
                      {u.dataset_status}
                    </span>
                    <div className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
                      {u.stage_label} ({Number(u.progress_pct)}%)
                    </div>
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">
                    {(u.file_size_bytes / (1024 * 1024)).toFixed(1)} MB
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">
                    <span>{Number(u.rows_inserted).toLocaleString()}</span>
                    {" / "}
                    <span className="text-rose-600 dark:text-rose-400">
                      {Number(u.rows_rejected).toLocaleString()}
                    </span>
                    {" / "}
                    <span className="text-[var(--text-secondary)]">
                      {Number(u.rows_skipped).toLocaleString()}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-[11px] text-[var(--text-secondary)]">
                    {u.coverage_start
                      ? `${u.coverage_start.slice(0, 10)} -> ${u.coverage_end?.slice(0, 10) ?? ""}`
                      : "Pending"}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">
                    {u.duration_ms ? `${(u.duration_ms / 1000).toFixed(1)}s` : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-[11px] text-[var(--text-secondary)]">
                    <div>{new Date(u.created_at).toLocaleString()}</div>
                    <div>{u.uploaded_by_email ?? "system"}</div>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="inline-flex items-center gap-1">
                      {["FAILED", "PARTIAL"].includes(u.queue_status) ? (
                        <button
                          type="button"
                          onClick={() => void handleRetry(u.job_id)}
                          title="Retry Job"
                          className="rounded border border-[var(--border-subtle)] p-1.5 hover:bg-[var(--bg-muted)]"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void handleArchive(u)}
                        title={
                          u.dataset_status === "ARCHIVED"
                            ? "Unarchive Dataset"
                            : "Archive Dataset"
                        }
                        className="rounded border border-[var(--border-subtle)] p-1.5 hover:bg-[var(--bg-muted)]"
                      >
                        <Archive className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteTarget(u);
                          setConfirmName("");
                        }}
                        title="Safely Delete Dataset"
                        className="rounded border border-[var(--border-subtle)] p-1.5 text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/30"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Safe Deletion Confirmation Modal */}
      {deleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <form
            onSubmit={handleDelete}
            className="w-full max-w-md space-y-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5"
          >
            <h2 className="text-sm font-semibold text-rose-600 dark:text-rose-400">
              Confirm Safe Dataset Deletion
            </h2>
            <p className="text-xs text-[var(--text-secondary)]">
              This permanently removes ClickHouse analytical rows, raw CSV &amp; error files in storage, and PostgreSQL metadata. Type{" "}
              <strong className="text-[var(--text-primary)]">
                {deleteTarget.dataset_name}
              </strong>{" "}
              to confirm.
            </p>
            <input
              type="text"
              required
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={deleteTarget.dataset_name}
              className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-2 text-xs"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-xs"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={confirmName !== deleteTarget.dataset_name}
                className="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                Delete Permanently
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
