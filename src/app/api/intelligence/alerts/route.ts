import { NextResponse } from "next/server";
import { z } from "zod";
import { appQuery } from "@/lib/database/app-db";
import { GlobalFilterSchema } from "@/modules/analytics/filter-schema";
import { requireApiSession } from "@/modules/authentication/service";
import { evaluateDegradationAnomalies } from "@/modules/intelligence/service";

const EvaluateSchema = z.object({
  filter: GlobalFilterSchema,
  minSampleSize: z.number().int().min(20).max(100_000).default(500),
  deltaSpikePct: z.number().min(1).max(100).default(8),
  criticalThresholdPct: z.number().min(1).max(100).default(25),
});

const PatchAlertSchema = z.object({
  alertId: z.string().uuid(),
  status: z.enum(["OPEN", "ACKNOWLEDGED", "RESOLVED"]),
});

export async function GET() {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const res = await appQuery(
    `
    SELECT a.*, d.name AS dataset_name
    FROM degradation_alerts a
    LEFT JOIN datasets d ON d.id = a.dataset_id
    ORDER BY a.created_at DESC
    LIMIT 100
    `
  );
  return NextResponse.json({ alerts: res.rows });
}

export async function POST(req: Request) {
  const auth = await requireApiSession(["admin", "analyst", "operator"]);
  if (!auth.ok) return auth.response;

  const body = await req.json();
  const parsed = EvaluateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid evaluation settings", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const generated = await evaluateDegradationAnomalies(parsed.data.filter, {
      minSampleSize: parsed.data.minSampleSize,
      deltaSpikePct: parsed.data.deltaSpikePct,
      criticalThresholdPct: parsed.data.criticalThresholdPct,
    });
    return NextResponse.json({
      generatedCount: generated.length,
      alerts: generated,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Anomaly evaluation failed" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request) {
  const auth = await requireApiSession(["admin", "analyst", "operator"]);
  if (!auth.ok) return auth.response;

  const body = await req.json();
  const parsed = PatchAlertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid alert update" }, { status: 400 });
  }

  await appQuery(
    `
    UPDATE degradation_alerts
    SET status = $2,
        acknowledged_by = $3
    WHERE id = $1
    `,
    [parsed.data.alertId, parsed.data.status, auth.session.userId]
  );
  return NextResponse.json({ ok: true });
}
