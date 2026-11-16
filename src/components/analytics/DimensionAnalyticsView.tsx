"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Filter } from "lucide-react";
import type { EChartsOption } from "echarts";
import type { AnalyticsDimension, DimensionBreakdownRow } from "@/modules/analytics/service";
import type { GlobalFilterSpec } from "@/modules/analytics/filter-schema";
import { EChartPanel } from "@/components/charts/EChartPanel";
import { useGlobalFilters } from "@/components/filters/FilterContext";
import { GlobalFilterBar } from "@/components/filters/GlobalFilterBar";

interface DimensionAnalyticsViewProps {
  title: string;
  subtitle: string;
  dimension: AnalyticsDimension;
  filterKey?: Exclude<keyof GlobalFilterSpec, "dateFrom" | "dateTo" | "searchQuery">;
  secondaryTabs?: Array<{ label: string; dimension: AnalyticsDimension; filterKey?: Exclude<keyof GlobalFilterSpec, "dateFrom" | "dateTo" | "searchQuery"> }>;
}

function fmtPct(v: number | null): string {
  return v === null ? "N/A" : `${v.toFixed(2)}%`;
}

export function DimensionAnalyticsView({
  title,
  subtitle,
  dimension,
  filterKey,
  secondaryTabs,
}: DimensionAnalyticsViewProps) {
  const router = useRouter();
  const { filter, toggleArrayValue, setFilter } = useGlobalFilters();
  const [activeDim, setActiveDim] = useState<AnalyticsDimension>(dimension);
  const [activeFilterKey, setActiveFilterKey] = useState(filterKey);
  const [sortBy, setSortBy] = useState<"volume" | "unsuccessful" | "failure_rate">("volume");
  const [rows, setRows] = useState<DimensionBreakdownRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetch("/api/analytics/breakdown", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...filter,
        dimension: activeDim,
        limit: 50,
        sortBy,
      }),
    })
      .then(async (r) => {
        const d = (await r.json()) as {
          rows?: DimensionBreakdownRow[];
          error?: string;
        };
        if (!r.ok) throw new Error(d.error ?? "Query failed");
        return d;
      })
      .then((d) => {
        if (active) setRows(d.rows ?? []);
      })
      .catch((err) => {
        if (active)
          setError(err instanceof Error ? err.message : "Failed to load breakdown");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [filter, activeDim, sortBy]);

  const top12 = rows.slice(0, 12);
  const volumeChartOption: EChartsOption = {
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    legend: { top: 0 },
    grid: { left: 12, right: 16, bottom: 32, top: 32, containLabel: true },
    xAxis: {
      type: "category",
      data: top12.map((r) => r.dimensionValue),
      axisLabel: { rotate: 22, width: 110, overflow: "truncate" },
    },
    yAxis: { type: "value" },
    series: [
      {
        name: "Delivered",
        type: "bar",
        stack: "total",
        itemStyle: { color: "#10b981" },
        data: top12.map((r) => r.successMessages),
      },
      {
        name: "Rejected",
        type: "bar",
        stack: "total",
        itemStyle: { color: "#f43f5e" },
        data: top12.map((r) => r.rejectedMessages),
      },
      {
        name: "Failed",
        type: "bar",
        stack: "total",
        itemStyle: { color: "#f97316" },
        data: top12.map((r) => r.failedMessages),
      },
      {
        name: "Pending/Other",
        type: "bar",
        stack: "total",
        itemStyle: { color: "#94a3b8" },
        data: top12.map((r) => r.pendingMessages + r.unknownMessages),
      },
    ],
  };

  const worst10 = [...rows]
    .filter((r) => r.terminalMessages >= 20 && r.combinedUnsuccessfulRatePct !== null)
    .sort(
      (a, b) =>
        (b.combinedUnsuccessfulRatePct ?? 0) -
        (a.combinedUnsuccessfulRatePct ?? 0)
    )
    .slice(0, 10);

  const rateChartOption: EChartsOption = {
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    grid: { left: 12, right: 24, bottom: 20, top: 16, containLabel: true },
    xAxis: { type: "value", max: 100, axisLabel: { formatter: "{value}%" } },
    yAxis: {
      type: "category",
      inverse: true,
      data: worst10.map((r) => r.dimensionValue),
      axisLabel: { width: 140, overflow: "truncate" },
    },
    series: [
      {
        name: "Unsuccessful Rate %",
        type: "bar",
        itemStyle: { color: "#e11d48" },
        data: worst10.map((r) => r.combinedUnsuccessfulRatePct ?? 0),
      },
    ],
  };

  const drillToExplorer = (value: string) => {
    if (activeFilterKey) {
      setFilter((prev) => ({ ...prev, [activeFilterKey]: [value] }));
    }
    router.push("/message-explorer");
  };

  const onlyUnmapped =
    rows.length === 1 &&
    (rows[0].dimensionValue === "Unmapped" ||
      rows[0].dimensionValue === "Unassigned");

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] pb-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-[var(--text-secondary)]">{subtitle}</p>
        </div>

        <div className="flex items-center gap-2">
          {secondaryTabs?.map((tab) => (
            <button
              key={tab.dimension}
              type="button"
              onClick={() => {
                setActiveDim(tab.dimension);
                setActiveFilterKey(tab.filterKey);
              }}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
                activeDim === tab.dimension
                  ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-950"
                  : "border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-[var(--bg-muted)]"
              }`}
            >
              {tab.label}
            </button>
          ))}

          <select
            value={sortBy}
            onChange={(e) =>
              setSortBy(
                e.target.value as "volume" | "unsuccessful" | "failure_rate"
              )
            }
            className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs"
          >
            <option value="volume">Sort: Total Traffic</option>
            <option value="unsuccessful">Sort: Failed + Rejected Volume</option>
            <option value="failure_rate">Sort: Unsuccessful Rate %</option>
          </select>
        </div>
      </div>

      <GlobalFilterBar />

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 px-4 py-3 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
          {error}
        </div>
      ) : null}

      {onlyUnmapped ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-xs text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          This dimension (<strong>{activeDim}</strong>) is unmapped or empty across the selected dataset records. Upload a CSV containing this column or adjust schema mapping to enable granular breakdowns.
        </div>
      ) : null}

      {/* Charts Grid */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Traffic &amp; Outcome Distribution (Click bar to cross-filter)
          </h2>
          {loading ? (
            <div className="flex h-[300px] items-center justify-center text-xs text-[var(--text-secondary)]">
              Querying ClickHouse...
            </div>
          ) : rows.length === 0 ? (
            <div className="flex h-[300px] items-center justify-center text-xs text-[var(--text-secondary)]">
              No records match the active filter set.
            </div>
          ) : (
            <EChartPanel
              option={volumeChartOption}
              onPointClick={(name) => {
                if (activeFilterKey) toggleArrayValue(activeFilterKey, name);
              }}
            />
          )}
        </div>

        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Top 10 Highest Unsuccessful Rate (Min 20 terminal msgs)
          </h2>
          {loading ? (
            <div className="flex h-[300px] items-center justify-center text-xs text-[var(--text-secondary)]">
              Querying ClickHouse...
            </div>
          ) : worst10.length === 0 ? (
            <div className="flex h-[300px] items-center justify-center text-xs text-[var(--text-secondary)]">
              Insufficient terminal volume (&lt;20 messages) to rank rates.
            </div>
          ) : (
            <EChartPanel
              option={rateChartOption}
              onPointClick={(name) => {
                if (activeFilterKey) toggleArrayValue(activeFilterKey, name);
              }}
            />
          )}
        </div>
      </div>

      {/* Ranked Performance Table */}
      <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-muted)] text-[var(--text-secondary)]">
              <th className="px-3 py-2.5 font-medium">Dimension</th>
              <th className="px-3 py-2.5 font-medium">Total</th>
              <th className="px-3 py-2.5 font-medium">Delivered</th>
              <th className="px-3 py-2.5 font-medium">Rejected</th>
              <th className="px-3 py-2.5 font-medium">Failed</th>
              <th className="px-3 py-2.5 font-medium">Success %</th>
              <th className="px-3 py-2.5 font-medium">Rejection %</th>
              <th className="px-3 py-2.5 font-medium">Failure %</th>
              <th className="px-3 py-2.5 font-medium">Failure Contrib %</th>
              <th className="px-3 py-2.5 font-medium">Top Reason</th>
              <th className="px-3 py-2.5 text-right font-medium">Drill-Down</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.dimensionValue}
                className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-muted)]/40"
              >
                <td className="max-w-[240px] truncate px-3 py-2 font-medium" title={r.dimensionValue}>
                  {r.dimensionValue}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {r.totalMessages.toLocaleString()}
                </td>
                <td className="px-3 py-2 tabular-nums text-emerald-600 dark:text-emerald-400">
                  {r.successMessages.toLocaleString()}
                </td>
                <td className="px-3 py-2 tabular-nums text-rose-600 dark:text-rose-400">
                  {r.rejectedMessages.toLocaleString()}
                </td>
                <td className="px-3 py-2 tabular-nums text-amber-600 dark:text-amber-400">
                  {r.failedMessages.toLocaleString()}
                </td>
                <td className="px-3 py-2 tabular-nums font-semibold">
                  {fmtPct(r.successRatePct)}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {fmtPct(r.rejectionRatePct)}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {fmtPct(r.failureRatePct)}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {fmtPct(r.failureContributionPct)}
                </td>
                <td className="max-w-[160px] truncate px-3 py-2 font-mono text-[11px] text-[var(--text-secondary)]">
                  {r.topReason ?? "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="inline-flex items-center gap-1">
                    {activeFilterKey ? (
                      <button
                        type="button"
                        onClick={() => toggleArrayValue(activeFilterKey, r.dimensionValue)}
                        title="Apply as Global Filter"
                        className="rounded border border-[var(--border-subtle)] p-1 hover:bg-[var(--bg-muted)]"
                      >
                        <Filter className="h-3 w-3" />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => drillToExplorer(r.dimensionValue)}
                      title="Inspect matching records in Message Explorer"
                      className="inline-flex items-center gap-0.5 rounded border border-[var(--border-subtle)] px-2 py-1 text-[11px] hover:bg-[var(--bg-muted)]"
                    >
                      XDRs <ArrowUpRight className="h-3 w-3" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
