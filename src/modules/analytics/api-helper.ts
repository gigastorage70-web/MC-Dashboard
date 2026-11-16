import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getUserPreferences,
  requireApiSession,
} from "@/modules/authentication/service";
import {
  GlobalFilterSchema,
  type GlobalFilterSpec,
} from "./filter-schema";

export async function parseAuthenticatedFilter<T extends z.ZodRawShape>(
  req: Request,
  extraSchema?: z.ZodObject<T>
): Promise<
  | {
      ok: true;
      userId: string;
      maskPii: boolean;
      filter: GlobalFilterSpec;
      extra: z.infer<z.ZodObject<T>>;
    }
  | { ok: false; response: NextResponse }
> {
  const auth = await requireApiSession();
  if (!auth.ok) return auth;

  const body = await req.json().catch(() => ({}));
  const merged = extraSchema
    ? GlobalFilterSchema.merge(extraSchema)
    : GlobalFilterSchema;

  const parsed = merged.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid filter payload", details: parsed.error.flatten() },
        { status: 400 }
      ),
    };
  }

  const prefs = await getUserPreferences(auth.session.userId);
  const isViewerOnly =
    !auth.session.roles.includes("admin") &&
    !auth.session.roles.includes("analyst") &&
    !auth.session.roles.includes("operator");

  return {
    ok: true,
    userId: auth.session.userId,
    maskPii: isViewerOnly || prefs.maskSensitiveIdentifiers,
    filter: parsed.data as GlobalFilterSpec,
    extra: parsed.data as z.infer<z.ZodObject<T>>,
  };
}
