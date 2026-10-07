import "server-only";

import type { AppSupabaseClient } from "@/lib/supabase/client";
import {
  buildMyInvoisInvoice,
  validateEinvoiceInput,
  type EinvoiceBuyer,
  type EinvoiceSupplier,
  type StateCode,
  type TaxType,
} from "./myinvois-document";
import { getDocumentDetails, getSubmission, myInvoisConfig, MyInvoisError, submitDocument } from "./myinvois-client";

export interface EinvoiceProfileRow {
  business_id: string; enabled: boolean; supplier_tin: string; supplier_brn: string; supplier_sst: string | null; supplier_ttx: string | null;
  msic_code: string; activity_description: string; phone: string; email: string | null; address_line: string; city: string;
  postcode: string; state_code: string; tax_type: TaxType; tax_rate_percent: number | string;
}

export interface CustomerTaxDetailsRow {
  tin: string | null; id_scheme: EinvoiceBuyer["idScheme"]; id_value: string | null; sst_no: string | null;
  address_line: string | null; city: string | null; postcode: string | null; state_code: string | null; country_code: string;
}

export class EinvoiceInputError extends Error {
  constructor(readonly problems: string[]) {
    super(problems[0] ?? "The e-Invoice details are incomplete.");
  }
}

export function supplierFromProfile(profile: EinvoiceProfileRow, businessName: string): EinvoiceSupplier {
  return {
    name: businessName,
    tin: profile.supplier_tin.trim().toUpperCase(),
    brn: profile.supplier_brn.trim(),
    sst: profile.supplier_sst?.trim() || null,
    ttx: profile.supplier_ttx?.trim() || null,
    msicCode: profile.msic_code,
    activityDescription: profile.activity_description,
    phone: profile.phone.replace(/[\s-]/g, ""),
    email: profile.email,
    address: { line: profile.address_line, city: profile.city, postcode: profile.postcode, stateCode: profile.state_code as StateCode, countryCode: "MYS" },
    taxType: profile.tax_type,
    taxRatePercent: Number(profile.tax_rate_percent) || 0,
  };
}

export function buyerFromCustomer(
  customer: { business_name: string | null; individual_name: string | null; contact_name: string | null; registration_no: string | null; phone: string | null; email: string | null },
  details: CustomerTaxDetailsRow | null,
): EinvoiceBuyer {
  const idScheme = details?.id_scheme ?? (customer.registration_no ? "BRN" : null);
  return {
    name: customer.business_name || customer.individual_name || customer.contact_name || "",
    tin: details?.tin?.trim().toUpperCase() || null,
    idScheme,
    idValue: details?.id_value?.trim() || (idScheme === "BRN" ? customer.registration_no : null),
    sst: details?.sst_no?.trim() || null,
    phone: customer.phone?.replace(/[\s-]/g, "") || null,
    email: customer.email,
    address: details?.address_line && details.city
      ? { line: details.address_line, city: details.city, postcode: details.postcode ?? "00000", stateCode: (details.state_code ?? "17") as StateCode, countryCode: details.country_code }
      : null,
  };
}

function nowParts(now = new Date()) {
  const iso = now.toISOString();
  return { issueDate: iso.slice(0, 10), issueTimeUtc: `${iso.slice(11, 19)}Z` };
}

