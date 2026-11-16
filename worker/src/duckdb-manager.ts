import fs from "node:fs";
import path from "node:path";
import {
  DuckDBInstance,
  listValue,
  type DuckDBConnection,
  type DuckDBValue,
} from "@duckdb/node-api";
import { getEnv } from "../../src/lib/config/env";
import type { ClickHouseSmsRecord } from "../../src/modules/csv-ingestion/normalizer";

class DuckDbManager {
  private instance: DuckDBInstance | null = null;
  private writeConn: DuckDBConnection | null = null;
  private initPromise: Promise<void> | null = null;
  private writeLock: Promise<void> = Promise.resolve();

  private async ensureInitialized(): Promise<void> {
    if (this.instance && this.writeConn) return;
    if (!this.initPromise) {
      this.initPromise = (async () => {
        const env = getEnv();
        const dbPath = path.resolve(process.cwd(), env.DUCKDB_PATH);
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        this.instance = await DuckDBInstance.create(dbPath);
        this.writeConn = await this.instance.connect();

        const schemaPath = path.resolve(
          process.cwd(),
          "database/duckdb/001_initial_schema.sql"
        );
        if (fs.existsSync(schemaPath)) {
          await this.writeConn.run(fs.readFileSync(schemaPath, "utf8"));
        }
      })();
    }
    await this.initPromise;
  }

  private async withWriteLock<T>(fn: (conn: DuckDBConnection) => Promise<T>): Promise<T> {
    await this.ensureInitialized();
    let release!: () => void;
    const prev = this.writeLock;
    this.writeLock = new Promise<void>((res) => {
      release = res;
    });
    await prev;
    try {
      return await fn(this.writeConn!);
    } finally {
      release();
    }
  }

  async getCommittedBatches(uploadId: string): Promise<Set<number>> {
    const rows = await this.query<{ batch_id: number | string }>(
      "SELECT batch_id FROM ingestion_batches WHERE upload_id = $uploadId",
      { uploadId }
    );
    return new Set(rows.map((r) => Number(r.batch_id)));
  }

  async appendBatch(
    uploadId: string,
    datasetId: string,
    batchId: number,
    records: ClickHouseSmsRecord[]
  ): Promise<void> {
    if (records.length === 0) return;

    await this.withWriteLock(async (conn) => {
      const app = await conn.createAppender("sms_records");
      try {
        for (const r of records) {
          app.appendVarchar(r.dataset_id);
          app.appendVarchar(r.upload_id);
          app.appendUInteger(r.batch_id);
          app.appendUBigInt(BigInt(r.message_row_id));
          app.appendVarchar(r.row_hash);
          app.appendVarchar(r.event_timestamp);
          if (r.dlr_timestamp) app.appendVarchar(r.dlr_timestamp);
          else app.appendNull();
          if (r.dlr_latency_ms !== null) app.appendBigInt(BigInt(r.dlr_latency_ms));
          else app.appendNull();

          app.appendVarchar(r.op_name);
          app.appendVarchar(r.tp_name);
          app.appendVarchar(r.applicant);
          app.appendVarchar(r.direction);
          app.appendVarchar(r.route);

          app.appendVarchar(r.op_ani);
          app.appendVarchar(r.tp_ani);
          app.appendVarchar(r.destination_number);
          app.appendVarchar(r.called_number_out);
          app.appendVarchar(r.message_id);
          app.appendVarchar(r.transaction_id);

          app.appendVarchar(r.country);
          app.appendVarchar(r.state_region);
          app.appendVarchar(r.raw_country_network);
          app.appendVarchar(r.op_mcc);
          app.appendVarchar(r.op_mnc);
          app.appendVarchar(r.tp_mcc);
          app.appendVarchar(r.tp_mnc);

          app.appendVarchar(r.raw_submit_status);
          app.appendVarchar(r.raw_dlr_state);
          app.appendVarchar(r.raw_status);
          app.appendVarchar(r.normalized_status);
          app.appendUTinyInt(r.is_terminal);
          app.appendVarchar(r.reason);
          app.appendVarchar(r.reason_normalized);

          app.appendVarchar(r.op_host);
          app.appendVarchar(r.tp_host);
          app.appendVarchar(r.nas_ip);
          if (r.op_price !== null) app.appendDouble(Number(r.op_price));
          else app.appendNull();
          if (r.tp_price !== null) app.appendDouble(Number(r.tp_price));
          else app.appendNull();
          if (r.cost_in !== null) app.appendDouble(Number(r.cost_in));
          else app.appendNull();
          if (r.cost_out !== null) app.appendDouble(Number(r.cost_out));
          else app.appendNull();
          app.appendVarchar(r.op_currency);
          app.appendVarchar(r.tp_currency);

          app.appendVarchar(r.extra_attributes);
          app.appendDefault(); // ingested_at
          app.endRow();
        }
        app.flushSync();
      } finally {
        app.closeSync();
      }

      await conn.run(
        "INSERT INTO ingestion_batches (upload_id, dataset_id, batch_id, row_count) VALUES ($uploadId, $datasetId, $batchId, $rowCount)",
        { uploadId, datasetId, batchId, rowCount: records.length }
      );
    });
  }

