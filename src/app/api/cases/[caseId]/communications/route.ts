import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedBusiness } from "@/lib/debtors/server";
import { evaluateContactGuard } from "@/lib/communications/guardrails";
import { evaluationJson, loadContactGuardContexts } from "@/lib/communications/guard-server";
import type {
  CommunicationActivityRow,
  CommunicationChannel,
  CommunicationCounters,
  CommunicationDirection,
  CommunicationStatus,
  ContactFrequencyPolicyRow,
  ContactPreferenceRow,
  Json,
} from "@/lib/supabase/types";
import { ComplianceGateError, evaluationResponse, requireExecutableComplianceCheck } from "@/lib/compliance/service";

export const dynamic = "force-dynamic";

const channels = new Set<CommunicationChannel>(["whatsapp", "call", "email", "portal", "other"]);
const directions = new Set<CommunicationDirection>(["outbound", "inbound"]);
const statuses = new Set<CommunicationStatus>([
  "initiated", "sent", "delivered", "read", "replied", "failed", "completed",
]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function ownedCase(caseId: string, write = false) {
  const auth = await getAuthenticatedBusiness(write ? "communication.manage" : "case.read");
  if ("error" in auth) return { error: auth.error, status: 401 } as const;
  const { data, error } = await auth.client
    .from("cases")
    .select("id,debtor_id")
    .eq("id", caseId)
    .eq("business_id", auth.businessId)
    .maybeSingle();
  if (error) return { error: "Unable to load case.", status: 503 } as const;
  if (!data) return { error: "Case not found.", status: 404 } as const;
  return { ...auth, caseData: data as { id: string; debtor_id: string | null }, status: 200 } as const;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ caseId: string }> },
) {
  const { caseId } = await params;
  const access = await ownedCase(caseId);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });

  const [caseResult, guardContext] = await Promise.all([
    access.client
    .from("communication_activities")
    .select("*")
    .eq("business_id", access.businessId)
    .eq("case_id", caseId)
    .order("started_at", { ascending: false })
    .order("id", { ascending: false }),
    loadContactGuardContexts(access.client, [caseId]),
  ]);
  if (caseResult.error) {
    return NextResponse.json({ error: "Unable to load communication activity." }, { status: 503 });
  }
  if (guardContext.error) {
    return NextResponse.json({ error: guardContext.error }, { status: 503 });
  }
  const activities = (caseResult.data ?? []) as CommunicationActivityRow[];
  const countersResult = await access.client.rpc("communication_activity_counters", { p_case_id: caseId });
  if (countersResult.error || !countersResult.data) {
    return NextResponse.json({ error: "Unable to load communication counters." }, { status: 503 });
  }
  const counters = countersResult.data as unknown as {
    case: CommunicationCounters;
    customer: CommunicationCounters;
  };
  const context = guardContext.contexts.get(caseId);
  if (!context) return NextResponse.json({ error: "Contact guard context is unavailable." }, { status: 503 });
  return NextResponse.json({
    activities,
    case_counters: counters.case,
    customer_counters: counters.customer,
    preferences: context.preferences,
    policy: context.policy,
    guardrails: {
      call: evaluateContactGuard(context, "call"),
      whatsapp: evaluateContactGuard(context, "whatsapp"),
      email: evaluateContactGuard(context, "email"),
    },
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ caseId: string }> },
) {
  const { caseId } = await params;
  const access = await ownedCase(caseId, true);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body
    || typeof body.channel !== "string" || !channels.has(body.channel as CommunicationChannel)
    || typeof body.direction !== "string" || !directions.has(body.direction as CommunicationDirection)
    || (body.status !== undefined && (typeof body.status !== "string" || !statuses.has(body.status as CommunicationStatus)))
    || (body.metadata !== undefined && (!body.metadata || Array.isArray(body.metadata) || typeof body.metadata !== "object"))) {
    return NextResponse.json({ error: "Invalid communication activity details." }, { status: 400 });
  }

  const channel = body.channel as CommunicationChannel;
  const guardContext = await loadContactGuardContexts(access.client, [caseId]);
  const context = guardContext.contexts.get(caseId);
  if (guardContext.error || !context) {
    return NextResponse.json({ error: guardContext.error ?? "Contact guard context is unavailable." }, { status: 503 });
  }
  const evaluation = evaluateContactGuard(context, channel);
  const overrideReason = typeof body.override_reason === "string" ? body.override_reason.trim().slice(0, 500) : "";
  if (evaluation.requires_override && overrideReason.length < 3) {
    return NextResponse.json({
      error: "A short reason is required to continue after this contact warning.",
      guardrail: evaluation,
    }, { status: 409 });
  }
  const subject = typeof body.subject === "string" ? body.subject.slice(0, 300) : null;
  const bodyText = typeof body.body_text === "string" ? body.body_text.slice(0, 20000) : null;
  const recipients = Array.isArray(body.recipients)
    ? body.recipients.filter((value): value is string => typeof value === "string").slice(0, 20)
    : [];
  let compliance: Awaited<ReturnType<typeof requireExecutableComplianceCheck>> | null = null;
  if (body.direction === "outbound") {
    try {
      compliance = await requireExecutableComplianceCheck(access.service, {
        businessId: access.businessId,
        caseId,
        actorId: access.user.id,
        jurisdiction: typeof access.business.country_code === "string" ? access.business.country_code : "MY",
        actionKind: "communication",
        channel,
        subject,
        bodyText,
        recipients,
      }, typeof body.policy_check_id === "string" ? body.policy_check_id : null);
    } catch (error) {
      if (error instanceof ComplianceGateError) {
        return NextResponse.json(evaluationResponse(error), { status: error.status });
      }
      return NextResponse.json({ error: "Compliance review is unavailable." }, { status: 503 });
    }
  }

  const idempotencyKey = typeof body.idempotency_key === "string" && uuidPattern.test(body.idempotency_key)
    ? body.idempotency_key
    : crypto.randomUUID();
  const { data, error } = await access.client.rpc("compliance_communication_activity_create", {
    p_case_id: caseId,
    p_channel: channel,
    p_direction: body.direction as CommunicationDirection,
    p_status: (body.status as CommunicationStatus | undefined) ?? "initiated",
    p_started_at: typeof body.started_at === "string" ? body.started_at : null,
    p_external_reference: typeof body.external_reference === "string" ? body.external_reference.slice(0, 300) : null,
    p_duration_seconds: typeof body.duration_seconds === "number" ? body.duration_seconds : null,
    p_metadata: (body.metadata ?? {}) as Json,
    p_related_promise_id: typeof body.related_promise_id === "string" ? body.related_promise_id : null,
    p_related_dispute_id: typeof body.related_dispute_id === "string" ? body.related_dispute_id : null,
    p_related_action_id: typeof body.related_action_id === "string" ? body.related_action_id : null,
    p_idempotency_key: idempotencyKey,
    p_policy_check_id: compliance?.check.id ?? null,
    p_policy_content_hash: compliance?.contentHash ?? null,
  });
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Unable to create communication activity." }, { status: 409 });
  }
  const activity = data as CommunicationActivityRow;
  if (evaluation.warnings.length > 0) {
    const auditReason = overrideReason || "Continued after advisory warning under the configured warn-only policy.";
    const override = await access.client.rpc("contact_guard_record_override", {
      p_case_id: caseId,
      p_communication_activity_id: activity.id,
      p_action_item_id: typeof body.related_action_id === "string" ? body.related_action_id : null,
      p_channel: channel,
      p_is_bulk: false,
      p_reason: auditReason,
      p_evaluation: evaluationJson(evaluation),
    });
    if (override.error) {
      return NextResponse.json({
        activity,
        error: "Communication was logged, but the warning override audit could not be recorded.",
      }, { status: 503 });
    }
  }
  return NextResponse.json({ activity, guardrail: evaluation }, { status: 201 });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ caseId: string }> },
) {
  const { caseId } = await params;
  const access = await ownedCase(caseId, true);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.action !== "string") {
    return NextResponse.json({ error: "Invalid contact control update." }, { status: 400 });
  }

  if (body.action === "preferences") {
    if (!access.caseData.debtor_id) {
      return NextResponse.json({ error: "Link this case to a customer before documenting preferences." }, { status: 409 });
    }
    const preferredChannel = body.preferred_channel === null || body.preferred_channel === ""
      ? null
      : typeof body.preferred_channel === "string" && channels.has(body.preferred_channel as CommunicationChannel)
        ? body.preferred_channel as CommunicationChannel
        : undefined;
    const timePattern = /^\d{2}:\d{2}$/;
    const start = typeof body.preferred_time_start === "string" && body.preferred_time_start
      ? body.preferred_time_start : null;
    const end = typeof body.preferred_time_end === "string" && body.preferred_time_end
      ? body.preferred_time_end : null;
    if (preferredChannel === undefined || Boolean(start) !== Boolean(end)
      || (start !== null && (!timePattern.test(start) || !timePattern.test(end ?? "")))) {
      return NextResponse.json({ error: "Enter valid contact preferences and a complete preferred time range." }, { status: 400 });
    }
    const { data, error } = await access.client.rpc("contact_preferences_upsert", {
      p_customer_id: access.caseData.debtor_id,
      p_preferred_channel: preferredChannel,
      p_preferred_time_start: start,
      p_preferred_time_end: end,
      p_email_only: body.email_only === true,
      p_do_not_call: body.do_not_call === true,
      p_wrong_number: body.wrong_number === true,
      p_invalid_contact: body.invalid_contact === true,
      p_note: typeof body.note === "string" ? body.note.trim().slice(0, 1000) || null : null,
    });
    if (error || !data) return NextResponse.json({ error: error?.message ?? "Unable to save contact preferences." }, { status: 409 });
    const { data: extended, error: extendedError } = await access.service.from("contact_preferences").update({
      do_not_email: body.do_not_email === true,
      email_invalid: body.email_invalid === true,
      email_unsubscribed: body.email_unsubscribed === true,
    } as never).eq("id", (data as ContactPreferenceRow).id).eq("business_id", access.businessId).select("*").single();
    if (extendedError || !extended) return NextResponse.json({ error: "Unable to save email contact preferences." }, { status: 503 });
    return NextResponse.json({ preferences: extended as ContactPreferenceRow });
  }

  if (body.action === "policy") {
    const values = [body.max_attempts_24h, body.max_attempts_7d, body.max_attempts_30d];
    if (!values.every((value) => typeof value === "number" && Number.isInteger(value))
      || typeof body.frequency_mode !== "string" || !["warn", "require_override"].includes(body.frequency_mode)
      || typeof body.preference_mode !== "string" || !["warn", "require_override"].includes(body.preference_mode)
      || typeof body.bulk_mode !== "string" || !["exclude", "require_override"].includes(body.bulk_mode)) {
      return NextResponse.json({ error: "Enter a valid contact frequency policy." }, { status: 400 });
    }
    const { data, error } = await access.client.rpc("contact_frequency_policy_upsert", {
      p_max_attempts_24h: body.max_attempts_24h as number,
      p_max_attempts_7d: body.max_attempts_7d as number,
      p_max_attempts_30d: body.max_attempts_30d as number,
      p_frequency_mode: body.frequency_mode,
      p_preference_mode: body.preference_mode,
      p_bulk_mode: body.bulk_mode,
    });
    if (error || !data) return NextResponse.json({ error: error?.message ?? "Unable to save contact policy." }, { status: 409 });
    return NextResponse.json({ policy: data as ContactFrequencyPolicyRow });
  }

  return NextResponse.json({ error: "Unsupported contact control update." }, { status: 400 });
}
