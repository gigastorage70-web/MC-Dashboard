/**
 * Centralized QoS Metric Definitions & MediaCore Dual-Stage Status Normalization.
 * Single source of truth used across Ingestion, Analytics APIs, and Tests.
 */

export type NormalizedStatus =
  | "SUCCESS"
  | "FAILED"
  | "REJECTED"
  | "PENDING"
  | "OTHER"
  | "UNKNOWN";

export interface StatusClassification {
  rawSubmitStatus: string;
  rawDlrState: string;
  rawStatus: string;
  normalizedStatus: NormalizedStatus;
  isTerminal: boolean;
}

export interface StatusCounts {
  totalMessages: number;
  successMessages: number;
  failedMessages: number;
  rejectedMessages: number;
  pendingMessages: number;
  unknownMessages: number;
  otherMessages: number;
}

export interface ComputedQoSKpis extends StatusCounts {
  terminalMessages: number;
  unsuccessfulCombinedMessages: number;
  successRatePct: number | null;
  failureRatePct: number | null;
  rejectionRatePct: number | null;
  combinedUnsuccessfulRatePct: number | null;
}

const DELIVERED_STATES = new Set(["DELIVRD", "DELIVERED"]);
const FAILED_DLR_STATES = new Set(["UNDELIV", "EXPIRED", "FAILED"]);
const REJECTED_DLR_STATES = new Set(["REJECTD", "REJECTED"]);
const PENDING_DLR_STATES = new Set(["ENROUTE", "ACCEPTD", "ACCEPTED", "BUFFERD"]);

/**
 * Classifies MediaCore's two-stage status fields:
 * - Submit stage (`Status`): empty or '0' means TP accepted submission; non-empty code (e.g. '69','11','88') means submit rejection.
 * - Delivery stage (`State`): SMPP DLR state ('DELIVRD','UNDELIV','EXPIRED','REJECTD','ENROUTE').
 */
export function classifyMediaCoreStatus(
  submitStatusRaw: string | null | undefined,
  dlrStateRaw: string | null | undefined
): StatusClassification {
  const submit = (submitStatusRaw ?? "").trim();
  const state = (dlrStateRaw ?? "").trim().toUpperCase();

  // Stage 1: Submit-time SMPP error code present (when non-empty and not '0')
  if (submit !== "" && submit !== "0") {
    return {
      rawSubmitStatus: submit,
      rawDlrState: state,
      rawStatus: `SMPP:${submit}`,
      normalizedStatus: "REJECTED",
      isTerminal: true,
    };
  }

  // Stage 2: Accepted at submit; inspect final DLR State
  if (DELIVERED_STATES.has(state)) {
    return {
      rawSubmitStatus: submit,
      rawDlrState: state,
      rawStatus: state,
      normalizedStatus: "SUCCESS",
      isTerminal: true,
    };
  }

  if (FAILED_DLR_STATES.has(state)) {
    return {
      rawSubmitStatus: submit,
      rawDlrState: state,
      rawStatus: state,
      normalizedStatus: "FAILED",
      isTerminal: true,
    };
  }

  if (REJECTED_DLR_STATES.has(state)) {
    return {
      rawSubmitStatus: submit,
      rawDlrState: state,
      rawStatus: state,
      normalizedStatus: "REJECTED",
      isTerminal: true,
    };
  }

  if (PENDING_DLR_STATES.has(state)) {
    return {
      rawSubmitStatus: submit,
      rawDlrState: state,
      rawStatus: state,
      normalizedStatus: "PENDING",
      isTerminal: false,
    };
  }

  if (state === "") {
    return {
      rawSubmitStatus: submit,
      rawDlrState: "",
      rawStatus: "NO_DLR",
      normalizedStatus: "UNKNOWN",
      isTerminal: false,
    };
  }

  return {
    rawSubmitStatus: submit,
    rawDlrState: state,
    rawStatus: state,
    normalizedStatus: "UNKNOWN",
    isTerminal: false,
  };
}

function pctOrNull(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Number(((numerator / denominator) * 100).toFixed(4));
}

/**
 * Computes all primary QoS metrics from mutually exclusive status counts.
 * Terminal denominator = SUCCESS + FAILED + REJECTED (excludes PENDING & UNKNOWN).
 * Never double-counts REJECTED and FAILED.
 */
export function computeQoSKpis(counts: StatusCounts): ComputedQoSKpis {
  const terminalMessages =
    counts.successMessages + counts.failedMessages + counts.rejectedMessages;
  const unsuccessfulCombinedMessages =
    counts.failedMessages + counts.rejectedMessages;

  return {
    ...counts,
    terminalMessages,
    unsuccessfulCombinedMessages,
    successRatePct: pctOrNull(counts.successMessages, terminalMessages),
    failureRatePct: pctOrNull(counts.failedMessages, terminalMessages),
    rejectionRatePct: pctOrNull(counts.rejectedMessages, terminalMessages),
    combinedUnsuccessfulRatePct: pctOrNull(
      unsuccessfulCombinedMessages,
      terminalMessages
    ),
  };
}

export function computeFailureContributionPct(
  dimensionUnsuccessful: number,
  globalUnsuccessful: number
): number | null {
  return pctOrNull(dimensionUnsuccessful, globalUnsuccessful);
}

export function computeTrafficSharePct(
  dimensionTotal: number,
  globalTotal: number
): number | null {
  return pctOrNull(dimensionTotal, globalTotal);
}

/**
 * Neutralizes CSV formula injection for exports (OWASP recommendation).
 */
export function sanitizeCsvCell(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  const formulaPrefix = /^[=+\-@\t\r]/;
  const safe = formulaPrefix.test(str) ? `'${str}` : str;
  if (safe.includes(",") || safe.includes('"') || safe.includes("\n") || safe.includes(";")) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}
