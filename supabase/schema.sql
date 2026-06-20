-- ═══════════════════════════════════════════════════════════════════════════
-- CollectBoss — Supabase Schema & Row-Level Security Policies
-- Run this in the Supabase SQL Editor before deploying.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Enable UUID extension ────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ─── 1. businesses ───────────────────────────────────────────────────────────
create table if not exists businesses (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null references auth.users(id) on delete cascade,
  business_name    text not null,
  registration_no  text,
  phone            text,
  email            text,
  address          text,
  created_at       timestamptz default now()
);

alter table businesses enable row level security;

create policy "owners can manage own business"
  on businesses for all
  using (owner_id = auth.uid());

-- ─── 2. cases ────────────────────────────────────────────────────────────────
create table if not exists cases (
  id                 text primary key,
  business_id        uuid not null references businesses(id) on delete cascade,
  debtor_name        text not null,
  debtor_phone       text,
  debtor_email       text,
  debtor_company     text,
  debtor_reg_no      text,
  debtor_location    text,
  amount_owed        numeric(12,2) not null default 0,
  amount_paid        numeric(12,2) not null default 0,
  balance            numeric(12,2) generated always as (amount_owed - amount_paid) stored,
  due_date           date not null,
  invoice_no         text,
  status             text not null default 'action_needed',
  next_best_action   text,
  payment_lock_mode  text not null default 'approval',
  days_overdue       integer not null default 0,
  notes              text,
  bank               text,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

alter table cases enable row level security;

create policy "owners can manage own cases"
  on cases for all
  using (
    business_id in (
      select id from businesses where owner_id = auth.uid()
    )
  );

-- ─── 3. evidence_files ───────────────────────────────────────────────────────
create table if not exists evidence_files (
  id               uuid primary key default gen_random_uuid(),
  case_id          text not null references cases(id) on delete cascade,
  file_name        text not null,
  file_type        text not null,
  file_url         text,
  file_size_bytes  integer,
  evidence_type    text not null,
  uploaded_at      timestamptz default now()
);

alter table evidence_files enable row level security;

create policy "owners can manage own evidence"
  on evidence_files for all
  using (
    case_id in (
      select id from cases where business_id in (
        select id from businesses where owner_id = auth.uid()
      )
    )
  );

-- ─── 4. reminders ────────────────────────────────────────────────────────────
create table if not exists reminders (
  id              uuid primary key default gen_random_uuid(),
  case_id         text not null references cases(id) on delete cascade,
  message_type    text not null,
  message_body    text not null,
  sent_channel    text not null,
  sent_at         timestamptz default now(),
  status          text not null default 'draft',
  error_message   text
);

alter table reminders enable row level security;

create policy "owners can manage own reminders"
  on reminders for all
  using (
    case_id in (
      select id from cases where business_id in (
        select id from businesses where owner_id = auth.uid()
      )
    )
  );

-- ─── 5. receiving_accounts ───────────────────────────────────────────────────
create table if not exists receiving_accounts (
  id                    uuid primary key default gen_random_uuid(),
  business_id           uuid not null references businesses(id) on delete cascade,
  bank_name             text not null,
  account_holder_name   text not null,
  account_number        text not null,
  duitnow_id            text,
  duitnow_qr_url        text,
  include_in_reminders  boolean not null default true,
  is_primary            boolean not null default false,
  created_at            timestamptz default now()
);

alter table receiving_accounts enable row level security;

create policy "owners can manage own accounts"
  on receiving_accounts for all
  using (
    business_id in (
      select id from businesses where owner_id = auth.uid()
    )
  );

-- ─── 6. payment_access_requests ──────────────────────────────────────────────
create table if not exists payment_access_requests (
  id               uuid primary key default gen_random_uuid(),
  case_id          text not null references cases(id) on delete cascade,
  requester_name   text not null,
  requester_phone  text not null,
  otp_verified     boolean not null default false,
  preferred_method text,
  reason           text,
  status           text not null default 'pending',
  access_type      text,
  approved_at      timestamptz,
  expires_at       timestamptz,
  created_at       timestamptz default now()
);

alter table payment_access_requests enable row level security;

create policy "owners can manage own access requests"
  on payment_access_requests for all
  using (
    case_id in (
      select id from cases where business_id in (
        select id from businesses where owner_id = auth.uid()
      )
    )
  );

-- Debtors can INSERT (request access) — no auth required for insert only
create policy "debtors can request access"
  on payment_access_requests for insert
  with check (true);

-- ─── 7. payments ─────────────────────────────────────────────────────────────
create table if not exists payments (
  id              uuid primary key default gen_random_uuid(),
  case_id         text not null references cases(id) on delete cascade,
  amount          numeric(12,2) not null,
  payment_method  text not null,
  reference_no    text,
  proof_url       text,
  review_status   text not null default 'pending_review',
  reviewed_at     timestamptz,
  reviewed_by     uuid references auth.users(id),
  notes           text,
  created_at      timestamptz default now()
);

alter table payments enable row level security;

create policy "owners can manage own payments"
  on payments for all
  using (
    case_id in (
      select id from cases where business_id in (
        select id from businesses where owner_id = auth.uid()
      )
    )
  );

-- Debtors can INSERT proof submissions (no auth, limited data)
create policy "debtors can submit payment proofs"
  on payments for insert
  with check (review_status = 'pending_review');

-- ─── 8. legal_documents ──────────────────────────────────────────────────────
create table if not exists legal_documents (
  id             uuid primary key default gen_random_uuid(),
  case_id        text not null references cases(id) on delete cascade,
  document_type  text not null,
  title          text not null,
  content        text not null,
  status         text not null default 'draft',
  sent_at        timestamptz,
  created_at     timestamptz default now()
);

alter table legal_documents enable row level security;

create policy "owners can manage own legal documents"
  on legal_documents for all
  using (
    case_id in (
      select id from cases where business_id in (
        select id from businesses where owner_id = auth.uid()
      )
    )
  );

-- ─── 9. audit_logs ───────────────────────────────────────────────────────────
create table if not exists audit_logs (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  case_id      text references cases(id) on delete set null,
  action       text not null,
  actor_type   text not null,
  actor_id     uuid references auth.users(id),
  metadata     jsonb,
  created_at   timestamptz default now()
);

alter table audit_logs enable row level security;

create policy "owners can read own audit logs"
  on audit_logs for select
  using (
    business_id in (
      select id from businesses where owner_id = auth.uid()
    )
  );

-- Append-only: anyone can insert (system inserts from client)
create policy "anyone can insert audit logs"
  on audit_logs for insert
  with check (true);

-- ─── 10. payment_plans ───────────────────────────────────────────────────────
create table if not exists payment_plans (
  id                  uuid primary key default gen_random_uuid(),
  case_id             text not null references cases(id) on delete cascade,
  total_amount        numeric(12,2) not null,
  installment_count   integer not null,
  installment_amount  numeric(12,2) not null,
  start_date          date not null,
  due_dates           jsonb not null default '[]',
  status              text not null default 'active',
  debtor_confirmed    boolean not null default false,
  debtor_name         text,
  debtor_phone        text,
  signature_url       text,
  confirmed_at        timestamptz,
  notes               text,
  created_at          timestamptz default now()
);

alter table payment_plans enable row level security;

create policy "owners can manage own payment plans"
  on payment_plans for all
  using (
    case_id in (
      select id from cases where business_id in (
        select id from businesses where owner_id = auth.uid()
      )
    )
  );

-- Debtors can read and confirm plans (via /acknowledge route — limited fields)
create policy "debtors can read and confirm payment plans"
  on payment_plans for select
  using (true);

create policy "debtors can confirm payment plans"
  on payment_plans for update
  using (true)
  with check (
    debtor_confirmed = true
  );

-- ─── 11. lawyer_referrals ─────────────────────────────────────────────────────
create table if not exists lawyer_referrals (
  id                       uuid primary key default gen_random_uuid(),
  case_id                  text not null references cases(id) on delete cascade,
  business_id              uuid not null references businesses(id) on delete cascade,
  referral_status          text not null default 'submitted',
  partner_id               text,
  partner_name             text,
  partner_firm             text,
  preferred_contact_method text not null default 'whatsapp',
  case_summary             text,
  evidence_pack_id         uuid,
  formal_demand_id         uuid,
  notes                    text,
  created_at               timestamptz default now(),
  updated_at               timestamptz default now()
);

alter table lawyer_referrals enable row level security;

create policy "owners can manage own referrals"
  on lawyer_referrals for all
  using (
    business_id in (
      select id from businesses where owner_id = auth.uid()
    )
  );

-- ─── Storage buckets ──────────────────────────────────────────────────────────
-- Create in Supabase Storage dashboard:
-- 1. "evidence-files"   — private bucket, authenticated access only
-- 2. "payment-proofs"  — private bucket, authenticated access only

-- Evidence files: path = {business_id}/{case_id}/{filename}
-- Storage RLS (set in Supabase dashboard):
--   SELECT: auth.uid() matches business owner
--   INSERT: auth.uid() matches business owner
--   DELETE: auth.uid() matches business owner

-- ─── Indexes ─────────────────────────────────────────────────────────────────
create index if not exists idx_cases_business_id    on cases(business_id);
create index if not exists idx_cases_status         on cases(status);
create index if not exists idx_evidence_case_id     on evidence_files(case_id);
create index if not exists idx_reminders_case_id    on reminders(case_id);
create index if not exists idx_payments_case_id     on payments(case_id);
create index if not exists idx_payments_review      on payments(review_status);
create index if not exists idx_audit_logs_business  on audit_logs(business_id);
create index if not exists idx_audit_logs_case      on audit_logs(case_id);
create index if not exists idx_payment_plans_case   on payment_plans(case_id);
create index if not exists idx_referrals_business   on lawyer_referrals(business_id);
create index if not exists idx_legal_docs_case      on legal_documents(case_id);
