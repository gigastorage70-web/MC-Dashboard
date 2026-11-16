import { NextResponse } from "next/server";
import { z } from "zod";
import { parseAuthenticatedFilter } from "@/modules/analytics/api-helper";
import { queryTimeSeries } from "@/modules/analytics/service";

const ExtraSchema = z.object({
  granularity: z.enum(["hour", "day"]).default("hour"),
});

export async function POST(req: Request) {
  const parsed = await parseAuthenticatedFilter(req, ExtraSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const series = await queryTimeSeries(
      parsed.filter,
      parsed.extra.granularity
    );
    return NextResponse.json({ series });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Time-series query failed" },
      { status: 500 }
    );
  }
}
