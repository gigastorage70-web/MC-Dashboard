import { getAnalyticsEngine, type AnalyticsEngine } from "../../lib/database/analytics-db";
import type { GlobalFilterSpec } from "./filter-schema";

export interface AnalyticsWhereResult {
  engine: AnalyticsEngine;
  whereSql: string;
  queryParams: Record<string, unknown>;
  useRawTable: boolean;
  timeColumn: "event_timestamp" | "bucket_hour";
}

function toUtcTimestampString(iso: string): string {
  const d = new Date(iso);
  const s = d.toISOString();
  return `${s.slice(0, 10)} ${s.slice(11, 19)}`;
}

/**
 * Determines whether a filter requires raw `sms_records` rather than `sms_hourly_rollup`.
 */
export function requiresRawRecordsTable(filter: GlobalFilterSpec): boolean {
  return (
    filter.opAnis.length > 0 ||
    filter.tpAnis.length > 0 ||
    filter.directions.length > 0 ||
    Boolean(filter.searchQuery && filter.searchQuery.trim().length > 0)
  );
}

/**
 * Builds strictly parameterized WHERE clauses for both DuckDB ($param) and ClickHouse ({param:Type}).
 */
export function buildAnalyticsWhere(
  filter: GlobalFilterSpec,
  options?: {
    forceRawTable?: boolean;
    excludeDimension?: keyof GlobalFilterSpec;
    engine?: AnalyticsEngine;
  }
): AnalyticsWhereResult {
  const engine = options?.engine ?? getAnalyticsEngine();
  const isDuck = engine === "duckdb";
  const useRawTable =
    Boolean(options?.forceRawTable) || requiresRawRecordsTable(filter);
  const timeColumn = useRawTable ? "event_timestamp" : "bucket_hour";
  const exclude = options?.excludeDimension;

  const clauses: string[] = ["1 = 1"];
  const queryParams: Record<string, unknown> = {};

  if (filter.datasetIds.length > 0 && exclude !== "datasetIds") {
    clauses.push(
      isDuck
        ? "list_contains($datasetIds, dataset_id)"
        : "dataset_id IN {datasetIds:Array(UUID)}"
    );
    queryParams.datasetIds = filter.datasetIds;
  }

  if (filter.dateFrom && exclude !== "dateFrom") {
    clauses.push(
      isDuck
        ? `${timeColumn} >= CAST($dateFrom AS TIMESTAMP)`
        : `${timeColumn} >= toDateTime({dateFrom:String}, 'UTC')`
    );
    queryParams.dateFrom = toUtcTimestampString(filter.dateFrom);
  }

  if (filter.dateTo && exclude !== "dateTo") {
    clauses.push(
      isDuck
        ? `${timeColumn} <= CAST($dateTo AS TIMESTAMP)`
        : `${timeColumn} <= toDateTime({dateTo:String}, 'UTC')`
    );
    queryParams.dateTo = toUtcTimestampString(filter.dateTo);
  }

  const arrayCols: Array<{
    key: keyof GlobalFilterSpec;
    col: string;
    param: string;
  }> = [
    { key: "opNames", col: "op_name", param: "opNames" },
    { key: "tpNames", col: "tp_name", param: "tpNames" },
    { key: "countries", col: "country", param: "countries" },
    { key: "states", col: "state_region", param: "states" },
    { key: "rawStatuses", col: "raw_status", param: "rawStatuses" },
    { key: "normalizedStatuses", col: "normalized_status", param: "normalizedStatuses" },
    { key: "reasons", col: "reason_normalized", param: "reasons" },
    { key: "applicants", col: "applicant", param: "applicants" },
    { key: "routes", col: "route", param: "routes" },
  ];

  for (const item of arrayCols) {
    if (exclude === item.key) continue;
    const arr = filter[item.key] as string[];
    if (Array.isArray(arr) && arr.length > 0) {
      clauses.push(
        isDuck
          ? `list_contains($${item.param}, ${item.col})`
          : `${item.col} IN {${item.param}:Array(String)}`
      );
      queryParams[item.param] = arr;
    }
  }

  if (useRawTable) {
    if (filter.opAnis.length > 0 && exclude !== "opAnis") {
      clauses.push(
        isDuck
          ? "list_contains($opAnis, op_ani)"
          : "op_ani IN {opAnis:Array(String)}"
      );
      queryParams.opAnis = filter.opAnis;
    }
    if (filter.tpAnis.length > 0 && exclude !== "tpAnis") {
      clauses.push(
        isDuck
          ? "list_contains($tpAnis, tp_ani)"
          : "tp_ani IN {tpAnis:Array(String)}"
      );
      queryParams.tpAnis = filter.tpAnis;
    }
    if (filter.directions.length > 0 && exclude !== "directions") {
      clauses.push(
        isDuck
          ? "list_contains($directions, direction)"
          : "direction IN {directions:Array(String)}"
      );
      queryParams.directions = filter.directions;
    }
    if (
      filter.searchQuery &&
      filter.searchQuery.trim().length > 0 &&
      exclude !== "searchQuery"
    ) {
      clauses.push(
        isDuck
          ? "(STRPOS(LOWER(op_ani), LOWER($searchQ)) > 0 OR STRPOS(LOWER(tp_ani), LOWER($searchQ)) > 0 OR STRPOS(LOWER(destination_number), LOWER($searchQ)) > 0 OR STRPOS(LOWER(message_id), LOWER($searchQ)) > 0 OR STRPOS(LOWER(reason), LOWER($searchQ)) > 0)"
          : "(positionCaseInsensitive(op_ani, {searchQ:String}) > 0 OR positionCaseInsensitive(tp_ani, {searchQ:String}) > 0 OR positionCaseInsensitive(destination_number, {searchQ:String}) > 0 OR positionCaseInsensitive(message_id, {searchQ:String}) > 0 OR positionCaseInsensitive(reason, {searchQ:String}) > 0)"
      );
      queryParams.searchQ = filter.searchQuery.trim();
    }
  }

  return {
    engine,
    whereSql: clauses.join(" AND "),
    queryParams,
    useRawTable,
    timeColumn,
  };
}

// Keep backward-compatible alias
export const buildClickHouseWhere = buildAnalyticsWhere;
