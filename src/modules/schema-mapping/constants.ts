import { parse as parseCsvSync } from "csv-parse/sync";

export const LOGICAL_FIELDS = [
  "OP_NAME",
  "TP_NAME",
  "MESSAGE_TIMESTAMP",
  "SUBMIT_STATUS",
  "DLR_STATE",
  "OP_ANI",
  "TP_ANI",
  "COUNTRY",
  "STATE_REGION",
  "MESSAGE_REASON",
  "APPLICANT",
  "DIRECTION",
  "ROUTE",
  "DESTINATION",
  "CALLED_NUMBER_OUT",
  "MESSAGE_ID",
  "TRANSACTION_ID",
  "DLR_TIMESTAMP",
  "DLR_FLAG",
  "OP_MCC",
  "OP_MNC",
  "TP_MCC",
  "TP_MNC",
  "OP_PRICE",
  "TP_PRICE",
  "COST_IN",
  "COST_OUT",
  "OP_HOST",
  "TP_HOST",
  "NAS_IP",
  "OP_CURRENCY",
  "TP_CURRENCY",
] as const;

export type LogicalField = (typeof LOGICAL_FIELDS)[number];

export interface LogicalFieldMeta {
  field: LogicalField;
  label: string;
  required: boolean;
  category: "core" | "status" | "geo" | "identifiers" | "billing" | "network";
  aliases: string[];
}

