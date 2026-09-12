import "server-only";

import type { AppSupabaseClient } from "@/lib/supabase/client";

/**
 * The database-provider boundary passed to repositories.
 * Authorization stays in services; tenant scoping stays explicit here.
 */
export interface TenantDatabaseProvider {
  readonly database: AppSupabaseClient;
  readonly businessId: string;
}

export function createTenantDatabaseProvider(
  database: AppSupabaseClient,
  businessId: string,
): TenantDatabaseProvider {
  if (!businessId) throw new Error("A tenant-scoped database provider requires a business ID.");
  return Object.freeze({ database, businessId });
}
