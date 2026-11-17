import {
  getAnalyticsTableName,
  isDuckDbEngine,
  queryAnalytics,
} from "@/lib/database/analytics-db";
import {
  computeFailureContributionPct,
  computeQoSKpis,
  computeTrafficSharePct,
  type ComputedQoSKpis,
} from "@/lib/metrics/definitions";
import type { GlobalFilterSpec } from "./filter-schema";
import { buildAnalyticsWhere } from "./query-builder";

export interface GlobalKpiSummary extends ComputedQoSKpis {
  uniqueOps: number;
  uniqueTps: number;
  uniqueCountries: number;
  uniqueApplicants: number;
  avgDlrLatencyMs: number | null;
  totalCostIn: number;
  totalCostOut: number;
}

export interface DimensionBreakdownRow extends ComputedQoSKpis {
  dimensionValue: string;
  trafficSharePct: number | null;
  failureContributionPct: number | null;
  avgDlrLatencyMs: number | null;
  topReason: string | null;
}

export interface TimeSeriesPoint extends ComputedQoSKpis {
  bucket: string;
}

export interface AniBreakdownRow extends ComputedQoSKpis {
  ani: string;
  associatedOp: string;
  associatedTp: string;
  applicant: string;
  country: string;
  topReason: string | null;
}

export function maskIdentifier(value: string, shouldMask: boolean): string {
  if (!shouldMask || !value) return value;
  const trimmed = value.trim();
  if (trimmed.length <= 4) return "***";
  if (/^\d+$/.test(trimmed)) {
    return `${trimmed.slice(0, 4)}***${trimmed.slice(-3)}`;
  }
  return trimmed;
}

