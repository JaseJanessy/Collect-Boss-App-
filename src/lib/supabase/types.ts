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
  | "tng_ewallet"
  | "online_fpx"
  | "online_card"
  | "online_other";

export type PaymentReviewStatus = "pending_review" | "approved" | "rejected" | "unmatched" | "reversed";
export type PaymentProofStatus = "submitted" | "under_review" | "confirmed" | "rejected" | "more_information_required" | "pending_review" | "approved";

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

export type ActorType = "owner" | "staff" | "system" | "debtor";
export type TenantRole = "owner" | "admin" | "manager" | "staff" | "viewer";
export type MembershipStatus = "invited" | "active" | "suspended" | "revoked";
export type ReceivingAccountVerificationStatus = "unverified" | "pending" | "verified" | "rejected" | "disabled";
export type ReceivingAccountPaymentMethod = "bank_transfer" | "duitnow" | "ewallet" | "other";
export type BusinessEntityType = "legal_entity" | "branch" | "division" | "location" | "other";
export type OrganizationBusinessRelationshipType =
  | "primary" | "subsidiary" | "affiliate" | "franchise" | "managed";
export type CustomerAccountType =
  | "general" | "corporate" | "supplier" | "rental" | "vehicle"
  | "property" | "project" | "catering_event" | "future";
export type CustomerAccountMode = "one_off" | "ongoing";
export type CreditLimitWarning =
  | "no_limit" | "within_limit" | "approaching_limit" | "limit_reached" | "over_limit";
export type ObligationType =
  | "invoice" | "general_obligation" | "rent" | "vehicle" | "property"
  | "project" | "supplier" | "catering_event" | "other";
export type ObligationStatus =
  | "draft" | "open" | "overdue" | "partial" | "paid"
  | "disputed" | "void" | "written_off";
export type RecoveryCaseScope =
  | "standalone" | "single_obligation" | "multiple_obligations" | "account_balance";
export type DomainEventType =
  | "FOLLOW_UP_DUE"
  | "INVOICE_OVERDUE"
  | "PROMISE_DUE"
  | "PROMISE_MISSED"
  | "PLAN_INSTALLMENT_DUE"
  | "PLAN_INSTALLMENT_MISSED"
  | "DISPUTE_REVIEW_DUE"
  | "PAYMENT_PROOF_REVIEW_REQUIRED"
  | "DISPUTE_SUBMITTED"
  | "PAYMENT_RECEIVED"
  | "EMAIL_REPLY_RECEIVED";
export type DomainEventStatus = "pending" | "acknowledged" | "resolved" | "ignored";
export type NotificationSeverity = "critical" | "high" | "medium" | "informational" | "positive";
export type ActionCentreStatus = "open" | "in_progress" | "snoozed" | "completed" | "dismissed";
export type ActionCentrePriority = "critical" | "high" | "medium" | "low";
export type PaymentPromiseStatus =
  | "pending"
  | "partially_fulfilled"
  | "fulfilled"
  | "missed"
  | "cancelled";
export type PaymentPromiseSource =
  | "whatsapp"
  | "call"
  | "email"
  | "portal"
  | "in_person"
  | "manual";
export type CommunicationChannel = "whatsapp" | "call" | "email" | "portal" | "other";
export type CommunicationDirection = "outbound" | "inbound";
export type CommunicationStatus =
  | "initiated"
  | "sent"
  | "delivered"
  | "read"
  | "replied"
  | "failed"
  | "completed";
export type ContactGuardMode = "warn" | "require_override";
export type ContactGuardBulkMode = "exclude" | "require_override";
export type BusinessIndustry =
  | "general" | "professional_services" | "retail" | "construction" | "property"
  | "education" | "healthcare" | "financial_services" | "financing_money_lending" | "other";
export type BusinessVerificationState = "unverified" | "pending" | "verified" | "rejected" | "restricted";
export interface ContactFrequencyCounts {
  attempts_24h: number;
  attempts_7d: number;
  attempts_30d: number;
}
export interface ContactFrequencyPolicy {
  max_attempts_24h: number;
  max_attempts_7d: number;
  max_attempts_30d: number;
  frequency_mode: ContactGuardMode;
  preference_mode: ContactGuardMode;
  bulk_mode: ContactGuardBulkMode;
}
export interface ContactGuardEvaluation {
  case_id: string;
  channel: CommunicationChannel | null;
  counts: ContactFrequencyCounts;
  warnings: string[];
  has_frequency_warning: boolean;
  has_preference_warning: boolean;
  requires_override: boolean;
  bulk_allowed: boolean;
  recommended_action: string;
  preferences: ContactPreferenceRow | null;
  policy: ContactFrequencyPolicy;
}
export interface CommunicationCounters {
  calls: number;
  whatsapps: number;
  emails: number;
  last_contact_at: string | null;
  last_response_at: string | null;
}
export type DisputeCategory =
  | "amount_incorrect" | "already_paid" | "duplicate_invoice"
  | "goods_not_received" | "damaged_quality_issue" | "service_incomplete"
  | "incorrect_pricing" | "do_not_recognise_debt" | "other";
export type DisputeStatus =
  | "submitted" | "under_review" | "information_requested"
  | "partially_accepted" | "accepted" | "rejected" | "resolved" | "withdrawn";
