import fs from "node:fs";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getEnv } from "@/lib/config/env";
import {
  commandAnalytics,
  getAnalyticsEngine,
  queryAnalytics,
} from "@/lib/database/analytics-db";
import { appQuery, isSqliteMode, parseJsonField } from "@/lib/database/app-db";
import {
  deleteTinybirdDatasetRows,
  getTinybirdStorageStats,
} from "@/lib/database/tinybird";
import {
  deleteStorageKeys,
  deleteStoragePrefix,
  listStorageObjects,
} from "@/lib/storage";
import { writeAuditLog } from "@/modules/authentication/service";

const GIB = 1024 * 1024 * 1024;
const DATASET_KEY_PREFIX_REGEX =
  /^(?:uploads|error-reports)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//i;

const REINDEX_TABLES = [
  "datasets",
  "upload_jobs",
  "processing_logs",
  "data_quality_reports",
  "degradation_alerts",
] as const;

const DASHBOARD_PATHS = [
  "/",
  "/upload",
  "/history",
  "/op-analytics",
  "/tp-analytics",
  "/applicant-analytics",
  "/ani-analytics",
  "/geographic-analytics",
  "/rejection-intelligence",
  "/message-explorer",
  "/performance-monitoring",
  "/historical-comparison",
  "/reports",
] as const;

export interface DatasetStorageItem {
  id: string;
  name: string;
  status: string;
  fileName: string;
  reportedFileSizeBytes: number;
  storageBytes: number;
  storageObjectCount: number;
  validRows: number;
  createdAt: string;
}

export interface StorageSummaryPayload {
  objectStorage: {
    provider: string;
    bucket: string;
    consumedBytes: number;
    quotaBytes: number | null;
    availableBytes: number | null;
    objectCount: number;
  };
  appDatabase: {
    engine: "postgres" | "sqlite";
    consumedBytes: number;
    quotaBytes: number | null;
    availableBytes: number | null;
  };
  analyticsDatabase: {
    engine: "tinybird" | "clickhouse" | "duckdb";
    consumedBytes: number;
    totalRows: number;
    quotaBytes: number | null;
    availableBytes: number | null;
  };
  orphanObjects: {
    count: number;
    totalBytes: number;
  };
  datasets: DatasetStorageItem[];
}

/**
 * Purges Next.js route caches and refreshes database index statistics after mutations/deletes.
 */
export async function purgeAppCachesAndReindex(): Promise<{
  cachePurged: boolean;
  reindexedTables: string[];
}> {
  let cachePurged = false;
  try {
    revalidatePath("/", "layout");
    for (const p of DASHBOARD_PATHS) {
      revalidatePath(p);
    }
    cachePurged = true;
  } catch {
    // Non-request contexts (scripts/tests) skip Next.js route cache invalidation
  }

  const reindexedTables: string[] = [];
  if (isSqliteMode()) {
    await appQuery("ANALYZE").catch(() => undefined);
    reindexedTables.push("sqlite_all");
  } else {
    for (const table of REINDEX_TABLES) {
      try {
        await appQuery(`VACUUM (ANALYZE) ${table}`);
        reindexedTables.push(table);
      } catch {
        await appQuery(`ANALYZE ${table}`).catch(() => undefined);
        reindexedTables.push(table);
      }
    }
  }

  return { cachePurged, reindexedTables };
}

/**
 * Deletes a dataset across Tinybird/ClickHouse/DuckDB, Object Storage, and Neon Postgres,
 * then purges caches and refreshes Postgres statistics.
 */
