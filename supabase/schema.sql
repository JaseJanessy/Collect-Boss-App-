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
  account_type     text,
  legal_name       text,
  contact_name     text,
  logo_object_path text,
  phone            text,
  email            text,
  address          text,
  created_at       timestamptz default now()
);

alter table businesses
  add constraint businesses_account_type_check
  check (account_type is null or account_type in ('individual', 'business'));

alter table businesses enable row level security;

create policy "owners can manage own business"
  on businesses for all
  using (owner_id = auth.uid());

create table if not exists debtors (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references businesses(id) on delete cascade,
  debtor_type       text not null,
  individual_name   text,
  business_name     text,
  contact_name      text,
  registration_no   text,
  phone             text,
  email             text,
  address           text,
  archived_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint debtors_type_check check (debtor_type in ('individual', 'business')),
  constraint debtors_identity_check check (
    (debtor_type = 'individual' and nullif(btrim(individual_name), '') is not null)
    or
    (debtor_type = 'business' and nullif(btrim(business_name), '') is not null)
  )
);

alter table debtors enable row level security;

create policy "debtors_owner_manage"
  on debtors for all to authenticated
  using (
    exists (
      select 1 from businesses
      where businesses.id = debtors.business_id and businesses.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from businesses
      where businesses.id = debtors.business_id and businesses.owner_id = auth.uid()
    )
  );

-- ─── 2. cases ────────────────────────────────────────────────────────────────
create table if not exists cases (
  id                 text primary key,
  business_id        uuid not null references businesses(id) on delete cascade,
  debtor_id          uuid references debtors(id) on delete restrict,
  debtor_type        text not null default 'individual'
                   check (debtor_type in ('individual', 'business')),
  debtor_name        text not null,
  debtor_phone       text,
  debtor_email       text,
  debtor_company     text,
  debtor_reg_no      text,
  debtor_location    text,
  amount_owed        numeric(12,2) not null default 0,
  amount_paid        numeric(12,2) not null default 0,
  balance            numeric(12,2) generated always as (amount_owed - amount_paid) stored,
  original_principal_minor bigint not null default 0,
  contractual_due_minor    bigint not null default 0,
  approved_payment_minor   bigint not null default 0,
  outstanding_minor        bigint not null default 0,
  overpayment_minor        bigint not null default 0,
  financial_version        integer not null default 0,
  due_date           date not null,
  invoice_no         text,
  status             text not null default 'action_needed',
  promise_due_date   date,
  closed_at          timestamptz,
  closed_by          uuid references auth.users(id) on delete set null,
  close_reason       text,
  archived_at        timestamptz,
  archived_by        uuid references auth.users(id) on delete set null,
  archive_reason     text,
  status_version     integer not null default 1,
  next_best_action   text,
  payment_lock_mode  text not null default 'approval',
  receiving_account_id uuid,
  days_overdue       integer not null default 0,
  notes              text,
  bank               text,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now(),
  constraint cases_business_debtor_company_check check (
    debtor_type <> 'business' or nullif(btrim(debtor_company), '') is not null
  ),
  constraint cases_status_check check (status in ('action_needed', 'payment_promise', 'partial_paid', 'paid', 'overdue', 'formal_demand_ready', 'closed')),
  constraint cases_promise_due_date_check check (status <> 'payment_promise' or promise_due_date is not null),
  constraint cases_closed_fields_check check (status <> 'closed' or (closed_at is not null and closed_by is not null)),
  constraint cases_financial_nonnegative_check check (
    original_principal_minor >= 0 and contractual_due_minor >= 0 and approved_payment_minor >= 0
    and outstanding_minor >= 0 and overpayment_minor >= 0
  )
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
  uploaded_at      timestamptz default now(),
  object_path      text,
  description      text,
  document_date    date,
  is_internal      boolean not null default true,
  archived_at      timestamptz,
  archived_by      uuid references auth.users(id) on delete set null,
  retention_until  date,
  content_sha256   char(64)
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
  error_message   text,
  template_version smallint not null default 1 check (template_version > 0),
  recipient        text,
  generated_at     timestamptz not null default now(),
  composer_opened_at timestamptz,
  manually_confirmed_at timestamptz,
  next_action_at     timestamptz,
  request_key        uuid not null default gen_random_uuid(),
  unique (case_id, request_key)
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

create policy "reminders: owner update"
  on reminders for update
  using (
    case_id in (
      select id from cases where business_id in (
        select id from businesses where owner_id = auth.uid()
      )
    )
  )
  with check (
    case_id in (
      select id from cases where business_id in (
        select id from businesses where owner_id = auth.uid()
      )
    )
  );

create index if not exists reminders_case_generated_at_idx
  on reminders(case_id, generated_at desc);

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
  created_at            timestamptz default now(),
  updated_at            timestamptz not null default now(),
  version               integer not null default 1
);

