import { NextResponse } from "next/server";
import { z } from "zod";
import { parseAuthenticatedFilter } from "@/modules/analytics/api-helper";
import { queryExplorerMessages } from "@/modules/analytics/service";

const ExtraSchema = z.object({
  pageSize: z.number().int().min(10).max(500).default(50),
  cursorTs: z.string().optional(),
  cursorRowId: z.number().int().positive().optional(),
  sortDir: z.enum(["ASC", "DESC"]).default("DESC"),
});

export async function POST(req: Request) {
  const parsed = await parseAuthenticatedFilter(req, ExtraSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const result = await queryExplorerMessages(parsed.filter, {
      pageSize: parsed.extra.pageSize,
      cursorTs: parsed.extra.cursorTs,
      cursorRowId: parsed.extra.cursorRowId,
      sortDir: parsed.extra.sortDir,
      maskPii: parsed.maskPii,
    });
    return NextResponse.json({ ...result, masked: parsed.maskPii });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Message Explorer query failed" },
      { status: 500 }
    );
  }
}
