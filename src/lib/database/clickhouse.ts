import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { getEnv } from "../config/env";

const globalForCh = globalThis as unknown as { chClient?: ClickHouseClient };

/**
 * Returns a shared ClickHouse HTTP client configured for analytical queries.
 */
export function getClickHouseClient(): ClickHouseClient {
  if (globalForCh.chClient) {
    return globalForCh.chClient;
  }

  const env = getEnv();
  const client = createClient({
    url: env.CLICKHOUSE_URL,
    database: env.CLICKHOUSE_DATABASE,
    username: env.CLICKHOUSE_USER,
    password: env.CLICKHOUSE_PASSWORD,
    request_timeout: 15_000,
    max_open_connections: 10,
  });

  if (env.NODE_ENV !== "production") {
    globalForCh.chClient = client;
  }
  return client;
}

export async function checkClickHouseHealth(): Promise<{
  ok: boolean;
  latencyMs: number;
  error?: string;
}> {
  const started = Date.now();
  try {
    const client = getClickHouseClient();
    const res = await client.ping();
    if (!res.success) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        error: res.error ? res.error.message : "ClickHouse ping failed",
      };
    }
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : "ClickHouse connection failed",
    };
  }
}
