import { NextResponse } from "next/server";
import { z } from "zod";
import { appQuery, asBool } from "@/lib/database/app-db";
import {
  requireApiSession,
  writeAuditLog,
} from "@/modules/authentication/service";

const CreateRuleSchema = z.object({
  ruleName: z.string().min(2).max(150),
  matchSubmitStatus: z.string().max(100),
  matchDlrState: z.string().max(100),
  normalizedStatus: z.enum([
    "SUCCESS",
    "FAILED",
    "REJECTED",
    "PENDING",
    "OTHER",
    "UNKNOWN",
  ]),
  isTerminal: z.boolean(),
  description: z.string().max(500).optional(),
  priority: z.number().int().min(1).max(1000).default(100),
});

export async function GET() {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const res = await appQuery<{
    id: number;
    rule_name: string;
    match_submit_status: string | null;
    match_dlr_state: string | null;
    normalized_status: string;
    is_terminal: boolean | number;
    description: string | null;
    priority: number;
    is_active: boolean | number;
  }>(
    `
    SELECT id, rule_name, match_submit_status, match_dlr_state, normalized_status,
           is_terminal, description, priority, is_active
    FROM status_classification_rules
    ORDER BY priority ASC, id ASC
    `
  );

  return NextResponse.json({
    rules: res.rows.map((r) => ({
      ...r,
      is_terminal: asBool(r.is_terminal),
      is_active: asBool(r.is_active),
    })),
  });
}

export async function POST(req: Request) {
  const auth = await requireApiSession(["admin", "analyst"]);
  if (!auth.ok) return auth.response;

  const body = await req.json();
  const parsed = CreateRuleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid rule payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const res = await appQuery<{ id: number }>(
    `
    INSERT INTO status_classification_rules
      (rule_name, match_submit_status, match_dlr_state, normalized_status, is_terminal, description, priority)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id
    `,
    [
      parsed.data.ruleName,
      parsed.data.matchSubmitStatus,
      parsed.data.matchDlrState,
      parsed.data.normalizedStatus,
      parsed.data.isTerminal,
      parsed.data.description ?? null,
      parsed.data.priority,
    ]
  );

  await writeAuditLog({
    actorUserId: auth.session.userId,
    actorEmail: auth.session.email,
    action: "STATUS_RULE_CREATED",
    resourceType: "status_classification_rules",
    resourceId: String(res.rows[0].id),
    details: parsed.data,
  });

  return NextResponse.json({ id: res.rows[0].id }, { status: 201 });
}
