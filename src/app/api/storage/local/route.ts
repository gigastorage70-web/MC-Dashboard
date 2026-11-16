import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { NextResponse } from "next/server";
import {
  resolveLocalStoragePath,
  verifyLocalStorageToken,
} from "@/lib/storage";

export async function PUT(req: Request) {
  const { searchParams } = new URL(req.url);
  const key = searchParams.get("key") ?? "";
  const exp = Number(searchParams.get("exp") ?? 0);
  const sig = searchParams.get("sig") ?? "";

  if (!key || !sig || !verifyLocalStorageToken("PUT", key, exp, sig)) {
    return NextResponse.json(
      { error: "Invalid or expired upload signature" },
      { status: 403 }
    );
  }
  if (!req.body) {
    return NextResponse.json({ error: "Empty upload body" }, { status: 400 });
  }

  const targetPath = resolveLocalStoragePath(key);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });

  const webStream = req.body as unknown as WebReadableStream<Uint8Array>;
  const nodeStream = Readable.fromWeb(webStream);
  await pipeline(nodeStream, fs.createWriteStream(targetPath));

  return NextResponse.json({ ok: true, key });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const key = searchParams.get("key") ?? "";
  const exp = Number(searchParams.get("exp") ?? 0);
  const sig = searchParams.get("sig") ?? "";
  const filename = searchParams.get("filename") ?? path.basename(key);

  if (!key || !sig || !verifyLocalStorageToken("GET", key, exp, sig)) {
    return NextResponse.json(
      { error: "Invalid or expired download signature" },
      { status: 403 }
    );
  }

  const targetPath = resolveLocalStoragePath(key);
  if (!fs.existsSync(targetPath)) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const fileStream = fs.createReadStream(targetPath);
  const webStream = Readable.toWeb(fileStream) as unknown as BodyInit;

  return new NextResponse(webStream, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
    },
  });
}
