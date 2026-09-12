import "server-only";

import type { AppSupabaseClient } from "@/lib/supabase/client";
import { daysOverdue, pocketCustomerDisplayName, pocketDebtState, workspaceLocalDate } from "./ledger";

type PocketAccess = {
  service: AppSupabaseClient;
  businessId: string;
  business: { timezone?: unknown; default_currency?: unknown; locale?: unknown };
};

type CustomerRow = {
  id: string; individual_name: string | null; business_name: string | null; phone: string | null; email: string | null;
  address: string | null; archived_at: string | null; created_at: string; updated_at: string; pocket_note: string | null;
  preferred_reminder_language: string | null; normalized_phone: string | null; normalized_email: string | null; merged_into_id: string | null;
};

type DebtRow = {
  id: string; customer_id: string; reference: string; original_amount_minor: number; adjustments_minor: number; paid_minor: number;
  outstanding_minor: number; currency: string; status: string; archived_at: string | null; created_at: string; updated_at: string;
  pocket_description: string; pocket_debt_date: string | null; pocket_due_date: string | null; pocket_reminder_preference: string | null;
};

export async function loadPocketCustomers(access: PocketAccess, includeArchived = false) {
  let query = access.service.from("debtors").select("id,individual_name,business_name,phone,email,address,archived_at,created_at,updated_at,pocket_note,preferred_reminder_language,normalized_phone,normalized_email,merged_into_id")
    .eq("business_id", access.businessId).is("merged_into_id", null).order("individual_name");
  if (!includeArchived) query = query.is("archived_at", null);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const customers = (data ?? []) as unknown as CustomerRow[];
  const ids = customers.map((customer) => customer.id);
  const debtResult = ids.length ? await access.service.from("obligations")
    .select("customer_id,original_amount_minor,adjustments_minor,paid_minor,status,archived_at,pocket_due_date")
    .eq("business_id", access.businessId).eq("origin_product_type", "pocket").in("customer_id", ids) : { data: [], error: null };
  if (debtResult.error) throw new Error(debtResult.error.message);
  const today = workspaceLocalDate(String(access.business.timezone ?? "UTC"));
  const debts = (debtResult.data ?? []) as unknown as Array<Pick<DebtRow,"customer_id"|"original_amount_minor"|"adjustments_minor"|"paid_minor"|"status"|"archived_at"|"pocket_due_date">>;
  return customers.map((customer) => {
    const owned = debts.filter((debt) => debt.customer_id === customer.id);
    return {
      id: customer.id,
      displayName: pocketCustomerDisplayName(customer),
      businessName: customer.business_name,
      phone: customer.phone,
      email: customer.email,
      address: customer.address,
      note: customer.pocket_note,
      preferredReminderLanguage: customer.preferred_reminder_language,
      archivedAt: customer.archived_at,
      debtCount: owned.length,
      openBalanceMinor: owned.reduce((sum, debt) => {
        const state = pocketDebtState({ status: debt.status, archivedAt: debt.archived_at, originalAmountMinor: debt.original_amount_minor, adjustmentsMinor: debt.adjustments_minor, paidMinor: debt.paid_minor, dueDate: debt.pocket_due_date, today });
        return ["active","partially_paid","overdue"].includes(state) ? sum + Math.max(0, debt.original_amount_minor + debt.adjustments_minor - debt.paid_minor) : sum;
      }, 0),
    };
  });
}