export async function deleteDatasetCompletely(
  rawDatasetId: string,
  actor: { userId: string; email: string }
): Promise<{
  deletedDatasetId: string;
  datasetName: string;
  deletedStorageObjects: number;
  cachePurged: boolean;
  reindexedTables: string[];
}> {
  const datasetId = z.string().uuid().parse(rawDatasetId).toLowerCase();
  const env = getEnv();

  const dsRes = await appQuery<{ id: string; name: string }>(
    "SELECT id, name FROM datasets WHERE id = $1",
    [datasetId]
  );
  if (dsRes.rows.length === 0) {
    throw new Error("Dataset not found");
  }
  const dataset = dsRes.rows[0];

  await appQuery("UPDATE datasets SET status = 'DELETING' WHERE id = $1", [
    datasetId,
  ]);

  const keysRes = await appQuery<{
    storage_bucket: string;
    storage_key: string;
    error_report_storage_key: string | null;
  }>(
    `
    SELECT j.storage_bucket, j.storage_key, dqr.error_report_storage_key
    FROM upload_jobs j
    LEFT JOIN data_quality_reports dqr ON dqr.upload_job_id = j.id
    WHERE j.dataset_id = $1
    `,
    [datasetId]
  );

  // 1. Delete analytical records from active engine
  const engine = getAnalyticsEngine();
  if (engine === "duckdb") {
    await commandAnalytics("DELETE FROM sms_records WHERE dataset_id = $datasetId", {
      datasetId,
    });
    await commandAnalytics("DELETE FROM sms_hourly_rollup WHERE dataset_id = $datasetId", {
      datasetId,
    });
    await commandAnalytics("DELETE FROM ingestion_batches WHERE dataset_id = $datasetId", {
      datasetId,
    });
  } else if (engine === "tinybird") {
    await Promise.all([
      deleteTinybirdDatasetRows("sms_records", datasetId),
      deleteTinybirdDatasetRows("sms_hourly_rollup", datasetId),
      deleteTinybirdDatasetRows("ingestion_batches", datasetId),
    ]);
  } else {
    await commandAnalytics(
      "ALTER TABLE mc_analytics.sms_records DELETE WHERE dataset_id = {datasetId:UUID} SETTINGS mutations_sync = 1",
      { datasetId }
    );
    await commandAnalytics(
      "ALTER TABLE mc_analytics.sms_hourly_rollup DELETE WHERE dataset_id = {datasetId:UUID} SETTINGS mutations_sync = 1",
      { datasetId }
    );
    await commandAnalytics(
      "ALTER TABLE mc_analytics.ingestion_batches DELETE WHERE dataset_id = {datasetId:UUID} SETTINGS mutations_sync = 1",
      { datasetId }
    );
  }

  // 2. Remove all explicit & prefix-matched files in Neon Object Storage / R2 / Local
  const bucketKeys = new Map<string, Set<string>>();
  const ensureBucket = (bucket: string) => {
    if (!bucketKeys.has(bucket)) bucketKeys.set(bucket, new Set());
    return bucketKeys.get(bucket)!;
  };
  ensureBucket(env.S3_BUCKET);

  for (const row of keysRes.rows) {
    const b = row.storage_bucket || env.S3_BUCKET;
    const set = ensureBucket(b);
    if (row.storage_key) set.add(row.storage_key);
    if (row.error_report_storage_key) set.add(row.error_report_storage_key);
  }

  let deletedStorageObjects = 0;
  for (const [bucket, keySet] of bucketKeys.entries()) {
    deletedStorageObjects += await deleteStorageKeys(bucket, Array.from(keySet));
    deletedStorageObjects += await deleteStoragePrefix(bucket, `uploads/${datasetId}/`);
    deletedStorageObjects += await deleteStoragePrefix(bucket, `error-reports/${datasetId}/`);
  }

  // 3. Remove from Neon Postgres / SQLite (cascades jobs, logs, reports, alerts, notes)
  await appQuery("DELETE FROM datasets WHERE id = $1", [datasetId]);

  // Remove deleted datasetId from user default_dataset_ids preferences if pinned
  const prefRows = await appQuery<{ user_id: string; default_dataset_ids: unknown }>(
    "SELECT user_id, default_dataset_ids FROM user_preferences"
  );
  for (const pref of prefRows.rows) {
    const ids = parseJsonField<string[]>(pref.default_dataset_ids, []);
    if (Array.isArray(ids) && ids.includes(datasetId)) {
      const next = ids.filter((id) => id !== datasetId);
      await appQuery(
        "UPDATE user_preferences SET default_dataset_ids = $2 WHERE user_id = $1",
        [pref.user_id, JSON.stringify(next)]
      );
    }
  }

  // 4. Purge caches and update database planner/index statistics
  const { cachePurged, reindexedTables } = await purgeAppCachesAndReindex();

  await writeAuditLog({
    actorUserId: actor.userId,
    actorEmail: actor.email,
    action: "DATASET_DELETED",
    resourceType: "datasets",
    resourceId: datasetId,
    details: {
      name: dataset.name,
      deletedStorageObjects,
      cachePurged,
      reindexedTables,
    },
  });

  return {
    deletedDatasetId: datasetId,
    datasetName: dataset.name,
    deletedStorageObjects,
    cachePurged,
    reindexedTables,
  };
}

