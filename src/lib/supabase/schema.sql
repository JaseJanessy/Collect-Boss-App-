-- ============================================================
-- CollectBoss Database Schema
-- Run this in your Supabase SQL editor (Dashboard → SQL)
-- ============================================================

-- ─── Extensions ──────────────────────────────────────────────
create extension if not exists "pgcrypto";

-- ─── Enums ───────────────────────────────────────────────────
create type case_status as enum (
  'action_needed',
  'payment_promise',
  'partial_paid',
  'paid',
  'overdue',
  'formal_demand_ready'
);

create type payment_lock_mode as enum (
  'immediate',
  'approval',
  'manual'
);

create type access_request_status as enum (
  'pending',
  'approved',
  'rejected'
);

create type access_type as enum (
  'once',
  '24h',
  'manual'
);

create type reminder_status as enum (
  'sent',
  'failed',
  'pending',
  'draft',
  'copied',
  'sent_manually',
  'follow_up_needed'
);

create type reminder_channel as enum (
  'whatsapp',
  'email',
  'sms'
);

create type payment_method as enum (
  'duitnow_qr',
  'bank_transfer',
  'cash',
  'cheque',
  'tng_ewallet'
);

create type payment_review_status as enum (
  'pending_review',
  'approved',
  'rejected'
);

create type evidence_type as enum (
  'invoice',
  'whatsapp',
  'payment_proof',
  'contract',
  'delivery_order',
  'notes',
  'other'
);

create type legal_doc_type as enum (
  'demand_standard',
  'demand_firm',
  'demand_final',
  'acknowledgement',
  'payment_plan',
  'small_claim_pack'
);

create type legal_doc_status as enum (
  'draft',
  'finalised',
  'sent',
  'archived'
);

create type actor_type as enum (
  'owner',
  'system',
  'debtor'
);

-- ─── Shared trigger: updated_at ───────────────────────────────
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ─── 1. businesses ───────────────────────────────────────────
create table if not exists businesses (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null references auth.users(id) on delete cascade,
  business_name    text not null,
  registration_no  text,
  phone            text,
  email            text,
  address          text,
  created_at       timestamptz not null default now()
);

create index if not exists businesses_owner_id_idx on businesses(owner_id);

-- ─── 2. cases ────────────────────────────────────────────────
create table if not exists cases (
  id                 uuid primary key default gen_random_uuid(),
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
  status             case_status not null default 'action_needed',
  next_best_action   text,
  payment_lock_mode  payment_lock_mode not null default 'approval',
  days_overdue       integer generated always as (
                       greatest(0, (current_date - due_date)::integer)
                     ) stored,
  notes              text,
  bank               text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists cases_business_id_idx   on cases(business_id);
create index if not exists cases_status_idx        on cases(status);
create index if not exists cases_due_date_idx      on cases(due_date);

create trigger cases_updated_at
  before update on cases
  for each row execute function set_updated_at();

-- ─── 3. evidence_files ───────────────────────────────────────
create table if not exists evidence_files (
  id               uuid primary key default gen_random_uuid(),
  case_id          uuid not null references cases(id) on delete cascade,
  file_name        text not null,
  file_type        text not null,
  file_url         text,
  file_size_bytes  bigint,
  evidence_type    evidence_type not null default 'other',
  uploaded_at      timestamptz not null default now()
);

create index if not exists evidence_files_case_id_idx on evidence_files(case_id);

-- ─── 4. reminders ────────────────────────────────────────────
create table if not exists reminders (
  id             uuid primary key default gen_random_uuid(),
  case_id        uuid not null references cases(id) on delete cascade,
  message_type   text not null,
  message_body   text not null,
  sent_channel   reminder_channel not null,
  sent_at        timestamptz not null default now(),
  status         reminder_status not null default 'pending',
  error_message  text
);

create index if not exists reminders_case_id_idx on reminders(case_id);
create index if not exists reminders_sent_at_idx on reminders(sent_at desc);

-- ─── 5. payment_access_requests ──────────────────────────────
create table if not exists payment_access_requests (
  id                uuid primary key default gen_random_uuid(),
  case_id           uuid not null references cases(id) on delete cascade,
  requester_name    text not null,
  requester_phone   text not null,
  otp_verified      boolean not null default false,
  preferred_method  text,
  reason            text,
  status            access_request_status not null default 'pending',
  access_type       access_type,
  approved_at       timestamptz,
  expires_at        timestamptz,
  created_at        timestamptz not null default now()
);

create index if not exists par_case_id_idx  on payment_access_requests(case_id);
create index if not exists par_status_idx   on payment_access_requests(status);
create index if not exists par_expires_idx  on payment_access_requests(expires_at);

-- ─── 6. receiving_accounts ───────────────────────────────────
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
  created_at            timestamptz not null default now()
);

