import zlib from "node:zlib";
import { z } from "zod";
import { getEnv } from "../config/env";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PLACEHOLDER_REGEX = /\{([a-zA-Z_][a-zA-Z0-9_]*):([a-zA-Z0-9_()]+)\}/g;

const ALLOWED_DATASOURCES = new Set([
  "sms_records",
  "sms_hourly_rollup",
  "ingestion_batches",
]);

function assertTinybirdConfig(): { apiUrl: string; token: string } {
  const env = getEnv();
  if (!env.TINYBIRD_TOKEN) {
    throw new Error(
      "TINYBIRD_TOKEN is missing. Add TINYBIRD_TOKEN and TINYBIRD_API_URL to your environment variables."
    );
  }
  return {
    apiUrl: env.TINYBIRD_API_URL,
    token: env.TINYBIRD_TOKEN,
  };
}

function encodeClickHouseStringLiteral(value: string): string {
  if (value.length === 0) return "''";
  const hex = Buffer.from(value, "utf8").toString("hex");
  return `unhex('${hex}')`;
}

function formatTypedLiteral(typeName: string, rawVal: unknown, paramName: string): string {
  if (typeName === "String") {
    if (rawVal === undefined || rawVal === null) {
      throw new Error(`Missing String query parameter: ${paramName}`);
    }
    return encodeClickHouseStringLiteral(String(rawVal));
  }

  if (typeName === "UUID") {
    const s = String(rawVal ?? "").trim();
    if (!UUID_REGEX.test(s)) {
      throw new Error(`Invalid UUID query parameter "${paramName}"`);
    }
    return `toUUID('${s.toLowerCase()}')`;
  }

  if (
    typeName === "UInt8" ||
    typeName === "UInt16" ||
    typeName === "UInt32" ||
    typeName === "UInt64" ||
    typeName === "Int32" ||
    typeName === "Int64"
  ) {
    const n = typeof rawVal === "number" ? rawVal : Number(rawVal);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      throw new Error(`Invalid integer query parameter "${paramName}"`);
    }
    if (typeName.startsWith("U") && n < 0) {
      throw new Error(`Negative value rejected for unsigned parameter "${paramName}"`);
    }
    return String(n);
  }

  if (typeName === "Float32" || typeName === "Float64") {
    const n = typeof rawVal === "number" ? rawVal : Number(rawVal);
    if (!Number.isFinite(n)) {
      throw new Error(`Invalid float query parameter "${paramName}"`);
    }
    return String(n);
  }

  if (typeName === "Array(String)") {
    if (!Array.isArray(rawVal)) {
      throw new Error(`Expected array for parameter "${paramName}"`);
    }
    if (rawVal.length === 0) {
      return "CAST([] AS Array(String))";
    }
    const jsonHex = Buffer.from(
      JSON.stringify(rawVal.map((v) => String(v))),
      "utf8"
    ).toString("hex");
    return `JSONExtract(unhex('${jsonHex}'), 'Array(String)')`;
  }

  if (typeName === "Array(UUID)") {
    if (!Array.isArray(rawVal)) {
      throw new Error(`Expected array for UUID parameter "${paramName}"`);
    }
    if (rawVal.length === 0) {
      return "CAST([] AS Array(UUID))";
    }
    const items = rawVal.map((v) => {
      const s = String(v ?? "").trim();
      if (!UUID_REGEX.test(s)) {
        throw new Error(`Invalid UUID inside array parameter "${paramName}"`);
      }
      return `'${s.toLowerCase()}'`;
    });
    return `CAST([${items.join(",")}] AS Array(UUID))`;
  }

  throw new Error(`Unsupported ClickHouse/Tinybird parameter type: ${typeName}`);
}

/**
 * Replaces ClickHouse typed placeholders (`{name:Type}`) with strictly validated,
 * SQL-injection-safe ClickHouse literals compatible with Tinybird `/v0/sql`.
 */
export function bindTinybirdSqlParams(
  sql: string,
  params: Record<string, unknown> = {}
): string {
  return sql.replace(PLACEHOLDER_REGEX, (_match, name: string, typeName: string) => {
    if (!(name in params)) {
      throw new Error(`Missing required query parameter: ${name}`);
    }
    return formatTypedLiteral(typeName, params[name], name);
  });
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxAttempts = 3
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, init);
      if ((res.status === 429 || res.status >= 500) && attempt < maxAttempts) {
        const waitMs = Math.min(4000, 350 * Math.pow(2, attempt - 1));
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        const waitMs = Math.min(4000, 350 * Math.pow(2, attempt - 1));
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Tinybird request failed");
}

/**
 * Executes an analytical ClickHouse SQL query through Tinybird Query API (`POST /v0/sql`).
 */
