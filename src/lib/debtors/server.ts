import "server-only";

import type { AppSupabaseClient } from "@/lib/supabase/client";
import type { DebtorRow } from "@/lib/supabase/types";
import { requireTenantPermission } from "@/lib/auth/tenant-access";
import type { TenantPermission } from "@/lib/auth/permissions";
import { createTenantDatabaseProvider } from "@/lib/data/database-provider";
import { createCustomerRepository } from "@/lib/customers/repository";

export async function getAuthenticatedBusiness(permission: TenantPermission = "case.read") {
  const access = await requireTenantPermission(permission);
  if ("error" in access) return { error: access.error, status: access.status };
  return access;
}

export async function findDuplicateDebtors(
  client: AppSupabaseClient,
  businessId: string,
  input: Pick<DebtorRow, "debtor_type" | "individual_name" | "business_name">
) {
  return createCustomerRepository(
    createTenantDatabaseProvider(client, businessId),
  ).findDuplicates(input);
}