export type AccountingProvider = "xero" | "quickbooks" | "bukku" | "autocount";
export type AccountingConnectionStatus = "pending" | "connected" | "error" | "disconnected" | "revoked";
export type AccountingEntityType = "contact" | "account" | "invoice" | "payment" | "credit_note";

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
      workspace_product_states: {
        Row: WorkspaceProductStateRow;
        Insert: WorkspaceProductStateInsert;
        Update: Partial<Omit<WorkspaceProductStateRow, "business_id" | "activated_at">>;
        Relationships: [];
      };
      workspace_product_state_events: {
        Row: WorkspaceProductStateEventRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      pocket_solo_upgrade_runs: {
        Row: PocketSoloUpgradeRunRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      pocket_solo_upgrade_items: {
        Row: PocketSoloUpgradeItemRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      commercial_offers: { Row: CommercialOfferRow; Insert: Partial<CommercialOfferRow> & Pick<CommercialOfferRow, "offer_key" | "product_type" | "offer_kind" | "amount_minor" | "currency" | "interval_kind" | "recurring">; Update: Partial<CommercialOfferRow>; Relationships: []; };
      workspace_commercial_states: { Row: WorkspaceCommercialStateRow; Insert: Partial<WorkspaceCommercialStateRow> & Pick<WorkspaceCommercialStateRow, "business_id" | "product_type" | "lifecycle_state">; Update: Partial<WorkspaceCommercialStateRow>; Relationships: []; };
      workspace_subscription_items: { Row: WorkspaceSubscriptionItemRow; Insert: Omit<WorkspaceSubscriptionItemRow, "id" | "created_at" | "updated_at"> & { id?: string; created_at?: string; updated_at?: string }; Update: Partial<WorkspaceSubscriptionItemRow>; Relationships: []; };
      workspace_cycle_purchases: { Row: WorkspaceCyclePurchaseRow; Insert: Omit<WorkspaceCyclePurchaseRow, "id" | "purchased_at"> & { id?: string; purchased_at?: string }; Update: never; Relationships: []; };
      workspace_usage_counters: { Row: WorkspaceUsageCounterRow; Insert: WorkspaceUsageCounterRow; Update: Partial<Pick<WorkspaceUsageCounterRow, "used_units" | "updated_at">>; Relationships: []; };
      workspace_usage_events: { Row: WorkspaceUsageEventRow; Insert: Omit<WorkspaceUsageEventRow, "id" | "created_at"> & { id?: string; created_at?: string }; Update: never; Relationships: []; };
      workspace_checkout_reservations: { Row: WorkspaceCheckoutReservationRow; Insert: Omit<WorkspaceCheckoutReservationRow, "id" | "created_at" | "updated_at"> & { id?: string; created_at?: string; updated_at?: string }; Update: Partial<WorkspaceCheckoutReservationRow>; Relationships: []; };
      pocket_active_debt_counters: { Row: PocketActiveDebtCounterRow; Insert: PocketActiveDebtCounterRow; Update: Partial<Pick<PocketActiveDebtCounterRow, "active_count" | "updated_at">>; Relationships: []; };
      pocket_reminder_preferences: { Row: PocketReminderPreferenceRow; Insert: Omit<PocketReminderPreferenceRow, "id" | "created_at" | "updated_at"> & { id?: string; created_at?: string; updated_at?: string }; Update: Partial<Omit<PocketReminderPreferenceRow, "id" | "business_id" | "obligation_id" | "customer_id" | "created_at">>; Relationships: []; };
      pocket_reminder_schedules: { Row: PocketReminderScheduleRow; Insert: Omit<PocketReminderScheduleRow, "id" | "created_at" | "updated_at"> & { id?: string; created_at?: string; updated_at?: string }; Update: Partial<Omit<PocketReminderScheduleRow, "id" | "business_id" | "obligation_id" | "customer_id" | "source_key" | "created_at">>; Relationships: []; };
      pocket_reminder_events: { Row: PocketReminderEventRow; Insert: Omit<PocketReminderEventRow, "id" | "created_at"> & { id?: string; created_at?: string }; Update: never; Relationships: []; };
      pocket_invoice_sequences: { Row: PocketInvoiceSequenceRow; Insert: PocketInvoiceSequenceRow; Update: Pick<PocketInvoiceSequenceRow, "last_value" | "updated_at">; Relationships: []; };
      pocket_simple_invoices: { Row: PocketSimpleInvoiceRow; Insert: never; Update: never; Relationships: []; };
      pocket_simple_invoice_items: { Row: PocketSimpleInvoiceItemRow; Insert: never; Update: never; Relationships: []; };
      pocket_simple_invoice_events: { Row: PocketSimpleInvoiceEventRow; Insert: never; Update: never; Relationships: []; };
      organizations: {
        Row: OrganizationRow;
        Insert: OrganizationInsert;
        Update: OrganizationUpdate;
        Relationships: [];
      };
      organization_business_relationships: {
        Row: OrganizationBusinessRelationshipRow;
        Insert: OrganizationBusinessRelationshipInsert;
        Update: Partial<Omit<OrganizationBusinessRelationshipRow, "organization_id" | "business_id" | "created_at">>;
        Relationships: [];
      };
      business_entities: {
        Row: BusinessEntityRow;
        Insert: BusinessEntityInsert;
        Update: BusinessEntityUpdate;
        Relationships: [];
      };
      business_memberships: {
        Row: BusinessMembershipRow;
        Insert: BusinessMembershipInsert;
        Update: Partial<Omit<BusinessMembershipRow, "id" | "business_id" | "created_at">>;
        Relationships: [];
      };
      business_role_settings: {
        Row: BusinessRoleSettingsRow;
        Insert: BusinessRoleSettingsInsert;
        Update: Partial<Omit<BusinessRoleSettingsRow, "business_id">>;
        Relationships: [];
      };
      document_intakes: {
        Row: DocumentIntakeRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      document_intake_idempotency_keys: {
        Row: DocumentIntakeIdempotencyRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      document_intake_events: {
        Row: DocumentIntakeEventRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      document_intake_extractions: {
        Row: DocumentIntakeExtractionRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      document_extraction_candidates: {
        Row: DocumentExtractionCandidateRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      document_intake_confirmations: {
        Row: DocumentIntakeConfirmationRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      document_intake_workflow_drafts: {
        Row: DocumentIntakeWorkflowDraftRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      document_intake_outcomes: {
        Row: DocumentIntakeOutcomeRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      document_intake_record_evidence_links: {
        Row: DocumentIntakeRecordEvidenceLinkRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      pocket_receipt_payment_links: {
        Row: PocketReceiptPaymentLinkRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      payment_matching_settings: {
        Row: PaymentMatchingSettingsRow;
        Insert: Partial<PaymentMatchingSettingsRow> & Pick<PaymentMatchingSettingsRow, "business_id">;
        Update: Partial<Omit<PaymentMatchingSettingsRow, "business_id">>;
        Relationships: [];
      };
      normalized_payment_transactions: {
        Row: NormalizedPaymentTransactionRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      payment_match_jobs: {
        Row: PaymentMatchJobRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      payment_match_candidates: {
        Row: PaymentMatchCandidateRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      payment_match_candidate_events: {
        Row: PaymentMatchCandidateEventRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      payment_match_allocations: {
        Row: PaymentMatchAllocationRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      payment_matching_idempotency_keys: {
        Row: PaymentMatchingIdempotencyRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      payment_operation_settings: { Row: PaymentOperationSettingsRow; Insert: PaymentOperationSettingsInsert; Update: Partial<PaymentOperationSettingsInsert>; Relationships: [] };
      payment_receipts: { Row: PaymentReceiptRow; Insert: PaymentReceiptInsert; Update: never; Relationships: [] };
      payment_exchange_rates: { Row: PaymentExchangeRateRow; Insert: PaymentExchangeRateInsert; Update: never; Relationships: [] };
      payment_allocation_approval_requests: { Row: PaymentAllocationApprovalRequestRow; Insert: PaymentAllocationApprovalRequestInsert; Update: Partial<PaymentAllocationApprovalRequestRow>; Relationships: [] };
      payment_ledger_journals: { Row: PaymentLedgerJournalRow; Insert: never; Update: never; Relationships: [] };
      payment_ledger_entries: { Row: PaymentLedgerEntryRow; Insert: never; Update: never; Relationships: [] };
      payment_allocations: { Row: PaymentOperationAllocationRow; Insert: never; Update: never; Relationships: [] };
      payment_refunds: { Row: PaymentRefundRow; Insert: never; Update: never; Relationships: [] };
      payment_receipt_reversals: { Row: PaymentReceiptReversalRow; Insert: never; Update: never; Relationships: [] };
      accounting_payment_operation_outbox: { Row: AccountingPaymentOperationOutboxRow; Insert: never; Update: Partial<AccountingPaymentOperationOutboxRow>; Relationships: [] };
      payment_operation_idempotency_keys: { Row: PaymentOperationIdempotencyRow; Insert: never; Update: never; Relationships: [] };
      pocket_debt_attachments: { Row: PocketDebtAttachmentRow; Insert: PocketDebtAttachmentInsert; Update: never; Relationships: [] };
      debtors: {
        Row: DebtorRow;
        Insert: DebtorInsert;
        Update: DebtorUpdate;
        Relationships: [];
      };
      customer_accounts: {
        Row: CustomerAccountRow;
        Insert: CustomerAccountInsert;
        Update: CustomerAccountUpdate;
        Relationships: [];
      };
      obligations: {
        Row: ObligationRow;
        Insert: ObligationInsert;
        Update: ObligationUpdate;
        Relationships: [];
      };
      business_payment_connections: { Row: BusinessPaymentConnectionRow; Insert: Partial<BusinessPaymentConnectionRow> & Pick<BusinessPaymentConnectionRow, "business_id" | "stripe_account_id">; Update: Partial<BusinessPaymentConnectionRow>; Relationships: []; };
      online_payment_sessions: { Row: OnlinePaymentSessionRow; Insert: Partial<OnlinePaymentSessionRow> & Pick<OnlinePaymentSessionRow, "business_id" | "case_id" | "stripe_account_id" | "checkout_session_id" | "amount_minor" | "currency">; Update: Partial<OnlinePaymentSessionRow>; Relationships: []; };
      einvoice_profiles: { Row: Record<string, unknown> & { business_id: string }; Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: []; };
      customer_tax_details: { Row: Record<string, unknown> & { business_id: string }; Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: []; };
      einvoice_documents: { Row: Record<string, unknown> & { business_id: string }; Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: []; };
      whatsapp_reminder_policies: { Row: WhatsAppReminderPolicyRow; Insert: Partial<WhatsAppReminderPolicyRow> & Pick<WhatsAppReminderPolicyRow, "business_id">; Update: Partial<WhatsAppReminderPolicyRow>; Relationships: []; };
      whatsapp_messages: { Row: WhatsAppMessageRow; Insert: Partial<WhatsAppMessageRow>; Update: Partial<WhatsAppMessageRow>; Relationships: []; };
      whatsapp_opt_outs: { Row: { phone_e164: string; source: string; created_at: string }; Insert: { phone_e164: string; source?: string; created_at?: string }; Update: { source?: string }; Relationships: []; };
      recurring_charges: {
        Row: RecurringChargeRow;
        Insert: Partial<RecurringChargeRow> & Pick<RecurringChargeRow, "business_id" | "customer_id" | "account_id" | "label" | "reference_prefix" | "amount_minor" | "currency" | "day_of_month" | "start_date" | "next_run_date">;
        Update: Partial<RecurringChargeRow>;
        Relationships: [];
      };
      recovery_case_obligations: {
        Row: RecoveryCaseObligationRow;
        Insert: RecoveryCaseObligationInsert;
        Update: never;
        Relationships: [];
      };
      receivables_migration_verifications: {
        Row: ReceivablesMigrationVerificationRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      domain_events: {
        Row: DomainEventRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      cases: {
        Row: CaseRow;
        Insert: CaseInsert;
        Update: CaseUpdate;
        Relationships: [];
      };
      debt_ledger_events: {
        Row: DebtLedgerEventRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      debt_balance_versions: {
        Row: DebtBalanceVersionRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      debt_ledger_reconciliation_exceptions: {
        Row: DebtLedgerReconciliationExceptionRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      discrepancy_findings: {
        Row: DiscrepancyFindingRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      discrepancy_finding_events: {
        Row: DiscrepancyFindingEventRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      import_batches: {
        Row: ImportBatchRow;
        Insert: Omit<ImportBatchRow, "id" | "created_at" | "committed_at"> & {
          id?: string;
          committed_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Pick<ImportBatchRow,
          "status" | "valid_rows" | "invalid_rows" | "duplicate_rows" | "committed_at" | "error_summary"
        >>;
        Relationships: [];
      };
      import_errors: {
        Row: ImportErrorRow;
        Insert: Omit<ImportErrorRow, "id" | "created_at"> & { id?: string; created_at?: string };
        Update: never;
        Relationships: [];
      };
      accounting_connections: {
        Row: AccountingConnectionRow;
        Insert: Omit<AccountingConnectionRow, "id" | "created_at" | "updated_at"> & { id?: string; created_at?: string; updated_at?: string };
        Update: Partial<Omit<AccountingConnectionRow, "id" | "business_id" | "provider" | "created_at">>;
        Relationships: [];
      };
      accounting_oauth_states: {
        Row: AccountingOauthStateRow;
        Insert: Omit<AccountingOauthStateRow, "id" | "created_at" | "consumed_at"> & { id?: string; created_at?: string; consumed_at?: string | null };
        Update: Pick<AccountingOauthStateRow, "consumed_at">;
        Relationships: [];
      };
      accounting_external_mappings: {
        Row: AccountingExternalMappingRow;
        Insert: Omit<AccountingExternalMappingRow, "id" | "created_at" | "updated_at" | "last_synced_at"> & { id?: string; created_at?: string; updated_at?: string; last_synced_at?: string };
        Update: Partial<Omit<AccountingExternalMappingRow, "id" | "business_id" | "connection_id" | "provider" | "entity_type" | "external_entity_id" | "created_at">>;
        Relationships: [];
      };
      accounting_sync_runs: {
        Row: AccountingSyncRunRow;
        Insert: Omit<AccountingSyncRunRow, "id" | "counts" | "preview" | "errors" | "started_at" | "finished_at"> & { id?: string; counts?: Json; preview?: Json; errors?: Json; started_at?: string; finished_at?: string | null };
        Update: Partial<Pick<AccountingSyncRunRow, "status" | "counts" | "preview" | "errors" | "finished_at">>;
        Relationships: [];
      };
      accounting_webhook_events: {
        Row: AccountingWebhookEventRow;
        Insert: Omit<AccountingWebhookEventRow, "id" | "status" | "attempts" | "last_error" | "received_at" | "processed_at" | "business_id" | "connection_id" | "next_attempt_at" | "last_attempt_at" | "dead_lettered_at"> & { id?: string; status?: AccountingWebhookEventRow["status"]; attempts?: number; last_error?: string | null; received_at?: string; processed_at?: string | null; business_id?: string | null; connection_id?: string | null; next_attempt_at?: string; last_attempt_at?: string | null; dead_lettered_at?: string | null };
        Update: Partial<Pick<AccountingWebhookEventRow, "status" | "attempts" | "last_error" | "processed_at" | "business_id" | "connection_id" | "next_attempt_at" | "last_attempt_at" | "dead_lettered_at">>;
        Relationships: [];
      };
      integration_jobs: {
        Row: IntegrationJobRow;
        Insert: Omit<IntegrationJobRow, "id" | "status" | "attempts" | "next_attempt_at" | "lease_expires_at" | "last_error_code" | "last_error_message" | "last_replayed_by" | "last_replayed_at" | "completed_at" | "created_at" | "updated_at"> & { id?: string; status?: IntegrationJobRow["status"]; attempts?: number; next_attempt_at?: string; lease_expires_at?: string | null; last_error_code?: string | null; last_error_message?: string | null; last_replayed_by?: string | null; last_replayed_at?: string | null; completed_at?: string | null; created_at?: string; updated_at?: string };
        Update: Partial<Omit<IntegrationJobRow, "id" | "business_id" | "provider" | "job_type" | "resource_id" | "deduplication_key" | "created_at">>;
        Relationships: [];
      };
      integration_health: {
        Row: IntegrationHealthRow;
        Insert: Omit<IntegrationHealthRow, "id" | "last_checked_at" | "last_success_at" | "last_failure_at" | "consecutive_failures" | "error_code" | "actionable_message" | "updated_at"> & { id?: string; last_checked_at?: string | null; last_success_at?: string | null; last_failure_at?: string | null; consecutive_failures?: number; error_code?: string | null; actionable_message?: string | null; updated_at?: string };
        Update: Partial<Omit<IntegrationHealthRow, "id" | "business_id" | "provider">>;
        Relationships: [];
      };
      email_suppressions: {
        Row: EmailSuppressionRow;
        Insert: Omit<EmailSuppressionRow, "id" | "active" | "created_at" | "lifted_at" | "lifted_by"> & { id?: string; active?: boolean; created_at?: string; lifted_at?: string | null; lifted_by?: string | null };
        Update: Partial<Pick<EmailSuppressionRow, "active" | "lifted_at" | "lifted_by">>;
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
      payment_access_otp_challenges: {
        Row: PaymentAccessOtpChallengeRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      payment_access_sessions: {
        Row: PaymentAccessSessionRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      payment_access_suspicious_reports: {
        Row: PaymentAccessSuspiciousReportRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      payment_access_report_events: {
        Row: PaymentAccessReportEventRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      business_risk_policies: {
        Row: BusinessRiskPolicyRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      business_risk_policy_events: {
        Row: BusinessRiskPolicyEventRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      business_verification_reviews: {
        Row: BusinessVerificationReviewRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      business_verification_events: {
        Row: BusinessVerificationEventRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      platform_abuse_review_queue: {
        Row: PlatformAbuseReviewQueueRow;
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
      public_payment_submissions: {
        Row: PaymentProofSubmissionRow;
        Insert: PaymentProofSubmissionInsert;
        Update: Partial<PaymentProofSubmissionRow>;
        Relationships: [];
      };
      payment_proof_events: {
        Row: PaymentProofEventRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      notifications: {
        Row: NotificationRow;
        Insert: never;
        Update: Partial<Pick<NotificationRow, "read_at" | "archived_at">>;
        Relationships: [];
      };
      mobile_push_devices: {
        Row: MobilePushDeviceRow;
        Insert: Omit<MobilePushDeviceRow, "id" | "disabled_at" | "created_at" | "updated_at"> & { id?: string; disabled_at?: string | null; created_at?: string; updated_at?: string };
        Update: Partial<Pick<MobilePushDeviceRow, "expo_push_token" | "platform" | "enabled" | "last_seen_at" | "disabled_at" | "updated_at">>;
        Relationships: [];
      };
      mobile_push_deliveries: {
        Row: MobilePushDeliveryRow;
        Insert: Omit<MobilePushDeliveryRow, "id" | "status" | "ticket_id" | "attempts" | "last_error" | "sent_at" | "receipt_checked_at" | "created_at" | "updated_at"> & { id?: string; status?: MobilePushDeliveryRow["status"]; attempts?: number };
        Update: Partial<Omit<MobilePushDeliveryRow, "id" | "notification_id" | "device_id" | "created_at">>;
        Relationships: [];
      };
      action_centre_items: {
        Row: ActionCentreItemRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      action_centre_item_events: {
        Row: ActionCentreItemEventRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      payment_promises: {
        Row: PaymentPromiseRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      communication_activities: {
        Row: CommunicationActivityRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      email_sender_identities: {
        Row: EmailSenderIdentityRow;
        Insert: Omit<EmailSenderIdentityRow, "id" | "created_at" | "updated_at"> & { id?: string; created_at?: string; updated_at?: string };
        Update: Partial<Omit<EmailSenderIdentityRow, "id" | "business_id" | "created_at">>;
        Relationships: [];
      };
      email_templates: {
        Row: EmailTemplateRow;
        Insert: Omit<EmailTemplateRow, "id" | "created_at" | "updated_at"> & { id?: string; created_at?: string; updated_at?: string };
        Update: Partial<Omit<EmailTemplateRow, "id" | "business_id" | "created_at">>;
        Relationships: [];
      };
      scheduled_email_followups: {
        Row: ScheduledEmailFollowupRow;
        Insert: Omit<ScheduledEmailFollowupRow, "id" | "created_at" | "processed_at" | "attempts" | "last_error" | "communication_activity_id"> & { id?: string; created_at?: string; processed_at?: string | null; attempts?: number; last_error?: string | null; communication_activity_id?: string | null };
        Update: Partial<Omit<ScheduledEmailFollowupRow, "id" | "business_id" | "case_id" | "created_at">>;
        Relationships: [];
      };
      email_webhook_events: {
        Row: EmailWebhookEventRow;
        Insert: Omit<EmailWebhookEventRow, "id" | "processed_at" | "status" | "attempts" | "last_error_code" | "last_error_message" | "event_created_at"> & { id?: string; processed_at?: string; status?: EmailWebhookEventRow["status"]; attempts?: number; last_error_code?: string | null; last_error_message?: string | null; event_created_at?: string | null };
        Update: Partial<Pick<EmailWebhookEventRow, "communication_activity_id" | "processed_at" | "status" | "attempts" | "last_error_code" | "last_error_message">>;
        Relationships: [];
      };
      email_inbound_reviews: {
        Row: EmailInboundReviewRow;
        Insert: Omit<EmailInboundReviewRow, "id" | "created_at" | "reviewed_at" | "reviewed_by"> & { id?: string; created_at?: string; reviewed_at?: string | null; reviewed_by?: string | null };
        Update: Partial<Pick<EmailInboundReviewRow, "status" | "communication_activity_id" | "reviewed_at" | "reviewed_by">>;
        Relationships: [];
      };
      contact_preferences: {
        Row: ContactPreferenceRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      contact_frequency_policies: {
        Row: ContactFrequencyPolicyRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      contact_guard_overrides: {
        Row: ContactGuardOverrideRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      compliance_policy_versions: {
        Row: CompliancePolicyVersionRow;
        Insert: Omit<CompliancePolicyVersionRow, "id" | "created_at"> & { id?: string; created_at?: string };
        Update: never;
        Relationships: [];
      };
      compliance_policy_checks: {
        Row: CompliancePolicyCheckRow;
        Insert: Omit<CompliancePolicyCheckRow, "id" | "approved_by" | "approved_at" | "approval_note" | "bypassed" | "bypass_reason" | "final_action" | "executed_at" | "invalidated_at" | "created_at" | "updated_at"> & { id?: string; approved_by?: string | null; approved_at?: string | null; approval_note?: string | null; bypassed?: boolean; bypass_reason?: string | null; final_action?: string | null; executed_at?: string | null; invalidated_at?: string | null; created_at?: string; updated_at?: string };
        Update: Partial<Pick<CompliancePolicyCheckRow, "approval_state" | "approved_by" | "approved_at" | "approval_note" | "bypassed" | "bypass_reason" | "final_action" | "executed_at" | "invalidated_at" | "updated_at">>;
        Relationships: [];
      };
      compliance_case_holds: {
        Row: ComplianceCaseHoldRow;
        Insert: Omit<ComplianceCaseHoldRow, "id" | "action_item_id" | "resolved_by" | "resolution_note" | "created_at" | "resolved_at"> & { id?: string; action_item_id?: string | null; resolved_by?: string | null; resolution_note?: string | null; created_at?: string; resolved_at?: string | null };
        Update: Partial<Pick<ComplianceCaseHoldRow, "action_item_id" | "status" | "resolved_by" | "resolution_note" | "resolved_at">>;
        Relationships: [];
      };
      payment_promise_allocations: {
        Row: PaymentPromiseAllocationRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      payment_promise_events: {
        Row: PaymentPromiseEventRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      disputes: {
        Row: DisputeRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      dispute_evidence: {
        Row: DisputeEvidenceRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      dispute_events: {
        Row: DisputeEventRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      case_financial_events: {
        Row: CaseFinancialEventRow;
        Insert: CaseFinancialEventInsert;
        Update: never;
        Relationships: [];
      };
      financial_adjustments: {
        Row: FinancialAdjustmentRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      financial_adjustment_events: {
        Row: FinancialAdjustmentEventRow;
        Insert: never;
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
      payment_plan_events: {
        Row: PaymentPlanEventRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      payment_negotiations: {
        Row: PaymentNegotiationRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      payment_negotiation_revisions: {
        Row: PaymentNegotiationRevisionRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      payment_negotiation_events: {
        Row: PaymentNegotiationEventRow;
        Insert: never;
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
      legal_handoff_document_requests: {
        Row: LegalHandoffDocumentRequestRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      legal_handoff_document_request_evidence: {
        Row: LegalHandoffDocumentRequestEvidenceRow;
        Insert: never;
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
      customer_receivable_totals: {
        Row: ReceivableTotalsRow;
        Relationships: [];
      };
      account_receivable_totals: {
        Row: AccountReceivableTotalsRow;
        Relationships: [];
      };
      legacy_case_receivables_compatibility: {
        Row: LegacyCaseReceivablesCompatibilityRow;
        Relationships: [];
      };
      case_recovery_amounts: {
        Row: CaseRecoveryAmountsRow;
        Relationships: [];
      };
      payment_receipt_positions: {
        Row: PaymentReceiptPositionRow;
        Relationships: [];
      };
    };
    Functions: {
      my_workspace_context: {
        Args: Record<never, never>;
        Returns: Array<{
          business_id: string;
          workspace_name: string;
          product_type: "main" | "pocket";
          lifecycle_state: "active" | "grace_read_only" | "suspended";
          plan_slug: string;
          subscription_status: string | null;
        }>;
      };
      transition_case_status: {
        Args: { p_case_id: string; p_to_status: CaseStatus; p_reason?: string | null; p_promise_due_date?: string | null; p_expected_version?: number | null };
        Returns: CaseRow;
      };
      archive_closed_case: {
        Args: { p_case_id: string; p_reason: string | null; p_expected_version?: number | null };
        Returns: CaseRow;
      };
      accept_my_business_invitation: {
        Args: Record<never, never>;
        Returns: BusinessMembershipRow[];
      };
      has_business_permission: {
        Args: { p_business_id: string; p_permission: string };
        Returns: boolean;
      };
      financial_create_owner_payment: { Args: { p_case_id: string; p_amount_minor: string; p_payment_method: PaymentMethod; p_reference_no?: string | null; p_proof_url?: string | null; p_notes?: string | null; p_approve?: boolean }; Returns: PaymentRow; };
      financial_review_payment: { Args: { p_payment_id: string; p_decision: "approved" | "rejected" | "unmatched" }; Returns: PaymentRow; };
      financial_review_public_payment_submission: { Args: { p_submission_id: string; p_decision: "under_review" | "confirmed" | "rejected" | "more_information_required"; p_reason?: string | null }; Returns: PaymentProofSubmissionRow; };
      financial_reverse_payment: { Args: { p_payment_id: string; p_idempotency_key: string; p_reason?: string | null }; Returns: CaseRow; };
      financial_reconcile_case: { Args: { p_case_id: string }; Returns: Json; };
      payment_matching_import_transactions: {
        Args: { p_business_id: string; p_actor_id: string; p_transactions: Json; p_idempotency_key: string; p_request_hash: string };
        Returns: Json;
      };
      payment_operation_record_receipt: { Args: { p_business_id: string; p_actor_id: string; p_receipt_kind: "payment" | "credit"; p_amount_minor: number; p_currency: string; p_received_at: string; p_source_type: string; p_source_system: string; p_source_record_id: string; p_normalized_transaction_id: string | null; p_reference: string | null; p_payer_name: string | null; p_metadata: Json; p_idempotency_key: string; p_request_hash: string }; Returns: Json };
      payment_operation_allocate: { Args: { p_business_id: string; p_receipt_id: string; p_actor_id: string; p_allocations: Json; p_reason: string | null; p_approval_request_id: string | null; p_idempotency_key: string; p_request_hash: string }; Returns: Json };
      payment_operation_reverse_allocation: { Args: { p_business_id: string; p_allocation_id: string; p_actor_id: string; p_reason: string; p_idempotency_key: string; p_request_hash: string }; Returns: Json };
      payment_operation_refund: { Args: { p_business_id: string; p_receipt_id: string; p_actor_id: string; p_amount_minor: number; p_reason: string; p_external_reference: string | null; p_idempotency_key: string; p_request_hash: string }; Returns: Json };
      payment_operation_reverse_receipt: { Args: { p_business_id: string; p_receipt_id: string; p_actor_id: string; p_reason: string; p_idempotency_key: string; p_request_hash: string }; Returns: Json };
      payment_operation_decide_approval: { Args: { p_business_id: string; p_request_id: string; p_actor_id: string; p_decision: "approved" | "rejected"; p_reason: string }; Returns: PaymentAllocationApprovalRequestRow };
      integration_claim_jobs: { Args: { p_limit?: number }; Returns: IntegrationJobRow[] };
      integration_finish_job: { Args: { p_job_id: string; p_succeeded: boolean; p_error_code?: string | null; p_error_message?: string | null }; Returns: IntegrationJobRow };
      integration_replay_job: { Args: { p_job_id: string; p_business_id: string; p_actor_id: string }; Returns: IntegrationJobRow };
      billing_claim_event: { Args: { p_stripe_event_id: string; p_event_type: string; p_event_created_at?: string | null }; Returns: "new" | "retry" | "done" | "busy" };
      billing_apply_subscription_state: { Args: { p_business_id: string; p_customer_id: string; p_subscription_id: string; p_price_id: string | null; p_plan_slug: string; p_status: string; p_period_start: string | null; p_period_end: string | null; p_cancel_at_period_end: boolean; p_extra_seats?: number }; Returns: undefined };
      pocket_get_entitlements: { Args: { p_business_id: string }; Returns: Json };
      pocket_authorize_capability: { Args: { p_business_id: string; p_actor_id: string; p_capability_key: string; p_operation_key?: string | null; p_consume?: boolean }; Returns: Json };
      pocket_apply_subscription_state: { Args: { p_business_id: string; p_customer_id: string; p_provider_event_id: string; p_provider_event_created_at: string; p_items: Json }; Returns: undefined };
      pocket_refresh_lifecycle_states: { Args: { p_now?: string }; Returns: number };
      pocket_reserve_checkout: { Args: { p_business_id: string; p_actor_id: string; p_offer_key: string; p_idempotency_key: string }; Returns: Json };
      pocket_attach_checkout_session: { Args: { p_reservation_id: string; p_checkout_session_id: string }; Returns: undefined };
      pocket_record_cycle_pack: { Args: { p_business_id: string; p_actor_id: string; p_checkout_session_id: string; p_payment_intent_id: string | null; p_provider_event_id: string; p_provider_event_created_at: string }; Returns: undefined };
      pocket_commit_invoice_usage: { Args: { p_business_id: string; p_actor_id: string; p_invoice_id: string; p_invoice_number: string; p_operation_key: string }; Returns: Json };
      pocket_save_simple_invoice_draft: { Args: { p_business_id: string; p_actor_id: string; p_invoice_id: string | null; p_expected_version: number | null; p_payload: Json; p_items: Json; p_operation_key: string }; Returns: Json };
      pocket_issue_simple_invoice: { Args: { p_business_id: string; p_actor_id: string; p_invoice_id: string; p_expected_version: number; p_operation_key: string }; Returns: Json };
      pocket_convert_invoice_to_debt: { Args: { p_business_id: string; p_actor_id: string; p_invoice_id: string; p_operation_key: string }; Returns: Json };
      pocket_post_payment: { Args: { p_business_id: string; p_actor_id: string; p_debt_id: string; p_amount_minor: number; p_expected_outstanding_minor: number; p_payment_date: string; p_method: string; p_reference: string | null; p_note: string | null; p_idempotency_key: string; p_request_hash: string }; Returns: Json };
      pocket_reverse_payment: { Args: { p_business_id: string; p_actor_id: string; p_allocation_id: string; p_reason: string; p_idempotency_key: string; p_request_hash: string }; Returns: Json };
      pocket_confirm_receipt_payment: { Args: { p_business_id: string; p_actor_id: string; p_intake_id: string; p_debt_id: string; p_expected_outstanding_minor: number; p_method: string; p_note: string | null; p_duplicate_acknowledged: boolean; p_idempotency_key: string; p_request_hash: string }; Returns: Json };
      pocket_prepare_solo_upgrade: { Args: { p_business_id: string; p_actor_id: string; p_idempotency_key: string; p_request_hash: string }; Returns: Json };
      pocket_attach_solo_upgrade_checkout: { Args: { p_business_id: string; p_actor_id: string; p_run_id: string; p_checkout_session_id: string }; Returns: undefined };
      pocket_commit_solo_upgrade: { Args: { p_business_id: string; p_run_id: string; p_actor_id: string; p_provider_event_id: string }; Returns: Json };
      pocket_mark_solo_upgrade_cleanup: { Args: { p_business_id: string; p_run_id: string; p_status: "completed" | "failed"; p_error_code?: string | null }; Returns: undefined };
      payment_operation_reconciliation: { Args: { p_business_id: string; p_from: string; p_to: string }; Returns: Json };
      payment_matching_store_job: {
        Args: {
          p_business_id: string; p_transaction_id: string; p_actor_id: string; p_algorithm_version: string;
          p_thresholds: Json; p_queue_result: "high_confidence_review" | "ambiguous" | "unmatched";
          p_candidates: Json; p_idempotency_key: string; p_request_hash: string;
        };
        Returns: PaymentMatchJobRow;
      };
      payment_matching_review_candidate: {
        Args: {
          p_business_id: string; p_transaction_id: string; p_actor_id: string;
          p_decision: "approve" | "approve_split" | "reject" | "defer"; p_candidate_id: string;
          p_allocations: Json; p_split_authorization: boolean; p_note: string | null;
          p_idempotency_key: string; p_request_hash: string;
        };
        Returns: Json;
      };
      receivables_set_case_scope: { Args: { p_case_id: string; p_scope: RecoveryCaseScope; p_account_id?: string | null; p_obligation_ids?: string[] }; Returns: Json; };
      receivables_reconcile_case: { Args: { p_case_id: string }; Returns: Json; };
      receivables_create_recovery_case: {
        Args: {
          p_customer_id: string;
          p_target: "invoice" | "account";
          p_account_id: string;
          p_obligation_id?: string | null;
          p_payment_lock_mode?: PaymentLockMode;
        };
        Returns: Json;
      };
      domain_events_detect: { Args: { p_now?: string | null }; Returns: Json; };
      payment_promises_run_scheduler: { Args: { p_now?: string | null }; Returns: Json; };
      payment_promise_create: {
        Args: {
          p_case_id: string; p_amount_minor: string; p_promise_date: string;
          p_source: PaymentPromiseSource; p_source_activity_type?: string | null;
          p_source_activity_id?: string | null; p_note?: string | null;
          p_idempotency_key?: string;
        };
        Returns: PaymentPromiseRow;
      };
      communication_activity_create: {
        Args: {
          p_case_id: string;
          p_channel: CommunicationChannel;
          p_direction: CommunicationDirection;
          p_status?: CommunicationStatus;
          p_started_at?: string | null;
          p_external_reference?: string | null;
          p_duration_seconds?: number | null;
          p_metadata?: Json;
          p_related_promise_id?: string | null;
          p_related_dispute_id?: string | null;
          p_related_action_id?: string | null;
          p_idempotency_key?: string;
        };
        Returns: CommunicationActivityRow;
      };
      compliance_communication_activity_create: {
        Args: {
          p_case_id: string;
          p_channel: CommunicationChannel;
          p_direction: CommunicationDirection;
          p_status?: CommunicationStatus;
          p_started_at?: string | null;
          p_external_reference?: string | null;
          p_duration_seconds?: number | null;
          p_metadata?: Json;
          p_related_promise_id?: string | null;
          p_related_dispute_id?: string | null;
          p_related_action_id?: string | null;
          p_idempotency_key?: string;
          p_policy_check_id?: string | null;
          p_policy_content_hash?: string | null;
        };
        Returns: CommunicationActivityRow;
      };
      communication_activity_update: {
        Args: {
          p_activity_id: string;
          p_status: CommunicationStatus;
          p_outcome?: string | null;
          p_completed_at?: string | null;
          p_external_reference?: string | null;
          p_duration_seconds?: number | null;
          p_metadata?: Json;
          p_related_promise_id?: string | null;
          p_related_dispute_id?: string | null;
          p_related_action_id?: string | null;
        };
        Returns: CommunicationActivityRow;
      };
      communication_activity_counters: {
        Args: { p_case_id: string };
        Returns: Json;
      };
      contact_guard_context: {
        Args: { p_case_ids: string[] };
        Returns: Json;
      };
      contact_preferences_upsert: {
        Args: {
          p_customer_id: string;
          p_preferred_channel?: CommunicationChannel | null;
          p_preferred_time_start?: string | null;
          p_preferred_time_end?: string | null;
          p_email_only?: boolean;
          p_do_not_call?: boolean;
          p_wrong_number?: boolean;
          p_invalid_contact?: boolean;
          p_note?: string | null;
        };
        Returns: ContactPreferenceRow;
      };
      contact_frequency_policy_upsert: {
        Args: {
          p_max_attempts_24h: number;
          p_max_attempts_7d: number;
          p_max_attempts_30d: number;
          p_frequency_mode: ContactGuardMode;
          p_preference_mode: ContactGuardMode;
          p_bulk_mode: ContactGuardBulkMode;
        };
        Returns: ContactFrequencyPolicyRow;
      };
      contact_guard_record_override: {
        Args: {
          p_case_id: string;
          p_communication_activity_id?: string | null;
          p_action_item_id?: string | null;
          p_channel: CommunicationChannel;
          p_is_bulk: boolean;
          p_reason: string;
          p_evaluation: Json;
        };
        Returns: ContactGuardOverrideRow;
      };
      operational_case_search: {
        Args: {
          p_business_id: string;
          p_query?: string | null;
          p_statuses?: string[] | null;
          p_priorities?: string[] | null;
          p_owner_id?: string | null;
          p_aging_min?: number | null;
          p_aging_max?: number | null;
          p_promise_missed?: boolean;
          p_has_plan?: boolean;
          p_has_dispute?: boolean;
          p_due_today?: boolean;
          p_high_value_minor?: number | null;
          p_closed?: boolean;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: Json;
      };
      global_operational_search: {
        Args: { p_business_id: string; p_query: string; p_limit?: number };
        Returns: Json;
      };
      bulk_update_cases: {
        Args: { p_business_id: string; p_case_ids: string[]; p_action: string; p_value: string };
        Returns: Json;
      };
      commit_operational_import: {
        Args: { p_business_id: string; p_batch_id: string; p_rows: Json };
        Returns: Json;
      };
      merge_duplicate_debtors: {
        Args: {
          p_business_id: string;
          p_source_id: string;
          p_target_id: string;
          p_reason: string;
        };
        Returns: Json;
      };
      payment_promise_apply_payment: {
        Args: { p_promise_id: string; p_payment_id: string; p_override?: boolean; p_override_reason?: string | null };
        Returns: PaymentPromiseRow;
      };
      payment_promise_cancel: {
        Args: { p_promise_id: string; p_reason: string };
        Returns: PaymentPromiseRow;
      };
      dispute_create_owner: {
        Args: {
          p_case_id: string; p_obligation_id?: string | null; p_category: DisputeCategory;
          p_disputed_amount_minor: string; p_reason: string; p_description: string;
          p_idempotency_key: string;
        };
        Returns: DisputeRow;
      };
      dispute_submit_public: {
        Args: {
          p_dispute_id: string; p_public_access_token_id: string; p_obligation_id?: string | null;
          p_category: DisputeCategory; p_disputed_amount_minor: string; p_reason: string;
          p_description: string; p_idempotency_key: string; p_file_name?: string | null;
          p_object_path?: string | null; p_content_type?: string | null;
          p_size_bytes?: string | null; p_content_sha256?: string | null;
        };
        Returns: DisputeRow;
      };
      dispute_transition: {
        Args: {
          p_dispute_id: string; p_to_status: Exclude<DisputeStatus, "submitted">;
          p_response?: string | null; p_resolution_amount_minor?: string | null;
        };
        Returns: DisputeRow;
      };
      notifications_consume_domain_events: { Args: { p_limit?: number }; Returns: Json; };
      action_centre_consume_domain_events: { Args: { p_limit?: number }; Returns: Json; };
      action_centre_refresh_priority_gaps: { Args: { p_limit?: number }; Returns: Json; };
      action_centre_dashboard: {
        Args: {
          p_scope?: string; p_owner?: string | null; p_queue?: string | null;
          p_case_scope?: string | null; p_priority?: string | null; p_due?: string | null;
          p_offset?: number; p_limit?: number;
        };
        Returns: Json;
      };
      action_centre_transition: {
        Args: { p_action_id: string; p_transition: ActionCentreStatus; p_snoozed_until?: string | null };
        Returns: ActionCentreItemRow;
      };
      payment_plan_create_proposal: {
        Args: { p_case_id: string; p_frequency: PaymentPlanFrequency; p_first_due_date: string; p_installment_count: number; p_custom_due_dates?: Json; p_notes?: string | null };
        Returns: PaymentPlanRow;
      };
      payment_plan_record_response: {
        Args: { p_token_id: string; p_decision: PaymentPlanResponse; p_signer_name: string; p_signer_phone: string; p_rejection_reason?: string | null; p_ip_hash?: string | null; p_actor_context?: Json };
        Returns: PaymentPlanRow;
      };
      payment_plan_detect_missed: { Args: { p_as_of_date?: string | null }; Returns: number; };
      online_payment_record: { Args: { p_checkout_session_id: string; p_stripe_account_id: string; p_payment_intent_id: string; p_amount_minor: number; p_currency: string; p_payment_method: string }; Returns: string; };
      whatsapp_enqueue_due_reminders: { Args: { p_now?: string | null; p_limit?: number }; Returns: Json; };
      whatsapp_claim_messages: { Args: { p_limit?: number }; Returns: WhatsAppMessageRow[]; };
      recurring_charges_generate: { Args: { p_today?: string | null; p_limit?: number }; Returns: Json; };
      payment_plan_run_scheduler: { Args: { p_as_of_date?: string | null; p_due_soon_days?: number }; Returns: Json; };
      payment_negotiation_submit: {
        Args: {
          p_token_id: string; p_option_type: PaymentNegotiationOption;
          p_amount_now_minor: string; p_installment_amount_minor: string;
          p_frequency: Exclude<PaymentPlanFrequency, "custom">; p_start_date: string;
          p_reason?: string | null; p_note?: string | null; p_idempotency_key?: string;
        };
        Returns: PaymentNegotiationRow;
      };
      payment_negotiation_transition: {
        Args: {
          p_negotiation_id: string; p_action: "countered" | "accepted" | "declined" | "withdrawn";
          p_amount_now_minor?: string | null; p_installment_amount_minor?: string | null;
          p_frequency?: Exclude<PaymentPlanFrequency, "custom"> | null; p_start_date?: string | null;
          p_reason?: string | null; p_note?: string | null;
        };
        Returns: PaymentNegotiationRow;
      };
      payment_negotiations_expire: { Args: { p_now?: string | null }; Returns: number; };
      financial_create_adjustment: {
        Args: {
          p_case_id: string; p_obligation_id?: string | null;
          p_adjustment_type: FinancialAdjustmentType; p_direction: FinancialAdjustmentDirection;
          p_amount_minor: string; p_new_amount_minor?: string | null; p_reason: string;
          p_reference?: string | null; p_idempotency_key?: string;
        };
        Returns: FinancialAdjustmentRow;
      };
      accounting_apply_sync_record: {
        Args: { p_connection_id: string; p_record: Json };
        Returns: Json;
      };
      accounting_apply_sync_batch: {
        Args: { p_connection_id: string; p_records: Json };
        Returns: Json;
      };
      financial_review_write_off: {
        Args: { p_adjustment_id: string; p_decision: "approved" | "rejected"; p_reason?: string | null };
        Returns: FinancialAdjustmentRow;
      };
      financial_settle_case: {
        Args: {
          p_case_id: string; p_payment_minor: string; p_payment_method: PaymentMethod;
          p_reference_no?: string | null; p_reason: string; p_idempotency_key?: string;
        };
        Returns: Json;
      };
      financial_close_case: {
        Args: { p_case_id: string; p_reason_code: CaseClosureReason; p_note?: string | null; p_expected_version?: number | null };
        Returns: CaseRow;
      };
      legal_handoff_record_professional_update: { Args: { p_referral_id: string; p_idempotency_key: string; p_status: ProfessionalHandoffStatus; p_professional_name: string; p_professional_firm: string; p_message?: string | null; p_requested_documents?: Json; p_provider_reference?: string | null }; Returns: Json; };
      legal_handoff_fulfil_document_request: { Args: { p_request_id: string; p_evidence_ids: Json; p_response_note?: string | null }; Returns: LegalHandoffDocumentRequestRow; };
      public_rotate_access_token: { Args: { p_token_id: string; p_replacement_token_hash: string; p_actor_id: string; p_expires_at: string }; Returns: Json; };
      payment_access_issue_otp: {
        Args: {
          p_token_id: string; p_business_id: string; p_case_id: string;
          p_channel: "email" | "sms"; p_destination_hash: string;
          p_code_hash: string; p_ip_hash: string;
        };
        Returns: Json;
      };
      payment_access_mark_otp_delivery: {
        Args: { p_challenge_id: string; p_sent: boolean; p_provider_reference?: string | null };
        Returns: Json;
      };
      payment_access_verify_otp: {
        Args: { p_token_id: string; p_code_hash: string; p_session_hash: string; p_ip_hash: string };
        Returns: Json;
      };
      payment_access_validate_session: {
        Args: { p_token_id: string; p_session_hash: string };
        Returns: Json;
      };
      payment_access_report_suspicious: {
        Args: {
          p_token_id: string; p_business_id: string; p_case_id: string;
          p_category: string; p_details: string; p_ip_hash: string;
        };
        Returns: Json;
      };
      business_payment_link_access: {
        Args: { p_business_id: string };
        Returns: Json;
      };
      business_verification_submit: {
        Args: {
          p_registration_document_reference?: string | null;
          p_licence_document_reference?: string | null;
          p_owner_note?: string | null;
        };
        Returns: Json;
      };
      business_verification_decide: {
        Args: {
          p_review_id: string; p_decision: "verified" | "rejected" | "restricted";
          p_reviewer_reference: string; p_public_reason: string;
          p_internal_note?: string | null; p_restricted_until?: string | null;
        };
        Returns: Json;
      };
      payment_access_report_tenant_review: {
        Args: { p_report_id: string; p_action: "acknowledged" | "resolved"; p_note?: string | null };
        Returns: Json;
      };
      payment_access_report_platform_review: {
        Args: {
          p_report_id: string; p_decision: "confirmed" | "dismissed" | "restricted";
          p_reviewer_reference: string; p_note: string; p_restricted_until?: string | null;
        };
        Returns: Json;
      };
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
  industry: BusinessIndustry;
  verification_state: BusinessVerificationState;
  verification_submitted_at: string | null;
  verified_at: string | null;
  verification_public_note: string | null;
  payment_links_restricted_until: string | null;
  payment_link_restriction_reason: string | null;
  account_type: AccountType | null;
  legal_name: string | null;
  contact_name: string | null;
  logo_object_path: string | null;
  phone: string | null;
  phone_e164: string | null;
  email: string | null;
  address: string | null;
  pocket_note?: string | null;
  preferred_reminder_language?: string | null;
  normalized_phone?: string | null;
  normalized_email?: string | null;
  address_details: Json;
  country_code: string;
  locale: string;
  default_currency: string;
  date_format: string;
  number_format: string;
  language_code: string;
  registration_identifiers: Json;
  region_defaults_source: string;
  region_defaults_determined_at: string;
  credit_limit_enforcement_enabled: boolean;
  timezone: string;
  created_at: string;
}

export interface WorkspaceProductStateRow {
  business_id: string;
  product_type: "main" | "pocket";
  lifecycle_state: "active" | "grace_read_only" | "suspended";
  activated_at: string;
  updated_at: string;
  updated_by: string | null;
}

export type WorkspaceProductStateInsert = Omit<WorkspaceProductStateRow, "activated_at" | "updated_at"> & {
  activated_at?: string;
  updated_at?: string;
};

export interface WorkspaceProductStateEventRow {
  id: string;
  business_id: string;
  from_product_type: "main" | "pocket" | null;
  to_product_type: "main" | "pocket";
  from_lifecycle_state: "active" | "grace_read_only" | "suspended" | null;
  to_lifecycle_state: "active" | "grace_read_only" | "suspended";
  actor_id: string | null;
  created_at: string;
}

export type PocketSoloUpgradeRunStatus =
  | "prepared" | "review_required" | "checkout_pending"
  | "processing" | "completed" | "failed";
export interface PocketSoloUpgradeRunRow {
  id: string;
  business_id: string;
  initiated_by: string;
  status: PocketSoloUpgradeRunStatus;
  target_plan_slug: "starter";
  idempotency_key: string;
  request_hash: string;
  checkout_session_id: string | null;
  provider_event_id: string | null;
  source_counts: Json;
  reconciliation: Json;
  pocket_subscription_ids: Json;
  pocket_subscription_cleanup_status: "not_started" | "pending" | "completed" | "failed";
  last_error_code: string | null;
  started_at: string;
  checkout_attached_at: string | null;
  completed_at: string | null;
  updated_at: string;
}
export interface PocketSoloUpgradeItemRow {
  id: string;
  run_id: string;
  business_id: string;
  obligation_id: string;
  disposition: "migrate_active" | "migrate_settled" | "preserve_cancelled"
    | "review_disputed" | "review_ambiguous" | "review_malformed";
  status: "ready" | "preserve_only" | "review_required" | "migrated";
  review_reason: string | null;
  target_case_id: string | null;
  source_snapshot: Json;
  reconciliation: Json;
  created_at: string;
  migrated_at: string | null;
}

export type PocketCommercialLifecycleState = "trialing" | "active" | "past_due" | "payment_retry" | "cancelled_at_period_end" | "cancelled" | "grace_read_only" | "suspended";
export interface CommercialOfferRow { offer_key: string; product_type: "main" | "pocket"; offer_kind: "base" | "addon" | "cycle_pack"; amount_minor: number; currency: string; interval_kind: "month" | "year" | "cycle"; recurring: boolean; active: boolean; metadata: Json; created_at: string; updated_at: string; }
export interface WorkspaceCommercialStateRow { business_id: string; product_type: "pocket"; base_offer_key: string | null; lifecycle_state: PocketCommercialLifecycleState; cycle_start: string | null; cycle_end: string | null; grace_until: string | null; read_only_at: string | null; stripe_customer_id: string | null; last_provider_event_id: string | null; last_provider_event_created_at: string | null; created_at: string; updated_at: string; }
export interface WorkspaceSubscriptionItemRow { id: string; business_id: string; offer_key: string; provider_subscription_id: string; provider_item_id: string; provider_price_id: string; provider_status: string; period_start: string | null; period_end: string | null; cancel_at_period_end: boolean; last_provider_event_id: string; last_provider_event_created_at: string; created_at: string; updated_at: string; }
export interface WorkspaceCyclePurchaseRow { id: string; business_id: string; offer_key: string; cycle_start: string; cycle_end: string; checkout_session_id: string; payment_intent_id: string | null; provider_event_id: string; provider_event_created_at: string; purchased_by: string | null; purchased_at: string; }
export interface WorkspaceUsageCounterRow { business_id: string; capability_key: string; cycle_start: string; cycle_end: string; used_units: number; updated_at: string; }
export interface WorkspaceUsageEventRow { id: string; business_id: string; capability_key: string; cycle_start: string; operation_key: string; units: number; actor_id: string | null; metadata: Json; created_at: string; }
export interface WorkspaceCheckoutReservationRow { id: string; business_id: string; actor_id: string; offer_key: string; idempotency_key: string; cycle_start: string | null; cycle_end: string | null; checkout_session_id: string | null; status: "pending" | "completed" | "expired"; expires_at: string; created_at: string; updated_at: string; }
export interface PocketActiveDebtCounterRow { business_id: string; active_count: number; updated_at: string; }
export interface PocketReminderPreferenceRow {
  id: string; business_id: string; obligation_id: string; customer_id: string;
  enabled: boolean; due_soon_enabled: boolean; due_today_enabled: boolean;
  overdue_enabled: boolean; still_overdue_enabled: boolean; partial_balance_enabled: boolean;
  push_enabled: boolean; snoozed_until: string | null; updated_by: string | null;
  created_at: string; updated_at: string;
}
export interface PocketReminderScheduleRow {
  id: string; business_id: string; obligation_id: string | null; invoice_id: string | null; customer_id: string;
  event_type: "due_soon" | "due_today" | "overdue" | "still_overdue" | "partial_balance" | "invoice_due";
  notification_group: "today" | "overdue" | "payments" | "system";
  scheduled_local_date: string; event_timezone: string; source_key: string; source_fingerprint: string;
  remaining_minor: number; currency: string; status: "pending" | "snoozed" | "notified" | "cancelled";
  snoozed_until: string | null; notification_id: string | null; cancellation_reason: string | null;
  notified_at: string | null; created_at: string; updated_at: string;
}
export interface PocketReminderEventRow {
  id: string; business_id: string; obligation_id: string; customer_id: string; schedule_id: string | null;
  event_type: "prepared" | "opened_to_whatsapp";
  template_key: "gentle" | "due_today" | "overdue" | "partial_balance"; language: "en" | "ms" | "zh";
  message_sha256: string; remaining_minor: number; currency: string; due_date: string | null;
  user_edited: boolean; created_by: string; idempotency_key: string; metadata: Json; created_at: string;
}
export interface PocketInvoiceSequenceRow { business_id: string; sequence_year: number; last_value: number; updated_at: string; }
export interface PocketSimpleInvoiceRow {
  id: string; business_id: string; customer_id: string; status: "draft" | "issued" | "partially_paid" | "paid" | "cancelled";
  invoice_number: string | null; sequence_year: number | null; sequence_value: number | null; issue_date: string | null; due_date: string | null;
  currency: string; business_name: string; business_contact: string | null; logo_object_path: string | null; customer_name: string; customer_contact: string | null;
  subtotal_minor: number; discount_minor: number; tax_label: string | null; tax_minor: number; total_minor: number; note: string | null; payment_instructions: string | null;
  obligation_id: string | null; issued_snapshot: Json | null; pdf_object_path: string | null; pdf_sha256: string | null; pdf_generated_at: string | null;
  version: number; issued_at: string | null; cancelled_at: string | null; created_by: string; updated_by: string; created_at: string; updated_at: string;
}
export interface PocketSimpleInvoiceItemRow { id: string; business_id: string; invoice_id: string; position: number; description: string; quantity_milli: number; unit_price_minor: number; line_total_minor: number; created_at: string; }
export interface PocketSimpleInvoiceEventRow { id: string; business_id: string; invoice_id: string; event_type: "draft_created" | "draft_updated" | "issued" | "pdf_generated" | "whatsapp_handoff" | "debt_linked" | "cancelled"; actor_id: string | null; idempotency_key: string | null; metadata: Json; created_at: string; }

export type BusinessInsert = Omit<BusinessRow,
  "id" | "created_at" | "timezone" | "country_code" | "locale" | "default_currency"
  | "date_format" | "number_format" | "language_code" | "address_details" | "phone_e164"
  | "registration_identifiers" | "region_defaults_source" | "region_defaults_determined_at"
  | "verification_state" | "verification_submitted_at"
  | "verified_at" | "verification_public_note" | "payment_links_restricted_until"
  | "payment_link_restriction_reason" | "credit_limit_enforcement_enabled"
> & {
  id?: string;
  timezone?: string;
  country_code?: string;
  locale?: string;
  default_currency?: string;
  date_format?: string;
  number_format?: string;
  language_code?: string;
  address_details?: Json;
  phone_e164?: string | null;
  registration_identifiers?: Json;
  region_defaults_source?: string;
  region_defaults_determined_at?: string;
  credit_limit_enforcement_enabled?: boolean;
  created_at?: string;
};

export type BusinessUpdate = Partial<Omit<BusinessRow,
  "id" | "owner_id" | "created_at" | "verification_state" | "verification_submitted_at"
  | "verified_at" | "verification_public_note" | "payment_links_restricted_until"
  | "payment_link_restriction_reason"
>>;

export interface OrganizationRow {
  id: string;
  name: string;
  registration_no: string | null;
  metadata: Json;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type OrganizationInsert = Omit<OrganizationRow, "id" | "created_at" | "updated_at"> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};
export type OrganizationUpdate = Partial<
  Omit<OrganizationRow, "id" | "created_by" | "created_at" | "updated_at">
>;

export interface OrganizationBusinessRelationshipRow {
  organization_id: string;
  business_id: string;
  relationship_type: OrganizationBusinessRelationshipType;
  created_by: string | null;
  created_at: string;
}
export type OrganizationBusinessRelationshipInsert =
  Omit<OrganizationBusinessRelationshipRow, "created_at"> & { created_at?: string };

export interface BusinessEntityRow {
  id: string;
  business_id: string;
  organization_id: string | null;
  parent_entity_id: string | null;
  entity_type: BusinessEntityType;
  name: string;
  code: string | null;
  legal_name: string | null;
  registration_no: string | null;
  address: string | null;
  is_active: boolean;
  metadata: Json;
  created_at: string;
  updated_at: string;
}
export type BusinessEntityInsert = Omit<
  BusinessEntityRow,
  "id" | "created_at" | "updated_at" | "is_active"
> & {
  id?: string;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
};
export type BusinessEntityUpdate = Partial<
  Omit<BusinessEntityRow, "id" | "business_id" | "created_at" | "updated_at">
>;

export interface AccountingConnectionRow {
  id: string;
  business_id: string;
  provider: AccountingProvider;
  status: AccountingConnectionStatus;
  external_tenant_id: string | null;
  organization_name: string | null;
  scopes: string[];
  access_token_ciphertext: string | null;
  refresh_token_ciphertext: string | null;
  token_expires_at: string | null;
  last_successful_sync_at: string | null;
  last_attempted_sync_at: string | null;
  last_cursor: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  disconnected_at: string | null;
  metadata: Json;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccountingOauthStateRow {
  id: string;
  business_id: string;
  provider: AccountingProvider;
  state_hash: string;
  created_by: string;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
}

export interface AccountingExternalMappingRow {
  id: string;
  business_id: string;
  connection_id: string;
  provider: AccountingProvider;
  entity_type: AccountingEntityType;
  external_entity_id: string;
  external_parent_id: string | null;
  collectboss_entity_type: "debtor" | "customer_account" | "obligation" | "payment" | "financial_adjustment" | "unmatched_financial_event";
  collectboss_entity_id: string | null;
  source_version: string | null;
  source_updated_at: string | null;
  payload_hash: string | null;
  last_synced_at: string;
  metadata: Json;
  created_at: string;
  updated_at: string;
}

export interface AccountingSyncRunRow {
  id: string;
  business_id: string;
  connection_id: string;
  provider: AccountingProvider;
  mode: "full" | "incremental" | "preview";
  status: "running" | "preview_ready" | "succeeded" | "failed";
  counts: Json;
  preview: Json;
  errors: Json;
  started_at: string;
  finished_at: string | null;
}

export interface AccountingWebhookEventRow {
  id: string;
  provider: AccountingProvider;
  external_tenant_id: string;
  event_key: string;
  payload: Json;
  status: "pending" | "processing" | "retry_scheduled" | "processed" | "dead_letter";
  attempts: number;
  last_error: string | null;
  received_at: string;
  processed_at: string | null;
  business_id: string | null;
  connection_id: string | null;
  next_attempt_at: string;
  last_attempt_at: string | null;
  dead_lettered_at: string | null;
}

export interface IntegrationJobRow {
  id: string;
  business_id: string | null;
  provider: "stripe" | "resend" | AccountingProvider;
  job_type: "stripe_event_replay" | "email_delivery" | "accounting_sync" | "accounting_webhook";
  resource_id: string;
  deduplication_key: string;
  payload: Json;
  status: "pending" | "processing" | "retry_scheduled" | "succeeded" | "dead_letter" | "cancelled";
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  lease_expires_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  created_by: string | null;
  last_replayed_by: string | null;
  last_replayed_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface IntegrationHealthRow {
  id: string;
  business_id: string;
  provider: "stripe" | "resend" | AccountingProvider;
  status: "unknown" | "healthy" | "degraded" | "action_required" | "outage" | "disconnected";
  last_checked_at: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  consecutive_failures: number;
  error_code: string | null;
  actionable_message: string | null;
  metadata: Json;
  updated_at: string;
}

export interface EmailSuppressionRow {
  id: string;
  business_id: string;
  recipient_hash: string;
  masked_recipient: string;
  reason: "bounce" | "complaint" | "provider_suppression" | "manual" | "invalid";
  source_event_id: string | null;
  active: boolean;
  created_at: string;
  lifted_at: string | null;
  lifted_by: string | null;
}

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
  merged_into_id?: string | null;
  merged_at?: string | null;
  merged_by?: string | null;
  merge_reason?: string | null;
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

export interface CustomerAccountRow {
  id: string;
  business_id: string;
  business_entity_id: string | null;
  customer_id: string;
  account_type: CustomerAccountType;
  account_number: string | null;
  display_name: string;
  currency: string;
  account_mode: CustomerAccountMode;
  credit_limit_minor: number | null;
  credit_warning_threshold_percent: number;
  metadata: Json;
  custom_fields: Json;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export type CustomerAccountInsert = Omit<
  CustomerAccountRow,
  "id" | "created_at" | "updated_at" | "archived_at"
  | "business_entity_id" | "account_mode" | "credit_limit_minor" | "credit_warning_threshold_percent"
> & {
  id?: string;
  business_entity_id?: string | null;
  account_mode?: CustomerAccountMode;
  credit_limit_minor?: number | null;
  credit_warning_threshold_percent?: number;
  archived_at?: string | null;
  created_at?: string;
  updated_at?: string;
};
export type CustomerAccountUpdate = Partial<
  Omit<CustomerAccountRow, "id" | "business_id" | "customer_id" | "created_at" | "updated_at">
>;

export interface BusinessPaymentConnectionRow {
  business_id: string; provider: "stripe"; stripe_account_id: string; charges_enabled: boolean; payouts_enabled: boolean;
  details_submitted: boolean; disconnected_at: string | null; created_by: string | null; created_at: string; updated_at: string;
}

export interface OnlinePaymentSessionRow {
  id: string; business_id: string; case_id: string; stripe_account_id: string; checkout_session_id: string; payment_intent_id: string | null;
  amount_minor: number; currency: string; status: "open" | "paid" | "expired" | "failed"; payment_id: string | null; created_at: string; updated_at: string;
}

export interface WhatsAppReminderPolicyRow {
  business_id: string; enabled: boolean; day_offsets: number[]; language: "en" | "ms";
  consent_attested_at: string | null; consent_attested_by: string | null; updated_by: string | null; created_at: string; updated_at: string;
}

export interface WhatsAppMessageRow {
  id: string; business_id: string; customer_id: string | null; obligation_id: string | null; to_phone_e164: string;
  template_kind: "before_due" | "due_today" | "overdue"; language: "en" | "ms"; variables: Json; day_offset: number; local_send_date: string;
  status: "queued" | "sending" | "sent" | "delivered" | "read" | "failed" | "skipped"; skip_reason: string | null;
  provider_message_id: string | null; error_code: string | null; error_message: string | null; attempts: number;
  lease_expires_at: string | null; sent_at: string | null; created_at: string; updated_at: string;
}

export interface RecurringChargeRow {
  id: string; business_id: string; customer_id: string; account_id: string; label: string; reference_prefix: string;
  obligation_type: string; amount_minor: number; currency: string; day_of_month: number; due_days: number;
  start_date: string; end_date: string | null; next_run_date: string; last_generated_period: string | null;
  status: "active" | "paused" | "ended"; last_error: string | null; created_by: string | null; created_at: string; updated_at: string;
}

export interface ObligationRow {
  id: string;
  business_id: string;
  business_entity_id: string | null;
  customer_id: string;
  account_id: string | null;
  obligation_type: ObligationType;
  reference: string;
  purchase_order_reference: string | null;
  issue_date: string | null;
  due_date: string;
  currency: string;
  original_amount_minor: number;
  adjustments_minor: number;
  payment_operation_base_adjustments_minor: number;
  paid_minor: number;
  contractual_due_minor: number;
  outstanding_minor: number;
  status: ObligationStatus;
  dispute_review_at: string | null;
  metadata: Json;
  custom_fields: Json;
  origin_product_type?: "main" | "pocket" | null;
  pocket_description?: string | null;
  pocket_debt_date?: string | null;
  pocket_due_date?: string | null;
  pocket_reminder_preference?: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export type ObligationInsert = Omit<
  ObligationRow,
  "id" | "business_entity_id" | "contractual_due_minor" | "outstanding_minor" | "created_at" | "updated_at" | "archived_at" | "dispute_review_at" | "payment_operation_base_adjustments_minor"
> & {
  id?: string;
  business_entity_id?: string | null;
  payment_operation_base_adjustments_minor?: number;
  archived_at?: string | null;
  dispute_review_at?: string | null;
  created_at?: string;
  updated_at?: string;
};
export type ObligationUpdate = Partial<
  Omit<ObligationRow, "id" | "business_id" | "customer_id" | "contractual_due_minor" | "outstanding_minor" | "created_at" | "updated_at">
>;

export interface RecoveryCaseObligationRow {
  case_id: string;
  obligation_id: string;
  business_id: string;
  linked_at: string;
  linked_by: string | null;
}
export type RecoveryCaseObligationInsert = Omit<RecoveryCaseObligationRow, "linked_at" | "linked_by"> & {
  linked_at?: string;
  linked_by?: string | null;
};

export interface ReceivableTotalsRow {
  business_id: string;
  customer_id: string;
  currency: string;
  contractual_due_minor: number;
  paid_minor: number;
  outstanding_minor: number;
}
export interface AccountReceivableTotalsRow extends ReceivableTotalsRow {
  account_id: string;
  account_mode: CustomerAccountMode;
  credit_limit_minor: number | null;
  credit_warning_threshold_percent: number;
  current_exposure_minor: number;
  available_credit_minor: number | null;
  utilization_percentage: number | null;
  credit_warning: CreditLimitWarning;
  open_invoice_count: number;
  latest_invoice_date: string | null;
}

export interface ReceivablesMigrationVerificationRow {
  migration_key: string;
  business_id: string;
  pre_snapshot: Json;
  post_snapshot: Json | null;
  verification: Json | null;
  verified: boolean;
  started_at: string;
  completed_at: string | null;
}

export interface LegacyCaseReceivablesCompatibilityRow {
  case_id: string;
  business_id: string;
  customer_id: string | null;
  account_id: string | null;
  case_scope: RecoveryCaseScope;
  compatible_general_account_id: string | null;
  original_principal_minor: number;
  contractual_due_minor: number;
  approved_payment_minor: number;
  outstanding_minor: number;
  overpayment_minor: number;
  payment_count: number;
  payment_plan_count: number;
  reminder_count: number;
  evidence_count: number;
  statement_and_document_source_count: number;
  lawyer_handoff_count: number;
  payment_proof_count: number;
  incomplete_legacy_customer: boolean;
  legacy_standalone: boolean;
}

export interface DomainEventRow {
  id: string;
  business_id: string;
  case_id: string | null;
  customer_id: string | null;
  account_id: string | null;
  obligation_id: string | null;
  event_type: DomainEventType;
  source_entity_type: string;
  source_entity_id: string;
  source_version: string;
  effective_date: string;
  event_timezone: string;
  occurred_at: string;
  event_status: DomainEventStatus;
  resolved_at: string | null;
  payload: Json;
  deduplication_key: string;
  created_at: string;
}

// ─── 2. cases ─────────────────────────────────────────────────────────────────

export interface CaseRow {
  id: string;
  business_id: string;
  business_entity_id: string | null;
  debtor_id: string | null;
  account_id: string | null;
  case_scope: RecoveryCaseScope;
  debtor_type: DebtorType;
  debtor_name: string;
  debtor_phone: string | null;
  debtor_email: string | null;
  debtor_company: string | null;
  debtor_reg_no: string | null;
  debtor_location: string | null;
  amount_owed: number;
  amount_paid: number;
  currency: string;
  balance: number;            // computed: amount_owed - amount_paid
  original_principal_minor: number;
  contractual_due_minor: number;
  approved_payment_minor: number;
  outstanding_minor: number;
  overpayment_minor: number;
  financial_version: number;
  debt_truth_version?: number;
  confirmed_outstanding_minor?: number;
  disputed_balance_minor?: number;
  unverified_balance_minor?: number;
  total_displayed_exposure_minor?: number;
  open_discrepancy_count?: number;
  discrepancy_impacted_minor?: number;
  due_date: string;           // ISO date string
  invoice_no: string | null;
  status: CaseStatus;
  promise_due_date: string | null;
  closed_at: string | null;
  closed_by: string | null;
  close_reason: string | null;
  closure_reason_code?: CaseClosureReason | null;
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
  priority?: "low" | "medium" | "high" | "urgent";
  assigned_to?: string | null;
  next_follow_up_at?: string | null;
  metadata?: Json;
  created_at: string;
  updated_at: string;
}

export type CaseInsert = Omit<
  CaseRow,
  "id" | "business_entity_id" | "balance" | "days_overdue" | "created_at" | "updated_at" | "promise_due_date" | "closed_at" | "closed_by" | "close_reason" | "closure_reason_code" | "archived_at" | "archived_by" | "archive_reason" | "status_version" | "original_principal_minor" | "contractual_due_minor" | "approved_payment_minor" | "outstanding_minor" | "overpayment_minor" | "financial_version" | "receiving_account_id" | "account_id" | "case_scope"
> & {
  id?: string;
  business_entity_id?: string | null;
  created_at?: string;
  updated_at?: string;
  promise_due_date?: string | null;
  closed_at?: string | null;
  closed_by?: string | null;
  close_reason?: string | null;
  closure_reason_code?: CaseClosureReason | null;
  archived_at?: string | null;
  archived_by?: string | null;
  archive_reason?: string | null;
  status_version?: number;
  account_id?: string | null;
  case_scope?: RecoveryCaseScope;
};

export type CaseUpdate = Partial<
  Omit<CaseRow, "id" | "business_id" | "amount_owed" | "amount_paid" | "balance" | "original_principal_minor" | "contractual_due_minor" | "approved_payment_minor" | "outstanding_minor" | "overpayment_minor" | "financial_version" | "days_overdue" | "created_at" | "updated_at">
>;

export interface ImportBatchRow {
  id: string;
  business_id: string;
  file_name: string;
  file_type: "csv" | "xlsx";
  status: "dry_run" | "ready" | "committing" | "committed" | "failed";
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  duplicate_rows: number;
  mapping: Json;
  created_by: string;
  committed_at: string | null;
  error_summary: string | null;
  created_at: string;
}

export interface ImportErrorRow {
  id: string;
  batch_id: string;
  business_id: string;
  row_number: number;
  error_code: string;
  message: string;
  raw_row: Json;
  created_at: string;
}

// ─── 3. evidence_files ────────────────────────────────────────────────────────

export type DocumentIntakeStatus =
  | "draft" | "awaiting_upload" | "uploaded" | "processing" | "needs_review"
  | "ready_to_submit" | "submitted" | "failed" | "cancelled";

export interface DocumentIntakeRow {
  id: string;
  business_id: string;
  created_by: string;
  assigned_to: string | null;
  status: DocumentIntakeStatus;
  source: "web_upload" | "mobile_upload" | "api" | "email_import";
  intended_workflow: "transaction_evidence" | "payment_evidence" | "general_document";
  currency_hint: string | null;
  version: number;
  submitted_at: string | null;
  cancelled_at: string | null;
  deleted_at: string | null;
  retention_until: string | null;
  last_error_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentIntakeIdempotencyRow {
  id: string;
  business_id: string;
  action_scope: "create" | "upload" | "replace" | "remove" | "confirm" | "finalise" | "cancel" | "extract";
  idempotency_key: string;
  request_hash: string;
  actor_id: string;
  resource_type: string | null;
  resource_id: string | null;
  response_status: number | null;
  created_at: string;
  expires_at: string;
}

export interface DocumentIntakeEventRow {
  id: string;
  intake_id: string;
  business_id: string;
  from_status: DocumentIntakeStatus | null;
  to_status: DocumentIntakeStatus;
  intake_version: number;
  actor_id: string | null;
  actor_role: TenantRole | null;
  action: string;
  error_code: string | null;
  metadata: Json;
  correlation_id: string | null;
  idempotency_key: string | null;
  created_at: string;
}

export interface DocumentIntakeExtractionRow {
  id: string;
  intake_id: string;
  evidence_id: string;
  extraction_version: number;
  document_version: number;
  business_id: string;
  provider: string;
  provider_model: string | null;
  provider_version: string | null;
  parser_version: string;
  extraction_method: "pdf_text_layer" | "ocr" | null;
  status: "queued" | "processing" | "completed" | "needs_review" | "failed" | "cancelled";
  raw_text_object_path: string | null;
  protected_raw_text: string | null;
  protected_raw_result: Json | null;
  document_classification: string | null;
  structured_result: Json;
  confidence: number | null;
  warnings: Json;
  started_at: string | null;
  completed_at: string | null;
  error_code: string | null;
  attempt_count: number;
  next_attempt_at: string | null;
  locked_at: string | null;
  locked_by: string | null;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

export interface DocumentExtractionCandidateRow {
  id: string;
  extraction_id: string;
  intake_id: string;
  evidence_id: string;
  business_id: string;
  extraction_version: number;
  document_version: number;
  candidate_ordinal: number;
  field_type: string;
  original_text: string;
  normalized_value: Json;
  confidence: number;
  extraction_method: "pdf_text_layer" | "ocr";
  provider: string;
  provider_version: string;
  parser_version: string;
  source_page: number | null;
  source_image_id: string | null;
  source_bounding_box: Json | null;
  source_text_span: Json | null;
  source_snippet: string;
  validation_flags: string[];
  sensitivity: "standard" | "sensitive_identifier";
  duplicate_group: string | null;
  created_at: string;
}

export interface DocumentIntakeConfirmationRow {
  id: string;
  intake_id: string;
  business_id: string;
  confirmation_version: number;
  intake_version: number;
  review_status: "draft" | "confirmed";
  extraction_id: string | null;
  confirmed_document_kind: string | null;
  document_kind_confidence: number | null;
  represents_financial_movement: boolean | null;
  chosen_amount_minor: number | null;
  chosen_amount_candidate_id: string | null;
  chosen_amount_original: string | null;
  manual_amount_reason: string | null;
  currency: string | null;
  currency_confirmed: boolean;
  document_datetime: string | null;
  confirmed_timezone: string | null;
  date_interpretation_confirmed: boolean;
  reference: string | null;
  reference_original: string | null;
  bank: string | null;
  sender: string | null;
  recipient: string | null;
  transaction_status: "successful" | "pending" | "failed" | "unknown" | null;
  transaction_nature: string | null;
  transaction_nature_note: string | null;
  field_decisions: Json;
  evidence_citations: Json;
  validation_issues: Json;
  notes: string | null;
  confirmed_by: string;
  confirmed_at: string;
  idempotency_key: string;
  request_hash: string;
}

export interface DocumentIntakeWorkflowDraftRow {
  intake_id: string; business_id: string; version: number;
  step: "ai_result" | "transaction_nature" | "profile_match" | "required_details" | "duplicate_review" | "review_create" | "success";
  draft_data: Json; updated_by: string; created_at: string; updated_at: string;
}

export interface DocumentIntakeOutcomeRow {
  id: string; intake_id: string; business_id: string;
  route: "loan_disbursement" | "repayment" | "partial_repayment" | "refund" | "deposit_or_other" | "collection_case";
  customer_id: string | null; account_id: string | null; obligation_id: string | null;
  payment_id: string | null; original_payment_id: string | null; case_id: string | null;
  result: Json; created_by: string; created_at: string;
}

export interface DocumentIntakeRecordEvidenceLinkRow {
  id: string; business_id: string; intake_id: string; evidence_id: string;
  entity_type: "customer" | "account" | "obligation" | "payment" | "case";
  entity_id: string; created_at: string;
}

export interface PocketReceiptPaymentLinkRow {
  id: string; business_id: string; intake_id: string; evidence_id: string; confirmation_id: string;
  allocation_id: string; receipt_id: string; debt_id: string; customer_id: string;
  created_by: string; created_at: string;
}

export interface PaymentMatchingSettingsRow {
  business_id: string;
  high_confidence_threshold: number;
  ambiguous_threshold: number;
  date_window_days: number;
  maximum_candidates: number;
  updated_by: string | null;
  updated_at: string;
}

export interface NormalizedPaymentTransactionRow {
  id: string; business_id: string;
  source_type: "bank_statement" | "accounting" | "manual" | "payment_proof";
  source_system: string; source_record_id: string; source_batch_key: string | null;
  import_batch_id: string | null; document_intake_id: string | null;
  payment_submission_id: string | null; existing_payment_id: string | null;
  amount_minor: number; currency: string; occurred_at: string | null;
  reference: string | null; invoice_number: string | null; party_name: string | null;
  account_reference: string | null; phone: string | null; phone_match_permitted: boolean;
  duplicate_of_transaction_id: string | null; duplicate_signals: Json; fingerprint_hash: string;
  queue_status: "ready" | "high_confidence_review" | "ambiguous" | "unmatched" | "allocated";
  metadata: Json; created_by: string | null; created_at: string; updated_at: string;
}

export interface PaymentMatchJobRow {
  id: string; business_id: string; transaction_id: string; algorithm_version: string;
  thresholds: Json; queue_result: "high_confidence_review" | "ambiguous" | "unmatched";
  candidate_count: number; idempotency_key: string; request_hash: string;
  created_by: string; created_at: string;
}

export interface PaymentMatchCandidateRow {
  id: string; business_id: string; job_id: string; transaction_id: string;
  rank: number; score: number; confidence_band: "high" | "ambiguous" | "low";
  customer_id: string; account_id: string | null; obligation_id: string | null;
  case_id: string; existing_payment_id: string | null; matched_signals: Json;
  conflicting_signals: Json; reason: string; ranking_reason: string;
  review_status: "pending" | "approved" | "rejected" | "deferred" | "superseded";
  reviewed_by: string | null; reviewed_at: string | null; review_note: string | null; created_at: string;
}

export interface PaymentMatchCandidateEventRow {
  id: string; candidate_id: string; business_id: string; transaction_id: string;
  event_type: "proposed" | "approved" | "rejected" | "deferred" | "superseded";
  from_status: string | null; to_status: string; actor_id: string | null; actor_role: string | null;
  note: string | null; metadata: Json; created_at: string;
}

export interface PaymentMatchAllocationRow {
  id: string; business_id: string; transaction_id: string; candidate_id: string;
  case_id: string; obligation_id: string | null; payment_id: string; amount_minor: number;
  currency: string; split_group_id: string | null; approved_by: string; approved_at: string; idempotency_key: string;
  payment_operation_allocation_id: string | null;
}

export interface PaymentMatchingIdempotencyRow {
  id: string; business_id: string; action_scope: "import" | "review";
  idempotency_key: string; request_hash: string; response: Json;
  created_by: string | null; created_at: string;
}

export interface EvidenceFileRow {
  id: string;
  case_id: string | null;
  business_id: string;
  intake_id: string | null;
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
  page_count: number | null;
  evidence_version: number;
  is_current: boolean;
  scan_status: "pending" | "clean" | "suspected" | "quarantined" | "failed";
  scan_attempt_count?: number;
  scan_started_at?: string | null;
  scan_completed_at?: string | null;
  scan_next_attempt_at?: string | null;
  scan_locked_at?: string | null;
  scan_locked_by?: string | null;
  scan_provider_version?: string | null;
  scan_error_code?: string | null;
  scan_sha256?: string | null;
  processing_status: "queued" | "processing" | "needs_review" | "completed" | "failed" | "cancelled";
  duplicate_match_status: "unchecked" | "none" | "exact_hash_warning" | "reviewed";
  soft_deleted_at: string | null;
}

export type EvidenceFileInsert = Omit<EvidenceFileRow, "id" | "uploaded_at" | "object_path" | "description" | "document_date" | "is_internal" | "archived_at" | "archived_by" | "retention_until" | "content_sha256" | "scan_attempt_count" | "scan_started_at" | "scan_completed_at" | "scan_next_attempt_at" | "scan_locked_at" | "scan_locked_by" | "scan_provider_version" | "scan_error_code" | "scan_sha256"> & {
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
  scan_attempt_count?: number;
  scan_started_at?: string | null;
  scan_completed_at?: string | null;
  scan_next_attempt_at?: string | null;
  scan_locked_at?: string | null;
  scan_locked_by?: string | null;
  scan_provider_version?: string | null;
  scan_error_code?: string | null;
  scan_sha256?: string | null;
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
  dispute_snapshot_minor: number | null;
  collectable_snapshot_minor: number | null;
}

export type ReminderInsert = Omit<ReminderRow, "id" | "sent_at" | "template_version" | "recipient" | "generated_at" | "composer_opened_at" | "manually_confirmed_at" | "next_action_at" | "request_key" | "dispute_snapshot_minor" | "collectable_snapshot_minor"> & {
  id?: string;
  sent_at?: string;
  template_version?: number;
  recipient?: string | null;
  generated_at?: string;
  composer_opened_at?: string | null;
  manually_confirmed_at?: string | null;
  next_action_at?: string | null;
  request_key?: string;
  dispute_snapshot_minor?: number | null;
  collectable_snapshot_minor?: number | null;
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
  business_entity_id: string | null;
  bank_name: string;
  account_holder_name: string;
  account_number: string;
  currency: string;
  duitnow_id: string | null;
  duitnow_qr_url: string | null;
  include_in_reminders: boolean;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
  version: number;
  business_entity: string;
  payment_method: ReceivingAccountPaymentMethod;
  masked_display: string;
  qr_object_path: string | null;
  is_active: boolean;
  verification_status: ReceivingAccountVerificationStatus;
  created_by: string | null;
  updated_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
}

export type ReceivingAccountInsert = Omit<ReceivingAccountRow, "id" | "business_entity_id" | "created_at" | "updated_at" | "version" | "masked_display" | "is_active" | "verification_status" | "created_by" | "updated_by" | "approved_by" | "approved_at"> & {
  id?: string;
  business_entity_id?: string | null;
  created_at?: string;
};

export type ReceivingAccountUpdate = Partial<
  Omit<ReceivingAccountRow, "id" | "business_id" | "created_at" | "updated_at" | "version" | "masked_display" | "verification_status" | "created_by" | "updated_by" | "approved_by" | "approved_at">
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

export interface PaymentAccessOtpChallengeRow {
  id: string;
  business_id: string;
  case_id: string;
  public_access_token_id: string;
  channel: "email" | "sms";
  destination_hash: string;
  code_hash: string;
  requester_ip_hash: string;
  expires_at: string;
  resend_available_at: string;
  attempt_count: number;
  max_attempts: 5;
  delivery_status: "pending" | "sent" | "failed";
  provider_reference: string | null;
  consumed_at: string | null;
  invalidated_at: string | null;
  created_at: string;
}

export interface PaymentAccessSessionRow {
  id: string;
  session_hash: string;
  business_id: string;
  case_id: string;
  public_access_token_id: string;
  otp_challenge_id: string;
  expires_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface PaymentAccessSuspiciousReportRow {
  id: string;
  business_id: string;
  case_id: string;
  public_access_token_id: string;
  category:
    | "do_not_recognise_business" | "do_not_recognise_amount" | "wrong_payment_details"
    | "suspicious_payment_request" | "suspected_illegal_lending" | "other"
    | "unrecognised_debt" | "creditor_details_wrong" | "payment_details_suspicious" | "unexpected_link";
  details: string | null;
  reporter_ip_hash: string;
  tenant_review_status: "pending" | "acknowledged" | "resolved";
  tenant_reviewed_by: string | null;
  tenant_reviewed_at: string | null;
  platform_review_required: boolean;
  restriction_applied_until: string | null;
  created_at: string;
}

export interface PaymentAccessReportEventRow {
  id: string; report_id: string; business_id: string;
  event_type: string; audience: "tenant" | "platform";
  actor_type: "debtor" | "owner" | "platform" | "system";
  actor_reference: string | null; note: string | null; metadata: Json; created_at: string;
}

export interface BusinessRiskPolicyRow {
  industry: BusinessIndustry; risk_level: "standard" | "elevated" | "high";
  requires_additional_review: boolean; requires_licence_reference: boolean;
  payment_links_require_verified: boolean; abuse_report_threshold: number;
  abuse_report_window_hours: number; restriction_hours: number;
  immediate_illegal_lending_restriction: boolean; updated_by: string; updated_at: string;
}

export interface BusinessRiskPolicyEventRow {
  id: string; industry: BusinessIndustry; event_type: "created" | "updated";
  actor_reference: string; previous_policy: Json | null; current_policy: Json; created_at: string;
}

export interface BusinessVerificationReviewRow {
  id: string; business_id: string;
  status: "submitted" | "under_review" | "verified" | "rejected" | "restricted";
  industry_snapshot: BusinessIndustry; risk_level: "standard" | "elevated" | "high";
  requires_additional_review: boolean; registration_document_reference: string | null;
  licence_document_reference: string | null; owner_note: string | null;
  public_decision_reason: string | null; internal_review_note: string | null;
  submitted_by: string | null; reviewer_reference: string | null;
  submitted_at: string; reviewed_at: string | null; created_at: string;
}

export interface BusinessVerificationEventRow {
  id: string; business_id: string; review_id: string | null;
  from_state: BusinessVerificationState | null; to_state: BusinessVerificationState;
  actor_type: "owner" | "platform" | "system"; actor_reference: string | null;
  public_reason: string | null; internal_note: string | null; metadata: Json; created_at: string;
}

export interface PlatformAbuseReviewQueueRow {
  id: string; report_id: string; business_id: string; case_id: string;
  priority: "normal" | "high" | "critical";
  status: "open" | "in_review" | "confirmed" | "dismissed";
  reason: string; assigned_reference: string | null; outcome_note: string | null;
  reviewed_at: string | null; created_at: string; updated_at: string;
}

// ─── 7. payments ──────────────────────────────────────────────────────────────

export interface PaymentRow {
  id: string;
  case_id: string;
  amount: number;
  amount_minor?: number;
  currency: string;
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

export interface CommunicationActivityRow {
  id: string;
  business_id: string;
  customer_id: string | null;
  case_id: string;
  channel: CommunicationChannel;
  direction: CommunicationDirection;
  status: CommunicationStatus;
  outcome: string | null;
  started_at: string;
  completed_at: string | null;
  staff_user_id: string | null;
  external_reference: string | null;
  provider: string | null;
  provider_message_id: string | null;
  thread_reference: string | null;
  sender: string | null;
  recipients: Json;
  subject: string | null;
  body_text: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  opened_at: string | null;
  replied_at: string | null;
  failure_reason: string | null;
  review_required: boolean;
  duration_seconds: number | null;
  metadata: Json;
  related_promise_id: string | null;
  related_dispute_id: string | null;
  related_action_id: string | null;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
  policy_check_id: string | null;
  policy_version_id: string | null;
  policy_result: "not_applicable" | "allow" | "approval_required" | "prohibited";
  policy_content_hash: string | null;
}

export interface ContactPreferenceRow {
  id: string;
  business_id: string;
  customer_id: string;
  preferred_channel: CommunicationChannel | null;
  preferred_time_start: string | null;
  preferred_time_end: string | null;
  email_only: boolean;
  do_not_call: boolean;
  wrong_number: boolean;
  invalid_contact: boolean;
  do_not_email: boolean;
  email_invalid: boolean;
  email_unsubscribed: boolean;
  last_email_bounced_at: string | null;
  note: string | null;
  documented_at: string;
  documented_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmailSenderIdentityRow {
  id: string;
  business_id: string;
  provider: "resend";
  from_email: string;
  from_name: string;
  reply_domain: string | null;
  signature_text: string;
  verification_status: "pending" | "verified" | "failed";
  verified_at: string | null;
  last_verification_error: string | null;
  configured_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmailTemplateRow {
  id: string;
  business_id: string;
  name: string;
  subject_template: string;
  body_template: string;
  is_active: boolean;
  is_system_default: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScheduledEmailFollowupRow {
  id: string;
  business_id: string;
  case_id: string;
  customer_id: string | null;
  related_action_id: string | null;
  idempotency_key: string;
  due_at: string;
  timezone: string;
  to_recipients: Json;
  cc_recipients: Json;
  bcc_recipients: Json;
  subject: string;
  body_text: string;
  attachment_ids: Json;
  override_reason: string | null;
  status: "pending" | "processing" | "sent" | "failed" | "cancelled";
  attempts: number;
  last_error: string | null;
  communication_activity_id: string | null;
  created_by: string | null;
  created_at: string;
  processed_at: string | null;
  policy_check_id: string | null;
  policy_content_hash: string | null;
}

export interface CompliancePolicyVersionRow {
  id: string;
  scope_business_id: string | null;
  jurisdiction: string;
  version: string;
  status: "draft" | "counsel_approved" | "retired";
  effective_from: string;
  effective_until: string | null;
  rules: Json;
  counsel_validated_at: string | null;
  counsel_validator_name: string | null;
  counsel_validation_reference: string | null;
  created_by: string | null;
  created_at: string;
}

export interface CompliancePolicyCheckRow {
  id: string;
  business_id: string;
  case_id: string;
  policy_version_id: string;
  action_kind: "communication" | "reminder" | "legal_action" | "payment_action" | "other";
  channel: CommunicationChannel | null;
  content_hash: string;
  result: "allow" | "approval_required" | "prohibited";
  required_approval: "automatic" | "agent" | "supervisor" | "legal" | "prohibited";
  warnings: Json;
  signals: Json;
  approval_state: "approved" | "pending" | "rejected" | "invalidated" | "prohibited";
  requested_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  approval_note: string | null;
  bypassed: boolean;
  bypass_reason: string | null;
  expires_at: string;
  final_action: string | null;
  executed_at: string | null;
  invalidated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ComplianceCaseHoldRow {
  id: string;
  business_id: string;
  case_id: string;
  category: import("@/lib/compliance/types").SensitiveCaseCategory;
  source_check_id: string | null;
  action_item_id: string | null;
  status: "active" | "resolved";
  detail: string;
  owner_id: string;
  created_by: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface EmailWebhookEventRow {
  id: string;
  provider: string;
  provider_event_id: string;
  event_type: string;
  provider_message_id: string | null;
  communication_activity_id: string | null;
  payload: Json;
  processed_at: string;
  status: "processing" | "processed" | "ignored" | "retry_scheduled" | "dead_letter";
  attempts: number;
  last_error_code: string | null;
  last_error_message: string | null;
  event_created_at: string | null;
}

export interface EmailInboundReviewRow {
  id: string;
  business_id: string;
  provider: string;
  provider_message_id: string;
  sender: string;
  recipients: Json;
  subject: string | null;
  reason: string;
  status: "pending" | "linked" | "dismissed";
  communication_activity_id: string | null;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
}

export interface ContactFrequencyPolicyRow extends ContactFrequencyPolicy {
  business_id: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContactGuardOverrideRow {
  id: string;
  business_id: string;
  customer_id: string | null;
  case_id: string;
  communication_activity_id: string | null;
  action_item_id: string | null;
  channel: CommunicationChannel;
  is_bulk: boolean;
  reason: string;
  evaluation: Json;
  overridden_by: string;
  created_at: string;
}

export interface PaymentPromiseRow {
  id: string;
  business_id: string;
  case_id: string;
  customer_id: string | null;
  promised_amount_minor: number;
  currency?: string;
  promise_date: string;
  source: PaymentPromiseSource;
  source_activity_type: string | null;
  source_activity_id: string | null;
  note: string | null;
  status: PaymentPromiseStatus;
  amount_fulfilled_minor: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  fulfilled_at: string | null;
  missed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  idempotency_key: string;
}

export interface PaymentPromiseAllocationRow {
  id: string;
  business_id: string;
  promise_id: string;
  payment_id: string;
  amount_minor: number;
  matching_rule: "explicit_same_case_payment" | "authorised_override";
  override_reason: string | null;
  allocated_by: string | null;
  created_at: string;
  reversed_at: string | null;
  reversed_by: string | null;
  reversal_reason: string | null;
}

export interface PaymentPromiseEventRow {
  id: string;
  business_id: string;
  promise_id: string;
  case_id: string;
  payment_id: string | null;
  event_type:
    | "created"
    | "payment_matched"
    | "partially_fulfilled"
    | "fulfilled"
    | "missed"
    | "cancelled"
    | "match_overridden"
    | "payment_reversed";
  actor_type: "owner" | "system";
  actor_id: string | null;
  amount_minor: number | null;
  note: string | null;
  metadata: Json;
  created_at: string;
}

export interface DisputeRow {
  id: string;
  business_id: string;
  case_id: string;
  obligation_id: string | null;
  customer_id: string | null;
  public_access_token_id: string | null;
  category: DisputeCategory;
  original_amount_minor: number;
  balance_snapshot_minor: number;
  disputed_amount_minor: number;
  currency?: string;
  undisputed_amount_minor: number;
  reason: string;
  description: string;
  status: DisputeStatus;
  creditor_response: string | null;
  resolution_amount_minor: number | null;
  review_due_at: string | null;
  resolution_adjustment_event_id: string | null;
  submitted_by_type: "debtor" | "owner";
  created_by: string | null;
  idempotency_key: string;
  submitted_at: string;
  updated_at: string;
  resolved_at: string | null;
  withdrawn_at: string | null;
}

export interface DisputeEvidenceRow {
  id: string; dispute_id: string; business_id: string; case_id: string;
  evidence_file_id: string | null; object_path: string | null; file_name: string;
  content_type: string | null; size_bytes: number | null; content_sha256: string | null;
  submitted_by_type: "debtor" | "owner"; created_at: string;
}

export interface DisputeEventRow {
  id: string; dispute_id: string; business_id: string; case_id: string;
  from_status: DisputeStatus | null; to_status: DisputeStatus;
  event_type: DisputeStatus | "evidence_attached" | "credit_adjustment_created";
  actor_type: "debtor" | "owner" | "system"; actor_id: string | null;
  response: string | null; metadata: Json; created_at: string;
}

export interface CaseRecoveryAmountsRow {
  business_id: string; case_id: string; total_outstanding_minor: number;
  active_disputed_minor: number; collectable_minor: number; active_dispute_count: number;
}

export interface PaymentProofSubmissionRow {
  id: string;
  public_access_token_id: string;
  payment_access_session_id: string | null;
  business_id: string;
  case_id: string;
  debtor_id: string | null;
  receiving_account_id: string | null;
  invoice_reference: string | null;
  amount: number;
  payment_method: PaymentMethod;
  payment_date: string;
  reference_no: string | null;
  debtor_note: string | null;
  proof_object_path: string | null;
  proof_content_type: string | null;
  proof_size_bytes: number | null;
  proof_sha256: string | null;
  status: PaymentProofStatus;
  reviewed_at: string | null;
  reviewed_by: string | null;
  review_notes: string | null;
  rejection_reason: string | null;
  idempotency_key: string;
  created_at: string;
}

export type PaymentProofSubmissionInsert = Pick<PaymentProofSubmissionRow,
  "public_access_token_id" | "payment_access_session_id" | "amount" | "payment_method" | "payment_date" | "idempotency_key"
> & Partial<Pick<PaymentProofSubmissionRow, "id" | "reference_no" | "debtor_note" | "proof_object_path" | "proof_content_type" | "proof_size_bytes" | "proof_sha256">>;

export interface PaymentProofEventRow {
  id: string; submission_id: string; business_id: string; case_id: string;
  from_status: string | null; to_status: string; actor_type: ActorType;
  actor_id: string | null; reason: string | null; metadata: Json; created_at: string;
}

export interface NotificationRow {
  id: string; business_id: string; user_id: string | null; case_id: string | null;
  customer_id: string | null; type: string; event_type: string; title: string;
  message: string; entity_type: string | null; entity_id: string | null;
  severity: NotificationSeverity; action_url: string | null;
  read_at: string | null; archived_at: string | null; dedupe_key: string;
  domain_event_id: string | null; push_enabled: boolean; created_at: string;
}

export interface MobilePushDeviceRow {
  id: string; business_id: string; user_id: string; expo_push_token: string;
  platform: "android" | "ios"; enabled: boolean; last_seen_at: string;
  disabled_at: string | null; created_at: string; updated_at: string;
}

export interface MobilePushDeliveryRow {
  id: string; notification_id: string; device_id: string;
  status: "queued" | "ticket_ok" | "delivered" | "retryable_error" | "failed";
  ticket_id: string | null; attempts: number; last_error: string | null;
  sent_at: string | null; receipt_checked_at: string | null; created_at: string; updated_at: string;
}

export interface ActionCentreItemRow {
  id: string; business_id: string; case_id: string | null; customer_id: string | null;
  assignee_id: string | null; type: string; title: string;
  description: string; href: string; entity_type: string | null; entity_id: string | null;
  status: ActionCentreStatus; reason: string; amount_minor: number; currency: string;
  priority: ActionCentrePriority; due_at: string | null; recommended_action: string;
  source_event_id: string | null; completed_at: string | null; snoozed_until: string | null;
  dedupe_key: string; created_at: string;
}

export interface ActionCentreItemEventRow {
  id: string; action_item_id: string; business_id: string; case_id: string | null;
  actor_type: "owner" | "system"; actor_id: string | null;
  event_type: "created" | "started" | "snoozed" | "reopened" | "completed" | "dismissed" | "auto_completed";
  from_status: ActionCentreStatus | null; to_status: ActionCentreStatus;
  snooze_duration_seconds: number | null; metadata: Json; created_at: string;
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
  currency?: string;
  source_table: string;
  source_id: string;
  idempotency_key: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export type CaseFinancialEventInsert = Omit<CaseFinancialEventRow, "id" | "created_at"> & { id?: string; created_at?: string };

export type FinancialAdjustmentType =
  | "credit_note" | "settlement_adjustment" | "write_off" | "manual_correction"
  | "returned_goods" | "commercial_discount" | "other";
export type FinancialAdjustmentDirection = "credit" | "debit";
export type FinancialAdjustmentApprovalStatus = "pending" | "approved" | "rejected";
export type CaseClosureReason =
  | "paid_in_full" | "settled" | "written_off" | "dispute_resolved"
  | "cancelled" | "duplicate" | "professional_handoff" | "other";

export interface FinancialAdjustmentRow {
  id: string;
  business_id: string;
  case_id: string;
  obligation_id: string | null;
  adjustment_type: FinancialAdjustmentType;
  direction: FinancialAdjustmentDirection;
  amount_minor: number;
  currency?: string;
  reason: string;
  reference: string | null;
  old_amount_minor: number | null;
  new_amount_minor: number | null;
  approval_status: FinancialAdjustmentApprovalStatus;
  required_approver_role: "owner" | "manager";
  requested_by: string;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  financial_event_id: string | null;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

export interface FinancialAdjustmentEventRow {
  id: string;
  adjustment_id: string;
  business_id: string;
  case_id: string;
  event_type: "requested" | "approved" | "rejected" | "posted";
  actor_id: string | null;
  actor_role: "owner" | "manager" | "system";
  note: string | null;
  metadata: Json;
  created_at: string;
}

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
export type PaymentPlanEventType = "due_soon" | "due_today" | "missed" | "partial_payment" | "paid" | "plan_completed";

export interface PaymentPlanRow {
  id:                 string;
  case_id:            string;
  total_amount:       number;
  installment_count:  number;
  installment_amount: number;
  currency?: string;
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
  timezone:           string;
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
  currency?: string;
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

export interface PaymentPlanEventRow {
  id: string;
  business_id: string;
  case_id: string;
  payment_plan_id: string;
  payment_plan_installment_id: string | null;
  event_type: PaymentPlanEventType;
  event_date: string;
  amount_minor: string | null;
  paid_minor: string | null;
  metadata: Json;
  created_at: string;
}

export type PaymentNegotiationOption = "promise_to_pay" | "installment_plan" | "payment_difficulty";
export type PaymentNegotiationStatus = "proposed" | "countered" | "accepted" | "declined" | "withdrawn" | "expired";

export interface PaymentNegotiationRow {
  id: string;
  business_id: string;
  case_id: string;
  customer_id: string;
  public_access_token_id: string | null;
  option_type: PaymentNegotiationOption;
  status: PaymentNegotiationStatus;
  current_revision_no: number;
  accepted_revision_no: number | null;
  payment_plan_id: string | null;
  payment_promise_id: string | null;
  idempotency_key: string;
  expires_at: string;
  accepted_at: string | null;
  declined_at: string | null;
  withdrawn_at: string | null;
  expired_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaymentNegotiationRevisionRow {
  id: string;
  negotiation_id: string;
  business_id: string;
  case_id: string;
  revision_no: number;
  proposed_by: "debtor" | "creditor";
  amount_now_minor: string;
  installment_amount_minor: string;
  frequency: "weekly" | "monthly";
  start_date: string;
  reason: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export interface PaymentNegotiationEventRow {
  id: string;
  negotiation_id: string;
  business_id: string;
  case_id: string;
  event_type: PaymentNegotiationStatus;
  actor_type: "debtor" | "owner" | "system";
  actor_id: string | null;
  revision_no: number | null;
  note: string | null;
  metadata: Json;
  created_at: string;
}

// ─── 9. audit_logs ────────────────────────────────────────────────────────────

export interface AuditLogRow {
  id: string;
  business_id: string;
  case_id: string | null;
  action: string;             // e.g. "case.created", "payment.approved"
  actor_type: ActorType;
  actor_id: string | null;    // auth.uid or "system"
  actor_role: TenantRole | null;
  entity_type: string | null;
  entity_id: string | null;
  before_summary: Json | null;
  after_summary: Json | null;
  request_id: string | null;
  session_id: string | null;
  request_metadata: Json;
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
  actor_role?: TenantRole | null;
  entity_type?: string | null;
  entity_id?: string | null;
  before_summary?: Json | null;
  after_summary?: Json | null;
  request_id?: string | null;
  session_id?: string | null;
  request_metadata?: Json;
  metadata?: Json | null;
  created_at?: string;
}

export interface BusinessMembershipRow {
  id: string;
  business_id: string;
  user_id: string | null;
  invited_email: string | null;
  role: TenantRole;
  status: MembershipStatus;
  invited_by: string | null;
  accepted_at: string | null;
  created_at: string;
  updated_at: string;
}
export type BusinessMembershipInsert = Omit<BusinessMembershipRow, "id" | "accepted_at" | "created_at" | "updated_at"> & {
  id?: string; accepted_at?: string | null; created_at?: string; updated_at?: string;
};
export interface BusinessRoleSettingsRow {
  business_id: string;
  manager_can_approve_settlements: boolean;
  manager_can_approve_write_offs: boolean;
  manager_can_submit_document_intakes: boolean;
  updated_by: string | null;
  updated_at: string;
}
export type BusinessRoleSettingsInsert = Omit<BusinessRoleSettingsRow, "updated_by" | "updated_at"> & {
  updated_by?: string | null; updated_at?: string;
};

// ─── 11. lawyer_referrals ────────────────────────────────────────────────────

export type ReferralStatus =
  | "draft"
  | "ready_for_review"
  | "handoff_pending"
  | "handoff_failed"
  | "submitted"
  | "under_review"
  | "additional_documents_requested"
  | "lawyer_contacted"
  | "accepted"
  | "declined"
  | "withdrawn"
  | "closed";

export type ContactMethod = "whatsapp" | "email" | "phone";
export type ProfessionalHandoffStatus = "submitted" | "under_review" | "additional_documents_requested" | "accepted" | "closed";

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

export type LawyerReferralEventType = "created" | "data_package_created" | "handoff_attempted" | "handoff_failed" | "submitted" | "withdrawn" | "provider_status_recorded" | "documents_requested" | "documents_provided" | "professional_message";

export interface LawyerReferralEventRow {
  id: string;
  referral_id: string;
  case_id: string;
  business_id: string;
  event_type: LawyerReferralEventType;
  actor_type: "owner" | "system" | "professional";
  actor_id: string | null;
  metadata: Json;
  idempotency_key: string | null;
  created_at: string;
}

export type LawyerReferralEventInsert = Omit<LawyerReferralEventRow, "id" | "created_at" | "idempotency_key"> & { id?: string; created_at?: string; idempotency_key?: string | null };

export interface LegalHandoffDocumentRequestRow {
  id: string; referral_id: string; case_id: string; business_id: string;
  professional_name: string; professional_firm: string; request_message: string;
  requested_documents: Json; provider_request_id: string;
  status: "open" | "fulfilled" | "cancelled"; response_note: string | null;
  fulfilled_at: string | null; fulfilled_by: string | null;
  created_at: string; updated_at: string;
}

export interface LegalHandoffDocumentRequestEvidenceRow {
  request_id: string; evidence_id: string; case_id: string; business_id: string;
  added_by: string | null; created_at: string;
}

// ─── Convenience aliases ──────────────────────────────────────────────────────

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];

export type TablesInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];

export type TablesUpdate<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];

export interface PaymentOperationSettingsRow { business_id: string; unusual_reallocation_threshold_minor: number; updated_by: string | null; updated_at: string }
export type PaymentOperationSettingsInsert = Pick<PaymentOperationSettingsRow, "business_id"> & Partial<Omit<PaymentOperationSettingsRow, "business_id">>;
export interface PaymentReceiptRow { id: string; business_id: string; receipt_kind: "payment" | "credit"; amount_minor: number; currency: string; received_at: string; source_type: string; source_system: string; source_record_id: string; normalized_transaction_id: string | null; reference: string | null; payer_name: string | null; metadata: Json; idempotency_key: string; request_hash: string; created_by: string | null; created_at: string }
export type PaymentReceiptInsert = Omit<PaymentReceiptRow, "id" | "created_at"> & { id?: string; created_at?: string };
export interface PaymentExchangeRateRow { id: string; business_id: string; source_currency: string; target_currency: string; numerator: number; denominator: number; effective_at: string; provider: string; provider_record_id: string; evidence: Json; created_by: string | null; created_at: string }
export type PaymentExchangeRateInsert = Omit<PaymentExchangeRateRow, "id" | "created_at"> & { id?: string; created_at?: string };
export interface PaymentAllocationApprovalRequestRow { id: string; business_id: string; receipt_id: string; operation_type: "reallocation"; proposed_allocations: Json; reason: string; status: "pending" | "approved" | "rejected" | "cancelled" | "consumed"; requested_by: string; decided_by: string | null; decision_reason: string | null; decided_at: string | null; consumed_at: string | null; created_at: string }
export type PaymentAllocationApprovalRequestInsert = Pick<PaymentAllocationApprovalRequestRow, "business_id" | "receipt_id" | "operation_type" | "proposed_allocations" | "reason" | "requested_by"> & Partial<Omit<PaymentAllocationApprovalRequestRow, "business_id" | "receipt_id" | "operation_type" | "proposed_allocations" | "reason" | "requested_by">>;
export interface PaymentLedgerJournalRow { id: string; business_id: string; operation_type: string; source_table: string; source_id: string; idempotency_key: string; created_by: string | null; created_at: string }
export interface PaymentLedgerEntryRow { id: string; journal_id: string; business_id: string; account_code: string; entry_side: "debit" | "credit"; amount_minor: number; currency: string; created_at: string }
export interface PaymentOperationAllocationRow { id: string; business_id: string; receipt_id: string; event_type: "allocation" | "reversal"; reverses_allocation_id: string | null; case_id: string | null; obligation_id: string | null; receipt_amount_minor: number; receipt_currency: string; target_amount_minor: number; target_currency: string; overpayment_minor: number; exchange_rate_id: string | null; payment_id: string | null; case_financial_event_id: string | null; journal_id: string; reason: string | null; approval_request_id: string | null; idempotency_key: string; created_by: string | null; created_at: string }
export interface PaymentRefundRow { id: string; business_id: string; receipt_id: string; amount_minor: number; currency: string; reason: string; journal_id: string; external_reference: string | null; idempotency_key: string; created_by: string | null; created_at: string }
export interface PaymentReceiptReversalRow { id: string; business_id: string; receipt_id: string; reason: string; journal_id: string; idempotency_key: string; created_by: string | null; created_at: string }
export interface AccountingPaymentOperationOutboxRow { id: string; business_id: string; connection_id: string; provider: "xero" | "quickbooks" | "bukku" | "autocount"; operation_type: string; source_table: string; source_id: string; payload: Json; idempotency_key: string; status: "pending" | "processing" | "synced" | "failed" | "configuration_required" | "dead_letter"; attempts: number; next_attempt_at: string; external_record_id: string | null; last_error_code: string | null; last_error_message: string | null; locked_at: string | null; synced_at: string | null; created_at: string; updated_at: string }
export interface PaymentOperationIdempotencyRow { business_id: string; action_scope: string; idempotency_key: string; request_hash: string; response: Json; created_by: string | null; created_at: string }
export interface PocketDebtAttachmentRow { id: string; business_id: string; debt_id: string; evidence_id: string; created_by: string | null; created_at: string }
export type PocketDebtAttachmentInsert = Omit<PocketDebtAttachmentRow,"id"|"created_at"> & { id?: string; created_at?: string };
export interface PaymentReceiptPositionRow { id: string; business_id: string; receipt_kind: "payment" | "credit"; amount_minor: number; currency: string; received_at: string; reference: string | null; source_type: string; source_system: string; source_record_id: string; allocated_minor: number; refunded_minor: number; unallocated_minor: number; overpayment_minor: number; state: "unallocated" | "partially_allocated" | "fully_allocated" | "overpaid" | "refunded" | "reversed" }
export interface DebtLedgerEventRow { id: string; business_id: string; case_id: string; event_kind: string; amount_minor: number; currency: string; approval_status: "approved" | "pending" | "rejected" | "reversed"; approval_authority: string | null; requested_by: string | null; approved_by: string | null; approved_at: string | null; source_table: string; source_id: string; source_version: number; evidence_citations: Json; reverses_event_id: string | null; reason: string | null; metadata: Json; created_at: string }
export interface DebtBalanceVersionRow { id: string; business_id: string; case_id: string; version: number; currency: string; original_principal_minor: number; invoiced_amount_minor: number; approved_adjustments_minor: number; approved_fees_minor: number; credit_notes_minor: number; confirmed_payments_minor: number; disputed_amount_minor: number; unverified_amount_minor: number; unverified_credit_minor: number; confirmed_outstanding_minor: number; total_displayed_exposure_minor: number; overpayment_minor: number; source_fingerprint: string; explanation_tree: Json; user_explanation: string; calculated_at: string }
export interface DebtLedgerReconciliationExceptionRow { id: string; business_id: string; case_id: string; run_id: string; legacy_outstanding_minor: number; canonical_exposure_minor: number; difference_minor: number; exception_code: "legacy_balance_mismatch" | "currency_mismatch" | "source_gap"; details: Json; resolved_at: string | null; resolved_by: string | null; created_at: string }
export interface DiscrepancyFindingRow { id: string; business_id: string; case_id: string; finding_key: string; category: string; state_class: "suspicious" | "inconsistent" | "incomplete" | "confirmed_error"; severity: "low" | "medium" | "high" | "critical"; confidence: "deterministic" | "high" | "medium" | "low"; confidence_score: number; impacted_amount_minor: number; currency: string; title: string; explanation: string; conflicting_values: Json; source_references: Json; recommended_action: string; detector_version: string; source_fingerprint: string; status: "open" | "confirmed" | "dismissed" | "deferred" | "resolved"; status_reason: string | null; deferred_until: string | null; corrective_workflow: Json | null; detected_at: string; last_detected_at: string; status_changed_at: string | null; status_changed_by: string | null }
export interface DiscrepancyFindingEventRow { id: string; finding_id: string; business_id: string; case_id: string; event_type: "detected" | "source_changed" | "reopened" | "confirmed" | "dismissed" | "deferred" | "resolved"; from_status: string | null; to_status: string; reason: string | null; actor_type: "system" | "staff"; actor_id: string | null; source_fingerprint: string; metadata: Json; created_at: string }
