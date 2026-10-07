import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { appendSensitiveAudit, requireTenantPermission } from "@/lib/auth/tenant-access";
import { myInvoisConfig } from "@/lib/einvoice/myinvois-client";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

const profileSchema = z.object({
  enabled: z.boolean(),
  supplierTin: z.string().trim().toUpperCase().max(20),
  supplierBrn: z.string().trim().max(30),
  supplierSst: z.string().trim().max(40).nullable().optional(),
  supplierTtx: z.string().trim().max(40).nullable().optional(),
  msicCode: z.string().trim().regex(/^(\d{5})?$/, "MSIC code must be 5 digits."),
  activityDescription: z.string().trim().max(300),
  phone: z.string().trim().max(30),
  email: z.string().trim().email("Enter a valid email address.").max(254).nullable().optional().or(z.literal("")),
  addressLine: z.string().trim().max(300),
  city: z.string().trim().max(80),
  postcode: z.string().trim().regex(/^(\d{5})?$/, "Postcode must be 5 digits."),
  stateCode: z.string().regex(/^(0[1-9]|1[0-7])$/, "Choose a state."),
  taxType: z.enum(["01", "02", "06", "E"]),
  taxRatePercent: z.coerce.number().min(0).max(100),
  intermediaryAuthorised: z.boolean(),
}).superRefine((value, context) => {
  if (!value.enabled) return;
  if (!/^[A-Z]{1,2}\d{8,12}$/.test(value.supplierTin)) context.addIssue({ code: "custom", path: ["supplierTin"], message: "Enter your LHDN TIN, for example C1234567890." });
  if (!value.supplierBrn) context.addIssue({ code: "custom", path: ["supplierBrn"], message: "Enter your SSM registration number." });
  if (!value.msicCode) context.addIssue({ code: "custom", path: ["msicCode"], message: "Enter your 5-digit MSIC code." });
  if (!value.addressLine || !value.city || !value.postcode) context.addIssue({ code: "custom", path: ["addressLine"], message: "Complete your business address." });
  if (!value.intermediaryAuthorised) context.addIssue({ code: "custom", path: ["intermediaryAuthorised"], message: "Authorise CollectBoss as your intermediary in the MyInvois portal first." });
});

export async function GET() {
  const access = await requireTenantPermission("case.read");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status, headers });
  const { data, error } = await access.service.from("einvoice_profiles").select("*").eq("business_id", access.businessId).maybeSingle();
  if (error) return NextResponse.json({ error: "We couldn't load your e-Invoice settings. Please try again." }, { status: 503, headers });
  const config = myInvoisConfig();
  return NextResponse.json({ available: config.configured, environment: config.environment, profile: data }, { headers });
}

export async function PUT(request: NextRequest) {
  const access = await requireTenantPermission("settings.sensitive.manage");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status, headers });
  const parsed = profileSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check your e-Invoice details." }, { status: 400, headers });
  const v = parsed.data;
  const { data: existing } = await access.service.from("einvoice_profiles").select("intermediary_authorised_at").eq("business_id", access.businessId).maybeSingle();
  const authorisedAt = v.intermediaryAuthorised
    ? (existing as { intermediary_authorised_at: string | null } | null)?.intermediary_authorised_at ?? new Date().toISOString()
    : null;
  const { error } = await access.service.from("einvoice_profiles").upsert({
    business_id: access.businessId, enabled: v.enabled, supplier_tin: v.supplierTin, supplier_brn: v.supplierBrn,
    supplier_sst: v.supplierSst || null, supplier_ttx: v.supplierTtx || null, msic_code: v.msicCode,
    activity_description: v.activityDescription, phone: v.phone, email: v.email || null, address_line: v.addressLine,
    city: v.city, postcode: v.postcode, state_code: v.stateCode, tax_type: v.taxType, tax_rate_percent: v.taxRatePercent,
    intermediary_authorised_at: authorisedAt, updated_by: access.user.id, updated_at: new Date().toISOString(),
  }, { onConflict: "business_id" });
  if (error) return NextResponse.json({ error: "We couldn't save your e-Invoice settings. Please try again." }, { status: 500, headers });
  await appendSensitiveAudit({
    access, request, action: "einvoice.profile_updated", entityType: "einvoice_profile", entityId: access.businessId,
    after: { enabled: v.enabled, supplier_tin: v.supplierTin, tax_type: v.taxType },
  });
  return NextResponse.json({ saved: true }, { headers });
}
