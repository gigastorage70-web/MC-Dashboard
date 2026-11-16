import fs from "node:fs";
import path from "node:path";
import type { Pool, PoolClient } from "pg";
import { getEnv } from "../config/env";
import { getPostgresPool } from "./postgres";

export interface AppQueryResult<T = Record<string, unknown>> {
  rows: T[];
}

export interface AppDbClient {
  isSqlite: boolean;
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<AppQueryResult<T>>;
}

interface SqliteDatabaseSync {
  exec(sql: string): void;
  prepare(sql: string): {
    all(...params: unknown[]): Record<string, unknown>[];
  };
}

const globalForSqlite = globalThis as unknown as {
  sqliteDb?: SqliteDatabaseSync;
  sqliteInitialized?: boolean;
  pgSchemaInitialized?: boolean;
};

async function ensurePostgresSchemaInitialized(): Promise<void> {
  if (globalForSqlite.pgSchemaInitialized) return;
  const pool = getPostgresPool();
  const check = await pool.query<{ tbl: string | null }>(
    "SELECT to_regclass('public.users') AS tbl"
  );
  if (check.rows[0]?.tbl) {
    globalForSqlite.pgSchemaInitialized = true;
    return;
  }

  const schemaPath = path.resolve(
    process.cwd(),
    "database/postgres/001_initial_schema.sql"
  );
  if (!fs.existsSync(schemaPath)) {
    throw new Error("Missing database/postgres/001_initial_schema.sql");
  }

  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(739104)");
    const recheck = await client.query<{ tbl: string | null }>(
      "SELECT to_regclass('public.users') AS tbl"
    );
    if (!recheck.rows[0]?.tbl) {
      await client.query(fs.readFileSync(schemaPath, "utf8"));
    }
    globalForSqlite.pgSchemaInitialized = true;
  } finally {
    await client.query("SELECT pg_advisory_unlock(739104)").catch(() => undefined);
    client.release();
  }
}

function getSqliteDb(): SqliteDatabaseSync {
  const env = getEnv();
  if (env.isVercel) {
    throw new Error(
      "DATABASE_URL is missing on Vercel. Local SQLite cannot persist across serverless invocations — link Neon Free PostgreSQL in Vercel Storage (or set DATABASE_URL) and redeploy."
    );
  }
  if (globalForSqlite.sqliteDb) {
    return globalForSqlite.sqliteDb;
  }
  const resolved = path.resolve(process.cwd(), env.SQLITE_PATH);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });

  // Load built-in node:sqlite via process.getBuiltinModule so Turbopack/Webpack never attempt to bundle node: URLs
  const sqliteMod = (
    process as unknown as {
      getBuiltinModule?: (name: string) => {
        DatabaseSync: new (path: string) => SqliteDatabaseSync;
      };
    }
  ).getBuiltinModule?.("node:sqlite");
  if (!sqliteMod) {
    throw new Error(
      "Built-in node:sqlite requires Node.js 22.5+ (current: " + process.version + ")"
    );
  }
  const db = new sqliteMod.DatabaseSync(resolved);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA foreign_keys = ON;");

  if (!globalForSqlite.sqliteInitialized) {
    const schemaPath = path.resolve(
      process.cwd(),
      "database/sqlite/001_initial_schema.sql"
    );
    if (fs.existsSync(schemaPath)) {
      db.exec(fs.readFileSync(schemaPath, "utf8"));
    }
    globalForSqlite.sqliteInitialized = true;
  }

  globalForSqlite.sqliteDb = db;
  return db;
}

/**
 * Safely translates standard PostgreSQL-style $1 placeholders, NOW(), and ::casts to SQLite syntax.
 */
function translateSqlForSqlite(sql: string): string {
  let out = "";
  let inSingleQuote = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") {
      inSingleQuote = !inSingleQuote;
      out += ch;
      continue;
    }
    if (!inSingleQuote && ch === "$" && /\d/.test(sql[i + 1] ?? "")) {
      let digits = "";
      let j = i + 1;
      while (j < sql.length && /\d/.test(sql[j])) {
        digits += sql[j];
        j++;
      }
      out += `?${digits}`;
      i = j - 1;
      continue;
    }
    out += ch;
  }

  return out
    .replace(/\bNOW\(\)/gi, "CURRENT_TIMESTAMP")
    .replace(/::(jsonb|int|bigint|text|boolean)\b/gi, "");
}

function normalizeSqliteParams(params: unknown[]): unknown[] {
  return params.map((p) => {
    if (p === undefined || p === null) return null;
    if (typeof p === "boolean") return p ? 1 : 0;
    if (p instanceof Date) return p.toISOString();
    return p;
  });
}

function createSqliteClient(db: SqliteDatabaseSync): AppDbClient {
  return {
    isSqlite: true,
    async query<T = Record<string, unknown>>(
      sql: string,
      params: unknown[] = []
    ): Promise<AppQueryResult<T>> {
      const translated = translateSqlForSqlite(sql);
      const stmt = db.prepare(translated);
      const rawRows = stmt.all(...normalizeSqliteParams(params));
      return { rows: rawRows.map((r) => ({ ...r })) as T[] };
    },
  };
}

function createPgClient(pool: Pool | PoolClient): AppDbClient {
  return {
    isSqlite: false,
    async query<T = Record<string, unknown>>(
      sql: string,
      params: unknown[] = []
    ): Promise<AppQueryResult<T>> {
      const res = await pool.query(sql, params);
      return { rows: res.rows as T[] };
    },
  };
}

export function isSqliteMode(): boolean {
  return getEnv().APP_DB_MODE === "sqlite";
}

export async function appQuery<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<AppQueryResult<T>> {
  if (isSqliteMode()) {
    const db = getSqliteDb();
    return createSqliteClient(db).query<T>(sql, params);
  }
  await ensurePostgresSchemaInitialized();
  const pool = getPostgresPool();
  return createPgClient(pool).query<T>(sql, params);
}

export async function appTransaction<T>(
  fn: (tx: AppDbClient) => Promise<T>
): Promise<T> {
  if (isSqliteMode()) {
    const db = getSqliteDb();
    db.exec("BEGIN IMMEDIATE");
    try {
      const res = await fn(createSqliteClient(db));
      db.exec("COMMIT");
      return res;
    } catch (err) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // ignore rollback error
      }
      throw err;
    }
  }

  await ensurePostgresSchemaInitialized();
  const pool = getPostgresPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await fn(createPgClient(client));
    await client.query("COMMIT");
    return res;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function checkAppDbHealth(): Promise<{
  ok: boolean;
  engine: "sqlite" | "postgres";
  latencyMs: number;
  error?: string;
}> {
  const started = Date.now();
  const engine = isSqliteMode() ? "sqlite" : "postgres";
  try {
    await appQuery("SELECT 1 AS ok");
    return { ok: true, engine, latencyMs: Date.now() - started };
  } catch (err) {
    return {
      ok: false,
      engine,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : "App DB connection failed",
    };
  }
}

export function parseJsonField<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

export function asBool(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}