alter table receiving_accounts enable row level security;

create policy "owners can manage own accounts"
  on receiving_accounts for all
  using (
    business_id in (
      select id from businesses where owner_id = auth.uid()
    )
  );

create unique index if not exists receiving_accounts_one_primary_per_business
  on receiving_accounts (business_id) where is_primary;

alter table cases
  add constraint cases_receiving_account_id_fkey
  foreign key (receiving_account_id) references receiving_accounts(id) on delete set null;

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

create table if not exists payment_access_events (
  id uuid primary key default gen_random_uuid(),
  case_id text not null references cases(id) on delete cascade,
  receiving_account_id uuid references receiving_accounts(id) on delete set null,
  payment_access_request_id uuid references payment_access_requests(id) on delete set null,
  public_access_token_id uuid,
  action text not null,
  actor_id uuid references auth.users(id) on delete set null,
  actor_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table payment_access_events enable row level security;
create policy "payment_access_events_owner_read" on payment_access_events for select to authenticated using (
  exists (select 1 from cases c join businesses b on b.id = c.business_id where c.id = payment_access_events.case_id and b.owner_id = auth.uid())
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

-- Public writes are handled only by token-validated server routes. Do not add
-- an anonymous insert policy to this table.

-- ─── 7. payments ─────────────────────────────────────────────────────────────
create table if not exists case_financial_events (
  id              uuid primary key default gen_random_uuid(),
  case_id         text not null references cases(id) on delete restrict,
  event_type      text not null check (event_type in ('opening_payment_credit', 'payment_approved', 'payment_reversal', 'adjustment_debit', 'adjustment_credit')),
  amount_minor    bigint not null check (amount_minor > 0),
  source_table    text not null,
  source_id       uuid not null,
  idempotency_key uuid not null unique default gen_random_uuid(),
  note            text,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (source_table, source_id, event_type)
);

alter table case_financial_events enable row level security;
create policy "owners can read own financial events"
  on case_financial_events for select
  using (case_id in (select id from cases where business_id in (select id from businesses where owner_id = auth.uid())));

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
  financial_event_id uuid unique references case_financial_events(id) on delete restrict,
  reversed_at     timestamptz,
  reversed_by     uuid references auth.users(id) on delete set null,
  reversal_reason text,
  created_at      timestamptz default now(),
  constraint payments_amount_positive_check check (amount > 0),
  constraint payments_review_status_check check (review_status in ('pending_review', 'approved', 'rejected', 'unmatched', 'reversed'))
);

alter table payments enable row level security;

create policy "owners can read own payments"
  on payments for select
  using (
    case_id in (
      select id from cases where business_id in (
        select id from businesses where owner_id = auth.uid()
      )
    )
  );

-- Public proof submissions are handled only by token-validated server routes.

-- ─── 8. legal_documents ──────────────────────────────────────────────────────
create table if not exists legal_documents (
  id             uuid primary key default gen_random_uuid(),
  case_id        text not null references cases(id) on delete cascade,
  document_type  text not null,
  title          text not null,
  content        text not null,
  status         text not null default 'draft',
  generation_key uuid,
  document_number text,
  template_version smallint not null default 1 check (template_version > 0),
  issued_at timestamptz,
  issued_by uuid references auth.users(id) on delete set null,
  snapshot jsonb,
  sent_at        timestamptz,
  created_at     timestamptz default now()
);

alter table legal_documents enable row level security;

create policy "legal_documents: owner read"
  on legal_documents for select
  using (case_id in (select id from cases where business_id in (select id from businesses where owner_id = auth.uid())));
create policy "legal_documents: owner insert"
  on legal_documents for insert
  with check (case_id in (select id from cases where business_id in (select id from businesses where owner_id = auth.uid())));
create policy "legal_documents: owner update drafts"
  on legal_documents for update
  using (case_id in (select id from cases where business_id in (select id from businesses where owner_id = auth.uid())) and (document_type not in ('demand_standard', 'demand_firm', 'demand_final') or issued_at is null))
  with check (case_id in (select id from cases where business_id in (select id from businesses where owner_id = auth.uid())) and (document_type not in ('demand_standard', 'demand_firm', 'demand_final') or (issued_at is null and status = 'draft')));

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

-- Append-only owner audit writes. Public token actions append through the
-- server-only client after validating the token.
create policy "owners can append own audit logs"
  on audit_logs for insert
  with check (
    business_id in (
      select id from businesses where owner_id = auth.uid()
    )
  );

-- ─── 10. payment_plans ───────────────────────────────────────────────────────
create table if not exists payment_plans (
  id                  uuid primary key default gen_random_uuid(),
  case_id             text not null references cases(id) on delete cascade,
  total_amount        numeric(12,2) not null,
  installment_count   integer not null,
  installment_amount  numeric(12,2) not null,
  start_date          date not null,
  due_dates           jsonb not null default '[]',
  status              text not null default 'pending_acceptance',
  debtor_confirmed    boolean not null default false,
  debtor_name         text,
  debtor_phone        text,
  signature_url       text,
  confirmed_at        timestamptz,
  notes               text,
  frequency           text not null default 'monthly' check (frequency in ('weekly', 'monthly', 'custom')),
  timezone            text not null default 'Asia/Kuala_Lumpur' check (timezone = 'Asia/Kuala_Lumpur'),
  terms_version       integer not null default 1 check (terms_version > 0),
  terms_snapshot      jsonb not null default '{}'::jsonb,
  accepted_at         timestamptz,
  rejected_at         timestamptz,
  rejection_reason    text,
  grace_days          integer not null default 0 check (grace_days between 0 and 31),
  created_at          timestamptz default now()
);

alter table payment_plans
  add constraint payment_plans_status_check
  check (status in ('pending_acceptance', 'active', 'defaulted', 'completed', 'cancelled'));

create table if not exists payment_plan_installments (
  id              uuid primary key default gen_random_uuid(),
  payment_plan_id uuid not null references payment_plans(id) on delete restrict,
  sequence_no     integer not null check (sequence_no > 0),
  due_date        date not null,
  amount_minor    bigint not null check (amount_minor > 0),
  paid_minor      bigint not null default 0 check (paid_minor >= 0 and paid_minor <= amount_minor),
  status          text not null default 'scheduled' check (status in ('scheduled', 'partial', 'paid', 'overdue', 'cancelled')),
  settled_at      timestamptz,
  created_at      timestamptz not null default now(),
  unique (payment_plan_id, sequence_no)
);

create table if not exists payment_plan_allocations (
  id                          uuid primary key default gen_random_uuid(),
  payment_plan_id             uuid not null references payment_plans(id) on delete restrict,
  payment_plan_installment_id uuid not null references payment_plan_installments(id) on delete restrict,
  financial_event_id          uuid not null references case_financial_events(id) on delete restrict,
  amount_minor                bigint not null check (amount_minor > 0),
  created_at                  timestamptz not null default now(),
  unique (payment_plan_installment_id, financial_event_id)
);

alter table payment_plans enable row level security;
alter table payment_plan_installments enable row level security;
alter table payment_plan_allocations enable row level security;

create policy "payment_plans_owner_read"
  on payment_plans for select
  using (
    case_id in (
      select id from cases where business_id in (
        select id from businesses where owner_id = auth.uid()
      )
    )
  );

create policy "payment_plan_installments_owner_read"
  on payment_plan_installments for select
  using (payment_plan_id in (
    select p.id from payment_plans p join cases c on c.id = p.case_id
    where c.business_id in (select id from businesses where owner_id = auth.uid())
  ));

create policy "payment_plan_allocations_owner_read"
  on payment_plan_allocations for select
  using (payment_plan_id in (
    select p.id from payment_plans p join cases c on c.id = p.case_id
    where c.business_id in (select id from businesses where owner_id = auth.uid())
  ));

-- Public acknowledgement data and writes are handled only by the tokenized
-- server route. No anonymous read or update policy is defined here.

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
  consent_version          text,
  consented_at             timestamptz,
  consent_snapshot         jsonb not null default '{}'::jsonb,
  data_package_snapshot    jsonb not null default '{}'::jsonb,
  data_package_created_at  timestamptz,
  shared_at                timestamptz,
  handoff_channel          text,
  provider_reference       text,
  withdrawn_at             timestamptz,
  withdrawal_reason        text,
  idempotency_key          uuid unique,
  last_handoff_error       text,
  created_at               timestamptz default now(),
  updated_at               timestamptz default now(),
  constraint lawyer_referrals_status_check check (referral_status in ('draft', 'ready_for_review', 'handoff_pending', 'handoff_failed', 'submitted', 'under_review', 'lawyer_contacted', 'accepted', 'declined', 'withdrawn', 'closed')),
  constraint lawyer_referrals_consent_check check (referral_status = 'draft' or (consent_version is not null and consented_at is not null and consent_snapshot <> '{}'::jsonb)),
  constraint lawyer_referrals_withdrawal_check check (referral_status <> 'withdrawn' or withdrawn_at is not null)
);

