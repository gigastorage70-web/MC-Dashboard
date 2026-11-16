import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { appQuery, appTransaction, asBool } from "@/lib/database/app-db";
import {
  requireApiSession,
  writeAuditLog,
} from "@/modules/authentication/service";
import { LOGICAL_FIELDS } from "@/modules/schema-mapping/constants";

const SaveProfileSchema = z.object({
  name: z.string().min(2).max(150),
  description: z.string().max(500).optional(),
  delimiter: z.enum([";", ",", "\t", "|"]),
  skipRepeatedHeaders: z.boolean().default(true),
  mapping: z.record(z.string().min(1), z.enum([...LOGICAL_FIELDS, "IGNORE"])),
});

export async function GET() {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const profilesRes = await appQuery<{
    id: string;
    name: string;
    description: string | null;
    delimiter: string;
    skip_repeated_headers: boolean | number;
    is_default: boolean | number;
    created_at: string;
  }>(
    `
    SELECT id, name, description, delimiter, skip_repeated_headers, is_default, created_at
    FROM schema_profiles
    ORDER BY is_default DESC, name ASC
    `
  );

  const mappingsRes = await appQuery<{
    profile_id: string;
    csv_column_name: string;
    logical_field: string;
  }>(
    "SELECT profile_id, csv_column_name, logical_field FROM schema_mappings ORDER BY priority ASC"
  );

  const mapByProfile = new Map<string, Record<string, string>>();
  for (const m of mappingsRes.rows) {
    const dict = mapByProfile.get(m.profile_id) ?? {};
    dict[m.csv_column_name] = m.logical_field;
    mapByProfile.set(m.profile_id, dict);
  }

  return NextResponse.json({
    profiles: profilesRes.rows.map((p) => ({
      ...p,
      skip_repeated_headers: asBool(p.skip_repeated_headers),
      is_default: asBool(p.is_default),
      mappings: mapByProfile.get(p.id) ?? {},
    })),
  });
}

export async function POST(req: Request) {
  const auth = await requireApiSession(["admin", "analyst"]);
  if (!auth.ok) return auth.response;

  const body = await req.json();
  const parsed = SaveProfileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid schema profile payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const newId = crypto.randomUUID();
  const profileId = await appTransaction(async (tx) => {
    const profRes = await tx.query<{ id: string }>(
      `
      INSERT INTO schema_profiles (id, name, description, delimiter, skip_repeated_headers, created_by)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (name) DO UPDATE SET
        description = EXCLUDED.description,
        delimiter = EXCLUDED.delimiter,
        skip_repeated_headers = EXCLUDED.skip_repeated_headers,
        updated_at = $7
      RETURNING id
      `,
      [
        newId,
        parsed.data.name.trim(),
        parsed.data.description ?? null,
        parsed.data.delimiter,
        parsed.data.skipRepeatedHeaders,
        auth.session.userId,
        new Date().toISOString(),
      ]
    );
    const id = profRes.rows[0].id;

    await tx.query("DELETE FROM schema_mappings WHERE profile_id = $1", [id]);

    for (const [csvCol, logicalField] of Object.entries(parsed.data.mapping)) {
      if (logicalField === "IGNORE") continue;
      await tx.query(
        `
        INSERT INTO schema_mappings (id, profile_id, csv_column_name, logical_field)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT DO NOTHING
        `,
        [crypto.randomUUID(), id, csvCol, logicalField]
      );
    }
    return id;
  });

  await writeAuditLog({
    actorUserId: auth.session.userId,
    actorEmail: auth.session.email,
    action: "SCHEMA_PROFILE_SAVED",
    resourceType: "schema_profiles",
    resourceId: profileId,
    details: { name: parsed.data.name, delimiter: parsed.data.delimiter },
  });

  return NextResponse.json({ id: profileId }, { status: 201 });
}
