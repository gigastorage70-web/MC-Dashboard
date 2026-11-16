import { describe, expect, it } from "vitest";
import { resolveCanonicalCountry } from "../../src/modules/csv-ingestion/country-mcc";
import {
  buildFieldIndexMap,
  normalizeCsvRow,
  parseMediaCoreTimestamp,
} from "../../src/modules/csv-ingestion/normalizer";
import { inspectCsvSample } from "../../src/modules/schema-mapping/constants";

describe("Dynamic CSV Schema Inspection & Mapping", () => {
  it("detects semicolon delimiter, extracts preview rows, and proposes MediaCore mappings", () => {
    const sample = [
      "OP Name;TP Name;Send Time;Country;OP ANI;TP ANI;Status;State;Dialpeer;OP MCC;TP MCC",
      "Route Trade;A2P Ltd;2026-11-13 00:00:00.175370;Iran Mobile Communications Company of Iran (TCI);Ourbit;Ourbit;69;;A-Z Route;432;432",
      "OP Name;TP Name;Send Time;Country;OP ANI;TP ANI;Status;State;Dialpeer;OP MCC;TP MCC",
      "Route Trade;Boldtel;2026-11-13 00:00:02.236069;Iran;Ourbit;Ourbit;11;;A-Z Route;432;432",
    ].join("\n");

    const res = inspectCsvSample(sample);
    expect(res.detectedDelimiter).toBe(";");
    expect(res.headers.length).toBe(11);
    expect(res.previewRows.length).toBe(2); // repeated header row skipped in preview
    expect(res.proposedMapping["OP Name"]).toBe("OP_NAME");
    expect(res.proposedMapping["Send Time"]).toBe("MESSAGE_TIMESTAMP");
    expect(res.proposedMapping["Dialpeer"]).toBe("ROUTE");
    expect(res.missingRequiredFields).toEqual([]);
  });
});

describe("Timestamp, Country MCC & Row Normalization", () => {
  it("parses microsecond MediaCore timestamps accurately", () => {
    const parsed = parseMediaCoreTimestamp("2026-11-13 00:00:39.719330");
    expect(parsed).not.toBeNull();
    expect(parsed?.chFormatted).toBe("2026-11-13 00:00:39.719330");
    expect(parseMediaCoreTimestamp("Send Time")).toBeNull();
  });

  it("resolves canonical country via MCC without losing Unmapped discipline", () => {
    expect(resolveCanonicalCountry("Cote Divoire mobile Orange CI", "612", "612")).toBe(
      "Cote d'Ivoire"
    );
    expect(resolveCanonicalCountry("Iran Mobile (TCI)", "432", "432")).toBe("Iran");
    expect(resolveCanonicalCountry("", "", "")).toBe("Unmapped");
  });

  it("skips repeated embedded headers and normalizes valid MediaCore rows", () => {
    const headers = [
      "OP Name",
      "TP Name",
      "Send Time",
      "Country",
      "Status",
      "State",
      "DLR time",
    ];
    const { byField, extraCols } = buildFieldIndexMap(headers, {
      "OP Name": "OP_NAME",
      "TP Name": "TP_NAME",
      "Send Time": "MESSAGE_TIMESTAMP",
      Country: "COUNTRY",
      Status: "SUBMIT_STATUS",
      State: "DLR_STATE",
      "DLR time": "DLR_TIMESTAMP",
    });

    const headerOutcome = normalizeCsvRow({
      row: headers,
      rowNumber: 1,
      headers,
      fieldIndex: byField,
      extraCols,
      datasetId: "ds-1",
      uploadId: "up-1",
      batchId: 1,
      statusRules: [],
    });
    expect(headerOutcome.kind).toBe("skipped_header");

    const validOutcome = normalizeCsvRow({
      row: [
        "Route Trade",
        "A2P Ltd",
        "2026-11-13 00:00:39.719330",
        "Sierra Leone mobile Airtel",
        "",
        "DELIVRD",
        "2026-11-13 00:00:43.545301",
      ],
      rowNumber: 2,
      headers,
      fieldIndex: byField,
      extraCols,
      datasetId: "ds-1",
      uploadId: "up-1",
      batchId: 1,
      statusRules: [],
    });

    expect(validOutcome.kind).toBe("valid");
    expect(validOutcome.record?.normalized_status).toBe("SUCCESS");
    expect(validOutcome.record?.dlr_latency_ms).toBe(3826);
    expect(validOutcome.record?.row_hash.length).toBe(32);
  });
});
