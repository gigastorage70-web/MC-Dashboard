import type { ClickHouseClient } from "@clickhouse/client";
import { getEnv } from "../../../src/lib/config/env";
import {
  createTinybirdIngestionAdapter,
  streamCsvUploadJob,
  type AnalyticsIngestionAdapter,
  type UploadJobRow,
} from "../../../src/modules/csv-ingestion/stream-processor";
import { duckDbManager } from "../duckdb-manager";

export type { UploadJobRow };

function createWorkerAdapter(ch: ClickHouseClient | null): AnalyticsIngestionAdapter {
  const env = getEnv();
  if (env.ANALYTICS_ENGINE === "tinybird") {
    return createTinybirdIngestionAdapter();
  }

  if (env.ANALYTICS_ENGINE === "duckdb") {
    return {
      getCommittedBatches: (uploadId) => duckDbManager.getCommittedBatches(uploadId),
      flushBatch: ({ uploadId, datasetId, batchId, records }) =>
        duckDbManager.appendBatch(uploadId, datasetId, batchId, records),
      finalizeJob: (uploadId) => duckDbManager.populateHourlyRollup(uploadId),
    };
  }

  return {
    async getCommittedBatches(uploadId: string): Promise<Set<number>> {
      if (!ch) return new Set();
      const res = await ch.query({
        query:
          "SELECT batch_id FROM mc_analytics.ingestion_batches WHERE upload_id = {uploadId:String}",
        query_params: { uploadId },
        format: "JSONEachRow",
      });
      const rows = await res.json<{ batch_id: number }>();
      return new Set(rows.map((b) => Number(b.batch_id)));
    },
    async flushBatch({ uploadId, datasetId, batchId, records }) {
      if (!ch) throw new Error("ClickHouse client not initialized");
      await ch.insert({
        table: "mc_analytics.sms_records",
        values: records,
        format: "JSONEachRow",
      });
      await ch.insert({
        table: "mc_analytics.ingestion_batches",
        values: [
          {
            upload_id: uploadId,
            dataset_id: datasetId,
            batch_id: batchId,
            row_count: records.length,
          },
        ],
        format: "JSONEachRow",
      });
    },
  };
}

/**
 * Worker entry point delegating streaming ingestion to the shared stream processor.
 */
export async function processCsvUploadJob(params: {
  ch: ClickHouseClient | null;
  job: UploadJobRow;
  batchSize: number;
}): Promise<void> {
  const adapter = createWorkerAdapter(params.ch);
  await streamCsvUploadJob({
    adapter,
    job: params.job,
    batchSize: params.batchSize,
  });
}
