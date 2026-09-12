-- ============================================================
-- CollectBoss — Row Level Security Policies
-- Legacy reference only. Do not apply independently; deployment uses
-- supabase/schema.sql plus reviewed files in supabase/migrations/.
-- Privileged-function execution is controlled by
-- 20260801_function_execution_hardening.sql; internal ledger and plan helpers
-- must never retain the default PUBLIC EXECUTE grant.
-- Final explicit tenant and storage-object policies are controlled by
-- 20260802_tenant_isolation_policy_hardening.sql and
-- 20260803_storage_object_policy_hardening.sql.
--
-- Security model:
--   • Each authenticated user (auth.uid()) owns one business.
--   • All case data is scoped through business ownership.
--   • Debtors access /pay/[caseId] via a server-side function
--     that checks payment_access_requests — they never hit
--     these policies directly.
--   • Payment details (receiving_accounts) are exposed only
--     when a valid, non-expired approval exists — enforced in
--     application logic, not RLS (RLS protects the table itself).
-- ============================================================

-- ─── Helper function: get current user's business_id ─────────
create or replace function my_business_id()
returns uuid language sql stable as $$
  select id from businesses where owner_id = auth.uid() limit 1;
$$;

-- ─── Helper function: is case owned by current user? ─────────
create or replace function owns_case(p_case_id text)
returns boolean language sql stable as $$
  select exists (
    select 1
    from cases c
    join businesses b on b.id = c.business_id
    where c.id = p_case_id
      and b.owner_id = auth.uid()
  );
$$;

-- ════════════════════════════════════════════════════════════
-- 1. businesses
-- ════════════════════════════════════════════════════════════
alter table businesses enable row level security;

-- Owner can read their own business
create policy "businesses: owner read"
  on businesses for select
  using (owner_id = auth.uid());

-- Owner can insert their own business (owner_id must match)
create policy "businesses: owner insert"
  on businesses for insert
  with check (owner_id = auth.uid());

-- Owner can update their own business
create policy "businesses: owner update"
  on businesses for update
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Account profile fields (account_type, legal_name, contact_name and
-- logo_object_path) inherit this row-owner policy. The canonical migration
-- creates the private business-assets bucket policies; do not apply storage
-- policy DDL from this legacy reference independently.
-- I01 region fields also inherit the final businesses member-read policy.
-- I02 currency fields inherit their parent table policies. Currency guards
-- validate tenant-owned case/account relationships and do not add or broaden
-- any anonymous or authenticated row access policy.
-- Region writes are performed only by the server route after enforcing
-- settings.sensitive.manage; no direct member browser-write policy is added.

-- No delete (soft-delete in future)

-- 1b. debtors
alter table debtors enable row level security;

create policy "debtors: owner read"
  on debtors for select
  using (business_id = my_business_id());

create policy "debtors: owner insert"
  on debtors for insert
  with check (business_id = my_business_id());

create policy "debtors: owner update"
  on debtors for update
  using (business_id = my_business_id())
  with check (business_id = my_business_id());

-- No delete policy: archive by setting archived_at to preserve case links.

-- ════════════════════════════════════════════════════════════
-- 2. cases
-- ════════════════════════════════════════════════════════════
alter table cases enable row level security;

create policy "cases_owner_read"
  on cases for select
  using (
    business_id = my_business_id()
  );

create policy "cases_owner_insert"
  on cases for insert
  with check (
    business_id = my_business_id()
  );

create policy "cases_owner_update"
  on cases for update
  using (business_id = my_business_id())
  with check (business_id = my_business_id());

-- No delete policy — cases should never be deleted, only archived

-- Lifecycle history is append-only and readable only by the case owner.
alter table case_status_history enable row level security;

create policy "case_status_history_owner_read"
  on case_status_history for select to authenticated
  using (owns_case(case_id));

-- ════════════════════════════════════════════════════════════
-- 3. evidence_files
-- ════════════════════════════════════════════════════════════
alter table evidence_files enable row level security;

create policy "evidence_files: owner read"
  on evidence_files for select
  using (owns_case(case_id));

create policy "evidence_files: owner insert"
  on evidence_files for insert
  with check (owns_case(case_id));

create policy "evidence_files: owner update"
  on evidence_files for update
  using (owns_case(case_id))
  with check (owns_case(case_id));

create policy "evidence_files: owner delete"
  on evidence_files for delete
  using (owns_case(case_id));

-- ════════════════════════════════════════════════════════════
-- 4. reminders
-- ════════════════════════════════════════════════════════════
alter table reminders enable row level security;

create policy "reminders: owner read"
  on reminders for select
  using (owns_case(case_id));

create policy "reminders: owner insert"
  on reminders for insert
  with check (owns_case(case_id));

create policy "reminders: owner update"
  on reminders for update
  using (owns_case(case_id))
  with check (owns_case(case_id));

-- ════════════════════════════════════════════════════════════
-- 5. payment_access_requests
-- ════════════════════════════════════════════════════════════
alter table payment_access_requests enable row level security;

-- Business owner sees all requests for their cases
create policy "par: owner read"
  on payment_access_requests for select
  using (owns_case(case_id));

-- Owner can update (approve / reject)
create policy "par: owner update"
  on payment_access_requests for update
  using (owns_case(case_id));

-- Immutable, database-authored history for receiving-account and access events.
alter table payment_access_events enable row level security;
create policy "payment_access_events: owner read"
  on payment_access_events for select
  using (owns_case(case_id));

-- Inserts are done via service role (server-side OTP-verified flow)
-- Debtors do NOT insert directly — they go through a server action

-- ════════════════════════════════════════════════════════════
-- 6. receiving_accounts
-- ════════════════════════════════════════════════════════════
alter table receiving_accounts enable row level security;

-- IMPORTANT: Receiving accounts are NEVER readable by debtors.
-- The /pay/[caseId] page fetches account details server-side,
-- only after verifying a valid approved + non-expired request.
create policy "receiving_accounts: owner read"
  on receiving_accounts for select
  using (business_id = my_business_id());

-- Browser mutation policies are intentionally absent. The Y01 canonical
-- migration provides owner-authorized, redacted-audit server RPCs.

-- ════════════════════════════════════════════════════════════
-- 7. payments
-- ════════════════════════════════════════════════════════════
alter table payments enable row level security;

create policy "payments: owner read"
  on payments for select
  using (owns_case(case_id));

-- Financial inserts and review transitions run only through the reviewed
-- security-definer ledger RPCs. Do not add browser write policies here.

alter table case_financial_events enable row level security;

create policy "case_financial_events: owner read"
  on case_financial_events for select
  using (owns_case(case_id));

-- ════════════════════════════════════════════════════════════
-- 7b. payment plans
alter table payment_plans enable row level security;

drop policy if exists "owners can manage own payment plans" on payment_plans;
drop policy if exists "payment_plans_owner_read" on payment_plans;
create policy "payment_plans_owner_read"
  on payment_plans for select to authenticated
  using (owns_case(case_id));

alter table payment_plan_installments enable row level security;
drop policy if exists "payment_plan_installments_owner_read" on payment_plan_installments;
create policy "payment_plan_installments_owner_read"
  on payment_plan_installments for select to authenticated
  using (exists (
    select 1 from payment_plans p
    where p.id = payment_plan_installments.payment_plan_id
      and owns_case(p.case_id)
  ));

alter table payment_plan_allocations enable row level security;
drop policy if exists "payment_plan_allocations_owner_read" on payment_plan_allocations;
create policy "payment_plan_allocations_owner_read"
  on payment_plan_allocations for select to authenticated
  using (exists (
    select 1 from payment_plans p
    where p.id = payment_plan_allocations.payment_plan_id
      and owns_case(p.case_id)
  ));

