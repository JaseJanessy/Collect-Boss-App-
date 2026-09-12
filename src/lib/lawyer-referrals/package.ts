import type { BusinessRow, CaseRow, EvidenceFileRow, Json, LegalDocumentRow } from "@/lib/supabase/types";
import { calculateStatementLedger, type StatementEventInput } from "../statements/calculations.ts";
import { databaseAmountToMinor } from "../financial/money.ts";

export const LEGAL_HANDOFF_DISCLAIMER = "Prepared from CollectBoss records for review by an external legal professional. CollectBoss does not provide legal advice, determine legal rights, or create legal representation.";

interface StatusHistoryInput { id: string; from_status: string | null; to_status: string; created_at: string }
interface ReminderInput { id: string; message_type: string; sent_channel: string; status: string; sent_at: string; generated_at: string }
interface PaymentInput { id: string; amount: number | string; amount_minor?: number | string; currency?: string; payment_method: string; reference_no: string | null; reviewed_at: string | null; created_at: string }
type HandoffDocument = Pick<LegalDocumentRow, "id" | "document_type" | "title" | "status" | "document_number" | "template_version" | "issued_at">;

export function buildProfessionalHandoffPackage(input: {
  caseData: CaseRow;
  business: BusinessRow;
  evidence: EvidenceFileRow[];
  documents: HandoffDocument[];
  financialEvents: Array<{ id: string; event_type: StatementEventInput["type"]; amount_minor: number | string; created_at: string }>;
  statusHistory: StatusHistoryInput[];
  reminders: ReminderInput[];
  payments: PaymentInput[];
  createdAt?: string;
}): Json {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const from = new Date(input.caseData.created_at);
  const toExclusive = new Date(createdAt);
  toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);
  const ledger = calculateStatementLedger([
    {
      id: input.caseData.id,
      debtorId: input.caseData.debtor_id,
      customerName: input.caseData.debtor_name,
      customerCompany: input.caseData.debtor_company,
      invoiceNo: input.caseData.invoice_no,
      originalPrincipalMinor: String(input.caseData.original_principal_minor),
      createdAt: input.caseData.created_at,
      status: input.caseData.status,
      dueDate: input.caseData.due_date,
    },
  ], input.financialEvents.map((event) => ({
    id: event.id, caseId: input.caseData.id, type: event.event_type,
    amountMinor: String(event.amount_minor), createdAt: event.created_at,
  })), { from, toExclusive, label: "Case history" });

  const timeline: Array<Record<string, Json>> = [
    { id: `case:${input.caseData.id}`, occurred_at: input.caseData.created_at, kind: "case_created", label: "Case record created", status: input.caseData.status },
    ...input.statusHistory.map((item) => ({ id: item.id, occurred_at: item.created_at, kind: "status", label: "Case status updated", from_status: item.from_status, status: item.to_status })),
    ...input.reminders.map((item) => ({ id: item.id, occurred_at: item.sent_at || item.generated_at, kind: "reminder", label: `${item.message_type.replaceAll("_", " ")} reminder`, channel: item.sent_channel, status: item.status })),
    ...input.payments.filter((item) => item.reviewed_at && (!item.currency || item.currency === input.caseData.currency)).map((item) => ({ id: item.id, occurred_at: item.reviewed_at!, kind: "payment", label: "Payment approved", amount_minor: String(item.amount_minor ?? databaseAmountToMinor(item.amount, input.caseData.currency)), payment_method: item.payment_method, reference: item.reference_no })),
    ...input.documents.filter((item) => item.issued_at).map((item) => ({ id: item.id, occurred_at: item.issued_at!, kind: "document", label: "Document issued", document_type: item.document_type, document_number: item.document_number })),
  ].sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at)) || String(a.id).localeCompare(String(b.id)));

  return {
    version: 2,
    created_at: createdAt,
    purpose: "professional legal handoff package for external review",
    disclaimer: LEGAL_HANDOFF_DISCLAIMER,
    currency: input.caseData.currency,
    creditor: {
      legal_name: input.business.legal_name,
      account_type: input.business.account_type,
      registration_no: input.business.account_type === "business" ? input.business.registration_no : null,
      contact_name: input.business.contact_name,
      phone: input.business.phone,
      email: input.business.email,
    },
    case_summary: {
      id: input.caseData.id,
      debtor_type: input.caseData.debtor_type,
      debtor_name: input.caseData.debtor_name,
      debtor_company: input.caseData.debtor_company,
      debtor_registration_no: input.caseData.debtor_reg_no,
      debtor_address: input.caseData.debtor_location,
      invoice_no: input.caseData.invoice_no,
      due_date: input.caseData.due_date,
      days_overdue: input.caseData.days_overdue,
      recovery_status: input.caseData.status,
    },
    balances: {
      original_principal_minor: String(input.caseData.original_principal_minor),
      contractual_due_minor: String(input.caseData.contractual_due_minor),
      approved_payment_minor: String(input.caseData.approved_payment_minor),
      outstanding_minor: String(input.caseData.outstanding_minor),
      overpayment_minor: String(input.caseData.overpayment_minor),
    },
    statement: {
      opening_balance_minor: String(ledger.openingBalanceMinor),
      period_debits_minor: String(ledger.periodDebitsMinor),
      payments_minor: String(ledger.periodPaymentsMinor),
      credits_minor: String(ledger.periodCreditsMinor),
      reversals_minor: String(ledger.periodReversalsMinor),
      movement_minor: String(ledger.movementMinor),
      closing_balance_minor: String(ledger.closingBalanceMinor),
      transactions: ledger.transactions.map((transaction) => ({
        id: transaction.id, occurred_at: transaction.occurredAt, category: transaction.category,
        label: transaction.label, amount_minor: String(transaction.amountMinor), balance_effect_minor: String(transaction.balanceEffectMinor),
      })),
    },
    timeline,
    evidence_list: input.evidence.map((file) => ({
      id: file.id, name: file.file_name, type: file.file_type, evidence_type: file.evidence_type,
      uploaded_at: file.uploaded_at, document_date: file.document_date, content_sha256: file.content_sha256,
    })),
    relevant_documents: input.documents.map((document) => ({
      id: document.id, document_type: document.document_type, title: document.title,
      status: document.status, document_number: document.document_number,
      template_version: document.template_version, issued_at: document.issued_at,
    })),
  };
}
