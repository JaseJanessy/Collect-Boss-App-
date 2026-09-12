import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedBusiness } from "@/lib/debtors/server";
import { evaluateContactGuard } from "@/lib/communications/guardrails";
import { loadContactGuardContexts } from "@/lib/communications/guard-server";
import type { CommunicationChannel } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

const channels = new Set<CommunicationChannel>(["whatsapp", "call", "email", "portal", "other"]);

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedBusiness();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const caseIds = Array.isArray(body?.case_ids)
    ? [...new Set(body.case_ids.filter((value): value is string => typeof value === "string" && value.length > 0))]
    : [];
  if (!body || caseIds.length < 1 || caseIds.length > 250
    || typeof body.channel !== "string" || !channels.has(body.channel as CommunicationChannel)) {
    return NextResponse.json({ error: "Bulk preflight requires 1 to 250 cases and a valid channel." }, { status: 400 });
  }

  const overrideReason = typeof body.override_reason === "string" ? body.override_reason.trim().slice(0, 500) : "";
  const loaded = await loadContactGuardContexts(auth.client, caseIds);
  if (loaded.error) return NextResponse.json({ error: loaded.error }, { status: 503 });
  const evaluations = caseIds.map((caseId) => evaluateContactGuard(
    loaded.contexts.get(caseId)!,
    body.channel as CommunicationChannel,
    { bulk: true, overrideProvided: overrideReason.length >= 3 },
  ));
  const allowed = evaluations.filter((evaluation) => evaluation.bulk_allowed);
  const excluded = evaluations.filter((evaluation) => !evaluation.bulk_allowed);

  return NextResponse.json({
    channel: body.channel,
    allowed_case_ids: allowed.map((evaluation) => evaluation.case_id),
    excluded,
    requires_override: excluded.some((evaluation) => evaluation.policy.bulk_mode === "require_override"),
    message: excluded.length > 0
      ? `${excluded.length} contact${excluded.length === 1 ? "" : "s"} excluded by frequency or preference controls.`
      : "All selected contacts pass the current bulk communication policy.",
  }, { headers: { "Cache-Control": "private, no-store" } });
}

