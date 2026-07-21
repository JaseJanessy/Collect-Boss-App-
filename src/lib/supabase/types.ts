// ─── CollectBoss Database Types ───────────────────────────────────────────────
// Mirrors the canonical base schema in supabase/schema.sql. This TypeScript
// file is not a SQL migration or a second schema source.
// Each table has three views: Row (read), Insert (create), Update (patch)

  export type CaseStatus =
  | "action_needed"
  | "payment_promise"
  | "partial_paid"
  | "paid"
  | "overdue"
  | "formal_demand_ready"
  | "closed";

export type AccountType = "individual" | "business";
export type DebtorType = "individual" | "business";

export type PaymentLockMode = "immediate" | "approval" | "manual";

export type AccessRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "sent_manually";
export type AccessType = "once" | "24h" | "manual";

export type ReminderStatus =
  | "sent"
  | "failed"
  | "pending"
  | "draft"
  | "copied"
  | "sent_manually"
  | "follow_up_needed";
export type ReminderChannel = "whatsapp" | "email" | "sms";

export type PaymentMethod =
  | "duitnow_qr"
  | "bank_transfer"
  | "cash"
  | "cheque"
  | "tng_ewallet";

export type PaymentReviewStatus = "pending_review" | "approved" | "rejected" | "unmatched" | "reversed";

export type EvidenceType =
  | "invoice"
  | "whatsapp"
  | "payment_proof"
  | "contract"
  | "delivery_order"
  | "notes"
  | "other";

export type LegalDocType =
  | "demand_standard"
  | "demand_firm"
  | "demand_final"
  | "acknowledgement"
  | "payment_plan"
  | "small_claim_pack"
  | "evidence_pack";

export type LegalDocStatus = "draft" | "finalised" | "sent" | "archived";

export type ActorType = "owner" | "system" | "debtor";

// Supabase JSON type — matches jsonb columns
export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [key: string]: Json };

// ─── Database interface (Supabase generic pattern) ────────────────────────────
// Relationships must be present on every table — Supabase SDK requires it.