export const LOGICAL_FIELD_CATALOG: LogicalFieldMeta[] = [
  {
    field: "OP_NAME",
    label: "OP Name (Originating Partner)",
    required: true,
    category: "core",
    aliases: ["op name", "op_name", "operator", "origin_operator", "originator", "customer"],
  },
  {
    field: "TP_NAME",
    label: "TP Name (Termination Provider)",
    required: true,
    category: "core",
    aliases: ["tp name", "tp_name", "provider", "termination_provider", "vendor", "supplier"],
  },
  {
    field: "MESSAGE_TIMESTAMP",
    label: "Message Timestamp",
    required: true,
    category: "core",
    aliases: ["send time", "send_time", "timestamp", "event_timestamp", "created_at", "submit_time", "date"],
  },
  {
    field: "SUBMIT_STATUS",
    label: "Submit / Command Status",
    required: false,
    category: "status",
    aliases: ["status", "submit_status", "command_status", "message_status", "msg_status", "smpp_status"],
  },
  {
    field: "DLR_STATE",
    label: "DLR State / Final State",
    required: false,
    category: "status",
    aliases: ["state", "dlr_state", "delivery_state", "final_state", "dlr status"],
  },
  {
    field: "MESSAGE_REASON",
    label: "Rejection / Error Reason",
    required: false,
    category: "status",
    aliases: ["reason", "message_reason", "rejection_reason", "error_reason", "error_description", "err_text"],
  },
  {
    field: "OP_ANI",
    label: "OP ANI (Originator Sender ID)",
    required: false,
    category: "identifiers",
    aliases: ["op ani", "op_ani", "source_ani", "sender_id", "sender", "source"],
  },
  {
    field: "TP_ANI",
    label: "TP ANI (Outbound Sender ID)",
    required: false,
    category: "identifiers",
    aliases: ["tp ani", "tp_ani", "out_ani", "called_ani", "outbound_sender"],
  },
  {
    field: "APPLICANT",
    label: "Applicant / Business Account",
    required: false,
    category: "core",
    aliases: ["applicant", "client", "brand", "account_name"],
  },
  {
    field: "DIRECTION",
    label: "Message Direction",
    required: false,
    category: "core",
    aliases: ["direction", "traffic_direction", "dir", "flow"],
  },
  {
    field: "ROUTE",
    label: "Route / Dialpeer",
    required: false,
    category: "core",
    aliases: ["dialpeer", "route", "routing_plan", "lcr_route"],
  },
  {
    field: "COUNTRY",
    label: "Country / Network Name",
    required: false,
    category: "geo",
    aliases: ["country", "country_name", "destination_country", "network"],
  },
  {
    field: "STATE_REGION",
    label: "State / Region (Geo)",
    required: false,
    category: "geo",
    aliases: ["state_region", "region", "province", "geo_state", "circle"],
  },
  {
    field: "DESTINATION",
    label: "Clear / Destination Number",
    required: false,
    category: "identifiers",
    aliases: ["clear number", "clear_number", "destination", "dst", "msisdn", "recipient"],
  },
  {
    field: "CALLED_NUMBER_OUT",
    label: "Called Number OUT",
    required: false,
    category: "identifiers",
    aliases: ["called number out", "called_number_out", "out_number", "called_out"],
  },
  {
    field: "MESSAGE_ID",
    label: "Message ID",
    required: false,
    category: "identifiers",
    aliases: ["message id", "message_id", "msg_id", "smsc_id"],
  },
  {
    field: "TRANSACTION_ID",
    label: "Transaction ID",
    required: false,
    category: "identifiers",
    aliases: ["transaction id", "transaction_id", "tx_id", "xdr_id"],
  },
  {
    field: "DLR_TIMESTAMP",
    label: "DLR Timestamp",
    required: false,
    category: "status",
    aliases: ["dlr time", "dlr_time", "dlr_timestamp", "delivery_time"],
  },
  {
    field: "DLR_FLAG",
    label: "DLR Requested Flag",
    required: false,
    category: "status",
    aliases: ["dlr", "dlr_flag", "dlr_requested"],
  },
  { field: "OP_MCC", label: "OP MCC", required: false, category: "geo", aliases: ["op mcc", "op_mcc"] },
  { field: "OP_MNC", label: "OP MNC", required: false, category: "geo", aliases: ["op mnc", "op_mnc"] },
  { field: "TP_MCC", label: "TP MCC", required: false, category: "geo", aliases: ["tp mcc", "tp_mcc"] },
  { field: "TP_MNC", label: "TP MNC", required: false, category: "geo", aliases: ["tp mnc", "tp_mnc"] },
  { field: "OP_PRICE", label: "OP Price", required: false, category: "billing", aliases: ["op price", "op_price"] },
  { field: "TP_PRICE", label: "TP Price", required: false, category: "billing", aliases: ["tp price", "tp_price"] },
  { field: "COST_IN", label: "Cost IN", required: false, category: "billing", aliases: ["cost in", "cost_in"] },
  { field: "COST_OUT", label: "Cost OUT", required: false, category: "billing", aliases: ["cost out", "cost_out"] },
  { field: "OP_CURRENCY", label: "OP Currency", required: false, category: "billing", aliases: ["op currency", "op_currency"] },
  { field: "TP_CURRENCY", label: "TP Currency", required: false, category: "billing", aliases: ["tp currency", "tp_currency"] },
  { field: "OP_HOST", label: "OP Host IP", required: false, category: "network", aliases: ["op host", "op_host"] },
  { field: "TP_HOST", label: "TP Host IP", required: false, category: "network", aliases: ["tp host", "tp_host"] },
  { field: "NAS_IP", label: "NAS IP", required: false, category: "network", aliases: ["nas ip", "nas_ip"] },
];

export type ColumnMappingDict = Record<string, LogicalField | "IGNORE">;

export interface SchemaInspectionResult {
  detectedDelimiter: string;
  headers: string[];
  previewRows: Record<string, string>[];
  proposedMapping: ColumnMappingDict;
  ambiguousFields: LogicalField[];
  missingRequiredFields: LogicalField[];
  hasStatusField: boolean;
  unmappedHeaders: string[];
}

const CANDIDATE_DELIMITERS = [";", ",", "\t", "|"] as const;