export async function queryGlobalKpis(
  filter: GlobalFilterSpec
): Promise<GlobalKpiSummary> {
  const { engine, whereSql, queryParams, useRawTable } = buildAnalyticsWhere(filter);
  const table = getAnalyticsTableName(
    engine,
    useRawTable ? "sms_records" : "sms_hourly_rollup"
  );

  const sql = useRawTable
    ? `
      SELECT
        COUNT(*) AS totalMessages,
        SUM(CASE WHEN normalized_status = 'SUCCESS' THEN 1 ELSE 0 END) AS successMessages,
        SUM(CASE WHEN normalized_status = 'FAILED' THEN 1 ELSE 0 END) AS failedMessages,
        SUM(CASE WHEN normalized_status = 'REJECTED' THEN 1 ELSE 0 END) AS rejectedMessages,
        SUM(CASE WHEN normalized_status = 'PENDING' THEN 1 ELSE 0 END) AS pendingMessages,
        SUM(CASE WHEN normalized_status = 'UNKNOWN' THEN 1 ELSE 0 END) AS unknownMessages,
        SUM(CASE WHEN normalized_status = 'OTHER' THEN 1 ELSE 0 END) AS otherMessages,
        COUNT(DISTINCT CASE WHEN op_name NOT IN ('', 'Unassigned') THEN op_name ELSE NULL END) AS uniqueOps,
        COUNT(DISTINCT CASE WHEN tp_name NOT IN ('', 'Unassigned') THEN tp_name ELSE NULL END) AS uniqueTps,
        COUNT(DISTINCT CASE WHEN country NOT IN ('', 'Unmapped') THEN country ELSE NULL END) AS uniqueCountries,
        COUNT(DISTINCT CASE WHEN applicant NOT IN ('', 'Unassigned') THEN applicant ELSE NULL END) AS uniqueApplicants,
        AVG(CASE WHEN dlr_latency_ms IS NOT NULL THEN dlr_latency_ms ELSE NULL END) AS avgDlrLatencyMs,
        SUM(COALESCE(cost_in, 0)) AS totalCostIn,
        SUM(COALESCE(cost_out, 0)) AS totalCostOut
      FROM ${table}
      WHERE ${whereSql}
    `
    : `
      SELECT
        COALESCE(SUM(total_count), 0) AS totalMessages,
        COALESCE(SUM(success_count), 0) AS successMessages,
        COALESCE(SUM(failed_count), 0) AS failedMessages,
        COALESCE(SUM(rejected_count), 0) AS rejectedMessages,
        COALESCE(SUM(pending_count), 0) AS pendingMessages,
        COALESCE(SUM(unknown_count), 0) AS unknownMessages,
        COALESCE(SUM(other_count), 0) AS otherMessages,
        COUNT(DISTINCT CASE WHEN op_name NOT IN ('', 'Unassigned') THEN op_name ELSE NULL END) AS uniqueOps,
        COUNT(DISTINCT CASE WHEN tp_name NOT IN ('', 'Unassigned') THEN tp_name ELSE NULL END) AS uniqueTps,
        COUNT(DISTINCT CASE WHEN country NOT IN ('', 'Unmapped') THEN country ELSE NULL END) AS uniqueCountries,
        COUNT(DISTINCT CASE WHEN applicant NOT IN ('', 'Unassigned') THEN applicant ELSE NULL END) AS uniqueApplicants,
        CASE WHEN COALESCE(SUM(dlr_latency_count), 0) > 0 THEN SUM(dlr_latency_ms_sum) / SUM(dlr_latency_count) ELSE NULL END AS avgDlrLatencyMs,
        COALESCE(SUM(cost_in_sum), 0) AS totalCostIn,
        COALESCE(SUM(cost_out_sum), 0) AS totalCostOut
      FROM ${table}
      WHERE ${whereSql}
    `;

  const rows = await queryAnalytics<Record<string, unknown>>(sql, queryParams);
  const r = rows[0] ?? {};

  const base = computeQoSKpis({
    totalMessages: Number(r.totalMessages ?? 0),
    successMessages: Number(r.successMessages ?? 0),
    failedMessages: Number(r.failedMessages ?? 0),
    rejectedMessages: Number(r.rejectedMessages ?? 0),
    pendingMessages: Number(r.pendingMessages ?? 0),
    unknownMessages: Number(r.unknownMessages ?? 0),
    otherMessages: Number(r.otherMessages ?? 0),
  });

  return {
    ...base,
    uniqueOps: Number(r.uniqueOps ?? 0),
    uniqueTps: Number(r.uniqueTps ?? 0),
    uniqueCountries: Number(r.uniqueCountries ?? 0),
    uniqueApplicants: Number(r.uniqueApplicants ?? 0),
    avgDlrLatencyMs:
      r.avgDlrLatencyMs !== null &&
      r.avgDlrLatencyMs !== undefined &&
      !Number.isNaN(Number(r.avgDlrLatencyMs))
        ? Math.round(Number(r.avgDlrLatencyMs))
        : null,
    totalCostIn: Number(r.totalCostIn ?? 0),
    totalCostOut: Number(r.totalCostOut ?? 0),
  };
}

