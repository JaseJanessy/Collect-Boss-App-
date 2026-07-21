import "server-only";

import type { AppSupabaseClient } from "@/lib/supabase/client";
import { getServerClient } from "@/lib/supabase/server-client";
import type { DebtorRow } from "@/lib/supabase/types";

export async function getAuthenticatedBusiness() {
  const client = await getServerClient();
  if (!client) return { error: "Debtor service is unavailable." as const };

  const { data: { user } } = await client.auth.getUser();
  if (!user) return { error: "You must be signed in." as const };

  const { data, error } = await client
    .from("businesses")
    .select("id")
    .eq("owner_id", user.id)
    .maybeSingle();

  if (error || !data) return { error: "A creditor account is required." as const };
  return { client, businessId: (data as { id: string }).id };
}

export async function findDuplicateDebtors(
  client: AppSupabaseClient,
  businessId: string,
  input: Pick<DebtorRow, "debtor_type" | "individual_name" | "business_name">
) {
  const identityColumn = input.debtor_type === "business" ? "business_name" : "individual_name";
  const identity = (input[identityColumn] ?? "").trim();
  if (!identity) return [] as DebtorRow[];

  const { data, error } = await client
    .from("debtors")
    .select("*")
    .eq("business_id", businessId)
    .eq("debtor_type", input.debtor_type)
    .is("archived_at", null)
    .ilike(identityColumn, identity)
    .limit(5);

  return error ? [] : ((data ?? []) as DebtorRow[]);
}
