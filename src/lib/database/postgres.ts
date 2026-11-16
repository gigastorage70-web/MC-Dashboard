import { Pool, type PoolConfig } from "pg";
import { getEnv } from "../config/env";

const globalForPg = globalThis as unknown as { pgPool?: Pool };

/**
 * Returns a shared PostgreSQL connection pool configured for Neon Free Tier or local Docker.
 */
export function getPostgresPool(): Pool {
  if (globalForPg.pgPool) {
    return globalForPg.pgPool;
  }

  const env = getEnv();
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured in environment variables.");
  }

  const needsSsl =
    env.DATABASE_URL.includes("neon.tech") ||
    env.DATABASE_URL.includes("sslmode=require");

  const config: PoolConfig = {
    connectionString: env.DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 15_000,
    connectionTimeoutMillis: 5_000,
    ssl: needsSsl ? { rejectUnauthorized: true } : undefined,
  };

  const pool = new Pool(config);
  if (env.NODE_ENV !== "production") {
    globalForPg.pgPool = pool;
  }
  return pool;
}

export async function checkPostgresHealth(): Promise<{
  ok: boolean;
  latencyMs: number;
  error?: string;
}> {
  const started = Date.now();
  try {
    const pool = getPostgresPool();
    await pool.query("SELECT 1");
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : "PostgreSQL connection failed",
    };
  }
}
