"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import {
  DatasetDeleteModal,
  type DeleteModalTarget,
} from "@/components/datasets/DatasetDeleteModal";
import { useGlobalFilters } from "@/components/filters/FilterContext";

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
  const router = useRouter();
  const { refreshDatasets } = useGlobalFilters();
  const [uploads, setUploads] = useState<UploadHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<DeleteModalTarget | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
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

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setActionError(null);
    setStatusMessage(null);
    setDeleting(true);
    try {
      const res = await fetch(`/api/datasets/${deleteTarget.datasetId}`, {
        method: "DELETE",
      });
      const d = (await res.json()) as {
        error?: string;
        datasetName?: string;
        deletedStorageObjects?: number;
      };
      if (!res.ok) {
        setActionError(d.error ?? "Dataset deletion failed");
        return;
      }
      setDeleteTarget(null);
      setStatusMessage(
        `Deleted "${d.datasetName ?? deleteTarget.datasetName}" (${d.deletedStorageObjects ?? 0} stored file(s) removed). Caches purged & indexes refreshed.`
      );
      await Promise.all([loadUploads(), refreshDatasets()]);
      router.refresh();
    } finally {
      setDeleting(false);
    }
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

      {statusMessage ? (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
          {statusMessage}
        </div>
      ) : null}

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
                        onClick={() =>
                          setDeleteTarget({
                            datasetId: u.dataset_id,
                            datasetName: u.dataset_name,
                            fileName: u.file_name,
                          })
                        }
                        title="Delete Dataset"
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

      <DatasetDeleteModal
        target={deleteTarget}
        deleting={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void handleDelete()}
      />
    </div>
  );
}
