import crypto from "node:crypto";
import {
  classifyMediaCoreStatus,
  type NormalizedStatus,
} from "../../lib/metrics/definitions";
import type {
  ColumnMappingDict,
  LogicalField,
} from "../schema-mapping/constants";
import { resolveCanonicalCountry } from "./country-mcc";

export interface StatusRuleRecord {
  matchSubmitStatus: string | null;
  matchDlrState: string | null;
  normalizedStatus: NormalizedStatus;
  isTerminal: boolean;
}

export interface ClickHouseSmsRecord {
  dataset_id: string;
  upload_id: string;
  batch_id: number;
  message_row_id: number;
  row_hash: string;
  event_timestamp: string;
  dlr_timestamp: string | null;
  dlr_latency_ms: number | null;
  op_name: string;
  tp_name: string;
  applicant: string;
  direction: string;
  route: string;
  op_ani: string;
  tp_ani: string;
  destination_number: string;
  called_number_out: string;
  message_id: string;
  transaction_id: string;
  country: string;
  state_region: string;
  raw_country_network: string;
  op_mcc: string;
  op_mnc: string;
  tp_mcc: string;
  tp_mnc: string;
  raw_submit_status: string;
  raw_dlr_state: string;
  raw_status: string;
  normalized_status: NormalizedStatus;
  is_terminal: number;
  reason: string;
  reason_normalized: string;
  op_host: string;
  tp_host: string;
  nas_ip: string;
  op_price: string | null;
  tp_price: string | null;
  cost_in: string | null;
  cost_out: string | null;
  op_currency: string;
  tp_currency: string;
  extra_attributes: string;
}

export interface RowValidationFailure {
  rowNumber: number;
  reasonCode:
    | "COLUMN_COUNT_MISMATCH"
    | "MISSING_CRITICAL_FIELD"
    | "MALFORMED_TIMESTAMP"
    | "INVALID_NUMERIC";
  message: string;
  rawLine: string;
}

export interface NormalizedRowOutcome {
  kind: "valid" | "skipped_header" | "invalid";
  record?: ClickHouseSmsRecord;
  eventEpochMs?: number;
  failure?: RowValidationFailure;
}

const TIMESTAMP_REGEX =
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(?:Z)?$/;

/**
 * Formats YYYY-MM-DD HH:mm:ss(.ffffff) or ISO string into ClickHouse UTC DateTime64(6).
 */
export function parseMediaCoreTimestamp(
  raw: string
): { chFormatted: string; epochMs: number } | null {
  const s = raw.trim();
  if (!s) return null;

  const m = TIMESTAMP_REGEX.exec(s);
  if (m) {
    const [, yr, mo, dy, hr, mn, sc, frac = ""] = m;
    const year = Number(yr);
    const month = Number(mo);
    const day = Number(dy);
    const hour = Number(hr);
    const minute = Number(mn);
    const second = Number(sc);
    if (
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > 31 ||
      hour > 23 ||
      minute > 59 ||
      second > 59
    ) {
      return null;
    }
    const micro = frac.padEnd(6, "0").slice(0, 6);
    const ms = Number(micro.slice(0, 3));
    const epochMs = Date.UTC(year, month - 1, day, hour, minute, second, ms);
    if (Number.isNaN(epochMs)) return null;
    return {
      chFormatted: `${yr}-${mo}-${dy} ${hr}:${mn}:${sc}.${micro}`,
      epochMs,
    };
  }

  // Fallback for ISO strings with offsets or DD/MM/YYYY
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    const iso = d.toISOString(); // YYYY-MM-DDTHH:mm:ss.sssZ
    const chFormatted = `${iso.slice(0, 10)} ${iso.slice(11, 23)}000`;
    return { chFormatted, epochMs: d.getTime() };
  }
  return null;
}

export function parseDecimalString(raw: string): {
  ok: boolean;
  value: string | null;
} {
  const s = raw.trim();
  if (!s) return { ok: true, value: null };
  if (!/^-?\d+(?:\.\d+)?$/.test(s)) {
    return { ok: false, value: null };
  }
  return { ok: true, value: s };
}

