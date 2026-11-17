import crypto from "node:crypto";
import {
  getAnalyticsTableName,
  isDuckDbEngine,
  queryAnalytics,
} from "@/lib/database/analytics-db";
import { appQuery } from "@/lib/database/app-db";
import type { GlobalFilterSpec } from "@/modules/analytics/filter-schema";
import { buildAnalyticsWhere } from "@/modules/analytics/query-builder";
import {
  queryDimensionBreakdown,
  queryGlobalKpis,
  type DimensionBreakdownRow,
  type GlobalKpiSummary,
} from "@/modules/analytics/service";

export interface MoverRow {
  dimensionValue: string;
  baselineRatePct: number | null;
  currentRatePct: number | null;
  deltaPctPoints: number | null;
  baselineVolume: number;
  currentVolume: number;
}

export interface PeriodComparisonResult {
  baseline: GlobalKpiSummary;
  current: GlobalKpiSummary;
  deltas: {
    trafficChangePct: number | null;
    successRateDeltaPp: number | null;
    failureRateDeltaPp: number | null;
    rejectionRateDeltaPp: number | null;
    combinedUnsuccessfulDeltaPp: number | null;
  };
  opMovers: MoverRow[];
  tpMovers: MoverRow[];
}

function deltaPp(curr: number | null, base: number | null): number | null {
  if (curr === null || base === null) return null;
  return Number((curr - base).toFixed(4));
}

function buildMovers(
  baseRows: DimensionBreakdownRow[],
  currRows: DimensionBreakdownRow[]
): MoverRow[] {
  const baseMap = new Map(baseRows.map((r) => [r.dimensionValue, r]));
  const currMap = new Map(currRows.map((r) => [r.dimensionValue, r]));
  const keys = new Set([...baseMap.keys(), ...currMap.keys()]);

  const out: MoverRow[] = [];
  for (const key of keys) {
    const b = baseMap.get(key);
    const c = currMap.get(key);
    out.push({
      dimensionValue: key,
      baselineRatePct: b?.combinedUnsuccessfulRatePct ?? null,
      currentRatePct: c?.combinedUnsuccessfulRatePct ?? null,
      deltaPctPoints: deltaPp(
        c?.combinedUnsuccessfulRatePct ?? null,
        b?.combinedUnsuccessfulRatePct ?? null
      ),
      baselineVolume: b?.totalMessages ?? 0,
      currentVolume: c?.totalMessages ?? 0,
    });
  }

  return out
    .sort(
      (a, b) =>
        Math.abs(b.deltaPctPoints ?? 0) - Math.abs(a.deltaPctPoints ?? 0)
    )
    .slice(0, 20);
}

export async function compareFilterPeriods(
  baselineFilter: GlobalFilterSpec,
  currentFilter: GlobalFilterSpec
): Promise<PeriodComparisonResult> {
  const [baseline, current, baseOps, currOps, baseTps, currTps] =
    await Promise.all([
      queryGlobalKpis(baselineFilter),
      queryGlobalKpis(currentFilter),
      queryDimensionBreakdown(baselineFilter, "op", { limit: 50 }),
      queryDimensionBreakdown(currentFilter, "op", { limit: 50 }),
      queryDimensionBreakdown(baselineFilter, "tp", { limit: 50 }),
      queryDimensionBreakdown(currentFilter, "tp", { limit: 50 }),
    ]);

  const trafficChangePct =
    baseline.totalMessages > 0
      ? Number(
          (
            ((current.totalMessages - baseline.totalMessages) /
              baseline.totalMessages) *
            100
          ).toFixed(2)
        )
      : null;

  return {
    baseline,
    current,
    deltas: {
      trafficChangePct,
      successRateDeltaPp: deltaPp(current.successRatePct, baseline.successRatePct),
      failureRateDeltaPp: deltaPp(current.failureRatePct, baseline.failureRatePct),
      rejectionRateDeltaPp: deltaPp(
        current.rejectionRatePct,
        baseline.rejectionRatePct
      ),
      combinedUnsuccessfulDeltaPp: deltaPp(
        current.combinedUnsuccessfulRatePct,
        baseline.combinedUnsuccessfulRatePct
      ),
    },
    opMovers: buildMovers(baseOps.rows, currOps.rows),
    tpMovers: buildMovers(baseTps.rows, currTps.rows),
  };
}

