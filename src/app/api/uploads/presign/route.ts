import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getEnv } from "@/lib/config/env";
import { appQuery, appTransaction } from "@/lib/database/app-db";
import { createPresignedUploadTarget } from "@/lib/storage";
import {
  requireApiSession,
  writeAuditLog,
} from "@/modules/authentication/service";

const PresignUploadSchema = z.object({
  fileName: z.string().min(1).max(400),
  fileSizeBytes: z.number().int().positive().max(2 * 1024 * 1024 * 1024),
  datasetName: z.string().min(2).max(200),
  description: z.string().max(1000).optional(),
  schemaProfileId: z.string().uuid().optional().nullable(),
  isCompressed: z.boolean().default(false),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

export async function POST(req: Request) {
  const auth = await requireApiSession(["admin", "analyst"]);
  if (!auth.ok) return auth.response;

  const body = await req.json();
  const parsed = PresignUploadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid upload request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const lower = parsed.data.fileName.toLowerCase();
  if (!lower.endsWith(".csv") && !lower.endsWith(".csv.gz")) {
    return NextResponse.json(
      { error: "Only .csv and .csv.gz MediaCore exports are supported." },
      { status: 400 }
    );
  }

  const env = getEnv();
  const idempotencyKey = parsed.data.idempotencyKey ?? crypto.randomUUID();
  const existing = await appQuery<{
    id: string;
    queue_status: string;
  }>(
    "SELECT id, queue_status FROM upload_jobs WHERE idempotency_key = $1",
    [idempotencyKey]
  );

  if (
    existing.rows.length > 0 &&
    existing.rows[0].queue_status !== "AWAITING_UPLOAD"
  ) {
    return NextResponse.json(
      {
        error: "An upload with this idempotency key has already been submitted.",
        existingJobId: existing.rows[0].id,
      },
      { status: 409 }
    );
  }

  const datasetId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const storageKey = `uploads/${datasetId}/${jobId}-${sanitizeFileName(parsed.data.fileName)}`;

  await appTransaction(async (tx) => {
    await tx.query(
      `
      INSERT INTO datasets (id, name, description, schema_profile_id, status, created_by)
      VALUES ($1, $2, $3, $4, 'UPLOADING', $5)
      `,
      [
        datasetId,
        parsed.data.datasetName.trim(),
        parsed.data.description ?? null,
        parsed.data.schemaProfileId ?? null,
        auth.session.userId,
      ]
    );

    await tx.query(
      `
      INSERT INTO upload_jobs (
        id, dataset_id, idempotency_key, file_name, file_size_bytes,
        storage_provider, storage_bucket, storage_key, is_compressed,
        schema_profile_id, stage, stage_label, progress_pct, queue_status, uploaded_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1, 'Upload initiated', 0, 'AWAITING_UPLOAD', $11)
      `,
      [
        jobId,
        datasetId,
        idempotencyKey,
        parsed.data.fileName,
        parsed.data.fileSizeBytes,
        env.STORAGE_PROVIDER,
        env.S3_BUCKET,
        storageKey,
        parsed.data.isCompressed || lower.endsWith(".gz"),
        parsed.data.schemaProfileId ?? null,
        auth.session.userId,
      ]
    );

    await tx.query(
      `
      INSERT INTO processing_logs (upload_job_id, dataset_id, level, stage, message, metadata)
      VALUES ($1, $2, 'INFO', 1, 'Presigned upload target issued', $3)
      `,
      [
        jobId,
        datasetId,
        JSON.stringify({
          fileName: parsed.data.fileName,
          sizeBytes: parsed.data.fileSizeBytes,
          storageProvider: env.STORAGE_PROVIDER,
        }),
      ]
    );
  });

  const expiresInSeconds = 900;
  const uploadUrl = await createPresignedUploadTarget({
    bucket: env.S3_BUCKET,
    key: storageKey,
    contentType: lower.endsWith(".gz") ? "application/gzip" : "text/csv",
    expiresInSeconds,
  });

  await writeAuditLog({
    actorUserId: auth.session.userId,
    actorEmail: auth.session.email,
    action: "UPLOAD_PRESIGNED",
    resourceType: "upload_jobs",
    resourceId: jobId,
    details: {
      datasetId,
      fileName: parsed.data.fileName,
      fileSizeBytes: parsed.data.fileSizeBytes,
    },
  });

  return NextResponse.json(
    {
      jobId,
      datasetId,
      uploadUrl,
      storageKey,
      expiresInSeconds,
      idempotencyKey,
    },
    { status: 201 }
  );
}
