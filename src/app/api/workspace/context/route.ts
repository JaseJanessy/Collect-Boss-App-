import { NextResponse, type NextRequest } from "next/server";

import { requireMobilePermission } from "@/lib/auth/mobile-access";
import { requireWorkspaceContext, resolveWorkspaceContextForAccess } from "@/lib/workspace/context";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const hasBearerToken = (request.headers.get("authorization") ?? "").startsWith("Bearer ");
  const result = hasBearerToken
    ? await (async () => {
        const access = await requireMobilePermission(request, "case.read");
        if ("error" in access) {
          return {
            error: access.status === 401 ? "You must be signed in." : "Workspace access is unavailable.",
            code: access.status === 401 ? "AUTHENTICATION_REQUIRED" as const : access.status === 403 ? "WORKSPACE_ACCESS_DENIED" as const : "WORKSPACE_CONTEXT_UNAVAILABLE" as const,
            status: access.status,
          };
        }
        const { data: business, error } = await access.service.from("businesses")
          .select("id, business_name, legal_name, country_code, locale, timezone, default_currency, date_format, number_format, language_code")
          .eq("id", access.businessId)
          .maybeSingle();
        if (error || !business) {
          return { error: "Workspace context is temporarily unavailable.", code: "WORKSPACE_CONTEXT_UNAVAILABLE" as const, status: 503 };
        }
        return resolveWorkspaceContextForAccess({ ...access, business, businessId: access.businessId, settings: {
          manager_can_approve_settlements: false,
          manager_can_approve_write_offs: false,
          manager_can_submit_document_intakes: false,
        } });
      })()
    : await requireWorkspaceContext();

  if ("error" in result) {
    return NextResponse.json(
      { error: result.error, code: result.code },
      { status: result.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(result.context, {
    headers: { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie, Authorization" },
  });
}
