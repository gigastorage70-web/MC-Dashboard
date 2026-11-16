import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { getEnv } from "../config/env";

const globalForS3 = globalThis as unknown as { s3Client?: S3Client };

/**
 * Returns an S3-compatible client configured for Cloudflare R2, MinIO, or Tigris.
 * Disables automatic CRC32 checksum query params on presigned PUT URLs for browser R2 compatibility.
 */
export function getStorageClient(): S3Client {
  if (globalForS3.s3Client) {
    return globalForS3.s3Client;
  }

  const env = getEnv();
  if (!env.S3_ENDPOINT || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
    throw new Error("Object storage credentials (S3_ENDPOINT/KEY/SECRET) are not configured.");
  }

  const client = new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
  });

  if (env.NODE_ENV !== "production") {
    globalForS3.s3Client = client;
  }
  return client;
}

export async function checkStorageHealth(): Promise<{
  ok: boolean;
  provider: string;
  latencyMs: number;
  error?: string;
}> {
  const env = getEnv();
  const started = Date.now();
  try {
    const client = getStorageClient();
    await client.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
    return {
      ok: true,
      provider: env.STORAGE_PROVIDER,
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    return {
      ok: false,
      provider: env.STORAGE_PROVIDER,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : "Object storage check failed",
    };
  }
}