/**
 * Reads live consumed vs available capacity across Object Storage, Postgres, and Analytics DB.
 */
export async function getStorageSummary(): Promise<StorageSummaryPayload> {
  const env = getEnv();

  const [objects, datasetRows, pgSizeBytes, analyticsStats] = await Promise.all([
    listStorageObjects(env.S3_BUCKET).catch(() => []),
    appQuery<{
      id: string;
      name: string;
      status: string;
      valid_rows: number | string;
      created_at: string;
      file_name: string | null;
      file_size_bytes: number | string | null;
    }>(
      `
      SELECT d.id, d.name, d.status, d.valid_rows, d.created_at,
             (SELECT j.file_name FROM upload_jobs j WHERE j.dataset_id = d.id ORDER BY j.created_at DESC LIMIT 1) AS file_name,
             (SELECT SUM(j.file_size_bytes) FROM upload_jobs j WHERE j.dataset_id = d.id) AS file_size_bytes
      FROM datasets d
      ORDER BY d.created_at DESC
      LIMIT 200
      `
    ),
    (async (): Promise<number> => {
      if (isSqliteMode()) {
        const resolved = path.resolve(process.cwd(), env.SQLITE_PATH);
        return fs.existsSync(resolved) ? fs.statSync(resolved).size : 0;
      }
      const res = await appQuery<{ size_bytes: string | number }>(
        "SELECT pg_database_size(current_database())::bigint AS size_bytes"
      );
      return Number(res.rows[0]?.size_bytes ?? 0);
    })().catch(() => 0),
    (async (): Promise<{ bytes: number; rows: number }> => {
      if (env.ANALYTICS_ENGINE === "tinybird") {
        const s = await getTinybirdStorageStats();
        return { bytes: s.totalBytes, rows: s.totalRows };
      }
      if (env.ANALYTICS_ENGINE === "duckdb") {
        const resolved = path.resolve(process.cwd(), env.DUCKDB_PATH);
        const bytes = fs.existsSync(resolved) ? fs.statSync(resolved).size : 0;
        const countRows = await queryAnalytics<{ cnt: number | string }>(
          "SELECT COUNT(*) AS cnt FROM sms_records"
        ).catch(() => []);
        return { bytes, rows: Number(countRows[0]?.cnt ?? 0) };
      }
      const chRows = await queryAnalytics<{ bytes: number | string; rows: number | string }>(
        "SELECT coalesce(sum(bytes_on_disk), 0) AS bytes, coalesce(sum(rows), 0) AS rows FROM system.parts WHERE active = 1 AND database = currentDatabase()"
      ).catch(() => []);
      return {
        bytes: Number(chRows[0]?.bytes ?? 0),
        rows: Number(chRows[0]?.rows ?? 0),
      };
    })().catch(() => ({ bytes: 0, rows: 0 })),
  ]);

  const datasetIdsSet = new Set(datasetRows.rows.map((d) => d.id.toLowerCase()));
  const bytesByDataset = new Map<string, { bytes: number; count: number }>();
  let totalObjectBytes = 0;
  let orphanCount = 0;
  let orphanBytes = 0;

  for (const obj of objects) {
    totalObjectBytes += obj.sizeBytes;
    const match = DATASET_KEY_PREFIX_REGEX.exec(obj.key);
    const ownerId = match?.[1]?.toLowerCase();
    if (ownerId && datasetIdsSet.has(ownerId)) {
      const prev = bytesByDataset.get(ownerId) ?? { bytes: 0, count: 0 };
      prev.bytes += obj.sizeBytes;
      prev.count += 1;
      bytesByDataset.set(ownerId, prev);
    } else {
      orphanCount += 1;
      orphanBytes += obj.sizeBytes;
    }
  }

  const objQuotaBytes =
    env.STORAGE_PROVIDER === "neon"
      ? 5 * GIB
      : env.STORAGE_PROVIDER === "r2"
      ? 10 * GIB
      : null;

  const pgQuotaBytes = isSqliteMode() ? null : 1 * GIB;
  const analyticsQuotaBytes =
    env.ANALYTICS_ENGINE === "tinybird" ? 10 * GIB : null;

  return {
    objectStorage: {
      provider: env.STORAGE_PROVIDER,
      bucket: env.S3_BUCKET,
      consumedBytes: totalObjectBytes,
      quotaBytes: objQuotaBytes,
      availableBytes:
        objQuotaBytes !== null ? Math.max(0, objQuotaBytes - totalObjectBytes) : null,
      objectCount: objects.length,
    },
    appDatabase: {
      engine: isSqliteMode() ? "sqlite" : "postgres",
      consumedBytes: pgSizeBytes,
      quotaBytes: pgQuotaBytes,
      availableBytes:
        pgQuotaBytes !== null ? Math.max(0, pgQuotaBytes - pgSizeBytes) : null,
    },
    analyticsDatabase: {
      engine: env.ANALYTICS_ENGINE,
      consumedBytes: analyticsStats.bytes,
      totalRows: analyticsStats.rows,
      quotaBytes: analyticsQuotaBytes,
      availableBytes:
        analyticsQuotaBytes !== null
          ? Math.max(0, analyticsQuotaBytes - analyticsStats.bytes)
          : null,
    },
    orphanObjects: {
      count: orphanCount,
      totalBytes: orphanBytes,
    },
    datasets: datasetRows.rows.map((d) => {
      const live = bytesByDataset.get(d.id.toLowerCase());
      return {
        id: d.id,
        name: d.name,
        status: d.status,
        fileName: d.file_name ?? "—",
        reportedFileSizeBytes: Number(d.file_size_bytes ?? 0),
        storageBytes: live?.bytes ?? 0,
        storageObjectCount: live?.count ?? 0,
        validRows: Number(d.valid_rows ?? 0),
        createdAt: d.created_at,
      };
    }),
  };
}

