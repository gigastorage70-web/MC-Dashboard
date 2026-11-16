"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  Save,
  UploadCloud,
} from "lucide-react";
import {
  inspectCsvSample,
  LOGICAL_FIELD_CATALOG,
  type ColumnMappingDict,
  type LogicalField,
  type SchemaInspectionResult,
} from "@/modules/schema-mapping/constants";

interface SchemaProfile {
  id: string;
  name: string;
  delimiter: string;
  is_default: boolean;
  mappings: Record<string, string>;
}

interface JobProgress {
  job: {
    id: string;
    dataset_id: string;
    stage: number;
    stage_label: string;
    progress_pct: number;
    queue_status: string;
    rows_processed: number;
    rows_inserted: number;
    rows_rejected: number;
    rows_skipped: number;
    duration_ms: number | null;
    error_message: string | null;
  };
}

const PROCESSING_STAGE_NAMES = [
  "1. Upload initiated",
  "2. Uploading",
  "3. Upload completed",
  "4. File validation",
  "5. CSV parsing",
  "6. Schema mapping",
  "7. Data normalization",
  "8. Validation",
  "9. Database ingestion",
  "10. Analytics preparation",
  "11. Processing completed",
];

async function readFirst64KbText(file: File): Promise<string> {
  const slice = file.slice(0, 65_536);
  if (file.name.toLowerCase().endsWith(".gz") && typeof DecompressionStream !== "undefined") {
    const stream = slice.stream().pipeThrough(new DecompressionStream("gzip"));
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let out = "";
    try {
      while (out.length < 65_536) {
        const { done, value } = await reader.read();
        if (done) break;
        out += decoder.decode(value, { stream: true });
      }
    } catch {
      // Partial gzip chunk ends cleanly with whatever lines already decoded
    }
    return out;
  }
  return slice.text();
}

