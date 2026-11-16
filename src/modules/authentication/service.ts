import crypto from "node:crypto";
import { NextResponse } from "next/server";
import {
  appQuery,
  appTransaction,
  asBool,
} from "@/lib/database/app-db";
import { hashPassword, verifyPassword } from "@/lib/security/password";
import {
  getSessionFromCookies,
  type SessionPayload,
} from "@/lib/security/session";

export interface UserPreferencesDto {
  theme: "light" | "dark" | "system";
  maskSensitiveIdentifiers: boolean;
  defaultPageSize: number;
  timezone: string;
}

export interface AuditInput {
  actorUserId?: string | null;
  actorEmail?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  details?: Record<string, unknown>;
}

export async function writeAuditLog(input: AuditInput): Promise<void> {
  try {
    await appQuery(
      `
      INSERT INTO audit_logs (actor_user_id, actor_email, action, resource_type, resource_id, details)
      VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        input.actorUserId ?? null,
        input.actorEmail ?? null,
        input.action,
        input.resourceType,
        input.resourceId ?? null,
        JSON.stringify(input.details ?? {}),
      ]
    );
  } catch {
    // Non-fatal
  }
}

export async function hasAnyUser(): Promise<boolean> {
  const res = await appQuery<{ cnt: number }>(
    "SELECT COUNT(*) AS cnt FROM users"
  );
  return Number(res.rows[0]?.cnt ?? 0) > 0;
}

export async function setupInitialAdmin(input: {
  email: string;
  fullName: string;
  password: string;
}): Promise<SessionPayload> {
  const normalizedEmail = input.email.trim().toLowerCase();
  const userId = crypto.randomUUID();

  await appTransaction(async (tx) => {
    const countRes = await tx.query<{ cnt: number }>(
      "SELECT COUNT(*) AS cnt FROM users"
    );
    if (Number(countRes.rows[0]?.cnt ?? 0) > 0) {
      throw new Error("INITIAL_SETUP_ALREADY_COMPLETED");
    }

    const pwHash = hashPassword(input.password);
    await tx.query(
      `
      INSERT INTO users (id, email, full_name, password_hash)
      VALUES ($1, $2, $3, $4)
      `,
      [userId, normalizedEmail, input.fullName.trim(), pwHash]
    );

    const roleRes = await tx.query<{ id: number }>(
      "SELECT id FROM roles WHERE name = 'admin'"
    );
    if (roleRes.rows.length > 0) {
      await tx.query(
        "INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)",
        [userId, roleRes.rows[0].id]
      );
    }

    await tx.query(
      "INSERT INTO user_preferences (user_id, theme) VALUES ($1, 'system') ON CONFLICT DO NOTHING",
      [userId]
    );
  });

  await writeAuditLog({
    actorUserId: userId,
    actorEmail: normalizedEmail,
    action: "AUTH_INITIAL_ADMIN_SETUP",
    resourceType: "user",
    resourceId: userId,
  });

  return {
    userId,
    email: normalizedEmail,
    fullName: input.fullName.trim(),
    roles: ["admin"],
  };
}

export async function authenticateUser(
  email: string,
  password: string
): Promise<SessionPayload | null> {
  const normalizedEmail = email.trim().toLowerCase();
  const userRes = await appQuery<{
    id: string;
    email: string;
    full_name: string;
    password_hash: string;
    is_active: boolean | number;
  }>(
    `
    SELECT id, email, full_name, password_hash, is_active
    FROM users
    WHERE email = $1
    LIMIT 1
    `,
    [normalizedEmail]
  );

  const user = userRes.rows[0];
  if (!user || !asBool(user.is_active)) return null;
  if (!verifyPassword(password, user.password_hash)) return null;

  const rolesRes = await appQuery<{ name: string }>(
    `
    SELECT r.name
    FROM roles r
    JOIN user_roles ur ON ur.role_id = r.id
    WHERE ur.user_id = $1
    `,
    [user.id]
  );

  await appQuery(
    "UPDATE users SET last_login_at = $1 WHERE id = $2",
    [new Date().toISOString(), user.id]
  );

  const roles = rolesRes.rows.map((r) => r.name);
  await writeAuditLog({
    actorUserId: user.id,
    actorEmail: user.email,
    action: "AUTH_LOGIN",
    resourceType: "user",
    resourceId: user.id,
  });

  return {
    userId: user.id,
    email: user.email,
    fullName: user.full_name,
    roles,
  };
}

export async function getUserPreferences(
  userId: string
): Promise<UserPreferencesDto> {
  const res = await appQuery<{
    theme: "light" | "dark" | "system";
    mask_sensitive_identifiers: boolean | number;
    default_page_size: number;
    timezone: string;
  }>(
    `
    SELECT theme, mask_sensitive_identifiers, default_page_size, timezone
    FROM user_preferences
    WHERE user_id = $1
    `,
    [userId]
  );

  if (res.rows.length === 0) {
    return {
      theme: "system",
      maskSensitiveIdentifiers: false,
      defaultPageSize: 50,
      timezone: "UTC",
    };
  }
  const row = res.rows[0];
  return {
    theme: row.theme,
    maskSensitiveIdentifiers: asBool(row.mask_sensitive_identifiers),
    defaultPageSize: Number(row.default_page_size),
    timezone: row.timezone,
  };
}

export async function requireApiSession(
  allowedRoles?: string[]
): Promise<
  | { ok: true; session: SessionPayload }
  | { ok: false; response: NextResponse }
> {
  const session = await getSessionFromCookies();
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      ),
    };
  }

  if (allowedRoles && allowedRoles.length > 0) {
    const hasRole = session.roles.some(
      (r) => r === "admin" || allowedRoles.includes(r)
    );
    if (!hasRole) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Insufficient permissions for this action" },
          { status: 403 }
        ),
      };
    }
  }

  return { ok: true, session };
}
