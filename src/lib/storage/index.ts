import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getEnv } from "../config/env";
import { getStorageClient } from "./s3";

function getSigningSecret(): string {
  const env = getEnv();
  return env.AUTH_SECRET ?? env.WORKER_WEBHOOK_SECRET ?? "local-dev-storage-signing-key";
}

export function resolveLocalStoragePath(key: string): string {
  const env = getEnv();
  const baseDir = path.resolve(process.cwd(), env.LOCAL_STORAGE_DIR);
  const cleanRel = key.replace(/^[/\\]+/, "");
  const full = path.resolve(baseDir, cleanRel);
  if (!full.startsWith(baseDir + path.sep) && full !== baseDir) {
    throw new Error("Invalid storage key path traversal rejected.");
  }
  return full;
}

export function signLocalStorageToken(
  method: "PUT" | "GET",
  key: string,
  expEpochSec: number
): string {
  return crypto
    .createHmac("sha256", getSigningSecret())
    .update(`${method}:${key}:${expEpochSec}`)
    .digest("hex");
}

export function verifyLocalStorageToken(
  method: "PUT" | "GET",
  key: string,
  expEpochSec: number,
  sig: string
): boolean {
  if (Math.floor(Date.now() / 1000) > expEpochSec) return false;
  const expected = signLocalStorageToken(method, key, expEpochSec);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(sig, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function createPresignedUploadTarget(params: {
  bucket: string;
  key: string;
  contentType: string;
  expiresInSeconds?: number;
}): Promise<string> {
  const env = getEnv();
  const ttl = params.expiresInSeconds ?? 900;

  if (env.STORAGE_PROVIDER === "local") {
    const exp = Math.floor(Date.now() / 1000) + ttl;
    const sig = signLocalStorageToken("PUT", params.key, exp);
    return `/api/storage/local?key=${encodeURIComponent(params.key)}&exp=${exp}&sig=${sig}`;
  }

  const s3 = getStorageClient();
  return getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: params.bucket,
      Key: params.key,
      ContentType: params.contentType,
    }),
    { expiresIn: ttl }
  );
}

export async function createPresignedDownloadTarget(params: {
  bucket: string;
  key: string;
  filename: string;
  expiresInSeconds?: number;
}): Promise<string> {
  const env = getEnv();
  const ttl = params.expiresInSeconds ?? 900;

  if (env.STORAGE_PROVIDER === "local") {
    const exp = Math.floor(Date.now() / 1000) + ttl;
    const sig = signLocalStorageToken("GET", params.key, exp);
    return `/api/storage/local?key=${encodeURIComponent(params.key)}&exp=${exp}&sig=${sig}&filename=${encodeURIComponent(params.filename)}`;
  }

  const s3 = getStorageClient();
  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: params.bucket,
      Key: params.key,
      ResponseContentDisposition: `attachment; filename="${params.filename}"`,
    }),
    { expiresIn: ttl }
  );
}

export async function verifyObjectExists(
  bucket: string,
  key: string
): Promise<boolean> {
  const env = getEnv();
  if (env.STORAGE_PROVIDER === "local") {
    const full = resolveLocalStoragePath(key);
    return fs.existsSync(full);
  }
  try {
    const s3 = getStorageClient();
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

export async function putStorageObject(params: {
  bucket: string;
  key: string;
  body: string | Buffer | Readable;
  contentType: string;
}): Promise<void> {
  const env = getEnv();
  if (env.STORAGE_PROVIDER === "local") {
    const full = resolveLocalStoragePath(params.key);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    if (params.body instanceof Readable) {
      await new Promise<void>((resolve, reject) => {
        const ws = fs.createWriteStream(full);
        (params.body as Readable).pipe(ws);
        ws.on("finish", resolve);
        ws.on("error", reject);
      });
    } else {
      fs.writeFileSync(full, params.body);
    }
    return;
  }

  const s3 = getStorageClient();
  await s3.send(
    new PutObjectCommand({
      Bucket: params.bucket,
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
    })
  );
}

export async function getStorageObjectStream(params: {
  bucket: string;
  key: string;
}): Promise<{ stream: Readable; contentLength: number }> {
  const env = getEnv();
  if (env.STORAGE_PROVIDER === "local") {
    const full = resolveLocalStoragePath(params.key);
    const stat = fs.statSync(full);
    return {
      stream: fs.createReadStream(full),
      contentLength: stat.size,
    };
  }

  const s3 = getStorageClient();
  const obj = await s3.send(
    new GetObjectCommand({ Bucket: params.bucket, Key: params.key })
  );
  if (!obj.Body) {
    throw new Error("Object body missing in S3/R2 storage");
  }
  return {
    stream: obj.Body as Readable,
    contentLength: Number(obj.ContentLength ?? 0),
  };
}

export interface StoredObjectInfo {
  key: string;
  sizeBytes: number;
  lastModified: string | null;
}

function walkLocalFiles(dir: string, rootDir: string, out: StoredObjectInfo[]): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkLocalFiles(full, rootDir, out);
    } else if (entry.isFile()) {
      const stat = fs.statSync(full);
      const rel = path.relative(rootDir, full).replace(/\\/g, "/");
      out.push({
        key: rel,
        sizeBytes: stat.size,
        lastModified: stat.mtime.toISOString(),
      });
    }
  }
}