export async function queryTimeSeries(
  filter: GlobalFilterSpec,
  granularity: "hour" | "day" = "hour"
): Promise<TimeSeriesPoint[]> {
  const { engine, whereSql, queryParams, useRawTable, timeColumn } =
    buildAnalyticsWhere(filter);
  const table = getAnalyticsTableName(
    engine,
    useRawTable ? "sms_records" : "sms_hourly_rollup"
  );
  const isDuck = isDuckDbEngine(engine);

  const bucketExpr = isDuck
    ? granularity === "day"
      ? `strftime(date_trunc('day', ${timeColumn}), '%Y-%m-%d')`
      : `strftime(date_trunc('hour', ${timeColumn}), '%Y-%m-%d %H:00')`
    : granularity === "day"
    ? `formatDateTime(toStartOfDay(${timeColumn}), '%Y-%m-%d')`
    : `formatDateTime(toStartOfHour(${timeColumn}), '%Y-%m-%d %H:00')`;

  const sql = useRawTable
    ? `
      SELECT
        ${bucketExpr} AS bucket,
        COUNT(*) AS totalMessages,
        SUM(CASE WHEN normalized_status = 'SUCCESS' THEN 1 ELSE 0 END) AS successMessages,
        SUM(CASE WHEN normalized_status = 'FAILED' THEN 1 ELSE 0 END) AS failedMessages,
        SUM(CASE WHEN normalized_status = 'REJECTED' THEN 1 ELSE 0 END) AS rejectedMessages,
        SUM(CASE WHEN normalized_status = 'PENDING' THEN 1 ELSE 0 END) AS pendingMessages,
        SUM(CASE WHEN normalized_status = 'UNKNOWN' THEN 1 ELSE 0 END) AS unknownMessages,
        SUM(CASE WHEN normalized_status = 'OTHER' THEN 1 ELSE 0 END) AS otherMessages
      FROM ${table}
      WHERE ${whereSql}
      GROUP BY bucket
      ORDER BY bucket ASC
      LIMIT 1000
    `
    : `
      SELECT
        ${bucketExpr} AS bucket,
        COALESCE(SUM(total_count), 0) AS totalMessages,
        COALESCE(SUM(success_count), 0) AS successMessages,
        COALESCE(SUM(failed_count), 0) AS failedMessages,
        COALESCE(SUM(rejected_count), 0) AS rejectedMessages,
        COALESCE(SUM(pending_count), 0) AS pendingMessages,
        COALESCE(SUM(unknown_count), 0) AS unknownMessages,
        COALESCE(SUM(other_count), 0) AS otherMessages
      FROM ${table}
      WHERE ${whereSql}
      GROUP BY bucket
      ORDER BY bucket ASC
      LIMIT 1000
    `;

  const rows = await queryAnalytics<Record<string, unknown>>(sql, queryParams);
  return rows.map((r) => ({
    bucket: String(r.bucket ?? ""),
    ...computeQoSKpis({
      totalMessages: Number(r.totalMessages ?? 0),
      successMessages: Number(r.successMessages ?? 0),
      failedMessages: Number(r.failedMessages ?? 0),
      rejectedMessages: Number(r.rejectedMessages ?? 0),
      pendingMessages: Number(r.pendingMessages ?? 0),
      unknownMessages: Number(r.unknownMessages ?? 0),
      otherMessages: Number(r.otherMessages ?? 0),
    }),
  }));
}

const DIMENSION_COLUMN_MAP = {
  op: "op_name",
  tp: "tp_name",
  applicant: "applicant",
  country: "country",
  state: "state_region",
  route: "route",
  raw_status: "raw_status",
  reason: "reason_normalized",
} as const;

export type AnalyticsDimension = keyof typeof DIMENSION_COLUMN_MAP;