alter table payment_plan_events enable row level security;
drop policy if exists "payment_plan_events_owner_read" on payment_plan_events;
create policy "payment_plan_events_owner_read"
  on payment_plan_events for select to authenticated
  using (business_id = my_business_id());

-- 8. legal_documents
-- ════════════════════════════════════════════════════════════
alter table legal_documents enable row level security;

create policy "legal_documents: owner read"
  on legal_documents for select
  using (owns_case(case_id));

create policy "legal_documents: owner insert"
  on legal_documents for insert
  with check (owns_case(case_id));

create policy "legal_documents: owner update drafts"
  on legal_documents for update
  using (owns_case(case_id) and (document_type not in ('demand_standard', 'demand_firm', 'demand_final') or issued_at is null))
  with check (owns_case(case_id) and (document_type not in ('demand_standard', 'demand_firm', 'demand_final') or (issued_at is null and status = 'draft')));

-- ════════════════════════════════════════════════════════════
-- 9. audit_logs
-- ════════════════════════════════════════════════════════════
alter table audit_logs enable row level security;

-- Read own business logs
create policy "audit_logs: owner read"
  on audit_logs for select
  using (business_id = my_business_id());

-- Insert via service role only (application layer)
-- No update / delete on audit logs — they are append-only

-- ════════════════════════════════════════════════════════════
-- Storage bucket policies (apply in Supabase Dashboard > Storage)
-- ════════════════════════════════════════════════════════════
-- evidence-files bucket:
--   Allow authenticated users to read their own business's files only.
--   INSERT/UPDATE/DELETE are intentionally absent: evidence writes are performed
--   only by server routes after owner/case validation with a service-role client.
--   Block all public access
--
-- payment-proofs bucket:
--   Same scoping as evidence-files
--   Block all public access
--
-- legal-documents bucket:
--   Same scoping
--   Block all public access
--
-- duitnow-qr bucket:
--   Scoped to business_id
--   NEVER public — always served via signed URL with expiry

-- ════════════════════════════════════════════════════════════
-- Application-layer rules (NOT RLS — enforced in code)
-- ════════════════════════════════════════════════════════════
-- 1. Payment details shown to debtor ONLY when:
--    payment_access_requests.status = 'approved'
--    AND (expires_at IS NULL OR expires_at > now())
--    AND (access_type != 'once' OR the request was just approved)
--
-- 2. Payment must not be auto-marked as 'paid' until:
--    payments.review_status = 'approved' (manual creditor review)
-- Y02 payment-proof lifecycle policies. Deployment source:
-- supabase/migrations/20260806_secure_payment_proof_flow.sql.
alter table public_payment_submissions enable row level security;
create policy "public_payment_submissions_owner_read" on public_payment_submissions
  for select to authenticated using (business_id = my_business_id());
alter table payment_proof_events enable row level security;
create policy "payment_proof_events_owner_read" on payment_proof_events
  for select to authenticated using (business_id = my_business_id());
alter table notifications enable row level security;
drop policy if exists "notifications_owner_read" on notifications;
drop policy if exists "notifications_owner_update" on notifications;
create policy "notifications_owner_read" on notifications
  for select to authenticated using (
    business_id = my_business_id() and (user_id is null or user_id = auth.uid())
  );
create policy "notifications_owner_update" on notifications
  for update to authenticated
  using (business_id = my_business_id() and (user_id is null or user_id = auth.uid()))
  with check (business_id = my_business_id() and (user_id is null or user_id = auth.uid()));
alter table action_centre_items enable row level security;
drop policy if exists "action_centre_items_owner_read" on action_centre_items;
drop policy if exists "action_centre_items_owner_update" on action_centre_items;
create policy "action_centre_items_owner_read" on action_centre_items
  for select to authenticated using (
    business_id = my_business_id() and (assignee_id is null or assignee_id = auth.uid())
  );
alter table action_centre_item_events enable row level security;
create policy "action_centre_item_events_owner_read" on action_centre_item_events
  for select to authenticated using (business_id = my_business_id());

-- R06 Promise to Pay rows are read-only to browser clients. Authenticated
-- security-definer services perform all validated lifecycle mutations.
alter table payment_promises enable row level security;
create policy "payment_promises_owner_read" on payment_promises
  for select to authenticated using (business_id = my_business_id());
alter table payment_promise_allocations enable row level security;
create policy "payment_promise_allocations_owner_read" on payment_promise_allocations
  for select to authenticated using (business_id = my_business_id());
alter table payment_promise_events enable row level security;
create policy "payment_promise_events_owner_read" on payment_promise_events
  for select to authenticated using (business_id = my_business_id());

-- R07 dispute records are browser read-only; public submissions use a
-- token-validated service RPC and creditor decisions use owner-validated RPCs.
alter table disputes enable row level security;
create policy "disputes_owner_read" on disputes
  for select to authenticated using (business_id = my_business_id());
alter table dispute_evidence enable row level security;
create policy "dispute_evidence_owner_read" on dispute_evidence
  for select to authenticated using (business_id = my_business_id());
alter table dispute_events enable row level security;
create policy "dispute_events_owner_read" on dispute_events
  for select to authenticated using (business_id = my_business_id());

-- R08 negotiation history is read-only in browsers. Token submissions,
-- creditor transitions and expiration use validated security-definer services.
alter table payment_negotiations enable row level security;
create policy "payment_negotiations_owner_read" on payment_negotiations
  for select to authenticated using (business_id = my_business_id());
alter table payment_negotiation_revisions enable row level security;
create policy "payment_negotiation_revisions_owner_read" on payment_negotiation_revisions
  for select to authenticated using (business_id = my_business_id());
alter table payment_negotiation_events enable row level security;
create policy "payment_negotiation_events_owner_read" on payment_negotiation_events
  for select to authenticated using (business_id = my_business_id());

-- R09 adjustment terms and approval history are owner-readable. All writes
-- pass through audited owner-only ledger services; no browser write policy.
alter table financial_adjustments enable row level security;
create policy "financial_adjustments_owner_read" on financial_adjustments
  for select to authenticated using (business_id = my_business_id());
alter table financial_adjustment_events enable row level security;
create policy "financial_adjustment_events_owner_read" on financial_adjustment_events
  for select to authenticated using (business_id = my_business_id());

-- R10 communication activity is append/update-only through owner-validated
-- security-definer functions. Browser clients can read their tenant timeline.
alter table communication_activities enable row level security;
drop policy if exists "communication_activities_owner_read" on communication_activities;
create policy "communication_activities_owner_read" on communication_activities
  for select to authenticated using (business_id = my_business_id());

-- R11 policies/preferences/override evidence are owner-readable. All writes
-- use tenant-validating RPCs so the browser cannot forge customer scope.
alter table contact_frequency_policies enable row level security;
drop policy if exists "contact_frequency_policies_owner_read" on contact_frequency_policies;
create policy "contact_frequency_policies_owner_read" on contact_frequency_policies
  for select to authenticated using (business_id = my_business_id());
alter table contact_preferences enable row level security;
drop policy if exists "contact_preferences_owner_read" on contact_preferences;
create policy "contact_preferences_owner_read" on contact_preferences
  for select to authenticated using (business_id = my_business_id());
alter table contact_guard_overrides enable row level security;
drop policy if exists "contact_guard_overrides_owner_read" on contact_guard_overrides;
create policy "contact_guard_overrides_owner_read" on contact_guard_overrides
  for select to authenticated using (business_id = my_business_id());
--
-- 3. Formal demand / legal document content must include the
--    disclaimer: "This is a draft. CollectBoss does not provide
--    legal advice." before any content.
--
-- 4. No field in any table may store: CCRIS data, CTOS data,
--    blacklist flags, threatening language templates.

