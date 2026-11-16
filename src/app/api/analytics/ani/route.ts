import { NextResponse } from "next/server";
import { z } from "zod";
import { parseAuthenticatedFilter } from "@/modules/analytics/api-helper";
import { queryAniBreakdown } from "@/modules/analytics/service";

const ExtraSchema = z.object({
  aniType: z.enum(["op_ani", "tp_ani"]).default("op_ani"),
  limit: z.number().int().min(1).max(200).default(50),
});

export async function POST(req: Request) {
  const parsed = await parseAuthenticatedFilter(req, ExtraSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const rows = await queryAniBreakdown(
      parsed.filter,
      parsed.extra.aniType,
      parsed.maskPii,
      parsed.extra.limit
    );
    return NextResponse.json({ rows, masked: parsed.maskPii });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "ANI query failed" },
      { status: 500 }
    );
  }
}