export async function queryDimensionBreakdown(
  filter: GlobalFilterSpec,
  dimension: AnalyticsDimension,
  options?: { limit?: number; sortBy?: "volume" | "unsuccessful" | "failure_rate" }
): Promise<{
  global: GlobalKpiSummary;
  rows: DimensionBreakdownRow[];
}> {
  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 200);
  const col = DIMENSION_COLUMN_MAP[dimension];
  const global = await queryGlobalKpis(filter);
  const { engine, whereSql, queryParams, useRawTable } = buildAnalyticsWhere(filter);
  const table = getAnalyticsTableName(
    engine,
    useRawTable ? "sms_records" : "sms_hourly_rollup"
  );
  const isDuck = isDuckDbEngine(engine);

  const topReasonExpr = isDuck
    ? "MODE(reason_normalized) FILTER (WHERE reason_normalized != '')"
    : "anyHeavyIf(reason_normalized, reason_normalized != '')";
  const limitParam = isDuck ? "$limit" : "{limit:UInt32}";

  const orderClause =
    options?.sortBy === "unsuccessful"
      ? "(failedMessages + rejectedMessages) DESC, totalMessages DESC"
      : options?.sortBy === "failure_rate"
      ? "CASE WHEN (successMessages + failedMessages + rejectedMessages) > 0 THEN CAST((failedMessages + rejectedMessages) AS DOUBLE) / (successMessages + failedMessages + rejectedMessages) ELSE 0 END DESC, totalMessages DESC"
      : "totalMessages DESC";

  const sql = useRawTable
    ? `
      SELECT
        ${col} AS dimensionValue,
        COUNT(*) AS totalMessages,
        SUM(CASE WHEN normalized_status = 'SUCCESS' THEN 1 ELSE 0 END) AS successMessages,
        SUM(CASE WHEN normalized_status = 'FAILED' THEN 1 ELSE 0 END) AS failedMessages,
        SUM(CASE WHEN normalized_status = 'REJECTED' THEN 1 ELSE 0 END) AS rejectedMessages,
        SUM(CASE WHEN normalized_status = 'PENDING' THEN 1 ELSE 0 END) AS pendingMessages,
        SUM(CASE WHEN normalized_status = 'UNKNOWN' THEN 1 ELSE 0 END) AS unknownMessages,
        SUM(CASE WHEN normalized_status = 'OTHER' THEN 1 ELSE 0 END) AS otherMessages,
        AVG(CASE WHEN dlr_latency_ms IS NOT NULL THEN dlr_latency_ms ELSE NULL END) AS avgDlrLatencyMs,
        ${topReasonExpr} AS topReason
      FROM ${table}
      WHERE ${whereSql}
      GROUP BY dimensionValue
      ORDER BY ${orderClause}
      LIMIT ${limitParam}
    `
    : `
      SELECT
        ${col} AS dimensionValue,
        COALESCE(SUM(total_count), 0) AS totalMessages,
        COALESCE(SUM(success_count), 0) AS successMessages,
        COALESCE(SUM(failed_count), 0) AS failedMessages,
        COALESCE(SUM(rejected_count), 0) AS rejectedMessages,
        COALESCE(SUM(pending_count), 0) AS pendingMessages,
        COALESCE(SUM(unknown_count), 0) AS unknownMessages,
        COALESCE(SUM(other_count), 0) AS otherMessages,
        CASE WHEN COALESCE(SUM(dlr_latency_count), 0) > 0 THEN SUM(dlr_latency_ms_sum) / SUM(dlr_latency_count) ELSE NULL END AS avgDlrLatencyMs,
        ${topReasonExpr} AS topReason
      FROM ${table}
      WHERE ${whereSql}
      GROUP BY dimensionValue
      ORDER BY ${orderClause}
      LIMIT ${limitParam}
    `;

  const rawRows = await queryAnalytics<Record<string, unknown>>(sql, {
    ...queryParams,
    limit,
  });

  const rows: DimensionBreakdownRow[] = rawRows.map((r) => {
    const kpi = computeQoSKpis({
      totalMessages: Number(r.totalMessages ?? 0),
      successMessages: Number(r.successMessages ?? 0),
      failedMessages: Number(r.failedMessages ?? 0),
      rejectedMessages: Number(r.rejectedMessages ?? 0),
      pendingMessages: Number(r.pendingMessages ?? 0),
      unknownMessages: Number(r.unknownMessages ?? 0),
      otherMessages: Number(r.otherMessages ?? 0),
    });
    return {
      dimensionValue: String(r.dimensionValue ?? "Unmapped") || "Unmapped",
      ...kpi,
      trafficSharePct: computeTrafficSharePct(
        kpi.totalMessages,
        global.totalMessages
      ),
      failureContributionPct: computeFailureContributionPct(
        kpi.unsuccessfulCombinedMessages,
        global.unsuccessfulCombinedMessages
      ),
      avgDlrLatencyMs:
        r.avgDlrLatencyMs !== null &&
        r.avgDlrLatencyMs !== undefined &&
        !Number.isNaN(Number(r.avgDlrLatencyMs))
          ? Math.round(Number(r.avgDlrLatencyMs))
          : null,
      topReason: r.topReason ? String(r.topReason) : null,
    };
  });

  return { global, rows };
}

