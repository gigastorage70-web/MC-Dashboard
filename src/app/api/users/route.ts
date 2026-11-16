import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  appQuery,
  appTransaction,
  asBool,
  isSqliteMode,
} from "@/lib/database/app-db";
import { hashPassword } from "@/lib/security/password";
import {
  requireApiSession,
  writeAuditLog,
} from "@/modules/authentication/service";

const CreateUserSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(2).max(120),
  password: z.string().min(8).max(128),
  role: z.enum(["admin", "analyst", "operator", "viewer"]),
});

export async function GET() {
  const auth = await requireApiSession(["admin"]);
  if (!auth.ok) return auth.response;

  const sql = isSqliteMode()
    ? `
      SELECT u.id, u.email, u.full_name, u.is_active, u.last_login_at, u.created_at,
             COALESCE(GROUP_CONCAT(r.name), '') AS roles_csv
      FROM users u
      LEFT JOIN user_roles ur ON ur.user_id = u.id
      LEFT JOIN roles r ON r.id = ur.role_id
      GROUP BY u.id
      ORDER BY u.created_at ASC
      `
    : `
      SELECT u.id, u.email, u.full_name, u.is_active, u.last_login_at, u.created_at,
             COALESCE(array_agg(r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles
      FROM users u
      LEFT JOIN user_roles ur ON ur.user_id = u.id
      LEFT JOIN roles r ON r.id = ur.role_id
      GROUP BY u.id
      ORDER BY u.created_at ASC
      `;

  const res = await appQuery<{
    id: string;
    email: string;
    full_name: string;
    is_active: boolean | number;
    last_login_at: string | null;
    created_at: string;
    roles?: string[];
    roles_csv?: string;
  }>(sql);

  const users = res.rows.map((u) => ({
    id: u.id,
    email: u.email,
    full_name: u.full_name,
    is_active: asBool(u.is_active),
    last_login_at: u.last_login_at,
    created_at: u.created_at,
    roles: Array.isArray(u.roles)
      ? u.roles
      : (u.roles_csv ?? "").split(",").filter(Boolean),
  }));

  return NextResponse.json({ users });
}

export async function POST(req: Request) {
  const auth = await requireApiSession(["admin"]);
  if (!auth.ok) return auth.response;

  const body = await req.json();
  const parsed = CreateUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid user data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const email = parsed.data.email.trim().toLowerCase();
  const userId = crypto.randomUUID();

  try {
    await appTransaction(async (tx) => {
      const pwHash = hashPassword(parsed.data.password);
      await tx.query(
        "INSERT INTO users (id, email, full_name, password_hash) VALUES ($1, $2, $3, $4)",
        [userId, email, parsed.data.fullName.trim(), pwHash]
      );

      const roleRes = await tx.query<{ id: number }>(
        "SELECT id FROM roles WHERE name = $1",
        [parsed.data.role]
      );
      if (roleRes.rows.length > 0) {
        await tx.query(
          "INSERT INTO user_roles (user_id, role_id, assigned_by) VALUES ($1, $2, $3)",
          [userId, roleRes.rows[0].id, auth.session.userId]
        );
      }

      await tx.query(
        "INSERT INTO user_preferences (user_id, theme) VALUES ($1, 'system') ON CONFLICT DO NOTHING",
        [userId]
      );
    });

    await writeAuditLog({
      actorUserId: auth.session.userId,
      actorEmail: auth.session.email,
      action: "USER_CREATED",
      resourceType: "user",
      resourceId: userId,
      details: { email, role: parsed.data.role },
    });

    return NextResponse.json({ id: userId, email }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create user";
    const isDup = msg.toLowerCase().includes("unique") || msg.toLowerCase().includes("duplicate");
    return NextResponse.json(
      { error: isDup ? "Email already exists" : msg },
      { status: isDup ? 409 : 500 }
    );
  }
}
