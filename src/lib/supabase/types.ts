// ─── CollectBoss Database Types ───────────────────────────────────────────────
// Generated to match the Supabase schema in schema.sql
// Each table has three views: Row (read), Insert (create), Update (patch)

export type CaseStatus =
  | "action_needed"
  | "payment_promise"
  | "partial_paid"
  | "paid"
  | "overdue"
  | "formal_demand_ready";

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

export type PaymentReviewStatus = "pending_review" | "approved" | "rejected" | "unmatched";

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
      lawyer_referrals: {
        Row: LawyerReferralRow;
        Insert: LawyerReferralInsert;
        Update: LawyerReferralUpdate;
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
      [_ in never]: never;
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

// ─── 2. cases ─────────────────────────────────────────────────────────────────

export interface CaseRow {
  id: string;
  business_id: string;
  debtor_name: string;
  debtor_phone: string | null;
  debtor_email: string | null;
  debtor_company: string | null;
  debtor_reg_no: string | null;
  debtor_location: string | null;
  amount_owed: number;
  amount_paid: number;
  balance: number;            // computed: amount_owed - amount_paid
  due_date: string;           // ISO date string
  invoice_no: string | null;
  status: CaseStatus;
  next_best_action: string | null;
  payment_lock_mode: PaymentLockMode;
  days_overdue: number;       // computed via trigger or view
  notes: string | null;
  bank: string | null;
  created_at: string;
  updated_at: string;
}

export type CaseInsert = Omit<
  CaseRow,
  "id" | "balance" | "days_overdue" | "created_at" | "updated_at"
> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type CaseUpdate = Partial<
  Omit<CaseRow, "id" | "business_id" | "balance" | "days_overdue" | "created_at" | "updated_at">
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
}

export type EvidenceFileInsert = Omit<EvidenceFileRow, "id" | "uploaded_at"> & {
  id?: string;
  uploaded_at?: string;
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
}

export type ReminderInsert = Omit<ReminderRow, "id" | "sent_at"> & {
  id?: string;
  sent_at?: string;
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
}

export type ReceivingAccountInsert = Omit<ReceivingAccountRow, "id" | "created_at"> & {
  id?: string;
  created_at?: string;
};

export type ReceivingAccountUpdate = Partial<
  Omit<ReceivingAccountRow, "id" | "business_id" | "created_at">
>;

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
  created_at: string;
}

export type PaymentInsert = Omit<
  PaymentRow,
  "id" | "reviewed_at" | "reviewed_by" | "created_at"
> & {
  id?: string;
  created_at?: string;
};

export type PaymentUpdate = Partial<
  Omit<PaymentRow, "id" | "case_id" | "created_at">
>;

// ─── 8. legal_documents ───────────────────────────────────────────────────────

export interface LegalDocumentRow {
  id: string;
  case_id: string;
  document_type: LegalDocType;
  title: string;
  content: string;            // draft text / JSON
  status: LegalDocStatus;
  sent_at: string | null;
  created_at: string;
}

export type LegalDocumentInsert = Omit<LegalDocumentRow, "id" | "sent_at" | "created_at"> & {
  id?: string;
  created_at?: string;
  sent_at?: string;
};

export type LegalDocumentUpdate = Partial<
  Omit<LegalDocumentRow, "id" | "case_id" | "created_at">
>;

// ─── 10. payment_plans ───────────────────────────────────────────────────────

export type PaymentPlanStatus = "active" | "completed" | "cancelled";

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
  created_at:         string;
}

export type PaymentPlanInsert = Omit<PaymentPlanRow, "id" | "created_at"> & {
  id?:         string;
  created_at?: string;
};

export type PaymentPlanUpdate = Partial<
  Omit<PaymentPlanRow, "id" | "case_id" | "created_at">
>;

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
  | "submitted"
  | "under_review"
  | "lawyer_contacted"
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
  created_at:              string;
  updated_at:              string;
}

export type LawyerReferralInsert = Omit<LawyerReferralRow, "id" | "created_at" | "updated_at"> & {
  id?:         string;
  created_at?: string;
  updated_at?: string;
};

export type LawyerReferralUpdate = Partial<
  Omit<LawyerReferralRow, "id" | "case_id" | "business_id" | "created_at">
>;

// ─── Convenience aliases ──────────────────────────────────────────────────────

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];

export type TablesInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];

export type TablesUpdate<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];
