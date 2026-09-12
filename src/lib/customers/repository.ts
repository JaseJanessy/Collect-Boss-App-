import "server-only";

import type { TenantDatabaseProvider } from "@/lib/data/database-provider";
import type { CustomerRecord, CustomerWriteInput } from "./contracts";

export class CustomerRepositoryError extends Error {}

export interface CustomerListQuery {
  query?: string;
  includeArchived?: boolean;
}

export function createCustomerRepository(provider: TenantDatabaseProvider) {
  const { database, businessId } = provider;

  return {
    async list(input: CustomerListQuery = {}): Promise<CustomerRecord[]> {
      const search = input.query?.trim().slice(0, 160) ?? "";
      let query = database
        .from("debtors")
        .select("*")
        .eq("business_id", businessId)
        .order("updated_at", { ascending: false })
        .limit(100);

      if (!input.includeArchived) query = query.is("archived_at", null);
      if (search) {
        query = query.or([
          `individual_name.ilike.%${search}%`,
          `business_name.ilike.%${search}%`,
          `registration_no.ilike.%${search}%`,
        ].join(","));
      }

      const { data, error } = await query;
      if (error) throw new CustomerRepositoryError(error.message);
      return (data ?? []) as CustomerRecord[];
    },

    async findById(id: string): Promise<CustomerRecord | null> {
      const { data, error } = await database.from("debtors").select("*")
        .eq("id", id).eq("business_id", businessId).maybeSingle();
      if (error) throw new CustomerRepositoryError(error.message);
      return data as CustomerRecord | null;
    },

    async countLinkedCases(id: string): Promise<number> {
      const { count } = await database.from("cases")
        .select("id", { count: "exact", head: true }).eq("debtor_id", id);
      return count ?? 0;
    },

    async findDuplicates(
      input: Pick<CustomerRecord, "debtor_type" | "individual_name" | "business_name">,
    ): Promise<CustomerRecord[]> {
      const identityColumn = input.debtor_type === "business" ? "business_name" : "individual_name";
      const identity = (input[identityColumn] ?? "").trim();
      if (!identity) return [];

      const { data, error } = await database.from("debtors").select("*")
        .eq("business_id", businessId)
        .eq("debtor_type", input.debtor_type)
        .is("archived_at", null)
        .ilike(identityColumn, identity)
        .limit(5);
      if (error) return [];
      return (data ?? []) as CustomerRecord[];
    },

    async create(input: CustomerWriteInput): Promise<CustomerRecord> {
      const { data, error } = await database.from("debtors")
        .insert({ ...input, business_id: businessId }).select("*").single();
      if (error || !data) throw new CustomerRepositoryError(error?.message ?? "Unable to create debtor.");
      return data as CustomerRecord;
    },

    async update(id: string, input: Partial<CustomerWriteInput> & { archived_at?: string | null }): Promise<CustomerRecord> {
      const { data, error } = await database.from("debtors")
        .update({ ...input, updated_at: new Date().toISOString() })
        .eq("id", id).eq("business_id", businessId).select("*").single();
      if (error || !data) throw new CustomerRepositoryError(error?.message ?? "Unable to update debtor.");
      return data as CustomerRecord;
    },
  };
}

export type CustomerRepository = ReturnType<typeof createCustomerRepository>;
