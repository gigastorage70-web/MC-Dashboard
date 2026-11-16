import http from "node:http";
import crypto from "node:crypto";
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { getEnv } from "../../src/lib/config/env";
import { appTransaction } from "../../src/lib/database/app-db";
import { duckDbManager } from "./duckdb-manager";
import {
  processCsvUploadJob,
  type UploadJobRow,
} from "./processors/csv-ingestion";

const env = getEnv();
const WORKER_PORT = Number(process.env.WORKER_PORT ?? env.WORKER_PORT ?? 4001);
const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 3000);
const BATCH_SIZE = Number(process.env.WORKER_BATCH_SIZE ?? 10000);
const WEBHOOK_SECRET = process.env.WORKER_WEBHOOK_SECRET ?? "";

const workerId = `worker-${crypto.randomUUID().slice(0, 8)}`;

const chClient: ClickHouseClient | null =
  env.ANALYTICS_ENGINE === "clickhouse"
    ? createClient({
        url: env.CLICKHOUSE_URL,
        database: env.CLICKHOUSE_DATABASE,
        username: env.CLICKHOUSE_USER,
        password: env.CLICKHOUSE_PASSWORD,
        request_timeout: 60_000,
      })
    : null;

let isProcessing = false;

async function pollAppDbQueue(): Promise<void> {
  if (isProcessing) return;
  isProcessing = true;
  let claimedJob: UploadJobRow | null = null;

  try {
    const nowIso = new Date().toISOString();
    claimedJob = await appTransaction(async (tx) => {
      const selectSql = tx.isSqlite
        ? `
          SELECT id, dataset_id, file_name, storage_bucket, storage_key,
                 is_compressed, schema_profile_id, custom_mapping_override,
                 attempt_count, max_attempts, checkpoint_batch_index
          FROM upload_jobs
          WHERE queue_status = 'QUEUED'
            AND (next_retry_at IS NULL OR next_retry_at <= $1)
          ORDER BY created_at ASC
          LIMIT 1
          `
        : `
          SELECT id, dataset_id, file_name, storage_bucket, storage_key,
                 is_compressed, schema_profile_id, custom_mapping_override,
                 attempt_count, max_attempts, checkpoint_batch_index
          FROM upload_jobs
          WHERE queue_status = 'QUEUED'
            AND (next_retry_at IS NULL OR next_retry_at <= $1)
          ORDER BY created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
          `;

      const res = await tx.query<UploadJobRow>(selectSql, [nowIso]);
      if (res.rows.length === 0) return null;

      const job = res.rows[0];
      await tx.query(
        `
        UPDATE upload_jobs
        SET queue_status = 'RUNNING',
            locked_by = $2,
            locked_at = $3,
            started_at = COALESCE(started_at, $3),
            updated_at = $3
        WHERE id = $1
        `,
        [job.id, workerId, nowIso]
      );
      await tx.query(
        "UPDATE datasets SET status = 'PROCESSING', updated_at = $2 WHERE id = $1",
        [job.dataset_id, nowIso]
      );
      return job;
    });

    if (claimedJob) {
      console.log(
        JSON.stringify({
          event: "job_started",
          workerId,
          jobId: claimedJob.id,
          fileName: claimedJob.file_name,
        })
      );
      await processCsvUploadJob({
        ch: chClient,
        job: claimedJob,
        batchSize: BATCH_SIZE,
      });
    }
  } catch (err) {
    console.error("[worker] poll error:", err instanceof Error ? err.message : err);
  } finally {
    isProcessing = false;
  }
}

function readJsonBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function isAuthorized(req: http.IncomingMessage): boolean {
  if (!WEBHOOK_SECRET) return true;
  return req.headers["x-worker-secret"] === WEBHOOK_SECRET;
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          workerId,
          analyticsEngine: env.ANALYTICS_ENGINE,
          appDbMode: env.APP_DB_MODE,
          busy: isProcessing,
        })
      );
      return;
    }

    if (req.method === "GET" && req.url === "/duckdb/health") {
      const ping = await duckDbManager.ping();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(ping));
      return;
    }

    if (req.method === "POST" && req.url === "/duckdb/query") {
      if (!isAuthorized(req)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized DuckDB query" }));
        return;
      }
      const raw = await readJsonBody(req);
      const body = JSON.parse(raw) as {
        sql?: string;
        params?: Record<string, unknown>;
      };
      if (!body.sql) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "SQL query required" }));
        return;
      }
      const rows = await duckDbManager.query(body.sql, body.params ?? {});
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ rows }));
      return;
    }

    if (req.method === "POST" && req.url === "/trigger") {
      if (!isAuthorized(req)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized webhook trigger" }));
        return;
      }
      void pollAppDbQueue();
      res.writeHead(202, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ accepted: true, workerId }));
      return;
    }

    res.writeHead(404);
    res.end();
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Worker HTTP error",
      })
    );
  }
});

server.listen(WORKER_PORT, () => {
  console.log(
    JSON.stringify({
      event: "worker_started",
      workerId,
      port: WORKER_PORT,
      appDbMode: env.APP_DB_MODE,
      analyticsEngine: env.ANALYTICS_ENGINE,
      storageProvider: env.STORAGE_PROVIDER,
      batchSize: BATCH_SIZE,
    })
  );
});

setInterval(() => {
  void pollAppDbQueue();
}, POLL_INTERVAL_MS);
