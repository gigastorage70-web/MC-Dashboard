"use client";

import React from "react";
import { Loader2, Trash2 } from "lucide-react";

export interface DeleteModalTarget {
  datasetId: string;
  datasetName: string;
  fileName?: string;
}

interface DatasetDeleteModalProps {
  target: DeleteModalTarget | null;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DatasetDeleteModal({
  target,
  deleting,
  onCancel,
  onConfirm,
}: DatasetDeleteModalProps) {
  if (!target) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-md space-y-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 shadow-lg">
        <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
          <Trash2 className="h-4 w-4 shrink-0" />
          <h2 className="text-sm font-semibold">Delete Dataset</h2>
        </div>

        <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
          Are you sure you want to permanently delete{" "}
          <strong className="text-[var(--text-primary)]">{target.datasetName}</strong>
          {target.fileName ? ` (${target.fileName})` : ""}? This removes its stored files in Neon storage, Neon PostgreSQL records, and Tinybird analytics data, then purges caches and refreshes indexes.
        </p>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            disabled={deleting}
            onClick={onCancel}
            className="rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--bg-muted)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={deleting}
            onClick={onConfirm}
            className="inline-flex items-center gap-1.5 rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-50"
          >
            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {deleting ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