export async function listStorageObjects(
  bucket: string,
  prefix = ""
): Promise<StoredObjectInfo[]> {
  const env = getEnv();
  if (env.STORAGE_PROVIDER === "local") {
    const baseDir = path.resolve(process.cwd(), env.LOCAL_STORAGE_DIR);
    const items: StoredObjectInfo[] = [];
    walkLocalFiles(baseDir, baseDir, items);
    return prefix ? items.filter((item) => item.key.startsWith(prefix)) : items;
  }

  const s3 = getStorageClient();
  const items: StoredObjectInfo[] = [];
  let continuationToken: string | undefined;

  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix || undefined,
        ContinuationToken: continuationToken,
      })
    );
    for (const obj of res.Contents ?? []) {
      if (!obj.Key) continue;
      items.push({
        key: obj.Key,
        sizeBytes: Number(obj.Size ?? 0),
        lastModified: obj.LastModified ? obj.LastModified.toISOString() : null,
      });
    }
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);

  return items;
}

export async function deleteStorageKeys(
  bucket: string,
  keys: string[]
): Promise<number> {
  const uniqueKeys = Array.from(new Set(keys.filter((k) => k && k.trim().length > 0)));
  if (uniqueKeys.length === 0) return 0;

  const env = getEnv();
  if (env.STORAGE_PROVIDER === "local") {
    let deleted = 0;
    for (const key of uniqueKeys) {
      const full = resolveLocalStoragePath(key);
      if (fs.existsSync(full)) {
        fs.unlinkSync(full);
        deleted += 1;
      }
    }
    return deleted;
  }

  const s3 = getStorageClient();
  let deleted = 0;
  for (let i = 0; i < uniqueKeys.length; i += 1000) {
    const chunk = uniqueKeys.slice(i, i + 1000);
    try {
      const res = await s3.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: chunk.map((Key) => ({ Key })),
            Quiet: true,
          },
        })
      );
      deleted += chunk.length - (res.Errors?.length ?? 0);
    } catch {
      for (const Key of chunk) {
        await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key })).catch(() => undefined);
        deleted += 1;
      }
    }
  }
  return deleted;
}

export async function deleteStoragePrefix(
  bucket: string,
  prefix: string
): Promise<number> {
  if (
    !prefix ||
    (!prefix.startsWith("uploads/") && !prefix.startsWith("error-reports/"))
  ) {
    throw new Error(`Unsafe storage prefix delete blocked: "${prefix}"`);
  }
  const objects = await listStorageObjects(bucket, prefix);
  return deleteStorageKeys(
    bucket,
    objects.map((o) => o.key)
  );
}

export async function deleteStorageObject(
  bucket: string,
  key: string
): Promise<void> {
  const env = getEnv();
  if (env.STORAGE_PROVIDER === "local") {
    const full = resolveLocalStoragePath(key);
    if (fs.existsSync(full)) fs.unlinkSync(full);
    return;
  }
  const s3 = getStorageClient();
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

export async function checkUnifiedStorageHealth(): Promise<{
  ok: boolean;
  provider: string;
  latencyMs: number;
  error?: string;
}> {
  const env = getEnv();
  const started = Date.now();
  if (env.STORAGE_PROVIDER === "local") {
    try {
      const dir = path.resolve(process.cwd(), env.LOCAL_STORAGE_DIR);
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK);
      return { ok: true, provider: "local", latencyMs: Date.now() - started };
    } catch (err) {
      return {
        ok: false,
        provider: "local",
        latencyMs: Date.now() - started,
        error: err instanceof Error ? err.message : "Local storage dir inaccessible",
      };
    }
  }
  const { checkStorageHealth } = await import("./s3");
  return checkStorageHealth();
}
