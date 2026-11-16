import { NextResponse } from "next/server";
import { getEnv } from "@/lib/config/env";
import { checkAnalyticsHealth } from "@/lib/database/analytics-db";
import { checkAppDbHealth } from "@/lib/database/app-db";
import { checkUnifiedStorageHealth } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET() {
  const env = getEnv();
  const [appDb, analyticsDb, storage] = await Promise.all([
    checkAppDbHealth(),
    checkAnalyticsHealth(),
    checkUnifiedStorageHealth(),
  ]);

  const allHealthy = appDb.ok && analyticsDb.ok && storage.ok;

  return NextResponse.json(
    {
      status: allHealthy ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      queueMode: env.QUEUE_MODE,
      services: {
        appDb,
        analyticsDb,
        storage,
      },
    },
    { status: allHealthy ? 200 : 503 }
  );
}