export async function queryDependentFacets(
  filter: GlobalFilterSpec,
  facet:
    | "opNames"
    | "tpNames"
    | "countries"
    | "states"
    | "rawStatuses"
    | "reasons"
    | "applicants"
    | "routes"
    | "opAnis"
    | "tpAnis",
  search = "",
  limit = 100
): Promise<Array<{ value: string; count: number }>> {
  const colMap: Record<typeof facet, string> = {
    opNames: "op_name",
    tpNames: "tp_name",
    countries: "country",
    states: "state_region",
    rawStatuses: "raw_status",
    reasons: "reason_normalized",
    applicants: "applicant",
    routes: "route",
    opAnis: "op_ani",
    tpAnis: "tp_ani",
  };
  const forceRaw = facet === "opAnis" || facet === "tpAnis";
  const col = colMap[facet];
  const { engine, whereSql, queryParams, useRawTable } = buildAnalyticsWhere(
    filter,
    { forceRawTable: forceRaw, excludeDimension: facet }
  );
  const isDuck = isDuckDbEngine(engine);
  const table = getAnalyticsTableName(
    engine,
    useRawTable ? "sms_records" : "sms_hourly_rollup"
  );
  const countExpr = useRawTable ? "COUNT(*)" : "COALESCE(SUM(total_count), 0)";
  const searchClause = search.trim()
    ? isDuck
      ? `AND STRPOS(LOWER(${col}), LOWER($facetSearch)) > 0`
      : `AND positionCaseInsensitive(${col}, {facetSearch:String}) > 0`
    : "";
  const limitParam = isDuck ? "$facetLimit" : "{facetLimit:UInt32}";

  const rows = await queryAnalytics<{ value: string; cnt: number | string }>(
    `
      SELECT ${col} AS value, ${countExpr} AS cnt
      FROM ${table}
      WHERE ${whereSql} AND ${col} != '' ${searchClause}
      GROUP BY value
      ORDER BY cnt DESC
      LIMIT ${limitParam}
    `,
    {
      ...queryParams,
      ...(search.trim() ? { facetSearch: search.trim() } : {}),
      facetLimit: Math.min(limit, 200),
    }
  );
  return rows.map((r) => ({ value: r.value, count: Number(r.cnt) }));
}

export async function queryAniBreakdown(
  filter: GlobalFilterSpec,
  aniType: "op_ani" | "tp_ani",
  maskPii: boolean,
  limit = 50
): Promise<AniBreakdownRow[]> {
  const { engine, whereSql, queryParams } = buildAnalyticsWhere(filter, {
    forceRawTable: true,
  });
  const isDuck = isDuckDbEngine(engine);
  const table = getAnalyticsTableName(engine, "sms_records");
  const col = aniType === "op_ani" ? "op_ani" : "tp_ani";

  const anyExpr = (c: string) =>
    isDuck ? `MODE(${c})` : `anyHeavy(${c})`;
  const topReasonExpr = isDuck
    ? "MODE(reason_normalized) FILTER (WHERE reason_normalized != '')"
    : "anyHeavyIf(reason_normalized, reason_normalized != '')";
  const limitParam = isDuck ? "$limit" : "{limit:UInt32}";

  const sql = `
    SELECT
      ${col} AS ani,
      ${anyExpr("op_name")} AS associatedOp,
      ${anyExpr("tp_name")} AS associatedTp,
      ${anyExpr("applicant")} AS applicant,
      ${anyExpr("country")} AS country,
      ${topReasonExpr} AS topReason,
      COUNT(*) AS totalMessages,
      SUM(CASE WHEN normalized_status = 'SUCCESS' THEN 1 ELSE 0 END) AS successMessages,
      SUM(CASE WHEN normalized_status = 'FAILED' THEN 1 ELSE 0 END) AS failedMessages,
      SUM(CASE WHEN normalized_status = 'REJECTED' THEN 1 ELSE 0 END) AS rejectedMessages,
      SUM(CASE WHEN normalized_status = 'PENDING' THEN 1 ELSE 0 END) AS pendingMessages,
      SUM(CASE WHEN normalized_status = 'UNKNOWN' THEN 1 ELSE 0 END) AS unknownMessages,
      SUM(CASE WHEN normalized_status = 'OTHER' THEN 1 ELSE 0 END) AS otherMessages
    FROM ${table}
    WHERE ${whereSql} AND ${col} != ''
    GROUP BY ani
    ORDER BY (failedMessages + rejectedMessages) DESC, totalMessages DESC
    LIMIT ${limitParam}
  `;

  const rows = await queryAnalytics<Record<string, unknown>>(sql, {
    ...queryParams,
    limit: Math.min(limit, 200),
  });

  return rows.map((r) => ({
    ani: maskIdentifier(String(r.ani ?? ""), maskPii),
    associatedOp: String(r.associatedOp ?? ""),
    associatedTp: String(r.associatedTp ?? ""),
    applicant: String(r.applicant ?? "Unassigned"),
    country: String(r.country ?? "Unmapped"),
    topReason: r.topReason ? String(r.topReason) : null,
    ...computeQoSKpis({
      totalMessages: Number(r.totalMessages ?? 0),
      successMessages: Number(r.successMessages ?? 0),
      failedMessages: Number(r.failedMessages ?? 0),
      rejectedMessages: Number(r.rejectedMessages ?? 0),
      pendingMessages: Number(r.pendingMessages ?? 0),
      unknownMessages: Number(r.unknownMessages ?? 0),
      otherMessages: Number(r.otherMessages ?? 0),
    }),
  }));
}

