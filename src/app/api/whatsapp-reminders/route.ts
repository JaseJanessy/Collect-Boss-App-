import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { appendSensitiveAudit, requireTenantPermission } from "@/lib/auth/tenant-access";
import { whatsappConfig } from "@/lib/whatsapp/cloud-api";
import { ALLOWED_DAY_OFFSETS, DEFAULT_DAY_OFFSETS } from "@/lib/whatsapp/policy";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store" };

const policySchema = z.object({
  enabled: z.boolean(),
  dayOffsets: z.array(z.number().int().refine((value) => (ALLOWED_DAY_OFFSETS as readonly number[]).includes(value), "Choose days from the list."))
    .min(1, "Choose at least one reminder day.").max(8),
  language: z.enum(["en", "ms"]),
  consentConfirmed: z.boolean().optional(),
});

async function paidPlan(service: { from: (table: string) => any }, businessId: string) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const { data } = await service.from("entitlements").select("plan_slug").eq("business_id", businessId).maybeSingle();
  return Boolean(data && (data as { plan_slug: string }).plan_slug !== "free");
}

export async function GET() {
  const access = await requireTenantPermission("case.read");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status, headers });
  const [{ data: policy, error: policyError }, { data: messages, error: messageError }] = await Promise.all([
    access.service.from("whatsapp_reminder_policies").select("*").eq("business_id", access.businessId).maybeSingle(),
    access.service.from("whatsapp_messages")
      .select("id,template_kind,status,skip_reason,error_message,local_send_date,sent_at,variables,created_at")
      .eq("business_id", access.businessId).order("created_at", { ascending: false }).limit(20),
  ]);
  if (policyError || messageError) return NextResponse.json({ error: "We couldn't load WhatsApp reminders. Please try again." }, { status: 503, headers });
  const row = policy as { enabled: boolean; day_offsets: number[]; language: "en" | "ms"; consent_attested_at: string | null } | null;
  return NextResponse.json({
    available: whatsappConfig().configured,
    paidPlan: await paidPlan(access.service, access.businessId),
    policy: {
      enabled: row?.enabled ?? false,
      dayOffsets: row?.day_offsets ?? [...DEFAULT_DAY_OFFSETS],
      language: row?.language ?? "en",
      consentAttestedAt: row?.consent_attested_at ?? null,
    },
    // Only the customer's name and amount are returned; phone numbers stay server-side.
    recent: (messages ?? []).map((message) => {
      const item = message as { variables: unknown[] } & Record<string, unknown>;
      return { ...item, variables: undefined, customerName: String(item.variables?.[0] ?? ""), amount: String(item.variables?.[2] ?? "") };
    }),
  }, { headers });
}

export async function PUT(request: NextRequest) {
  const access = await requireTenantPermission("settings.sensitive.manage");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status, headers });
  const parsed = policySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the reminder settings." }, { status: 400, headers });
  const input = parsed.data;

  const { data: existing } = await access.service.from("whatsapp_reminder_policies").select("consent_attested_at,consent_attested_by")
    .eq("business_id", access.businessId).maybeSingle();
  const previous = existing as { consent_attested_at: string | null; consent_attested_by: string | null } | null;
  const consentAt = input.consentConfirmed ? new Date().toISOString() : previous?.consent_attested_at ?? null;
  if (input.enabled) {
    if (!whatsappConfig().configured) return NextResponse.json({ error: "Automatic WhatsApp reminders are not available yet." }, { status: 503, headers });
    if (!(await paidPlan(access.service, access.businessId))) {
      return NextResponse.json({ error: "Automatic WhatsApp reminders are included in paid plans. Upgrade to turn them on." }, { status: 403, headers });
    }
    if (!consentAt) {
      return NextResponse.json({ error: "Please confirm your customers agreed to receive WhatsApp reminders." }, { status: 400, headers });
    }
  }

  const { data, error } = await access.service.from("whatsapp_reminder_policies").upsert({
    business_id: access.businessId,
    enabled: input.enabled,
    day_offsets: [...new Set(input.dayOffsets)].sort((a, b) => a - b),
    language: input.language,
    consent_attested_at: consentAt,
    consent_attested_by: input.consentConfirmed ? access.user.id : previous?.consent_attested_by ?? null,
    updated_by: access.user.id,
    updated_at: new Date().toISOString(),
  }, { onConflict: "business_id" }).select("*").single();
  if (error || !data) return NextResponse.json({ error: "We couldn't save the reminder settings. Please try again." }, { status: 500, headers });

  await appendSensitiveAudit({
    access, request, action: "whatsapp_reminders.policy_updated", entityType: "whatsapp_reminder_policy",
    entityId: access.businessId, after: { enabled: input.enabled, day_offsets: input.dayOffsets, language: input.language },
  });
  return NextResponse.json({ saved: true }, { headers });
}