-- 5. Lawyer-referral records and events are owner-readable only. Creation,
--    package generation, status changes, and withdrawal are handled by
--    authenticated server routes after explicit consent validation.
alter table lawyer_referrals enable row level security;
create policy "lawyer_referrals_owner_read"
  on lawyer_referrals for select to authenticated
  using (exists (select 1 from businesses b where b.id = lawyer_referrals.business_id and b.owner_id = auth.uid()));

alter table lawyer_referral_events enable row level security;
create policy "lawyer_referral_events_owner_read"
  on lawyer_referral_events for select to authenticated
  using (exists (select 1 from businesses b where b.id = lawyer_referral_events.business_id and b.owner_id = auth.uid()));

alter table legal_handoff_document_requests enable row level security;
create policy "legal_handoff_document_requests_owner_read"
  on legal_handoff_document_requests for select to authenticated
  using (business_id = my_business_id());

alter table legal_handoff_document_request_evidence enable row level security;
create policy "legal_handoff_document_request_evidence_owner_read"
  on legal_handoff_document_request_evidence for select to authenticated
  using (business_id = my_business_id());

-- R01 customer accounts, obligations and case coverage.
-- R17 account_mode, credit limits and warning thresholds remain covered by
-- these tenant policies. businesses.credit_limit_enforcement_enabled is covered
-- by the existing owner/business membership policy; the R17 summary view uses
-- security_invoker so it cannot bypass either table's RLS.
alter table customer_accounts enable row level security;
create policy "customer_accounts: owner read" on customer_accounts
  for select to authenticated using (business_id = my_business_id());
create policy "customer_accounts: owner insert" on customer_accounts
  for insert to authenticated with check (business_id = my_business_id());
create policy "customer_accounts: owner update" on customer_accounts
  for update to authenticated using (business_id = my_business_id())
  with check (business_id = my_business_id());

alter table obligations enable row level security;
create policy "obligations: owner read" on obligations
  for select to authenticated using (business_id = my_business_id());
create policy "obligations: owner insert" on obligations
  for insert to authenticated with check (business_id = my_business_id());
create policy "obligations: owner update" on obligations
  for update to authenticated using (business_id = my_business_id())
  with check (business_id = my_business_id());

alter table recovery_case_obligations enable row level security;
create policy "recovery_case_obligations: owner read" on recovery_case_obligations
  for select to authenticated using (business_id = my_business_id());

-- R02 migration verification output is tenant-scoped and read-only.
alter table receivables_migration_verifications enable row level security;
create policy "receivables_migration_verifications: owner read"
  on receivables_migration_verifications for select to authenticated
  using (business_id = my_business_id());

-- R03 domain events are an internal, append-only scheduler output.
alter table domain_events enable row level security;
create policy "domain_events: owner read" on domain_events
  for select to authenticated using (business_id = my_business_id());

-- Relationship writes intentionally have no direct client policy. They pass
-- through receivables_set_case_scope(), which verifies auth.uid(), tenant,
-- customer/account consistency, authoritative totals and unique coverage.

-- R13 OTP challenges and short-lived session hashes are service-only. They
-- deliberately have no anon/authenticated policies. Suspicious reports are
-- written by a token-validating service route and readable only by the owner.
alter table payment_access_otp_challenges enable row level security;
alter table payment_access_sessions enable row level security;
alter table payment_access_suspicious_reports enable row level security;
drop policy if exists "payment_access_suspicious_reports_owner_read"
  on payment_access_suspicious_reports;
create policy "payment_access_suspicious_reports_owner_read"
  on payment_access_suspicious_reports for select to authenticated
  using (exists (
    select 1 from businesses b
    where b.id = payment_access_suspicious_reports.business_id
      and b.owner_id = auth.uid()
  ));

-- R14 verification policy, verification decision history and the platform
-- abuse queue are service-only because they contain platform review material.
-- Owners receive an explicitly selected safe projection through authenticated
-- routes. Tenant-visible report events remain business-scoped.
alter table business_risk_policies enable row level security;
alter table business_risk_policy_events enable row level security;
alter table business_verification_reviews enable row level security;
alter table business_verification_events enable row level security;
alter table platform_abuse_review_queue enable row level security;
alter table payment_access_report_events enable row level security;
drop policy if exists "payment_access_report_events_owner_read"
  on payment_access_report_events;
create policy "payment_access_report_events_owner_read"
  on payment_access_report_events for select to authenticated
  using (
    audience = 'tenant'
    and exists (
      select 1 from businesses b
      where b.id = payment_access_report_events.business_id
        and b.owner_id = auth.uid()
    )
  );

-- R15 final policy model. The ordered migration defines has_business_permission
-- before these policies and replaces my_business_id/owns_case with membership-
-- aware helpers. Membership/settings mutation remains server-only.
alter table business_memberships enable row level security;
alter table business_role_settings enable row level security;
create policy "business_memberships_self_read" on business_memberships for select to authenticated
  using(user_id=auth.uid() or has_business_permission(business_id,'users.manage'));
create policy "business_role_settings_member_read" on business_role_settings for select to authenticated
  using(has_business_permission(business_id,'case.read'));
create policy "audit_logs_role_read" on audit_logs for select to authenticated
  using(has_business_permission(business_id,'audit.read'));
-- No audit UPDATE/DELETE policy exists; the R15 immutable trigger also rejects
-- mutation attempts made through privileged database clients.

-- R16 import execution is server/RPC-controlled. Authenticated tenant members
-- may inspect their own batch and row-error reports, but cannot write either
-- table directly. Operational search, import commit, bulk update and merge RPCs
-- re-check role permission and tenant identity before touching data.
alter table import_batches enable row level security;
alter table import_errors enable row level security;
create policy "import_batches_role_read" on import_batches for select to authenticated
  using(has_business_permission(business_id,'case.read'));
create policy "import_errors_role_read" on import_errors for select to authenticated
  using(has_business_permission(business_id,'case.read'));

-- R18 optional organization/entity structure is member-readable and
-- server-managed. Financial ownership remains business_id on every core table.
alter table organizations enable row level security;
alter table organization_business_relationships enable row level security;
alter table business_entities enable row level security;
create policy "organizations_member_read" on organizations for select to authenticated
  using(exists(
    select 1 from organization_business_relationships relationship
    where relationship.organization_id=organizations.id
      and has_business_permission(relationship.business_id,'case.read')
  ));
create policy "organization_business_relationships_member_read"
  on organization_business_relationships for select to authenticated
  using(has_business_permission(business_id,'case.read'));
create policy "business_entities_member_read" on business_entities for select to authenticated
  using(has_business_permission(business_id,'case.read'));
-- No browser mutation policy exists for organization/entity tables. Nullable
-- entity assignments on accounts, obligations, cases and receiving accounts
-- remain governed by their existing tenant policies plus composite tenant FKs.

-- Accounting connector secrets and webhook payloads are server-only. Enabling
-- RLS without browser policies keeps OAuth ciphertext, state hashes and queued
-- events inaccessible even to another authenticated tenant.
alter table accounting_connections enable row level security;
alter table accounting_oauth_states enable row level security;
alter table accounting_external_mappings enable row level security;
alter table accounting_sync_runs enable row level security;
alter table accounting_webhook_events enable row level security;
alter table accounting_financial_applications enable row level security;

drop policy if exists accounting_external_mappings_role_read on accounting_external_mappings;
create policy accounting_external_mappings_role_read on accounting_external_mappings
  for select to authenticated using (
    has_business_permission(business_id,'settings.sensitive.manage')
  );
drop policy if exists accounting_sync_runs_role_read on accounting_sync_runs;
create policy accounting_sync_runs_role_read on accounting_sync_runs
  for select to authenticated using (
    has_business_permission(business_id,'settings.sensitive.manage')
  );
