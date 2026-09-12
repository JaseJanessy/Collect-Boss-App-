import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedBusiness } from "@/lib/debtors/server";
import { isRateLimited } from "@/lib/api/request-guard";
import type { AppSupabaseClient } from "@/lib/supabase/client";
import { DISCREPANCY_DETECTOR_VERSION, loadDiscrepancyInput, serializeDetectedFindings } from "@/lib/discrepancies/server";
import type { DiscrepancyEventDto, DiscrepancyFindingDto, DiscrepancyResponse, FindingStatus } from "@/lib/discrepancies/api-types";

export const dynamic = "force-dynamic";
const responseHeaders = { "Cache-Control": "private, no-store" };
const statuses = new Set<FindingStatus>(["open", "confirmed", "dismissed", "deferred", "resolved"]);

function failure(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: responseHeaders });
}

function validCaseId(value: string) {
  return value.length > 0 && value.length <= 100 && /^[A-Za-z0-9_-]+$/.test(value);
}

function moneyStrings<T extends Record<string, unknown>>(rows: T[]) {
  return rows.map((row) => ({ ...row, impacted_amount_minor: String(row.impacted_amount_minor ?? 0) }));
}

async function loadResponse(client: AppSupabaseClient, businessId: string, caseId: string) {
  const [caseResult, findingsResult, eventsResult] = await Promise.all([
    client.from("cases").select("id,open_discrepancy_count,discrepancy_impacted_minor").eq("id", caseId).eq("business_id", businessId).maybeSingle(),
    client.from("discrepancy_findings").select("id,case_id,category,state_class,severity,confidence,confidence_score,impacted_amount_minor,currency,title,explanation,conflicting_values,source_references,recommended_action,status,status_reason,deferred_until,corrective_workflow,detected_at,last_detected_at").eq("business_id", businessId).eq("case_id", caseId).order("last_detected_at", { ascending: false }).limit(100),
    client.from("discrepancy_finding_events").select("id,finding_id,event_type,from_status,to_status,reason,actor_type,created_at").eq("business_id", businessId).eq("case_id", caseId).order("created_at", { ascending: false }).limit(500),
  ]);
  if (caseResult.error ?? findingsResult.error ?? eventsResult.error) throw new Error("Unable to load discrepancy findings.");
  if (!caseResult.data) return null;
  const caseRow = caseResult.data as Record<string, unknown>;
  return {
    findings: moneyStrings((findingsResult.data ?? []) as Record<string, unknown>[]) as unknown as DiscrepancyFindingDto[],
    events: (eventsResult.data ?? []) as DiscrepancyEventDto[],
    summary: { openCount: Number(caseRow.open_discrepancy_count ?? 0), impactedAmountMinor: String(caseRow.discrepancy_impacted_minor ?? 0) },
  } satisfies DiscrepancyResponse;
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  if (!validCaseId(caseId)) return failure("INVALID_CASE_ID", "Enter a valid case ID.", 400);
  const auth = await getAuthenticatedBusiness("case.read");
  if ("error" in auth) return failure(auth.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN", auth.error ?? "Access denied.", auth.status ?? 403);
  try {
    const response = await loadResponse(auth.client, auth.businessId, caseId);
    return response ? NextResponse.json(response, { headers: responseHeaders }) : failure("CASE_NOT_FOUND", "Case not found.", 404);
  } catch {
    return failure("DISCREPANCIES_UNAVAILABLE", "Unable to load discrepancy findings.", 503);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  if (!validCaseId(caseId)) return failure("INVALID_CASE_ID", "Enter a valid case ID.", 400);
  const auth = await getAuthenticatedBusiness("case.manage");
  if ("error" in auth) return failure(auth.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN", auth.error ?? "Access denied.", auth.status ?? 403);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || (body.action !== "scan" && body.action !== "transition")) return failure("INVALID_ACTION", "Choose a valid discrepancy action.", 400);

  if (body.action === "scan") {
    if (isRateLimited(`discrepancy-scan:${auth.user.id}:${caseId}`, 6, 60_000)) {
      return failure("RATE_LIMITED", "Wait before running another discrepancy scan.", 429);
    }
    try {
      const input = await loadDiscrepancyInput(auth.client, auth.businessId, caseId);
      const findings = serializeDetectedFindings(input);
      const { error } = await auth.client.rpc("discrepancy_record_scan", {
        p_business_id: auth.businessId, p_case_id: caseId, p_actor_id: auth.user.id,
        p_detector_version: DISCREPANCY_DETECTOR_VERSION, p_findings: findings,
      });
      if (error) return failure("SCAN_FAILED", "The discrepancy scan could not be recorded.", 409);
      const response = await loadResponse(auth.client, auth.businessId, caseId);
      return response ? NextResponse.json(response, { headers: responseHeaders }) : failure("CASE_NOT_FOUND", "Case not found.", 404);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unable to scan discrepancy sources.";
      if (message === "Case not found.") return failure("CASE_NOT_FOUND", message, 404);
      if (message === "Reconcile the canonical ledger before scanning discrepancies.") return failure("LEDGER_REQUIRED", message, 409);
      return failure("SOURCE_LOAD_FAILED", "Unable to load every authoritative discrepancy source.", 503);
    }
  }

  if (typeof body.findingId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.findingId)
    || typeof body.status !== "string" || !statuses.has(body.status as FindingStatus)) {
    return failure("INVALID_TRANSITION", "Choose a valid finding and status.", 400);
  }
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (["confirmed", "dismissed", "resolved"].includes(body.status) && (reason.length < 3 || reason.length > 1000)) {
    return failure("REASON_REQUIRED", "Enter a review reason between 3 and 1,000 characters.", 400);
  }
  const deferredUntil = typeof body.deferredUntil === "string" ? body.deferredUntil : null;
  if (body.status === "deferred" && (!deferredUntil || !Number.isFinite(Date.parse(deferredUntil)) || Date.parse(deferredUntil) <= Date.now())) {
    return failure("DEFER_DATE_REQUIRED", "Choose a future defer date.", 400);
  }
  const correctiveWorkflow = body.status === "resolved" && body.correctiveWorkflow && typeof body.correctiveWorkflow === "object"
    ? body.correctiveWorkflow as Record<string, unknown> : null;
  if (body.status === "resolved" && (typeof correctiveWorkflow?.href !== "string" || !correctiveWorkflow.href.startsWith("/") || correctiveWorkflow.href.startsWith("//"))) {
    return failure("WORKFLOW_REQUIRED", "Resolve the finding through a valid corrective workflow link.", 400);
  }
  const { error } = await auth.client.rpc("discrepancy_transition", {
    p_business_id: auth.businessId, p_finding_id: body.findingId, p_actor_id: auth.user.id,
    p_status: body.status, p_reason: reason || null, p_deferred_until: deferredUntil,
    p_corrective_workflow: correctiveWorkflow,
  });
  if (error) return failure("TRANSITION_FAILED", "The finding status could not be changed.", 409);
  try {
    const response = await loadResponse(auth.client, auth.businessId, caseId);
    return response ? NextResponse.json(response, { headers: responseHeaders }) : failure("CASE_NOT_FOUND", "Case not found.", 404);
  } catch {
    return failure("DISCREPANCIES_UNAVAILABLE", "The status changed, but refreshed findings could not be loaded.", 503);
  }
}
