import crypto from "node:crypto";
import { Readable } from "node:stream";
import zlib from "node:zlib";
import { parse } from "csv-parse";
import { getEnv } from "../../lib/config/env";
import { appQuery, asBool, parseJsonField } from "../../lib/database/app-db";
import { ingestTinybirdEvents, queryTinybird } from "../../lib/database/tinybird";
import { sanitizeCsvCell } from "../../lib/metrics/definitions";
import { getStorageObjectStream, putStorageObject } from "../../lib/storage";
import {
  buildFieldIndexMap,
  normalizeCsvRow,
  type ClickHouseSmsRecord,
  type StatusRuleRecord,
} from "./normalizer";
import { buildHourlyRollupRows } from "./rollup";
import {
  detectCsvDelimiter,
  type ColumnMappingDict,
} from "../schema-mapping/constants";

export interface UploadJobRow {
  id: string;
  dataset_id: string;
  file_name: string;
  storage_bucket: string;
  storage_key: string;
  is_compressed: boolean | number;
  schema_profile_id: string | null;
  custom_mapping_override: unknown;
  attempt_count: number;
  max_attempts: number;
  checkpoint_batch_index: number;
}

export interface AnalyticsIngestionAdapter {
  getCommittedBatches(uploadId: string): Promise<Set<number>>;
  flushBatch(params: {
    uploadId: string;
    datasetId: string;
    batchId: number;
    records: ClickHouseSmsRecord[];
  }): Promise<void>;
  finalizeJob?(uploadId: string): Promise<void>;
}

const STAGE_LABELS: Record<number, string> = {
  4: "File validation",
  5: "CSV parsing",
  6: "Schema mapping",
  7: "Data normalization",
  8: "Validation",
  9: "Database ingestion",
  10: "Analytics preparation",
  11: "Processing completed",
  12: "Failed or partially completed",
};

/**
 * Tinybird ingestion adapter writing raw records + hourly rollups + batch checkpoints via Events API.
 */
export function createTinybirdIngestionAdapter(): AnalyticsIngestionAdapter {
  return {
    async getCommittedBatches(uploadId: string): Promise<Set<number>> {
      const rows = await queryTinybird<{ batch_id: number | string }>(
        "SELECT batch_id FROM ingestion_batches WHERE upload_id = {uploadId:String}",
        { uploadId }
      );
      return new Set(rows.map((r) => Number(r.batch_id)));
    },
    async flushBatch({ uploadId, datasetId, batchId, records }) {
      const rollupRows = buildHourlyRollupRows(records);
      await Promise.all([
        ingestTinybirdEvents({ datasource: "sms_records", rows: records }),
        ingestTinybirdEvents({ datasource: "sms_hourly_rollup", rows: rollupRows }),
      ]);
      await ingestTinybirdEvents({
        datasource: "ingestion_batches",
        rows: [
          {
            upload_id: uploadId,
            dataset_id: datasetId,
            batch_id: batchId,
            row_count: records.length,
          },
        ],
      });
    },
  };
}

async function updateJobStage(
  jobId: string,
  stage: number,
  progressPct: number,
  extra?: Partial<{
    rowsProcessed: number;
    rowsInserted: number;
    rowsRejected: number;
    rowsSkipped: number;
    checkpointRowOffset: number;
    checkpointBatchIndex: number;
  }>
) {
  await appQuery(
    `
    UPDATE upload_jobs
    SET stage = $2,
        stage_label = $3,
        progress_pct = $4,
        rows_processed = COALESCE($5, rows_processed),
        rows_inserted = COALESCE($6, rows_inserted),
        rows_rejected = COALESCE($7, rows_rejected),
        rows_skipped = COALESCE($8, rows_skipped),
        checkpoint_row_offset = COALESCE($9, checkpoint_row_offset),
        checkpoint_batch_index = COALESCE($10, checkpoint_batch_index),
        updated_at = $11
    WHERE id = $1
    `,
    [
      jobId,
      stage,
      STAGE_LABELS[stage] ?? "Processing",
      progressPct,
      extra?.rowsProcessed ?? null,
      extra?.rowsInserted ?? null,
      extra?.rowsRejected ?? null,
      extra?.rowsSkipped ?? null,
      extra?.checkpointRowOffset ?? null,
      extra?.checkpointBatchIndex ?? null,
      new Date().toISOString(),
    ]
  );
}