drop policy if exists accounting_financial_applications_role_read on accounting_financial_applications;
create policy accounting_financial_applications_role_read on accounting_financial_applications
  for select to authenticated using (
    has_business_permission(business_id,'audit.read')
  );

revoke all on accounting_connections,accounting_oauth_states,accounting_external_mappings,
  accounting_sync_runs,accounting_webhook_events,accounting_financial_applications from anon;
revoke all on accounting_connections,accounting_oauth_states,accounting_webhook_events from authenticated;
revoke insert,update,delete on accounting_external_mappings,accounting_sync_runs,
  accounting_financial_applications from authenticated;
grant select on accounting_external_mappings,accounting_sync_runs,
  accounting_financial_applications to authenticated;
grant all on accounting_connections,accounting_oauth_states,accounting_external_mappings,
  accounting_sync_runs,accounting_webhook_events,accounting_financial_applications to service_role;

-- I03 email configuration and queues are tenant-readable and server-mutated.
alter table email_sender_identities enable row level security;
alter table email_templates enable row level security;
alter table scheduled_email_followups enable row level security;
alter table email_webhook_events enable row level security;
alter table email_inbound_reviews enable row level security;
drop policy if exists "email_sender_identities_owner_read" on email_sender_identities;
create policy "email_sender_identities_owner_read" on email_sender_identities
  for select to authenticated using(has_business_permission(business_id,'communication.manage'));
drop policy if exists "email_templates_owner_read" on email_templates;
create policy "email_templates_owner_read" on email_templates
  for select to authenticated using(has_business_permission(business_id,'communication.manage'));
drop policy if exists "scheduled_email_followups_owner_read" on scheduled_email_followups;
create policy "scheduled_email_followups_owner_read" on scheduled_email_followups
  for select to authenticated using(has_business_permission(business_id,'communication.manage'));
drop policy if exists "email_inbound_reviews_owner_read" on email_inbound_reviews;
create policy "email_inbound_reviews_owner_read" on email_inbound_reviews
  for select to authenticated using(has_business_permission(business_id,'communication.manage'));
revoke all on email_sender_identities,email_templates,scheduled_email_followups,
  email_webhook_events,email_inbound_reviews from anon;
grant select on email_sender_identities,email_templates,scheduled_email_followups,
  email_inbound_reviews to authenticated;
grant all on email_sender_identities,email_templates,scheduled_email_followups,
  email_webhook_events,email_inbound_reviews to service_role;

-- Prompt 8/9 document-intake metadata is tenant-readable through the existing
-- membership/permission model. All mutations, idempotency records, extraction
-- raw values and private storage objects remain server-only.
alter table document_intakes enable row level security;
alter table document_intake_idempotency_keys enable row level security;
alter table document_intake_events enable row level security;
alter table document_intake_extractions enable row level security;
alter table document_intake_confirmations enable row level security;
alter table document_extraction_candidates enable row level security;
drop policy if exists document_intakes_role_read on document_intakes;
create policy document_intakes_role_read on document_intakes for select to authenticated
  using(has_business_permission(business_id,'document_intake.read'));
drop policy if exists document_intake_events_role_read on document_intake_events;
create policy document_intake_events_role_read on document_intake_events for select to authenticated
  using(has_business_permission(business_id,'document_intake.read'));
drop policy if exists document_intake_confirmations_role_read on document_intake_confirmations;
create policy document_intake_confirmations_role_read on document_intake_confirmations for select to authenticated
  using(has_business_permission(business_id,'document_intake.read'));

drop policy if exists "evidence_files: owner read" on evidence_files;
drop policy if exists "evidence_files: owner insert" on evidence_files;
drop policy if exists "evidence_files: owner update" on evidence_files;
drop policy if exists "evidence_files: owner delete" on evidence_files;
drop policy if exists evidence_files_role_read on evidence_files;
drop policy if exists evidence_files_case_role_insert on evidence_files;
drop policy if exists evidence_files_case_role_update on evidence_files;
create policy evidence_files_role_read on evidence_files for select to authenticated
  using(has_business_permission(business_id,case when intake_id is null then 'case.read' else 'document_intake.read' end));
create policy evidence_files_case_role_insert on evidence_files for insert to authenticated
  with check(intake_id is null and case_id is not null and has_business_permission(business_id,'case.manage'));
create policy evidence_files_case_role_update on evidence_files for update to authenticated
  using(intake_id is null and case_id is not null and has_business_permission(business_id,'case.manage'))
  with check(intake_id is null and case_id is not null and has_business_permission(business_id,'case.manage'));

revoke all on document_intakes,document_intake_idempotency_keys,document_intake_events,
  document_intake_extractions,document_intake_confirmations from anon;
grant select on document_intakes,document_intake_events,document_intake_confirmations to authenticated;
revoke all on document_intake_idempotency_keys,document_intake_extractions from authenticated;
revoke all on document_extraction_candidates from anon,authenticated;
grant all on document_intakes,document_intake_idempotency_keys,document_intake_events,
  document_intake_extractions,document_intake_confirmations to service_role;
grant all on document_extraction_candidates to service_role;

