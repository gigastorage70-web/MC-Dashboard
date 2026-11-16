"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import type { EChartsOption } from "echarts";
import { UploadCloud } from "lucide-react";
import type {
  DimensionBreakdownRow,
  GlobalKpiSummary,
  TimeSeriesPoint,
} from "@/modules/analytics/service";
import { EChartPanel } from "@/components/charts/EChartPanel";
import { useGlobalFilters } from "@/components/filters/FilterContext";
import { GlobalFilterBar } from "@/components/filters/GlobalFilterBar";

function fmtNum(v: number): string {
  return v.toLocaleString();
}

function fmtPct(v: number | null): string {
  return v === null ? "N/A" : `${v.toFixed(2)}%`;
}

export default function OverviewDashboardPage() {
  const { filter, datasets } = useGlobalFilters();
  const [kpis, setKpis] = useState<GlobalKpiSummary | null>(null);
  const [series, setSeries] = useState<TimeSeriesPoint[]>([]);
  const [worstOps, setWorstOps] = useState<DimensionBreakdownRow[]>([]);
  const [worstTps, setWorstTps] = useState<DimensionBreakdownRow[]>([]);
  const [topStatuses, setTopStatuses] = useState<DimensionBreakdownRow[]>([]);
  const [granularity, setGranularity] = useState<"hour" | "day">("hour");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    Promise.all([
      fetch("/api/analytics/kpis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(filter),
      }).then((r) => r.json()),
      fetch("/api/analytics/timeseries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...filter, granularity }),
      }).then((r) => r.json()),
      fetch("/api/analytics/breakdown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...filter, dimension: "op", limit: 6, sortBy: "unsuccessful" }),
      }).then((r) => r.json()),
      fetch("/api/analytics/breakdown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...filter, dimension: "tp", limit: 6, sortBy: "unsuccessful" }),
      }).then((r) => r.json()),
      fetch("/api/analytics/breakdown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...filter, dimension: "raw_status", limit: 8, sortBy: "volume" }),
      }).then((r) => r.json()),
    ])
      .then(([kpiRes, tsRes, opRes, tpRes, statusRes]) => {
        if (!active) return;
        if (kpiRes.error) throw new Error(kpiRes.error);
        setKpis(kpiRes.kpis ?? null);
        setSeries(tsRes.series ?? []);
        setWorstOps(opRes.rows ?? []);
        setWorstTps(tpRes.rows ?? []);
        setTopStatuses(statusRes.rows ?? []);
      })
      .catch((err) => {
        if (active)
          setError(err instanceof Error ? err.message : "Failed to load analytics");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [filter, granularity]);

  const tsOption: EChartsOption = {
    tooltip: { trigger: "axis" },
    legend: { top: 0 },
    grid: { left: 12, right: 44, bottom: 24, top: 32, containLabel: true },
    xAxis: { type: "category", data: series.map((s) => s.bucket) },
    yAxis: [
      { type: "value", name: "Messages" },
      { type: "value", name: "Rate %", max: 100, min: 0 },
    ],
    series: [
      {
        name: "Delivered",
        type: "bar",
        stack: "vol",
        itemStyle: { color: "#10b981" },
        data: series.map((s) => s.successMessages),
      },
      {
        name: "Rejected",
        type: "bar",
        stack: "vol",
        itemStyle: { color: "#f43f5e" },
        data: series.map((s) => s.rejectedMessages),
      },
      {
        name: "Failed",
        type: "bar",
        stack: "vol",
        itemStyle: { color: "#f97316" },
        data: series.map((s) => s.failedMessages),
      },
      {
        name: "Success Rate %",
        type: "line",
        yAxisIndex: 1,
        smooth: true,
        itemStyle: { color: "#0284c7" },
        data: series.map((s) => s.successRatePct ?? 0),
      },
    ],
  };

  const kpiCards = kpis
    ? [
        { label: "Total Messages", value: fmtNum(kpis.totalMessages) },
        { label: "Successful (Delivered)", value: fmtNum(kpis.successMessages), tone: "emerald" },
        { label: "Failed (DLR)", value: fmtNum(kpis.failedMessages), tone: "amber" },
        { label: "Rejected (Submit/DLR)", value: fmtNum(kpis.rejectedMessages), tone: "rose" },
        { label: "Pending (Enroute)", value: fmtNum(kpis.pendingMessages) },
        { label: "Success Rate", value: fmtPct(kpis.successRatePct), tone: "emerald" },
        { label: "Failure Rate", value: fmtPct(kpis.failureRatePct), tone: "amber" },
        { label: "Rejection Rate", value: fmtPct(kpis.rejectionRatePct), tone: "rose" },
        { label: "Unique OPs", value: fmtNum(kpis.uniqueOps) },
        { label: "Unique TPs", value: fmtNum(kpis.uniqueTps) },
        { label: "Countries Covered", value: fmtNum(kpis.uniqueCountries) },
        { label: "Applicants Covered", value: kpis.uniqueApplicants > 0 ? fmtNum(kpis.uniqueApplicants) : "N/A" },
      ]
    : [];

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] pb-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Telecom QoS Overview
          </h1>
          <p className="text-sm text-[var(--text-secondary)]">
            Live columnar aggregations across MediaCore XDR datasets. Terminal denominator = Delivered + Failed + Rejected.
          </p>
        </div>

        <Link
          href="/upload"
          className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-950"
        >
          <UploadCloud className="h-3.5 w-3.5" /> Upload CSV
        </Link>
      </div>

      <GlobalFilterBar />

      {error ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-xs text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          {error} — Start the unified platform via{" "}
          <code className="rounded bg-black/10 px-1 py-0.5">npm run dev</code> so the DuckDB analytics worker is active on port 4001.
        </div>
      ) : null}

      {!loading && kpis && kpis.totalMessages === 0 && datasets.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border-subtle)] bg-[var(--bg-surface)] p-10 text-center">
          <p className="text-sm font-medium">No ingested MediaCore datasets yet</p>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            Upload a daily MediaCore CSV export (e.g. xdr_all_tps.csv) to populate real-time QoS dashboards.
          </p>
          <Link
            href="/upload"
            className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-xs font-medium text-white dark:bg-slate-100 dark:text-slate-950"
          >
            <UploadCloud className="h-3.5 w-3.5" /> Upload First MediaCore CSV
          </Link>
        </div>
      ) : (
        <>
          {/* 12 Global KPI Cards */}
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
            {loading && !kpis
              ? Array.from({ length: 12 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-20 animate-pulse rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
                  />
                ))
              : kpiCards.map((card) => (
                  <div
                    key={card.label}
                    className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3.5"
                  >
                    <div className="text-[11px] text-[var(--text-secondary)]">
                      {card.label}
                    </div>
                    <div
                      className={`mt-1.5 text-lg font-semibold tabular-nums ${
                        card.tone === "emerald"
                          ? "text-emerald-600 dark:text-emerald-400"
                          : card.tone === "rose"
                          ? "text-rose-600 dark:text-rose-400"
                          : card.tone === "amber"
                          ? "text-amber-600 dark:text-amber-400"
                          : ""
                      }`}
                    >
                      {card.value}
                    </div>
                  </div>
                ))}
          </div>

          {/* Secondary Telemetry Strip */}
          {kpis && kpis.totalMessages > 0 ? (
            <div className="grid gap-3 text-xs sm:grid-cols-4">
              <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-2.5 tabular-nums">
                <span className="text-[var(--text-secondary)]">Unknown Statuses: </span>
                <span className="font-semibold">{fmtNum(kpis.unknownMessages)}</span>
              </div>
              <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-2.5 tabular-nums">
                <span className="text-[var(--text-secondary)]">Avg DLR Latency: </span>
                <span className="font-semibold">
                  {kpis.avgDlrLatencyMs !== null
                    ? `${(kpis.avgDlrLatencyMs / 1000).toFixed(2)}s`
                    : "N/A"}
                </span>
              </div>
              <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-2.5 tabular-nums">
                <span className="text-[var(--text-secondary)]">Total Cost IN: </span>
                <span className="font-semibold">{kpis.totalCostIn.toFixed(2)}</span>
              </div>
              <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-2.5 tabular-nums">
                <span className="text-[var(--text-secondary)]">Total Cost OUT: </span>
                <span className="font-semibold">{kpis.totalCostOut.toFixed(2)}</span>
              </div>
            </div>
          ) : null}

          {/* Time Series Trend */}
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                Delivery Traffic &amp; Success Rate Trend
              </h2>
              <div className="flex gap-1">
                {(["hour", "day"] as const).map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setGranularity(g)}
                    className={`rounded border px-2 py-1 text-[11px] ${
                      granularity === g
                        ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-950"
                        : "border-[var(--border-subtle)]"
                    }`}
                  >
                    {g === "hour" ? "Hourly" : "Daily"}
                  </button>
                ))}
              </div>
            </div>
            <EChartPanel option={tsOption} height={300} />
          </div>

          {/* Top Failure Contributors Grid */}
          <div className="grid gap-4 lg:grid-cols-3">
            {[
              { title: "Top Failing OPs", href: "/op-analytics", rows: worstOps },
              { title: "Top Failing TPs", href: "/tp-analytics", rows: worstTps },
              { title: "Raw Status & SMPP Breakdown", href: "/rejection-intelligence", rows: topStatuses },
            ].map((panel) => (
              <div
                key={panel.title}
                className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4"
              >
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                    {panel.title}
                  </h3>
                  <Link href={panel.href} className="text-[11px] hover:underline">
                    Explore
                  </Link>
                </div>
                <div className="space-y-2 text-xs">
                  {panel.rows.length === 0 ? (
                    <p className="text-[var(--text-secondary)]">No data</p>
                  ) : (
                    panel.rows.map((r) => (
                      <div
                        key={r.dimensionValue}
                        className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-1.5"
                      >
                        <span className="truncate font-medium" title={r.dimensionValue}>
                          {r.dimensionValue}
                        </span>
                        <span className="shrink-0 tabular-nums text-[var(--text-secondary)]">
                          {r.unsuccessfulCombinedMessages.toLocaleString()} unsuc. (
                          {fmtPct(r.combinedUnsuccessfulRatePct)})
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
