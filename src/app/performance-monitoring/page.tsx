"use client";

import React, { useEffect, useState } from "react";
import { Activity, Check, MessageSquarePlus, ShieldAlert } from "lucide-react";
import { useGlobalFilters } from "@/components/filters/FilterContext";
import { GlobalFilterBar } from "@/components/filters/GlobalFilterBar";

interface AlertRow {
  id: string;
  dataset_name: string | null;
  severity: "INFO" | "WARNING" | "CRITICAL";
  dimension_type: string;
  dimension_value: string;
  what_changed: string;
  baseline_value: string;
  current_value: string;
  affected_records: number;
  suggested_investigation: string;
  status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED";
  created_at: string;
}

interface NoteRow {
  id: string;
  title: string;
  body: string;
  dimension_tag: string | null;
  author_name: string | null;
  created_at: string;
}

export default function PerformanceMonitoringPage() {
  const { filter } = useGlobalFilters();
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [minSample, setMinSample] = useState(500);
  const [spikePct, setSpikePct] = useState(8);
  const [evaluating, setEvaluating] = useState(false);

  const [noteTitle, setNoteTitle] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [noteTag, setNoteTag] = useState("");

  const loadData = async () => {
    const [aRes, nRes] = await Promise.all([
      fetch("/api/intelligence/alerts", { cache: "no-store" }),
      fetch("/api/notes", { cache: "no-store" }),
    ]);
    if (aRes.ok) {
      const a = (await aRes.json()) as { alerts: AlertRow[] };
      setAlerts(a.alerts ?? []);
    }
    if (nRes.ok) {
      const n = (await nRes.json()) as { notes: NoteRow[] };
      setNotes(n.notes ?? []);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const runEvaluation = async () => {
    setEvaluating(true);
    try {
      await fetch("/api/intelligence/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filter,
          minSampleSize: Number(minSample),
          deltaSpikePct: Number(spikePct),
        }),
      });
      await loadData();
    } finally {
      setEvaluating(false);
    }
  };

  const updateAlertStatus = async (
    alertId: string,
    status: "ACKNOWLEDGED" | "RESOLVED"
  ) => {
    await fetch("/api/intelligence/alerts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alertId, status }),
    });
    await loadData();
  };

  const createNote = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        datasetId: filter.datasetIds[0] ?? null,
        title: noteTitle,
        body: noteBody,
        dimensionTag: noteTag || undefined,
        filterContext: filter,
      }),
    });
    if (res.ok) {
      setNoteTitle("");
      setNoteBody("");
      setNoteTag("");
      await loadData();
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] pb-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            QoS Degradation &amp; Anomaly Monitoring
          </h1>
          <p className="text-sm text-[var(--text-secondary)]">
            Baseline-guarded anomaly detection with minimum sample thresholds. Flags statistically meaningful shifts without claiming unverified root causes.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-1.5">
            <span className="text-[var(--text-secondary)]">Min Sample:</span>
            <input
              type="number"
              min={20}
              value={minSample}
              onChange={(e) => setMinSample(Number(e.target.value))}
              className="w-20 rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1"
            />
          </label>
          <label className="flex items-center gap-1.5">
            <span className="text-[var(--text-secondary)]">Spike +pp:</span>
            <input
              type="number"
              min={1}
              value={spikePct}
              onChange={(e) => setSpikePct(Number(e.target.value))}
              className="w-16 rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1"
            />
          </label>
          <button
            type="button"
            disabled={evaluating}
            onClick={runEvaluation}
            className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 font-medium text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-950"
          >
            <Activity className="h-3.5 w-3.5" />
            {evaluating ? "Scanning ClickHouse..." : "Run Degradation Scan"}
          </button>
        </div>
      </div>

      <GlobalFilterBar />

      {/* Alerts List */}
      <div className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Detected Degradation Events ({alerts.length})
        </h2>
        {alerts.length === 0 ? (
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 text-xs text-[var(--text-secondary)]">
            No degradation alerts recorded yet. Run a degradation scan after ingesting dataset traffic.
          </div>
        ) : (
          alerts.map((a) => (
            <div
              key={a.id}
              className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 text-xs"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ShieldAlert
                    className={`h-4 w-4 ${
                      a.severity === "CRITICAL"
                        ? "text-rose-600 dark:text-rose-400"
                        : "text-amber-600 dark:text-amber-400"
                    }`}
                  />
                  <span className="font-semibold">{a.what_changed}</span>
                  <span className="rounded border border-[var(--border-subtle)] bg-[var(--bg-muted)] px-1.5 py-0.5 text-[10px]">
                    {a.status}
                  </span>
                </div>

                {a.status !== "RESOLVED" ? (
                  <div className="flex gap-1.5">
                    {a.status === "OPEN" ? (
                      <button
                        type="button"
                        onClick={() => void updateAlertStatus(a.id, "ACKNOWLEDGED")}
                        className="rounded border border-[var(--border-subtle)] px-2 py-1 text-[11px] hover:bg-[var(--bg-muted)]"
                      >
                        Acknowledge
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void updateAlertStatus(a.id, "RESOLVED")}
                      className="inline-flex items-center gap-1 rounded border border-[var(--border-subtle)] px-2 py-1 text-[11px] hover:bg-[var(--bg-muted)]"
                    >
                      <Check className="h-3 w-3" /> Resolve
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="mt-2 grid gap-2 text-[11px] text-[var(--text-secondary)] sm:grid-cols-4">
                <div>Dimension: {a.dimension_type} = {a.dimension_value}</div>
                <div>Baseline: {Number(a.baseline_value).toFixed(2)}%</div>
                <div>Current: {Number(a.current_value).toFixed(2)}%</div>
                <div>Affected Records: {Number(a.affected_records).toLocaleString()}</div>
              </div>
              <p className="mt-2 text-[11px] text-[var(--text-secondary)]">
                <strong>Investigation Direction:</strong> {a.suggested_investigation}
              </p>
            </div>
          ))
        )}
      </div>

      {/* Investigation Notes */}
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <MessageSquarePlus className="h-4 w-4" />
          <span>Operational Investigation Notes</span>
        </div>

        <form onSubmit={createNote} className="mb-4 grid gap-2 sm:grid-cols-4">
          <input
            type="text"
            required
            placeholder="Incident / Note Title"
            value={noteTitle}
            onChange={(e) => setNoteTitle(e.target.value)}
            className="rounded border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-xs"
          />
          <input
            type="text"
            placeholder="Tag (e.g. TP:Boldtel / SMPP:11)"
            value={noteTag}
            onChange={(e) => setNoteTag(e.target.value)}
            className="rounded border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-xs"
          />
          <input
            type="text"
            required
            placeholder="Findings & action taken..."
            value={noteBody}
            onChange={(e) => setNoteBody(e.target.value)}
            className="rounded border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-xs sm:col-span-1"
          />
          <button
            type="submit"
            className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white dark:bg-slate-100 dark:text-slate-950"
          >
            Save Note
          </button>
        </form>

        <div className="space-y-2 text-xs">
          {notes.map((n) => (
            <div key={n.id} className="rounded border border-[var(--border-subtle)] p-3">
              <div className="flex justify-between">
                <span className="font-semibold">{n.title}</span>
                <span className="text-[11px] text-[var(--text-secondary)]">
                  {n.author_name ?? "Operator"} • {new Date(n.created_at).toLocaleString()}
                </span>
              </div>
              {n.dimension_tag ? (
                <span className="mt-1 inline-block rounded bg-[var(--bg-muted)] px-1.5 py-0.5 text-[10px]">
                  {n.dimension_tag}
                </span>
              ) : null}
              <p className="mt-1.5 text-[var(--text-secondary)]">{n.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