  async populateHourlyRollup(uploadId: string): Promise<void> {
    await this.withWriteLock(async (conn) => {
      await conn.run(
        `
        INSERT INTO sms_hourly_rollup
        SELECT
          dataset_id,
          date_trunc('hour', event_timestamp) AS bucket_hour,
          op_name,
          tp_name,
          applicant,
          country,
          state_region,
          route,
          raw_status,
          normalized_status,
          is_terminal,
          reason_normalized,
          COUNT(*) AS total_count,
          SUM(CASE WHEN normalized_status = 'SUCCESS' THEN 1 ELSE 0 END) AS success_count,
          SUM(CASE WHEN normalized_status = 'FAILED' THEN 1 ELSE 0 END) AS failed_count,
          SUM(CASE WHEN normalized_status = 'REJECTED' THEN 1 ELSE 0 END) AS rejected_count,
          SUM(CASE WHEN normalized_status = 'PENDING' THEN 1 ELSE 0 END) AS pending_count,
          SUM(CASE WHEN normalized_status = 'UNKNOWN' THEN 1 ELSE 0 END) AS unknown_count,
          SUM(CASE WHEN normalized_status = 'OTHER' THEN 1 ELSE 0 END) AS other_count,
          SUM(CASE WHEN is_terminal = 1 THEN 1 ELSE 0 END) AS terminal_count,
          SUM(COALESCE(cost_in, 0)) AS cost_in_sum,
          SUM(COALESCE(cost_out, 0)) AS cost_out_sum,
          COALESCE(SUM(CASE WHEN dlr_latency_ms IS NOT NULL THEN dlr_latency_ms ELSE 0 END), 0) AS dlr_latency_ms_sum,
          SUM(CASE WHEN dlr_latency_ms IS NOT NULL THEN 1 ELSE 0 END) AS dlr_latency_count
        FROM sms_records
        WHERE upload_id = $uploadId
        GROUP BY
          dataset_id,
          bucket_hour,
          op_name,
          tp_name,
          applicant,
          country,
          state_region,
          route,
          raw_status,
          normalized_status,
          is_terminal,
          reason_normalized
        `,
        { uploadId }
      );
    });
  }

  async query<T = Record<string, unknown>>(
    sql: string,
    params: Record<string, unknown> = {}
  ): Promise<T[]> {
    await this.ensureInitialized();
    const conn = await this.instance!.connect();
    try {
      const bound: Record<string, DuckDBValue> = {};
      for (const [k, v] of Object.entries(params)) {
        if (v === undefined) continue;
        if (Array.isArray(v)) {
          bound[k] = listValue(v as DuckDBValue[]);
        } else {
          bound[k] = v as DuckDBValue;
        }
      }
      const hasBound = Object.keys(bound).length > 0;
      const reader = hasBound
        ? await conn.runAndReadAll(sql, bound)
        : await conn.runAndReadAll(sql);
      return reader.getRowObjectsJson() as unknown as T[];
    } finally {
      conn.closeSync();
    }
  }

  async ping(): Promise<{ ok: boolean }> {
    await this.ensureInitialized();
    await this.query("SELECT 1 AS ok");
    return { ok: true };
  }
}

export const duckDbManager = new DuckDbManager();
