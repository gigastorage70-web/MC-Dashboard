import { z } from "zod";

const RawEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  VERCEL: z.string().optional(),
  APP_URL: z.string().default("http://localhost:3000"),
  AUTH_SECRET: z.string().min(16).optional(),

  APP_DB_MODE: z.enum(["sqlite", "postgres"]).optional(),
  SQLITE_PATH: z.string().default("./data/app.sqlite"),
  DATABASE_URL: z.string().optional(),

  ANALYTICS_ENGINE: z.enum(["duckdb", "clickhouse"]).default("duckdb"),
  DUCKDB_PATH: z.string().default("./data/analytics.duckdb"),
  DUCKDB_SERVER_URL: z.string().default("http://127.0.0.1:4001"),

  CLICKHOUSE_URL: z.string().default("http://localhost:8123"),
  CLICKHOUSE_DATABASE: z.string().default("mc_analytics"),
  CLICKHOUSE_USER: z.string().default("default"),
  CLICKHOUSE_PASSWORD: z.string().default(""),

  QUEUE_MODE: z.enum(["appdb", "postgres", "redis"]).default("appdb"),
  REDIS_URL: z.string().optional(),

  STORAGE_PROVIDER: z.enum(["local", "r2", "minio", "tigris"]).optional(),
  LOCAL_STORAGE_DIR: z.string().default("./data/storage"),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: z.string().default("mc-csv-uploads"),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z
    .string()
    .optional()
    .transform((v) => v === "true"),

  WORKER_PORT: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : 4001)),
  WORKER_WEBHOOK_URL: z.string().default("http://127.0.0.1:4001/trigger"),
  WORKER_WEBHOOK_SECRET: z.string().optional(),
  DEFAULT_MASK_PII: z
    .string()
    .optional()
    .transform((v) => v === "true"),
});

export interface AppEnv extends Omit<z.infer<typeof RawEnvSchema>, "APP_DB_MODE" | "STORAGE_PROVIDER"> {
  APP_DB_MODE: "sqlite" | "postgres";
  STORAGE_PROVIDER: "local" | "r2" | "minio" | "tigris";
  isVercel: boolean;
}

let cachedEnv: AppEnv | null = null;

/**
 * Parses server environment variables once with smart cloud/local defaults.
 * Never import this file into Client Components.
 */
export function getEnv(): AppEnv {
  if (!cachedEnv) {
    const raw = RawEnvSchema.parse(process.env);
    const hasPgUrl = Boolean(raw.DATABASE_URL && raw.DATABASE_URL.trim().length > 0);
    const hasS3Creds = Boolean(
      raw.S3_ENDPOINT &&
        raw.S3_ENDPOINT.trim().length > 0 &&
        raw.S3_ACCESS_KEY_ID &&
        raw.S3_ACCESS_KEY_ID.trim().length > 0
    );

    cachedEnv = {
      ...raw,
      APP_DB_MODE: raw.APP_DB_MODE ?? (hasPgUrl ? "postgres" : "sqlite"),
      STORAGE_PROVIDER: raw.STORAGE_PROVIDER ?? (hasS3Creds ? "r2" : "local"),
      isVercel: raw.VERCEL === "1",
    };
  }
  return cachedEnv;
}
