import { cookies } from "next/headers";
import { jwtVerify, SignJWT } from "jose";
import { getEnv } from "@/lib/config/env";

export const SESSION_COOKIE_NAME = "mc_qos_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export interface SessionPayload {
  userId: string;
  email: string;
  fullName: string;
  roles: string[];
}

function getSecretKey(): Uint8Array {
  const env = getEnv();
  if (env.AUTH_SECRET && env.AUTH_SECRET.length >= 16) {
    return new TextEncoder().encode(env.AUTH_SECRET);
  }
  if (env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET (min 16 chars) must be set in production.");
  }
  return new TextEncoder().encode("dev-only-ephemeral-secret-change-in-env");
}

export async function signSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({
    email: payload.email,
    fullName: payload.fullName,
    roles: payload.roles,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSecretKey());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    if (!payload.sub || typeof payload.email !== "string") return null;
    return {
      userId: payload.sub,
      email: payload.email,
      fullName: typeof payload.fullName === "string" ? payload.fullName : payload.email,
      roles: Array.isArray(payload.roles)
        ? payload.roles.filter((r): r is string => typeof r === "string")
        : [],
    };
  } catch {
    return null;
  }
}

export async function getSessionFromCookies(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export function getSessionCookieOptions() {
  const env = getEnv();
  return {
    name: SESSION_COOKIE_NAME,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}
