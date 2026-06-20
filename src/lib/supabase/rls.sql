-- ============================================================
-- CollectBoss — Row Level Security Policies
-- Run AFTER schema.sql in your Supabase SQL editor
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
create or replace function owns_case(p_case_id uuid)
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

-- No delete (soft-delete in future)

-- ════════════════════════════════════════════════════════════
-- 2. cases
-- ════════════════════════════════════════════════════════════
alter table cases enable row level security;

create policy "cases: owner read"
  on cases for select
  using (
    business_id = my_business_id()
  );

create policy "cases: owner insert"
  on cases for insert
  with check (
    business_id = my_business_id()
  );

create policy "cases: owner update"
  on cases for update
  using (business_id = my_business_id())
  with check (business_id = my_business_id());

-- No delete policy — cases should never be deleted, only archived

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

create policy "payments: owner insert"
  on payments for insert
  with check (owns_case(case_id));

create policy "payments: owner update"
  on payments for update
  using (owns_case(case_id));

-- ════════════════════════════════════════════════════════════
-- 8. legal_documents
-- ════════════════════════════════════════════════════════════
alter table legal_documents enable row level security;

create policy "legal_documents: owner read"
  on legal_documents for select
  using (owns_case(case_id));

create policy "legal_documents: owner insert"
  on legal_documents for insert
  with check (owns_case(case_id));

create policy "legal_documents: owner update"
  on legal_documents for update
  using (owns_case(case_id));

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
--   Allow authenticated users to upload to path: {business_id}/{case_id}/*
--   Allow authenticated users to read their own business's files
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
