import { NextResponse } from "next/server";
import { z } from "zod";
import { GlobalFilterSchema } from "@/modules/analytics/filter-schema";
import { requireApiSession } from "@/modules/authentication/service";
import { compareFilterPeriods } from "@/modules/intelligence/service";

const CompareRequestSchema = z.object({
  baselineFilter: GlobalFilterSchema,
  currentFilter: GlobalFilterSchema,
});

export async function POST(req: Request) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const body = await req.json();
  const parsed = CompareRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid comparison request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const comparison = await compareFilterPeriods(
      parsed.data.baselineFilter,
      parsed.data.currentFilter
    );
    return NextResponse.json({ comparison });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Comparison query failed" },
      { status: 500 }
    );
  }
}
