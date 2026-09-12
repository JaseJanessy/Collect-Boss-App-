import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { appendSensitiveAudit } from "@/lib/auth/tenant-access";
import { authorizePocketCapability, requirePocketBillingAccess } from "@/lib/billing/pocket-entitlements";
import { parseCurrencyToMinor } from "@/lib/financial/money";
import { loadPocketDebts } from "@/lib/pocket/ledger-server";
import { workspaceLocalDate } from "@/lib/pocket/ledger";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie, Authorization" };
const debtSchema = z.object({
  customerId: z.string().uuid(), amount: z.string().trim().min(1).max(40), description: z.string().trim().min(1).max(500),
  debtDate: z.string().date().nullable().optional(), dueDate: z.string().date().nullable().optional(), reference: z.string().trim().max(100).nullable().optional(),
  reminderPreference: z.enum(["none","later","on_due_date","weekly"]).nullable().optional(), saveAsDraft: z.boolean().optional().default(false),
}).refine((value) => !value.debtDate || !value.dueDate || value.dueDate >= value.debtDate, { path: ["dueDate"], message: "Due date cannot be before debt date." });

export async function GET(request: NextRequest) {
  const access = await requirePocketBillingAccess("case.read");
  if ("code" in access) return NextResponse.json({ error: access.error, code: access.code }, { status: access.status, headers });
  try {
    const all = await loadPocketDebts(access, request.nextUrl.searchParams.get("customerId"));
    const filter = request.nextUrl.searchParams.get("filter");
    const today = workspaceLocalDate(String(access.business.timezone ?? "UTC"));
    const debts = filter === "due-today" ? all.filter((debt) => debt.dueDate === today && !["settled","cancelled","archived"].includes(debt.status))
      : filter === "overdue" ? all.filter((debt) => debt.status === "overdue") : all;
    return NextResponse.json({ debts, currency: String(access.business.default_currency ?? "MYR"), today }, { headers });
  } catch { return NextResponse.json({ error: "Debts are temporarily unavailable." }, { status: 503, headers }); }
}

export async function POST(request: NextRequest) {
  const access = await requirePocketBillingAccess("case.manage");
  if ("code" in access) return NextResponse.json({ error: access.error, code: access.code }, { status: access.status, headers });
  const parsed = debtSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the debt details and try again.", issues: parsed.error.flatten().fieldErrors }, { status: 400, headers });
  const authorization = await authorizePocketCapability({ access, capability: "pocket.debt.manage" });
  if ("error" in authorization) return NextResponse.json({ error: authorization.error, code: authorization.code }, { status: authorization.status, headers });
  const currency = String(access.business.default_currency ?? "MYR");
  let amountMinor: bigint;
  try { amountMinor = parseCurrencyToMinor(parsed.data.amount, currency); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Enter a valid amount." }, { status: 400, headers }); }
  if (amountMinor > BigInt(Number.MAX_SAFE_INTEGER)) return NextResponse.json({ error: "Amount is too large." }, { status: 400, headers });
  const { data: customer } = await access.service.from("debtors").select("id").eq("id", parsed.data.customerId).eq("business_id", access.businessId).is("archived_at", null).is("merged_into_id", null).maybeSingle();
  if (!customer) return NextResponse.json({ error: "Choose an active customer." }, { status: 400, headers });
  const today = workspaceLocalDate(String(access.business.timezone ?? "UTC"));
  const internalDueDate = parsed.data.dueDate ?? parsed.data.debtDate ?? today;
  const reference = parsed.data.reference || `PKT-${crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
  const status = parsed.data.saveAsDraft ? "draft" : parsed.data.dueDate && parsed.data.dueDate < today ? "overdue" : "open";
  const { data, error } = await access.service.from("obligations").insert({
    business_id: access.businessId, customer_id: parsed.data.customerId, account_id: null, obligation_type: "general_obligation",
    reference, purchase_order_reference: null, issue_date: parsed.data.debtDate ?? null, due_date: internalDueDate,
    currency, original_amount_minor: Number(amountMinor), adjustments_minor: 0, paid_minor: 0, status,
    metadata: { pocket: { version: 1 } }, custom_fields: {}, origin_product_type: "pocket", pocket_description: parsed.data.description,
    pocket_debt_date: parsed.data.debtDate ?? null, pocket_due_date: parsed.data.dueDate ?? null,
    pocket_reminder_preference: parsed.data.reminderPreference === "none" ? null : parsed.data.reminderPreference ?? null,
  }).select("id").single();
  if (error || !data) {
    const limit = error?.message.includes("LIMIT_REACHED");
    return NextResponse.json({ error: limit ? "Your plan's 100 active-debt limit has been reached. Drafts and settled debts do not count." : "The debt could not be saved.", code: limit ? "LIMIT_REACHED" : undefined }, { status: limit ? 409 : 503, headers });
  }
  await appendSensitiveAudit({ access, request, action: parsed.data.saveAsDraft ? "pocket.debt.draft_created" : "pocket.debt.created", entityType: "obligation", entityId: data.id, after: { customerId: parsed.data.customerId, amountMinor: Number(amountMinor), currency, status, dueDate: parsed.data.dueDate ?? null } });
  return NextResponse.json({ debtId: data.id }, { status: 201, headers });
}