export async function loadPocketDebts(access: PocketAccess, customerId?: string | null) {
  let query = access.service.from("obligations").select("id,customer_id,reference,original_amount_minor,adjustments_minor,paid_minor,outstanding_minor,currency,status,archived_at,created_at,updated_at,pocket_description,pocket_debt_date,pocket_due_date,pocket_reminder_preference")
    .eq("business_id", access.businessId).eq("origin_product_type", "pocket").order("created_at", { ascending: false });
  if (customerId) query = query.eq("customer_id", customerId);
  const [{ data, error }, customers] = await Promise.all([
    query,
    access.service.from("debtors").select("id,individual_name,business_name").eq("business_id", access.businessId),
  ]);
  if (error) throw new Error(error.message);
  if (customers.error) throw new Error(customers.error.message);
  const rows = (data ?? []) as unknown as DebtRow[];
  const obligationIds = rows.map((row) => row.id);
  const allocationResult = obligationIds.length ? await access.service.from("payment_allocations")
    .select("id,event_type,reverses_allocation_id,obligation_id,created_at")
    .eq("business_id", access.businessId).in("obligation_id", obligationIds).order("created_at", { ascending: false }) : { data: [], error: null };
  if (allocationResult.error) throw new Error(allocationResult.error.message);
  const allocations = (allocationResult.data ?? []) as Array<{ id:string;event_type:"allocation"|"reversal";reverses_allocation_id:string|null;obligation_id:string|null;created_at:string }>;
  const reversed = new Set(allocations.filter((item) => item.event_type === "reversal" && item.reverses_allocation_id).map((item) => item.reverses_allocation_id));
  const names = new Map(((customers.data ?? []) as unknown as CustomerRow[]).map((row) => [row.id, pocketCustomerDisplayName(row)]));
  const today = workspaceLocalDate(String(access.business.timezone ?? "UTC"));
  return rows.map((debt) => {
    const remainingMinor = Math.max(0, debt.original_amount_minor + debt.adjustments_minor - debt.paid_minor);
    const state = pocketDebtState({ status: debt.status, archivedAt: debt.archived_at, originalAmountMinor: debt.original_amount_minor, adjustmentsMinor: debt.adjustments_minor, paidMinor: debt.paid_minor, dueDate: debt.pocket_due_date, today });
    return {
      id: debt.id, customerId: debt.customer_id, customerName: names.get(debt.customer_id) ?? "Customer", reference: debt.reference,
      description: debt.pocket_description, originalAmountMinor: debt.original_amount_minor, paidMinor: debt.paid_minor, remainingMinor,
      currency: debt.currency, debtDate: debt.pocket_debt_date, dueDate: debt.pocket_due_date, reminderPreference: debt.pocket_reminder_preference,
      status: state, daysOverdue: daysOverdue(debt.pocket_due_date, today),
      lastPaymentAt: allocations.find((item) => item.obligation_id === debt.id && item.event_type === "allocation" && !reversed.has(item.id))?.created_at ?? null,
      archivedAt: debt.archived_at,
      createdAt: debt.created_at, updatedAt: debt.updated_at,
    };
  });
}

export async function loadPocketPaymentActivity(access: PocketAccess, obligationIds: string[]) {
  if (!obligationIds.length) return { recentPayments: [], receipts: [] };
  const { data, error } = await access.service.from("payment_allocations")
    .select("id,receipt_id,event_type,reverses_allocation_id,obligation_id,target_amount_minor,target_currency,created_at")
    .eq("business_id", access.businessId).in("obligation_id", obligationIds).order("created_at", { ascending: false }).limit(50);
  if (error) throw new Error(error.message);
  const events = (data ?? []) as Array<{id:string;receipt_id:string;event_type:"allocation"|"reversal";reverses_allocation_id:string|null;obligation_id:string|null;target_amount_minor:number;target_currency:string;created_at:string}>;
  const receiptIds = [...new Set(events.map((event) => event.receipt_id))];
  const receiptResult = receiptIds.length ? await access.service.from("payment_receipts")
    .select("id,amount_minor,currency,received_at,reference,payer_name,source_type")
    .eq("business_id", access.businessId).in("id", receiptIds) : { data: [], error: null };
  if (receiptResult.error) throw new Error(receiptResult.error.message);
  const receipts = receiptResult.data ?? [];
  return {
    recentPayments: events.map((event) => ({ id:event.id, debtId:event.obligation_id, receiptId:event.receipt_id, eventType:event.event_type, reversesAllocationId:event.reverses_allocation_id, amountMinor:event.target_amount_minor, currency:event.target_currency, createdAt:event.created_at })),
    receipts,
  };
}
