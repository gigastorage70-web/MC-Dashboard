import { NextResponse } from "next/server";
import { requireApiSession } from "@/modules/authentication/service";
import { getStorageSummary } from "@/modules/datasets/maintenance";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  try {
    const summary = await getStorageSummary();
    return NextResponse.json(summary, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to inspect cloud storage",
      },
      { status: 500 }
    );
  }
}