export default function UploadCsvPage() {
  const [file, setFile] = useState<File | null>(null);
  const [datasetName, setDatasetName] = useState("");
  const [profiles, setProfiles] = useState<SchemaProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");
  const [delimiter, setDelimiter] = useState<";" | "," | "\t" | "|">(";");
  const [inspection, setInspection] = useState<SchemaInspectionResult | null>(null);
  const [mapping, setMapping] = useState<ColumnMappingDict>({});
  const [profileSaveName, setProfileSaveName] = useState("");
  const [saveProfileMsg, setSaveProfileMsg] = useState<string | null>(null);

  const [uploadPct, setUploadPct] = useState<number>(0);
  const [uploading, setUploading] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState<JobProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/schema-profiles")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { profiles?: SchemaProfile[] } | null) => {
        if (d?.profiles) {
          setProfiles(d.profiles);
          const def = d.profiles.find((p) => p.is_default) ?? d.profiles[0];
          if (def) setSelectedProfileId(def.id);
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!activeJobId) return;
    const poll = async () => {
      const res = await fetch(`/api/uploads/${activeJobId}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as JobProgress;
      setJobProgress(data);
      if (["COMPLETED", "PARTIAL", "FAILED"].includes(data.job.queue_status)) {
        clearInterval(timer);
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 2000);
    return () => clearInterval(timer);
  }, [activeJobId]);

  const inspectFile = async (targetFile: File, overrideDelim?: string) => {
    setError(null);
    const sampleText = await readFirst64KbText(targetFile);
    const result = inspectCsvSample(sampleText, overrideDelim);
    setInspection(result);
    setDelimiter(
      ([";", ",", "\t", "|"].includes(result.detectedDelimiter)
        ? result.detectedDelimiter
        : ";") as ";" | "," | "\t" | "|"
    );

    const activeProfile = profiles.find((p) => p.id === selectedProfileId);
    const nextMapping: ColumnMappingDict = { ...result.proposedMapping };
    if (activeProfile) {
      for (const header of result.headers) {
        if (activeProfile.mappings[header]) {
          nextMapping[header] = activeProfile.mappings[header] as LogicalField;
        }
      }
    }
    setMapping(nextMapping);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    if (!picked) return;
    setFile(picked);
    setActiveJobId(null);
    setJobProgress(null);
    setUploadPct(0);
    const baseName = picked.name.replace(/\.(csv|gz)+$/gi, "");
    setDatasetName(`${baseName} (${new Date().toISOString().slice(0, 10)})`);
    await inspectFile(picked);
  };

  const applyProfile = (profileId: string) => {
    setSelectedProfileId(profileId);
    const prof = profiles.find((p) => p.id === profileId);
    if (!prof || !inspection) return;
    const next: ColumnMappingDict = { ...mapping };
    for (const header of inspection.headers) {
      if (prof.mappings[header]) {
        next[header] = prof.mappings[header] as LogicalField;
      }
    }
    setMapping(next);
  };

  const handleSaveProfile = async () => {
    if (!profileSaveName.trim()) return;
    setSaveProfileMsg(null);
    const res = await fetch("/api/schema-profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: profileSaveName.trim(),
        delimiter,
        mapping,
      }),
    });
    const data = (await res.json()) as { id?: string; error?: string };
    if (!res.ok) {
      setSaveProfileMsg(data.error ?? "Failed to save profile");
      return;
    }
    setSaveProfileMsg("Schema profile saved.");
    setProfileSaveName("");
  };

  const mappedValues = new Set(Object.values(mapping));
  const missingTimestamp = !mappedValues.has("MESSAGE_TIMESTAMP");
  const missingPartner =
    !mappedValues.has("OP_NAME") && !mappedValues.has("TP_NAME");
  const missingStatus =
    !mappedValues.has("SUBMIT_STATUS") && !mappedValues.has("DLR_STATE");

  const startUploadAndProcess = async () => {
    if (!file || missingTimestamp || missingPartner) return;
    setError(null);
    setUploading(true);
    setUploadPct(0);

    try {
      const presignRes = await fetch("/api/uploads/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          fileSizeBytes: file.size,
          datasetName: datasetName.trim() || file.name,
          schemaProfileId: selectedProfileId || null,
          isCompressed: file.name.toLowerCase().endsWith(".gz"),
        }),
      });
      const presignData = (await presignRes.json()) as {
        jobId?: string;
        uploadUrl?: string;
        error?: string;
      };
      if (!presignRes.ok || !presignData.uploadUrl || !presignData.jobId) {
        throw new Error(presignData.error ?? "Failed to get presigned upload URL");
      }

      // Direct browser -> MinIO/R2 upload with real byte progress (0 server memory)
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", presignData.uploadUrl!);
        xhr.setRequestHeader(
          "Content-Type",
          file.name.toLowerCase().endsWith(".gz") ? "application/gzip" : "text/csv"
        );
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) {
            setUploadPct(Math.round((ev.loaded / ev.total) * 100));
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`Storage upload failed with HTTP ${xhr.status}`));
        };
        xhr.onerror = () =>
          reject(
            new Error(
              "Direct upload to storage failed. Ensure MinIO/R2 is running and CORS allows PUT."
            )
          );
        xhr.send(file);
      });

      const confirmRes = await fetch(
        `/api/uploads/${presignData.jobId}/confirm`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            delimiter,
            mapping,
            schemaProfileId: selectedProfileId || null,
          }),
        }
      );
      if (!confirmRes.ok) {
        const cErr = (await confirmRes.json()) as { error?: string };
        throw new Error(cErr.error ?? "Failed to queue CSV ingestion job");
      }

      setActiveJobId(presignData.jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="border-b border-[var(--border-subtle)] pb-4">
        <h1 className="text-xl font-semibold tracking-tight">
          Upload MediaCore CSV &amp; Dynamic Schema Mapping
        </h1>
        <p className="text-sm text-[var(--text-secondary)]">
          Previews only the first 64 KB in-browser, streams 50–200+ MB files directly to storage, and ingests asynchronously via the streaming worker.
        </p>
      </div>

      {/* File Selection Card */}
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">
              MediaCore Export (.csv or .csv.gz)
            </label>
            <label className="flex cursor-pointer items-center gap-3 rounded-md border border-dashed border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-4 py-4 text-xs hover:bg-[var(--bg-muted)]">
              <UploadCloud className="h-5 w-5 shrink-0 text-[var(--text-secondary)]" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">
                  {file ? file.name : "Choose MediaCore CSV export..."}
                </div>
                <div className="text-[11px] text-[var(--text-secondary)]">
                  {file
                    ? `${(file.size / (1024 * 1024)).toFixed(2)} MB`
                    : "Supports 2M-10M+ records without loading file into memory"}
                </div>
              </div>
              <input
                type="file"
                accept=".csv,.gz"
                onChange={handleFileChange}
                className="hidden"
              />
            </label>
          </div>

          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
                Dataset Name
              </label>
              <input
                type="text"
                value={datasetName}
                onChange={(e) => setDatasetName(e.target.value)}
                placeholder="Daily MediaCore XDR Export"
                className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-2 text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
                  Schema Profile
                </label>
                <select
                  value={selectedProfileId}
                  onChange={(e) => applyProfile(e.target.value)}
                  className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 py-2 text-xs"
                >
                  <option value="">Auto-Detect Only</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
                  Delimiter
                </label>
                <select
                  value={delimiter}
                  onChange={async (e) => {
                    const nextD = e.target.value as ";" | "," | "\t" | "|";
                    setDelimiter(nextD);
                    if (file) await inspectFile(file, nextD);
                  }}
                  className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 py-2 text-xs"
                >
                  <option value=";">Semicolon (;)</option>
                  <option value=",">Comma (,)</option>
                  <option value={"\t"}>Tab (\t)</option>
                  <option value="|">Pipe (|)</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Schema Mapping & Preview */}
      {inspection ? (
        <div className="space-y-5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <FileSpreadsheet className="h-4 w-4" />
              <span>
                Detected {inspection.headers.length} Columns &amp;{" "}
                {inspection.previewRows.length} Preview Rows
              </span>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Save mapping profile name..."
                value={profileSaveName}
                onChange={(e) => setProfileSaveName(e.target.value)}
                className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-xs"
              />
              <button
                type="button"
                onClick={handleSaveProfile}
                className="inline-flex items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-muted)] px-2.5 py-1.5 text-xs font-medium hover:opacity-80"
              >
                <Save className="h-3.5 w-3.5" /> Save Profile
              </button>
            </div>
          </div>
          {saveProfileMsg ? (
            <p className="text-xs text-[var(--text-secondary)]">{saveProfileMsg}</p>
          ) : null}

          {(missingTimestamp || missingPartner || missingStatus || inspection.ambiguousFields.length > 0) && (
            <div className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              {missingTimestamp ? (
                <p className="flex items-center gap-1.5 font-medium">
                  <AlertTriangle className="h-3.5 w-3.5" /> Required: Map a column to Message Timestamp.
                </p>
              ) : null}
              {missingPartner ? (
                <p className="flex items-center gap-1.5 font-medium">
                  <AlertTriangle className="h-3.5 w-3.5" /> Required: Map OP Name and/or TP Name.
                </p>
              ) : null}
              {missingStatus ? (
                <p>
                  Warning: Neither Submit Status nor DLR State is mapped. Records will be classified as UNKNOWN.
                </p>
              ) : null}
              {inspection.ambiguousFields.length > 0 ? (
                <p>
                  Ambiguous auto-matches detected for: {inspection.ambiguousFields.join(", ")}. Please confirm exact columns below.
                </p>
              ) : null}
            </div>
          )}

          {/* Column Mapping Table */}
          <div className="grid max-h-72 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
            {inspection.headers.map((header) => (
              <div
                key={header}
                className="flex items-center justify-between gap-2 rounded border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-xs"
              >
                <span className="truncate font-mono" title={header}>
                  {header}
                </span>
                <select
                  value={mapping[header] ?? "IGNORE"}
                  onChange={(e) =>
                    setMapping((prev) => ({
                      ...prev,
                      [header]: e.target.value as LogicalField | "IGNORE",
                    }))
                  }
                  className="max-w-[160px] rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-1.5 py-1 text-[11px]"
                >
                  <option value="IGNORE">Preserve as Extra</option>
                  {LOGICAL_FIELD_CATALOG.map((meta) => (
                    <option key={meta.field} value={meta.field}>
                      {meta.field}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {/* 25-Row Sample Preview */}
          <div className="overflow-x-auto rounded border border-[var(--border-subtle)]">
            <table className="w-full border-collapse text-left text-[11px]">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-muted)]">
                  {inspection.headers.slice(0, 10).map((h) => (
                    <th key={h} className="whitespace-nowrap px-2.5 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {inspection.previewRows.slice(0, 10).map((row, idx) => (
                  <tr key={idx} className="border-b border-[var(--border-subtle)]">
                    {inspection.headers.slice(0, 10).map((h) => (
                      <td
                        key={h}
                        className="max-w-[180px] truncate whitespace-nowrap px-2.5 py-1.5 text-[var(--text-secondary)]"
                      >
                        {row[h] || "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {error ? (
            <div className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
              {error}
            </div>
          ) : null}

          <div className="flex items-center justify-between">
            <div className="text-xs text-[var(--text-secondary)]">
              {uploading ? `Uploading directly to storage: ${uploadPct}%` : ""}
            </div>
            <button
              type="button"
              disabled={uploading || missingTimestamp || missingPartner}
              onClick={startUploadAndProcess}
              className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-950"
            >
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {uploading ? `Uploading (${uploadPct}%)` : "Upload & Start Streaming Ingestion"}
            </button>
          </div>
        </div>
      ) : null}

      {/* Live 12-Stage Processing Tracker */}
      {activeJobId ? (
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">
                Processing Pipeline Status
              </h2>
              <p className="text-xs text-[var(--text-secondary)]">
                Job ID: <span className="font-mono">{activeJobId}</span>
              </p>
            </div>
            <Link
              href={`/history/${activeJobId}`}
              className="rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--bg-muted)]"
            >
              View Quality Report &amp; Logs
            </Link>
          </div>

          {jobProgress ? (
            <div className="space-y-4">
              <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--bg-muted)]">
                <div
                  className="h-full bg-slate-900 transition-all dark:bg-slate-100"
                  style={{ width: `${jobProgress.job.progress_pct}%` }}
                />
              </div>

              <div className="grid gap-2 text-xs sm:grid-cols-4">
                <div className="rounded border border-[var(--border-subtle)] p-2.5">
                  <span className="text-[var(--text-secondary)]">Stage: </span>
                  <span className="font-semibold">
                    {jobProgress.job.stage_label}
                  </span>
                </div>
                <div className="rounded border border-[var(--border-subtle)] p-2.5 tabular-nums">
                  <span className="text-[var(--text-secondary)]">Inserted: </span>
                  <span className="font-semibold">
                    {Number(jobProgress.job.rows_inserted).toLocaleString()}
                  </span>
                </div>
                <div className="rounded border border-[var(--border-subtle)] p-2.5 tabular-nums">
                  <span className="text-[var(--text-secondary)]">Rejected: </span>
                  <span className="font-semibold">
                    {Number(jobProgress.job.rows_rejected).toLocaleString()}
                  </span>
                </div>
                <div className="rounded border border-[var(--border-subtle)] p-2.5 tabular-nums">
                  <span className="text-[var(--text-secondary)]">Skipped: </span>
                  <span className="font-semibold">
                    {Number(jobProgress.job.rows_skipped).toLocaleString()}
                  </span>
                </div>
              </div>

              <div className="grid gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
                {PROCESSING_STAGE_NAMES.map((label, idx) => {
                  const stageNum = idx + 1;
                  const done = jobProgress.job.stage > stageNum || jobProgress.job.queue_status === "COMPLETED";
                  const current = jobProgress.job.stage === stageNum;
                  return (
                    <div
                      key={label}
                      className={`flex items-center gap-1.5 rounded border px-2 py-1.5 text-[11px] ${
                        done
                          ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"
                          : current
                          ? "border-slate-500 bg-[var(--bg-muted)] font-semibold"
                          : "border-[var(--border-subtle)] text-[var(--text-secondary)]"
                      }`}
                    >
                      {done ? <CheckCircle2 className="h-3 w-3 shrink-0" /> : null}
                      <span>{label}</span>
                    </div>
                  );
                })}
              </div>

              {jobProgress.job.error_message ? (
                <div className="rounded border border-rose-300 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
                  {jobProgress.job.error_message}
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-[var(--text-secondary)]">
              Waiting for streaming worker status update...
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
