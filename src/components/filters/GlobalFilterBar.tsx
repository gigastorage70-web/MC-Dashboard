"use client";

import React, { useEffect, useState } from "react";
import { Bookmark, ChevronDown, RotateCcw, Search, Share2, X } from "lucide-react";
import type { GlobalFilterSpec } from "@/modules/analytics/filter-schema";
import { useGlobalFilters } from "./FilterContext";

type FacetKey =
  | "opNames"
  | "tpNames"
  | "countries"
  | "states"
  | "rawStatuses"
  | "reasons"
  | "applicants"
  | "routes"
  | "opAnis"
  | "tpAnis";

const FACET_LABELS: Array<{ key: FacetKey; label: string }> = [
  { key: "opNames", label: "OP Name" },
  { key: "tpNames", label: "TP Name" },
  { key: "countries", label: "Country" },
  { key: "rawStatuses", label: "Raw Status" },
  { key: "reasons", label: "Reason" },
  { key: "routes", label: "Route / Dialpeer" },
  { key: "applicants", label: "Applicant" },
  { key: "opAnis", label: "OP ANI" },
  { key: "tpAnis", label: "TP ANI" },
];

interface SavedFilterRow {
  id: string;
  name: string;
  filter_payload: GlobalFilterSpec;
}

function FacetMultiSelect({
  facetKey,
  label,
}: {
  facetKey: FacetKey;
  label: string;
}) {
  const { filter, toggleArrayValue } = useGlobalFilters();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<Array<{ value: string; count: number }>>([]);
  const [loading, setLoading] = useState(false);

  const selected = filter[facetKey];

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    fetch("/api/analytics/facets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...filter, facet: facetKey, search, limit: 80 }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { options?: Array<{ value: string; count: number }> } | null) => {
        if (active && d?.options) setOptions(d.options);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, search, facetKey, filter]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs ${
          selected.length > 0
            ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-950"
            : "border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-muted)]"
        }`}
      >
        <span>{label}</span>
        {selected.length > 0 ? (
          <span className="rounded bg-white/20 px-1 text-[10px]">
            {selected.length}
          </span>
        ) : null}
        <ChevronDown className="h-3 w-3 opacity-70" />
      </button>

      {open ? (
        <div className="absolute left-0 top-9 z-40 w-72 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2 shadow-lg">
          <div className="mb-2 flex items-center gap-1.5 rounded border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 py-1">
            <Search className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${label}...`}
              className="w-full bg-transparent text-xs outline-none"
            />
          </div>

          <div className="max-h-56 space-y-0.5 overflow-y-auto text-xs">
            {loading ? (
              <div className="p-2 text-[var(--text-secondary)]">Loading values...</div>
            ) : options.length === 0 ? (
              <div className="p-2 text-[var(--text-secondary)]">No matching values</div>
            ) : (
              options.map((opt) => {
                const checked = selected.includes(opt.value);
                return (
                  <label
                    key={opt.value}
                    className="flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-1 hover:bg-[var(--bg-muted)]"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleArrayValue(facetKey, opt.value)}
                        className="h-3.5 w-3.5 shrink-0"
                      />
                      <span className="truncate" title={opt.value}>
                        {opt.value}
                      </span>
                    </span>
                    <span className="shrink-0 tabular-nums text-[10px] text-[var(--text-secondary)]">
                      {opt.count.toLocaleString()}
                    </span>
                  </label>
                );
              })
            )}
          </div>
          <div className="mt-2 flex justify-end border-t border-[var(--border-subtle)] pt-1.5">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded px-2 py-1 text-[11px] font-medium hover:bg-[var(--bg-muted)]"
            >
              Done
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function GlobalFilterBar() {
  const { filter, setFilter, resetFilters, toggleArrayValue, datasets } =
    useGlobalFilters();
  const [presets, setPresets] = useState<SavedFilterRow[]>([]);
  const [presetName, setPresetName] = useState("");
  const [shareMsg, setShareMsg] = useState<string | null>(null);

  const loadPresets = () => {
    fetch("/api/saved-filters")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { filters?: SavedFilterRow[] } | null) => {
        if (d?.filters) setPresets(d.filters);
      })
      .catch(() => undefined);
  };

  useEffect(() => {
    loadPresets();
  }, []);

  const savePreset = async () => {
    if (!presetName.trim()) return;
    const res = await fetch("/api/saved-filters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: presetName.trim(),
        filterPayload: filter,
      }),
    });
    if (res.ok) {
      setPresetName("");
      loadPresets();
    }
  };

  const copyShareUrl = () => {
    const encoded = btoa(JSON.stringify(filter));
    const url = `${window.location.origin}${window.location.pathname}?f=${encodeURIComponent(encoded)}`;
    void navigator.clipboard?.writeText(url);
    setShareMsg("Shareable filter URL copied.");
    setTimeout(() => setShareMsg(null), 2500);
  };

  const activeChips: Array<{ key: FacetKey | "normalizedStatuses"; val: string }> = [];
  for (const f of FACET_LABELS) {
    for (const v of filter[f.key]) {
      activeChips.push({ key: f.key, val: v });
    }
  }
  for (const s of filter.normalizedStatuses) {
    activeChips.push({ key: "normalizedStatuses", val: s });
  }

  return (
    <div className="space-y-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        {/* Dataset Selector */}
        <select
          value={filter.datasetIds[0] ?? ""}
          onChange={(e) =>
            setFilter((prev) => ({
              ...prev,
              datasetIds: e.target.value ? [e.target.value] : [],
            }))
          }
          className="max-w-[240px] rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-xs font-medium"
        >
          <option value="">All Active Datasets ({datasets.length})</option>
          {datasets.map((ds) => (
            <option key={ds.id} value={ds.id}>
              {ds.name} ({Number(ds.valid_rows).toLocaleString()} rows)
            </option>
          ))}
        </select>

        {/* Date Range */}
        <input
          type="datetime-local"
          value={filter.dateFrom ? filter.dateFrom.slice(0, 16) : ""}
          onChange={(e) =>
            setFilter((prev) => ({
              ...prev,
              dateFrom: e.target.value ? new Date(e.target.value).toISOString() : undefined,
            }))
          }
          aria-label="Date from"
          className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 py-1 text-xs"
        />
        <span className="text-xs text-[var(--text-secondary)]">to</span>
        <input
          type="datetime-local"
          value={filter.dateTo ? filter.dateTo.slice(0, 16) : ""}
          onChange={(e) =>
            setFilter((prev) => ({
              ...prev,
              dateTo: e.target.value ? new Date(e.target.value).toISOString() : undefined,
            }))
          }
          aria-label="Date to"
          className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 py-1 text-xs"
        />

        {/* Normalized Status Quick Filter */}
        <select
          value={filter.normalizedStatuses[0] ?? ""}
          onChange={(e) =>
            setFilter((prev) => ({
              ...prev,
              normalizedStatuses: e.target.value
                ? [e.target.value as GlobalFilterSpec["normalizedStatuses"][number]]
                : [],
            }))
          }
          className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-xs"
        >
          <option value="">All Outcomes</option>
          <option value="SUCCESS">SUCCESS (Delivered)</option>
          <option value="REJECTED">REJECTED (SMPP / DLR)</option>
          <option value="FAILED">FAILED (Undelivered / Expired)</option>
          <option value="PENDING">PENDING (Enroute)</option>
          <option value="UNKNOWN">UNKNOWN</option>
        </select>

        {/* Search ANI / MSISDN / MsgID */}
        <div className="flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 py-1">
          <Search className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
          <input
            type="text"
            value={filter.searchQuery ?? ""}
            onChange={(e) =>
              setFilter((prev) => ({
                ...prev,
                searchQuery: e.target.value || undefined,
              }))
            }
            placeholder="Exact/partial ANI, MSISDN, MsgID..."
            className="w-48 bg-transparent text-xs outline-none"
          />
        </div>
      </div>

      {/* Dependent Multi-Select Facet Pills */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {FACET_LABELS.map((f) => (
            <FacetMultiSelect key={f.key} facetKey={f.key} label={f.label} />
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <select
            value=""
            onChange={(e) => {
              const found = presets.find((p) => p.id === e.target.value);
              if (found) setFilter(found.filter_payload);
            }}
            className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 py-1 text-[11px]"
          >
            <option value="">Saved Presets ({presets.length})</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <input
            type="text"
            placeholder="Save preset..."
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            className="w-28 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 py-1 text-[11px]"
          />
          <button
            type="button"
            onClick={savePreset}
            title="Save Filter Preset"
            className="rounded-md border border-[var(--border-subtle)] p-1.5 hover:bg-[var(--bg-muted)]"
          >
            <Bookmark className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={copyShareUrl}
            title="Copy Shareable Filter URL"
            className="rounded-md border border-[var(--border-subtle)] p-1.5 hover:bg-[var(--bg-muted)]"
          >
            <Share2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={resetFilters}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--border-subtle)] px-2 py-1 text-[11px] hover:bg-[var(--bg-muted)]"
          >
            <RotateCcw className="h-3 w-3" /> Clear All
          </button>
        </div>
      </div>

      {/* Active Filter Chips */}
      {activeChips.length > 0 || shareMsg ? (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--border-subtle)] pt-2 text-[11px]">
          {activeChips.map((chip) => (
            <span
              key={`${chip.key}-${chip.val}`}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-muted)] px-2.5 py-0.5"
            >
              <span className="opacity-70">{chip.key}:</span>
              <span className="font-medium">{chip.val}</span>
              <button
                type="button"
                onClick={() => toggleArrayValue(chip.key, chip.val)}
                className="ml-0.5 hover:text-rose-500"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {shareMsg ? (
            <span className="text-emerald-600 dark:text-emerald-400">
              {shareMsg}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