export function buildFieldIndexMap(
  headers: string[],
  mapping: ColumnMappingDict
): {
  byField: Partial<Record<LogicalField, number>>;
  extraCols: Array<{ index: number; header: string }>;
} {
  const byField: Partial<Record<LogicalField, number>> = {};
  const extraCols: Array<{ index: number; header: string }> = [];

  headers.forEach((header, idx) => {
    const target = mapping[header];
    if (!target || target === "IGNORE") {
      extraCols.push({ index: idx, header });
    } else if (byField[target] === undefined) {
      byField[target] = idx;
    }
  });

  return { byField, extraCols };
}

export function isRepeatedHeaderRow(
  row: string[],
  headers: string[]
): boolean {
  if (row.length !== headers.length) return false;
  const checkCount = Math.min(4, headers.length);
  for (let i = 0; i < checkCount; i++) {
    if ((row[i] ?? "").trim() !== headers[i]) {
      return false;
    }
  }
  return true;
}

function classifyWithRules(
  submitStatus: string,
  dlrState: string,
  rules: StatusRuleRecord[]
) {
  if (rules.length > 0) {
    const cleanSubmit = submitStatus.trim();
    const cleanState = dlrState.trim().toUpperCase();
    for (const rule of rules) {
      const subMatch =
        rule.matchSubmitStatus === null ||
        rule.matchSubmitStatus === "*" && cleanSubmit !== "" && cleanSubmit !== "0" ||
        rule.matchSubmitStatus === cleanSubmit;
      const dlrMatch =
        rule.matchDlrState === null ||
        rule.matchDlrState === "*" && cleanState !== "" ||
        rule.matchDlrState.toUpperCase() === cleanState;
      if (subMatch && dlrMatch) {
        const rawStatus =
          cleanSubmit !== "" && cleanSubmit !== "0"
            ? `SMPP:${cleanSubmit}`
            : cleanState || "NO_DLR";
        return {
          rawSubmitStatus: cleanSubmit,
          rawDlrState: cleanState,
          rawStatus,
          normalizedStatus: rule.normalizedStatus,
          isTerminal: rule.isTerminal,
        };
      }
    }
  }
  return classifyMediaCoreStatus(submitStatus, dlrState);
}

/**
 * Validates and normalizes a single MediaCore CSV row into a ClickHouse-ready record.
 */
