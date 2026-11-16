import { NextResponse } from "next/server";
import { z } from "zod";
import { parseAuthenticatedFilter } from "@/modules/analytics/api-helper";
import { queryDependentFacets } from "@/modules/analytics/service";

const ExtraSchema = z.object({
  facet: z.enum([
    "opNames",
    "tpNames",
    "countries",
    "states",
    "rawStatuses",
    "reasons",
    "applicants",
    "routes",
    "opAnis",
    "tpAnis",
  ]),
  search: z.string().max(120).default(""),
  limit: z.number().int().min(1).max(200).default(100),
});

export async function POST(req: Request) {
  const parsed = await parseAuthenticatedFilter(req, ExtraSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const options = await queryDependentFacets(
      parsed.filter,
      parsed.extra.facet,
      parsed.extra.search,
      parsed.extra.limit
    );
    return NextResponse.json({ options });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Facet query failed" },
      { status: 500 }
    );
  }
}
