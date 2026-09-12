import { NextRequest, NextResponse } from "next/server";
import { receivingAccountCreateSchema } from "@/lib/receiving-accounts/security";
import { requireReceivingAccountOwner } from "@/lib/receiving-accounts/server";

export const dynamic = "force-dynamic";

const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: NextRequest) {
  const auth = await requireReceivingAccountOwner(true);
  if ("error" in auth) return json({ error: auth.error }, auth.status);
  const parsed = receivingAccountCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Enter valid account details and type the required confirmation phrase." }, 400);
  const input = parsed.data;
  const { data, error } = await auth.service.rpc("receiving_account_create_secure", {
    p_actor_id: auth.user.id, p_business_id: auth.business.id,
    p_business_entity: input.businessEntity, p_account_holder_name: input.accountHolderName,
    p_bank_name: input.bankName, p_payment_method: input.paymentMethod,
    p_account_identifier: input.accountIdentifier, p_duitnow_id: input.duitnowId || null,
    p_include_in_reminders: input.includeInReminders, p_is_primary: input.isPrimary,
    p_currency: input.currency,
  });
  if (error || !data) return json({ error: error?.message || "Unable to create receiving account." }, 409);
  return json({ account: Array.isArray(data) ? data[0] : data }, 201);
}