export interface Database {
  public: {
    Tables: {
      businesses: {
        Row: BusinessRow;
        Insert: BusinessInsert;
        Update: BusinessUpdate;
        Relationships: [];
      };
      debtors: {
        Row: DebtorRow;
        Insert: DebtorInsert;
        Update: DebtorUpdate;
        Relationships: [];
      };
      cases: {
        Row: CaseRow;
        Insert: CaseInsert;
        Update: CaseUpdate;
        Relationships: [];
      };
      evidence_files: {
        Row: EvidenceFileRow;
        Insert: EvidenceFileInsert;
        Update: EvidenceFileUpdate;
        Relationships: [];
      };
      reminders: {
        Row: ReminderRow;
        Insert: ReminderInsert;
        Update: ReminderUpdate;
        Relationships: [];
      };
      payment_access_requests: {
        Row: PaymentAccessRequestRow;
        Insert: PaymentAccessRequestInsert;
        Update: PaymentAccessRequestUpdate;
        Relationships: [];
      };
      payment_access_events: {
        Row: PaymentAccessEventRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      receiving_accounts: {
        Row: ReceivingAccountRow;
        Insert: ReceivingAccountInsert;
        Update: ReceivingAccountUpdate;
        Relationships: [];
      };
      payments: {
        Row: PaymentRow;
        Insert: PaymentInsert;
        Update: PaymentUpdate;
        Relationships: [];
      };
      case_financial_events: {
        Row: CaseFinancialEventRow;
        Insert: CaseFinancialEventInsert;
        Update: never;
        Relationships: [];
      };
      legal_documents: {
        Row: LegalDocumentRow;
        Insert: LegalDocumentInsert;
        Update: LegalDocumentUpdate;
        Relationships: [];
      };
      payment_plans: {
        Row: PaymentPlanRow;
        Insert: PaymentPlanInsert;
        Update: PaymentPlanUpdate;
        Relationships: [];
      };
      payment_plan_installments: {
        Row: PaymentPlanInstallmentRow;
        Insert: PaymentPlanInstallmentInsert;
        Update: never;
        Relationships: [];
      };
      payment_plan_allocations: {
        Row: PaymentPlanAllocationRow;
        Insert: PaymentPlanAllocationInsert;
        Update: never;
        Relationships: [];
      };
      lawyer_referrals: {
        Row: LawyerReferralRow;
        Insert: LawyerReferralInsert;
        Update: LawyerReferralUpdate;
        Relationships: [];
      };
      lawyer_referral_events: {
        Row: LawyerReferralEventRow;
        Insert: LawyerReferralEventInsert;
        Update: never;
        Relationships: [];
      };
      audit_logs: {
        Row: AuditLogRow;
        Insert: AuditLogInsert;
        // Append-only — Update is typed but never called in application code
        Update: Partial<Omit<AuditLogRow, "id" | "created_at">>;
        Relationships: [];
      };
      // ── Billing tables (see supabase/billing.sql) ──────────────────────────
      plans: {
        Row:           import("@/lib/billing/types").PlanRow;
        Insert:        Omit<import("@/lib/billing/types").PlanRow, "id" | "created_at"> & { id?: string; created_at?: string };
        Update:        Partial<Omit<import("@/lib/billing/types").PlanRow, "id" | "created_at">>;
        Relationships: [];
      };
      subscriptions: {
        Row:           import("@/lib/billing/types").SubscriptionRow;
        Insert:        import("@/lib/billing/types").SubscriptionUpsert;
        Update:        Partial<Omit<import("@/lib/billing/types").SubscriptionRow, "id" | "business_id" | "created_at">>;
        Relationships: [];
      };
      billing_events: {
        Row:           import("@/lib/billing/types").BillingEventRow;
        Insert:        import("@/lib/billing/types").BillingEventInsert;
        Update:        Partial<Omit<import("@/lib/billing/types").BillingEventRow, "id" | "created_at">>;
        Relationships: [];
      };
      entitlements: {
        Row:           import("@/lib/billing/types").EntitlementRow;
        Insert:        Omit<import("@/lib/billing/types").EntitlementRow, "id"> & { id?: string };
        Update:        import("@/lib/billing/types").EntitlementUpdate;
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      transition_case_status: {
        Args: { p_case_id: string; p_to_status: CaseStatus; p_reason?: string | null; p_promise_due_date?: string | null; p_expected_version?: number | null };
        Returns: CaseRow;
      };
      archive_closed_case: {
        Args: { p_case_id: string; p_reason: string | null; p_expected_version?: number | null };
        Returns: CaseRow;
      };
      financial_create_owner_payment: { Args: { p_case_id: string; p_amount_minor: string; p_payment_method: PaymentMethod; p_reference_no?: string | null; p_proof_url?: string | null; p_notes?: string | null; p_approve?: boolean }; Returns: PaymentRow; };
      financial_review_payment: { Args: { p_payment_id: string; p_decision: "approved" | "rejected" | "unmatched" }; Returns: PaymentRow; };
      financial_review_public_payment_submission: { Args: { p_submission_id: string; p_decision: "approved" | "rejected" }; Returns: unknown; };
      financial_reverse_payment: { Args: { p_payment_id: string; p_idempotency_key: string; p_reason?: string | null }; Returns: CaseRow; };
      financial_reconcile_case: { Args: { p_case_id: string }; Returns: Json; };
      payment_plan_create_proposal: {
        Args: { p_case_id: string; p_frequency: PaymentPlanFrequency; p_first_due_date: string; p_installment_count: number; p_custom_due_dates?: Json; p_notes?: string | null };
        Returns: PaymentPlanRow;
      };
      payment_plan_record_response: {
        Args: { p_token_id: string; p_decision: PaymentPlanResponse; p_signer_name: string; p_signer_phone: string; p_rejection_reason?: string | null; p_ip_hash?: string | null; p_actor_context?: Json };
        Returns: PaymentPlanRow;
      };
      payment_plan_detect_missed: { Args: { p_as_of_date?: string | null }; Returns: number; };
      public_rotate_access_token: { Args: { p_token_id: string; p_replacement_token_hash: string; p_actor_id: string; p_expires_at: string }; Returns: Json; };
    };
    Enums: {
      case_status: CaseStatus;
      payment_lock_mode: PaymentLockMode;
      access_request_status: AccessRequestStatus;
      access_type: AccessType;
      reminder_status: ReminderStatus;
      reminder_channel: ReminderChannel;
      payment_method: PaymentMethod;
      payment_review_status: PaymentReviewStatus;
      evidence_type: EvidenceType;
      legal_doc_type: LegalDocType;
      legal_doc_status: LegalDocStatus;
      actor_type: ActorType;
    };
  };
}

// ─── 1. businesses ────────────────────────────────────────────────────────────

export interface BusinessRow {
  id: string;
  owner_id: string;           // references auth.users.id
  business_name: string;
  registration_no: string | null;
  account_type: AccountType | null;
  legal_name: string | null;
  contact_name: string | null;
  logo_object_path: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  created_at: string;
}

export type BusinessInsert = Omit<BusinessRow, "id" | "created_at"> & {
  id?: string;
  created_at?: string;
};

export type BusinessUpdate = Partial<Omit<BusinessRow, "id" | "owner_id" | "created_at">>;

export interface DebtorRow {
  id: string;
  business_id: string;
  debtor_type: DebtorType;
  individual_name: string | null;
  business_name: string | null;
  contact_name: string | null;
  registration_no: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export type DebtorInsert = Omit<DebtorRow, "id" | "created_at" | "updated_at"> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type DebtorUpdate = Partial<
  Omit<DebtorRow, "id" | "business_id" | "created_at" | "updated_at">
>;

// ─── 2. cases ─────────────────────────────────────────────────────────────────

export interface CaseRow {
  id: string;
  business_id: string;
  debtor_id: string | null;
  debtor_type: DebtorType;
  debtor_name: string;
  debtor_phone: string | null;
  debtor_email: string | null;
  debtor_company: string | null;
  debtor_reg_no: string | null;
  debtor_location: string | null;
  amount_owed: number;
  amount_paid: number;
  balance: number;            // computed: amount_owed - amount_paid
  original_principal_minor: number;
  contractual_due_minor: number;
  approved_payment_minor: number;
  outstanding_minor: number;
  overpayment_minor: number;
  financial_version: number;
  due_date: string;           // ISO date string
  invoice_no: string | null;
  status: CaseStatus;
  promise_due_date: string | null;
  closed_at: string | null;
  closed_by: string | null;
  close_reason: string | null;
  archived_at: string | null;
  archived_by: string | null;
  archive_reason: string | null;
  status_version: number;
  next_best_action: string | null;
  payment_lock_mode: PaymentLockMode;
  receiving_account_id: string | null;
  days_overdue: number;       // computed via trigger or view
  notes: string | null;
  bank: string | null;
  created_at: string;
  updated_at: string;
}

export type CaseInsert = Omit<
  CaseRow,
  "id" | "balance" | "days_overdue" | "created_at" | "updated_at" | "promise_due_date" | "closed_at" | "closed_by" | "close_reason" | "archived_at" | "archived_by" | "archive_reason" | "status_version" | "original_principal_minor" | "contractual_due_minor" | "approved_payment_minor" | "outstanding_minor" | "overpayment_minor" | "financial_version" | "receiving_account_id"
> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
  promise_due_date?: string | null;
  closed_at?: string | null;
  closed_by?: string | null;
  close_reason?: string | null;
  archived_at?: string | null;
  archived_by?: string | null;
  archive_reason?: string | null;
  status_version?: number;
};

export type CaseUpdate = Partial<
  Omit<CaseRow, "id" | "business_id" | "amount_owed" | "amount_paid" | "balance" | "original_principal_minor" | "contractual_due_minor" | "approved_payment_minor" | "outstanding_minor" | "overpayment_minor" | "financial_version" | "days_overdue" | "created_at" | "updated_at">
>;

// ─── 3. evidence_files ────────────────────────────────────────────────────────

export interface EvidenceFileRow {
  id: string;
  case_id: string;
  file_name: string;
  file_type: string;          // e.g. "PDF", "JPG"
  file_url: string | null;    // Supabase Storage URL
  file_size_bytes: number | null;
  evidence_type: EvidenceType;
  uploaded_at: string;
  object_path: string | null;
  description: string | null;
  document_date: string | null;
  is_internal: boolean;
  archived_at: string | null;
  archived_by: string | null;
  retention_until: string | null;
  content_sha256: string | null;
}

export type EvidenceFileInsert = Omit<EvidenceFileRow, "id" | "uploaded_at" | "object_path" | "description" | "document_date" | "is_internal" | "archived_at" | "archived_by" | "retention_until" | "content_sha256"> & {
  id?: string;
  uploaded_at?: string;
  object_path?: string | null;
  description?: string | null;
  document_date?: string | null;
  is_internal?: boolean;
  archived_at?: string | null;
  archived_by?: string | null;
  retention_until?: string | null;
  content_sha256?: string | null;
};

export type EvidenceFileUpdate = Partial<
  Omit<EvidenceFileRow, "id" | "case_id" | "uploaded_at">
>;

// ─── 4. reminders ─────────────────────────────────────────────────────────────

export interface ReminderRow {
  id: string;
  case_id: string;
  message_type: string;       // e.g. "friendly", "firm", "final"
  message_body: string;
  sent_channel: ReminderChannel;
  sent_at: string;
  status: ReminderStatus;
  error_message: string | null;
  template_version: number;
  recipient: string | null;
  generated_at: string;
  composer_opened_at: string | null;
  manually_confirmed_at: string | null;
  next_action_at: string | null;
  request_key: string;
}

export type ReminderInsert = Omit<ReminderRow, "id" | "sent_at" | "template_version" | "recipient" | "generated_at" | "composer_opened_at" | "manually_confirmed_at" | "next_action_at" | "request_key"> & {
  id?: string;
  sent_at?: string;
  template_version?: number;
  recipient?: string | null;
  generated_at?: string;
  composer_opened_at?: string | null;
  manually_confirmed_at?: string | null;
  next_action_at?: string | null;
  request_key?: string;
};

export type ReminderUpdate = Partial<
  Omit<ReminderRow, "id" | "case_id" | "sent_at">
>;

// ─── 5. payment_access_requests ───────────────────────────────────────────────

export interface PaymentAccessRequestRow {
  id: string;
  case_id: string;
  requester_name: string;
  requester_phone: string;
  otp_verified: boolean;
  preferred_method: string | null;
  reason: string | null;
  status: AccessRequestStatus;
  access_type: AccessType | null;
  approved_at: string | null;
  expires_at: string | null;
  created_at: string;
}

export type PaymentAccessRequestInsert = Omit<
  PaymentAccessRequestRow,
  "id" | "approved_at" | "expires_at" | "created_at"
> & {
  id?: string;
  approved_at?: string;
  expires_at?: string;
  created_at?: string;
};

export type PaymentAccessRequestUpdate = Partial<
  Omit<PaymentAccessRequestRow, "id" | "case_id" | "created_at">
>;

// ─── 6. receiving_accounts ────────────────────────────────────────────────────

export interface ReceivingAccountRow {
  id: string;
  business_id: string;
  bank_name: string;
  account_holder_name: string;
  account_number: string;
  duitnow_id: string | null;
  duitnow_qr_url: string | null;
  include_in_reminders: boolean;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
  version: number;
}

export type ReceivingAccountInsert = Omit<ReceivingAccountRow, "id" | "created_at" | "updated_at" | "version"> & {
  id?: string;
  created_at?: string;
};

export type ReceivingAccountUpdate = Partial<
  Omit<ReceivingAccountRow, "id" | "business_id" | "created_at" | "updated_at" | "version">
>;

export interface PaymentAccessEventRow {
  id: string;
  case_id: string;
  receiving_account_id: string | null;
  payment_access_request_id: string | null;
  public_access_token_id: string | null;
  action: string;
  actor_id: string | null;
  actor_type: string;
  metadata: Json;
  created_at: string;
}

// ─── 7. payments ──────────────────────────────────────────────────────────────

export interface PaymentRow {
  id: string;
  case_id: string;
  amount: number;
  payment_method: PaymentMethod;
  reference_no: string | null;
  proof_url: string | null;   // Supabase Storage URL
  review_status: PaymentReviewStatus;
  reviewed_at: string | null;
  reviewed_by: string | null; // business owner's auth.uid
  notes: string | null;
  financial_event_id: string | null;
  source_submission_id: string | null;
  reversed_at: string | null;
  reversed_by: string | null;
  reversal_reason: string | null;
  created_at: string;
}

export type PaymentInsert = Omit<
  PaymentRow,
  "id" | "reviewed_at" | "reviewed_by" | "financial_event_id" | "source_submission_id" | "reversed_at" | "reversed_by" | "reversal_reason" | "created_at"
> & {
  id?: string;
  created_at?: string;
};

export type PaymentUpdate = Partial<
  Omit<PaymentRow, "id" | "case_id" | "created_at">
>;

export type FinancialEventType = "opening_payment_credit" | "payment_approved" | "payment_reversal" | "adjustment_debit" | "adjustment_credit";

export interface CaseFinancialEventRow {
  id: string;
  case_id: string;
  event_type: FinancialEventType;
  amount_minor: number;
  source_table: string;
  source_id: string;
  idempotency_key: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export type CaseFinancialEventInsert = Omit<CaseFinancialEventRow, "id" | "created_at"> & { id?: string; created_at?: string };

// ─── 8. legal_documents ───────────────────────────────────────────────────────

export interface LegalDocumentRow {
  id: string;
  case_id: string;
  document_type: LegalDocType;
  title: string;
  content: string;            // draft text / JSON
  status: LegalDocStatus;
  generation_key: string | null;
  document_number: string | null;
  template_version: number;
  issued_at: string | null;
  issued_by: string | null;
  snapshot: Json | null;
  sent_at: string | null;
  created_at: string;
}

export type LegalDocumentInsert = Omit<LegalDocumentRow, "id" | "generation_key" | "document_number" | "template_version" | "issued_at" | "issued_by" | "snapshot" | "sent_at" | "created_at"> & {
  id?: string;
  generation_key?: string | null;
  document_number?: string | null;
  template_version?: number;
  issued_at?: string | null;
  issued_by?: string | null;
  snapshot?: Json | null;
  created_at?: string;
  sent_at?: string;
};

export type LegalDocumentUpdate = Partial<
  Omit<LegalDocumentRow, "id" | "case_id" | "created_at">
>;

// ─── 10. payment_plans ───────────────────────────────────────────────────────

export type PaymentPlanStatus = "pending_acceptance" | "active" | "defaulted" | "completed" | "cancelled";
export type PaymentPlanFrequency = "weekly" | "monthly" | "custom";
export type PaymentPlanResponse = "accepted" | "rejected";
export type PaymentPlanInstallmentStatus = "scheduled" | "partial" | "paid" | "overdue" | "cancelled";

export interface PaymentPlanRow {
  id:                 string;
  case_id:            string;
  total_amount:       number;
  installment_count:  number;
  installment_amount: number;
  start_date:         string;        // ISO date
  due_dates:          string[];      // jsonb — array of ISO dates
  status:             PaymentPlanStatus;
  debtor_confirmed:   boolean;
  debtor_name:        string | null;
  debtor_phone:       string | null;
  signature_url:      string | null;
  confirmed_at:       string | null;
  notes:              string | null;
  frequency:          PaymentPlanFrequency;
  timezone:           "Asia/Kuala_Lumpur";
  terms_version:      number;
  terms_snapshot:     Json;
  accepted_at:        string | null;
  rejected_at:        string | null;
  rejection_reason:   string | null;
  grace_days:         number;
  acceptance_token_id: string | null;
  created_at:         string;
}

export type PaymentPlanInsert = Omit<PaymentPlanRow, "id" | "created_at"> & {
  id?:         string;
  created_at?: string;
};

export type PaymentPlanUpdate = Partial<
  Omit<PaymentPlanRow, "id" | "case_id" | "created_at">
>;

export interface PaymentPlanInstallmentRow {
  id: string;
  payment_plan_id: string;
  sequence_no: number;
  due_date: string;
  amount_minor: string;
  paid_minor: string;
  status: PaymentPlanInstallmentStatus;
  settled_at: string | null;
  created_at: string;
}

export type PaymentPlanInstallmentInsert = Omit<PaymentPlanInstallmentRow, "id" | "created_at"> & {
  id?: string;
  created_at?: string;
};

export interface PaymentPlanAllocationRow {
  id: string;
  payment_plan_id: string;
  payment_plan_installment_id: string;
  financial_event_id: string;
  amount_minor: string;
  created_at: string;
}

export type PaymentPlanAllocationInsert = Omit<PaymentPlanAllocationRow, "id" | "created_at"> & {
  id?: string;
  created_at?: string;
};

// ─── 9. audit_logs ────────────────────────────────────────────────────────────

export interface AuditLogRow {
  id: string;
  business_id: string;
  case_id: string | null;
  action: string;             // e.g. "case.created", "payment.approved"
  actor_type: ActorType;
  actor_id: string | null;    // auth.uid or "system"
  metadata: Json | null;      // jsonb column
  created_at: string;
}

export interface AuditLogInsert {
  id?: string;
  business_id: string;
  case_id?: string | null;
  action: string;
  actor_type: ActorType;
  actor_id?: string | null;
  metadata?: Json | null;
  created_at?: string;
}

// ─── 11. lawyer_referrals ────────────────────────────────────────────────────

export type ReferralStatus =
  | "draft"
  | "ready_for_review"
  | "handoff_pending"
  | "handoff_failed"
  | "submitted"
  | "under_review"
  | "lawyer_contacted"
  | "accepted"
  | "declined"
  | "withdrawn"
  | "closed";

export type ContactMethod = "whatsapp" | "email" | "phone";

export interface LawyerReferralRow {
  id:                      string;
  case_id:                 string;
  business_id:             string;
  referral_status:         ReferralStatus;
  partner_id:              string | null;   // e.g. "law-001"
  partner_name:            string | null;
  partner_firm:            string | null;
  preferred_contact_method: ContactMethod;
  case_summary:            string | null;
  evidence_pack_id:        string | null;
  formal_demand_id:        string | null;
  notes:                   string | null;
  consent_version:         string | null;
  consented_at:            string | null;
  consent_snapshot:        Json;
  data_package_snapshot:   Json;
  data_package_created_at: string | null;
  shared_at:               string | null;
  handoff_channel:         string | null;
  provider_reference:      string | null;
  withdrawn_at:            string | null;
  withdrawal_reason:       string | null;
  idempotency_key:         string | null;
  last_handoff_error:      string | null;
  created_at:              string;
  updated_at:              string;
}

export type LawyerReferralInsert = Omit<LawyerReferralRow, "id" | "created_at" | "updated_at" | "consent_version" | "consented_at" | "consent_snapshot" | "data_package_snapshot" | "data_package_created_at" | "shared_at" | "handoff_channel" | "provider_reference" | "withdrawn_at" | "withdrawal_reason" | "idempotency_key" | "last_handoff_error"> & {
  id?:         string;
  created_at?: string;
  updated_at?: string;
  consent_version?: string | null;
  consented_at?: string | null;
  consent_snapshot?: Json;
  data_package_snapshot?: Json;
  data_package_created_at?: string | null;
  shared_at?: string | null;
  handoff_channel?: string | null;
  provider_reference?: string | null;
  withdrawn_at?: string | null;
  withdrawal_reason?: string | null;
  idempotency_key?: string | null;
  last_handoff_error?: string | null;
};

export type LawyerReferralUpdate = Partial<
  Omit<LawyerReferralRow, "id" | "case_id" | "business_id" | "created_at">
>;

export type LawyerReferralEventType = "created" | "data_package_created" | "handoff_attempted" | "handoff_failed" | "submitted" | "withdrawn" | "provider_status_recorded";

export interface LawyerReferralEventRow {
  id: string;
  referral_id: string;
  case_id: string;
  business_id: string;
  event_type: LawyerReferralEventType;
  actor_type: "owner" | "system";
  actor_id: string | null;
  metadata: Json;
  created_at: string;
}

export type LawyerReferralEventInsert = Omit<LawyerReferralEventRow, "id" | "created_at"> & { id?: string; created_at?: string };

// ─── Convenience aliases ──────────────────────────────────────────────────────

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];

export type TablesInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];

export type TablesUpdate<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];
