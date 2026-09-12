import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { authorizePocketCapability, requirePocketBillingAccess } from "@/lib/billing/pocket-entitlements";
import { appendSensitiveAudit } from "@/lib/auth/tenant-access";
import { loadPocketCustomers } from "@/lib/pocket/ledger-server";
import { normalizePocketEmail, normalizePocketPhone, pocketCustomerDisplayName } from "@/lib/pocket/ledger";

export const dynamic = "force-dynamic";

const customerSchema = z.object({
  displayName: z.string().trim().min(1).max(160),
  businessName: z.string().trim().max(160).optional().nullable(),
  phone: z.string().trim().max(50).optional().nullable(),
  email: z.string().trim().email().max(254).optional().nullable().or(z.literal("")),
  address: z.string().trim().max(1000).optional().nullable(),
  note: z.string().trim().max(4000).optional().nullable(),
  preferredReminderLanguage: z.string().trim().max(40).optional().nullable(),
  confirmSeparate: z.boolean().optional().default(false),
});

const noStore = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie, Authorization" };

export async function GET(request: NextRequest) {
  const access = await requirePocketBillingAccess("case.read");
  if ("code" in access) return NextResponse.json({ error: access.error, code: access.code }, { status: access.status, headers: noStore });
  try {
    const customers = await loadPocketCustomers(access, request.nextUrl.searchParams.get("includeArchived") === "true");
    return NextResponse.json({ customers, currency: String(access.business.default_currency ?? "MYR") }, { headers: noStore });
  } catch {
    return NextResponse.json({ error: "Customer profiles are temporarily unavailable." }, { status: 503, headers: noStore });
  }
}

export async function POST(request: NextRequest) {
  const access = await requirePocketBillingAccess("case.manage");
  if ("code" in access) return NextResponse.json({ error: access.error, code: access.code }, { status: access.status, headers: noStore });
  const parsed = customerSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the customer details and try again.", issues: parsed.error.flatten().fieldErrors }, { status: 400, headers: noStore });
  const authorization = await authorizePocketCapability({ access, capability: "pocket.customer.manage" });
  if ("error" in authorization) return NextResponse.json({ error: authorization.error, code: authorization.code }, { status: authorization.status, headers: noStore });

  const input = parsed.data;
  const normalizedEmail = normalizePocketEmail(input.email);
  const normalizedPhone = normalizePocketPhone(input.phone);
  const { data: existing, error: searchError } = await access.service.from("debtors")
    .select("id,individual_name,business_name,phone,email,normalized_phone,normalized_email")
    .eq("business_id", access.businessId).is("archived_at", null).is("merged_into_id", null);
  if (searchError) return NextResponse.json({ error: "Customer duplicate review is temporarily unavailable." }, { status: 503, headers: noStore });
  const wantedName = input.displayName.toLocaleLowerCase();
  const candidates = ((existing ?? []) as unknown as Array<{id:string;individual_name:string|null;business_name:string|null;phone:string|null;email:string|null;normalized_phone:string|null;normalized_email:string|null}>).flatMap((row) => {
    const exactEmail = Boolean(normalizedEmail && normalizedEmail === (row.normalized_email ?? normalizePocketEmail(row.email)));
    const exactPhone = Boolean(normalizedPhone && normalizedPhone.length >= 7 && normalizedPhone === (row.normalized_phone ?? normalizePocketPhone(row.phone)));
    const name = pocketCustomerDisplayName(row).toLocaleLowerCase();
    const similarName = name === wantedName || (Math.min(name.length, wantedName.length) >= 5 && (name.includes(wantedName) || wantedName.includes(name)));
    return exactEmail || exactPhone || similarName ? [{ id: row.id, displayName: pocketCustomerDisplayName(row), phone: row.phone, email: row.email, reasons: [exactEmail ? "same_email" : null, exactPhone ? "same_phone" : null, similarName ? "similar_name" : null].filter(Boolean) }] : [];
  });
  if (candidates.length && !input.confirmSeparate) return NextResponse.json({ error: "Review possible duplicate customers before creating another profile.", code: "DUPLICATE_REVIEW_REQUIRED", candidates }, { status: 409, headers: noStore });

  const { data, error } = await access.service.from("debtors").insert({
    business_id: access.businessId, debtor_type: "individual", individual_name: input.displayName,
    business_name: input.businessName || null, contact_name: null, registration_no: null,
    phone: input.phone || null, email: input.email || null, address: input.address || null,
    pocket_note: input.note || null, preferred_reminder_language: input.preferredReminderLanguage || null,
    normalized_phone: normalizedPhone, normalized_email: normalizedEmail, archived_at: null,
  }).select("id").single();
  if (error || !data) return NextResponse.json({ error: "The customer could not be created." }, { status: 503, headers: noStore });
  await appendSensitiveAudit({ access, request, action: "pocket.customer.created", entityType: "debtor", entityId: data.id, after: { displayName: input.displayName }, metadata: { duplicate_reviewed: candidates.length > 0, kept_separate: input.confirmSeparate } });
  return NextResponse.json({ customerId: data.id }, { status: 201, headers: noStore });
}
