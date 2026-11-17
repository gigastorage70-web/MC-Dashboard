"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Database,
  HardDrive,
  Layers,
  Loader2,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  DatasetDeleteModal,
  type DeleteModalTarget,
} from "@/components/datasets/DatasetDeleteModal";
import type { StorageSummaryPayload } from "@/modules/datasets/maintenance";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let idx = 0;
  let val = bytes;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx += 1;
  }
  return `${val >= 100 || idx === 0 ? val.toFixed(0) : val.toFixed(2)} ${units[idx]}`;
}

function pctUsed(consumed: number, quota: number | null): number {
  if (!quota || quota <= 0) return 0;
  return Math.min(100, Math.max(0, (consumed / quota) * 100));
}

function barTone(pct: number): string {
  if (pct >= 90) return "bg-rose-500";
  if (pct >= 70) return "bg-amber-500";
  return "bg-emerald-500";
}

interface LiveStorageWidgetProps {
  refreshKey?: number;
  onDatasetChanged?: () => void;
}

export function LiveStorageWidget({
  refreshKey = 0,
  onDatasetChanged,
}: LiveStorageWidgetProps) {
  const router = useRouter();
  const [summary, setSummary] = useState<StorageSummaryPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteModalTarget | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch("/api/storage/summary", { cache: "no-store" });
      const data = (await res.json()) as StorageSummaryPayload & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to load storage status");
      setSummary(data);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to load storage telemetry"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary, refreshKey]);

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setStatusMessage(null);
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/datasets/${deleteTarget.datasetId}`, {
        method: "DELETE",
      });
      const data = (await res.json()) as {
        error?: string;
        datasetName?: string;
        deletedStorageObjects?: number;
      };
      if (!res.ok) throw new Error(data.error ?? "Dataset deletion failed");
      setDeleteTarget(null);
      setStatusMessage(
        `Deleted "${data.datasetName ?? deleteTarget.datasetName}" (${data.deletedStorageObjects ?? 0} file(s) removed). Neon cache purged & indexes refreshed.`
      );
      await loadSummary();
      onDatasetChanged?.();
      router.refresh();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Delete failed");
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  const runMaintenance = async (
    action: "purge_cache_and_reindex" | "clean_orphans"
  ) => {
    setBusyAction(action);
    setStatusMessage(null);
    setErrorMessage(null);
    try {
      const res = await fetch("/api/storage/maintenance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await res.json()) as {
        error?: string;
        deletedObjects?: number;
        freedBytes?: number;
        reindexedTables?: string[];
      };
      if (!res.ok) throw new Error(data.error ?? "Maintenance action failed");
      if (action === "clean_orphans") {
        setStatusMessage(
          `Removed ${data.deletedObjects ?? 0} orphaned storage object(s) (${formatBytes(data.freedBytes ?? 0)} freed) and refreshed indexes.`
        );
      } else {
        setStatusMessage(
          `Cache purged and index statistics refreshed across ${data.reindexedTables?.length ?? 0} database tables.`
        );
      }
      await loadSummary();
      onDatasetChanged?.();
      router.refresh();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Maintenance action failed"
      );
    } finally {
      setBusyAction(null);
    }
  };

  const obj = summary?.objectStorage;
  const pg = summary?.appDatabase;
  const analytics = summary?.analyticsDatabase;

  const objPct = obj ? pctUsed(obj.consumedBytes, obj.quotaBytes) : 0;
  const pgPct = pg ? pctUsed(pg.consumedBytes, pg.quotaBytes) : 0;
  const analyticsPct = analytics
    ? pctUsed(analytics.consumedBytes, analytics.quotaBytes)
    : 0;

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">
            Live Cloud Storage &amp; Dataset Manager
          </h2>
          <p className="text-xs text-[var(--text-secondary)]">
            Real-time consumed and available capacity across Neon Object Storage, Neon PostgreSQL, and Tinybird analytics.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {summary && summary.orphanObjects.count > 0 ? (
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={() => void runMaintenance("clean_orphans")}
              className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
            >
              {busyAction === "clean_orphans" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
              Clean {summary.orphanObjects.count} Orphan File(s) (
              {formatBytes(summary.orphanObjects.totalBytes)})
            </button>
          ) : null}

          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() => void runMaintenance("purge_cache_and_reindex")}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--bg-muted)] disabled:opacity-50"
          >
            {busyAction === "purge_cache_and_reindex" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            Purge Cache &amp; Re-index
          </button>

          <button
            type="button"
            disabled={loading}
            onClick={() => void loadSummary()}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--bg-muted)] disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {statusMessage ? (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
          {statusMessage}
        </div>
      ) : null}

      {errorMessage ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
          {errorMessage}
        </div>
      ) : null}

      {/* Live Storage Capacity Cards */}
      <div className="grid gap-3 md:grid-cols-3">
        {/* Card 1: Object Storage */}
        <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3.5 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <HardDrive className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
              CSV Object Storage ({obj?.provider ?? "neon"})
            </span>
            <span className="text-[11px] text-[var(--text-secondary)]">
              {obj?.objectCount ?? 0} file(s)
            </span>
          </div>
          <div className="flex items-baseline justify-between text-xs tabular-nums">
            <span className="font-semibold">
              {obj ? formatBytes(obj.consumedBytes) : "—"} used
            </span>
            <span className="text-[var(--text-secondary)]">
              {obj?.availableBytes !== null && obj?.availableBytes !== undefined
                ? `${formatBytes(obj.availableBytes)} free / ${formatBytes(obj.quotaBytes ?? 0)}`
                : "Local disk"}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-muted)]">
            <div
              className={`h-full transition-all ${barTone(objPct)}`}
              style={{ width: `${objPct}%` }}
            />
          </div>
        </div>

        {/* Card 2: Neon Postgres DB */}
        <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3.5 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <Database className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
              Neon Metadata DB ({pg?.engine ?? "postgres"})
            </span>
            <span className="text-[11px] text-[var(--text-secondary)]">
              {pg?.quotaBytes ? `${pgPct.toFixed(1)}%` : "Local"}
            </span>
          </div>
          <div className="flex items-baseline justify-between text-xs tabular-nums">
            <span className="font-semibold">
              {pg ? formatBytes(pg.consumedBytes) : "—"} used
            </span>
            <span className="text-[var(--text-secondary)]">
              {pg?.availableBytes !== null && pg?.availableBytes !== undefined
                ? `${formatBytes(pg.availableBytes)} free / ${formatBytes(pg.quotaBytes ?? 0)}`
                : "SQLite file"}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-muted)]">
            <div
              className={`h-full transition-all ${barTone(pgPct)}`}
              style={{ width: `${pgPct}%` }}
            />
          </div>
        </div>

        {/* Card 3: Tinybird / ClickHouse */}
        <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3.5 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <Layers className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
              Analytics DB ({analytics?.engine ?? "tinybird"})
            </span>
            <span className="text-[11px] text-[var(--text-secondary)] tabular-nums">
              {(analytics?.totalRows ?? 0).toLocaleString()} rows
            </span>
          </div>
          <div className="flex items-baseline justify-between text-xs tabular-nums">
            <span className="font-semibold">
              {analytics ? formatBytes(analytics.consumedBytes) : "—"} used
            </span>
            <span className="text-[var(--text-secondary)]">
              {analytics?.availableBytes !== null &&
              analytics?.availableBytes !== undefined
                ? `${formatBytes(analytics.availableBytes)} free / ${formatBytes(analytics.quotaBytes ?? 0)}`
                : "Embedded"}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-muted)]">
            <div
              className={`h-full transition-all ${barTone(analyticsPct)}`}
              style={{ width: `${analyticsPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Managed Stored Datasets List */}
      <div className="overflow-x-auto rounded-md border border-[var(--border-subtle)]">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-muted)] text-[var(--text-secondary)]">
              <th className="px-3 py-2 font-medium">Stored Dataset / CSV File</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Rows</th>
              <th className="px-3 py-2 font-medium">Bucket Size</th>
              <th className="px-3 py-2 font-medium">Uploaded</th>
              <th className="px-3 py-2 text-right font-medium">Manage</th>
            </tr>
          </thead>
          <tbody>
            {!summary || summary.datasets.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-4 text-center text-xs text-[var(--text-secondary)]"
                >
                  {loading
                    ? "Scanning live cloud storage..."
                    : "No datasets stored yet. Bucket storage is 100% free."}
                </td>
              </tr>
            ) : (
              summary.datasets.map((ds) => (
                <tr
                  key={ds.id}
                  className="border-b border-[var(--border-subtle)] last:border-b-0"
                >
                  <td className="px-3 py-2">
                    <div className="font-medium">{ds.name}</div>
                    <div className="text-[11px] text-[var(--text-secondary)]">
                      {ds.fileName}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-block rounded border border-[var(--border-subtle)] bg-[var(--bg-muted)] px-1.5 py-0.5 text-[11px]">
                      {ds.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {ds.validRows.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {ds.storageBytes > 0
                      ? formatBytes(ds.storageBytes)
                      : ds.reportedFileSizeBytes > 0
                      ? `${formatBytes(ds.reportedFileSizeBytes)} (CSV purged)`
                      : "0 B"}
                  </td>
                  <td className="px-3 py-2 text-[11px] text-[var(--text-secondary)]">
                    {new Date(ds.createdAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() =>
                        setDeleteTarget({
                          datasetId: ds.id,
                          datasetName: ds.name,
                          fileName: ds.fileName,
                        })
                      }
                      title="Delete Dataset & Free Storage"
                      className="inline-flex items-center gap-1 rounded border border-[var(--border-subtle)] px-2 py-1 text-[11px] text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/30"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </button>
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
        onConfirm={() => void handleConfirmDelete()}
      />
    </div>
  );
}
