import { NextResponse } from "next/server";
import { z } from "zod";
import {
  requireApiSession,
  writeAuditLog,
} from "@/modules/authentication/service";
import {
  cleanOrphanedStorageAndJobs,
  purgeAppCachesAndReindex,
} from "@/modules/datasets/maintenance";

const MaintenanceActionSchema = z.object({
  action: z.enum(["purge_cache_and_reindex", "clean_orphans"]),
});

export async function POST(req: Request) {
  const auth = await requireApiSession(["admin"]);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}));
  const parsed = MaintenanceActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid storage maintenance action." },
      { status: 400 }
    );
  }

  try {
    if (parsed.data.action === "clean_orphans") {
      const result = await cleanOrphanedStorageAndJobs({
        userId: auth.session.userId,
        email: auth.session.email,
      });
      return NextResponse.json(
        { ok: true, action: "clean_orphans", ...result },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const result = await purgeAppCachesAndReindex();
    await writeAuditLog({
      actorUserId: auth.session.userId,
      actorEmail: auth.session.email,
      action: "STORAGE_CACHE_PURGED_REINDEXED",
      resourceType: "system",
      resourceId: "cache_and_indexes",
      details: result,
    });
    return NextResponse.json(
      { ok: true, action: "purge_cache_and_reindex", ...result },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Storage maintenance failed",
      },
      { status: 500 }
    );
  }
}