async function logProcessing(
  jobId: string,
  datasetId: string,
  level: "INFO" | "WARN" | "ERROR",
  stage: number,
  message: string,
  metadata: Record<string, unknown> = {}
) {
  await appQuery(
    `
    INSERT INTO processing_logs (upload_job_id, dataset_id, level, stage, message, metadata)
    VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [jobId, datasetId, level, stage, message, JSON.stringify(metadata)]
  );
}

async function loadMappingAndRules(job: UploadJobRow): Promise<{
  delimiter: string | null;
  mapping: ColumnMappingDict;
  statusRules: StatusRuleRecord[];
}> {
  const override = parseJsonField<{
    delimiter?: string;
    mapping?: ColumnMappingDict;
  } | null>(job.custom_mapping_override, null);

  let delimiter: string | null = override?.delimiter ?? null;
  const mapping: ColumnMappingDict = { ...(override?.mapping ?? {}) };

  if (Object.keys(mapping).length === 0 && job.schema_profile_id) {
    const prof = await appQuery<{ delimiter: string }>(
      "SELECT delimiter FROM schema_profiles WHERE id = $1",
      [job.schema_profile_id]
    );
    if (prof.rows[0]?.delimiter) {
      delimiter = delimiter ?? prof.rows[0].delimiter;
    }

    const mapRows = await appQuery<{
      csv_column_name: string;
      logical_field: string;
    }>(
      "SELECT csv_column_name, logical_field FROM schema_mappings WHERE profile_id = $1 ORDER BY priority ASC",
      [job.schema_profile_id]
    );
    for (const r of mapRows.rows) {
      mapping[r.csv_column_name] = r.logical_field as ColumnMappingDict[string];
    }
  }

  const ruleRows = await appQuery<{
    match_submit_status: string | null;
    match_dlr_state: string | null;
    normalized_status: StatusRuleRecord["normalizedStatus"];
    is_terminal: boolean | number;
  }>(
    `
    SELECT match_submit_status, match_dlr_state, normalized_status, is_terminal
    FROM status_classification_rules
    WHERE is_active = $1
    ORDER BY priority ASC, id ASC
    `,
    [true]
  );

  return {
    delimiter,
    mapping,
    statusRules: ruleRows.rows.map((r) => ({
      matchSubmitStatus: r.match_submit_status,
      matchDlrState: r.match_dlr_state,
      normalizedStatus: r.normalized_status,
      isTerminal: asBool(r.is_terminal),
    })),
  };
}

/**
 * Streams a MediaCore CSV / .csv.gz export from storage, normalizes rows in bounded batches,
 * checkpoints progress, ingests into Tinybird / DuckDB / ClickHouse, and writes quality reports.
 */
export async function streamCsvUploadJob(params: {
  adapter: AnalyticsIngestionAdapter;
  job: UploadJobRow;
  batchSize: number;
}): Promise<void> {
  const { adapter, job, batchSize } = params;
  const env = getEnv();
  const startedMs = Date.now();
  const errorCsvLines: string[] = ["row_number,reason_code,message,raw_line\n"];
  let errorCountWritten = 0;

  try {
    await updateJobStage(job.id, 4, 5);
    await logProcessing(job.id, job.dataset_id, "INFO", 4, "Validating CSV source stream", {
      provider: env.STORAGE_PROVIDER,
      engine: env.ANALYTICS_ENGINE,
      key: job.storage_key,
    });

    const { stream: sourceStream, contentLength: totalBytes } =
      await getStorageObjectStream({
        bucket: job.storage_bucket,
        key: job.storage_key,
      });

    const { delimiter: configuredDelimiter, mapping, statusRules } =
      await loadMappingAndRules(job);

    const committedBatches = await adapter.getCommittedBatches(job.id);

    await updateJobStage(job.id, 5, 10);

    const rawStream: Readable =
      asBool(job.is_compressed) || job.file_name.toLowerCase().endsWith(".gz")
        ? sourceStream.pipe(zlib.createGunzip())
        : sourceStream;

    let activeDelimiter = configuredDelimiter;
    let firstChunks: Buffer[] = [];
    let probeBytes = 0;

    const iterator = rawStream[Symbol.asyncIterator]();
    while (!activeDelimiter && probeBytes < 65_536) {
      const next = await iterator.next();
      if (next.done) break;
      const buf = Buffer.isBuffer(next.value) ? next.value : Buffer.from(next.value);
      firstChunks.push(buf);
      probeBytes += buf.length;
      if (buf.includes(10)) break;
    }

    if (!activeDelimiter) {
      const sample = Buffer.concat(firstChunks).toString("utf8");
      activeDelimiter = detectCsvDelimiter(sample);
    }

    const replayStream = Readable.from(
      (async function* () {
        for (const chunk of firstChunks) yield chunk;
        firstChunks = [];
        while (true) {
          const next = await iterator.next();
          if (next.done) break;
          yield next.value;
        }
      })()
    );

    const parser = replayStream.pipe(
      parse({
        delimiter: activeDelimiter,
        bom: true,
        relax_quotes: true,
        relax_column_count: true,
        skip_empty_lines: true,
      })
    );

    let headers: string[] = [];
    let fieldIndex: ReturnType<typeof buildFieldIndexMap>["byField"] = {};
    let extraCols: ReturnType<typeof buildFieldIndexMap>["extraCols"] = [];

    let totalRowsDetected = 0;
    let validRows = 0;
    let invalidRows = 0;
    let duplicateRows = 0;
    let skippedRows = 0;
    let repeatedHeaderRows = 0;
    let missingCriticalFields = 0;
    let unknownStatusRows = 0;
    let malformedTimestamps = 0;

    let minEpochMs: number | null = null;
    let maxEpochMs: number | null = null;
    const mappedDimSet = new Set<string>();
    const errorBreakdown: Record<string, number> = {};

    let batchIndex = 1;
    let currentBatch: ClickHouseSmsRecord[] = [];
    const rollingHashes: string[] = [];
    const rollingHashSet = new Set<string>();

    const flushCurrentBatch = async () => {
      if (currentBatch.length === 0) return;
      if (!committedBatches.has(batchIndex)) {
        await adapter.flushBatch({
          uploadId: job.id,
          datasetId: job.dataset_id,
          batchId: batchIndex,
          records: currentBatch,
        });
        committedBatches.add(batchIndex);
      }
      currentBatch = [];

      const estPct =
        totalBytes > 0
          ? Math.min(90, 20 + Math.round((validRows / Math.max(1, totalRowsDetected)) * 68))
          : Math.min(90, 25 + batchIndex);

      await updateJobStage(job.id, 9, estPct, {
        rowsProcessed: totalRowsDetected,
        rowsInserted: validRows,
        rowsRejected: invalidRows,
        rowsSkipped: skippedRows,
        checkpointRowOffset: totalRowsDetected,
        checkpointBatchIndex: batchIndex,
      });
      batchIndex += 1;
    };

    for await (const rawRow of parser as AsyncIterable<string[]>) {
      if (headers.length === 0) {
        headers = rawRow.map((h) => h.trim());
        const built = buildFieldIndexMap(headers, mapping);
        fieldIndex = built.byField;
        extraCols = built.extraCols;

        if (fieldIndex.MESSAGE_TIMESTAMP === undefined) {
          throw new Error(
            "CSV processing stopped because the expected Message Timestamp column could not be mapped. Please review the schema mapping and retry."
          );
        }
        if (fieldIndex.OP_NAME === undefined && fieldIndex.TP_NAME === undefined) {
          throw new Error(
            "CSV processing stopped because neither OP Name nor TP Name could be mapped. Please review the schema mapping and retry."
          );
        }

        for (const key of Object.keys(fieldIndex)) mappedDimSet.add(key);

        await updateJobStage(job.id, 6, 15);
        await logProcessing(job.id, job.dataset_id, "INFO", 6, "Schema mapping verified", {
          delimiter: activeDelimiter,
          headerCount: headers.length,
          mappedFields: Array.from(mappedDimSet),
        });
        await updateJobStage(job.id, 7, 20);
        continue;
      }

      totalRowsDetected += 1;
      const outcome = normalizeCsvRow({
        row: rawRow,
        rowNumber: totalRowsDetected,
        headers,
        fieldIndex,
        extraCols,
        datasetId: job.dataset_id,
        uploadId: job.id,
        batchId: batchIndex,
        statusRules,
      });

      if (outcome.kind === "skipped_header") {
        repeatedHeaderRows += 1;
        skippedRows += 1;
        continue;
      }

      if (outcome.kind === "invalid" || !outcome.record) {
        invalidRows += 1;
        const fail = outcome.failure!;
        errorBreakdown[fail.reasonCode] = (errorBreakdown[fail.reasonCode] ?? 0) + 1;
        if (fail.reasonCode === "MALFORMED_TIMESTAMP") malformedTimestamps += 1;
        if (fail.reasonCode === "MISSING_CRITICAL_FIELD") missingCriticalFields += 1;

        if (errorCountWritten < 50_000) {
          errorCsvLines.push(
            [
              sanitizeCsvCell(fail.rowNumber),
              sanitizeCsvCell(fail.reasonCode),
              sanitizeCsvCell(fail.message),
              sanitizeCsvCell(fail.rawLine),
            ].join(",") + "\n"
          );
          errorCountWritten += 1;
        }
        continue;
      }

      if (rollingHashSet.has(outcome.record.row_hash)) {
        duplicateRows += 1;
        skippedRows += 1;
        continue;
      }
      rollingHashes.push(outcome.record.row_hash);
      rollingHashSet.add(outcome.record.row_hash);
      if (rollingHashes.length > 25_000) {
        const evicted = rollingHashes.shift();
        if (evicted) rollingHashSet.delete(evicted);
      }

      if (outcome.record.normalized_status === "UNKNOWN") unknownStatusRows += 1;
      if (outcome.eventEpochMs !== undefined) {
        if (minEpochMs === null || outcome.eventEpochMs < minEpochMs) minEpochMs = outcome.eventEpochMs;
        if (maxEpochMs === null || outcome.eventEpochMs > maxEpochMs) maxEpochMs = outcome.eventEpochMs;
      }

      validRows += 1;
      currentBatch.push(outcome.record);

      if (currentBatch.length >= batchSize) {
        await flushCurrentBatch();
      }
    }

    await flushCurrentBatch();

    await updateJobStage(job.id, 10, 94, {
      rowsProcessed: totalRowsDetected,
      rowsInserted: validRows,
      rowsRejected: invalidRows,
      rowsSkipped: skippedRows,
      checkpointRowOffset: totalRowsDetected,
      checkpointBatchIndex: Math.max(1, batchIndex - 1),
    });

    if (adapter.finalizeJob) {
      await adapter.finalizeJob(job.id);
    }

    let errorReportKey: string | null = null;
    if (errorCountWritten > 0) {
      errorReportKey = `error-reports/${job.dataset_id}/${job.id}.csv`;
      await putStorageObject({
        bucket: job.storage_bucket,
        key: errorReportKey,
        body: Buffer.from(errorCsvLines.join(""), "utf8"),
        contentType: "text/csv",
      });
    }

    const durationMs = Date.now() - startedMs;
    const finalStatus =
      validRows === 0 && invalidRows > 0
        ? "FAILED"
        : invalidRows > 0
        ? "PARTIAL"
        : "COMPLETED";

    await appQuery(
      `
      INSERT INTO data_quality_reports (
        id, upload_job_id, dataset_id, total_rows_detected, valid_rows, invalid_rows,
        duplicate_rows, rows_skipped, repeated_header_rows, missing_critical_fields,
        unknown_status_rows, malformed_timestamps, unrecognized_columns, mapped_columns,
        error_breakdown, error_report_storage_key, processing_duration_ms, final_status
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      ON CONFLICT (upload_job_id) DO UPDATE SET
        total_rows_detected = EXCLUDED.total_rows_detected,
        valid_rows = EXCLUDED.valid_rows,
        invalid_rows = EXCLUDED.invalid_rows,
        duplicate_rows = EXCLUDED.duplicate_rows,
        rows_skipped = EXCLUDED.rows_skipped,
        repeated_header_rows = EXCLUDED.repeated_header_rows,
        missing_critical_fields = EXCLUDED.missing_critical_fields,
        unknown_status_rows = EXCLUDED.unknown_status_rows,
        malformed_timestamps = EXCLUDED.malformed_timestamps,
        error_breakdown = EXCLUDED.error_breakdown,
        error_report_storage_key = EXCLUDED.error_report_storage_key,
        processing_duration_ms = EXCLUDED.processing_duration_ms,
        final_status = EXCLUDED.final_status
      `,
      [
        crypto.randomUUID(),
        job.id,
        job.dataset_id,
        totalRowsDetected,
        validRows,
        invalidRows,
        duplicateRows,
        skippedRows,
        repeatedHeaderRows,
        missingCriticalFields,
        unknownStatusRows,
        malformedTimestamps,
        JSON.stringify(extraCols.map((c) => c.header)),
        JSON.stringify(fieldIndex),
        JSON.stringify(errorBreakdown),
        errorReportKey,
        durationMs,
        finalStatus,
      ]
    );

    const nowIso = new Date().toISOString();
    const finalStage = finalStatus === "FAILED" ? 12 : 11;

    await appQuery(
      `
      UPDATE upload_jobs
      SET stage = $2,
          stage_label = $3,
          progress_pct = 100,
          queue_status = $4,
          rows_processed = $5,
          rows_inserted = $6,
          rows_rejected = $7,
          rows_skipped = $8,
          completed_at = $9,
          duration_ms = $10,
          updated_at = $9
      WHERE id = $1
      `,
      [
        job.id,
        finalStage,
        STAGE_LABELS[finalStage],
        finalStatus,
        totalRowsDetected,
        validRows,
        invalidRows,
        skippedRows,
        nowIso,
        durationMs,
      ]
    );

    await appQuery(
      `
      UPDATE datasets
      SET status = $2,
          coverage_start = $3,
          coverage_end = $4,
          total_rows = $5,
          valid_rows = $6,
          invalid_rows = $7,
          duplicate_rows = $8,
          skipped_rows = $9,
          available_dimensions = $10,
          updated_at = $11
      WHERE id = $1
      `,
      [
        job.dataset_id,
        finalStatus,
        minEpochMs !== null ? new Date(minEpochMs).toISOString() : null,
        maxEpochMs !== null ? new Date(maxEpochMs).toISOString() : null,
        totalRowsDetected,
        validRows,
        invalidRows,
        duplicateRows,
        skippedRows,
        JSON.stringify(Array.from(mappedDimSet)),
        nowIso,
      ]
    );

    await logProcessing(job.id, job.dataset_id, "INFO", finalStage, "CSV ingestion finished", {
      engine: env.ANALYTICS_ENGINE,
      totalRowsDetected,
      validRows,
      invalidRows,
      repeatedHeaderRows,
      durationMs,
      finalStatus,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown worker processing error";
    const nextAttempt = job.attempt_count + 1;
    const canRetry = nextAttempt < job.max_attempts;
    const backoffMs = Math.pow(2, nextAttempt) * 15_000;
    const nextRetryIso = canRetry
      ? new Date(Date.now() + backoffMs).toISOString()
      : null;

    await appQuery(
      `
      UPDATE upload_jobs
      SET stage = 12,
          stage_label = 'Failed or partially completed',
          queue_status = $2,
          attempt_count = $3,
          next_retry_at = $4,
          error_message = $5,
          locked_by = NULL,
          locked_at = NULL,
          updated_at = $6
      WHERE id = $1
      `,
      [
        job.id,
        canRetry ? "QUEUED" : "FAILED",
        nextAttempt,
        nextRetryIso,
        message,
        new Date().toISOString(),
      ]
    );

    if (!canRetry) {
      await appQuery(
        "UPDATE datasets SET status = 'FAILED', updated_at = $2 WHERE id = $1",
        [job.dataset_id, new Date().toISOString()]
      );
    }

    await logProcessing(job.id, job.dataset_id, "ERROR", 12, message, {
      attempt: nextAttempt,
      willRetry: canRetry,
    });
  }
}
