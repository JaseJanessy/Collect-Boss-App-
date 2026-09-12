import "server-only";

import type { AppSupabaseClient } from "@/lib/supabase/client";
import { createTenantDatabaseProvider } from "@/lib/data/database-provider";
import { createCustomerRepository } from "./repository";
import type { CustomerRecord, CustomerWriteInput } from "./contracts";

export interface CustomerTenantAccess {
  client: AppSupabaseClient;
  businessId: string;
}

function repositoryFor(access: CustomerTenantAccess) {
  return createCustomerRepository(createTenantDatabaseProvider(access.client, access.businessId));
}

export async function listCustomers(
  access: CustomerTenantAccess,
  input: { query?: string; includeArchived?: boolean } = {},
) {
  return repositoryFor(access).list(input);
}

export async function getCustomerDetail(access: CustomerTenantAccess, id: string) {
  const repository = repositoryFor(access);
  const customer = await repository.findById(id);
  if (!customer) return null;
  return { customer, linkedCaseCount: await repository.countLinkedCases(id) };
}

export async function createCustomer(
  access: CustomerTenantAccess,
  input: CustomerWriteInput,
  allowDuplicate: boolean,
): Promise<
  | { kind: "duplicate"; duplicates: CustomerRecord[] }
  | { kind: "created"; customer: CustomerRecord }
> {
  const repository = repositoryFor(access);
  const duplicates = await repository.findDuplicates(input);
  if (duplicates.length && !allowDuplicate) return { kind: "duplicate", duplicates };
  return { kind: "created", customer: await repository.create(input) };
}

export async function updateCustomer(
  access: CustomerTenantAccess,
  id: string,
  input: CustomerWriteInput,
) {
  const repository = repositoryFor(access);
  if (!await repository.findById(id)) return null;
  return repository.update(id, input);
}

export async function setCustomerArchived(
  access: CustomerTenantAccess,
  id: string,
  archived: boolean,
) {
  const repository = repositoryFor(access);
  if (!await repository.findById(id)) return null;
  return repository.update(id, { archived_at: archived ? new Date().toISOString() : null });
}
