import { getEnv } from "../config/env";
import { getClickHouseClient } from "./clickhouse";

export type AnalyticsEngine = "duckdb" | "clickhouse";

export function getAnalyticsEngine(): AnalyticsEngine {
  return getEnv().ANALYTICS_ENGINE;
}

/**
 * Executes a parameterized analytical query against either DuckDB (via worker HTTP bridge)
 * or ClickHouse HTTP API.
 */
export async function queryAnalytics<T = Record<string, unknown>>(
  sql: string,
  params: Record<string, unknown> = {}
): Promise<T[]> {
  const env = getEnv();

  if (env.ANALYTICS_ENGINE === "duckdb") {
    const res = await fetch(`${env.DUCKDB_SERVER_URL}/duckdb/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(env.WORKER_WEBHOOK_SECRET
          ? { "x-worker-secret": env.WORKER_WEBHOOK_SECRET }
          : {}),
      },
      body: JSON.stringify({ sql, params }),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    const data = (await res.json()) as { rows?: T[]; error?: string };
    if (!res.ok) {
      throw new Error(data.error ?? `DuckDB query failed with HTTP ${res.status}`);
    }
    return data.rows ?? [];
  }

  const ch = getClickHouseClient();
  const result = await ch.query({
    query: sql,
    query_params: params,
    format: "JSONEachRow",
  });
  return result.json<T>();
}

/**
 * Executes a DDL/DML command (such as safe dataset deletion) on ClickHouse or DuckDB.
 */
export async function commandAnalytics(
  sql: string,
  params: Record<string, unknown> = {}
): Promise<void> {
  const env = getEnv();
  if (env.ANALYTICS_ENGINE === "duckdb") {
    await queryAnalytics(sql, params);
    return;
  }
  const ch = getClickHouseClient();
  await ch.command({ query: sql, query_params: params });
}

export async function checkAnalyticsHealth(): Promise<{
  ok: boolean;
  engine: AnalyticsEngine;
  latencyMs: number;
  error?: string;
}> {
  const env = getEnv();
  const started = Date.now();
  if (env.ANALYTICS_ENGINE === "duckdb") {
    try {
      const res = await fetch(`${env.DUCKDB_SERVER_URL}/duckdb/health`, {
        cache: "no-store",
        signal: AbortSignal.timeout(4_000),
      });
      if (!res.ok) {
        return {
          ok: false,
          engine: "duckdb",
          latencyMs: Date.now() - started,
          error: `Worker DuckDB endpoint returned HTTP ${res.status}`,
        };
      }
      return { ok: true, engine: "duckdb", latencyMs: Date.now() - started };
    } catch (err) {
      return {
        ok: false,
        engine: "duckdb",
        latencyMs: Date.now() - started,
        error:
          err instanceof Error
            ? `${err.message} (Ensure worker is running: npm run worker:dev)`
            : "DuckDB worker unreachable",
      };
    }
  }

  try {
    const ch = getClickHouseClient();
    const ping = await ch.ping();
    if (!ping.success) {
      return {
        ok: false,
        engine: "clickhouse",
        latencyMs: Date.now() - started,
        error: ping.error?.message ?? "ClickHouse ping failed",
      };
    }
    return { ok: true, engine: "clickhouse", latencyMs: Date.now() - started };
  } catch (err) {
    return {
      ok: false,
      engine: "clickhouse",
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : "ClickHouse connection failed",
    };
  }
}