/** Builds, validates and submits the e-Invoice for one invoice (obligation). */
export async function submitObligationEinvoice(service: AppSupabaseClient, input: { businessId: string; obligationId: string; userId: string }) {
  const config = myInvoisConfig();
  if (!config.configured) throw new MyInvoisError("e-Invoicing is not available yet.", "NOT_CONFIGURED", 503);

  const [{ data: profile }, { data: business }, { data: obligation }] = await Promise.all([
    service.from("einvoice_profiles").select("*").eq("business_id", input.businessId).maybeSingle(),
    service.from("businesses").select("business_name,legal_name").eq("id", input.businessId).maybeSingle(),
    service.from("obligations").select("id,customer_id,reference,currency,original_amount_minor,adjustments_minor,status,archived_at,metadata")
      .eq("id", input.obligationId).eq("business_id", input.businessId).maybeSingle(),
  ]);
  const p = profile as EinvoiceProfileRow | null;
  if (!p?.enabled) throw new EinvoiceInputError(["Set up e-Invoicing in Settings first."]);
  const o = obligation as { id: string; customer_id: string; reference: string; currency: string; original_amount_minor: number; adjustments_minor: number; status: string; archived_at: string | null; metadata: { label?: string } | null } | null;
  if (!o || o.archived_at || ["draft", "void"].includes(o.status)) throw new EinvoiceInputError(["This invoice can't be sent as an e-Invoice."]);

  const { data: live } = await service.from("einvoice_documents").select("id")
    .eq("business_id", input.businessId).eq("obligation_id", o.id).in("status", ["submitted", "valid"]).limit(1);
  if ((live ?? []).length > 0) throw new EinvoiceInputError(["This invoice already has an e-Invoice in progress or validated."]);

  const [{ data: customer }, { data: details }] = await Promise.all([
    service.from("debtors").select("business_name,individual_name,contact_name,registration_no,phone,email").eq("id", o.customer_id).eq("business_id", input.businessId).maybeSingle(),
    service.from("customer_tax_details").select("*").eq("business_id", input.businessId).eq("customer_id", o.customer_id).maybeSingle(),
  ]);
  if (!customer) throw new EinvoiceInputError(["The customer for this invoice was not found."]);

  const b = business as { business_name: string; legal_name: string | null } | null;
  const supplier = supplierFromProfile(p, b?.legal_name || b?.business_name || "");
  const buyer = buyerFromCustomer(customer as Parameters<typeof buyerFromCustomer>[0], details as CustomerTaxDetailsRow | null);
  const invoice = {
    codeNumber: o.reference,
    ...nowParts(),
    currency: o.currency,
    totalMinor: Number(o.original_amount_minor) + Number(o.adjustments_minor),
    description: o.metadata?.label ? `${o.metadata.label} (${o.reference})` : `Invoice ${o.reference}`,
  };
  const problems = validateEinvoiceInput(supplier, buyer, invoice);
  if (problems.length) throw new EinvoiceInputError(problems);

  const result = await submitDocument(supplier.tin, invoice.codeNumber, buildMyInvoisInvoice(supplier, buyer, invoice));
  const rejectedMessages = result.rejected
    ? [result.rejected.error?.message, ...(result.rejected.error?.details ?? []).map((detail) => detail.message)].filter(Boolean)
    : [];
  const { data: saved, error } = await service.from("einvoice_documents").insert({
    business_id: input.businessId,
    obligation_id: o.id,
    customer_id: o.customer_id,
    environment: config.environment,
    code_number: invoice.codeNumber,
    document_hash: result.documentHash,
    submission_uid: result.submissionUid,
    uuid: result.accepted?.uuid ?? null,
    status: result.accepted ? "submitted" : "rejected",
    errors: rejectedMessages,
    submitted_by: input.userId,
  }).select("*").single();
  if (error || !saved) throw new MyInvoisError("The e-Invoice was sent but could not be saved. Contact support.", "SAVE_FAILED", 500);
  return saved;
}

/** Polls LHDN for documents still being validated. Run from the hourly job. */
export async function refreshPendingEinvoices(service: AppSupabaseClient, limit = 50) {
  if (!myInvoisConfig().configured) return { checked: 0, updated: 0 };
  const { data: pending } = await service.from("einvoice_documents")
    .select("id,business_id,submission_uid,uuid").eq("status", "submitted").not("submission_uid", "is", null)
    .order("submitted_at").limit(limit);
  const rows = (pending ?? []) as Array<{ id: string; business_id: string; submission_uid: string; uuid: string | null }>;
  const tins = new Map<string, string>();
  let updated = 0;
  for (const row of rows) {
    if (!tins.has(row.business_id)) {
      const { data } = await service.from("einvoice_profiles").select("supplier_tin").eq("business_id", row.business_id).maybeSingle();
      tins.set(row.business_id, (data as { supplier_tin?: string } | null)?.supplier_tin ?? "");
    }
    const tin = tins.get(row.business_id);
    if (!tin) continue;
    try {
      const submission = await getSubmission(tin, row.submission_uid);
      const summary = submission.documentSummary.find((item) => item.uuid === row.uuid) ?? submission.documentSummary[0];
      if (!summary || summary.status === "Submitted") continue;
      const status = summary.status === "Valid" ? "valid" : summary.status === "Cancelled" ? "cancelled" : "invalid";
      let errors: string[] = [];
      if (status === "invalid") {
        const details = await getDocumentDetails(tin, summary.uuid).catch(() => null);
        errors = (details?.validationResults?.validationSteps ?? [])
          .filter((step) => step.status === "Invalid")
          .flatMap((step) => [step.error?.error, ...(step.error?.innerError ?? []).map((inner) => inner.error)])
          .filter((message): message is string => Boolean(message))
          .slice(0, 10);
      }
      await service.from("einvoice_documents").update({
        status, long_id: summary.longId ?? null, validated_at: summary.dateTimeValidated ?? new Date().toISOString(),
        errors, updated_at: new Date().toISOString(),
      }).eq("id", row.id);
      updated += 1;
    } catch {
      // Try again on the next run.
    }
  }
  return { checked: rows.length, updated };
}