export function detectCsvDelimiter(sampleText: string): string {
  const clean = sampleText.replace(/^\uFEFF/, "");
  const lines = clean
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .slice(0, 15);

  if (lines.length === 0) return ";";

  let bestDelimiter = ";";
  let bestScore = -1;

  for (const delim of CANDIDATE_DELIMITERS) {
    const counts = lines.map((line) => line.split(delim).length);
    const headerCols = counts[0] ?? 1;
    if (headerCols <= 1) continue;
    const consistent = counts.filter((c) => c === headerCols).length;
    const score = consistent * 100 + headerCols;
    if (score > bestScore) {
      bestScore = score;
      bestDelimiter = delim;
    }
  }
  return bestDelimiter;
}

function normalizeHeaderKey(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Inspects a CSV sample (e.g. first 64 KB), detects delimiter, parses up to 30 preview rows,
 * and proposes deterministic mappings while flagging ambiguities and missing required fields.
 */
export function inspectCsvSample(
  sampleText: string,
  preferredDelimiter?: string
): SchemaInspectionResult {
  const cleanText = sampleText.replace(/^\uFEFF/, "");
  const detectedDelimiter =
    preferredDelimiter && preferredDelimiter.length > 0
      ? preferredDelimiter
      : detectCsvDelimiter(cleanText);

  // Drop trailing partial line only when reading a truncated 64KB byte slice
  const lastNewline = cleanText.lastIndexOf("\n");
  const safeSlice =
    cleanText.length >= 60_000 && lastNewline > 0
      ? cleanText.slice(0, lastNewline)
      : cleanText;

  const parsedRows = parseCsvSync(safeSlice, {
    delimiter: detectedDelimiter,
    relax_quotes: true,
    relax_column_count: true,
    skip_empty_lines: true,
    to_line: 35,
  }) as string[][];

  if (parsedRows.length === 0) {
    return {
      detectedDelimiter,
      headers: [],
      previewRows: [],
      proposedMapping: {},
      ambiguousFields: [],
      missingRequiredFields: ["OP_NAME", "TP_NAME", "MESSAGE_TIMESTAMP"],
      hasStatusField: false,
      unmappedHeaders: [],
    };
  }

  const headers = parsedRows[0].map((h) => h.trim());
  const dataRows = parsedRows
    .slice(1)
    .filter((row) => !(row.length === headers.length && row[0]?.trim() === headers[0]))
    .slice(0, 25);

  const previewRows = dataRows.map((row) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = row[idx] ?? "";
    });
    return obj;
  });

  const proposedMapping: ColumnMappingDict = {};
  const fieldMatches = new Map<LogicalField, string[]>();

  for (const header of headers) {
    const norm = normalizeHeaderKey(header);
    let matched: LogicalField | null = null;
    for (const meta of LOGICAL_FIELD_CATALOG) {
      if (meta.aliases.includes(norm) || meta.field.toLowerCase() === norm) {
        matched = meta.field;
        break;
      }
    }
    if (matched) {
      proposedMapping[header] = matched;
      const list = fieldMatches.get(matched) ?? [];
      list.push(header);
      fieldMatches.set(matched, list);
    } else {
      proposedMapping[header] = "IGNORE";
    }
  }

  // Flag fields where multiple columns matched (only if user didn't pick explicitly)
  const ambiguousFields: LogicalField[] = [];
  for (const [field, cols] of fieldMatches.entries()) {
    if (cols.length > 1) {
      ambiguousFields.push(field);
    }
  }

  const mappedSet = new Set(
    Object.values(proposedMapping).filter((v): v is LogicalField => v !== "IGNORE")
  );
  const missingRequiredFields = LOGICAL_FIELD_CATALOG.filter(
    (m) => m.required && !mappedSet.has(m.field)
  ).map((m) => m.field);

  const hasStatusField =
    mappedSet.has("SUBMIT_STATUS") || mappedSet.has("DLR_STATE");
  const unmappedHeaders = headers.filter((h) => proposedMapping[h] === "IGNORE");

  return {
    detectedDelimiter,
    headers,
    previewRows,
    proposedMapping,
    ambiguousFields,
    missingRequiredFields,
    hasStatusField,
    unmappedHeaders,
  };
}
