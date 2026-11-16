import { NextResponse } from "next/server";
import { parseAuthenticatedFilter } from "@/modules/analytics/api-helper";
import { queryGlobalKpis } from "@/modules/analytics/service";

export async function POST(req: Request) {
  const parsed = await parseAuthenticatedFilter(req);
  if (!parsed.ok) return parsed.response;

  try {
    const kpis = await queryGlobalKpis(parsed.filter);
    return NextResponse.json({ kpis });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "ClickHouse KPI query failed" },
      { status: 500 }
    );
  }
}
