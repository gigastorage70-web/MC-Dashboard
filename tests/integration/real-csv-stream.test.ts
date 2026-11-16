import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse";
import { describe, expect, it } from "vitest";
import { computeQoSKpis } from "../../src/lib/metrics/definitions";
import {
  buildFieldIndexMap,
  normalizeCsvRow,
} from "../../src/modules/csv-ingestion/normalizer";
import { inspectCsvSample } from "../../src/modules/schema-mapping/constants";

const SAMPLE_CSV_PATH = path.resolve(process.cwd(), "xdr_all_tps.csv");

describe("Real 157.9MB MediaCore CSV Streaming Verification", () => {
  const hasRealFile = fs.existsSync(SAMPLE_CSV_PATH);

  it.skipIf(!hasRealFile)(
    "streams all 539k+ rows with bounded memory and exact KPI accuracy",
    async () => {
      // 1. Pre-flight: read ONLY first 64 KB
      const fd = fs.openSync(SAMPLE_CSV_PATH, "r");
      const probeBuf = Buffer.alloc(65_536);
      const bytesRead = fs.readSync(fd, probeBuf, 0, 65_536, 0);
      fs.closeSync(fd);

      const inspection = inspectCsvSample(
        probeBuf.subarray(0, bytesRead).toString("utf8")
      );
      expect(inspection.detectedDelimiter).toBe(";");
      expect(inspection.headers.length).toBe(27);
      expect(inspection.missingRequiredFields).toEqual([]);

      // 2. Full bounded-memory stream over entire 157.9 MB file
      const parser = fs.createReadStream(SAMPLE_CSV_PATH).pipe(
        parse({
          delimiter: inspection.detectedDelimiter,
          bom: true,
          relax_quotes: true,
          relax_column_count: true,
          skip_empty_lines: true,
        })
      );

      let headers: string[] = [];
      let fieldIndex: ReturnType<typeof buildFieldIndexMap>["byField"] = {};
      let extraCols: ReturnType<typeof buildFieldIndexMap>["extraCols"] = [];

      let validRows = 0;
      let skippedHeaders = 0;
      let invalidRows = 0;
      const counts = {
        totalMessages: 0,
        successMessages: 0,
        failedMessages: 0,
        rejectedMessages: 0,
        pendingMessages: 0,
        unknownMessages: 0,
        otherMessages: 0,
      };
      let peakHeapMb = 0;

      for await (const rawRow of parser as AsyncIterable<string[]>) {
        if (headers.length === 0) {
          headers = rawRow.map((h) => h.trim());
          const built = buildFieldIndexMap(headers, inspection.proposedMapping);
          fieldIndex = built.byField;
          extraCols = built.extraCols;
          continue;
        }

        const outcome = normalizeCsvRow({
          row: rawRow,
          rowNumber: validRows + skippedHeaders + invalidRows + 1,
          headers,
          fieldIndex,
          extraCols,
          datasetId: "00000000-0000-0000-0000-000000000001",
          uploadId: "00000000-0000-0000-0000-000000000002",
          batchId: 1,
          statusRules: [],
        });

        if (outcome.kind === "skipped_header") {
          skippedHeaders += 1;
          continue;
        }
        if (outcome.kind === "invalid" || !outcome.record) {
          invalidRows += 1;
          continue;
        }

        validRows += 1;
        counts.totalMessages += 1;
        switch (outcome.record.normalized_status) {
          case "SUCCESS":
            counts.successMessages += 1;
            break;
          case "FAILED":
            counts.failedMessages += 1;
            break;
          case "REJECTED":
            counts.rejectedMessages += 1;
            break;
          case "PENDING":
            counts.pendingMessages += 1;
            break;
          case "UNKNOWN":
            counts.unknownMessages += 1;
            break;
          default:
            counts.otherMessages += 1;
        }

        if (validRows % 50_000 === 0) {
          const heapMb = process.memoryUsage().heapUsed / (1024 * 1024);
          if (heapMb > peakHeapMb) peakHeapMb = heapMb;
        }
      }

      const kpis = computeQoSKpis(counts);

      // Assert exact ground-truth parity against real MediaCore export audit
      expect(skippedHeaders).toBe(23);
      expect(invalidRows).toBe(0);
      expect(validRows).toBe(539_048);
      expect(counts.successMessages).toBe(209_559); // DELIVRD
      expect(counts.failedMessages).toBe(152); // UNDELIV (143) + EXPIRED (9)
      expect(counts.rejectedMessages).toBe(329_184); // SMPP 69/11/88 (329,129) + REJECTD (55)
      expect(counts.pendingMessages).toBe(139); // ENROUTE
      expect(counts.unknownMessages).toBe(14); // blank Status + blank State
      expect(kpis.terminalMessages).toBe(538_895);
      expect(kpis.unsuccessfulCombinedMessages).toBe(329_336);
      // Peak JS heap stays strictly bounded far below the 158MB file size
      expect(peakHeapMb).toBeLessThan(150);
    },
    60_000
  );
});