export interface ExplorerQueryOptions {
  pageSize: number;
  cursorTs?: string;
  cursorRowId?: number;
  sortDir?: "ASC" | "DESC";
  maskPii: boolean;
}

export async function queryExplorerMessages(
  filter: GlobalFilterSpec,
  options: ExplorerQueryOptions
) {
  const { engine, whereSql, queryParams } = buildAnalyticsWhere(filter, {
    forceRawTable: true,
  });
  const isDuck = isDuckDbEngine(engine);
  const table = getAnalyticsTableName(engine, "sms_records");
  const dir = options.sortDir === "ASC" ? "ASC" : "DESC";
  const op = dir === "DESC" ? "<" : ">";
  const limit = Math.min(Math.max(options.pageSize, 10), 500);

  let cursorClause = "";
  if (options.cursorTs && options.cursorRowId !== undefined) {
    cursorClause = isDuck
      ? `AND (event_timestamp ${op} CAST($cursorTs AS TIMESTAMP) OR (event_timestamp = CAST($cursorTs AS TIMESTAMP) AND message_row_id ${op} $cursorRowId))`
      : `AND (event_timestamp, message_row_id) ${op} (parseDateTime64BestEffort({cursorTs:String}, 6, 'UTC'), {cursorRowId:UInt64})`;
    queryParams.cursorTs = options.cursorTs;
    queryParams.cursorRowId = options.cursorRowId;
  }

  const tsFormat = (c: string) =>
    isDuck
      ? `strftime(${c}, '%Y-%m-%d %H:%M:%S.%f')`
      : `toString(${c})`;

  const limitParam = isDuck ? "$pageLimit" : "{pageLimit:UInt32}";

  const sql = `
    SELECT
      dataset_id,
      message_row_id,
      ${tsFormat("event_timestamp")} AS event_timestamp,
      CASE WHEN dlr_timestamp IS NOT NULL THEN ${tsFormat("dlr_timestamp")} ELSE NULL END AS dlr_timestamp,
      dlr_latency_ms,
      op_name,
      tp_name,
      applicant,
      direction,
      route,
      op_ani,
      tp_ani,
      destination_number,
      country,
      raw_country_network,
      state_region,
      raw_submit_status,
      raw_dlr_state,
      raw_status,
      normalized_status,
      reason,
      message_id,
      op_host,
      tp_host,
      CAST(cost_in AS DOUBLE) AS cost_in,
      CAST(cost_out AS DOUBLE) AS cost_out,
      op_currency,
      extra_attributes
    FROM ${table}
    WHERE ${whereSql} ${cursorClause}
    ORDER BY event_timestamp ${dir}, message_row_id ${dir}
    LIMIT ${limitParam}
  `;

  const rows = await queryAnalytics<Record<string, unknown>>(sql, {
    ...queryParams,
    pageLimit: limit + 1,
  });

  const hasMore = rows.length > limit;
  const sliced: Record<string, unknown>[] = rows.slice(0, limit).map((r) => ({
    ...r,
    op_ani: maskIdentifier(String(r.op_ani ?? ""), options.maskPii),
    tp_ani: maskIdentifier(String(r.tp_ani ?? ""), options.maskPii),
    destination_number: maskIdentifier(
      String(r.destination_number ?? ""),
      options.maskPii
    ),
  }));

  const last = sliced[sliced.length - 1];

  return {
    rows: sliced,
    hasMore,
    nextCursor:
      hasMore && last
        ? {
            cursorTs: String(last.event_timestamp ?? ""),
            cursorRowId: Number(last.message_row_id ?? 0),
          }
        : null,
  };
}
