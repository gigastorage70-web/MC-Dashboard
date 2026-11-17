import type { ClickHouseSmsRecord } from "./normalizer";

export interface HourlyRollupRecord {
  dataset_id: string;
  upload_id: string;
  bucket_hour: string;
  op_name: string;
  tp_name: string;
  applicant: string;
  country: string;
  state_region: string;
  route: string;
  raw_status: string;
  normalized_status: string;
  is_terminal: number;
  reason_normalized: string;
  total_count: number;
  success_count: number;
  failed_count: number;
  rejected_count: number;
  pending_count: number;
  unknown_count: number;
  other_count: number;
  terminal_count: number;
  cost_in_sum: number;
  cost_out_sum: number;
  dlr_latency_ms_sum: number;
  dlr_latency_count: number;
}

/**
 * Aggregates a batch of normalized MediaCore records into hourly dimensional rollup buckets.
 */
export function buildHourlyRollupRows(
  records: ClickHouseSmsRecord[]
): HourlyRollupRecord[] {
  const buckets = new Map<string, HourlyRollupRecord>();

  for (const r of records) {
    const bucketHour = `${r.event_timestamp.slice(0, 13)}:00:00`;
    const key = [
      r.dataset_id,
      r.upload_id,
      bucketHour,
      r.op_name,
      r.tp_name,
      r.applicant,
      r.country,
      r.state_region,
      r.route,
      r.raw_status,
      r.normalized_status,
      String(r.is_terminal),
      r.reason_normalized,
    ].join("\u0001");

    let entry = buckets.get(key);
    if (!entry) {
      entry = {
        dataset_id: r.dataset_id,
        upload_id: r.upload_id,
        bucket_hour: bucketHour,
        op_name: r.op_name,
        tp_name: r.tp_name,
        applicant: r.applicant,
        country: r.country,
        state_region: r.state_region,
        route: r.route,
        raw_status: r.raw_status,
        normalized_status: r.normalized_status,
        is_terminal: r.is_terminal,
        reason_normalized: r.reason_normalized,
        total_count: 0,
        success_count: 0,
        failed_count: 0,
        rejected_count: 0,
        pending_count: 0,
        unknown_count: 0,
        other_count: 0,
        terminal_count: 0,
        cost_in_sum: 0,
        cost_out_sum: 0,
        dlr_latency_ms_sum: 0,
        dlr_latency_count: 0,
      };
      buckets.set(key, entry);
    }

    entry.total_count += 1;
    if (r.normalized_status === "SUCCESS") entry.success_count += 1;
    else if (r.normalized_status === "FAILED") entry.failed_count += 1;
    else if (r.normalized_status === "REJECTED") entry.rejected_count += 1;
    else if (r.normalized_status === "PENDING") entry.pending_count += 1;
    else if (r.normalized_status === "UNKNOWN") entry.unknown_count += 1;
    else entry.other_count += 1;

    if (r.is_terminal === 1) entry.terminal_count += 1;

    if (r.cost_in !== null) {
      const cIn = Number(r.cost_in);
      if (Number.isFinite(cIn)) entry.cost_in_sum += cIn;
    }
    if (r.cost_out !== null) {
      const cOut = Number(r.cost_out);
      if (Number.isFinite(cOut)) entry.cost_out_sum += cOut;
    }
    if (r.dlr_latency_ms !== null && Number.isFinite(r.dlr_latency_ms)) {
      entry.dlr_latency_ms_sum += r.dlr_latency_ms;
      entry.dlr_latency_count += 1;
    }
  }

  return Array.from(buckets.values(), (row) => ({
    ...row,
    cost_in_sum: Number(row.cost_in_sum.toFixed(6)),
    cost_out_sum: Number(row.cost_out_sum.toFixed(6)),
  }));
}
