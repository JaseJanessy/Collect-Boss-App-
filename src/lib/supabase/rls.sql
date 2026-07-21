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

create policy "receiving_accounts: owner insert"
  on receiving_accounts for insert
  with check (business_id = my_business_id());

create policy "receiving_accounts: owner update"
  on receiving_accounts for update
  using (business_id = my_business_id())
  with check (business_id = my_business_id());

create policy "receiving_accounts: owner delete"
  on receiving_accounts for delete
  using (business_id = my_business_id());

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
