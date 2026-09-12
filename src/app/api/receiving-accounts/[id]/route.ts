import { NextRequest, NextResponse } from "next/server";
import { receivingAccountUpdateSchema } from "@/lib/receiving-accounts/security";
import { requireReceivingAccountOwner } from "@/lib/receiving-accounts/server";

export const dynamic = "force-dynamic";
const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireReceivingAccountOwner(true);
  if ("error" in auth) return json({ error: auth.error }, auth.status);
  const parsed = receivingAccountUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Invalid account change or confirmation phrase." }, 400);
  const { id } = await params;
  const input = parsed.data;
  const { data, error } = await auth.service.rpc("receiving_account_update_secure", {
    p_actor_id: auth.user.id, p_business_id: auth.business.id, p_account_id: id,
    p_business_entity: input.businessEntity, p_account_holder_name: input.accountHolderName,
    p_bank_name: input.bankName, p_payment_method: input.paymentMethod,
    p_account_identifier: input.accountIdentifier, p_duitnow_id: input.duitnowId,
    p_include_in_reminders: input.includeInReminders, p_is_primary: input.isPrimary,
    p_currency: input.currency,
  });
  if (error || !data) return json({ error: error?.message || "Unable to update receiving account." }, 409);
  return json({ account: Array.isArray(data) ? data[0] : data });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireReceivingAccountOwner(true);
  if ("error" in auth) return json({ error: auth.error }, auth.status);
  const body = await request.json().catch(() => null) as { confirmation?: unknown } | null;
  if (body?.confirmation !== "CHANGE PAYMENT DESTINATION") return json({ error: "Type the required confirmation phrase." }, 400);
  const { id } = await params;
  const { data, error } = await auth.service.rpc("receiving_account_disable_secure", { p_actor_id: auth.user.id, p_business_id: auth.business.id, p_account_id: id });
  if (error || !data) return json({ error: error?.message || "Unable to disable receiving account." }, 409);
  return json({ account: Array.isArray(data) ? data[0] : data });
}