alter table lawyer_referrals enable row level security;

create policy "lawyer_referrals_owner_read"
  on lawyer_referrals for select to authenticated
  using (
    business_id in (
      select id from businesses where owner_id = auth.uid()
    )
  );

create table if not exists lawyer_referral_events (
  id uuid primary key default gen_random_uuid(),
  referral_id uuid not null references lawyer_referrals(id) on delete restrict,
  case_id text not null references cases(id) on delete restrict,
  business_id uuid not null references businesses(id) on delete restrict,
  event_type text not null check (event_type in ('created', 'data_package_created', 'handoff_attempted', 'handoff_failed', 'submitted', 'withdrawn', 'provider_status_recorded')),
  actor_type text not null check (actor_type in ('owner', 'system')),
  actor_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table lawyer_referral_events enable row level security;
create policy "lawyer_referral_events_owner_read" on lawyer_referral_events for select to authenticated using (
  exists (select 1 from businesses b where b.id = lawyer_referral_events.business_id and b.owner_id = auth.uid())
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
create or replace function validate_case_debtor_tenant()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.debtor_id is not null and not exists (
    select 1 from debtors d
    where d.id = new.debtor_id and d.business_id = new.business_id
  ) then
    raise exception 'case debtor must belong to the case business';
  end if;
  return new;
end;
$$;

create trigger cases_debtor_tenant_guard
before insert or update of business_id, debtor_id on cases
for each row execute function validate_case_debtor_tenant();

create unique index if not exists businesses_owner_id_key on businesses(owner_id);
create index if not exists idx_debtors_business_active on debtors(business_id, archived_at);
create index if not exists idx_debtors_business_lookup on debtors(
  business_id,
  debtor_type,
  lower(btrim(coalesce(individual_name, ''))),
  lower(btrim(coalesce(business_name, '')))
);
create index if not exists idx_cases_business_id    on cases(business_id);
create index if not exists idx_cases_debtor_id      on cases(debtor_id);
create index if not exists idx_cases_status         on cases(status);
create index if not exists idx_evidence_case_id     on evidence_files(case_id);
create index if not exists evidence_files_case_active_uploaded_idx on evidence_files(case_id, uploaded_at desc) where archived_at is null;
create unique index if not exists evidence_files_case_active_sha_uidx on evidence_files(case_id, content_sha256) where archived_at is null and content_sha256 is not null;
create index if not exists idx_reminders_case_id    on reminders(case_id);
create index if not exists idx_payments_case_id     on payments(case_id);
create index if not exists idx_payments_review      on payments(review_status);
create index if not exists idx_case_financial_events_case on case_financial_events(case_id, created_at, id);
create index if not exists idx_audit_logs_business  on audit_logs(business_id);
create index if not exists idx_audit_logs_case      on audit_logs(case_id);
create index if not exists idx_payment_plans_case   on payment_plans(case_id);
create unique index if not exists payment_plans_one_open_plan_per_case_idx
  on payment_plans(case_id) where status in ('pending_acceptance', 'active', 'defaulted');
create index if not exists payment_plan_installments_due_idx
  on payment_plan_installments(payment_plan_id, due_date, sequence_no);
create index if not exists payment_plan_allocations_plan_idx
  on payment_plan_allocations(payment_plan_id, created_at);
create index if not exists idx_referrals_business   on lawyer_referrals(business_id);
create index if not exists lawyer_referrals_case_open_idx on lawyer_referrals(case_id, created_at desc) where referral_status not in ('withdrawn', 'closed', 'declined');
create index if not exists lawyer_referral_events_referral_idx on lawyer_referral_events(referral_id, created_at asc);
create index if not exists idx_legal_docs_case      on legal_documents(case_id);
create unique index if not exists legal_documents_evidence_pack_generation_key_uidx
  on legal_documents (case_id, generation_key)
  where document_type = 'evidence_pack' and generation_key is not null;
create unique index if not exists legal_documents_document_number_uidx
  on legal_documents (document_number) where document_number is not null;
