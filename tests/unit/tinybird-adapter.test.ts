import { describe, expect, it } from "vitest";
import { getAnalyticsTableName } from "../../src/lib/database/analytics-db";
import { bindTinybirdSqlParams } from "../../src/lib/database/tinybird";
import { DEFAULT_GLOBAL_FILTER } from "../../src/modules/analytics/filter-schema";
import { buildAnalyticsWhere } from "../../src/modules/analytics/query-builder";
import type { ClickHouseSmsRecord } from "../../src/modules/csv-ingestion/normalizer";
import { buildHourlyRollupRows } from "../../src/modules/csv-ingestion/rollup";

describe("Tinybird SQL parameter binding & rollup adapter", () => {
  it("hex-encodes String and Array(String) values safely without SQLi or comma splitting", () => {
    const sql =
      "SELECT * FROM sms_records WHERE op_name IN {opNames:Array(String)} AND reason = {searchQ:String} LIMIT {limit:UInt32}";
    const bound = bindTinybirdSqlParams(sql, {
      opNames: ["AT&T, Inc.", "Route 'A'"],
      searchQ: "'; DROP TABLE sms_records; -- {{}}",
      limit: 50,
    });

    expect(bound).toContain("JSONExtract(unhex('");
    expect(bound).toContain("'), 'Array(String)')");
    expect(bound).toContain("unhex('");
    expect(bound).toContain("LIMIT 50");
    expect(bound).not.toContain("DROP TABLE");
    expect(bound).not.toContain("AT&T, Inc.");
  });

  it("handles empty arrays, UUID arrays, and rejects invalid inputs", () => {
    const validUuid = "11111111-2222-3333-4444-555555555555";
    const bound = bindTinybirdSqlParams(
      "SELECT * FROM sms_hourly_rollup WHERE dataset_id IN {datasetIds:Array(UUID)} AND country IN {countries:Array(String)}",
      { datasetIds: [validUuid], countries: [] }
    );
    expect(bound).toContain(`CAST(['${validUuid}'] AS Array(UUID))`);
    expect(bound).toContain("CAST([] AS Array(String))");

    expect(() =>
      bindTinybirdSqlParams("SELECT * WHERE dataset_id = {id:UUID}", {
        id: "not-a-uuid",
      })
    ).toThrow(/Invalid UUID/);

    expect(() =>
      bindTinybirdSqlParams("SELECT * LIMIT {limit:UInt32}", { limit: -5 })
    ).toThrow(/Negative value/);
  });

  it("uses bare datasource names for tinybird and prefixed names for clickhouse", () => {
    expect(getAnalyticsTableName("tinybird", "sms_hourly_rollup")).toBe(
      "sms_hourly_rollup"
    );
    expect(getAnalyticsTableName("clickhouse", "sms_hourly_rollup")).toBe(
      "mc_analytics.sms_hourly_rollup"
    );

    const where = buildAnalyticsWhere(
      { ...DEFAULT_GLOBAL_FILTER, countries: ["Iran"], opAnis: ["Facebook"] },
      { engine: "tinybird" }
    );
    expect(where.whereSql).toContain("country IN {countries:Array(String)}");
    expect(where.whereSql).toContain("op_ani IN {opAnis:Array(String)}");
  });

  it("aggregates hourly rollups without double-counting statuses", () => {
    const base: ClickHouseSmsRecord = {
      dataset_id: "11111111-2222-3333-4444-555555555555",
      upload_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      batch_id: 1,
      message_row_id: 1,
      row_hash: "0".repeat(32),
      event_timestamp: "2026-11-13 08:15:30.123456",
      dlr_timestamp: "2026-11-13 08:15:35.123456",
      dlr_latency_ms: 5000,
      op_name: "OP-1",
      tp_name: "TP-1",
      applicant: "Unassigned",
      direction: "OUTBOUND",
      route: "Direct",
      op_ani: "Facebook",
      tp_ani: "Facebook",
      destination_number: "989120000001",
      called_number_out: "989120000001",
      message_id: "m1",
      transaction_id: "m1",
      country: "Iran",
      state_region: "",
      raw_country_network: "",
      op_mcc: "432",
      op_mnc: "11",
      tp_mcc: "432",
      tp_mnc: "11",
      raw_submit_status: "",
      raw_dlr_state: "DELIVRD",
      raw_status: "DELIVRD",
      normalized_status: "SUCCESS",
      is_terminal: 1,
      reason: "",
      reason_normalized: "Unspecified",
      op_host: "",
      tp_host: "",
      nas_ip: "",
      op_price: "0.015",
      tp_price: "0.01",
      cost_in: "0.015",
      cost_out: "0.01",
      op_currency: "USD",
      tp_currency: "USD",
      extra_attributes: "{}",
    };

    const rollup = buildHourlyRollupRows([
      base,
      { ...base, message_row_id: 2, dlr_latency_ms: 3000, cost_in: "0.005", cost_out: "0.002" },
      {
        ...base,
        message_row_id: 3,
        raw_submit_status: "69",
        raw_dlr_state: "",
        raw_status: "SMPP:69",
        normalized_status: "REJECTED",
        dlr_latency_ms: null,
        cost_in: null,
        cost_out: null,
      },
    ]);

    expect(rollup).toHaveLength(2);
    const deliv = rollup.find((r) => r.normalized_status === "SUCCESS")!;
    expect(deliv.bucket_hour).toBe("2026-11-13 08:00:00");
    expect(deliv.total_count).toBe(2);
    expect(deliv.success_count).toBe(2);
    expect(deliv.failed_count).toBe(0);
    expect(deliv.rejected_count).toBe(0);
    expect(deliv.dlr_latency_ms_sum).toBe(8000);
    expect(deliv.dlr_latency_count).toBe(2);
    expect(deliv.cost_in_sum).toBe(0.02);

    const rej = rollup.find((r) => r.normalized_status === "REJECTED")!;
    expect(rej.rejected_count).toBe(1);
    expect(rej.terminal_count).toBe(1);
  });
});