/**
 * Evaluates hourly degradation spikes within the selected dataset/filter using minimum sample-size guards.
 */
export async function evaluateDegradationAnomalies(
  filter: GlobalFilterSpec,
  options?: {
    minSampleSize?: number;
    deltaSpikePct?: number;
    criticalThresholdPct?: number;
  }
) {
  const minSample = options?.minSampleSize ?? 500;
  const spikePct = options?.deltaSpikePct ?? 8;
  const criticalThreshold = options?.criticalThresholdPct ?? 25;

  const { engine, whereSql, queryParams } = buildAnalyticsWhere(filter);
  const isDuck = isDuckDbEngine(engine);
  const rollupTable = getAnalyticsTableName(engine, "sms_hourly_rollup");

  const sql = isDuck
    ? `
      WITH hourly AS (
        SELECT
          dimension_type,
          dimension_value,
          bucket_hour,
          SUM(total_count) AS total_cnt,
          SUM(failed_count + rejected_count) AS unsuc_cnt,
          SUM(success_count + failed_count + rejected_count) AS term_cnt
        FROM (
          SELECT 'OP' AS dimension_type, op_name AS dimension_value, bucket_hour, total_count, success_count, failed_count, rejected_count
          FROM ${rollupTable} WHERE ${whereSql}
          UNION ALL
          SELECT 'TP' AS dimension_type, tp_name AS dimension_value, bucket_hour, total_count, success_count, failed_count, rejected_count
          FROM ${rollupTable} WHERE ${whereSql}
          UNION ALL
          SELECT 'COUNTRY' AS dimension_type, country AS dimension_value, bucket_hour, total_count, success_count, failed_count, rejected_count
          FROM ${rollupTable} WHERE ${whereSql}
        ) sub
        GROUP BY dimension_type, dimension_value, bucket_hour
        HAVING SUM(success_count + failed_count + rejected_count) >= $minBucketSample
      ),
      max_b AS (SELECT MAX(bucket_hour) AS max_hour FROM hourly)
      SELECT
        h.dimension_type,
        h.dimension_value,
        strftime(MIN(h.bucket_hour), '%Y-%m-%d %H:%M:%S') AS window_start,
        strftime(MAX(h.bucket_hour), '%Y-%m-%d %H:%M:%S') AS window_end,
        AVG(CASE WHEN h.bucket_hour < m.max_hour THEN CAST(h.unsuc_cnt AS DOUBLE) / h.term_cnt * 100 ELSE NULL END) AS baseline_rate,
        MAX(CASE WHEN h.bucket_hour = m.max_hour THEN CAST(h.unsuc_cnt AS DOUBLE) / h.term_cnt * 100 ELSE NULL END) AS latest_rate,
        MAX(CASE WHEN h.bucket_hour = m.max_hour THEN h.unsuc_cnt ELSE 0 END) AS latest_affected,
        MAX(CASE WHEN h.bucket_hour = m.max_hour THEN h.term_cnt ELSE 0 END) AS latest_terminal
      FROM hourly h, max_b m
      GROUP BY h.dimension_type, h.dimension_value
      HAVING COUNT(*) >= 2
        AND MAX(CASE WHEN h.bucket_hour = m.max_hour THEN h.term_cnt ELSE 0 END) >= $minSample
        AND (
          (MAX(CASE WHEN h.bucket_hour = m.max_hour THEN CAST(h.unsuc_cnt AS DOUBLE) / h.term_cnt * 100 ELSE 0 END)
           - COALESCE(AVG(CASE WHEN h.bucket_hour < m.max_hour THEN CAST(h.unsuc_cnt AS DOUBLE) / h.term_cnt * 100 ELSE NULL END), 0)) >= $spikePct
          OR MAX(CASE WHEN h.bucket_hour = m.max_hour THEN CAST(h.unsuc_cnt AS DOUBLE) / h.term_cnt * 100 ELSE 0 END) >= $criticalThreshold
        )
      ORDER BY latest_rate DESC
      LIMIT 30
    `
    : `
      WITH hourly AS (
        SELECT
          dimension_type,
          dimension_value,
          bucket_hour,
          sum(total_count) AS total_cnt,
          sum(failed_count + rejected_count) AS unsuc_cnt,
          sum(success_count + failed_count + rejected_count) AS term_cnt
        FROM (
          SELECT 'OP' AS dimension_type, op_name AS dimension_value, bucket_hour, total_count, success_count, failed_count, rejected_count
          FROM ${rollupTable} WHERE ${whereSql}
          UNION ALL
          SELECT 'TP' AS dimension_type, tp_name AS dimension_value, bucket_hour, total_count, success_count, failed_count, rejected_count
          FROM ${rollupTable} WHERE ${whereSql}
          UNION ALL
          SELECT 'COUNTRY' AS dimension_type, country AS dimension_value, bucket_hour, total_count, success_count, failed_count, rejected_count
          FROM ${rollupTable} WHERE ${whereSql}
        )
        GROUP BY dimension_type, dimension_value, bucket_hour
        HAVING term_cnt >= {minBucketSample:UInt64}
      ),
      max_b AS (SELECT max(bucket_hour) AS max_hour FROM hourly)
      SELECT
        hourly.dimension_type AS dimension_type,
        hourly.dimension_value AS dimension_value,
        toString(min(hourly.bucket_hour)) AS window_start,
        toString(max(hourly.bucket_hour)) AS window_end,
        avgIf(hourly.unsuc_cnt / hourly.term_cnt * 100, hourly.bucket_hour < max_b.max_hour) AS baseline_rate,
        argMax(hourly.unsuc_cnt / hourly.term_cnt * 100, hourly.bucket_hour) AS latest_rate,
        argMax(hourly.unsuc_cnt, hourly.bucket_hour) AS latest_affected,
        argMax(hourly.term_cnt, hourly.bucket_hour) AS latest_terminal
      FROM hourly
      CROSS JOIN max_b
      GROUP BY hourly.dimension_type, hourly.dimension_value
      HAVING count() >= 2
        AND latest_terminal >= {minSample:UInt64}
        AND (latest_rate - coalesce(baseline_rate, 0) >= {spikePct:Float64} OR latest_rate >= {criticalThreshold:Float64})
      ORDER BY (latest_rate - coalesce(baseline_rate, 0)) DESC
      LIMIT 30
    `;

  const anomalies = await queryAnalytics<{
    dimension_type: string;
    dimension_value: string;
    window_start: string;
    window_end: string;
    baseline_rate: number | null;
    latest_rate: number | null;
    latest_affected: number | string;
    latest_terminal: number | string;
  }>(sql, {
    ...queryParams,
    minBucketSample: Math.max(50, Math.floor(minSample / 5)),
    minSample,
    spikePct,
    criticalThreshold,
  });

  const datasetId = filter.datasetIds[0] ?? null;
  const insertedAlerts = [];

  for (const a of anomalies) {
    const base = Number(a.baseline_rate ?? 0);
    const curr = Number(a.latest_rate ?? 0);
    const delta = curr - base;
    const severity =
      curr >= criticalThreshold || delta >= spikePct * 2
        ? "CRITICAL"
        : "WARNING";

    const whatChanged = `${a.dimension_type} "${a.dimension_value}" unsuccessful rate ${
      delta >= 0
        ? `increased by +${delta.toFixed(2)}pp`
        : `remained elevated at ${curr.toFixed(2)}%`
    } against prior hourly baseline (${base.toFixed(2)}% -> ${curr.toFixed(2)}%).`;

    const suggested = `Inspect ${a.dimension_type} = "${a.dimension_value}" around ${a.window_end} UTC in Message Explorer and Rejection Intelligence to check co-occurring SMPP codes and associated OP/TP routes (observed correlation; confirm carrier DLR/routing before root-cause attribution).`;

    const alertId = crypto.randomUUID();
    const ins = await appQuery(
      `
      INSERT INTO degradation_alerts (
        id, dataset_id, severity, dimension_type, dimension_value,
        what_changed, detected_window_start, detected_window_end,
        baseline_value, current_value, affected_records, suggested_investigation
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
      `,
      [
        alertId,
        datasetId,
        severity,
        a.dimension_type,
        a.dimension_value,
        whatChanged,
        a.window_start,
        a.window_end,
        Number(base.toFixed(4)),
        Number(curr.toFixed(4)),
        Number(a.latest_affected ?? 0),
        suggested,
      ]
    );
    insertedAlerts.push(ins.rows[0]);
  }

  return insertedAlerts;
}
