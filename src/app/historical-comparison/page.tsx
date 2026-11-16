"use client";

import React, { useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import { DEFAULT_GLOBAL_FILTER } from "@/modules/analytics/filter-schema";
import type { PeriodComparisonResult } from "@/modules/intelligence/service";
import { useGlobalFilters } from "@/components/filters/FilterContext";

function fmtDeltaPp(val: number | null): string {
  if (val === null) return "N/A";
  return `${val > 0 ? "+" : ""}${val.toFixed(2)} pp`;
}

export default function HistoricalComparisonPage() {
  const { datasets } = useGlobalFilters();
  const [baselineDatasetId, setBaselineDatasetId] = useState("");
  const [currentDatasetId, setCurrentDatasetId] = useState("");
  const [baselineFrom, setBaselineFrom] = useState("");
  const [baselineTo, setBaselineTo] = useState("");
  const [currentFrom, setCurrentFrom] = useState("");
  const [currentTo, setCurrentTo] = useState("");
  const [result, setResult] = useState<PeriodComparisonResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runComparison = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/intelligence/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baselineFilter: {
            ...DEFAULT_GLOBAL_FILTER,
            datasetIds: baselineDatasetId ? [baselineDatasetId] : [],
            dateFrom: baselineFrom ? new Date(baselineFrom).toISOString() : undefined,
            dateTo: baselineTo ? new Date(baselineTo).toISOString() : undefined,
          },
          currentFilter: {
            ...DEFAULT_GLOBAL_FILTER,
            datasetIds: currentDatasetId ? [currentDatasetId] : [],
            dateFrom: currentFrom ? new Date(currentFrom).toISOString() : undefined,
            dateTo: currentTo ? new Date(currentTo).toISOString() : undefined,
          },
        }),
      });
      const d = (await res.json()) as {
        comparison?: PeriodComparisonResult;
        error?: string;
      };
      if (!res.ok) throw new Error(d.error ?? "Comparison failed");
      setResult(d.comparison ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Comparison error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="border-b border-[var(--border-subtle)] pb-4">
        <h1 className="text-xl font-semibold tracking-tight">
          Historical &amp; Dataset Comparison
        </h1>
        <p className="text-sm text-[var(--text-secondary)]">
          Compare QoS rates, traffic volume, and OP/TP shifts between two datasets or two time ranges.
        </p>
      </div>

      <div className="grid gap-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 md:grid-cols-2">
        <div className="space-y-2">
          <div className="text-xs font-semibold">Baseline Period / Dataset</div>
          <select
            value={baselineDatasetId}
            onChange={(e) => setBaselineDatasetId(e.target.value)}
            className="w-full rounded border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-xs"
          >
            <option value="">All Datasets</option>
            {datasets.map((ds) => (
              <option key={ds.id} value={ds.id}>
                {ds.name}
              </option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="datetime-local"
              value={baselineFrom}
              onChange={(e) => setBaselineFrom(e.target.value)}
              className="rounded border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 py-1 text-xs"
            />
            <input
              type="datetime-local"
              value={baselineTo}
              onChange={(e) => setBaselineTo(e.target.value)}
              className="rounded border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 py-1 text-xs"
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-semibold">Current Period / Dataset</div>
          <select
            value={currentDatasetId}
            onChange={(e) => setCurrentDatasetId(e.target.value)}
            className="w-full rounded border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-xs"
          >
            <option value="">All Datasets</option>
            {datasets.map((ds) => (
              <option key={ds.id} value={ds.id}>
                {ds.name}
              </option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="datetime-local"
              value={currentFrom}
              onChange={(e) => setCurrentFrom(e.target.value)}
              className="rounded border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 py-1 text-xs"
            />
            <input
              type="datetime-local"
              value={currentTo}
              onChange={(e) => setCurrentTo(e.target.value)}
              className="rounded border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 py-1 text-xs"
            />
          </div>
        </div>

        <div className="md:col-span-2">
          <button
            type="button"
            disabled={loading}
            onClick={runComparison}
            className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-xs font-medium text-white dark:bg-slate-100 dark:text-slate-950"
          >
            <ArrowLeftRight className="h-3.5 w-3.5" />
            {loading ? "Comparing..." : "Run Comparison"}
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
          {error}
        </div>
      ) : null}

      {result ? (
        <>
          <div className="grid gap-3 sm:grid-cols-5">
            {[
              [
                "Traffic Change",
                result.deltas.trafficChangePct !== null
                  ? `${result.deltas.trafficChangePct > 0 ? "+" : ""}${result.deltas.trafficChangePct}%`
                  : "N/A",
              ],
              ["Success Rate Delta", fmtDeltaPp(result.deltas.successRateDeltaPp)],
              ["Failure Rate Delta", fmtDeltaPp(result.deltas.failureRateDeltaPp)],
              ["Rejection Rate Delta", fmtDeltaPp(result.deltas.rejectionRateDeltaPp)],
              ["Combined Unsuccessful Delta", fmtDeltaPp(result.deltas.combinedUnsuccessfulDeltaPp)],
            ].map(([label, val]) => (
              <div
                key={String(label)}
                className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3.5 text-xs"
              >
                <div className="text-[var(--text-secondary)]">{label}</div>
                <div className="mt-1 text-base font-semibold tabular-nums">{val}</div>
              </div>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {[
              { title: "OP Movers", rows: result.opMovers },
              { title: "TP Movers", rows: result.tpMovers },
            ].map((panel) => (
              <div
                key={panel.title}
                className="overflow-x-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4"
              >
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                  {panel.title}
                </h2>
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)] text-[var(--text-secondary)]">
                      <th className="py-1.5">Partner</th>
                      <th className="py-1.5">Baseline</th>
                      <th className="py-1.5">Current</th>
                      <th className="py-1.5">Delta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {panel.rows.map((m) => (
                      <tr key={m.dimensionValue} className="border-b border-[var(--border-subtle)]">
                        <td className="max-w-[180px] truncate py-1.5 font-medium">
                          {m.dimensionValue}
                        </td>
                        <td className="py-1.5 tabular-nums">
                          {m.baselineRatePct !== null ? `${m.baselineRatePct.toFixed(2)}%` : "N/A"}
                        </td>
                        <td className="py-1.5 tabular-nums">
                          {m.currentRatePct !== null ? `${m.currentRatePct.toFixed(2)}%` : "N/A"}
                        </td>
                        <td className="py-1.5 tabular-nums font-semibold">
                          {fmtDeltaPp(m.deltaPctPoints)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
