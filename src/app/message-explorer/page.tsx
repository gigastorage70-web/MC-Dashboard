"use client";

import React, { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Columns3, Copy, Download, X } from "lucide-react";
import { sanitizeCsvCell } from "@/lib/metrics/definitions";
import { useGlobalFilters } from "@/components/filters/FilterContext";
import { GlobalFilterBar } from "@/components/filters/GlobalFilterBar";

interface ExplorerRecord {
  dataset_id: string;
  message_row_id: number;
  event_timestamp: string;
  dlr_timestamp: string | null;
  dlr_latency_ms: number | null;
  op_name: string;
  tp_name: string;
  applicant: string;
  direction: string;
  route: string;
  op_ani: string;
  tp_ani: string;
  destination_number: string;
  country: string;
  raw_country_network: string;
  state_region: string;
  raw_submit_status: string;
  raw_dlr_state: string;
  raw_status: string;
  normalized_status: string;
  reason: string;
  message_id: string;
  op_host: string;
  tp_host: string;
  cost_in: number | null;
  cost_out: number | null;
  op_currency: string;
  extra_attributes: string;
}

interface CursorToken {
  cursorTs: string;
  cursorRowId: number;
}

const ALL_COLUMNS: Array<{ key: keyof ExplorerRecord; label: string; defaultOn: boolean }> = [
  { key: "event_timestamp", label: "Send Time (UTC)", defaultOn: true },
  { key: "op_name", label: "OP Name", defaultOn: true },
  { key: "tp_name", label: "TP Name", defaultOn: true },
  { key: "op_ani", label: "OP ANI", defaultOn: true },
  { key: "destination_number", label: "Destination", defaultOn: true },
  { key: "country", label: "Country", defaultOn: true },
  { key: "raw_status", label: "Raw Status", defaultOn: true },
  { key: "normalized_status", label: "Normalized", defaultOn: true },
  { key: "route", label: "Route / Dialpeer", defaultOn: true },
  { key: "reason", label: "Reason", defaultOn: false },
  { key: "tp_ani", label: "TP ANI", defaultOn: false },
  { key: "message_id", label: "Message ID", defaultOn: false },
  { key: "dlr_latency_ms", label: "DLR Latency (ms)", defaultOn: false },
  { key: "cost_in", label: "Cost IN", defaultOn: false },
  { key: "cost_out", label: "Cost OUT", defaultOn: false },
];

