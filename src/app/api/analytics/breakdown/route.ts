import { NextResponse } from "next/server";
import { z } from "zod";
import { parseAuthenticatedFilter } from "@/modules/analytics/api-helper";
import { queryDimensionBreakdown } from "@/modules/analytics/service";

const ExtraSchema = z.object({
  dimension: z.enum([
    "op",
    "tp",
    "applicant",
    "country",
    "state",
    "route",
    "raw_status",
    "reason",
  ]),
  limit: z.number().int().min(1).max(200).default(50),
  sortBy: z.enum(["volume", "unsuccessful", "failure_rate"]).default("volume"),
});

export async function POST(req: Request) {
  const parsed = await parseAuthenticatedFilter(req, ExtraSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const result = await queryDimensionBreakdown(
      parsed.filter,
      parsed.extra.dimension,
      { limit: parsed.extra.limit, sortBy: parsed.extra.sortBy }
    );
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Dimension query failed" },
      { status: 500 }
    );
  }
}