export async function queryTinybird<T = Record<string, unknown>>(
  sql: string,
  params: Record<string, unknown> = {}
): Promise<T[]> {
  const { apiUrl, token } = assertTinybirdConfig();
  const boundSql = bindTinybirdSqlParams(sql, params).trim().replace(/;+\s*$/, "");
  const finalSql = /\bFORMAT\s+JSON\b/i.test(boundSql)
    ? boundSql
    : `${boundSql}\nFORMAT JSON`;

  const res = await fetchWithRetry(
    `${apiUrl}/v0/sql`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ q: finalSql }).toString(),
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    },
    2
  );

  const text = await res.text();
  let parsed: { data?: T[]; error?: string } | null = null;
  try {
    parsed = JSON.parse(text) as { data?: T[]; error?: string };
  } catch {
    // Non-JSON error response handled below
  }

  if (!res.ok) {
    if (res.status === 429) {
      throw new Error(
        "Tinybird Free plan query rate/daily quota reached (HTTP 429). Please retry shortly."
      );
    }
    throw new Error(
      parsed?.error ??
        (text ? `Tinybird SQL error (HTTP ${res.status}): ${text.slice(0, 300)}` : `Tinybird HTTP ${res.status}`)
    );
  }

  return parsed?.data ?? [];
}

/**
 * Streams gzipped NDJSON chunks to Tinybird Events API (`POST /v0/events`), staying strictly under 10 MB/request.
 */
export async function ingestTinybirdEvents<T extends object>(params: {
  datasource: "sms_records" | "sms_hourly_rollup" | "ingestion_batches";
  rows: T[];
  wait?: boolean;
}): Promise<void> {
  if (params.rows.length === 0) return;
  const { apiUrl, token } = assertTinybirdConfig();
  const env = getEnv();
  const wait = params.wait ?? env.TINYBIRD_EVENTS_WAIT;

  const MAX_UNCOMPRESSED_BYTES = 3_500_000;
  const chunks: string[] = [];
  let lines: string[] = [];
  let bytes = 0;

  for (const row of params.rows) {
    const line = `${JSON.stringify(row)}\n`;
    const lineBytes = Buffer.byteLength(line, "utf8");
    if (bytes > 0 && bytes + lineBytes > MAX_UNCOMPRESSED_BYTES) {
      chunks.push(lines.join(""));
      lines = [];
      bytes = 0;
    }
    lines.push(line);
    bytes += lineBytes;
  }
  if (lines.length > 0) {
    chunks.push(lines.join(""));
  }

  for (const ndjson of chunks) {
    const gz = zlib.gzipSync(Buffer.from(ndjson, "utf8"));
    const res = await fetchWithRetry(
      `${apiUrl}/v0/events?name=${encodeURIComponent(params.datasource)}&wait=${wait ? "true" : "false"}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/x-ndjson",
          "Content-Encoding": "gzip",
        },
        body: gz,
        signal: AbortSignal.timeout(45_000),
      },
      3
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(
        `Tinybird ingestion into "${params.datasource}" failed (HTTP ${res.status}): ${errText.slice(0, 400)}`
      );
    }
  }
}

/**
 * Deletes all rows for a dataset from a Tinybird Data Source using lightweight delete (`/v1/datasources/{name}/delete`).
 */
export async function deleteTinybirdDatasetRows(
  datasource: "sms_records" | "sms_hourly_rollup" | "ingestion_batches",
  datasetId: string
): Promise<void> {
  if (!ALLOWED_DATASOURCES.has(datasource)) {
    throw new Error(`Invalid Tinybird datasource: ${datasource}`);
  }
  const cleanId = z.string().uuid().parse(datasetId).toLowerCase();
  const { apiUrl, token } = assertTinybirdConfig();
  const body = new URLSearchParams({
    delete_condition: `dataset_id='${cleanId}'`,
    wait: "true",
  }).toString();

  let res = await fetchWithRetry(
    `${apiUrl}/v1/datasources/${datasource}/delete`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      signal: AbortSignal.timeout(30_000),
    },
    2
  );

  if (res.status === 404 || res.status === 405) {
    res = await fetchWithRetry(
      `${apiUrl}/v0/datasources/${datasource}/delete`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          delete_condition: `dataset_id='${cleanId}'`,
        }).toString(),
        signal: AbortSignal.timeout(30_000),
      },
      2
    );
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(
      `Failed to delete dataset rows from Tinybird "${datasource}" (HTTP ${res.status}): ${errText.slice(0, 300)}`
    );
  }
}

export async function checkTinybirdHealth(): Promise<{
  ok: boolean;
  latencyMs: number;
  error?: string;
}> {
  const started = Date.now();
  try {
    const { apiUrl, token } = assertTinybirdConfig();
    const res = await fetch(`${apiUrl}/v0/datasources`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return {
        ok: false,
        latencyMs: Date.now() - started,
        error: `Tinybird auth/API check failed (HTTP ${res.status}): ${txt.slice(0, 200)}`,
      };
    }

    const payload = (await res.json()) as {
      datasources?: Array<{ name: string }>;
    };
    const names = new Set((payload.datasources ?? []).map((d) => d.name));
    const missing = ["sms_records", "sms_hourly_rollup", "ingestion_batches"].filter(
      (n) => !names.has(n)
    );
    if (missing.length > 0) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        error: `Tinybird connected, but Data Sources missing: ${missing.join(", ")}. Run npm run tinybird:setup or tb deploy.`,
      };
    }

    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : "Tinybird connection failed",
    };
  }
}
