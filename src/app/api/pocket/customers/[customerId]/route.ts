import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { appendSensitiveAudit } from "@/lib/auth/tenant-access";
import { authorizePocketCapability, requirePocketBillingAccess } from "@/lib/billing/pocket-entitlements";
import { loadPocketCustomers, loadPocketDebts, loadPocketPaymentActivity } from "@/lib/pocket/ledger-server";
import { normalizePocketEmail, normalizePocketPhone } from "@/lib/pocket/ledger";

const updateSchema = z.object({
  displayName: z.string().trim().min(1).max(160).optional(), businessName: z.string().trim().max(160).nullable().optional(),
  phone: z.string().trim().max(50).nullable().optional(), email: z.string().trim().email().max(254).nullable().optional().or(z.literal("")),
  address: z.string().trim().max(1000).nullable().optional(), note: z.string().trim().max(4000).nullable().optional(),
  preferredReminderLanguage: z.string().trim().max(40).nullable().optional(), archived: z.boolean().optional(),
});
const headers = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET(_request: NextRequest, context: { params: Promise<{ customerId: string }> }) {
  const access = await requirePocketBillingAccess("case.read");
  if ("code" in access) return NextResponse.json({ error: access.error, code: access.code }, { status: access.status, headers });
  const { customerId } = await context.params;
  try {
    const [customers, debts] = await Promise.all([loadPocketCustomers(access, true), loadPocketDebts(access, customerId)]);
    const customer = customers.find((item) => item.id === customerId);
    if (!customer) return NextResponse.json({ error: "Customer not found." }, { status: 404, headers });
    const [activity, reminderHistory] = await Promise.all([
      loadPocketPaymentActivity(access, debts.map((debt) => debt.id)),
      access.service.from("pocket_reminder_events").select("created_at,event_type")
        .eq("business_id", access.businessId).eq("customer_id", customerId)
        .order("created_at", { ascending: false }).limit(1),
    ]);
    if (reminderHistory.error) throw new Error("Reminder history unavailable.");
    return NextResponse.json({
      customer,
      debts,
      ...activity,
      lastReminderAt: reminderHistory.data?.[0]?.created_at ?? null,
      lastReminderEvent: reminderHistory.data?.[0]?.event_type ?? null,
      reminders: debts.filter((debt) => debt.reminderPreference).map((debt) => ({ debtId: debt.id, description: debt.description, preference: debt.reminderPreference })),
    }, { headers });
  } catch { return NextResponse.json({ error: "The customer profile is temporarily unavailable." }, { status: 503, headers }); }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ customerId: string }> }) {
  const access = await requirePocketBillingAccess("case.manage");
  if ("code" in access) return NextResponse.json({ error: access.error, code: access.code }, { status: access.status, headers });
  const authorization = await authorizePocketCapability({ access, capability: "pocket.customer.manage" });
  if ("error" in authorization) return NextResponse.json({ error: authorization.error, code: authorization.code }, { status: authorization.status, headers });
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the customer details and try again." }, { status: 400, headers });
  const { customerId } = await context.params;
  const { data: before } = await access.service.from("debtors").select("id,individual_name,business_name,phone,email,address,archived_at").eq("id", customerId).eq("business_id", access.businessId).maybeSingle();
  if (!before) return NextResponse.json({ error: "Customer not found." }, { status: 404, headers });
  if (parsed.data.archived) {
    const debts = await loadPocketDebts(access, customerId);
    if (debts.some((debt) => ["active","partially_paid","overdue","draft"].includes(debt.status))) return NextResponse.json({ error: "Cancel, settle, or archive this customer's open debts first.", code: "CUSTOMER_HAS_OPEN_DEBTS" }, { status: 409, headers });
  }
  const update = {
    ...(parsed.data.displayName !== undefined ? { individual_name: parsed.data.displayName } : {}), ...(parsed.data.businessName !== undefined ? { business_name: parsed.data.businessName || null } : {}),
    ...(parsed.data.phone !== undefined ? { phone: parsed.data.phone || null, normalized_phone: normalizePocketPhone(parsed.data.phone) } : {}),
    ...(parsed.data.email !== undefined ? { email: parsed.data.email || null, normalized_email: normalizePocketEmail(parsed.data.email) } : {}),
    ...(parsed.data.address !== undefined ? { address: parsed.data.address || null } : {}), ...(parsed.data.note !== undefined ? { pocket_note: parsed.data.note || null } : {}),
    ...(parsed.data.preferredReminderLanguage !== undefined ? { preferred_reminder_language: parsed.data.preferredReminderLanguage || null } : {}),
    ...(parsed.data.archived !== undefined ? { archived_at: parsed.data.archived ? new Date().toISOString() : null } : {}), updated_at: new Date().toISOString(),
  };
  const { error } = await access.service.from("debtors").update(update).eq("id", customerId).eq("business_id", access.businessId);
  if (error) return NextResponse.json({ error: "The customer could not be updated." }, { status: 503, headers });
  await appendSensitiveAudit({ access, request, action: parsed.data.archived === undefined ? "pocket.customer.updated" : parsed.data.archived ? "pocket.customer.archived" : "pocket.customer.restored", entityType: "debtor", entityId: customerId, before: before as Record<string, unknown>, after: update });
  return NextResponse.json({ ok: true }, { headers });
}
