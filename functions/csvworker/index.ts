import crypto from "node:crypto";
import { attachDatabasePool, waitUntil } from "@neon/functions";
import { getEnv } from "../../src/lib/config/env";
import { appTransaction } from "../../src/lib/database/app-db";
import { getPostgresPool } from "../../src/lib/database/postgres";
import {
  createTinybirdIngestionAdapter,
  streamCsvUploadJob,
  type UploadJobRow,
} from "../../src/modules/csv-ingestion/stream-processor";

let poolAttached = false;
function ensurePoolAttached(): void {
  if (poolAttached) return;
  if (process.env.DATABASE_URL) {
    attachDatabasePool(getPostgresPool());
    poolAttached = true;
  }
}

const workerId = `neon-fn-${crypto.randomUUID().slice(0, 8)}`;
let isDraining = false;

function isAuthorizedRequest(request: Request): { ok: boolean; error?: string; status?: number } {
  const secret = process.env.WORKER_WEBHOOK_SECRET?.trim();
  if (!secret) {
    if (process.env.NEON_BRANCH_ID) {
      return {
        ok: false,
        status: 500,
        error: "WORKER_WEBHOOK_SECRET is required on deployed Neon Functions.",
      };
    }
    return { ok: true };
  }

  const header =
    request.headers.get("x-worker-secret") ?? request.headers.get("x-secret");
  if (header === null) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  const provided = Buffer.from(header);
  const expected = Buffer.from(secret);
  if (provided.byteLength !== expected.byteLength) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  return crypto.timingSafeEqual(provided, expected)
    ? { ok: true }
    : { ok: false, status: 401, error: "Unauthorized" };
}

async function claimNextQueuedJob(): Promise<UploadJobRow | null> {
  ensurePoolAttached();
  const nowIso = new Date().toISOString();
  const staleBeforeIso = new Date(Date.now() - 18 * 60_000).toISOString();

  return appTransaction(async (tx) => {
    // Reclaim any stalled RUNNING job from a prior evicted isolate
    await tx.query(
      `
      UPDATE upload_jobs
      SET queue_status = 'QUEUED',
          locked_by = NULL,
          locked_at = NULL,
          updated_at = $2
      WHERE queue_status = 'RUNNING'
        AND locked_at IS NOT NULL
        AND locked_at < $1
      `,
      [staleBeforeIso, nowIso]
    );

    const res = await tx.query<UploadJobRow>(
      `
      SELECT id, dataset_id, file_name, storage_bucket, storage_key,
             is_compressed, schema_profile_id, custom_mapping_override,
             attempt_count, max_attempts, checkpoint_batch_index
      FROM upload_jobs
      WHERE queue_status = 'QUEUED'
        AND (next_retry_at IS NULL OR next_retry_at <= $1)
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
      `,
      [nowIso]
    );

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
}

async function drainQueuedJobs(): Promise<void> {
  if (isDraining) return;
  isDraining = true;

  try {
    const adapter = createTinybirdIngestionAdapter();
    const batchSize = Number(process.env.WORKER_BATCH_SIZE ?? 10_000);

    while (true) {
      const job = await claimNextQueuedJob();
      if (!job) break;

      console.log(
        JSON.stringify({
          event: "neon_fn_job_started",
          workerId,
          jobId: job.id,
          fileName: job.file_name,
        })
      );

      await streamCsvUploadJob({
        adapter,
        job,
        batchSize,
      });
    }
  } catch (err) {
    console.error(
      "[neon-fn-csvworker] drain error:",
      err instanceof Error ? err.message : err
    );
  } finally {
    isDraining = false;
  }
}

export default {
  async fetch(request: Request): Promise<Response> {
    ensurePoolAttached();
    const url = new URL(request.url);

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      const env = getEnv();
      return Response.json({
        ok: true,
        runtime: "neon-functions",
        workerId,
        analyticsEngine: env.ANALYTICS_ENGINE,
        storageProvider: env.STORAGE_PROVIDER,
        busy: isDraining,
      });
    }

    if (request.method === "POST" && url.pathname === "/trigger") {
      const auth = isAuthorizedRequest(request);
      if (!auth.ok) {
        return Response.json({ error: auth.error }, { status: auth.status ?? 401 });
      }

      waitUntil(drainQueuedJobs());
      return Response.json(
        {
          accepted: true,
          runtime: "neon-functions",
          workerId,
          alreadyBusy: isDraining,
        },
        { status: 202 }
      );
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
};
