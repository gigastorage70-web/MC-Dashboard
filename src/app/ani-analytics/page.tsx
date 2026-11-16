"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { EChartsOption } from "echarts";
import { ArrowUpRight, Lock, Search } from "lucide-react";
import type { AniBreakdownRow } from "@/modules/analytics/service";
import { EChartPanel } from "@/components/charts/EChartPanel";
import { useGlobalFilters } from "@/components/filters/FilterContext";
import { GlobalFilterBar } from "@/components/filters/GlobalFilterBar";

export default function AniAnalyticsPage() {
  const router = useRouter();
  const { filter, setFilter } = useGlobalFilters();
  const [aniType, setAniType] = useState<"op_ani" | "tp_ani">("op_ani");
  const [exactSearch, setExactSearch] = useState("");
  const [rows, setRows] = useState<AniBreakdownRow[]>([]);
  const [masked, setMasked] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const payload = {
      ...filter,
      ...(exactSearch.trim()
        ? aniType === "op_ani"
          ? { opAnis: [exactSearch.trim()] }
          : { tpAnis: [exactSearch.trim()] }
        : {}),
      aniType,
      limit: 50,
    };
    fetch("/api/analytics/ani", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { rows?: AniBreakdownRow[]; masked?: boolean } | null) => {
        if (!active || !d) return;
        setRows(d.rows ?? []);
        setMasked(Boolean(d.masked));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [filter, aniType, exactSearch]);

  const top10 = rows.slice(0, 10);
  const chartOption: EChartsOption = {
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    grid: { left: 12, right: 20, bottom: 24, top: 16, containLabel: true },
    xAxis: { type: "value" },
    yAxis: {
      type: "category",
      inverse: true,
      data: top10.map((r) => r.ani),
      axisLabel: { width: 130, overflow: "truncate" },
    },
    series: [
      {
        name: "Unsuccessful (Failed + Rejected)",
        type: "bar",
        itemStyle: { color: "#e11d48" },
        data: top10.map((r) => r.unsuccessfulCombinedMessages),
      },
      {
        name: "Delivered",
        type: "bar",
        itemStyle: { color: "#10b981" },
        data: top10.map((r) => r.successMessages),
      },
    ],
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] pb-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            OP ANI &amp; TP ANI Intelligence
          </h1>
          <p className="text-sm text-[var(--text-secondary)]">
            Independent Sender ID / ANI diagnostics exposing high-failure originators, associated providers, and rejection patterns.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {masked ? (
            <span className="inline-flex items-center gap-1 rounded border border-[var(--border-subtle)] bg-[var(--bg-muted)] px-2.5 py-1 text-[11px]">
              <Lock className="h-3 w-3" /> PII Masking Active
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => setAniType("op_ani")}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
              aniType === "op_ani"
                ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-950"
                : "border-[var(--border-subtle)] bg-[var(--bg-surface)]"
            }`}
          >
            OP ANI
          </button>
          <button
            type="button"
            onClick={() => setAniType("tp_ani")}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
              aniType === "tp_ani"
                ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-950"
                : "border-[var(--border-subtle)] bg-[var(--bg-surface)]"
            }`}
          >
            TP ANI
          </button>
        </div>
      </div>

      <GlobalFilterBar />

      <div className="flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2">
        <Search className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
        <input
          type="text"
          value={exactSearch}
          onChange={(e) => setExactSearch(e.target.value)}
          placeholder={`Filter by exact ${aniType === "op_ani" ? "OP ANI" : "TP ANI"} (e.g. Facebook, 0123456789)...`}
          className="w-full bg-transparent text-xs outline-none"
        />
      </div>

      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Top 10 Problematic {aniType === "op_ani" ? "OP ANIs" : "TP ANIs"}
        </h2>
        {loading ? (
          <div className="flex h-[280px] items-center justify-center text-xs text-[var(--text-secondary)]">
            Querying ClickHouse...
          </div>
        ) : (
          <EChartPanel option={chartOption} height={280} />
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-muted)] text-[var(--text-secondary)]">
              <th className="px-3 py-2.5 font-medium">ANI</th>
              <th className="px-3 py-2.5 font-medium">Primary OP</th>
              <th className="px-3 py-2.5 font-medium">Primary TP</th>
              <th className="px-3 py-2.5 font-medium">Country</th>
              <th className="px-3 py-2.5 font-medium">Total</th>
              <th className="px-3 py-2.5 font-medium">Rejected</th>
              <th className="px-3 py-2.5 font-medium">Failed</th>
              <th className="px-3 py-2.5 font-medium">Success %</th>
              <th className="px-3 py-2.5 font-medium">Top Reason</th>
              <th className="px-3 py-2.5 text-right font-medium">Inspect</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.ani} className="border-b border-[var(--border-subtle)]">
                <td className="px-3 py-2 font-mono font-medium">{r.ani}</td>
                <td className="max-w-[160px] truncate px-3 py-2">{r.associatedOp}</td>
                <td className="max-w-[160px] truncate px-3 py-2">{r.associatedTp}</td>
                <td className="px-3 py-2">{r.country}</td>
                <td className="px-3 py-2 tabular-nums">{r.totalMessages.toLocaleString()}</td>
                <td className="px-3 py-2 tabular-nums text-rose-600 dark:text-rose-400">
                  {r.rejectedMessages.toLocaleString()}
                </td>
                <td className="px-3 py-2 tabular-nums text-amber-600 dark:text-amber-400">
                  {r.failedMessages.toLocaleString()}
                </td>
                <td className="px-3 py-2 tabular-nums font-semibold">
                  {r.successRatePct !== null ? `${r.successRatePct.toFixed(2)}%` : "N/A"}
                </td>
                <td className="px-3 py-2 font-mono text-[11px]">{r.topReason ?? "—"}</td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    disabled={masked}
                    onClick={() => {
                      setFilter((prev) => ({
                        ...prev,
                        [aniType === "op_ani" ? "opAnis" : "tpAnis"]: [r.ani],
                      }));
                      router.push("/message-explorer");
                    }}
                    className="inline-flex items-center gap-0.5 rounded border border-[var(--border-subtle)] px-2 py-1 text-[11px] hover:bg-[var(--bg-muted)] disabled:opacity-40"
                  >
                    XDRs <ArrowUpRight className="h-3 w-3" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