create index if not exists receiving_accounts_business_id_idx on receiving_accounts(business_id);

-- Ensure only one primary account per business
create unique index if not exists receiving_accounts_primary_idx
  on receiving_accounts(business_id)
  where is_primary = true;

-- ─── 7. payments ─────────────────────────────────────────────
create table if not exists payments (
  id              uuid primary key default gen_random_uuid(),
  case_id         uuid not null references cases(id) on delete cascade,
  amount          numeric(12,2) not null,
  payment_method  payment_method not null,
  reference_no    text,
  proof_url       text,
  review_status   payment_review_status not null default 'pending_review',
  reviewed_at     timestamptz,
  reviewed_by     uuid references auth.users(id),
  notes           text,
  created_at      timestamptz not null default now()
);

create index if not exists payments_case_id_idx      on payments(case_id);
create index if not exists payments_review_status_idx on payments(review_status);
create index if not exists payments_created_at_idx   on payments(created_at desc);

-- ─── 8. legal_documents ──────────────────────────────────────
create table if not exists legal_documents (
  id             uuid primary key default gen_random_uuid(),
  case_id        uuid not null references cases(id) on delete cascade,
  document_type  legal_doc_type not null,
  title          text not null,
  content        text not null,
  status         legal_doc_status not null default 'draft',
  sent_at        timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists legal_documents_case_id_idx on legal_documents(case_id);
create index if not exists legal_documents_type_idx    on legal_documents(document_type);

-- ─── 9. payment_plans ────────────────────────────────────────
create type if not exists payment_plan_status as enum ('active','completed','cancelled');

create table if not exists payment_plans (
  id                  uuid primary key default gen_random_uuid(),
  case_id             uuid not null references cases(id) on delete cascade,
  total_amount        numeric(12,2) not null,
  installment_count   integer not null,
  installment_amount  numeric(12,2) not null,
  start_date          date not null,
  due_dates           jsonb not null default '[]',
  status              payment_plan_status not null default 'active',
  debtor_confirmed    boolean not null default false,
  debtor_name         text,
  debtor_phone        text,
  signature_url       text,
  confirmed_at        timestamptz,
  notes               text,
  created_at          timestamptz not null default now()
);

create index if not exists payment_plans_case_id_idx on payment_plans(case_id);

-- ─── 10. audit_logs ──────────────────────────────────────────
create table if not exists audit_logs (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  case_id      uuid references cases(id) on delete set null,
  action       text not null,
  actor_type   actor_type not null,
  actor_id     text,
  metadata     jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists audit_logs_business_id_idx on audit_logs(business_id);
create index if not exists audit_logs_case_id_idx     on audit_logs(case_id);
create index if not exists audit_logs_created_at_idx  on audit_logs(created_at desc);

-- ─── Supabase Storage buckets (run separately via Supabase dashboard or API) ──
-- Bucket: evidence-files  (private)
-- Bucket: payment-proofs  (private)
-- Bucket: legal-documents (private)
-- Bucket: duitnow-qr      (private — never public)