/**
 * Deletes orphaned bucket objects whose dataset IDs no longer exist and clears stale interrupted uploads.
 */
export async function cleanOrphanedStorageAndJobs(actor: {
  userId: string;
  email: string;
}): Promise<{
  deletedObjects: number;
  deletedStaleDatasets: number;
  freedBytes: number;
}> {
  const env = getEnv();
  const [objects, dsRows] = await Promise.all([
    listStorageObjects(env.S3_BUCKET),
    appQuery<{ id: string }>("SELECT id FROM datasets"),
  ]);

  const validIds = new Set(dsRows.rows.map((d) => d.id.toLowerCase()));
  const orphanKeys: string[] = [];
  let freedBytes = 0;

  for (const obj of objects) {
    const match = DATASET_KEY_PREFIX_REGEX.exec(obj.key);
    const ownerId = match?.[1]?.toLowerCase();
    if (!ownerId || !validIds.has(ownerId)) {
      orphanKeys.push(obj.key);
      freedBytes += obj.sizeBytes;
    }
  }

  const deletedObjects = await deleteStorageKeys(env.S3_BUCKET, orphanKeys);

  // Also purge orphaned UPLOADING records older than 2 hours that never started processing
  const cutoffIso = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const staleRes = await appQuery<{ id: string }>(
    `
    SELECT d.id
    FROM datasets d
    WHERE d.status = 'UPLOADING'
      AND d.created_at < $1
      AND NOT EXISTS (
        SELECT 1 FROM upload_jobs j
        WHERE j.dataset_id = d.id AND j.queue_status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'PARTIAL')
      )
    `,
    [cutoffIso]
  );

  for (const row of staleRes.rows) {
    await deleteStoragePrefix(env.S3_BUCKET, `uploads/${row.id}/`).catch(() => 0);
    await appQuery("DELETE FROM datasets WHERE id = $1", [row.id]);
  }

  await purgeAppCachesAndReindex();

  await writeAuditLog({
    actorUserId: actor.userId,
    actorEmail: actor.email,
    action: "ORPHAN_STORAGE_CLEANED",
    resourceType: "storage",
    resourceId: env.S3_BUCKET,
    details: {
      deletedObjects,
      deletedStaleDatasets: staleRes.rows.length,
      freedBytes,
    },
  });

  return {
    deletedObjects,
    deletedStaleDatasets: staleRes.rows.length,
    freedBytes,
  };
}