export function normalizeCsvRow(params: {
  row: string[];
  rowNumber: number;
  headers: string[];
  fieldIndex: Partial<Record<LogicalField, number>>;
  extraCols: Array<{ index: number; header: string }>;
  datasetId: string;
  uploadId: string;
  batchId: number;
  statusRules: StatusRuleRecord[];
}): NormalizedRowOutcome {
  const {
    row,
    rowNumber,
    headers,
    fieldIndex,
    extraCols,
    datasetId,
    uploadId,
    batchId,
    statusRules,
  } = params;

  if (isRepeatedHeaderRow(row, headers)) {
    return { kind: "skipped_header" };
  }

  if (row.length < Math.max(3, headers.length - 2)) {
    return {
      kind: "invalid",
      failure: {
        rowNumber,
        reasonCode: "COLUMN_COUNT_MISMATCH",
        message: `Expected ${headers.length} columns but received ${row.length}`,
        rawLine: row.join(";"),
      },
    };
  }

  const get = (f: LogicalField): string => {
    const idx = fieldIndex[f];
    return idx !== undefined ? (row[idx] ?? "").trim() : "";
  };

  const tsRaw = get("MESSAGE_TIMESTAMP");
  const parsedTs = parseMediaCoreTimestamp(tsRaw);
  if (!parsedTs) {
    return {
      kind: "invalid",
      failure: {
        rowNumber,
        reasonCode: "MALFORMED_TIMESTAMP",
        message: `Malformed or missing Message Timestamp: "${tsRaw}"`,
        rawLine: row.join(";"),
      },
    };
  }

  const opName = get("OP_NAME");
  const tpName = get("TP_NAME");
  if (!opName && !tpName) {
    return {
      kind: "invalid",
      failure: {
        rowNumber,
        reasonCode: "MISSING_CRITICAL_FIELD",
        message: "Both OP Name and TP Name are empty",
        rawLine: row.join(";"),
      },
    };
  }

  const dlrTsRaw = get("DLR_TIMESTAMP");
  const parsedDlr = dlrTsRaw ? parseMediaCoreTimestamp(dlrTsRaw) : null;
  const dlrLatencyMs =
    parsedDlr && parsedDlr.epochMs >= parsedTs.epochMs
      ? parsedDlr.epochMs - parsedTs.epochMs
      : null;

  const opPrice = parseDecimalString(get("OP_PRICE"));
  const tpPrice = parseDecimalString(get("TP_PRICE"));
  const costIn = parseDecimalString(get("COST_IN"));
  const costOut = parseDecimalString(get("COST_OUT"));
  if (!opPrice.ok || !tpPrice.ok || !costIn.ok || !costOut.ok) {
    return {
      kind: "invalid",
      failure: {
        rowNumber,
        reasonCode: "INVALID_NUMERIC",
        message: "Malformed price or cost decimal field",
        rawLine: row.join(";"),
      },
    };
  }

  const rawSubmit = get("SUBMIT_STATUS");
  const rawDlrState = get("DLR_STATE");
  const statusInfo = classifyWithRules(rawSubmit, rawDlrState, statusRules);

  const rawCountryNetwork = get("COUNTRY");
  const opMcc = get("OP_MCC");
  const tpMcc = get("TP_MCC");
  const country = resolveCanonicalCountry(rawCountryNetwork, opMcc, tpMcc);

  const rawReason = get("MESSAGE_REASON");
  const reasonNormalized = rawReason
    ? rawReason.replace(/\s+/g, " ").trim().toUpperCase()
    : rawSubmit && rawSubmit !== "0"
    ? `SMPP_ERR_${rawSubmit}`
    : "";

  const extraObj: Record<string, string> = {};
  for (const col of extraCols) {
    const val = (row[col.index] ?? "").trim();
    if (val !== "") {
      extraObj[col.header] = val;
    }
  }

  // 32-char ASCII MD5 hex digest for exact duplicate detection (ClickHouse FixedString(32))
  const rowHash = crypto
    .createHash("md5")
    .update(row.join("\x1f"))
    .digest("hex");

  return {
    kind: "valid",
    eventEpochMs: parsedTs.epochMs,
    record: {
      dataset_id: datasetId,
      upload_id: uploadId,
      batch_id: batchId,
      message_row_id: rowNumber,
      row_hash: rowHash,
      event_timestamp: parsedTs.chFormatted,
      dlr_timestamp: parsedDlr ? parsedDlr.chFormatted : null,
      dlr_latency_ms: dlrLatencyMs,
      op_name: opName || "Unassigned",
      tp_name: tpName || "Unassigned",
      applicant: get("APPLICANT") || "Unassigned",
      direction: get("DIRECTION") || "Unmapped",
      route: get("ROUTE") || "Unmapped",
      op_ani: get("OP_ANI"),
      tp_ani: get("TP_ANI"),
      destination_number: get("DESTINATION"),
      called_number_out: get("CALLED_NUMBER_OUT"),
      message_id: get("MESSAGE_ID"),
      transaction_id: get("TRANSACTION_ID"),
      country,
      state_region: get("STATE_REGION") || "Unmapped",
      raw_country_network: rawCountryNetwork || "Unmapped",
      op_mcc: opMcc,
      op_mnc: get("OP_MNC"),
      tp_mcc: tpMcc,
      tp_mnc: get("TP_MNC"),
      raw_submit_status: statusInfo.rawSubmitStatus,
      raw_dlr_state: statusInfo.rawDlrState,
      raw_status: statusInfo.rawStatus,
      normalized_status: statusInfo.normalizedStatus,
      is_terminal: statusInfo.isTerminal ? 1 : 0,
      reason: rawReason,
      reason_normalized: reasonNormalized,
      op_host: get("OP_HOST"),
      tp_host: get("TP_HOST"),
      nas_ip: get("NAS_IP"),
      op_price: opPrice.value,
      tp_price: tpPrice.value,
      cost_in: costIn.value,
      cost_out: costOut.value,
      op_currency: get("OP_CURRENCY"),
      tp_currency: get("TP_CURRENCY"),
      extra_attributes: Object.keys(extraObj).length > 0 ? JSON.stringify(extraObj) : "",
    },
  };
}