-- No storage.objects policy exists for the private transaction-evidence bucket.
-- The bucket accepts validated PDF, PNG, JPEG, and HEIC originals. Server routes alone can write it or mint short-lived signed URLs after a
-- tenant check and a clean malware-scan state.
-- Prompt 11 extraction payloads and provider raw results remain service-only.
-- Tenant-scoped clients receive only the reduced /api/document-intakes status
-- projection after document_intake.read authorization.
revoke all on document_intake_extractions from anon,authenticated;
grant all on document_intake_extractions to service_role;
revoke all on function document_intake_claim_extraction(text,timestamptz) from public,anon,authenticated;
revoke all on function document_intake_complete_extraction(uuid,uuid,text,text,text,text,text,text,text,jsonb,jsonb,jsonb,numeric,jsonb,boolean) from public,anon,authenticated;
revoke all on function document_intake_fail_extraction(uuid,uuid,text,text,boolean,integer) from public,anon,authenticated;
revoke all on function document_intake_requeue_extraction(uuid,uuid,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function document_intake_claim_extraction(text,timestamptz) to service_role;
grant execute on function document_intake_complete_extraction(uuid,uuid,text,text,text,text,text,text,text,jsonb,jsonb,jsonb,numeric,jsonb,boolean) to service_role;
grant execute on function document_intake_fail_extraction(uuid,uuid,text,text,boolean,integer) to service_role;
grant execute on function document_intake_requeue_extraction(uuid,uuid,uuid,text,text,uuid) to service_role;
-- Prompt 13 review writes remain service-only. Tenant users can read the
-- append-only confirmation projection through document_intake.read above.
revoke all on function document_intake_save_review(uuid,uuid,uuid,text,jsonb,text,text,uuid) from public,anon,authenticated;
grant execute on function document_intake_save_review(uuid,uuid,uuid,text,jsonb,text,text,uuid) to service_role;
-- Mobile companion push registrations (Prompt 7 / 20260830).
alter table mobile_push_devices enable row level security;
alter table mobile_push_deliveries enable row level security;
create policy "mobile_push_devices_self_read" on mobile_push_devices for select to authenticated
  using (user_id=auth.uid() and has_business_permission(business_id,'case.read'));
create policy "mobile_push_devices_self_insert" on mobile_push_devices for insert to authenticated
  with check (user_id=auth.uid() and has_business_permission(business_id,'case.read'));
create policy "mobile_push_devices_self_update" on mobile_push_devices for update to authenticated
  using (user_id=auth.uid() and has_business_permission(business_id,'case.read'))
  with check (user_id=auth.uid() and has_business_permission(business_id,'case.read'));
create policy "mobile_push_devices_self_delete" on mobile_push_devices for delete to authenticated
  using (user_id=auth.uid() and has_business_permission(business_id,'case.read'));
-- Delivery/ticket/receipt rows remain service_role-only by design.

-- Prompt 14 document-workflow policies and RPC privilege boundary.
alter table public.document_intake_workflow_drafts enable row level security;
alter table public.document_intake_outcomes enable row level security;
alter table public.document_intake_record_evidence_links enable row level security;
create policy document_intake_workflow_drafts_role_read on public.document_intake_workflow_drafts for select to authenticated using(public.has_business_permission(business_id,'document_intake.read'));
create policy document_intake_outcomes_role_read on public.document_intake_outcomes for select to authenticated using(public.has_business_permission(business_id,'document_intake.read'));
create policy document_intake_record_links_role_read on public.document_intake_record_evidence_links for select to authenticated using(public.has_business_permission(business_id,'document_intake.read'));
revoke all on public.document_intake_workflow_drafts,public.document_intake_outcomes,public.document_intake_record_evidence_links from anon;
grant select on public.document_intake_workflow_drafts,public.document_intake_outcomes,public.document_intake_record_evidence_links to authenticated;
grant all on public.document_intake_workflow_drafts,public.document_intake_outcomes,public.document_intake_record_evidence_links to service_role;
revoke all on function public.document_intake_save_workflow(uuid,uuid,uuid,integer,text,jsonb,text,text,uuid) from public,anon,authenticated;
revoke all on function public.document_intake_submit_workflow(uuid,uuid,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.document_intake_save_workflow(uuid,uuid,uuid,integer,text,jsonb,text,text,uuid) to service_role;
grant execute on function public.document_intake_submit_workflow(uuid,uuid,uuid,text,text,uuid) to service_role;

-- Prompt 15 scanner and release-health RPCs remain service-role-only.
revoke all on function public.document_evidence_claim_scan(text,timestamptz) from public,anon,authenticated;
revoke all on function public.document_evidence_complete_scan(uuid,uuid,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.document_evidence_fail_scan(uuid,uuid,text,text,boolean,integer) from public,anon,authenticated;
revoke all on function public.document_evidence_requeue_scan(uuid,uuid,uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.document_intake_module_health(timestamptz) from public,anon,authenticated;
grant execute on function public.document_evidence_claim_scan(text,timestamptz) to service_role;
grant execute on function public.document_evidence_complete_scan(uuid,uuid,text,text,text,text,text) to service_role;
grant execute on function public.document_evidence_fail_scan(uuid,uuid,text,text,boolean,integer) to service_role;
grant execute on function public.document_evidence_requeue_scan(uuid,uuid,uuid,text,uuid) to service_role;
grant execute on function public.document_intake_module_health(timestamptz) to service_role;
alter table public.payment_matching_settings enable row level security;
alter table public.normalized_payment_transactions enable row level security;
alter table public.payment_match_jobs enable row level security;
alter table public.payment_match_candidates enable row level security;
alter table public.payment_match_candidate_events enable row level security;
alter table public.payment_match_allocations enable row level security;
alter table public.payment_matching_idempotency_keys enable row level security;

create policy payment_matching_settings_read on public.payment_matching_settings for select to authenticated using(public.has_business_permission(business_id,'payment.approve'));
create policy normalized_payment_transactions_read on public.normalized_payment_transactions for select to authenticated using(public.has_business_permission(business_id,'payment.approve'));
create policy payment_match_jobs_read on public.payment_match_jobs for select to authenticated using(public.has_business_permission(business_id,'payment.approve'));
create policy payment_match_candidates_read on public.payment_match_candidates for select to authenticated using(public.has_business_permission(business_id,'payment.approve'));
create policy payment_match_candidate_events_read on public.payment_match_candidate_events for select to authenticated using(public.has_business_permission(business_id,'payment.approve'));
create policy payment_match_allocations_read on public.payment_match_allocations for select to authenticated using(public.has_business_permission(business_id,'payment.approve'));

revoke all on public.payment_matching_settings,public.normalized_payment_transactions,public.payment_match_jobs,public.payment_match_candidates,public.payment_match_candidate_events,public.payment_match_allocations,public.payment_matching_idempotency_keys from anon;
grant select on public.payment_matching_settings,public.normalized_payment_transactions,public.payment_match_jobs,public.payment_match_candidates,public.payment_match_candidate_events,public.payment_match_allocations to authenticated;
grant all on public.payment_matching_settings,public.normalized_payment_transactions,public.payment_match_jobs,public.payment_match_candidates,public.payment_match_candidate_events,public.payment_match_allocations,public.payment_matching_idempotency_keys to service_role;
revoke all on function public.payment_matching_import_transactions(uuid,uuid,jsonb,text,text) from public,anon,authenticated;
revoke all on function public.payment_matching_store_job(uuid,uuid,uuid,text,jsonb,text,jsonb,text,text) from public,anon,authenticated;
revoke all on function public.payment_matching_review_candidate(uuid,uuid,uuid,text,uuid,jsonb,boolean,text,text,text) from public,anon,authenticated;
revoke all on function public.payment_matching_capture_document_outcome() from public,anon,authenticated;
revoke all on function public.payment_matching_capture_public_proof() from public,anon,authenticated;
grant execute on function public.payment_matching_import_transactions(uuid,uuid,jsonb,text,text) to service_role;
grant execute on function public.payment_matching_store_job(uuid,uuid,uuid,text,jsonb,text,jsonb,text,text) to service_role;
grant execute on function public.payment_matching_review_candidate(uuid,uuid,uuid,text,uuid,jsonb,boolean,text,text,text) to service_role;

-- Prompt 17 complex payment operations: tenant-scoped reads, service-only
-- mutation RPCs, and no browser access to idempotency records.
alter table public.payment_operation_settings enable row level security;
alter table public.payment_receipts enable row level security;
alter table public.payment_exchange_rates enable row level security;
alter table public.payment_allocation_approval_requests enable row level security;
alter table public.payment_ledger_journals enable row level security;
alter table public.payment_ledger_entries enable row level security;
alter table public.payment_allocations enable row level security;
alter table public.payment_refunds enable row level security;
alter table public.payment_receipt_reversals enable row level security;
alter table public.accounting_payment_operation_outbox enable row level security;
alter table public.payment_operation_idempotency_keys enable row level security;
drop policy if exists payment_operation_settings_read on public.payment_operation_settings;
drop policy if exists payment_receipts_read on public.payment_receipts;
drop policy if exists payment_exchange_rates_read on public.payment_exchange_rates;
drop policy if exists payment_allocation_approvals_read on public.payment_allocation_approval_requests;
drop policy if exists payment_ledger_journals_read on public.payment_ledger_journals;
drop policy if exists payment_ledger_entries_read on public.payment_ledger_entries;
drop policy if exists payment_allocations_read on public.payment_allocations;
drop policy if exists payment_refunds_read on public.payment_refunds;
drop policy if exists payment_receipt_reversals_read on public.payment_receipt_reversals;
drop policy if exists accounting_payment_outbox_read on public.accounting_payment_operation_outbox;
create policy payment_operation_settings_read on public.payment_operation_settings for select to authenticated using(public.has_business_permission(business_id,'payment.approve'));
create policy payment_receipts_read on public.payment_receipts for select to authenticated using(public.has_business_permission(business_id,'payment.approve') or public.has_business_permission(business_id,'report.read'));
create policy payment_exchange_rates_read on public.payment_exchange_rates for select to authenticated using(public.has_business_permission(business_id,'payment.approve'));
create policy payment_allocation_approvals_read on public.payment_allocation_approval_requests for select to authenticated using(public.has_business_permission(business_id,'payment.approve'));
create policy payment_ledger_journals_read on public.payment_ledger_journals for select to authenticated using(public.has_business_permission(business_id,'payment.approve') or public.has_business_permission(business_id,'report.read'));
create policy payment_ledger_entries_read on public.payment_ledger_entries for select to authenticated using(public.has_business_permission(business_id,'payment.approve') or public.has_business_permission(business_id,'report.read'));
create policy payment_allocations_read on public.payment_allocations for select to authenticated using(public.has_business_permission(business_id,'payment.approve') or public.has_business_permission(business_id,'report.read'));
create policy payment_refunds_read on public.payment_refunds for select to authenticated using(public.has_business_permission(business_id,'payment.approve') or public.has_business_permission(business_id,'report.read'));
create policy payment_receipt_reversals_read on public.payment_receipt_reversals for select to authenticated using(public.has_business_permission(business_id,'payment.approve') or public.has_business_permission(business_id,'report.read'));
create policy accounting_payment_outbox_read on public.accounting_payment_operation_outbox for select to authenticated using(public.has_business_permission(business_id,'payment.approve') or public.has_business_permission(business_id,'report.read'));
revoke all on public.payment_operation_settings,public.payment_receipts,public.payment_exchange_rates,public.payment_allocation_approval_requests,public.payment_ledger_journals,public.payment_ledger_entries,public.payment_allocations,public.payment_refunds,public.payment_receipt_reversals,public.accounting_payment_operation_outbox,public.payment_operation_idempotency_keys from anon;
grant select on public.payment_operation_settings,public.payment_receipts,public.payment_exchange_rates,public.payment_allocation_approval_requests,public.payment_ledger_journals,public.payment_ledger_entries,public.payment_allocations,public.payment_refunds,public.payment_receipt_reversals,public.accounting_payment_operation_outbox to authenticated;
revoke all on public.payment_operation_idempotency_keys from authenticated;
grant all on public.payment_operation_settings,public.payment_receipts,public.payment_exchange_rates,public.payment_allocation_approval_requests,public.payment_ledger_journals,public.payment_ledger_entries,public.payment_allocations,public.payment_refunds,public.payment_receipt_reversals,public.accounting_payment_operation_outbox,public.payment_operation_idempotency_keys to service_role;
grant select on public.payment_receipt_positions to authenticated,service_role;
revoke all on function public.payment_operation_create_journal(uuid,text,text,uuid,text,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.payment_operation_record_receipt(uuid,uuid,text,bigint,text,timestamptz,text,text,text,uuid,text,text,jsonb,text,text) from public,anon,authenticated;
revoke all on function public.payment_operation_allocate(uuid,uuid,uuid,jsonb,text,uuid,text,text) from public,anon,authenticated;
revoke all on function public.payment_operation_reverse_allocation(uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.payment_operation_refund(uuid,uuid,uuid,bigint,text,text,text,text) from public,anon,authenticated;
revoke all on function public.payment_operation_reverse_receipt(uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.payment_operation_decide_approval(uuid,uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.payment_operation_capture_matched_allocation() from public,anon,authenticated;
revoke all on function public.payment_operation_reconciliation(uuid,timestamptz,timestamptz) from public,anon;
grant execute on function public.payment_operation_create_journal(uuid,text,text,uuid,text,jsonb,uuid) to service_role;
grant execute on function public.payment_operation_record_receipt(uuid,uuid,text,bigint,text,timestamptz,text,text,text,uuid,text,text,jsonb,text,text) to service_role;
grant execute on function public.payment_operation_allocate(uuid,uuid,uuid,jsonb,text,uuid,text,text) to service_role;
grant execute on function public.payment_operation_reverse_allocation(uuid,uuid,uuid,text,text,text) to service_role;
grant execute on function public.payment_operation_refund(uuid,uuid,uuid,bigint,text,text,text,text) to service_role;
grant execute on function public.payment_operation_reverse_receipt(uuid,uuid,uuid,text,text,text) to service_role;
grant execute on function public.payment_operation_decide_approval(uuid,uuid,uuid,text,text) to service_role;
grant execute on function public.payment_operation_reconciliation(uuid,timestamptz,timestamptz) to authenticated,service_role;

-- Prompt 18 debt truth history is tenant-readable and service-mutated only.
alter table public.debt_ledger_events enable row level security;
alter table public.debt_balance_versions enable row level security;
alter table public.debt_ledger_reconciliation_exceptions enable row level security;
create policy debt_ledger_events_tenant_read on public.debt_ledger_events for select to authenticated using(public.has_business_permission(business_id,'case.read'));
create policy debt_balance_versions_tenant_read on public.debt_balance_versions for select to authenticated using(public.has_business_permission(business_id,'case.read'));
create policy debt_reconciliation_exceptions_audit_read on public.debt_ledger_reconciliation_exceptions for select to authenticated using(public.has_business_permission(business_id,'audit.read'));
revoke all on public.debt_ledger_events,public.debt_balance_versions,public.debt_ledger_reconciliation_exceptions from anon;
grant select on public.debt_ledger_events,public.debt_balance_versions,public.debt_ledger_reconciliation_exceptions to authenticated;
grant all on public.debt_ledger_events,public.debt_balance_versions,public.debt_ledger_reconciliation_exceptions to service_role;
revoke all on public.debt_balance_versions_api,public.debt_ledger_events_api from anon;
grant select on public.debt_balance_versions_api,public.debt_ledger_events_api to authenticated,service_role;
revoke all on function public.debt_truth_recalculate_case(text) from public,anon,authenticated;
revoke all on function public.debt_truth_sync_obligation(text,uuid) from public,anon,authenticated;
revoke all on function public.debt_truth_component_events(text,text[]) from public,anon,authenticated;
grant execute on function public.debt_truth_recalculate_case(text) to service_role;
grant execute on function public.debt_truth_sync_obligation(text,uuid) to service_role;
grant execute on function public.debt_truth_component_events(text,text[]) to service_role;

-- Prompt 19 discrepancy findings are tenant-readable and can only be mutated
-- through permission-checked review RPCs.
alter table public.discrepancy_findings enable row level security;
alter table public.discrepancy_finding_events enable row level security;
create policy discrepancy_findings_tenant_read on public.discrepancy_findings for select to authenticated using(public.has_business_permission(business_id,'case.read'));
create policy discrepancy_finding_events_tenant_read on public.discrepancy_finding_events for select to authenticated using(public.has_business_permission(business_id,'case.read'));
revoke all on public.discrepancy_findings,public.discrepancy_finding_events from anon;
grant select on public.discrepancy_findings,public.discrepancy_finding_events to authenticated;
grant all on public.discrepancy_findings,public.discrepancy_finding_events to service_role;
revoke all on function public.discrepancy_record_scan(uuid,text,uuid,text,jsonb) from public,anon;
revoke all on function public.discrepancy_transition(uuid,uuid,uuid,text,text,timestamptz,jsonb) from public,anon;
revoke all on function public.discrepancy_refresh_projection(text) from public,anon,authenticated;
grant execute on function public.discrepancy_record_scan(uuid,text,uuid,text,jsonb) to authenticated,service_role;
grant execute on function public.discrepancy_transition(uuid,uuid,uuid,text,text,timestamptz,jsonb) to authenticated,service_role;
grant execute on function public.discrepancy_refresh_projection(text) to service_role;

-- Prompt 21: public capabilities carry an immutable tenant scope; shared abuse
-- buckets and audit hashes are service-only; sensitive storage reads go through
-- application routes that re-check permission or capability state per request.
alter table public.public_access_tokens
  add column if not exists business_id uuid references public.businesses(id) on delete restrict;
alter table public.security_rate_limit_buckets enable row level security;
revoke all on table public.security_rate_limit_buckets from public,anon,authenticated;
grant all on table public.security_rate_limit_buckets to service_role;
revoke all on function public.security_rate_limit_consume(text,text,integer,integer,integer) from public,anon,authenticated;
grant execute on function public.security_rate_limit_consume(text,text,integer,integer,integer) to service_role;
revoke all on function public.public_rotate_access_token(uuid,text,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.public_rotate_access_token(uuid,text,uuid,timestamptz) to service_role;
drop policy if exists "evidence_files_owner_read" on storage.objects;
drop policy if exists "evidence_files_owner_select" on storage.objects;
drop policy if exists "payment_proofs_owner_read" on storage.objects;
-- Prompt 20 compliance policy, decision and sensitive-hold records are tenant
-- readable and server-mutated only. Production enforcement is defined in the
-- reversible 20260910 migration.
alter table compliance_policy_versions enable row level security;
alter table compliance_policy_checks enable row level security;
alter table compliance_case_holds enable row level security;
drop policy if exists compliance_policy_versions_tenant_read on compliance_policy_versions;
create policy compliance_policy_versions_tenant_read on compliance_policy_versions for select to authenticated
  using(scope_business_id is null or public.has_business_permission(scope_business_id,'case.read'));
drop policy if exists compliance_policy_checks_tenant_read on compliance_policy_checks;
create policy compliance_policy_checks_tenant_read on compliance_policy_checks for select to authenticated
  using(public.has_business_permission(business_id,'case.read'));
drop policy if exists compliance_case_holds_tenant_read on compliance_case_holds;
create policy compliance_case_holds_tenant_read on compliance_case_holds for select to authenticated
  using(public.has_business_permission(business_id,'case.read'));
revoke insert,update,delete on compliance_policy_versions,compliance_policy_checks,compliance_case_holds from authenticated;
grant select on compliance_policy_versions,compliance_policy_checks,compliance_case_holds to authenticated;
grant all on compliance_policy_versions,compliance_policy_checks,compliance_case_holds to service_role;

-- Prompt 22: integration jobs/health/suppressions are tenant-readable for an
-- explicit operational purpose and service-mutated only.
alter table public.integration_jobs enable row level security;
alter table public.integration_health enable row level security;
alter table public.email_suppressions enable row level security;
drop policy if exists integration_jobs_tenant_read on public.integration_jobs;
create policy integration_jobs_tenant_read on public.integration_jobs for select to authenticated
  using(business_id is not null and public.has_business_permission(business_id,'settings.sensitive.manage'));
drop policy if exists integration_health_tenant_read on public.integration_health;
create policy integration_health_tenant_read on public.integration_health for select to authenticated
  using(public.has_business_permission(business_id,'settings.sensitive.manage'));
drop policy if exists email_suppressions_tenant_read on public.email_suppressions;
create policy email_suppressions_tenant_read on public.email_suppressions for select to authenticated
  using(public.has_business_permission(business_id,'communication.manage'));
revoke all on public.integration_jobs,public.integration_health,public.email_suppressions from anon;
revoke insert,update,delete on public.integration_jobs,public.integration_health,public.email_suppressions from authenticated;
grant select on public.integration_jobs,public.integration_health,public.email_suppressions to authenticated;
grant all on public.integration_jobs,public.integration_health,public.email_suppressions to service_role;
revoke all on function public.integration_claim_jobs(integer) from public,anon,authenticated;
revoke all on function public.integration_finish_job(uuid,boolean,text,text) from public,anon,authenticated;
revoke all on function public.integration_replay_job(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.billing_claim_event(text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.integration_claim_jobs(integer) to service_role;
grant execute on function public.integration_finish_job(uuid,boolean,text,text) to service_role;
grant execute on function public.integration_replay_job(uuid,uuid,uuid) to service_role;
grant execute on function public.billing_claim_event(text,text,timestamptz) to service_role;
revoke all on function public.billing_apply_subscription_state(uuid,text,text,text,text,text,timestamptz,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.billing_apply_subscription_state(uuid,text,text,text,text,text,timestamptz,timestamptz,boolean) to service_role;

-- Pocket product ownership is tenant-readable and service-mutated only.
alter table public.workspace_product_states enable row level security;
alter table public.workspace_product_state_events enable row level security;
drop policy if exists workspace_product_states_tenant_read on public.workspace_product_states;
create policy workspace_product_states_tenant_read on public.workspace_product_states for select to authenticated
  using(public.has_business_permission(business_id,'case.read'));
drop policy if exists workspace_product_state_events_tenant_read on public.workspace_product_state_events;
create policy workspace_product_state_events_tenant_read on public.workspace_product_state_events for select to authenticated
  using(public.has_business_permission(business_id,'case.read'));
revoke all on public.workspace_product_states,public.workspace_product_state_events from anon;
revoke insert,update,delete on public.workspace_product_states,public.workspace_product_state_events from authenticated;
grant select on public.workspace_product_states,public.workspace_product_state_events to authenticated;
grant all on public.workspace_product_states,public.workspace_product_state_events to service_role;
revoke all on function public.my_workspace_context() from public,anon;
grant execute on function public.my_workspace_context() to authenticated,service_role;

-- Pocket commercial records are server-only. Clients receive a redacted DTO
-- from /api/pocket/entitlements and never provider identifiers or raw ledgers.
alter table public.commercial_offers enable row level security;
alter table public.workspace_commercial_states enable row level security;
alter table public.workspace_subscription_items enable row level security;
alter table public.workspace_cycle_purchases enable row level security;
alter table public.workspace_usage_counters enable row level security;
alter table public.workspace_usage_events enable row level security;
alter table public.workspace_checkout_reservations enable row level security;
alter table public.pocket_active_debt_counters enable row level security;
revoke all on public.commercial_offers,public.workspace_commercial_states,public.workspace_subscription_items,
  public.workspace_cycle_purchases,public.workspace_usage_counters,public.workspace_usage_events,
  public.workspace_checkout_reservations,public.pocket_active_debt_counters from public,anon,authenticated;
grant all on public.commercial_offers,public.workspace_commercial_states,public.workspace_subscription_items,
  public.workspace_cycle_purchases,public.workspace_usage_counters,public.workspace_usage_events,
  public.workspace_checkout_reservations,public.pocket_active_debt_counters to service_role;
revoke all on function public.pocket_authorize_capability(uuid,uuid,text,text,boolean) from public,anon,authenticated;
revoke all on function public.pocket_get_entitlements(uuid) from public,anon,authenticated;
revoke all on function public.pocket_apply_subscription_state(uuid,text,text,timestamptz,jsonb) from public,anon,authenticated;
revoke all on function public.pocket_refresh_lifecycle_states(timestamptz) from public,anon,authenticated;
revoke all on function public.pocket_reserve_checkout(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.pocket_attach_checkout_session(uuid,text) from public,anon,authenticated;
revoke all on function public.pocket_record_cycle_pack(uuid,uuid,text,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.pocket_commit_invoice_usage(uuid,uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.pocket_actor_belongs_to_business(uuid,uuid) from public,anon,authenticated;
revoke all on function public.pocket_is_workspace(uuid) from public,anon,authenticated;
revoke all on function public.pocket_capability_limit(uuid,text,timestamptz,timestamptz) from public,anon,authenticated;
revoke all on function public.pocket_authorize_capability_internal(uuid,uuid,text,text,boolean,jsonb) from public,anon,authenticated;
revoke all on function public.pocket_extraction_usage_guard() from public,anon,authenticated;
revoke all on function public.pocket_obligation_is_active(public.obligations) from public,anon,authenticated;
revoke all on function public.pocket_active_debt_guard() from public,anon,authenticated;
revoke all on function public.pocket_active_user_guard() from public,anon,authenticated;
grant execute on function public.pocket_authorize_capability(uuid,uuid,text,text,boolean) to service_role;
grant execute on function public.pocket_get_entitlements(uuid) to service_role;
grant execute on function public.pocket_apply_subscription_state(uuid,text,text,timestamptz,jsonb) to service_role;
grant execute on function public.pocket_refresh_lifecycle_states(timestamptz) to service_role;
grant execute on function public.pocket_reserve_checkout(uuid,uuid,text,text) to service_role;
grant execute on function public.pocket_attach_checkout_session(uuid,text) to service_role;
grant execute on function public.pocket_record_cycle_pack(uuid,uuid,text,text,text,timestamptz) to service_role;
grant execute on function public.pocket_commit_invoice_usage(uuid,uuid,uuid,text,text) to service_role;

-- Prompt 6: Pocket receipt-to-payment provenance is append-only. Authenticated
-- users can read only when both document and Pocket debt access are authorised;
-- all writes and the atomic confirmation RPC remain service-only.
alter table public.pocket_receipt_payment_links enable row level security;
drop policy if exists pocket_receipt_payment_links_read on public.pocket_receipt_payment_links;
create policy pocket_receipt_payment_links_read on public.pocket_receipt_payment_links
for select to authenticated using (
  public.has_business_permission(business_id,'document_intake.read')
  and public.has_business_permission(business_id,'case.read')
);
revoke all on public.pocket_receipt_payment_links from public,anon,authenticated;
grant select on public.pocket_receipt_payment_links to authenticated;
grant all on public.pocket_receipt_payment_links to service_role;
revoke all on function public.pocket_confirm_receipt_payment(uuid,uuid,uuid,uuid,bigint,text,text,boolean,text,text)
  from public,anon,authenticated;
grant execute on function public.pocket_confirm_receipt_payment(uuid,uuid,uuid,uuid,bigint,text,text,boolean,text,text)
  to service_role;

-- Prompt 7: Pocket reminder projections are tenant-readable and service-written.
alter table public.pocket_reminder_preferences enable row level security;
alter table public.pocket_reminder_schedules enable row level security;
alter table public.pocket_reminder_events enable row level security;
drop policy if exists pocket_reminder_preferences_tenant_read on public.pocket_reminder_preferences;
create policy pocket_reminder_preferences_tenant_read on public.pocket_reminder_preferences
for select to authenticated using (business_id=public.my_business_id());
drop policy if exists pocket_reminder_schedules_tenant_read on public.pocket_reminder_schedules;
create policy pocket_reminder_schedules_tenant_read on public.pocket_reminder_schedules
for select to authenticated using (business_id=public.my_business_id());
drop policy if exists pocket_reminder_events_tenant_read on public.pocket_reminder_events;
create policy pocket_reminder_events_tenant_read on public.pocket_reminder_events
for select to authenticated using (business_id=public.my_business_id());
revoke all on public.pocket_reminder_preferences,public.pocket_reminder_schedules,public.pocket_reminder_events
  from public,anon,authenticated;
grant select on public.pocket_reminder_preferences,public.pocket_reminder_schedules,public.pocket_reminder_events
  to authenticated;
grant all on public.pocket_reminder_preferences,public.pocket_reminder_schedules,public.pocket_reminder_events
  to service_role;
revoke all on function public.pocket_reminder_validate_scope() from public,anon,authenticated;
revoke all on function public.pocket_cancel_stale_reminder_schedules() from public,anon,authenticated;
revoke all on function public.pocket_cancel_reminders_on_contact_change() from public,anon,authenticated;

-- Prompt 8: invoice records are tenant-readable for retained history and all
-- writes remain server-authoritative. Storage objects have no direct policy.
alter table public.pocket_invoice_sequences enable row level security;
alter table public.pocket_simple_invoices enable row level security;
alter table public.pocket_simple_invoice_items enable row level security;
alter table public.pocket_simple_invoice_events enable row level security;
drop policy if exists pocket_simple_invoices_tenant_read on public.pocket_simple_invoices;
create policy pocket_simple_invoices_tenant_read on public.pocket_simple_invoices
for select to authenticated using (business_id=public.my_business_id());
drop policy if exists pocket_simple_invoice_items_tenant_read on public.pocket_simple_invoice_items;
create policy pocket_simple_invoice_items_tenant_read on public.pocket_simple_invoice_items
for select to authenticated using (business_id=public.my_business_id());
drop policy if exists pocket_simple_invoice_events_tenant_read on public.pocket_simple_invoice_events;
create policy pocket_simple_invoice_events_tenant_read on public.pocket_simple_invoice_events
for select to authenticated using (business_id=public.my_business_id());
revoke all on public.pocket_invoice_sequences,public.pocket_simple_invoices,public.pocket_simple_invoice_items,public.pocket_simple_invoice_events
from public,anon,authenticated;
grant select on public.pocket_simple_invoices,public.pocket_simple_invoice_items,public.pocket_simple_invoice_events to authenticated;
grant select,insert,update on public.pocket_invoice_sequences,public.pocket_simple_invoices,public.pocket_simple_invoice_items to service_role;
grant select,insert on public.pocket_simple_invoice_events to service_role;
revoke all on function public.pocket_save_simple_invoice_draft(uuid,uuid,uuid,integer,jsonb,jsonb,text) from public,anon,authenticated;
revoke all on function public.pocket_issue_simple_invoice(uuid,uuid,uuid,integer,text) from public,anon,authenticated;
revoke all on function public.pocket_convert_invoice_to_debt(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.pocket_save_simple_invoice_draft(uuid,uuid,uuid,integer,jsonb,jsonb,text) to service_role;
grant execute on function public.pocket_issue_simple_invoice(uuid,uuid,uuid,integer,text) to service_role;
grant execute on function public.pocket_convert_invoice_to_debt(uuid,uuid,uuid,text) to service_role;

-- Prompt 10: migration provenance is owner-readable and service-written.
alter table public.pocket_solo_upgrade_runs enable row level security;
alter table public.pocket_solo_upgrade_items enable row level security;
drop policy if exists pocket_solo_upgrade_runs_owner_read on public.pocket_solo_upgrade_runs;
create policy pocket_solo_upgrade_runs_owner_read on public.pocket_solo_upgrade_runs
for select to authenticated using (public.has_business_permission(business_id,'billing.manage'));
drop policy if exists pocket_solo_upgrade_items_owner_read on public.pocket_solo_upgrade_items;
create policy pocket_solo_upgrade_items_owner_read on public.pocket_solo_upgrade_items
for select to authenticated using (public.has_business_permission(business_id,'billing.manage'));
revoke all on public.pocket_solo_upgrade_runs,public.pocket_solo_upgrade_items from public,anon,authenticated;
grant select on public.pocket_solo_upgrade_runs,public.pocket_solo_upgrade_items to authenticated;
grant all on public.pocket_solo_upgrade_runs,public.pocket_solo_upgrade_items to service_role;
revoke all on function public.pocket_prepare_solo_upgrade(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.pocket_attach_solo_upgrade_checkout(uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.pocket_commit_solo_upgrade(uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.pocket_mark_solo_upgrade_cleanup(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.pocket_prepare_solo_upgrade(uuid,uuid,text,text) to service_role;
grant execute on function public.pocket_attach_solo_upgrade_checkout(uuid,uuid,uuid,text) to service_role;
grant execute on function public.pocket_commit_solo_upgrade(uuid,uuid,uuid,text) to service_role;
grant execute on function public.pocket_mark_solo_upgrade_cleanup(uuid,uuid,text,text) to service_role;
