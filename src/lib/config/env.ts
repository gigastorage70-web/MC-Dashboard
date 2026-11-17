import { z } from "zod";

const RawEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  VERCEL: z.string().optional(),
  APP_URL: z.string().default("http://localhost:3000"),
  AUTH_SECRET: z.string().min(16).optional(),

  APP_DB_MODE: z.enum(["sqlite", "postgres"]).optional(),
  SQLITE_PATH: z.string().default("./data/app.sqlite"),
  DATABASE_URL: z.string().optional(),

  ANALYTICS_ENGINE: z.enum(["duckdb", "clickhouse", "tinybird"]).optional(),
  DUCKDB_PATH: z.string().default("./data/analytics.duckdb"),
  DUCKDB_SERVER_URL: z.string().default("http://127.0.0.1:4001"),

  TINYBIRD_API_URL: z
    .string()
    .default("https://api.tinybird.co")
    .transform((v) => v.trim().replace(/\/+$/, "")),
  TINYBIRD_TOKEN: z
    .string()
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined)),
  TINYBIRD_EVENTS_WAIT: z
    .string()
    .optional()
    .transform((v) => v !== "false"),

  CLICKHOUSE_URL: z.string().default("http://localhost:8123"),
  CLICKHOUSE_DATABASE: z.string().default("mc_analytics"),
  CLICKHOUSE_USER: z.string().default("default"),
  CLICKHOUSE_PASSWORD: z.string().default(""),

  QUEUE_MODE: z.enum(["appdb", "postgres", "redis"]).default("appdb"),
  REDIS_URL: z.string().optional(),

  STORAGE_PROVIDER: z.enum(["local", "r2", "minio", "tigris", "neon"]).optional(),
  LOCAL_STORAGE_DIR: z.string().default("./data/storage"),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().default("mc-csv-uploads"),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z
    .string()
    .optional()
    .transform((v) => v === "true"),

  // Neon Object Storage standard AWS env vars
  AWS_ENDPOINT_URL_S3: z.string().optional(),
  AWS_REGION: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),

  WORKER_PORT: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : 4001)),
  WORKER_WEBHOOK_URL: z.string().optional(),
  WORKER_WEBHOOK_SECRET: z.string().optional(),
  DEFAULT_MASK_PII: z
    .string()
    .optional()
    .transform((v) => v === "true"),
});

export interface AppEnv
  extends Omit<
    z.infer<typeof RawEnvSchema>,
    "APP_DB_MODE" | "STORAGE_PROVIDER" | "S3_REGION" | "ANALYTICS_ENGINE" | "WORKER_WEBHOOK_URL"
  > {
  ANALYTICS_ENGINE: "duckdb" | "clickhouse" | "tinybird";
  APP_DB_MODE: "sqlite" | "postgres";
  STORAGE_PROVIDER: "local" | "r2" | "minio" | "tigris" | "neon";
  S3_REGION: string;
  WORKER_WEBHOOK_URL: string;
  isVercel: boolean;
}

let cachedEnv: AppEnv | null = null;

export function resetEnvCache(): void {
  cachedEnv = null;
}

/**
 * Parses server environment variables once with smart cloud/local defaults.
 * Supports S3_* (R2/MinIO/Tigris), AWS_* (Neon Object Storage), and Tinybird.
 */
export function getEnv(): AppEnv {
  if (!cachedEnv) {
    const raw = RawEnvSchema.parse(process.env);
    const hasPgUrl = Boolean(raw.DATABASE_URL && raw.DATABASE_URL.trim().length > 0);
    const hasCustomS3 = Boolean(
      raw.S3_ENDPOINT?.trim() && raw.S3_ACCESS_KEY_ID?.trim()
    );
    const hasNeonS3 = Boolean(
      raw.AWS_ENDPOINT_URL_S3?.trim() && raw.AWS_ACCESS_KEY_ID?.trim()
    );

    const effectiveEngine: AppEnv["ANALYTICS_ENGINE"] =
      raw.ANALYTICS_ENGINE ?? (raw.TINYBIRD_TOKEN ? "tinybird" : "duckdb");

    const provider =
      raw.STORAGE_PROVIDER ??
      (hasCustomS3 ? "r2" : hasNeonS3 ? "neon" : "local");

    const effectiveEndpoint =
      raw.S3_ENDPOINT?.trim() || raw.AWS_ENDPOINT_URL_S3?.trim() || undefined;
    const effectiveAccessKey =
      raw.S3_ACCESS_KEY_ID?.trim() || raw.AWS_ACCESS_KEY_ID?.trim() || undefined;
    const effectiveSecretKey =
      raw.S3_SECRET_ACCESS_KEY?.trim() ||
      raw.AWS_SECRET_ACCESS_KEY?.trim() ||
      undefined;
    const effectiveRegion =
      raw.S3_REGION?.trim() || raw.AWS_REGION?.trim() || "auto";
    const effectiveForcePathStyle =
      provider === "neon" ||
      provider === "minio" ||
      raw.S3_FORCE_PATH_STYLE === true;

    const neonBranchId = process.env.NEON_BRANCH_ID?.trim();
    const neonHostSuffix = process.env.NEON_FUNCTION_HOST_SUFFIX?.trim();
    const autoNeonWebhookUrl =
      neonBranchId && neonHostSuffix
        ? `https://${neonBranchId}-csvworker${neonHostSuffix}/trigger`
        : "";

    const effectiveWebhookUrl =
      raw.WORKER_WEBHOOK_URL?.trim() ||
      autoNeonWebhookUrl ||
      (effectiveEngine === "duckdb" && raw.VERCEL !== "1"
        ? "http://127.0.0.1:4001/trigger"
        : "");

    cachedEnv = {
      ...raw,
      ANALYTICS_ENGINE: effectiveEngine,
      APP_DB_MODE: raw.APP_DB_MODE ?? (hasPgUrl ? "postgres" : "sqlite"),
      STORAGE_PROVIDER: provider,
      S3_ENDPOINT: effectiveEndpoint,
      S3_ACCESS_KEY_ID: effectiveAccessKey,
      S3_SECRET_ACCESS_KEY: effectiveSecretKey,
      S3_REGION: effectiveRegion,
      S3_FORCE_PATH_STYLE: effectiveForcePathStyle,
      WORKER_WEBHOOK_URL: effectiveWebhookUrl,
      isVercel: raw.VERCEL === "1",
    };
  }
  return cachedEnv;
}