export default function MessageExplorerPage() {
  const { filter } = useGlobalFilters();
  const [rows, setRows] = useState<ExplorerRecord[]>([]);
  const [pageSize, setPageSize] = useState(50);
  const [sortDir, setSortDir] = useState<"DESC" | "ASC">("DESC");
  const [cursorHistory, setCursorHistory] = useState<Array<CursorToken | null>>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const [nextCursor, setNextCursor] = useState<CursorToken | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedRow, setSelectedRow] = useState<ExplorerRecord | null>(null);
  const [showColMenu, setShowColMenu] = useState(false);
  const [visibleCols, setVisibleCols] = useState<Set<keyof ExplorerRecord>>(
    new Set(ALL_COLUMNS.filter((c) => c.defaultOn).map((c) => c.key))
  );

  // Reset cursor stack whenever filters, pageSize, or sortDir change
  useEffect(() => {
    setCursorHistory([null]);
    setPageIndex(0);
  }, [filter, pageSize, sortDir]);

  const fetchPage = useCallback(async () => {
    setLoading(true);
    const currentCursor = cursorHistory[pageIndex] ?? null;
    try {
      const res = await fetch("/api/explorer/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...filter,
          pageSize,
          sortDir,
          cursorTs: currentCursor?.cursorTs,
          cursorRowId: currentCursor?.cursorRowId,
        }),
      });
      if (res.ok) {
        const d = (await res.json()) as {
          rows: ExplorerRecord[];
          nextCursor: CursorToken | null;
        };
        setRows(d.rows ?? []);
        setNextCursor(d.nextCursor ?? null);
      }
    } finally {
      setLoading(false);
    }
  }, [filter, pageSize, sortDir, cursorHistory, pageIndex]);

  useEffect(() => {
    void fetchPage();
  }, [fetchPage]);

  const handleNext = () => {
    if (!nextCursor) return;
    setCursorHistory((prev) => {
      const updated = prev.slice(0, pageIndex + 1);
      updated.push(nextCursor);
      return updated;
    });
    setPageIndex((i) => i + 1);
  };

  const handlePrev = () => {
    if (pageIndex <= 0) return;
    setPageIndex((i) => i - 1);
  };

  const exportVisiblePageCsv = () => {
    const active = ALL_COLUMNS.filter((c) => visibleCols.has(c.key));
    const lines = [
      active.map((c) => sanitizeCsvCell(c.label)).join(","),
      ...rows.map((r) =>
        active.map((c) => sanitizeCsvCell(r[c.key])).join(",")
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mc-explorer-page-${pageIndex + 1}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] pb-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Message Record Explorer
          </h1>
          <p className="text-sm text-[var(--text-secondary)]">
            Server-side keyset cursor pagination over ClickHouse XDR rows. Click any row to inspect raw + normalized details.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs"
          >
            <option value={25}>25 / page</option>
            <option value={50}>50 / page</option>
            <option value={100}>100 / page</option>
            <option value={250}>250 / page</option>
          </select>

          <select
            value={sortDir}
            onChange={(e) => setSortDir(e.target.value as "DESC" | "ASC")}
            className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs"
          >
            <option value="DESC">Newest First</option>
            <option value="ASC">Oldest First</option>
          </select>

          <div className="relative">
            <button
              type="button"
              onClick={() => setShowColMenu((s) => !s)}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs"
            >
              <Columns3 className="h-3.5 w-3.5" /> Columns
            </button>
            {showColMenu ? (
              <div className="absolute right-0 top-9 z-30 w-52 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2 shadow-lg">
                {ALL_COLUMNS.map((c) => (
                  <label
                    key={c.key}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-[var(--bg-muted)]"
                  >
                    <input
                      type="checkbox"
                      checked={visibleCols.has(c.key)}
                      onChange={() => {
                        setVisibleCols((prev) => {
                          const next = new Set(prev);
                          if (next.has(c.key)) next.delete(c.key);
                          else next.add(c.key);
                          return next;
                        });
                      }}
                    />
                    <span>{c.label}</span>
                  </label>
                ))}
              </div>
            ) : null}
          </div>

          <button
            type="button"
            onClick={exportVisiblePageCsv}
            disabled={rows.length === 0}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs hover:bg-[var(--bg-muted)] disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" /> Export Page CSV
          </button>
        </div>
      </div>

      <GlobalFilterBar />

      <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-muted)] text-[var(--text-secondary)]">
              {ALL_COLUMNS.filter((c) => visibleCols.has(c.key)).map((c) => (
                <th key={c.key} className="whitespace-nowrap px-3 py-2.5 font-medium">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={visibleCols.size} className="px-4 py-8 text-center text-[var(--text-secondary)]">
                  Querying ClickHouse records...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={visibleCols.size} className="px-4 py-8 text-center text-[var(--text-secondary)]">
                  No message records match the current filters.
                </td>
              </tr>
            ) : (
              rows.map((r, idx) => (
                <tr
                  key={`${r.dataset_id}-${r.message_row_id}-${idx}`}
                  onClick={() => setSelectedRow(r)}
                  className="cursor-pointer border-b border-[var(--border-subtle)] hover:bg-[var(--bg-muted)]/60"
                >
                  {ALL_COLUMNS.filter((c) => visibleCols.has(c.key)).map((c) => (
                    <td
                      key={c.key}
                      className="max-w-[200px] truncate whitespace-nowrap px-3 py-2 tabular-nums"
                    >
                      {r[c.key] !== null && r[c.key] !== "" ? String(r[c.key]) : "—"}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className="text-[var(--text-secondary)]">
          Page {pageIndex + 1} • Showing {rows.length} records
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={pageIndex === 0 || loading}
            onClick={handlePrev}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" /> Previous
          </button>
          <button
            type="button"
            disabled={!nextCursor || loading}
            onClick={handleNext}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 disabled:opacity-40"
          >
            Next <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Row Details Drawer */}
      {selectedRow ? (
        <div className="fixed inset-y-0 right-0 z-50 w-full max-w-lg overflow-y-auto border-l border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 shadow-2xl">
          <div className="mb-4 flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
            <div>
              <h2 className="text-sm font-semibold">Transaction Record Inspector</h2>
              <p className="font-mono text-[11px] text-[var(--text-secondary)]">
                Row #{selectedRow.message_row_id} • {selectedRow.normalized_status}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedRow(null)}
              className="rounded p-1 hover:bg-[var(--bg-muted)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-2 text-xs">
            {Object.entries(selectedRow).map(([k, v]) => (
              <div
                key={k}
                className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] py-1.5"
              >
                <span className="font-mono text-[11px] text-[var(--text-secondary)]">
                  {k}
                </span>
                <div className="flex items-center gap-1.5 text-right">
                  <span className="break-all font-medium">
                    {v !== null && v !== "" ? String(v) : "—"}
                  </span>
                  {v ? (
                    <button
                      type="button"
                      onClick={() => void navigator.clipboard?.writeText(String(v))}
                      title="Copy value"
                      className="shrink-0 opacity-60 hover:opacity-100"
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
