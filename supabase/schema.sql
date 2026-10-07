-- ═══════════════════════════════════════════════════════════════════════════
-- CollectBoss — Supabase Schema & Row-Level Security Policies
-- Run this in the Supabase SQL Editor before deploying.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Enable UUID extension ────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";

create or replace function public.currency_minor_units(p_currency text)
returns smallint language sql immutable strict set search_path = public, pg_temp as $$
  select case upper(p_currency)
    when 'BHD' then 3 when 'CLF' then 4 when 'CLP' then 0 when 'DJF' then 0
    when 'GNF' then 0 when 'IQD' then 3 when 'ISK' then 0 when 'JOD' then 3
    when 'JPY' then 0 when 'KMF' then 0 when 'KRW' then 0 when 'KWD' then 3
    when 'LYD' then 3 when 'OMR' then 3 when 'PYG' then 0 when 'RWF' then 0
    when 'TND' then 3 when 'UGX' then 0 when 'UYI' then 0 when 'UYW' then 4
    when 'VND' then 0 when 'VUV' then 0 when 'XAF' then 0 when 'XOF' then 0
    when 'XPF' then 0 else 2 end::smallint
$$;

create or replace function public.currency_minor_to_major(p_amount_minor bigint, p_currency text)
returns numeric language sql immutable strict set search_path = public, pg_temp as $$
  select p_amount_minor::numeric / power(10::numeric, public.currency_minor_units(upper(p_currency)))
$$;

create or replace function public.currency_major_to_minor(p_amount numeric, p_currency text)
returns bigint language plpgsql immutable strict set search_path = public, pg_temp as $$
declare scaled numeric;
begin
  if upper(p_currency) !~ '^[A-Z]{3}$' then raise exception 'Currency must be a three-letter ISO code'; end if;
  scaled := p_amount * power(10::numeric, public.currency_minor_units(upper(p_currency)));
  if scaled <> trunc(scaled) then raise exception 'Amount has too many decimal places for currency %', upper(p_currency); end if;
  return scaled::bigint;
end;
$$;

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
  phone_e164       text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  email            text,
  address          text,
  address_details  jsonb not null default '{}'::jsonb check (jsonb_typeof(address_details) = 'object'),
  country_code     text not null default 'MY' check (country_code ~ '^[A-Z]{2}$'),
  locale           text not null default 'en-MY' check (locale ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  default_currency text not null default 'MYR' check (default_currency ~ '^[A-Z]{3}$'),
  date_format      text not null default 'locale' check (date_format in ('locale','day-month-year','month-day-year','year-month-day')),
  number_format    text not null default 'locale' check (number_format in ('locale','comma-decimal','dot-decimal')),
  language_code    text not null default 'en' check (language_code ~ '^[a-z]{2,3}(-[A-Z]{2})?$'),
  registration_identifiers jsonb not null default '[]'::jsonb check (jsonb_typeof(registration_identifiers) = 'array'),
  region_defaults_source text not null default 'application_default',
  region_defaults_determined_at timestamptz not null default now(),
  credit_limit_enforcement_enabled boolean not null default false,
  timezone         text not null default 'Asia/Kuala_Lumpur'
                   check (timezone = 'UTC' or (char_length(timezone) between 3 and 64 and timezone like '%/%')),
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
  business_entity_id uuid,
  debtor_id          uuid references debtors(id) on delete restrict,
  account_id         uuid,
  case_scope         text not null default 'standalone',
  debtor_type        text not null default 'individual'
                   check (debtor_type in ('individual', 'business')),
  debtor_name        text not null,
  debtor_phone       text,
  debtor_email       text,
  debtor_company     text,
  debtor_reg_no      text,
  debtor_location    text,
  amount_owed        numeric(24,6) not null default 0,
  amount_paid        numeric(24,6) not null default 0,
  currency           char(3) not null default 'MYR' check (currency ~ '^[A-Z]{3}$'),
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
  constraint cases_scope_check check (case_scope in ('standalone', 'single_obligation', 'multiple_obligations', 'account_balance')),
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
  business_entity_id    uuid,
  bank_name             text not null,
  account_holder_name   text not null,
  account_number        text not null,
  currency              char(3) not null default 'MYR' check (currency ~ '^[A-Z]{3}$'),
  duitnow_id            text,
  duitnow_qr_url        text,
  include_in_reminders  boolean not null default true,
  is_primary            boolean not null default false,
  created_at            timestamptz default now(),
  updated_at            timestamptz not null default now(),
  version               integer not null default 1,
  business_entity       text not null,
  payment_method        text not null default 'bank_transfer' check (payment_method in ('bank_transfer','duitnow','ewallet','other')),
  masked_display        text not null,
  qr_object_path        text,
  is_active             boolean not null default true,
  verification_status   text not null default 'unverified' check (verification_status in ('unverified','pending','verified','rejected','disabled')),
  created_by            uuid references auth.users(id) on delete set null,
  updated_by            uuid references auth.users(id) on delete set null,
  approved_by           uuid references auth.users(id) on delete set null,
  approved_at           timestamptz
);

alter table receiving_accounts enable row level security;

create policy "receiving_accounts: owner read"
  on receiving_accounts for select to authenticated
  using (
    business_id in (
      select id from businesses where owner_id = auth.uid()
    )
  );

create unique index if not exists receiving_accounts_one_primary_per_business
  on receiving_accounts (business_id, currency) where is_primary;

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
  currency        char(3) not null default 'MYR' check (currency ~ '^[A-Z]{3}$'),
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
  amount          numeric(24,6) not null,
  amount_minor    bigint not null check (amount_minor > 0),
  currency        char(3) not null default 'MYR' check (currency ~ '^[A-Z]{3}$'),
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
-- Their token linkage, secure review lifecycle, notification rows and Action
-- Centre rows are additive deployment migrations; the current contract is in
-- supabase/migrations/20260806_secure_payment_proof_flow.sql.

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
  total_amount        numeric(24,6) not null,
  installment_count   integer not null,
  installment_amount  numeric(24,6) not null,
  currency            char(3) not null default 'MYR' check (currency ~ '^[A-Z]{3}$'),
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
  timezone            text not null default 'Asia/Kuala_Lumpur'
                      check (timezone = 'UTC' or (char_length(timezone) between 3 and 64 and timezone like '%/%')),
  terms_version       integer not null default 1 check (terms_version > 0),
  terms_snapshot      jsonb not null default '{}'::jsonb,
  accepted_at         timestamptz,
  rejected_at         timestamptz,
  rejection_reason    text,
  grace_days          integer not null default 0 check (grace_days between 0 and 31),
  created_at          timestamptz default now()
);

create or replace function public.payment_plan_apply_region_defaults()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_timezone text;
  v_currency text;
begin
  select b.timezone, coalesce(to_jsonb(c) ->> 'currency', b.default_currency)
    into v_timezone, v_currency
  from public.cases c
  join public.businesses b on b.id = c.business_id
  where c.id = new.case_id;
  if not found then raise exception 'Payment plan case was not found'; end if;
  new.timezone := v_timezone;
  if jsonb_typeof(new.terms_snapshot) = 'object' then
    new.terms_snapshot := new.terms_snapshot || jsonb_build_object(
      'timezone', v_timezone,
      'currency', v_currency
    );
  end if;
  return new;
end;
$$;

drop trigger if exists payment_plan_apply_region on public.payment_plans;
create trigger payment_plan_apply_region
before insert or update of case_id, timezone, terms_snapshot on public.payment_plans
for each row execute function public.payment_plan_apply_region_defaults();

create or replace function public.payment_plan_exact_insert_amounts()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v_currency char(3); v_outstanding_minor bigint;
begin
  select currency, outstanding_minor into v_currency, v_outstanding_minor from public.cases where id=new.case_id;
  if not found then raise exception 'Payment plan case was not found'; end if;
  if new.currency is not null and new.currency<>v_currency then raise exception 'Payment plan currency does not match case currency'; end if;
  if new.installment_count is null or new.installment_count<1 then raise exception 'Payment plan installment count is invalid'; end if;
  new.currency:=v_currency;
  new.total_amount:=public.currency_minor_to_major(v_outstanding_minor,v_currency);
  new.installment_amount:=public.currency_minor_to_major(v_outstanding_minor/new.installment_count,v_currency);
  return new;
end;
$$;
drop trigger if exists payment_plan_exact_insert_amounts on public.payment_plans;
create trigger payment_plan_exact_insert_amounts before insert on public.payment_plans
for each row execute function public.payment_plan_exact_insert_amounts();

alter table payment_plans
  add constraint payment_plans_status_check
  check (status in ('pending_acceptance', 'active', 'defaulted', 'completed', 'cancelled'));

create table if not exists payment_plan_installments (
  id              uuid primary key default gen_random_uuid(),
  payment_plan_id uuid not null references payment_plans(id) on delete restrict,
  sequence_no     integer not null check (sequence_no > 0),
  due_date        date not null,
  amount_minor    bigint not null check (amount_minor > 0),
  currency        char(3) not null default 'MYR' check (currency ~ '^[A-Z]{3}$'),
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
  currency                    char(3) not null default 'MYR' check (currency ~ '^[A-Z]{3}$'),
  created_at                  timestamptz not null default now(),
  unique (payment_plan_installment_id, financial_event_id)
);

create table if not exists payment_plan_events (
  id                          uuid primary key default gen_random_uuid(),
  business_id                 uuid not null references businesses(id) on delete cascade,
  case_id                     text not null references cases(id) on delete cascade,
  payment_plan_id             uuid not null references payment_plans(id) on delete restrict,
  payment_plan_installment_id uuid references payment_plan_installments(id) on delete restrict,
  event_type                  text not null check (event_type in ('due_soon', 'due_today', 'missed', 'partial_payment', 'paid', 'plan_completed')),
  event_date                  date not null,
  amount_minor                bigint,
  paid_minor                  bigint,
  currency                    char(3) not null default 'MYR' check (currency ~ '^[A-Z]{3}$'),
  metadata                    jsonb not null default '{}'::jsonb,
  created_at                  timestamptz not null default now()
);

alter table payment_plans enable row level security;
alter table payment_plan_installments enable row level security;
alter table payment_plan_allocations enable row level security;
alter table payment_plan_events enable row level security;

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

create policy "payment_plan_events_owner_read"
  on payment_plan_events for select
  using (business_id in (select id from businesses where owner_id = auth.uid()));

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
  constraint lawyer_referrals_status_check check (referral_status in ('draft', 'ready_for_review', 'handoff_pending', 'handoff_failed', 'submitted', 'under_review', 'additional_documents_requested', 'lawyer_contacted', 'accepted', 'declined', 'withdrawn', 'closed')),
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
  event_type text not null check (event_type in ('created', 'data_package_created', 'handoff_attempted', 'handoff_failed', 'submitted', 'withdrawn', 'provider_status_recorded', 'documents_requested', 'documents_provided', 'professional_message')),
  actor_type text not null check (actor_type in ('owner', 'system', 'professional')),
  actor_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  idempotency_key uuid,
  created_at timestamptz not null default now()
);
alter table lawyer_referral_events enable row level security;
create policy "lawyer_referral_events_owner_read" on lawyer_referral_events for select to authenticated using (
  exists (select 1 from businesses b where b.id = lawyer_referral_events.business_id and b.owner_id = auth.uid())
);

create table if not exists legal_handoff_document_requests (
  id uuid primary key default gen_random_uuid(),
  referral_id uuid not null references lawyer_referrals(id) on delete restrict,
  case_id text not null references cases(id) on delete restrict,
  business_id uuid not null references businesses(id) on delete restrict,
  professional_name text not null,
  professional_firm text not null,
  request_message text not null,
  requested_documents jsonb not null default '[]'::jsonb,
  provider_request_id text not null,
  status text not null default 'open' check (status in ('open', 'fulfilled', 'cancelled')),
  response_note text,
  fulfilled_at timestamptz,
  fulfilled_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (referral_id, provider_request_id)
);
create table if not exists legal_handoff_document_request_evidence (
  request_id uuid not null references legal_handoff_document_requests(id) on delete restrict,
  evidence_id uuid not null references evidence_files(id) on delete restrict,
  case_id text not null references cases(id) on delete restrict,
  business_id uuid not null references businesses(id) on delete restrict,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (request_id, evidence_id)
);
alter table legal_handoff_document_requests enable row level security;
alter table legal_handoff_document_request_evidence enable row level security;
create policy "legal_handoff_document_requests_owner_read" on legal_handoff_document_requests for select to authenticated
  using (business_id in (select id from businesses where owner_id = auth.uid()));
create policy "legal_handoff_document_request_evidence_owner_read" on legal_handoff_document_request_evidence for select to authenticated
  using (business_id in (select id from businesses where owner_id = auth.uid()));

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

create or replace function validate_case_receiving_account()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.receiving_account_id is not null and not exists (
    select 1 from receiving_accounts ra
    where ra.id = new.receiving_account_id and ra.business_id = new.business_id
      and ra.is_active and ra.verification_status not in ('rejected', 'disabled')
  ) then raise exception 'receiving account must be active and belong to the case business'; end if;
  return new;
end;
$$;
create trigger cases_receiving_account_guard before insert or update of business_id, receiving_account_id on cases
for each row execute function validate_case_receiving_account();

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
create unique index if not exists payment_plan_events_installment_once_idx
  on payment_plan_events(payment_plan_installment_id, event_type)
  where payment_plan_installment_id is not null;
create unique index if not exists payment_plan_events_plan_once_idx
  on payment_plan_events(payment_plan_id, event_type)
  where payment_plan_installment_id is null;
create index if not exists payment_plan_events_case_timeline_idx
  on payment_plan_events(case_id, created_at, id);
create index if not exists idx_referrals_business   on lawyer_referrals(business_id);
create index if not exists lawyer_referrals_case_open_idx on lawyer_referrals(case_id, created_at desc) where referral_status not in ('withdrawn', 'closed', 'declined');
create index if not exists lawyer_referral_events_referral_idx on lawyer_referral_events(referral_id, created_at asc);
create unique index if not exists lawyer_referral_events_idempotency_idx on lawyer_referral_events(idempotency_key) where idempotency_key is not null;
create index if not exists legal_handoff_requests_referral_idx on legal_handoff_document_requests(referral_id, created_at desc);
create index if not exists legal_handoff_request_evidence_case_idx on legal_handoff_document_request_evidence(case_id, created_at);
create index if not exists idx_legal_docs_case      on legal_documents(case_id);
create unique index if not exists legal_documents_evidence_pack_generation_key_uidx
  on legal_documents (case_id, generation_key)
  where document_type = 'evidence_pack' and generation_key is not null;
create unique index if not exists legal_documents_document_number_uidx
  on legal_documents (document_number) where document_number is not null;

-- ─── R01 cross-industry receivables foundation ───────────────────────────────
create table if not exists customer_accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  business_entity_id uuid,
  customer_id uuid not null references debtors(id) on delete restrict,
  account_type text not null default 'general' check (account_type in (
    'general','corporate','supplier','rental','vehicle','property','project','catering_event','future'
  )),
  account_number text,
  display_name text not null check (nullif(btrim(display_name), '') is not null),
  currency char(3) not null default 'MYR' check (currency ~ '^[A-Z]{3}$'),
  account_mode text not null default 'one_off' check (account_mode in ('one_off','ongoing')),
  credit_limit_minor bigint check (credit_limit_minor is null or credit_limit_minor > 0),
  credit_warning_threshold_percent numeric(5,2) not null default 80
    check (credit_warning_threshold_percent > 0 and credit_warning_threshold_percent <= 100),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  custom_fields jsonb not null default '{}'::jsonb check (jsonb_typeof(custom_fields) = 'object'),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, business_id, customer_id),
  unique (id, business_id),
  unique nulls not distinct (business_id, customer_id, account_number)
);

create table if not exists obligations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  business_entity_id uuid,
  customer_id uuid not null references debtors(id) on delete restrict,
  account_id uuid,
  obligation_type text not null default 'invoice' check (obligation_type in (
    'invoice','general_obligation','rent','vehicle','property','project','supplier','catering_event','other'
  )),
  reference text not null check (nullif(btrim(reference), '') is not null),
  purchase_order_reference text,
  issue_date date,
  due_date date not null,
  currency char(3) not null default 'MYR' check (currency ~ '^[A-Z]{3}$'),
  original_amount_minor bigint not null check (original_amount_minor >= 0),
  adjustments_minor bigint not null default 0,
  paid_minor bigint not null default 0 check (paid_minor >= 0),
  contractual_due_minor bigint generated always as (original_amount_minor + adjustments_minor) stored,
  outstanding_minor bigint generated always as (greatest(original_amount_minor + adjustments_minor - paid_minor, 0)) stored,
  status text not null default 'open' check (status in ('draft','open','overdue','partial','paid','disputed','void','written_off')),
  dispute_review_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  custom_fields jsonb not null default '{}'::jsonb check (jsonb_typeof(custom_fields) = 'object'),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (issue_date is null or due_date >= issue_date),
  check (original_amount_minor + adjustments_minor >= 0),
  check (paid_minor <= original_amount_minor + adjustments_minor),
  foreign key (account_id, business_id, customer_id)
    references customer_accounts(id, business_id, customer_id) on delete restrict,
  unique (id, business_id),
  unique nulls not distinct (business_id, customer_id, account_id, reference)
);

create unique index if not exists debtors_id_business_unique on debtors(id, business_id);
alter table customer_accounts add constraint customer_accounts_customer_tenant_fk
  foreign key (customer_id, business_id) references debtors(id, business_id) on delete restrict;
alter table obligations add constraint obligations_customer_tenant_fk
  foreign key (customer_id, business_id) references debtors(id, business_id) on delete restrict;
create unique index if not exists cases_id_business_unique on cases(id, business_id);
alter table cases
  add constraint cases_account_customer_fk foreign key (account_id, business_id, debtor_id)
  references customer_accounts(id, business_id, customer_id) on delete restrict;
alter table cases add constraint cases_customer_tenant_fk
  foreign key (debtor_id, business_id) references debtors(id, business_id) on delete restrict;

create table if not exists recovery_case_obligations (
  case_id text not null,
  obligation_id uuid not null,
  business_id uuid not null,
  linked_at timestamptz not null default now(),
  linked_by uuid references auth.users(id) on delete set null,
  primary key (case_id, obligation_id),
  foreign key (case_id, business_id) references cases(id, business_id) on delete cascade,
  foreign key (obligation_id, business_id) references obligations(id, business_id) on delete restrict,
  unique (obligation_id)
);

create index if not exists customer_accounts_customer_idx on customer_accounts(business_id, customer_id) where archived_at is null;
create index if not exists customer_accounts_type_idx on customer_accounts(business_id, account_type) where archived_at is null;
create index if not exists customer_accounts_mode_idx on customer_accounts(business_id, account_mode) where archived_at is null;
create index if not exists customer_accounts_metadata_gin_idx on customer_accounts using gin(metadata);
create index if not exists obligations_customer_idx on obligations(business_id, customer_id, due_date) where archived_at is null;
create index if not exists obligations_account_idx on obligations(business_id, account_id, due_date) where archived_at is null;
create index if not exists obligations_status_idx on obligations(business_id, status, due_date) where archived_at is null;
create index if not exists obligations_metadata_gin_idx on obligations using gin(metadata);
create index if not exists obligations_dispute_review_due_idx
  on obligations(business_id,dispute_review_at)
  where status='disputed' and archived_at is null and dispute_review_at is not null;
create index if not exists obligations_invoice_scheduler_idx
  on obligations(business_id,due_date) where archived_at is null and outstanding_minor > 0;
create index if not exists cases_account_idx on cases(business_id, account_id) where archived_at is null and account_id is not null;
create index if not exists cases_customer_scope_idx on cases(business_id, debtor_id, case_scope) where archived_at is null;
create index if not exists cases_promise_scheduler_idx
  on cases(business_id,promise_due_date) where status='payment_promise' and archived_at is null;
create index if not exists cases_invoice_scheduler_idx
  on cases(business_id,due_date) where archived_at is null and outstanding_minor > 0;
create index if not exists recovery_case_obligations_case_idx on recovery_case_obligations(business_id, case_id);
create unique index if not exists customer_accounts_legacy_general_unique
  on customer_accounts(business_id, customer_id)
  where metadata ->> 'migration_key' = '20260810_safe_receivables_backfill';

create table if not exists receivables_migration_verifications (
  migration_key text not null,
  business_id uuid not null references businesses(id) on delete restrict,
  pre_snapshot jsonb not null,
  post_snapshot jsonb,
  verification jsonb,
  verified boolean not null default false,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (migration_key, business_id),
  check (
    jsonb_typeof(pre_snapshot) = 'object'
    and (post_snapshot is null or jsonb_typeof(post_snapshot) = 'object')
    and (verification is null or jsonb_typeof(verification) = 'object')
  )
);

create or replace view customer_receivable_totals with (security_invoker = true) as
with currency_balances as (
  select business_id,customer_id,currency,contractual_due_minor,paid_minor,outstanding_minor
  from obligations where archived_at is null and status not in ('void','written_off')
  union all
  select c.business_id,c.debtor_id,c.currency,c.contractual_due_minor,c.approved_payment_minor,c.outstanding_minor
  from cases c where c.archived_at is null and c.debtor_id is not null
    and c.case_scope in ('standalone','account_balance')
    and not exists (select 1 from recovery_case_obligations rco where rco.case_id = c.id)
    and (c.case_scope = 'standalone' or not exists (
      select 1 from obligations o where o.account_id = c.account_id and o.archived_at is null
        and o.status not in ('void','written_off')
    ))
)
select business_id,customer_id,currency,sum(contractual_due_minor)::bigint contractual_due_minor,
  sum(paid_minor)::bigint paid_minor,sum(outstanding_minor)::bigint outstanding_minor
from currency_balances group by business_id,customer_id,currency;

create or replace function receivables_enforce_credit_limit_workflow()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  configured_limit bigint;
  enforcement_enabled boolean;
  existing_exposure bigint;
  new_exposure bigint;
  old_exposure bigint := 0;
begin
  if new.account_id is null then return new; end if;
  select a.credit_limit_minor,b.credit_limit_enforcement_enabled
    into configured_limit,enforcement_enabled
  from customer_accounts a join businesses b on b.id=a.business_id
  where a.id=new.account_id and a.business_id=new.business_id and a.customer_id=new.customer_id
  for update of a;
  if not coalesce(enforcement_enabled,false) or configured_limit is null then return new; end if;
  new_exposure := case when new.archived_at is not null or new.status in ('void','written_off') then 0
    else greatest(new.original_amount_minor+new.adjustments_minor-new.paid_minor,0) end;
  if tg_op='UPDATE' and old.account_id=new.account_id then
    old_exposure := case when old.archived_at is not null or old.status in ('void','written_off') then 0
      else greatest(old.original_amount_minor+old.adjustments_minor-old.paid_minor,0) end;
    if new_exposure <= old_exposure then return new; end if;
  end if;
  select coalesce(sum(o.outstanding_minor),0)::bigint into existing_exposure
  from obligations o where o.account_id=new.account_id and o.id<>new.id
    and o.archived_at is null and o.status not in ('void','written_off');
  if existing_exposure+new_exposure > configured_limit then
    raise exception 'Credit limit enforcement blocked this invoice: projected exposure % exceeds limit %',
      existing_exposure+new_exposure,configured_limit using errcode='23514';
  end if;
  return new;
end;
$$;
create trigger obligations_enforce_credit_limit_workflow
after insert or update of account_id,original_amount_minor,adjustments_minor,paid_minor,status,archived_at
on obligations for each row execute function receivables_enforce_credit_limit_workflow();

create or replace view account_receivable_totals with (security_invoker = true) as
with account_balances as (
  select a.business_id,a.customer_id,a.id account_id,a.account_mode,a.credit_limit_minor,
    a.credit_warning_threshold_percent,
    coalesce(sum(o.contractual_due_minor) filter (where o.archived_at is null and o.status not in ('void','written_off')),0)::bigint
      + coalesce((select sum(c.contractual_due_minor)::bigint from cases c where c.account_id=a.id
        and c.archived_at is null and c.case_scope='account_balance'
        and not exists(select 1 from recovery_case_obligations rco where rco.case_id=c.id)
        and not exists(select 1 from obligations ao where ao.account_id=a.id and ao.archived_at is null
          and ao.status not in('void','written_off'))),0) contractual_due_minor,
    coalesce(sum(o.paid_minor) filter (where o.archived_at is null and o.status not in ('void','written_off')),0)::bigint
      + coalesce((select sum(c.approved_payment_minor)::bigint from cases c where c.account_id=a.id
        and c.archived_at is null and c.case_scope='account_balance'
        and not exists(select 1 from recovery_case_obligations rco where rco.case_id=c.id)
        and not exists(select 1 from obligations ao where ao.account_id=a.id and ao.archived_at is null
          and ao.status not in('void','written_off'))),0) paid_minor,
    coalesce(sum(o.outstanding_minor) filter (where o.archived_at is null and o.status not in ('void','written_off')),0)::bigint
      + coalesce((select sum(c.outstanding_minor)::bigint from cases c where c.account_id=a.id
        and c.archived_at is null and c.case_scope='account_balance'
        and not exists(select 1 from recovery_case_obligations rco where rco.case_id=c.id)
        and not exists(select 1 from obligations ao where ao.account_id=a.id and ao.archived_at is null
          and ao.status not in('void','written_off'))),0) outstanding_minor,
    count(o.id) filter (where o.archived_at is null and o.obligation_type='invoice'
      and o.status not in ('void','written_off','paid') and o.outstanding_minor>0)::integer open_invoice_count,
    max(coalesce(o.issue_date,o.created_at::date)) filter (
      where o.archived_at is null and o.obligation_type='invoice'
    ) latest_invoice_date
  from customer_accounts a left join obligations o on o.account_id=a.id
  where a.archived_at is null
  group by a.business_id,a.customer_id,a.id,a.account_mode,a.credit_limit_minor,a.credit_warning_threshold_percent
)
select business_id,customer_id,account_id,contractual_due_minor,paid_minor,outstanding_minor,
  account_mode,credit_limit_minor,credit_warning_threshold_percent,open_invoice_count,latest_invoice_date,
  outstanding_minor current_exposure_minor,
  case when credit_limit_minor is null then null else credit_limit_minor-outstanding_minor end available_credit_minor,
  case when credit_limit_minor is null then null
    else round((outstanding_minor::numeric*100)/credit_limit_minor,2) end utilization_percentage,
  case when credit_limit_minor is null then 'no_limit'
    when outstanding_minor>credit_limit_minor then 'over_limit'
    when outstanding_minor=credit_limit_minor then 'limit_reached'
    when (outstanding_minor::numeric*100)/credit_limit_minor>=credit_warning_threshold_percent then 'approaching_limit'
    else 'within_limit' end credit_warning
from account_balances;

create or replace view legacy_case_receivables_compatibility with (security_invoker = true) as
select
  c.id case_id, c.business_id, c.debtor_id customer_id, c.account_id,
  coalesce(c.case_scope, 'standalone') case_scope,
  ga.id compatible_general_account_id,
  c.original_principal_minor, c.contractual_due_minor,
  c.approved_payment_minor, c.outstanding_minor, c.overpayment_minor,
  (select count(*) from payments p where p.case_id=c.id) payment_count,
  (select count(*) from payment_plans pp where pp.case_id=c.id) payment_plan_count,
  (select count(*) from reminders r where r.case_id=c.id) reminder_count,
  (select count(*) from evidence_files e where e.case_id=c.id) evidence_count,
  (
    (select count(*) from legal_documents ld where ld.case_id=c.id)
    + (select count(*) from case_financial_events cfe where cfe.case_id=c.id)
  ) statement_and_document_source_count,
  (select count(*) from lawyer_referrals lr where lr.case_id=c.id) lawyer_handoff_count,
  (select count(*) from public_payment_submissions pps where pps.case_id=c.id) payment_proof_count,
  c.debtor_id is null incomplete_legacy_customer,
  c.account_id is null and coalesce(c.case_scope, 'standalone')='standalone' legacy_standalone
from cases c
left join lateral (
  select a.id from customer_accounts a
  where a.business_id=c.business_id and a.customer_id=c.debtor_id and a.archived_at is null
  order by
    (a.metadata ->> 'migration_key' = '20260810_safe_receivables_backfill') desc,
    a.created_at, a.id
  limit 1
) ga on true;

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

alter table receivables_migration_verifications enable row level security;
create policy "receivables_migration_verifications: owner read"
  on receivables_migration_verifications for select to authenticated
  using (business_id = my_business_id());

-- R03 background scheduler and domain-event outbox. `due_at` is optional so
-- every pre-existing Action Centre row remains backward compatible.
alter table action_centre_items add column if not exists due_at timestamptz;
create index if not exists action_centre_items_due_idx
  on action_centre_items(business_id,due_at) where status='open' and due_at is not null;
create index if not exists reminders_next_action_due_idx
  on reminders(next_action_at,case_id) where next_action_at is not null;
create index if not exists payment_proof_review_scheduler_idx
  on public_payment_submissions(status,created_at);

create table if not exists domain_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  case_id text references cases(id) on delete set null,
  customer_id uuid references debtors(id) on delete set null,
  account_id uuid references customer_accounts(id) on delete set null,
  obligation_id uuid references obligations(id) on delete set null,
  event_type text not null check (event_type in (
    'FOLLOW_UP_DUE','INVOICE_OVERDUE','PROMISE_DUE','PROMISE_MISSED',
    'PLAN_INSTALLMENT_DUE','PLAN_INSTALLMENT_MISSED',
    'DISPUTE_REVIEW_DUE','PAYMENT_PROOF_REVIEW_REQUIRED',
    'DISPUTE_SUBMITTED','PAYMENT_RECEIVED'
  )),
  source_entity_type text not null,
  source_entity_id text not null,
  source_version text not null,
  effective_date date not null,
  event_timezone text not null,
  occurred_at timestamptz not null,
  event_status text not null default 'pending'
    check (event_status in ('pending','acknowledged','resolved','ignored')),
  resolved_at timestamptz,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload)='object'),
  deduplication_key text not null unique,
  created_at timestamptz not null default now(),
  check (
    nullif(btrim(source_entity_type),'') is not null
    and nullif(btrim(source_entity_id),'') is not null
    and nullif(btrim(source_version),'') is not null
  ),
  check (
    (event_status in ('pending','acknowledged') and resolved_at is null)
    or (event_status in ('resolved','ignored') and resolved_at is not null)
  )
);
create index if not exists domain_events_business_pending_idx
  on domain_events(business_id,effective_date,created_at) where event_status='pending';
create index if not exists domain_events_case_timeline_idx
  on domain_events(case_id,effective_date,created_at,id) where case_id is not null;
create index if not exists domain_events_type_effective_idx
  on domain_events(event_type,effective_date);
alter table domain_events enable row level security;
create policy "domain_events: owner read" on domain_events
  for select to authenticated using (business_id=my_business_id());

-- R04 persistent notification projection. The original notification table and
-- writers come from 20260806; these additive fields keep them compatible.
alter table notifications
  add column if not exists user_id uuid references auth.users(id) on delete set null,
  add column if not exists customer_id uuid references debtors(id) on delete set null,
  add column if not exists event_type text,
  add column if not exists severity text not null default 'medium',
  add column if not exists action_url text,
  add column if not exists archived_at timestamptz,
  add column if not exists dedupe_key text,
  add column if not exists domain_event_id uuid references domain_events(id) on delete restrict;
create unique index if not exists notifications_business_dedupe_uidx
  on notifications(business_id,dedupe_key);
create unique index if not exists notifications_domain_event_uidx
  on notifications(domain_event_id) where domain_event_id is not null;
create index if not exists notifications_business_active_idx
  on notifications(business_id,created_at desc) where archived_at is null;
alter table notifications enable row level security;
drop policy if exists "notifications_owner_read" on notifications;
drop policy if exists "notifications_owner_update" on notifications;
create policy "notifications_owner_read" on notifications
  for select to authenticated using (
    business_id=my_business_id() and (user_id is null or user_id=auth.uid())
  );
create policy "notifications_owner_update" on notifications
  for update to authenticated using (
    business_id=my_business_id() and (user_id is null or user_id=auth.uid())
  ) with check (
    business_id=my_business_id() and (user_id is null or user_id=auth.uid())
  );

-- R05 Action Centre operational model. Existing writers remain compatible;
-- lifecycle functions and projections are defined by migration 20260813.
alter table action_centre_items
  add column if not exists customer_id uuid references debtors(id) on delete set null,
  add column if not exists assignee_id uuid references auth.users(id) on delete set null,
  add column if not exists reason text,
  add column if not exists amount_minor bigint,
  add column if not exists priority text not null default 'medium',
  add column if not exists recommended_action text,
  add column if not exists source_event_id uuid references domain_events(id) on delete restrict,
  add column if not exists snoozed_until timestamptz,
  add column if not exists dedupe_key text;
create unique index if not exists action_centre_items_business_dedupe_uidx
  on action_centre_items(business_id,dedupe_key);
create index if not exists action_centre_items_business_active_idx
  on action_centre_items(business_id,priority,due_at,created_at)
  where status in ('open','in_progress','snoozed');

create table if not exists action_centre_item_events (
  id uuid primary key default gen_random_uuid(),
  action_item_id uuid not null references action_centre_items(id) on delete restrict,
  business_id uuid not null references businesses(id) on delete restrict,
  case_id text references cases(id) on delete set null,
  actor_type text not null check (actor_type in ('owner','system')),
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null check (
    event_type in ('created','started','snoozed','reopened','completed','dismissed','auto_completed')
  ),
  from_status text,
  to_status text not null,
  snooze_duration_seconds integer check (
    snooze_duration_seconds is null or snooze_duration_seconds between 900 and 2592000
  ),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now()
);
create index if not exists action_centre_item_events_action_idx
  on action_centre_item_events(action_item_id,created_at,id);
alter table action_centre_items enable row level security;
drop policy if exists "action_centre_items_owner_read" on action_centre_items;
drop policy if exists "action_centre_items_owner_update" on action_centre_items;
create policy "action_centre_items_owner_read" on action_centre_items
  for select to authenticated using (
    business_id=my_business_id() and (assignee_id is null or assignee_id=auth.uid())
  );
alter table action_centre_item_events enable row level security;
create policy "action_centre_item_events_owner_read" on action_centre_item_events
  for select to authenticated using (business_id=my_business_id());

-- Authoritative relationship mutation, case-ledger synchronization and
-- reconciliation and safe snapshot functions are defined by the additive
-- deployment migrations 20260809 and 20260810. Timezone validation and the
-- service-role-only domain_events_detect function is defined by 20260811.
-- Notification validation, source triggers and the separate domain-event
-- consumer are defined by 20260812.
-- Action projection, audited transitions and auto-completion are defined by
-- 20260813.
-- R06 first-class payment promises. Legacy cases.promise_due_date remains a
-- compatibility projection and is not backfilled with guessed financial data.
create table if not exists payment_promises (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete restrict,
  case_id text not null references cases(id) on delete restrict,
  customer_id uuid references debtors(id) on delete restrict,
  promised_amount_minor bigint not null check (promised_amount_minor > 0),
  currency char(3) not null default 'MYR' check (currency ~ '^[A-Z]{3}$'),
  promise_date date not null,
  source text not null check (source in ('whatsapp','call','email','portal','in_person','manual')),
  source_activity_type text,
  source_activity_id text,
  note text,
  status text not null default 'pending'
    check (status in ('pending','partially_fulfilled','fulfilled','missed','cancelled')),
  amount_fulfilled_minor bigint not null default 0
    check (amount_fulfilled_minor >= 0 and amount_fulfilled_minor <= promised_amount_minor),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  fulfilled_at timestamptz,
  missed_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  idempotency_key uuid not null default gen_random_uuid(),
  unique (business_id,idempotency_key),
  check (nullif(btrim(coalesce(source_activity_type,'')),'') is not null or source_activity_id is null),
  check ((status='fulfilled')=(fulfilled_at is not null)),
  check ((status='missed')=(missed_at is not null)),
  check ((status='cancelled')=(cancelled_at is not null))
);
create unique index if not exists payment_promises_one_active_per_case_uidx
  on payment_promises(case_id) where status in ('pending','partially_fulfilled');
create index if not exists payment_promises_scheduler_idx
  on payment_promises(business_id,promise_date) where status in ('pending','partially_fulfilled');
create index if not exists payment_promises_case_history_idx
  on payment_promises(case_id,created_at desc,id);

create table if not exists payment_promise_allocations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete restrict,
  promise_id uuid not null references payment_promises(id) on delete restrict,
  payment_id uuid not null references payments(id) on delete restrict,
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null default 'MYR' check (currency ~ '^[A-Z]{3}$'),
  matching_rule text not null check (matching_rule in ('explicit_same_case_payment','authorised_override')),
  override_reason text,
  allocated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  reversed_at timestamptz,
  reversed_by uuid references auth.users(id) on delete set null,
  reversal_reason text,
  unique (promise_id,payment_id),
  check (
    (matching_rule='authorised_override' and nullif(btrim(coalesce(override_reason,'')),'') is not null)
    or (matching_rule='explicit_same_case_payment' and override_reason is null)
  )
);
create unique index if not exists payment_promise_allocations_payment_active_uidx
  on payment_promise_allocations(payment_id) where reversed_at is null;
create index if not exists payment_promise_allocations_promise_idx
  on payment_promise_allocations(promise_id,created_at,id);

create table if not exists payment_promise_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete restrict,
  promise_id uuid not null references payment_promises(id) on delete restrict,
  case_id text not null references cases(id) on delete restrict,
  payment_id uuid references payments(id) on delete set null,
  event_type text not null check (event_type in (
    'created','payment_matched','partially_fulfilled','fulfilled','missed',
    'cancelled','match_overridden','payment_reversed'
  )),
  actor_type text not null check (actor_type in ('owner','system')),
  actor_id uuid references auth.users(id) on delete set null,
  amount_minor bigint check (amount_minor is null or amount_minor >= 0),
  currency char(3) not null default 'MYR' check (currency ~ '^[A-Z]{3}$'),
  note text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now()
);
create unique index if not exists payment_promise_events_missed_once_uidx
  on payment_promise_events(promise_id,event_type) where event_type='missed';
create index if not exists payment_promise_events_case_timeline_idx
  on payment_promise_events(case_id,created_at,id);
alter table payment_promises enable row level security;
alter table payment_promise_allocations enable row level security;
alter table payment_promise_events enable row level security;
create policy "payment_promises_owner_read" on payment_promises
  for select to authenticated using (business_id=my_business_id());
create policy "payment_promise_allocations_owner_read" on payment_promise_allocations
  for select to authenticated using (business_id=my_business_id());
create policy "payment_promise_events_owner_read" on payment_promise_events
  for select to authenticated using (business_id=my_business_id());

-- Lifecycle, allocation/reversal audit, scheduler and privilege functions are
-- defined by the additive deployment migration 20260814.

-- R07 structured disputes and collection-safe recovery projection.
alter table reminders add column if not exists dispute_snapshot_minor bigint;
alter table reminders add column if not exists collectable_snapshot_minor bigint;
create table if not exists disputes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete restrict,
  case_id text not null references cases(id) on delete restrict,
  obligation_id uuid references obligations(id) on delete restrict,
  customer_id uuid references debtors(id) on delete restrict,
  public_access_token_id uuid references public_access_tokens(id) on delete set null,
  category text not null check (category in (
    'amount_incorrect','already_paid','duplicate_invoice','goods_not_received',
    'damaged_quality_issue','service_incomplete','incorrect_pricing',
    'do_not_recognise_debt','other'
  )),
  original_amount_minor bigint not null check (original_amount_minor>=0),
  balance_snapshot_minor bigint not null check (balance_snapshot_minor>0),
  disputed_amount_minor bigint not null check (disputed_amount_minor>0 and disputed_amount_minor<=balance_snapshot_minor),
  currency char(3) not null default 'MYR' check (currency ~ '^[A-Z]{3}$'),
  undisputed_amount_minor bigint generated always as (balance_snapshot_minor-disputed_amount_minor) stored,
  reason text not null, description text not null,
  status text not null default 'submitted' check (status in (
    'submitted','under_review','information_requested','partially_accepted',
    'accepted','rejected','resolved','withdrawn'
  )),
  creditor_response text, resolution_amount_minor bigint,
  review_due_at timestamptz,
  resolution_adjustment_event_id uuid references case_financial_events(id) on delete restrict,
  submitted_by_type text not null check (submitted_by_type in ('debtor','owner')),
  created_by uuid references auth.users(id) on delete set null,
  idempotency_key uuid not null, submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), resolved_at timestamptz, withdrawn_at timestamptz,
  unique (business_id,idempotency_key)
);
create unique index if not exists disputes_one_active_obligation_uidx on disputes(obligation_id)
  where obligation_id is not null and status in ('submitted','under_review','information_requested','partially_accepted');
create unique index if not exists disputes_one_active_standalone_case_uidx on disputes(case_id)
  where obligation_id is null and status in ('submitted','under_review','information_requested','partially_accepted');
create index if not exists disputes_case_history_idx on disputes(case_id,submitted_at desc,id);
create index if not exists disputes_review_due_idx on disputes(business_id,review_due_at)
  where status in ('submitted','under_review','information_requested','partially_accepted');
create table if not exists dispute_evidence (
  id uuid primary key default gen_random_uuid(),
  dispute_id uuid not null references disputes(id) on delete restrict,
  business_id uuid not null references businesses(id) on delete restrict,
  case_id text not null references cases(id) on delete restrict,
  evidence_file_id uuid references evidence_files(id) on delete restrict,
  object_path text, file_name text not null, content_type text, size_bytes bigint,
  content_sha256 text, submitted_by_type text not null check (submitted_by_type in ('debtor','owner')),
  created_at timestamptz not null default now(),
  check ((evidence_file_id is not null)<>(object_path is not null))
);
create index if not exists dispute_evidence_dispute_idx on dispute_evidence(dispute_id,created_at,id);
create table if not exists dispute_events (
  id uuid primary key default gen_random_uuid(),
  dispute_id uuid not null references disputes(id) on delete restrict,
  business_id uuid not null references businesses(id) on delete restrict,
  case_id text not null references cases(id) on delete restrict,
  from_status text, to_status text not null,
  event_type text not null, actor_type text not null check (actor_type in ('debtor','owner','system')),
  actor_id uuid references auth.users(id) on delete set null, response text,
  metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create index if not exists dispute_events_case_timeline_idx on dispute_events(case_id,created_at,id);
create or replace view case_recovery_amounts with (security_invoker=true) as
select c.business_id,c.id case_id,c.outstanding_minor total_outstanding_minor,
  least(coalesce(sum(case when d.status in ('submitted','under_review','information_requested') then d.disputed_amount_minor when d.status='partially_accepted' then greatest(d.disputed_amount_minor-coalesce(d.resolution_amount_minor,0),0) else 0 end),0),c.outstanding_minor)::bigint active_disputed_minor,
  greatest(c.outstanding_minor-least(coalesce(sum(case when d.status in ('submitted','under_review','information_requested') then d.disputed_amount_minor when d.status='partially_accepted' then greatest(d.disputed_amount_minor-coalesce(d.resolution_amount_minor,0),0) else 0 end),0),c.outstanding_minor),0)::bigint collectable_minor,
  count(d.id) filter (where d.status in ('submitted','under_review','information_requested','partially_accepted'))::integer active_dispute_count
from cases c left join disputes d on d.case_id=c.id and d.business_id=c.business_id
group by c.business_id,c.id,c.outstanding_minor;
alter table disputes enable row level security;
alter table dispute_evidence enable row level security;
alter table dispute_events enable row level security;
create policy "disputes_owner_read" on disputes for select to authenticated using (business_id=my_business_id());
create policy "dispute_evidence_owner_read" on dispute_evidence for select to authenticated using (business_id=my_business_id());
create policy "dispute_events_owner_read" on dispute_events for select to authenticated using (business_id=my_business_id());
-- Lifecycle, adjustment, public submission, audit and privilege functions are
-- defined by the additive deployment migration 20260815.

-- R08 hardship, negotiation and authoritative plan resolution.
create table if not exists payment_negotiations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete restrict,
  case_id text not null references cases(id) on delete restrict,
  customer_id uuid not null references debtors(id) on delete restrict,
  public_access_token_id uuid references public_access_tokens(id) on delete set null,
  option_type text not null check (option_type in ('promise_to_pay','installment_plan','payment_difficulty')),
  status text not null default 'proposed' check (status in ('proposed','countered','accepted','declined','withdrawn','expired')),
  current_revision_no integer not null default 1 check (current_revision_no>0),
  accepted_revision_no integer,
  payment_plan_id uuid references payment_plans(id) on delete restrict,
  payment_promise_id uuid references payment_promises(id) on delete restrict,
  idempotency_key uuid not null,
  expires_at timestamptz not null default (now()+interval '14 days'),
  accepted_at timestamptz, declined_at timestamptz, withdrawn_at timestamptz, expired_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(public_access_token_id,idempotency_key),
  check ((status='accepted' and accepted_revision_no is not null and accepted_at is not null)
    or (status<>'accepted' and accepted_revision_no is null and accepted_at is null))
);
create unique index if not exists payment_negotiations_one_open_case_idx on payment_negotiations(case_id)
  where status in ('proposed','countered');
create index if not exists payment_negotiations_tenant_status_idx on payment_negotiations(business_id,status,expires_at);
create table if not exists payment_negotiation_revisions (
  id uuid primary key default gen_random_uuid(),
  negotiation_id uuid not null references payment_negotiations(id) on delete restrict,
  business_id uuid not null references businesses(id) on delete restrict,
  case_id text not null references cases(id) on delete restrict,
  revision_no integer not null check (revision_no>0),
  proposed_by text not null check (proposed_by in ('debtor','creditor')),
  amount_now_minor bigint not null default 0 check (amount_now_minor>=0),
  installment_amount_minor bigint not null check (installment_amount_minor>0),
  currency char(3) not null default 'MYR' check (currency ~ '^[A-Z]{3}$'),
  frequency text not null check (frequency in ('weekly','monthly')),
  start_date date not null, reason text, note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(negotiation_id,revision_no),
  check (char_length(coalesce(reason,''))<=500),
  check (char_length(coalesce(note,''))<=1000)
);
create index if not exists payment_negotiation_revisions_timeline_idx on payment_negotiation_revisions(negotiation_id,revision_no);
create table if not exists payment_negotiation_events (
  id uuid primary key default gen_random_uuid(),
  negotiation_id uuid not null references payment_negotiations(id) on delete restrict,
  business_id uuid not null references businesses(id) on delete restrict,
  case_id text not null references cases(id) on delete restrict,
  event_type text not null check (event_type in ('proposed','countered','accepted','declined','withdrawn','expired')),
  actor_type text not null check (actor_type in ('debtor','owner','system')),
  actor_id uuid references auth.users(id) on delete set null,
  revision_no integer, note text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now()
);
create unique index if not exists payment_negotiation_events_once_idx
  on payment_negotiation_events(negotiation_id,event_type,revision_no) where revision_no is not null;
create index if not exists payment_negotiation_events_case_timeline_idx on payment_negotiation_events(case_id,created_at,id);
alter table payment_negotiations enable row level security;
alter table payment_negotiation_revisions enable row level security;
alter table payment_negotiation_events enable row level security;
create policy "payment_negotiations_owner_read" on payment_negotiations
  for select to authenticated using (business_id=my_business_id());
create policy "payment_negotiation_revisions_owner_read" on payment_negotiation_revisions
  for select to authenticated using (business_id=my_business_id());
create policy "payment_negotiation_events_owner_read" on payment_negotiation_events
  for select to authenticated using (business_id=my_business_id());
-- Immutable revision, submission, transition, notification and expiry services
-- are defined by additive deployment migration 20260816.

-- R09 classified non-cash adjustments and closure reasons.
alter table cases add column if not exists closure_reason_code text;
alter table cases add constraint cases_closure_reason_code_check check (
  closure_reason_code is null or closure_reason_code in (
    'paid_in_full','settled','written_off','dispute_resolved','cancelled',
    'duplicate','professional_handoff','other'
  )
);
create table if not exists financial_adjustments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete restrict,
  case_id text not null references cases(id) on delete restrict,
  obligation_id uuid references obligations(id) on delete restrict,
  adjustment_type text not null check (adjustment_type in (
    'credit_note','settlement_adjustment','write_off','manual_correction',
    'returned_goods','commercial_discount','other'
  )),
  direction text not null check (direction in ('credit','debit')),
  amount_minor bigint not null check (amount_minor>0),
  currency char(3) not null default 'MYR' check (currency ~ '^[A-Z]{3}$'),
  reason text not null check (nullif(btrim(reason),'') is not null and char_length(reason)<=1000),
  reference text check (char_length(reference)<=160),
  old_amount_minor bigint, new_amount_minor bigint,
  approval_status text not null check (approval_status in ('pending','approved','rejected')),
  required_approver_role text not null default 'owner' check (required_approver_role in ('owner','manager')),
  requested_by uuid not null references auth.users(id) on delete restrict,
  approved_by uuid references auth.users(id) on delete restrict, approved_at timestamptz,
  rejected_by uuid references auth.users(id) on delete restrict, rejected_at timestamptz,
  rejection_reason text,
  financial_event_id uuid unique references case_financial_events(id) on delete restrict,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(business_id,idempotency_key),
  check (adjustment_type<>'manual_correction'
    or (old_amount_minor is not null and new_amount_minor is not null and old_amount_minor<>new_amount_minor)),
  check (
    (approval_status='approved' and approved_by is not null and approved_at is not null and rejected_by is null and rejected_at is null)
    or (approval_status='rejected' and rejected_by is not null and rejected_at is not null and approved_by is null and approved_at is null)
    or (approval_status='pending' and approved_by is null and approved_at is null and rejected_by is null and rejected_at is null)
  )
);
create index if not exists financial_adjustments_case_timeline_idx on financial_adjustments(case_id,created_at,id);
create index if not exists financial_adjustments_pending_idx on financial_adjustments(business_id,created_at)
  where approval_status='pending';
create table if not exists financial_adjustment_events (
  id uuid primary key default gen_random_uuid(),
  adjustment_id uuid not null references financial_adjustments(id) on delete restrict,
  business_id uuid not null references businesses(id) on delete restrict,
  case_id text not null references cases(id) on delete restrict,
  event_type text not null check (event_type in ('requested','approved','rejected','posted')),
  actor_id uuid references auth.users(id) on delete set null,
  actor_role text not null check (actor_role in ('owner','manager','system')),
  note text, metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now()
);
create index if not exists financial_adjustment_events_timeline_idx
  on financial_adjustment_events(case_id,created_at,id);
alter table financial_adjustments enable row level security;
alter table financial_adjustment_events enable row level security;
create policy "financial_adjustments_owner_read" on financial_adjustments
  for select to authenticated using (business_id=my_business_id());
create policy "financial_adjustment_events_owner_read" on financial_adjustment_events
  for select to authenticated using (business_id=my_business_id());
-- Posting, settlement, write-off approval and closure services are defined by
-- additive deployment migration 20260817.
-- R10 unified communication activity. V1 records device handoffs and manual
-- outcomes; no personal WhatsApp messages are read or imported automatically.
create table if not exists public.communication_activities (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  customer_id uuid references public.debtors(id) on delete restrict,
  case_id text not null references public.cases(id) on delete restrict,
  channel text not null check (channel in ('whatsapp','call','email','portal','other')),
  direction text not null check (direction in ('outbound','inbound')),
  status text not null default 'initiated'
    check (status in ('initiated','sent','delivered','read','replied','failed','completed')),
  outcome text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  staff_user_id uuid references auth.users(id) on delete set null,
  external_reference text,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  related_promise_id uuid references public.payment_promises(id) on delete set null,
  related_dispute_id uuid references public.disputes(id) on delete set null,
  related_action_id uuid references public.action_centre_items(id) on delete set null,
  idempotency_key uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id,idempotency_key),
  check (completed_at is null or completed_at >= started_at),
  check (channel <> 'whatsapp' or status in ('initiated','sent','delivered','read','replied','failed')),
  check (channel <> 'call' or status in ('initiated','failed','completed')),
  check (
    outcome is null or channel <> 'call'
    or outcome in ('no_answer','spoke_to_customer','promise_to_pay','call_back_later','payment_difficulty','other')
  ),
  check (channel <> 'call' or status <> 'completed' or outcome is not null)
);
create index if not exists communication_activities_case_timeline_idx
  on public.communication_activities(business_id,case_id,started_at desc,id);
create index if not exists communication_activities_customer_counters_idx
  on public.communication_activities(business_id,customer_id,channel,started_at desc)
  where customer_id is not null;
create unique index if not exists communication_activities_external_ref_uidx
  on public.communication_activities(business_id,channel,external_reference)
  where external_reference is not null;

create or replace function public.communication_activity_validate_scope()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare v_case public.cases;
begin
  select c.* into v_case from public.cases c where c.id=new.case_id;
  if not found or v_case.business_id<>new.business_id then raise exception 'Communication case does not belong to tenant'; end if;
  if new.customer_id is distinct from v_case.debtor_id then raise exception 'Communication customer does not match case customer'; end if;
  if new.related_promise_id is not null and not exists (
    select 1 from public.payment_promises p where p.id=new.related_promise_id and p.business_id=new.business_id and p.case_id=new.case_id
  ) then raise exception 'Related promise does not belong to communication case'; end if;
  if new.related_dispute_id is not null and not exists (
    select 1 from public.disputes d where d.id=new.related_dispute_id and d.business_id=new.business_id and d.case_id=new.case_id
  ) then raise exception 'Related dispute does not belong to communication case'; end if;
  if new.related_action_id is not null and not exists (
    select 1 from public.action_centre_items a where a.id=new.related_action_id and a.business_id=new.business_id and a.case_id=new.case_id
  ) then raise exception 'Related action does not belong to communication case'; end if;
  new.updated_at:=now();
  return new;
end;
$$;
drop trigger if exists communication_activity_scope_guard on public.communication_activities;
create trigger communication_activity_scope_guard before insert or update on public.communication_activities
  for each row execute function public.communication_activity_validate_scope();

insert into public.communication_activities (
  business_id,customer_id,case_id,channel,direction,status,started_at,
  completed_at,staff_user_id,metadata,idempotency_key
)
select
  c.business_id,c.debtor_id,r.case_id,
  case when r.sent_channel in ('whatsapp','email') then r.sent_channel else 'other' end,
  'outbound',
  case when r.status='failed' then 'failed'
       when r.status in ('sent','sent_manually') or r.manually_confirmed_at is not null then 'sent'
       else 'initiated' end,
  coalesce(r.composer_opened_at,r.manually_confirmed_at,r.sent_at,r.generated_at),
  case when r.status='failed' then coalesce(r.sent_at,r.generated_at) else null end,
  null,jsonb_build_object('source','reminder','reminder_id',r.id,'message_type',r.message_type),
  r.request_key
from public.reminders r join public.cases c on c.id=r.case_id
where (
    r.composer_opened_at is not null or r.manually_confirmed_at is not null
    or r.status in ('sent','sent_manually','failed')
  )
on conflict (business_id,idempotency_key) do nothing;

alter table public.communication_activities enable row level security;
create policy "communication_activities_owner_read" on public.communication_activities
  for select to authenticated using (
    exists (select 1 from public.businesses b where b.id=communication_activities.business_id and b.owner_id=auth.uid())
  );

create or replace function public.communication_activity_create(
  p_case_id text,p_channel text,p_direction text,p_status text default 'initiated',
  p_started_at timestamptz default null,p_external_reference text default null,
  p_duration_seconds integer default null,p_metadata jsonb default '{}'::jsonb,
  p_related_promise_id uuid default null,p_related_dispute_id uuid default null,
  p_related_action_id uuid default null,p_idempotency_key uuid default gen_random_uuid()
) returns public.communication_activities
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_case public.cases; v_activity public.communication_activities;
begin
  select c.* into v_case from public.cases c join public.businesses b on b.id=c.business_id
  where c.id=p_case_id and b.owner_id=auth.uid();
  if not found then raise exception 'Case not found'; end if;
  select ca.* into v_activity from public.communication_activities ca
  where ca.business_id=v_case.business_id and ca.idempotency_key=p_idempotency_key;
  if found then return v_activity; end if;
  insert into public.communication_activities (
    business_id,customer_id,case_id,channel,direction,status,started_at,staff_user_id,
    external_reference,duration_seconds,metadata,related_promise_id,related_dispute_id,
    related_action_id,idempotency_key
  ) values (
    v_case.business_id,v_case.debtor_id,v_case.id,p_channel,p_direction,p_status,
    coalesce(p_started_at,now()),auth.uid(),nullif(btrim(p_external_reference),''),
    p_duration_seconds,coalesce(p_metadata,'{}'::jsonb),p_related_promise_id,
    p_related_dispute_id,p_related_action_id,p_idempotency_key
  ) returning * into v_activity;
  insert into public.audit_logs (business_id,case_id,action,actor_type,actor_id,metadata)
  values (v_case.business_id,v_case.id,'communication.initiated','owner',auth.uid(),
    jsonb_build_object('activity_id',v_activity.id,'channel',v_activity.channel,'direction',v_activity.direction));
  return v_activity;
exception when unique_violation then
  select ca.* into v_activity from public.communication_activities ca
  where ca.business_id=v_case.business_id and ca.idempotency_key=p_idempotency_key;
  if found then return v_activity; end if;
  raise;
end;
$$;

create or replace function public.communication_activity_update(
  p_activity_id uuid,p_status text,p_outcome text default null,p_completed_at timestamptz default null,
  p_external_reference text default null,p_duration_seconds integer default null,
  p_metadata jsonb default '{}'::jsonb,p_related_promise_id uuid default null,
  p_related_dispute_id uuid default null,p_related_action_id uuid default null
) returns public.communication_activities
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_activity public.communication_activities;
begin
  select ca.* into v_activity from public.communication_activities ca
  join public.businesses b on b.id=ca.business_id
  where ca.id=p_activity_id and b.owner_id=auth.uid() for update of ca;
  if not found then raise exception 'Communication activity not found'; end if;
  if v_activity.status<>p_status and not (
    (v_activity.status='initiated' and p_status in ('sent','delivered','read','replied','failed','completed'))
    or (v_activity.status='sent' and p_status in ('delivered','read','replied','failed','completed'))
    or (v_activity.status='delivered' and p_status in ('read','replied','failed','completed'))
    or (v_activity.status='read' and p_status in ('replied','failed','completed'))
  ) then raise exception 'Invalid communication status transition'; end if;
  update public.communication_activities set
    status=p_status,outcome=coalesce(nullif(btrim(p_outcome),''),outcome),
    completed_at=case when p_status in ('replied','failed','completed') then coalesce(p_completed_at,completed_at,now()) else completed_at end,
    external_reference=coalesce(nullif(btrim(p_external_reference),''),external_reference),
    duration_seconds=coalesce(p_duration_seconds,duration_seconds),
    metadata=metadata||coalesce(p_metadata,'{}'::jsonb),
    related_promise_id=coalesce(p_related_promise_id,related_promise_id),
    related_dispute_id=coalesce(p_related_dispute_id,related_dispute_id),
    related_action_id=coalesce(p_related_action_id,related_action_id)
  where id=p_activity_id returning * into v_activity;
  insert into public.audit_logs (business_id,case_id,action,actor_type,actor_id,metadata)
  values (v_activity.business_id,v_activity.case_id,'communication.updated','owner',auth.uid(),
    jsonb_build_object('activity_id',v_activity.id,'status',v_activity.status,'outcome',v_activity.outcome));
  return v_activity;
end;
$$;
create or replace function public.communication_activity_counters(p_case_id text)
returns jsonb language plpgsql security definer stable set search_path=public,pg_temp as $$
declare v_case public.cases; v_case_counters jsonb; v_customer_counters jsonb;
begin
  select c.* into v_case from public.cases c join public.businesses b on b.id=c.business_id
  where c.id=p_case_id and b.owner_id=auth.uid();
  if not found then raise exception 'Case not found'; end if;
  select jsonb_build_object(
    'calls',count(*) filter (where channel='call'),
    'whatsapps',count(*) filter (where channel='whatsapp'),
    'emails',count(*) filter (where channel='email'),
    'last_contact_at',max(started_at) filter (where direction='outbound' and status<>'failed'),
    'last_response_at',max(coalesce(completed_at,started_at)) filter (where direction='inbound' or status='replied')
  ) into v_case_counters from public.communication_activities
  where business_id=v_case.business_id and case_id=v_case.id;
  if v_case.debtor_id is null then v_customer_counters:=v_case_counters;
  else
    select jsonb_build_object(
      'calls',count(*) filter (where channel='call'),
      'whatsapps',count(*) filter (where channel='whatsapp'),
      'emails',count(*) filter (where channel='email'),
      'last_contact_at',max(started_at) filter (where direction='outbound' and status<>'failed'),
      'last_response_at',max(coalesce(completed_at,started_at)) filter (where direction='inbound' or status='replied')
    ) into v_customer_counters from public.communication_activities
    where business_id=v_case.business_id and customer_id=v_case.debtor_id;
  end if;
  return jsonb_build_object('case',v_case_counters,'customer',v_customer_counters);
end;
$$;
revoke all on function public.communication_activity_create(text,text,text,text,timestamptz,text,integer,jsonb,uuid,uuid,uuid,uuid) from public;
grant execute on function public.communication_activity_create(text,text,text,text,timestamptz,text,integer,jsonb,uuid,uuid,uuid,uuid) to authenticated;
revoke all on function public.communication_activity_update(uuid,text,text,timestamptz,text,integer,jsonb,uuid,uuid,uuid) from public;
grant execute on function public.communication_activity_update(uuid,text,text,timestamptz,text,integer,jsonb,uuid,uuid,uuid) to authenticated;
revoke all on function public.communication_activity_counters(text) from public;
grant execute on function public.communication_activity_counters(text) to authenticated;

-- R11 contact frequency guardrails and documented customer preferences.
create table if not exists public.contact_frequency_policies (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  max_attempts_24h integer not null default 2 check (max_attempts_24h between 1 and 100),
  max_attempts_7d integer not null default 5 check (max_attempts_7d between 1 and 500),
  max_attempts_30d integer not null default 12 check (max_attempts_30d between 1 and 2000),
  frequency_mode text not null default 'warn' check (frequency_mode in ('warn','require_override')),
  preference_mode text not null default 'require_override' check (preference_mode in ('warn','require_override')),
  bulk_mode text not null default 'exclude' check (bulk_mode in ('exclude','require_override')),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  check (max_attempts_24h<=max_attempts_7d and max_attempts_7d<=max_attempts_30d)
);
insert into public.contact_frequency_policies(business_id) select id from public.businesses on conflict(business_id) do nothing;
create table if not exists public.contact_preferences (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_id uuid not null references public.debtors(id) on delete cascade,
  preferred_channel text check (preferred_channel is null or preferred_channel in ('whatsapp','call','email','portal','other')),
  preferred_time_start time,preferred_time_end time,
  email_only boolean not null default false,do_not_call boolean not null default false,
  wrong_number boolean not null default false,invalid_contact boolean not null default false,
  note text,documented_at timestamptz not null default now(),
  documented_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(business_id,customer_id),
  check ((preferred_time_start is null and preferred_time_end is null) or (preferred_time_start is not null and preferred_time_end is not null and preferred_time_start<>preferred_time_end)),
  check (not email_only or preferred_channel is null or preferred_channel='email')
);
create index if not exists contact_preferences_customer_idx on public.contact_preferences(business_id,customer_id);
create table if not exists public.contact_guard_overrides (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  customer_id uuid references public.debtors(id) on delete set null,
  case_id text not null references public.cases(id) on delete restrict,
  communication_activity_id uuid references public.communication_activities(id) on delete set null,
  action_item_id uuid references public.action_centre_items(id) on delete set null,
  channel text not null check(channel in ('whatsapp','call','email','portal','other')),
  is_bulk boolean not null default false,
  reason text not null check(char_length(btrim(reason)) between 3 and 500),
  evaluation jsonb not null check(jsonb_typeof(evaluation)='object'),
  overridden_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index if not exists contact_guard_overrides_case_idx on public.contact_guard_overrides(business_id,case_id,created_at desc);
create unique index if not exists contact_guard_overrides_activity_uidx on public.contact_guard_overrides(communication_activity_id) where communication_activity_id is not null and is_bulk=false;
alter table public.contact_frequency_policies enable row level security;
alter table public.contact_preferences enable row level security;
alter table public.contact_guard_overrides enable row level security;
create policy "contact_frequency_policies_owner_read" on public.contact_frequency_policies for select to authenticated using(business_id=public.my_business_id());
create policy "contact_preferences_owner_read" on public.contact_preferences for select to authenticated using(business_id=public.my_business_id());
create policy "contact_guard_overrides_owner_read" on public.contact_guard_overrides for select to authenticated using(business_id=public.my_business_id());

create or replace function public.contact_preferences_upsert(
  p_customer_id uuid,p_preferred_channel text default null,p_preferred_time_start time default null,
  p_preferred_time_end time default null,p_email_only boolean default false,p_do_not_call boolean default false,
  p_wrong_number boolean default false,p_invalid_contact boolean default false,p_note text default null
) returns public.contact_preferences language plpgsql security definer set search_path=public,pg_temp as $$
declare v_business_id uuid;v_row public.contact_preferences;
begin
  select d.business_id into v_business_id from public.debtors d join public.businesses b on b.id=d.business_id
  where d.id=p_customer_id and b.owner_id=auth.uid();
  if not found then raise exception 'Customer not found';end if;
  if p_email_only and p_preferred_channel is not null and p_preferred_channel<>'email' then raise exception 'Email-only preference requires email as the preferred channel';end if;
  insert into public.contact_preferences(business_id,customer_id,preferred_channel,preferred_time_start,preferred_time_end,email_only,do_not_call,wrong_number,invalid_contact,note,documented_at,documented_by)
  values(v_business_id,p_customer_id,p_preferred_channel,p_preferred_time_start,p_preferred_time_end,p_email_only,p_do_not_call,p_wrong_number,p_invalid_contact,nullif(btrim(p_note),''),now(),auth.uid())
  on conflict(business_id,customer_id) do update set preferred_channel=excluded.preferred_channel,
    preferred_time_start=excluded.preferred_time_start,preferred_time_end=excluded.preferred_time_end,
    email_only=excluded.email_only,do_not_call=excluded.do_not_call,wrong_number=excluded.wrong_number,
    invalid_contact=excluded.invalid_contact,note=excluded.note,documented_at=now(),documented_by=auth.uid(),updated_at=now()
  returning * into v_row;return v_row;
end;$$;
create or replace function public.contact_frequency_policy_upsert(
  p_max_attempts_24h integer,p_max_attempts_7d integer,p_max_attempts_30d integer,
  p_frequency_mode text,p_preference_mode text,p_bulk_mode text
) returns public.contact_frequency_policies language plpgsql security definer set search_path=public,pg_temp as $$
declare v_business_id uuid;v_row public.contact_frequency_policies;
begin
  select b.id into v_business_id from public.businesses b where b.owner_id=auth.uid();
  if not found then raise exception 'Business not found';end if;
  insert into public.contact_frequency_policies(business_id,max_attempts_24h,max_attempts_7d,max_attempts_30d,frequency_mode,preference_mode,bulk_mode,updated_by)
  values(v_business_id,p_max_attempts_24h,p_max_attempts_7d,p_max_attempts_30d,p_frequency_mode,p_preference_mode,p_bulk_mode,auth.uid())
  on conflict(business_id) do update set max_attempts_24h=excluded.max_attempts_24h,max_attempts_7d=excluded.max_attempts_7d,
    max_attempts_30d=excluded.max_attempts_30d,frequency_mode=excluded.frequency_mode,
    preference_mode=excluded.preference_mode,bulk_mode=excluded.bulk_mode,updated_by=auth.uid(),updated_at=now()
  returning * into v_row;return v_row;
end;$$;
create or replace function public.contact_guard_context(p_case_ids text[])
returns jsonb language plpgsql security definer stable set search_path=public,pg_temp as $$
declare v_result jsonb;v_owned_count integer;
begin
  if coalesce(array_length(p_case_ids,1),0)<1 or array_length(p_case_ids,1)>250 then raise exception 'Contact guard supports 1 to 250 cases';end if;
  select count(*) into v_owned_count from public.cases c join public.businesses b on b.id=c.business_id
  where c.id=any(p_case_ids) and b.owner_id=auth.uid();
  if v_owned_count<>cardinality(p_case_ids) then raise exception 'One or more cases were not found';end if;
  select coalesce(jsonb_object_agg(rows.case_id,rows.payload),'{}'::jsonb) into v_result from(
    select c.id case_id,jsonb_build_object(
      'case_id',c.id,'customer_id',c.debtor_id,'timezone',b.timezone,
      'counts',jsonb_build_object('attempts_24h',counts.attempts_24h,'attempts_7d',counts.attempts_7d,'attempts_30d',counts.attempts_30d),
      'policy',jsonb_build_object('max_attempts_24h',coalesce(fp.max_attempts_24h,2),'max_attempts_7d',coalesce(fp.max_attempts_7d,5),
        'max_attempts_30d',coalesce(fp.max_attempts_30d,12),'frequency_mode',coalesce(fp.frequency_mode,'warn'),
        'preference_mode',coalesce(fp.preference_mode,'require_override'),'bulk_mode',coalesce(fp.bulk_mode,'exclude')),
      'preferences',case when cp.id is null then null else jsonb_build_object(
        'id',cp.id,'business_id',cp.business_id,'customer_id',cp.customer_id,'preferred_channel',cp.preferred_channel,
        'preferred_time_start',cp.preferred_time_start,'preferred_time_end',cp.preferred_time_end,
        'email_only',cp.email_only,'do_not_call',cp.do_not_call,'wrong_number',cp.wrong_number,
        'invalid_contact',cp.invalid_contact,'note',cp.note,'documented_at',cp.documented_at,
        'documented_by',cp.documented_by,'created_at',cp.created_at,'updated_at',cp.updated_at) end) payload
    from public.cases c join public.businesses b on b.id=c.business_id and b.owner_id=auth.uid()
    left join public.contact_frequency_policies fp on fp.business_id=c.business_id
    left join public.contact_preferences cp on cp.business_id=c.business_id and cp.customer_id=c.debtor_id
    cross join lateral(select
      count(*) filter(where ca.started_at>=now()-interval '24 hours')::integer attempts_24h,
      count(*) filter(where ca.started_at>=now()-interval '7 days')::integer attempts_7d,
      count(*) filter(where ca.started_at>=now()-interval '30 days')::integer attempts_30d
      from public.communication_activities ca where ca.business_id=c.business_id and ca.direction='outbound'
      and((c.debtor_id is not null and ca.customer_id=c.debtor_id)or(c.debtor_id is null and ca.case_id=c.id)))counts
    where c.id=any(p_case_ids)
  )rows;
  return v_result;
end;$$;
create or replace function public.contact_guard_record_override(
  p_case_id text,p_communication_activity_id uuid,p_action_item_id uuid,p_channel text,
  p_is_bulk boolean,p_reason text,p_evaluation jsonb
) returns public.contact_guard_overrides language plpgsql security definer set search_path=public,pg_temp as $$
declare v_case public.cases;v_row public.contact_guard_overrides;
begin
  select c.* into v_case from public.cases c join public.businesses b on b.id=c.business_id where c.id=p_case_id and b.owner_id=auth.uid();
  if not found then raise exception 'Case not found';end if;
  if p_communication_activity_id is not null and not exists(select 1 from public.communication_activities ca where ca.id=p_communication_activity_id and ca.business_id=v_case.business_id and ca.case_id=v_case.id)then raise exception 'Communication activity does not belong to case';end if;
  if p_action_item_id is not null and not exists(select 1 from public.action_centre_items a where a.id=p_action_item_id and a.business_id=v_case.business_id and a.case_id=v_case.id)then raise exception 'Action item does not belong to case';end if;
  if p_communication_activity_id is not null then
    select o.* into v_row from public.contact_guard_overrides o where o.communication_activity_id=p_communication_activity_id and o.is_bulk=false;
    if found then return v_row;end if;
  end if;
  insert into public.contact_guard_overrides(business_id,customer_id,case_id,communication_activity_id,action_item_id,channel,is_bulk,reason,evaluation,overridden_by)
  values(v_case.business_id,v_case.debtor_id,v_case.id,p_communication_activity_id,p_action_item_id,p_channel,p_is_bulk,btrim(p_reason),p_evaluation,auth.uid())returning * into v_row;
  insert into public.audit_logs(business_id,case_id,action,actor_type,actor_id,metadata)
  values(v_case.business_id,v_case.id,'contact_guard.overridden','owner',auth.uid(),jsonb_build_object('override_id',v_row.id,'channel',p_channel,'is_bulk',p_is_bulk,'reason',btrim(p_reason)));
  return v_row;
end;$$;
revoke all on function public.contact_preferences_upsert(uuid,text,time,time,boolean,boolean,boolean,boolean,text) from public;
grant execute on function public.contact_preferences_upsert(uuid,text,time,time,boolean,boolean,boolean,boolean,text) to authenticated;
revoke all on function public.contact_frequency_policy_upsert(integer,integer,integer,text,text,text) from public;
grant execute on function public.contact_frequency_policy_upsert(integer,integer,integer,text,text,text) to authenticated;
revoke all on function public.contact_guard_context(text[]) from public;
grant execute on function public.contact_guard_context(text[]) to authenticated;
revoke all on function public.contact_guard_record_override(text,uuid,uuid,text,boolean,text,jsonb) from public;
grant execute on function public.contact_guard_record_override(text,uuid,uuid,text,boolean,text,jsonb) to authenticated;

-- R13: OTP-secured debtor payment access.
-- Apply after 20260805_receiving_account_security.sql and
-- 20260806_secure_payment_proof_flow.sql.
-- This migration is additive and preserves existing tokens, requests, proofs,
-- receiving accounts and financial history. It intentionally creates no anon
-- policies: public actions use token-validating server routes and service-role
-- RPCs.

create table if not exists public.payment_access_otp_challenges (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  case_id text not null references public.cases(id) on delete restrict,
  public_access_token_id uuid not null references public.public_access_tokens(id) on delete restrict,
  channel text not null check (channel in ('email','sms')),
  destination_hash char(64) not null,
  code_hash char(64) not null,
  requester_ip_hash char(64) not null,
  expires_at timestamptz not null,
  resend_available_at timestamptz not null,
  attempt_count smallint not null default 0 check (attempt_count between 0 and 5),
  max_attempts smallint not null default 5 check (max_attempts = 5),
  delivery_status text not null default 'pending' check (delivery_status in ('pending','sent','failed')),
  provider_reference text,
  consumed_at timestamptz,
  invalidated_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at and resend_available_at > created_at)
);
create index if not exists payment_access_otp_token_recent_idx
  on public.payment_access_otp_challenges(public_access_token_id,created_at desc);
create index if not exists payment_access_otp_ip_recent_idx
  on public.payment_access_otp_challenges(requester_ip_hash,created_at desc);

create table if not exists public.payment_access_sessions (
  id uuid primary key default gen_random_uuid(),
  session_hash char(64) not null unique,
  business_id uuid not null references public.businesses(id) on delete restrict,
  case_id text not null references public.cases(id) on delete restrict,
  public_access_token_id uuid not null references public.public_access_tokens(id) on delete restrict,
  otp_challenge_id uuid not null references public.payment_access_otp_challenges(id) on delete restrict,
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);
create index if not exists payment_access_sessions_token_active_idx
  on public.payment_access_sessions(public_access_token_id,expires_at)
  where revoked_at is null;

create table if not exists public.payment_access_suspicious_reports (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  case_id text not null references public.cases(id) on delete restrict,
  public_access_token_id uuid not null references public.public_access_tokens(id) on delete restrict,
  category text not null check (category in (
    'unrecognised_debt','creditor_details_wrong','payment_details_suspicious',
    'unexpected_link','other'
  )),
  details text check (details is null or char_length(details)<=1000),
  reporter_ip_hash char(64) not null,
  created_at timestamptz not null default now()
);
create index if not exists payment_access_suspicious_reports_business_idx
  on public.payment_access_suspicious_reports(business_id,created_at desc);

alter table public.public_payment_submissions
  add column if not exists payment_access_session_id uuid
    references public.payment_access_sessions(id) on delete restrict;

alter table public.payment_access_otp_challenges enable row level security;
alter table public.payment_access_sessions enable row level security;
alter table public.payment_access_suspicious_reports enable row level security;
drop policy if exists "payment_access_suspicious_reports_owner_read" on public.payment_access_suspicious_reports;
create policy "payment_access_suspicious_reports_owner_read"
  on public.payment_access_suspicious_reports for select to authenticated
  using (exists (
    select 1 from public.businesses b
    where b.id=payment_access_suspicious_reports.business_id and b.owner_id=auth.uid()
  ));
-- Challenge codes and session hashes deliberately have no browser read policy.

create or replace function public.payment_access_issue_otp(
  p_token_id uuid,p_business_id uuid,p_case_id text,p_channel text,
  p_destination_hash text,p_code_hash text,p_ip_hash text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_token public.public_access_tokens; v_case public.cases;
  v_latest public.payment_access_otp_challenges; v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('payment-otp:'||p_token_id::text,0));
  select * into v_token from public.public_access_tokens where id=p_token_id for update;
  select * into v_case from public.cases where id=p_case_id and business_id=p_business_id;
  if not found or v_token.id is null or v_token.case_id<>p_case_id or v_token.purpose<>'payment'
    or v_token.revoked_at is not null or v_token.consumed_at is not null
    or v_token.expires_at<=now() or v_token.receiving_account_id is null
    or v_case.status in ('closed','paid') or v_case.archived_at is not null
    or v_case.payment_lock_mode='manual'
    or not exists(select 1 from public.receiving_accounts ra
      where ra.id=v_token.receiving_account_id and ra.business_id=p_business_id
        and ra.is_active and ra.verification_status='verified') then
    return jsonb_build_object('status','unavailable');
  end if;
  if p_channel not in ('email','sms') or p_destination_hash!~'^[0-9a-f]{64}$'
    or p_code_hash!~'^[0-9a-f]{64}$' or p_ip_hash!~'^[0-9a-f]{64}$' then
    raise exception 'invalid OTP issue input';
  end if;
  if (select count(*) from public.payment_access_otp_challenges
      where public_access_token_id=p_token_id and created_at>now()-interval '10 minutes')>=5
    or (select count(*) from public.payment_access_otp_challenges
      where requester_ip_hash=p_ip_hash and created_at>now()-interval '1 hour')>=20 then
    return jsonb_build_object('status','rate_limited');
  end if;
  select * into v_latest from public.payment_access_otp_challenges
    where public_access_token_id=p_token_id and consumed_at is null
      and invalidated_at is null and delivery_status<>'failed'
    order by created_at desc limit 1;
  if found and v_latest.resend_available_at>now() then
    return jsonb_build_object('status','cooldown','retry_after',
      greatest(1,ceil(extract(epoch from v_latest.resend_available_at-now()))::integer));
  end if;
  update public.payment_access_otp_challenges set invalidated_at=now()
    where public_access_token_id=p_token_id and consumed_at is null and invalidated_at is null;
  insert into public.payment_access_otp_challenges(
    business_id,case_id,public_access_token_id,channel,destination_hash,
    code_hash,requester_ip_hash,expires_at,resend_available_at
  ) values(
    p_business_id,p_case_id,p_token_id,p_channel,p_destination_hash,
    p_code_hash,p_ip_hash,now()+interval '7 minutes',now()+interval '60 seconds'
  ) returning id into v_id;
  insert into public.payment_access_events(case_id,receiving_account_id,public_access_token_id,action,actor_type,metadata)
    values(p_case_id,v_token.receiving_account_id,p_token_id,'payment_access.otp_requested','debtor',
      jsonb_build_object('channel',p_channel,'challenge_id',v_id));
  return jsonb_build_object('status','issued','challenge_id',v_id,
    'expires_in',420,'resend_after',60);
end $$;

create or replace function public.payment_access_mark_otp_delivery(
  p_challenge_id uuid,p_sent boolean,p_provider_reference text default null
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update public.payment_access_otp_challenges set
    delivery_status=case when p_sent then 'sent' else 'failed' end,
    provider_reference=left(nullif(p_provider_reference,''),200),
    invalidated_at=case when p_sent then invalidated_at else coalesce(invalidated_at,now()) end
  where id=p_challenge_id and delivery_status='pending';
end $$;

create or replace function public.payment_access_verify_otp(
  p_token_id uuid,p_code_hash text,p_session_hash text,p_ip_hash text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_challenge public.payment_access_otp_challenges; v_token public.public_access_tokens;
  v_session_id uuid; v_remaining integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('payment-otp:'||p_token_id::text,0));
  if p_code_hash!~'^[0-9a-f]{64}$' or p_session_hash!~'^[0-9a-f]{64}$'
    or p_ip_hash!~'^[0-9a-f]{64}$' then
    return jsonb_build_object('status','invalid');
  end if;
  select * into v_token from public.public_access_tokens where id=p_token_id for update;
  if not found or v_token.purpose<>'payment' or v_token.revoked_at is not null
    or v_token.consumed_at is not null or v_token.expires_at<=now() then
    return jsonb_build_object('status','invalid');
  end if;
  select * into v_challenge from public.payment_access_otp_challenges
    where public_access_token_id=p_token_id and delivery_status='sent'
      and consumed_at is null and invalidated_at is null
    order by created_at desc limit 1 for update;
  if not found then return jsonb_build_object('status','invalid'); end if;
  if v_challenge.expires_at<=now() then
    update public.payment_access_otp_challenges set invalidated_at=now() where id=v_challenge.id;
    return jsonb_build_object('status','expired');
  end if;
  if v_challenge.attempt_count>=v_challenge.max_attempts then
    update public.payment_access_otp_challenges set invalidated_at=coalesce(invalidated_at,now()) where id=v_challenge.id;
    return jsonb_build_object('status','locked');
  end if;
  update public.payment_access_otp_challenges set attempt_count=attempt_count+1 where id=v_challenge.id;
  if v_challenge.code_hash<>p_code_hash then
    v_remaining:=v_challenge.max_attempts-v_challenge.attempt_count-1;
    if v_remaining<=0 then
      update public.payment_access_otp_challenges set invalidated_at=now() where id=v_challenge.id;
      return jsonb_build_object('status','locked','attempts_remaining',0);
    end if;
    return jsonb_build_object('status','invalid','attempts_remaining',v_remaining);
  end if;
  update public.payment_access_otp_challenges set consumed_at=now() where id=v_challenge.id;
  update public.payment_access_sessions set revoked_at=coalesce(revoked_at,now())
    where public_access_token_id=p_token_id and revoked_at is null;
  insert into public.payment_access_sessions(
    session_hash,business_id,case_id,public_access_token_id,otp_challenge_id,expires_at
  ) values(p_session_hash,v_challenge.business_id,v_challenge.case_id,p_token_id,v_challenge.id,now()+interval '15 minutes')
  returning id into v_session_id;
  if v_token.payment_access_request_id is not null then
    update public.payment_access_requests set otp_verified=true
      where id=v_token.payment_access_request_id and case_id=v_challenge.case_id;
  end if;
  insert into public.payment_access_events(case_id,receiving_account_id,public_access_token_id,action,actor_type,metadata)
    values(v_challenge.case_id,v_token.receiving_account_id,p_token_id,'payment_access.otp_verified','debtor',
      jsonb_build_object('channel',v_challenge.channel,'session_id',v_session_id));
  return jsonb_build_object('status','verified','session_id',v_session_id,'expires_in',900);
end $$;

create or replace function public.payment_access_validate_session(
  p_token_id uuid,p_session_hash text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_session public.payment_access_sessions; v_token public.public_access_tokens;
  v_case public.cases;
begin
  select * into v_session from public.payment_access_sessions
    where session_hash=p_session_hash and public_access_token_id=p_token_id
      and revoked_at is null and expires_at>now() order by created_at desc limit 1;
  if not found then return jsonb_build_object('valid',false); end if;
  select * into v_token from public.public_access_tokens where id=p_token_id;
  select * into v_case from public.cases where id=v_session.case_id and business_id=v_session.business_id;
  if v_token.id is null or v_token.purpose<>'payment' or v_token.revoked_at is not null
    or v_token.consumed_at is not null or v_token.expires_at<=now()
    or v_case.id is null or v_case.status in ('closed','paid') or v_case.archived_at is not null
    or v_case.payment_lock_mode='manual' or v_token.receiving_account_id is null
    or not exists(select 1 from public.receiving_accounts ra
      where ra.id=v_token.receiving_account_id and ra.business_id=v_session.business_id
        and ra.is_active and ra.verification_status='verified') then
    update public.payment_access_sessions set revoked_at=now() where id=v_session.id;
    return jsonb_build_object('valid',false);
  end if;
  update public.payment_access_sessions set last_used_at=now() where id=v_session.id;
  return jsonb_build_object('valid',true,'session_id',v_session.id,'expires_at',v_session.expires_at);
end $$;

create or replace function public.payment_access_report_suspicious(
  p_token_id uuid,p_business_id uuid,p_case_id text,p_category text,
  p_details text,p_ip_hash text
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid;
begin
  if p_category not in ('unrecognised_debt','creditor_details_wrong',
    'payment_details_suspicious','unexpected_link','other')
    or char_length(coalesce(p_details,''))>1000 or p_ip_hash!~'^[0-9a-f]{64}$'
    or not exists(select 1 from public.public_access_tokens t
      where t.id=p_token_id and t.case_id=p_case_id and t.purpose='payment'
        and t.revoked_at is null and t.expires_at>now())
    or not exists(select 1 from public.cases c where c.id=p_case_id and c.business_id=p_business_id) then
    raise exception 'invalid suspicious request report';
  end if;
  insert into public.payment_access_suspicious_reports(
    business_id,case_id,public_access_token_id,category,details,reporter_ip_hash
  ) values(p_business_id,p_case_id,p_token_id,p_category,nullif(btrim(p_details),''),p_ip_hash)
  returning id into v_id;
  insert into public.payment_access_events(case_id,public_access_token_id,action,actor_type,metadata)
    values(p_case_id,p_token_id,'payment_access.suspicious_reported','debtor',
      jsonb_build_object('category',p_category,'report_id',v_id));
  return v_id;
end $$;

-- Proof submission is permitted only through an active OTP session.
create or replace function public.validate_public_submission_token()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_token public.public_access_tokens; v_case public.cases;
  v_session public.payment_access_sessions;
begin
  select * into v_token from public.public_access_tokens where id=new.public_access_token_id for update;
  if not found or v_token.purpose<>'payment' or v_token.revoked_at is not null
    or v_token.consumed_at is not null or v_token.expires_at<=now()
    or v_token.receiving_account_id is null then raise exception 'payment token is not active'; end if;
  select * into v_case from public.cases where id=v_token.case_id;
  if not found or v_case.status in ('closed','paid') or v_case.archived_at is not null
    or v_case.outstanding_minor<=0 or v_case.payment_lock_mode='manual'
    then raise exception 'payment access is no longer available'; end if;
  select * into v_session from public.payment_access_sessions
    where id=new.payment_access_session_id and public_access_token_id=v_token.id
      and case_id=v_case.id and revoked_at is null and expires_at>now();
  if not found then raise exception 'verified payment session is required'; end if;
  if v_case.payment_lock_mode='approval' and (
    v_token.payment_access_request_id is null or not exists(
      select 1 from public.payment_access_requests r
      where r.id=v_token.payment_access_request_id and r.case_id=v_case.id
        and r.status='approved' and (r.expires_at is null or r.expires_at>now())
    )) then raise exception 'payment access approval is not active'; end if;
  new.business_id:=v_case.business_id;
  new.case_id:=v_case.id;
  new.debtor_id:=v_case.debtor_id;
  new.receiving_account_id:=v_token.receiving_account_id;
  new.invoice_reference:=v_case.invoice_no;
  if nullif(btrim(new.reference_no),'') is not null then
    perform pg_advisory_xact_lock(hashtextextended(
      concat(v_case.business_id,':',v_case.id,':',lower(btrim(new.reference_no))),0));
    if exists(
      select 1 from public.public_payment_submissions existing
      where existing.business_id=v_case.business_id and existing.case_id=v_case.id
        and lower(btrim(existing.reference_no))=lower(btrim(new.reference_no))
        and existing.status::text<>'rejected'
    ) then raise exception 'payment reference has already been submitted'; end if;
  end if;
  new.status:='submitted'::public.public_submission_status;
  return new;
end $$;

revoke all on function public.payment_access_issue_otp(uuid,uuid,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.payment_access_mark_otp_delivery(uuid,boolean,text) from public,anon,authenticated;
revoke all on function public.payment_access_verify_otp(uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.payment_access_validate_session(uuid,text) from public,anon,authenticated;
revoke all on function public.payment_access_report_suspicious(uuid,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.payment_access_issue_otp(uuid,uuid,text,text,text,text,text) to service_role;
grant execute on function public.payment_access_mark_otp_delivery(uuid,boolean,text) to service_role;
grant execute on function public.payment_access_verify_otp(uuid,text,text,text) to service_role;
grant execute on function public.payment_access_validate_session(uuid,text) to service_role;
grant execute on function public.payment_access_report_suspicious(uuid,uuid,text,text,text,text) to service_role;

-- Rollback:
-- 1. Deploy the previous application and trigger function first.
-- 2. Revoke active OTP sessions. Preserve suspicious reports and access events
--    if audit retention is required.
-- 3. Drop the five R13 RPCs, policy, indexes and three R13 tables, then remove
--    public_payment_submissions.payment_access_session_id.
-- R14: pragmatic business verification and abuse-reporting controls.
-- Apply after 20260820_otp_secure_payment_access.sql.
-- This migration does not assert government or regulatory verification. A
-- business becomes "verified" only through the service-role review function.

alter table public.businesses
  add column if not exists industry text not null default 'other',
  add column if not exists verification_state text not null default 'unverified',
  add column if not exists verification_submitted_at timestamptz,
  add column if not exists verified_at timestamptz,
  add column if not exists verification_public_note text,
  add column if not exists payment_links_restricted_until timestamptz,
  add column if not exists payment_link_restriction_reason text;

alter table public.businesses drop constraint if exists businesses_industry_check;
alter table public.businesses add constraint businesses_industry_check check (industry in (
  'general','professional_services','retail','construction','property',
  'education','healthcare','financial_services','financing_money_lending','other'
));
alter table public.businesses drop constraint if exists businesses_verification_state_check;
alter table public.businesses add constraint businesses_verification_state_check check (
  verification_state in ('unverified','pending','verified','rejected','restricted')
);
alter table public.businesses drop constraint if exists businesses_verification_timestamp_check;
alter table public.businesses add constraint businesses_verification_timestamp_check check (
  (verification_state='verified' and verified_at is not null)
  or (verification_state<>'verified' and verified_at is null)
);

create table if not exists public.business_risk_policies (
  industry text primary key check (industry in (
    'general','professional_services','retail','construction','property',
    'education','healthcare','financial_services','financing_money_lending','other'
  )),
  risk_level text not null check (risk_level in ('standard','elevated','high')),
  requires_additional_review boolean not null default false,
  requires_licence_reference boolean not null default false,
  payment_links_require_verified boolean not null default false,
  abuse_report_threshold integer not null default 3 check (abuse_report_threshold between 1 and 100),
  abuse_report_window_hours integer not null default 24 check (abuse_report_window_hours between 1 and 720),
  restriction_hours integer not null default 24 check (restriction_hours between 1 and 720),
  immediate_illegal_lending_restriction boolean not null default true,
  updated_by text not null default 'migration',
  updated_at timestamptz not null default now()
);

insert into public.business_risk_policies (
  industry,risk_level,requires_additional_review,requires_licence_reference,
  payment_links_require_verified,abuse_report_threshold,abuse_report_window_hours,
  restriction_hours,immediate_illegal_lending_restriction
) values
  ('general','standard',false,false,false,3,24,24,true),
  ('professional_services','standard',false,false,false,3,24,24,true),
  ('retail','standard',false,false,false,3,24,24,true),
  ('construction','standard',false,false,false,3,24,24,true),
  ('property','elevated',false,false,false,3,24,24,true),
  ('education','standard',false,false,false,3,24,24,true),
  ('healthcare','elevated',false,false,false,3,24,24,true),
  ('financial_services','elevated',true,false,true,2,24,48,true),
  ('financing_money_lending','high',true,true,true,1,24,72,true),
  ('other','standard',false,false,false,3,24,24,true)
on conflict (industry) do nothing;

create table if not exists public.business_risk_policy_events (
  id uuid primary key default gen_random_uuid(),
  industry text not null,
  event_type text not null check (event_type in ('created','updated')),
  actor_reference text not null,
  previous_policy jsonb,
  current_policy jsonb not null,
  created_at timestamptz not null default now()
);

create or replace function public.audit_business_risk_policy()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  insert into public.business_risk_policy_events(
    industry,event_type,actor_reference,previous_policy,current_policy
  ) values(
    new.industry,case when tg_op='INSERT' then 'created' else 'updated' end,
    coalesce(nullif(new.updated_by,''),'unknown'),
    case when tg_op='UPDATE' then to_jsonb(old) else null end,to_jsonb(new)
  );
  return new;
end $$;
drop trigger if exists business_risk_policy_audit_trigger on public.business_risk_policies;
create trigger business_risk_policy_audit_trigger
after insert or update on public.business_risk_policies
for each row execute function public.audit_business_risk_policy();

create or replace function public.reconcile_risk_policy_payment_links()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.payment_links_require_verified then
    update public.public_access_tokens t set revoked_at=coalesce(t.revoked_at,now())
    where t.purpose='payment' and t.revoked_at is null and t.consumed_at is null
      and exists(
        select 1 from public.cases c join public.businesses b on b.id=c.business_id
        where c.id=t.case_id and b.industry=new.industry and b.verification_state<>'verified'
      );
  end if;
  return new;
end $$;
drop trigger if exists business_risk_policy_payment_link_reconcile_trigger
  on public.business_risk_policies;
create trigger business_risk_policy_payment_link_reconcile_trigger
after insert or update of payment_links_require_verified on public.business_risk_policies
for each row execute function public.reconcile_risk_policy_payment_links();

create table if not exists public.business_verification_reviews (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  status text not null default 'submitted' check (
    status in ('submitted','under_review','verified','rejected','restricted')
  ),
  industry_snapshot text not null,
  risk_level text not null check (risk_level in ('standard','elevated','high')),
  requires_additional_review boolean not null,
  registration_document_reference text,
  licence_document_reference text,
  owner_note text,
  public_decision_reason text,
  internal_review_note text,
  submitted_by uuid references auth.users(id) on delete set null,
  reviewer_reference text,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check (registration_document_reference is null or char_length(registration_document_reference)<=500),
  check (licence_document_reference is null or char_length(licence_document_reference)<=500),
  check (owner_note is null or char_length(owner_note)<=1000),
  check (public_decision_reason is null or char_length(public_decision_reason)<=1000),
  check (internal_review_note is null or char_length(internal_review_note)<=2000)
);
create index if not exists business_verification_reviews_business_idx
  on public.business_verification_reviews(business_id,created_at desc);

create table if not exists public.business_verification_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  review_id uuid references public.business_verification_reviews(id) on delete restrict,
  from_state text,
  to_state text not null,
  actor_type text not null check (actor_type in ('owner','platform','system')),
  actor_reference text,
  public_reason text,
  internal_note text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now()
);
create index if not exists business_verification_events_business_idx
  on public.business_verification_events(business_id,created_at desc);

alter table public.payment_access_suspicious_reports
  add column if not exists tenant_review_status text not null default 'pending',
  add column if not exists tenant_reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists tenant_reviewed_at timestamptz,
  add column if not exists platform_review_required boolean not null default false,
  add column if not exists restriction_applied_until timestamptz;
alter table public.payment_access_suspicious_reports
  drop constraint if exists payment_access_suspicious_reports_category_check;
alter table public.payment_access_suspicious_reports
  add constraint payment_access_suspicious_reports_category_check check (category in (
    'do_not_recognise_business','do_not_recognise_amount','wrong_payment_details',
    'suspicious_payment_request','suspected_illegal_lending','other',
    'unrecognised_debt','creditor_details_wrong','payment_details_suspicious','unexpected_link'
  ));
alter table public.payment_access_suspicious_reports
  drop constraint if exists payment_access_suspicious_reports_tenant_review_status_check;
alter table public.payment_access_suspicious_reports
  add constraint payment_access_suspicious_reports_tenant_review_status_check check (
    tenant_review_status in ('pending','acknowledged','resolved')
  );

create table if not exists public.payment_access_report_events (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.payment_access_suspicious_reports(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  event_type text not null check (
    event_type in ('submitted','tenant_acknowledged','tenant_resolved',
      'platform_review_opened','platform_confirmed','platform_dismissed','restriction_applied','restriction_released')
  ),
  audience text not null check (audience in ('tenant','platform')),
  actor_type text not null check (actor_type in ('debtor','owner','platform','system')),
  actor_reference text,
  note text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now()
);
create index if not exists payment_access_report_events_report_idx
  on public.payment_access_report_events(report_id,created_at,id);

create table if not exists public.platform_abuse_review_queue (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null unique references public.payment_access_suspicious_reports(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  case_id text not null references public.cases(id) on delete restrict,
  priority text not null check (priority in ('normal','high','critical')),
  status text not null default 'open' check (status in ('open','in_review','confirmed','dismissed')),
  reason text not null,
  assigned_reference text,
  outcome_note text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists platform_abuse_review_queue_open_idx
  on public.platform_abuse_review_queue(priority,created_at)
  where status in ('open','in_review');

alter table public.business_risk_policies enable row level security;
alter table public.business_risk_policy_events enable row level security;
alter table public.business_verification_reviews enable row level security;
alter table public.business_verification_events enable row level security;
alter table public.payment_access_report_events enable row level security;
alter table public.platform_abuse_review_queue enable row level security;
-- Platform policies, internal notes and platform queue deliberately have no
-- browser policies. Owners receive explicitly selected safe fields via routes.
drop policy if exists "payment_access_report_events_owner_read" on public.payment_access_report_events;
create policy "payment_access_report_events_owner_read"
  on public.payment_access_report_events for select to authenticated
  using (
    audience='tenant' and exists(
      select 1 from public.businesses b
      where b.id=payment_access_report_events.business_id and b.owner_id=auth.uid()
    )
  );

create or replace function public.business_profile_verification_guard()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_owner_write boolean; v_material_change boolean; v_trusted_transition text;
begin
  v_owner_write:=auth.uid() is not null and auth.uid()=new.owner_id;
  v_trusted_transition:=current_setting('collectboss.verification_transition',true);
  if tg_op='INSERT' then
    if v_owner_write then
      new.verification_state:='unverified'; new.verification_submitted_at:=null;
      new.verified_at:=null; new.verification_public_note:=null;
      new.payment_links_restricted_until:=null; new.payment_link_restriction_reason:=null;
    end if;
    return new;
  end if;
  if v_trusted_transition='submit' then return new; end if;
  if not v_owner_write then return new; end if;
  v_material_change:=
    new.legal_name is distinct from old.legal_name
    or new.business_name is distinct from old.business_name
    or new.registration_no is distinct from old.registration_no
    or new.industry is distinct from old.industry;
  new.payment_links_restricted_until:=old.payment_links_restricted_until;
  new.payment_link_restriction_reason:=old.payment_link_restriction_reason;
  new.verification_public_note:=old.verification_public_note;
  new.verification_submitted_at:=old.verification_submitted_at;
  if old.verification_state in ('rejected','restricted') then
    new.verification_state:=old.verification_state; new.verified_at:=null;
  elsif v_material_change and old.verification_state='verified' then
    new.verification_state:='unverified'; new.verified_at:=null;
    new.verification_submitted_at:=null;
    new.verification_public_note:='Business identity changed. Submit a new CollectBoss review.';
  else
    new.verification_state:=old.verification_state; new.verified_at:=old.verified_at;
  end if;
  return new;
end $$;
drop trigger if exists business_profile_verification_guard_trigger on public.businesses;
create trigger business_profile_verification_guard_trigger
before insert or update on public.businesses
for each row execute function public.business_profile_verification_guard();

create or replace function public.business_payment_link_access(p_business_id uuid)
returns jsonb language plpgsql security definer stable set search_path=public,pg_temp as $$
declare v_business public.businesses; v_policy public.business_risk_policies;
begin
  select * into v_business from public.businesses where id=p_business_id;
  if not found then return jsonb_build_object('allowed',false,'reason','business_not_found'); end if;
  select * into v_policy from public.business_risk_policies where industry=v_business.industry;
  if v_business.verification_state in ('rejected','restricted') then
    return jsonb_build_object('allowed',false,'reason','business_restricted',
      'verification_state',v_business.verification_state);
  end if;
  if v_business.payment_links_restricted_until is not null
    and v_business.payment_links_restricted_until>now() then
    return jsonb_build_object('allowed',false,'reason','temporary_abuse_restriction',
      'restricted_until',v_business.payment_links_restricted_until);
  end if;
  if coalesce(v_policy.payment_links_require_verified,false)
    and v_business.verification_state<>'verified' then
    return jsonb_build_object('allowed',false,'reason','additional_review_required',
      'verification_state',v_business.verification_state);
  end if;
  return jsonb_build_object('allowed',true,'reason','allowed',
    'verification_state',v_business.verification_state,
    'risk_level',coalesce(v_policy.risk_level,'standard'));
end $$;

create or replace function public.reconcile_business_payment_link_access()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_access jsonb;
begin
  v_access:=public.business_payment_link_access(new.id);
  if not coalesce((v_access->>'allowed')::boolean,false) then
    update public.public_access_tokens set revoked_at=coalesce(revoked_at,now())
    where purpose='payment'
      and case_id in(select id from public.cases where business_id=new.id)
      and revoked_at is null and consumed_at is null;
  end if;
  return new;
end $$;
drop trigger if exists business_payment_link_reconcile_trigger on public.businesses;
create trigger business_payment_link_reconcile_trigger
after insert or update of industry,verification_state,payment_links_restricted_until
on public.businesses for each row
execute function public.reconcile_business_payment_link_access();

create or replace function public.business_verification_submit(
  p_registration_document_reference text default null,
  p_licence_document_reference text default null,
  p_owner_note text default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_business public.businesses; v_policy public.business_risk_policies;
  v_review_id uuid; v_old_state text;
begin
  select * into v_business from public.businesses where owner_id=auth.uid() for update;
  if not found then raise exception 'Business not found'; end if;
  if v_business.verification_state='restricted' then
    raise exception 'Business is restricted pending platform review'; end if;
  if v_business.verification_state='pending' and exists(
    select 1 from public.business_verification_reviews r
    where r.business_id=v_business.id and r.status in ('submitted','under_review')
  ) then raise exception 'Verification review is already pending'; end if;
  select * into v_policy from public.business_risk_policies where industry=v_business.industry;
  if v_business.account_type='business' and nullif(btrim(v_business.registration_no),'') is null
    then raise exception 'Registration identifier is required'; end if;
  if coalesce(v_policy.requires_licence_reference,false)
    and nullif(btrim(coalesce(p_licence_document_reference,'')),'') is null
    then raise exception 'Licence reference is required for this industry'; end if;
  if char_length(coalesce(p_registration_document_reference,''))>500
    or char_length(coalesce(p_licence_document_reference,''))>500
    or char_length(coalesce(p_owner_note,''))>1000 then raise exception 'Verification input is too long'; end if;
  v_old_state:=v_business.verification_state;
  insert into public.business_verification_reviews(
    business_id,industry_snapshot,risk_level,requires_additional_review,
    registration_document_reference,licence_document_reference,owner_note,submitted_by
  ) values(
    v_business.id,v_business.industry,coalesce(v_policy.risk_level,'standard'),
    coalesce(v_policy.requires_additional_review,false),
    nullif(btrim(p_registration_document_reference),''),
    nullif(btrim(p_licence_document_reference),''),
    nullif(btrim(p_owner_note),''),auth.uid()
  ) returning id into v_review_id;
  perform set_config('collectboss.verification_transition','submit',true);
  update public.businesses set verification_state='pending',
    verification_submitted_at=now(),verified_at=null,
    verification_public_note='Verification review submitted.'
  where id=v_business.id;
  insert into public.business_verification_events(
    business_id,review_id,from_state,to_state,actor_type,actor_reference,public_reason,metadata
  ) values(v_business.id,v_review_id,v_old_state,'pending','owner',auth.uid()::text,
    'Verification review submitted.',
    jsonb_build_object('industry',v_business.industry,'risk_level',coalesce(v_policy.risk_level,'standard')));
  if coalesce(v_policy.payment_links_require_verified,false) then
    update public.public_access_tokens set revoked_at=coalesce(revoked_at,now())
    where purpose='payment' and case_id in(select id from public.cases where business_id=v_business.id)
      and revoked_at is null and consumed_at is null;
  end if;
  return jsonb_build_object('review_id',v_review_id,'state','pending',
    'requires_additional_review',coalesce(v_policy.requires_additional_review,false));
end $$;

create or replace function public.business_verification_decide(
  p_review_id uuid,p_decision text,p_reviewer_reference text,
  p_public_reason text,p_internal_note text default null,
  p_restricted_until timestamptz default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_review public.business_verification_reviews; v_business public.businesses;
  v_policy public.business_risk_policies; v_old_state text;
begin
  if p_decision not in ('verified','rejected','restricted')
    or char_length(btrim(coalesce(p_reviewer_reference,'')))<3
    or char_length(btrim(coalesce(p_public_reason,'')))<3 then
    raise exception 'Invalid verification decision'; end if;
  select * into v_review from public.business_verification_reviews where id=p_review_id for update;
  if not found or v_review.status in ('verified','rejected','restricted')
    then raise exception 'Verification review is not open'; end if;
  select * into v_business from public.businesses where id=v_review.business_id for update;
  select * into v_policy from public.business_risk_policies where industry=v_review.industry_snapshot;
  if p_decision='verified' and coalesce(v_policy.requires_licence_reference,false)
    and nullif(btrim(coalesce(v_review.licence_document_reference,'')),'') is null
    then raise exception 'Required licence review evidence is missing'; end if;
  v_old_state:=v_business.verification_state;
  update public.business_verification_reviews set status=p_decision,
    reviewer_reference=btrim(p_reviewer_reference),public_decision_reason=btrim(p_public_reason),
    internal_review_note=nullif(btrim(p_internal_note),''),reviewed_at=now()
  where id=p_review_id;
  update public.businesses set verification_state=p_decision,
    verified_at=case when p_decision='verified' then now() else null end,
    verification_public_note=btrim(p_public_reason),
    payment_links_restricted_until=case when p_decision='restricted'
      then coalesce(p_restricted_until,now()+interval '72 hours')
      else payment_links_restricted_until end,
    payment_link_restriction_reason=case when p_decision='restricted'
      then 'platform_verification_restriction' else payment_link_restriction_reason end
  where id=v_business.id;
  if p_decision in ('rejected','restricted') then
    update public.public_access_tokens set revoked_at=coalesce(revoked_at,now())
    where purpose='payment' and case_id in(select id from public.cases where business_id=v_business.id)
      and revoked_at is null and consumed_at is null;
  end if;
  insert into public.business_verification_events(
    business_id,review_id,from_state,to_state,actor_type,actor_reference,
    public_reason,internal_note,metadata
  ) values(v_business.id,p_review_id,v_old_state,p_decision,'platform',
    btrim(p_reviewer_reference),btrim(p_public_reason),nullif(btrim(p_internal_note),''),
    jsonb_build_object('risk_level',v_review.risk_level));
  return jsonb_build_object('business_id',v_business.id,'state',p_decision);
end $$;

create or replace function public.enforce_public_payment_token_business_controls()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_business_id uuid; v_access jsonb;
begin
  if new.purpose<>'payment' or new.revoked_at is not null or new.consumed_at is not null then return new; end if;
  select business_id into v_business_id from public.cases where id=new.case_id;
  if not found then raise exception 'Payment-link case not found'; end if;
  v_access:=public.business_payment_link_access(v_business_id);
  if not coalesce((v_access->>'allowed')::boolean,false) then
    raise exception 'Payment links are unavailable: %',coalesce(v_access->>'reason','restricted');
  end if;
  return new;
end $$;
drop trigger if exists public_payment_token_business_controls_trigger on public.public_access_tokens;
create trigger public_payment_token_business_controls_trigger
before insert or update of case_id,purpose,revoked_at,consumed_at on public.public_access_tokens
for each row execute function public.enforce_public_payment_token_business_controls();

create or replace function public.payment_access_report_suspicious(
  p_token_id uuid,p_business_id uuid,p_case_id text,p_category text,
  p_details text,p_ip_hash text
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid; v_business public.businesses; v_policy public.business_risk_policies;
  v_recent integer; v_platform boolean; v_restrict boolean; v_until timestamptz;
begin
  if p_category not in (
    'do_not_recognise_business','do_not_recognise_amount','wrong_payment_details',
    'suspicious_payment_request','suspected_illegal_lending','other'
  ) or char_length(coalesce(p_details,''))>1000 or p_ip_hash!~'^[0-9a-f]{64}$'
    or not exists(select 1 from public.public_access_tokens t
      where t.id=p_token_id and t.case_id=p_case_id and t.purpose='payment'
        and t.revoked_at is null and t.expires_at>now())
    or not exists(select 1 from public.cases c where c.id=p_case_id and c.business_id=p_business_id)
    then raise exception 'invalid suspicious request report'; end if;
  select * into v_business from public.businesses where id=p_business_id for update;
  select * into v_policy from public.business_risk_policies where industry=v_business.industry;
  select count(*)::integer into v_recent from public.payment_access_suspicious_reports r
    where r.business_id=p_business_id
      and r.created_at>now()-make_interval(hours=>coalesce(v_policy.abuse_report_window_hours,24));
  v_recent:=v_recent+1;
  v_platform:=p_category='suspected_illegal_lending'
    or v_recent>=coalesce(v_policy.abuse_report_threshold,3)
    or coalesce(v_policy.risk_level,'standard')='high';
  v_restrict:=(p_category='suspected_illegal_lending'
      and coalesce(v_policy.immediate_illegal_lending_restriction,true))
    or v_recent>=coalesce(v_policy.abuse_report_threshold,3);
  if v_restrict then v_until:=now()+make_interval(hours=>coalesce(v_policy.restriction_hours,24)); end if;
  insert into public.payment_access_suspicious_reports(
    business_id,case_id,public_access_token_id,category,details,reporter_ip_hash,
    platform_review_required,restriction_applied_until
  ) values(
    p_business_id,p_case_id,p_token_id,p_category,nullif(btrim(p_details),''),p_ip_hash,
    v_platform,v_until
  ) returning id into v_id;
  insert into public.payment_access_report_events(
    report_id,business_id,event_type,audience,actor_type,metadata
  ) values(v_id,p_business_id,'submitted','tenant','debtor',
    jsonb_build_object('category',p_category));
  insert into public.notifications(
    business_id,case_id,type,event_type,title,message,entity_type,entity_id,
    severity,action_url,dedupe_key
  ) values(
    p_business_id,p_case_id,'payment_access.suspicious_reported',
    'payment_access.suspicious_reported','Payment-link safety report',
    'A debtor reported a concern about a payment request.','payment_access_report',v_id,
    case when v_platform then 'high' else 'medium' end,'/settings#trust-safety',
    'payment-access-report:'||v_id::text
  ) on conflict(business_id,dedupe_key) do nothing;
  insert into public.action_centre_items(
    business_id,case_id,type,title,description,href,entity_type,entity_id,status,
    reason,amount_minor,priority,recommended_action,dedupe_key
  ) values(
    p_business_id,p_case_id,'review_payment_access_report','Review payment-link safety report',
    'Review the debtor report and verify the case and receiving details.',
    '/settings#trust-safety','payment_access_report',v_id,'open',
    'A debtor reported a payment-link concern.',0,
    case when v_platform then 'high' else 'medium' end,
    'Review the report and pause contact if the request may be incorrect.',
    'payment-access-report:'||v_id::text
  ) on conflict(business_id,dedupe_key) do nothing;
  if v_platform then
    insert into public.platform_abuse_review_queue(
      report_id,business_id,case_id,priority,reason
    ) values(
      v_id,p_business_id,p_case_id,
      case when p_category='suspected_illegal_lending' then 'critical' else 'high' end,
      case when p_category='suspected_illegal_lending'
        then 'Suspected illegal lending report' else 'Risk-policy report threshold reached' end
    ) on conflict(report_id) do nothing;
    insert into public.payment_access_report_events(
      report_id,business_id,event_type,audience,actor_type,metadata
    ) values(v_id,p_business_id,'platform_review_opened','platform','system',
      jsonb_build_object('category',p_category,'recent_reports',v_recent));
  end if;
  if v_restrict then
    update public.businesses set
      payment_links_restricted_until=greatest(coalesce(payment_links_restricted_until,v_until),v_until),
      payment_link_restriction_reason='automated_abuse_report_policy'
    where id=p_business_id;
    update public.public_access_tokens set revoked_at=coalesce(revoked_at,now())
    where purpose='payment' and case_id in(select id from public.cases where business_id=p_business_id)
      and revoked_at is null and consumed_at is null;
    insert into public.payment_access_report_events(
      report_id,business_id,event_type,audience,actor_type,metadata
    ) values(v_id,p_business_id,'restriction_applied','tenant','system',
      jsonb_build_object('restricted_until',v_until,'policy','risk_based'));
  end if;
  insert into public.payment_access_events(case_id,public_access_token_id,action,actor_type,metadata)
    values(p_case_id,p_token_id,'payment_access.suspicious_reported','debtor',
      jsonb_build_object('category',p_category,'report_id',v_id,'platform_review',v_platform));
  return v_id;
end $$;

create or replace function public.payment_access_report_tenant_review(
  p_report_id uuid,p_action text,p_note text default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_report public.payment_access_suspicious_reports; v_business public.businesses;
  v_status text; v_action_id uuid; v_action_status text;
begin
  if p_action not in ('acknowledged','resolved') or char_length(coalesce(p_note,''))>1000
    then raise exception 'Invalid report review action'; end if;
  select r.* into v_report from public.payment_access_suspicious_reports r
    join public.businesses b on b.id=r.business_id and b.owner_id=auth.uid()
    where r.id=p_report_id for update;
  if not found then raise exception 'Report not found'; end if;
  v_status:=p_action;
  update public.payment_access_suspicious_reports set tenant_review_status=v_status,
    tenant_reviewed_by=auth.uid(),tenant_reviewed_at=now() where id=p_report_id;
  insert into public.payment_access_report_events(
    report_id,business_id,event_type,audience,actor_type,actor_reference,note
  ) values(p_report_id,v_report.business_id,'tenant_'||p_action,'tenant','owner',
    auth.uid()::text,nullif(btrim(p_note),''));
  if p_action='resolved' then
    select id,status into v_action_id,v_action_status from public.action_centre_items
    where business_id=v_report.business_id and entity_type='payment_access_report'
      and entity_id=p_report_id and status in ('open','in_progress','snoozed') for update;
    if found then
      update public.action_centre_items set
        status='completed',completed_at=now(),snoozed_until=null where id=v_action_id;
      insert into public.action_centre_item_events(
        action_item_id,business_id,case_id,actor_type,actor_id,event_type,
        from_status,to_status,metadata
      ) values(v_action_id,v_report.business_id,v_report.case_id,'owner',auth.uid(),
        'completed',v_action_status,'completed',jsonb_build_object('report_id',p_report_id));
    end if;
  end if;
  return jsonb_build_object('report_id',p_report_id,'tenant_review_status',v_status);
end $$;

create or replace function public.payment_access_report_platform_review(
  p_report_id uuid,p_decision text,p_reviewer_reference text,p_note text,
  p_restricted_until timestamptz default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_report public.payment_access_suspicious_reports; v_event text;
begin
  if p_decision not in ('confirmed','dismissed','restricted')
    or char_length(btrim(coalesce(p_reviewer_reference,'')))<3
    or char_length(btrim(coalesce(p_note,'')))<3 then raise exception 'Invalid platform review'; end if;
  select * into v_report from public.payment_access_suspicious_reports where id=p_report_id for update;
  if not found then raise exception 'Report not found'; end if;
  v_event:=case when p_decision='dismissed' then 'platform_dismissed' else 'platform_confirmed' end;
  update public.platform_abuse_review_queue set
    status=case when p_decision='dismissed' then 'dismissed' else 'confirmed' end,
    assigned_reference=btrim(p_reviewer_reference),outcome_note=btrim(p_note),
    reviewed_at=now(),updated_at=now() where report_id=p_report_id;
  if p_decision='restricted' then
    update public.businesses set verification_state='restricted',verified_at=null,
      verification_public_note='Payment-link access restricted after safety review.',
      payment_links_restricted_until=coalesce(p_restricted_until,now()+interval '72 hours'),
      payment_link_restriction_reason='platform_abuse_review'
    where id=v_report.business_id;
    update public.public_access_tokens set revoked_at=coalesce(revoked_at,now())
    where purpose='payment' and case_id in(select id from public.cases where business_id=v_report.business_id)
      and revoked_at is null and consumed_at is null;
  end if;
  insert into public.payment_access_report_events(
    report_id,business_id,event_type,audience,actor_type,actor_reference,note,metadata
  ) values(p_report_id,v_report.business_id,v_event,'platform','platform',
    btrim(p_reviewer_reference),btrim(p_note),jsonb_build_object('decision',p_decision));
  return jsonb_build_object('report_id',p_report_id,'decision',p_decision);
end $$;

revoke all on function public.business_payment_link_access(uuid) from public,anon,authenticated;
revoke all on function public.business_verification_submit(text,text,text) from public,anon;
revoke all on function public.business_verification_decide(uuid,text,text,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.payment_access_report_suspicious(uuid,uuid,text,text,text,text) from public,anon,authenticated;
revoke all on function public.payment_access_report_tenant_review(uuid,text,text) from public,anon;
revoke all on function public.payment_access_report_platform_review(uuid,text,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.audit_business_risk_policy() from public,anon,authenticated;
revoke all on function public.reconcile_risk_policy_payment_links() from public,anon,authenticated;
revoke all on function public.business_profile_verification_guard() from public,anon,authenticated;
revoke all on function public.reconcile_business_payment_link_access() from public,anon,authenticated;
revoke all on function public.enforce_public_payment_token_business_controls() from public,anon,authenticated;
grant execute on function public.business_payment_link_access(uuid) to service_role;
grant execute on function public.business_verification_submit(text,text,text) to authenticated;
grant execute on function public.business_verification_decide(uuid,text,text,text,text,timestamptz) to service_role;
grant execute on function public.payment_access_report_suspicious(uuid,uuid,text,text,text,text) to service_role;
grant execute on function public.payment_access_report_tenant_review(uuid,text,text) to authenticated;
grant execute on function public.payment_access_report_platform_review(uuid,text,text,text,timestamptz) to service_role;


-- Rollback:
-- 1. Deploy the previous application and restore the R13 suspicious-report RPC.
-- 2. Revoke active platform decisions only through an audited operational
--    decision; do not silently delete abuse or verification audit history.
-- 3. Drop R14 triggers/RPCs/policies/tables, restore the R13 category
--    constraint, and remove the added report/business columns if retention and
--    legal requirements allow it.

-- R15 canonical additions. Executable deployment DDL is reviewed in
-- 20260822_roles_permissions_audit.sql.
create table if not exists public.business_memberships (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  invited_email text,
  role text not null check(role in('owner','admin','manager','staff','viewer')),
  status text not null default 'invited' check(status in('invited','active','suspended','revoked')),
  invited_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(user_id is not null or nullif(btrim(invited_email),'') is not null)
);
create table if not exists public.business_role_settings (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  manager_can_approve_settlements boolean not null default false,
  manager_can_approve_write_offs boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.audit_logs
  add column if not exists entity_type text,
  add column if not exists entity_id text,
  add column if not exists before_summary jsonb,
  add column if not exists after_summary jsonb,
  add column if not exists actor_role text,
  add column if not exists request_id text,
  add column if not exists session_id text,
  add column if not exists request_metadata jsonb not null default '{}'::jsonb;
-- Membership backfill, permission helpers, immutable audit trigger, indexes,
-- grants and final policies are intentionally kept in the ordered R15 migration.

-- R16 operational search, import, bulk-action and duplicate-merge structures.
-- Transactional RPC bodies, grants and rollback-sensitive merge logic are kept
-- in the reviewed ordered migration below:
-- supabase/migrations/20260824_bulk_operations_search_import_merge.sql
-- R16: tenant-scoped operational search, imports, bulk actions and controlled duplicate merge.
-- Review after 20260822_roles_permissions_audit.sql.

create extension if not exists pg_trgm;

alter table public.cases
  add column if not exists priority text not null default 'medium',
  add column if not exists assigned_to uuid references auth.users(id) on delete set null,
  add column if not exists next_follow_up_at timestamptz,
  add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.cases drop constraint if exists cases_priority_check;
alter table public.cases add constraint cases_priority_check
  check (priority in ('low','medium','high','urgent'));
alter table public.cases drop constraint if exists cases_metadata_object_check;
alter table public.cases add constraint cases_metadata_object_check
  check (jsonb_typeof(metadata)='object');

alter table public.debtors
  add column if not exists merged_into_id uuid references public.debtors(id) on delete restrict,
  add column if not exists merged_at timestamptz,
  add column if not exists merged_by uuid references auth.users(id) on delete set null,
  add column if not exists merge_reason text;
alter table public.debtors drop constraint if exists debtors_merge_state_check;
alter table public.debtors add constraint debtors_merge_state_check check (
  (merged_into_id is null and merged_at is null and merged_by is null)
  or (merged_into_id is not null and merged_at is not null and archived_at is not null)
);

create index if not exists cases_operational_filter_idx
  on public.cases(business_id,status,priority,due_date,next_follow_up_at)
  where archived_at is null;
create index if not exists cases_assignee_idx
  on public.cases(business_id,assigned_to,status) where archived_at is null;
create index if not exists cases_id_trgm_idx on public.cases using gin(lower(id) gin_trgm_ops);
create index if not exists cases_debtor_name_trgm_idx on public.cases using gin(lower(debtor_name) gin_trgm_ops);
create index if not exists cases_debtor_company_trgm_idx on public.cases using gin(lower(coalesce(debtor_company,'')) gin_trgm_ops);
create index if not exists cases_contact_trgm_idx
  on public.cases using gin(lower(coalesce(debtor_phone,'')||' '||coalesce(debtor_email,'')) gin_trgm_ops);
create index if not exists cases_phone_trgm_idx on public.cases using gin(lower(coalesce(debtor_phone,'')) gin_trgm_ops);
create index if not exists cases_email_trgm_idx on public.cases using gin(lower(coalesce(debtor_email,'')) gin_trgm_ops);
create index if not exists cases_invoice_trgm_idx on public.cases using gin(lower(coalesce(invoice_no,'')) gin_trgm_ops);
create index if not exists cases_metadata_gin_idx on public.cases using gin(metadata jsonb_path_ops);
create index if not exists cases_metadata_search_idx
  on public.cases using gin(to_tsvector('simple',metadata::text));
create index if not exists debtors_identity_search_trgm_idx on public.debtors using gin(
  lower(coalesce(individual_name,'')||' '||coalesce(business_name,'')||' '||
    coalesce(contact_name,'')||' '||coalesce(registration_no,'')||' '||
    coalesce(phone,'')||' '||coalesce(email,'')) gin_trgm_ops
);
create index if not exists customer_accounts_number_trgm_idx
  on public.customer_accounts using gin(lower(coalesce(account_number,'')||' '||display_name) gin_trgm_ops);
create index if not exists customer_accounts_metadata_search_idx
  on public.customer_accounts using gin(to_tsvector('simple',metadata::text||' '||custom_fields::text));
create index if not exists obligations_reference_trgm_idx
  on public.obligations using gin(lower(reference||' '||coalesce(purchase_order_reference,'')) gin_trgm_ops);
create index if not exists obligations_metadata_search_idx
  on public.obligations using gin(to_tsvector('simple',metadata::text||' '||custom_fields::text));

create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  file_name text not null,
  file_type text not null check (file_type in ('csv','xlsx')),
  status text not null check (status in ('dry_run','ready','committing','committed','failed')),
  total_rows integer not null default 0 check (total_rows>=0),
  valid_rows integer not null default 0 check (valid_rows>=0),
  invalid_rows integer not null default 0 check (invalid_rows>=0),
  duplicate_rows integer not null default 0 check (duplicate_rows>=0),
  mapping jsonb not null default '{}'::jsonb check (jsonb_typeof(mapping)='object'),
  created_by uuid not null references auth.users(id) on delete restrict,
  committed_at timestamptz,
  error_summary text,
  created_at timestamptz not null default now()
);
create index if not exists import_batches_business_created_idx
  on public.import_batches(business_id,created_at desc);

create table if not exists public.import_errors (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.import_batches(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete restrict,
  row_number integer not null check (row_number>=1),
  error_code text not null,
  message text not null,
  raw_row jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists import_errors_batch_row_idx
  on public.import_errors(batch_id,row_number);

alter table public.import_batches enable row level security;
alter table public.import_errors enable row level security;
drop policy if exists "import_batches_role_read" on public.import_batches;
create policy "import_batches_role_read" on public.import_batches for select to authenticated
  using(public.has_business_permission(business_id,'case.read'));
drop policy if exists "import_errors_role_read" on public.import_errors;
create policy "import_errors_role_read" on public.import_errors for select to authenticated
  using(public.has_business_permission(business_id,'case.read'));
-- Batch/error writes are server-only so dry runs and failed commits can be
-- reported without granting browser mutation rights.
-- ─── R18 organization and business entity readiness ──────────────────────────
-- Optional only: business_id remains the financial owner and existing rows keep
-- a null business_entity_id until a future entity-management workflow assigns it.
create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (nullif(btrim(name),'') is not null),
  registration_no text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists organization_business_relationships (
  organization_id uuid not null references organizations(id) on delete restrict,
  business_id uuid not null references businesses(id) on delete cascade,
  relationship_type text not null default 'primary'
    check (relationship_type in ('primary','subsidiary','affiliate','franchise','managed')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (organization_id,business_id),
  unique (business_id)
);
create table if not exists business_entities (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  organization_id uuid,
  parent_entity_id uuid,
  entity_type text not null default 'branch'
    check (entity_type in ('legal_entity','branch','division','location','other')),
  name text not null check (nullif(btrim(name),'') is not null),
  code text,
  legal_name text,
  registration_no text,
  address text,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id,business_id),
  unique nulls not distinct (business_id,code),
  check (parent_entity_id is null or parent_entity_id<>id),
  constraint business_entities_parent_tenant_fk
    foreign key (parent_entity_id,business_id) references business_entities(id,business_id) on delete restrict,
  constraint business_entities_organization_business_fk
    foreign key (organization_id,business_id)
    references organization_business_relationships(organization_id,business_id) on delete restrict
);
alter table customer_accounts add constraint customer_accounts_business_entity_tenant_fk
  foreign key (business_entity_id,business_id) references business_entities(id,business_id) on delete restrict;
alter table obligations add constraint obligations_business_entity_tenant_fk
  foreign key (business_entity_id,business_id) references business_entities(id,business_id) on delete restrict;
alter table cases add constraint cases_business_entity_tenant_fk
  foreign key (business_entity_id,business_id) references business_entities(id,business_id) on delete restrict;
alter table receiving_accounts add constraint receiving_accounts_business_entity_tenant_fk
  foreign key (business_entity_id,business_id) references business_entities(id,business_id) on delete restrict;
create index if not exists organization_business_relationships_business_idx
  on organization_business_relationships(business_id,organization_id);
create index if not exists business_entities_business_parent_idx
  on business_entities(business_id,parent_entity_id,entity_type) where is_active;
create index if not exists customer_accounts_business_entity_idx
  on customer_accounts(business_id,business_entity_id) where business_entity_id is not null;
create index if not exists obligations_business_entity_idx
  on obligations(business_id,business_entity_id,status) where business_entity_id is not null;
create index if not exists cases_business_entity_idx
  on cases(business_id,business_entity_id,status) where business_entity_id is not null;
create index if not exists receiving_accounts_business_entity_idx
  on receiving_accounts(business_id,business_entity_id) where business_entity_id is not null;
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
revoke all on organizations,organization_business_relationships,business_entities from anon;
grant select on organizations,organization_business_relationships,business_entities to authenticated;
grant all on organizations,organization_business_relationships,business_entities to service_role;

-- I04 accounting integration framework (Xero + QuickBooks Online).
-- This is a forward-only proposal. Review in staging before applying. OAuth
-- ciphertext is deliberately inaccessible to authenticated browser clients.
begin;

create extension if not exists pgcrypto;

create table if not exists public.accounting_connections (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  provider text not null check (provider in ('xero','quickbooks','bukku','autocount')),
  status text not null default 'pending' check (status in ('pending','connected','error','disconnected','revoked')),
  external_tenant_id text,
  organization_name text,
  scopes text[] not null default array[]::text[],
  access_token_ciphertext text,
  refresh_token_ciphertext text,
  token_expires_at timestamptz,
  last_successful_sync_at timestamptz,
  last_attempted_sync_at timestamptz,
  last_cursor text,
  last_error_code text,
  last_error_message text,
  disconnected_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id,provider),
  unique (id,business_id),
  constraint accounting_connections_credentials_check check (
    status not in ('connected','error') or
    (external_tenant_id is not null and access_token_ciphertext is not null and refresh_token_ciphertext is not null)
  )
);
create unique index if not exists accounting_connections_external_tenant_idx
  on public.accounting_connections(provider,external_tenant_id)
  where external_tenant_id is not null and status in ('connected','error');

create table if not exists public.accounting_oauth_states (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  provider text not null check (provider in ('xero','quickbooks','bukku','autocount')),
  state_hash text not null unique check (state_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at>created_at)
);
create index if not exists accounting_oauth_states_expiry_idx
  on public.accounting_oauth_states(expires_at) where consumed_at is null;

create table if not exists public.accounting_external_mappings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  connection_id uuid not null,
  provider text not null check (provider in ('xero','quickbooks','bukku','autocount')),
  entity_type text not null check (entity_type in ('contact','account','invoice','payment','credit_note')),
  external_entity_id text not null,
  external_parent_id text,
  collectboss_entity_type text not null check (
    collectboss_entity_type in ('debtor','customer_account','obligation','payment','financial_adjustment','unmatched_financial_event')
  ),
  collectboss_entity_id uuid,
  source_version text,
  source_updated_at timestamptz,
  payload_hash text,
  last_synced_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (connection_id,business_id) references public.accounting_connections(id,business_id) on delete restrict,
  unique (business_id,provider,entity_type,external_entity_id),
  unique (id,business_id)
);
create index if not exists accounting_external_mappings_collectboss_idx
  on public.accounting_external_mappings(business_id,collectboss_entity_type,collectboss_entity_id);
create index if not exists accounting_external_mappings_parent_idx
  on public.accounting_external_mappings(business_id,provider,external_parent_id)
  where external_parent_id is not null;

create table if not exists public.accounting_sync_runs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  connection_id uuid not null,
  provider text not null check (provider in ('xero','quickbooks','bukku','autocount')),
  mode text not null check (mode in ('full','incremental','preview')),
  status text not null check (status in ('running','preview_ready','succeeded','failed')),
  counts jsonb not null default '{}'::jsonb check (jsonb_typeof(counts)='object'),
  preview jsonb not null default '[]'::jsonb check (jsonb_typeof(preview)='array'),
  errors jsonb not null default '[]'::jsonb check (jsonb_typeof(errors)='array'),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  foreign key (connection_id,business_id) references public.accounting_connections(id,business_id) on delete restrict
);
create unique index if not exists accounting_sync_runs_one_active_idx
  on public.accounting_sync_runs(connection_id) where status='running';
create index if not exists accounting_sync_runs_tenant_idx
  on public.accounting_sync_runs(business_id,started_at desc);

create table if not exists public.accounting_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('xero','quickbooks','bukku','autocount')),
  external_tenant_id text not null,
  event_key text not null,
  payload jsonb not null check (jsonb_typeof(payload)='object'),
  status text not null default 'pending' check (status in ('pending','processed','failed')),
  attempts integer not null default 0 check (attempts>=0),
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider,event_key)
);
create index if not exists accounting_webhook_events_queue_idx
  on public.accounting_webhook_events(status,received_at) where status='pending';

create table if not exists public.accounting_financial_applications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  mapping_id uuid not null,
  case_id text not null,
  obligation_id uuid not null,
  application_key text not null,
  application_type text not null check (application_type in ('payment','payment_reversal','credit','credit_reversal','invoice_debit','invoice_credit')),
  amount_minor bigint not null check (amount_minor>0),
  financial_event_id uuid references public.case_financial_events(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (mapping_id,business_id) references public.accounting_external_mappings(id,business_id) on delete restrict,
  foreign key (case_id,business_id) references public.cases(id,business_id) on delete restrict,
  foreign key (obligation_id,business_id) references public.obligations(id,business_id) on delete restrict,
  unique (business_id,application_key)
);

alter table public.accounting_connections enable row level security;
alter table public.accounting_oauth_states enable row level security;
alter table public.accounting_external_mappings enable row level security;
alter table public.accounting_sync_runs enable row level security;
alter table public.accounting_webhook_events enable row level security;
alter table public.accounting_financial_applications enable row level security;

-- Connections and OAuth state contain secrets or security material and have no
-- authenticated policies. Tenant-authorized server routes return only a safe projection.
drop policy if exists accounting_external_mappings_role_read on public.accounting_external_mappings;
create policy accounting_external_mappings_role_read on public.accounting_external_mappings
  for select to authenticated using (
    public.has_business_permission(business_id,'settings.sensitive.manage')
  );
drop policy if exists accounting_sync_runs_role_read on public.accounting_sync_runs;
create policy accounting_sync_runs_role_read on public.accounting_sync_runs
  for select to authenticated using (
    public.has_business_permission(business_id,'settings.sensitive.manage')
  );
drop policy if exists accounting_financial_applications_role_read on public.accounting_financial_applications;
create policy accounting_financial_applications_role_read on public.accounting_financial_applications
  for select to authenticated using (
    public.has_business_permission(business_id,'audit.read')
  );

create or replace function public.accounting_apply_sync_record(
  p_connection_id uuid,
  p_record jsonb
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_connection public.accounting_connections;
  v_kind text:=p_record->>'kind';
  v_external_id text:=nullif(btrim(p_record->>'externalId'),'');
  v_parent_id text;
  v_mapping public.accounting_external_mappings;
  v_parent_mapping public.accounting_external_mappings;
  v_customer_id uuid;
  v_account_id uuid;
  v_obligation public.obligations;
  v_obligation_id uuid;
  v_case_id text;
  v_payment public.payments;
  v_event_id uuid;
  v_application_id uuid;
  v_amount bigint;
  v_total bigint;
  v_paid bigint;
  v_credited bigint;
  v_contractual bigint;
  v_delta bigint;
  v_status text;
  v_key text;
  v_actor_id uuid;
  v_now timestamptz:=now();
begin
  select * into v_connection from public.accounting_connections
  where id=p_connection_id and status in ('connected','error') for update;
  if not found then raise exception 'Accounting connection is unavailable'; end if;
  select coalesce(v_connection.created_by,b.owner_id) into v_actor_id
  from public.businesses b where b.id=v_connection.business_id;
  if v_kind not in ('contact','invoice','payment','credit_note') or v_external_id is null then
    raise exception 'Normalized accounting record is invalid';
  end if;

  select * into v_mapping from public.accounting_external_mappings
  where business_id=v_connection.business_id and provider=v_connection.provider
    and entity_type=v_kind and external_entity_id=v_external_id for update;

  if v_kind='contact' then
    if not found then
      insert into public.debtors(
        business_id,debtor_type,business_name,contact_name,registration_no,phone,email,address
      ) values(
        v_connection.business_id,'business',left(p_record->>'name',250),
        left(nullif(p_record->>'contactName',''),250),left(nullif(p_record->>'registrationNumber',''),100),
        left(nullif(p_record->>'phone',''),50),left(nullif(lower(p_record->>'email'),''),320),
        left(nullif(p_record->>'address',''),1000)
      ) returning id into v_customer_id;
      insert into public.accounting_external_mappings(
        business_id,connection_id,provider,entity_type,external_entity_id,
        collectboss_entity_type,collectboss_entity_id,source_version,source_updated_at,metadata
      ) values(
        v_connection.business_id,v_connection.id,v_connection.provider,'contact',v_external_id,
        'debtor',v_customer_id,p_record->>'version',nullif(p_record->>'updatedAt','')::timestamptz,
        jsonb_build_object('account_number',p_record->>'accountNumber','currency',p_record->>'currency')
      ) returning * into v_mapping;
    else
      v_customer_id:=v_mapping.collectboss_entity_id;
      update public.debtors set
        business_name=left(p_record->>'name',250),contact_name=left(nullif(p_record->>'contactName',''),250),
        registration_no=left(nullif(p_record->>'registrationNumber',''),100),phone=left(nullif(p_record->>'phone',''),50),
        email=left(nullif(lower(p_record->>'email'),''),320),address=left(nullif(p_record->>'address',''),1000),
        archived_at=case when p_record->>'status'='archived' then coalesce(archived_at,v_now) else null end,
        updated_at=v_now
      where id=v_customer_id and business_id=v_connection.business_id;
    end if;

  elsif v_kind='invoice' then
    v_parent_id:=nullif(p_record->>'contactExternalId','');
    select * into v_parent_mapping from public.accounting_external_mappings
    where business_id=v_connection.business_id and provider=v_connection.provider
      and entity_type='contact' and external_entity_id=v_parent_id;
    if not found or v_parent_mapping.collectboss_entity_id is null then raise exception 'Invoice contact mapping is missing'; end if;
    v_customer_id:=v_parent_mapping.collectboss_entity_id;
    select id into v_account_id from public.customer_accounts
      where business_id=v_connection.business_id and customer_id=v_customer_id and archived_at is null
      order by created_at limit 1;
    if v_account_id is null then
      insert into public.customer_accounts(business_id,customer_id,account_type,account_number,display_name,currency,metadata)
      select v_connection.business_id,v_customer_id,'general',nullif(v_parent_mapping.metadata->>'account_number',''),
        coalesce(d.business_name,d.individual_name,'Accounting account'),
        coalesce(nullif(p_record->>'currency',''),nullif(v_parent_mapping.metadata->>'currency',''),'MYR'),
        jsonb_build_object('source','accounting_connector','provider',v_connection.provider)
      from public.debtors d where d.id=v_customer_id returning id into v_account_id;
    end if;
    v_total:=greatest(coalesce((p_record->>'totalMinor')::bigint,0),0);
    v_credited:=least(greatest(coalesce((p_record->>'creditedMinor')::bigint,0),0),v_total);
    v_contractual:=v_total-v_credited;
    v_paid:=least(greatest(coalesce((p_record->>'paidMinor')::bigint,0),0),v_contractual);
    v_status:=case p_record->>'status' when 'draft' then 'draft' when 'void' then 'void'
      when 'paid' then 'paid' else case when (p_record->>'dueDate')::date<current_date then 'overdue' else 'open' end end;
    if v_mapping.id is null then
      perform set_config('collectboss.receivables_sync','on',true);
      insert into public.obligations(
        business_id,customer_id,account_id,obligation_type,reference,purchase_order_reference,
        issue_date,due_date,currency,original_amount_minor,adjustments_minor,paid_minor,status,metadata
      ) values(
        v_connection.business_id,v_customer_id,v_account_id,'invoice',left(p_record->>'reference',200),
        left(nullif(p_record->>'purchaseOrderReference',''),200),nullif(p_record->>'issueDate','')::date,
        (p_record->>'dueDate')::date,p_record->>'currency',v_total,-v_credited,v_paid,v_status,
        jsonb_build_object('source','accounting_connector','provider',v_connection.provider)
      ) returning id into v_obligation_id;
      insert into public.accounting_external_mappings(
        business_id,connection_id,provider,entity_type,external_entity_id,external_parent_id,
        collectboss_entity_type,collectboss_entity_id,source_version,source_updated_at,metadata
      ) values(
        v_connection.business_id,v_connection.id,v_connection.provider,'invoice',v_external_id,v_parent_id,
        'obligation',v_obligation_id,p_record->>'version',nullif(p_record->>'updatedAt','')::timestamptz,
        jsonb_build_object('last_total_minor',v_total,'last_credited_minor',v_credited)
      ) returning * into v_mapping;
    else
      v_obligation_id:=v_mapping.collectboss_entity_id;
      select * into v_obligation from public.obligations where id=v_obligation_id and business_id=v_connection.business_id for update;
      if not found then raise exception 'Mapped obligation is missing'; end if;
      select rco.case_id into v_case_id from public.recovery_case_obligations rco
        where rco.obligation_id=v_obligation_id and rco.business_id=v_connection.business_id;
      if v_case_id is null then
        perform set_config('collectboss.receivables_sync','on',true);
        update public.obligations set reference=left(p_record->>'reference',200),
          purchase_order_reference=left(nullif(p_record->>'purchaseOrderReference',''),200),
          issue_date=nullif(p_record->>'issueDate','')::date,due_date=(p_record->>'dueDate')::date,
          currency=p_record->>'currency',original_amount_minor=v_total,adjustments_minor=-v_credited,
          paid_minor=v_paid,status=v_status,updated_at=v_now where id=v_obligation_id;
      else
        -- Linked financial values are ledger-owned. Apply only the external
        -- invoice-total delta; allocated credits/payments have their own records.
        v_delta:=v_total-coalesce((v_mapping.metadata->>'last_total_minor')::bigint,v_obligation.original_amount_minor);
        if v_delta<>0 then
          if v_delta<0 and abs(v_delta)>v_obligation.outstanding_minor then
            raise exception 'External invoice decrease exceeds the recoverable outstanding balance';
          end if;
          v_key:='invoice:'||v_external_id||':'||coalesce(p_record->>'version',v_total::text);
          insert into public.accounting_financial_applications(
            business_id,mapping_id,case_id,obligation_id,application_key,application_type,amount_minor
          ) values(
            v_connection.business_id,v_mapping.id,v_case_id,v_obligation_id,v_key,
            case when v_delta>0 then 'invoice_debit' else 'invoice_credit' end,abs(v_delta)
          ) on conflict (business_id,application_key) do nothing returning id into v_application_id;
          if v_application_id is not null then
            perform set_config('collectboss.receivables_sync','on',true);
            update public.obligations set adjustments_minor=adjustments_minor+v_delta where id=v_obligation_id;
            insert into public.case_financial_events(case_id,event_type,amount_minor,source_table,source_id,note)
            values(v_case_id,case when v_delta>0 then 'adjustment_debit' else 'adjustment_credit' end,
              abs(v_delta),'accounting_financial_applications',v_application_id,'Accounting invoice total changed')
            returning id into v_event_id;
            update public.accounting_financial_applications set financial_event_id=v_event_id where id=v_application_id;
            perform public.financial_recalculate_case(v_case_id);
          end if;
        end if;
        update public.obligations set reference=left(p_record->>'reference',200),
          purchase_order_reference=left(nullif(p_record->>'purchaseOrderReference',''),200),
          issue_date=nullif(p_record->>'issueDate','')::date,due_date=(p_record->>'dueDate')::date,
          currency=p_record->>'currency',updated_at=v_now where id=v_obligation_id;
      end if;
    end if;

  else
    v_parent_id:=nullif(p_record->>'invoiceExternalId','');
    v_amount:=greatest(coalesce((p_record->>'amountMinor')::bigint,0),0);
    if v_amount=0 then return jsonb_build_object('status','ignored_zero_amount','kind',v_kind,'external_id',v_external_id); end if;
    if v_parent_id is not null then
      select * into v_parent_mapping from public.accounting_external_mappings
      where business_id=v_connection.business_id and provider=v_connection.provider
        and entity_type='invoice' and external_entity_id=v_parent_id;
    end if;
    v_obligation_id:=v_parent_mapping.collectboss_entity_id;
    if v_obligation_id is not null then
      select rco.case_id into v_case_id from public.recovery_case_obligations rco
      where rco.obligation_id=v_obligation_id and rco.business_id=v_connection.business_id;
    end if;

    if v_mapping.id is null then
      insert into public.accounting_external_mappings(
        business_id,connection_id,provider,entity_type,external_entity_id,external_parent_id,
        collectboss_entity_type,collectboss_entity_id,source_version,source_updated_at,metadata
      ) values(
        v_connection.business_id,v_connection.id,v_connection.provider,v_kind,v_external_id,v_parent_id,
        case when v_case_id is null then 'unmatched_financial_event'
          when v_kind='payment' then 'payment' else 'financial_adjustment' end,
        v_obligation_id,p_record->>'version',nullif(p_record->>'updatedAt','')::timestamptz,
        jsonb_build_object('amount_minor',v_amount,'status',p_record->>'status','reference',p_record->>'reference')
      ) returning * into v_mapping;
      if v_case_id is not null and v_kind='payment' and p_record->>'status'<>'reversed' then
        insert into public.payments(case_id,amount,payment_method,reference_no,review_status,reviewed_at,notes)
        values(v_case_id,v_amount::numeric/100,'bank_transfer',left(nullif(p_record->>'reference',''),200),
          'approved',v_now,'Imported read-only from '||v_connection.provider)
        returning * into v_payment;
        insert into public.case_financial_events(case_id,event_type,amount_minor,source_table,source_id,note)
        values(v_case_id,'payment_approved',v_amount,'payments',v_payment.id,'Accounting-side payment') returning id into v_event_id;
        update public.payments set financial_event_id=v_event_id where id=v_payment.id;
        update public.accounting_external_mappings set collectboss_entity_id=v_payment.id where id=v_mapping.id;
        insert into public.accounting_financial_applications(
          business_id,mapping_id,case_id,obligation_id,application_key,application_type,amount_minor,financial_event_id
        ) values(v_connection.business_id,v_mapping.id,v_case_id,v_obligation_id,
          'payment:'||v_external_id,'payment',v_amount,v_event_id);
        perform public.financial_recalculate_case(v_case_id);
      elsif v_case_id is not null and v_kind='credit_note' and p_record->>'status'<>'void' then
        select * into v_obligation from public.obligations
          where id=v_obligation_id and business_id=v_connection.business_id for update;
        v_amount:=least(v_amount,v_obligation.outstanding_minor);
        if v_amount=0 then
          update public.accounting_external_mappings set
            metadata=metadata||jsonb_build_object('ignored_reason','no_outstanding_balance')
          where id=v_mapping.id;
        else
        insert into public.financial_adjustments(
          business_id,case_id,obligation_id,adjustment_type,direction,amount_minor,reason,reference,
          approval_status,requested_by,approved_by,approved_at,idempotency_key
        ) values(v_connection.business_id,v_case_id,v_obligation_id,'credit_note','credit',v_amount,
          'Accounting-side credit note',left(nullif(p_record->>'reference',''),160),
          'approved',v_actor_id,v_actor_id,v_now,v_mapping.id)
        returning id into v_application_id;
        perform set_config('collectboss.receivables_sync','on',true);
        update public.obligations set adjustments_minor=adjustments_minor-v_amount where id=v_obligation_id;
        insert into public.case_financial_events(case_id,event_type,amount_minor,source_table,source_id,note)
        values(v_case_id,'adjustment_credit',v_amount,'financial_adjustments',v_application_id,'Accounting-side credit note')
        returning id into v_event_id;
        update public.financial_adjustments set financial_event_id=v_event_id where id=v_application_id;
        update public.accounting_external_mappings set collectboss_entity_id=v_application_id where id=v_mapping.id;
        insert into public.accounting_financial_applications(
          business_id,mapping_id,case_id,obligation_id,application_key,application_type,amount_minor,financial_event_id
        ) values(v_connection.business_id,v_mapping.id,v_case_id,v_obligation_id,
          'credit:'||v_external_id,'credit',v_amount,v_event_id);
        perform public.financial_recalculate_case(v_case_id);
        end if;
      end if;
    elsif v_case_id is not null and v_kind='payment' and p_record->>'status'='reversed' then
      select * into v_payment from public.payments where id=v_mapping.collectboss_entity_id for update;
      if found and v_payment.review_status='approved' then
        insert into public.accounting_financial_applications(
          business_id,mapping_id,case_id,obligation_id,application_key,application_type,amount_minor
        ) values(v_connection.business_id,v_mapping.id,v_case_id,v_obligation_id,
          'payment-reversal:'||v_external_id,'payment_reversal',v_amount)
        on conflict (business_id,application_key) do nothing returning id into v_application_id;
        if v_application_id is not null then
          insert into public.case_financial_events(case_id,event_type,amount_minor,source_table,source_id,note)
          values(v_case_id,'payment_reversal',v_amount,'accounting_financial_applications',v_application_id,'Accounting payment reversed')
          returning id into v_event_id;
          update public.accounting_financial_applications set financial_event_id=v_event_id where id=v_application_id;
          update public.payments set review_status='reversed',reversed_at=v_now,reversal_reason='Reversed in accounting system' where id=v_payment.id;
          perform public.financial_recalculate_case(v_case_id);
        end if;
      end if;
    elsif v_case_id is not null and v_kind='credit_note' and p_record->>'status'='void' then
      select amount_minor into v_amount from public.financial_adjustments
        where id=v_mapping.collectboss_entity_id and business_id=v_connection.business_id;
      if coalesce(v_amount,0)>0 then
        insert into public.accounting_financial_applications(
          business_id,mapping_id,case_id,obligation_id,application_key,application_type,amount_minor
        ) values(v_connection.business_id,v_mapping.id,v_case_id,v_obligation_id,
          'credit-reversal:'||v_external_id,'credit_reversal',v_amount)
        on conflict (business_id,application_key) do nothing returning id into v_application_id;
        if v_application_id is not null then
          perform set_config('collectboss.receivables_sync','on',true);
          update public.obligations set adjustments_minor=adjustments_minor+v_amount where id=v_obligation_id;
          insert into public.case_financial_events(case_id,event_type,amount_minor,source_table,source_id,note)
          values(v_case_id,'adjustment_debit',v_amount,'accounting_financial_applications',v_application_id,'Accounting credit note voided')
          returning id into v_event_id;
          update public.accounting_financial_applications set financial_event_id=v_event_id where id=v_application_id;
          perform public.financial_recalculate_case(v_case_id);
        end if;
      end if;
    end if;
  end if;

  update public.accounting_external_mappings set
    source_version=p_record->>'version',source_updated_at=nullif(p_record->>'updatedAt','')::timestamptz,
    payload_hash=encode(digest(convert_to(p_record::text,'UTF8'),'sha256'),'hex'),last_synced_at=v_now,updated_at=v_now,
    metadata=metadata||jsonb_build_object('last_status',p_record->>'status')
      ||case when v_kind='invoice' then jsonb_build_object('last_total_minor',v_total,'last_credited_minor',v_credited) else '{}'::jsonb end
  where business_id=v_connection.business_id and provider=v_connection.provider
    and entity_type=v_kind and external_entity_id=v_external_id;
  return jsonb_build_object('status','applied','kind',v_kind,'external_id',v_external_id);
end;
$$;

create or replace function public.accounting_apply_sync_batch(
  p_connection_id uuid,
  p_records jsonb
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_record jsonb; v_count integer:=0;
begin
  if jsonb_typeof(p_records)<>'array' or jsonb_array_length(p_records)>1000 then
    raise exception 'Accounting sync batch must contain at most 1000 records';
  end if;
  for v_record in select value from jsonb_array_elements(p_records) loop
    perform public.accounting_apply_sync_record(p_connection_id,v_record);
    v_count:=v_count+1;
  end loop;
  return jsonb_build_object('applied',v_count);
end;
$$;

revoke all on table public.accounting_connections,public.accounting_oauth_states,
  public.accounting_external_mappings,public.accounting_sync_runs,
  public.accounting_webhook_events,public.accounting_financial_applications from anon;
revoke all on table public.accounting_connections,public.accounting_oauth_states,
  public.accounting_webhook_events from authenticated;
revoke insert,update,delete on table public.accounting_external_mappings,
  public.accounting_sync_runs,public.accounting_financial_applications from authenticated;
grant select on table public.accounting_external_mappings,public.accounting_sync_runs,
  public.accounting_financial_applications to authenticated;
grant all on table public.accounting_connections,public.accounting_oauth_states,
  public.accounting_external_mappings,public.accounting_sync_runs,
  public.accounting_webhook_events,public.accounting_financial_applications to service_role;
revoke all on function public.accounting_apply_sync_record(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.accounting_apply_sync_batch(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.accounting_apply_sync_record(uuid,jsonb) to service_role;
grant execute on function public.accounting_apply_sync_batch(uuid,jsonb) to service_role;

commit;

-- Rollback considerations:
-- 1. Disable OAuth connect, webhook and accounting-sync cron routes first.
-- 2. Revoke provider grants from both provider consoles before dropping local
--    ciphertext. Disconnecting never deletes debtors, obligations, cases,
--    mappings, payments, adjustments, promises, plans or audit history.
-- 3. Keep accounting_external_mappings and accounting_financial_applications
--    for audit/idempotency. If code rollback requires dropping functions, drop
--    accounting_apply_sync_batch before accounting_apply_sync_record.

-- I03 Email Communications 2.0 (canonical mirror).
alter table public.communication_activities
  add column if not exists provider text, add column if not exists provider_message_id text,
  add column if not exists thread_reference text, add column if not exists sender text,
  add column if not exists recipients jsonb not null default '{}'::jsonb,
  add column if not exists subject text, add column if not exists body_text text,
  add column if not exists sent_at timestamptz, add column if not exists delivered_at timestamptz,
  add column if not exists opened_at timestamptz, add column if not exists replied_at timestamptz,
  add column if not exists failure_reason text, add column if not exists review_required boolean not null default false;
alter table public.communication_activities
  drop constraint if exists communication_activities_recipients_object_check,
  add constraint communication_activities_recipients_object_check check(jsonb_typeof(recipients)='object'),
  drop constraint if exists communication_activities_email_provider_fields_check,
  add constraint communication_activities_email_provider_fields_check check(channel='email' or (
    provider is null and provider_message_id is null and thread_reference is null and sender is null
    and subject is null and body_text is null and sent_at is null and delivered_at is null
    and opened_at is null and replied_at is null and failure_reason is null
    and review_required=false and recipients='{}'::jsonb));
create unique index if not exists communication_activities_provider_message_uidx
  on public.communication_activities(business_id,provider,provider_message_id)
  where provider is not null and provider_message_id is not null;
create index if not exists communication_activities_email_thread_idx
  on public.communication_activities(business_id,thread_reference,started_at desc)
  where channel='email' and thread_reference is not null;
alter table public.contact_preferences
  add column if not exists do_not_email boolean not null default false,
  add column if not exists email_invalid boolean not null default false,
  add column if not exists email_unsubscribed boolean not null default false,
  add column if not exists last_email_bounced_at timestamptz;
alter table public.domain_events drop constraint if exists domain_events_event_type_check;
alter table public.domain_events add constraint domain_events_event_type_check check(event_type in(
  'FOLLOW_UP_DUE','INVOICE_OVERDUE','PROMISE_DUE','PROMISE_MISSED','PLAN_INSTALLMENT_DUE',
  'PLAN_INSTALLMENT_MISSED','DISPUTE_REVIEW_DUE','PAYMENT_PROOF_REVIEW_REQUIRED',
  'DISPUTE_SUBMITTED','PAYMENT_RECEIVED','EMAIL_REPLY_RECEIVED'));

create table if not exists public.email_sender_identities(
  id uuid primary key default gen_random_uuid(), business_id uuid not null unique references public.businesses(id) on delete cascade,
  provider text not null check(provider in('resend')), from_email text not null, from_name text not null,
  reply_domain text, signature_text text not null default '', verification_status text not null default 'pending'
  check(verification_status in('pending','verified','failed')), verified_at timestamptz, last_verification_error text,
  configured_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), check(position('@' in from_email)>1),
  check(char_length(btrim(from_name)) between 1 and 120), check(char_length(signature_text)<=4000));
create table if not exists public.email_templates(
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null, subject_template text not null, body_template text not null, is_active boolean not null default true,
  is_system_default boolean not null default false, created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), unique(business_id,name), check(char_length(btrim(name)) between 1 and 100),
  check(char_length(subject_template) between 1 and 300), check(char_length(body_template) between 1 and 20000));
insert into public.email_templates(business_id,name,subject_template,body_template,is_system_default)
select b.id,t.name,t.subject_template,t.body_template,true from public.businesses b cross join(values
  ('Friendly payment reminder','Payment reminder: {{invoice_number}}',E'Hello {{customer_name}},\n\nThis is a friendly reminder that invoice {{invoice_number}} was due on {{due_date}}. The outstanding amount is {{outstanding_amount}}.\n\nYou can review payment options here: {{payment_link}}\n\nIf payment has already been arranged, please reply to let us know.\n\n{{business_signature}}'),
  ('Formal payment follow-up','Payment follow-up: {{invoice_number}}',E'Dear {{customer_name}},\n\nOur records show an outstanding balance of {{outstanding_amount}} for invoice {{invoice_number}}, due {{due_date}}.\n\nPlease review the account and payment options at {{payment_link}}, or reply if you need us to review the account with you.\n\n{{business_signature}}'),
  ('Final pre-escalation reminder','Action requested: overdue invoice {{invoice_number}}',E'Dear {{customer_name}},\n\nWe are following up again regarding invoice {{invoice_number}}. The outstanding amount is {{outstanding_amount}}, originally due on {{due_date}}.\n\nPlease make payment or reply to discuss the account. Payment options: {{payment_link}}\n\n{{business_signature}}')
)as t(name,subject_template,body_template) on conflict(business_id,name) do nothing;
create table if not exists public.scheduled_email_followups(
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete restrict,
  case_id text not null references public.cases(id) on delete restrict, customer_id uuid references public.debtors(id) on delete set null,
  related_action_id uuid references public.action_centre_items(id) on delete set null, idempotency_key uuid not null,
  due_at timestamptz not null, timezone text not null, to_recipients jsonb not null,
  cc_recipients jsonb not null default '[]'::jsonb, bcc_recipients jsonb not null default '[]'::jsonb,
  subject text not null, body_text text not null, attachment_ids jsonb not null default '[]'::jsonb, override_reason text,
  status text not null default 'pending' check(status in('pending','processing','sent','failed','cancelled')),
  attempts integer not null default 0, last_error text, communication_activity_id uuid references public.communication_activities(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), processed_at timestamptz,
  unique(business_id,idempotency_key), check(jsonb_typeof(to_recipients)='array' and jsonb_array_length(to_recipients)>0),
  check(jsonb_typeof(cc_recipients)='array'), check(jsonb_typeof(bcc_recipients)='array'), check(jsonb_typeof(attachment_ids)='array'),
  check(override_reason is null or char_length(btrim(override_reason)) between 3 and 500));
create index if not exists scheduled_email_followups_due_idx on public.scheduled_email_followups(due_at,id)
  where status in('pending','processing');
create table if not exists public.email_webhook_events(
  id uuid primary key default gen_random_uuid(), provider text not null, provider_event_id text not null,
  event_type text not null, provider_message_id text, communication_activity_id uuid references public.communication_activities(id) on delete set null,
  payload jsonb not null, processed_at timestamptz not null default now(), unique(provider,provider_event_id), check(jsonb_typeof(payload)='object'));
create table if not exists public.email_inbound_reviews(
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete cascade,
  provider text not null, provider_message_id text not null, sender text not null, recipients jsonb not null, subject text,
  reason text not null, status text not null default 'pending' check(status in('pending','linked','dismissed')),
  communication_activity_id uuid references public.communication_activities(id) on delete set null,
  created_at timestamptz not null default now(), reviewed_at timestamptz, reviewed_by uuid references auth.users(id) on delete set null,
  unique(provider,provider_message_id), check(jsonb_typeof(recipients)='object'));
alter table public.email_sender_identities enable row level security;
alter table public.email_templates enable row level security;
alter table public.scheduled_email_followups enable row level security;
alter table public.email_webhook_events enable row level security;
alter table public.email_inbound_reviews enable row level security;
create policy "email_sender_identities_owner_read" on public.email_sender_identities for select to authenticated using(public.has_business_permission(business_id,'communication.manage'));
create policy "email_templates_owner_read" on public.email_templates for select to authenticated using(public.has_business_permission(business_id,'communication.manage'));
create policy "scheduled_email_followups_owner_read" on public.scheduled_email_followups for select to authenticated using(public.has_business_permission(business_id,'communication.manage'));
create policy "email_inbound_reviews_owner_read" on public.email_inbound_reviews for select to authenticated using(public.has_business_permission(business_id,'communication.manage'));
revoke all on public.email_sender_identities,public.email_templates,public.scheduled_email_followups,
  public.email_webhook_events,public.email_inbound_reviews from anon;
grant select on public.email_sender_identities,public.email_templates,public.scheduled_email_followups,
  public.email_inbound_reviews to authenticated;
grant all on public.email_sender_identities,public.email_templates,public.scheduled_email_followups,
  public.email_webhook_events,public.email_inbound_reviews to service_role;
-- Mobile companion push registrations (Prompt 7 / migration 20260830).
create table if not exists public.mobile_push_devices (
  id uuid primary key default gen_random_uuid(),business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,expo_push_token text not null unique,
  platform text not null check(platform in ('android','ios')),enabled boolean not null default true,
  last_seen_at timestamptz not null default now(),disabled_at timestamptz,created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),check(expo_push_token ~ '^(Expo|Exponent)PushToken\[[A-Za-z0-9_-]+\]$')
);
create index if not exists mobile_push_devices_delivery_idx on public.mobile_push_devices(business_id,user_id) where enabled;
create table if not exists public.mobile_push_deliveries (
  id uuid primary key default gen_random_uuid(),notification_id uuid not null references public.notifications(id) on delete cascade,
  device_id uuid not null references public.mobile_push_devices(id) on delete cascade,
  status text not null default 'queued' check(status in ('queued','ticket_ok','delivered','retryable_error','failed')),
  ticket_id text,attempts integer not null default 0 check(attempts between 0 and 5),last_error text,sent_at timestamptz,
  receipt_checked_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(notification_id,device_id)
);
create index if not exists mobile_push_deliveries_receipt_idx on public.mobile_push_deliveries(sent_at) where status='ticket_ok' and receipt_checked_at is null;
create index if not exists mobile_push_deliveries_retry_idx on public.mobile_push_deliveries(updated_at) where status in ('queued','retryable_error') and attempts<5;
alter table public.mobile_push_devices enable row level security;
alter table public.mobile_push_deliveries enable row level security;
create policy "mobile_push_devices_self_read" on public.mobile_push_devices for select to authenticated using(user_id=auth.uid() and public.has_business_permission(business_id,'case.read'));
create policy "mobile_push_devices_self_insert" on public.mobile_push_devices for insert to authenticated with check(user_id=auth.uid() and public.has_business_permission(business_id,'case.read'));
create policy "mobile_push_devices_self_update" on public.mobile_push_devices for update to authenticated using(user_id=auth.uid() and public.has_business_permission(business_id,'case.read')) with check(user_id=auth.uid() and public.has_business_permission(business_id,'case.read'));
create policy "mobile_push_devices_self_delete" on public.mobile_push_devices for delete to authenticated using(user_id=auth.uid() and public.has_business_permission(business_id,'case.read'));
revoke all on public.mobile_push_devices,public.mobile_push_deliveries from anon;
revoke all on public.mobile_push_deliveries from authenticated;
grant select,insert,update,delete on public.mobile_push_devices to authenticated;
grant all on public.mobile_push_devices,public.mobile_push_deliveries to service_role;

-- ─── Prompt 8: secure document intake foundation ────────────────────────────
-- Prompt 8: secure document ingestion, draft, storage and audit foundation.
-- Local proposal only. Review and apply after 20260830_mobile_companion_foundation.sql.
-- No OCR, classification, debtor matching, case creation or payment creation is
-- performed here. Originals remain private and immutable.

begin;

alter table public.business_role_settings
  add column if not exists manager_can_submit_document_intakes boolean not null default false;

create table if not exists public.document_intakes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  assigned_to uuid references auth.users(id) on delete set null,
  status text not null default 'draft' check (status in (
    'draft','awaiting_upload','uploaded','processing','needs_review',
    'ready_to_submit','submitted','failed','cancelled'
  )),
  source text not null check (source in ('web_upload','mobile_upload','api','email_import')),
  intended_workflow text not null check (intended_workflow in (
    'transaction_evidence','payment_evidence','general_document'
  )),
  currency_hint char(3) check (currency_hint is null or currency_hint ~ '^[A-Z]{3}$'),
  version integer not null default 1 check (version > 0),
  submitted_at timestamptz,
  cancelled_at timestamptz,
  deleted_at timestamptz,
  retention_until date,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'submitted') = (submitted_at is not null)),
  check ((status = 'cancelled') = (cancelled_at is not null))
);
create index if not exists document_intakes_business_status_idx
  on public.document_intakes(business_id,status,updated_at desc);
create index if not exists document_intakes_assigned_idx
  on public.document_intakes(business_id,assigned_to,updated_at desc)
  where assigned_to is not null and deleted_at is null;

create table if not exists public.document_intake_idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  action_scope text not null check (action_scope in ('create','upload','replace','remove','confirm','finalise','cancel')),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 128),
  request_hash char(64) not null check (request_hash ~ '^[0-9a-f]{64}$'),
  actor_id uuid not null references auth.users(id) on delete restrict,
  resource_type text,
  resource_id uuid,
  response_status integer,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  unique (business_id,action_scope,idempotency_key)
);
create index if not exists document_intake_idempotency_expiry_idx
  on public.document_intake_idempotency_keys(expires_at);

create table if not exists public.document_intake_events (
  id uuid primary key default gen_random_uuid(),
  intake_id uuid not null references public.document_intakes(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  from_status text,
  to_status text not null,
  intake_version integer not null check (intake_version > 0),
  actor_id uuid references auth.users(id) on delete set null,
  actor_role text check (actor_role is null or actor_role in ('owner','admin','manager','staff','viewer')),
  action text not null,
  error_code text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  correlation_id uuid,
  idempotency_key text,
  created_at timestamptz not null default now()
);
create index if not exists document_intake_events_intake_idx
  on public.document_intake_events(intake_id,created_at,id);

alter table public.evidence_files
  alter column case_id drop not null,
  add column if not exists business_id uuid references public.businesses(id) on delete restrict,
  add column if not exists intake_id uuid references public.document_intakes(id) on delete restrict,
  add column if not exists kind text not null default 'original' check (kind in ('original','thumbnail','page_image','derived')),
  add column if not exists generated_storage_name text,
  add column if not exists storage_bucket text,
  add column if not exists declared_mime_type text,
  add column if not exists magic_mime_type text,
  add column if not exists upload_source text,
  add column if not exists is_immutable boolean not null default true,
  add column if not exists is_original boolean not null default true,
  add column if not exists evidence_version integer not null default 1 check (evidence_version > 0),
  add column if not exists is_current boolean not null default true,
  add column if not exists parent_evidence_id uuid references public.evidence_files(id) on delete restrict,
  add column if not exists supersedes_evidence_id uuid references public.evidence_files(id) on delete restrict,
  add column if not exists page_count integer check (page_count is null or page_count > 0),
  add column if not exists image_width integer check (image_width is null or image_width > 0),
  add column if not exists image_height integer check (image_height is null or image_height > 0),
  add column if not exists scan_provider text,
  add column if not exists scan_status text not null default 'pending' check (scan_status in ('pending','clean','suspected','quarantined','failed')),
  add column if not exists scan_completed_at timestamptz,
  add column if not exists processing_status text not null default 'queued' check (processing_status in ('queued','processing','needs_review','completed','failed','cancelled')),
  add column if not exists processing_version integer not null default 1 check (processing_version > 0),
  add column if not exists normalized_reference text,
  add column if not exists external_transaction_id text,
  add column if not exists duplicate_match_status text not null default 'unchecked' check (duplicate_match_status in ('unchecked','none','exact_hash_warning','reviewed')),
  add column if not exists duplicate_of_evidence_id uuid references public.evidence_files(id) on delete restrict,
  add column if not exists duplicate_reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists duplicate_review_outcome text,
  add column if not exists idempotency_scope text,
  add column if not exists idempotency_key text,
  add column if not exists request_hash char(64),
  add column if not exists soft_deleted_at timestamptz;

update public.evidence_files evidence
set business_id = cases.business_id,
    storage_bucket = coalesce(evidence.storage_bucket,'evidence-files'),
    generated_storage_name = coalesce(evidence.generated_storage_name,
      nullif(regexp_replace(coalesce(evidence.object_path,evidence.file_url,''), '^.*/', ''),'')),
    declared_mime_type = coalesce(evidence.declared_mime_type,
      case upper(evidence.file_type) when 'PDF' then 'application/pdf' when 'PNG' then 'image/png'
        when 'JPG' then 'image/jpeg' when 'JPEG' then 'image/jpeg' else 'application/octet-stream' end),
    magic_mime_type = coalesce(evidence.magic_mime_type,
      case upper(evidence.file_type) when 'PDF' then 'application/pdf' when 'PNG' then 'image/png'
        when 'JPG' then 'image/jpeg' when 'JPEG' then 'image/jpeg' else 'application/octet-stream' end),
    upload_source = coalesce(evidence.upload_source,'legacy_case_evidence'),
    scan_status = case when evidence.scan_status = 'pending' then 'clean' else evidence.scan_status end,
    processing_status = case when evidence.processing_status = 'queued' then 'completed' else evidence.processing_status end
from public.cases cases
where evidence.case_id = cases.id and evidence.business_id is null;

alter table public.evidence_files
  alter column business_id set not null,
  drop constraint if exists evidence_files_parent_required_check,
  add constraint evidence_files_parent_required_check check (case_id is not null or intake_id is not null),
  drop constraint if exists evidence_files_intake_original_metadata_check,
  add constraint evidence_files_intake_original_metadata_check check (
    intake_id is null or (
      object_path is not null and storage_bucket is not null and generated_storage_name is not null
      and declared_mime_type is not null and magic_mime_type is not null
      and file_size_bytes is not null and file_size_bytes > 0 and content_sha256 is not null
      and content_sha256 ~ '^[0-9a-f]{64}$' and upload_source is not null
    )
  ),
  drop constraint if exists evidence_files_derivative_parent_check,
  add constraint evidence_files_derivative_parent_check check (
    (kind = 'original' and is_original and parent_evidence_id is null)
    or (kind <> 'original' and not is_original and parent_evidence_id is not null)
  );

create unique index if not exists evidence_files_intake_original_version_uidx
  on public.evidence_files(intake_id,evidence_version)
  where intake_id is not null and kind='original';
create unique index if not exists evidence_files_intake_idempotency_uidx
  on public.evidence_files(business_id,idempotency_scope,idempotency_key)
  where intake_id is not null and idempotency_scope is not null and idempotency_key is not null;
create index if not exists evidence_files_business_hash_idx
  on public.evidence_files(business_id,content_sha256)
  where content_sha256 is not null and archived_at is null and soft_deleted_at is null;
create index if not exists evidence_files_intake_current_idx
  on public.evidence_files(intake_id,evidence_version desc)
  where intake_id is not null and is_current and soft_deleted_at is null;

create table if not exists public.document_intake_extractions (
  id uuid primary key default gen_random_uuid(),
  intake_id uuid not null references public.document_intakes(id) on delete restrict,
  evidence_id uuid not null references public.evidence_files(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  provider text not null,
  parser_version text not null,
  status text not null default 'queued' check (status in ('queued','processing','completed','failed','cancelled')),
  raw_text_object_path text,
  protected_raw_text text,
  document_classification text,
  structured_result jsonb not null default '{}'::jsonb check (jsonb_typeof(structured_result) = 'object'),
  confidence numeric(5,4) check (confidence is null or confidence between 0 and 1),
  warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings) = 'array'),
  started_at timestamptz,
  completed_at timestamptz,
  error_code text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz,
  locked_at timestamptz,
  locked_by text,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (evidence_id,provider,parser_version),
  unique (business_id,idempotency_key),
  check (raw_text_object_path is null or protected_raw_text is null)
);
create index if not exists document_intake_extractions_retry_idx
  on public.document_intake_extractions(status,next_attempt_at,created_at)
  where status in ('queued','failed');

create table if not exists public.document_intake_confirmations (
  id uuid primary key default gen_random_uuid(),
  intake_id uuid not null references public.document_intakes(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  confirmation_version integer not null check (confirmation_version > 0),
  intake_version integer not null check (intake_version > 0),
  confirmed_document_kind text not null check (confirmed_document_kind in (
    'invoice','receipt','payment_proof','bank_statement','contract','purchase_order',
    'delivery_order','credit_note','communication_evidence','other'
  )),
  chosen_amount_minor bigint check (chosen_amount_minor is null or chosen_amount_minor >= 0),
  currency char(3) check (currency is null or currency ~ '^[A-Z]{3}$'),
  document_datetime timestamptz,
  reference text,
  bank text,
  sender text,
  recipient text,
  transaction_nature text,
  notes text,
  confirmed_by uuid not null references auth.users(id) on delete restrict,
  confirmed_at timestamptz not null default now(),
  idempotency_key text not null,
  request_hash char(64) not null check (request_hash ~ '^[0-9a-f]{64}$'),
  unique (intake_id,confirmation_version),
  unique (business_id,idempotency_key)
);

alter table public.audit_logs
  add column if not exists correlation_id uuid,
  add column if not exists idempotency_key text;
create index if not exists audit_logs_correlation_idx
  on public.audit_logs(business_id,correlation_id,created_at) where correlation_id is not null;

create or replace function public.document_intake_evidence_scope()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_business_id uuid;
begin
  if new.intake_id is not null then
    select business_id into v_business_id from public.document_intakes where id=new.intake_id;
  elsif new.case_id is not null then
    select business_id into v_business_id from public.cases where id=new.case_id;
  end if;
  if v_business_id is null then raise exception 'P8_INVALID_EVIDENCE_PARENT'; end if;
  if new.business_id is not null and new.business_id <> v_business_id then
    raise exception 'P8_TENANT_SCOPE_MISMATCH';
  end if;
  new.business_id := v_business_id;
  return new;
end; $$;
drop trigger if exists document_intake_evidence_scope_guard on public.evidence_files;
create trigger document_intake_evidence_scope_guard
before insert or update of case_id,intake_id,business_id on public.evidence_files
for each row execute function public.document_intake_evidence_scope();

create or replace function public.document_intake_original_immutable()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if old.intake_id is not null and old.is_immutable and (
    new.business_id is distinct from old.business_id or new.intake_id is distinct from old.intake_id
    or new.case_id is distinct from old.case_id or new.file_name is distinct from old.file_name
    or new.file_type is distinct from old.file_type or new.file_url is distinct from old.file_url
    or new.file_size_bytes is distinct from old.file_size_bytes or new.object_path is distinct from old.object_path
    or new.content_sha256 is distinct from old.content_sha256 or new.kind is distinct from old.kind
    or new.generated_storage_name is distinct from old.generated_storage_name
    or new.storage_bucket is distinct from old.storage_bucket
    or new.declared_mime_type is distinct from old.declared_mime_type
    or new.magic_mime_type is distinct from old.magic_mime_type
    or new.page_count is distinct from old.page_count
    or new.is_original is distinct from old.is_original
    or new.evidence_version is distinct from old.evidence_version
    or new.parent_evidence_id is distinct from old.parent_evidence_id
    or new.supersedes_evidence_id is distinct from old.supersedes_evidence_id
  ) then raise exception 'P8_ORIGINAL_IMMUTABLE'; end if;
  return new;
end; $$;
drop trigger if exists document_intake_original_immutable_guard on public.evidence_files;
create trigger document_intake_original_immutable_guard
before update on public.evidence_files for each row
execute function public.document_intake_original_immutable();

create or replace function public.document_intake_no_hard_delete()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if old.intake_id is not null then raise exception 'P8_EVIDENCE_RETENTION_REQUIRED'; end if;
  return old;
end; $$;
drop trigger if exists document_intake_no_hard_delete_guard on public.evidence_files;
create trigger document_intake_no_hard_delete_guard
before delete on public.evidence_files for each row
execute function public.document_intake_no_hard_delete();

create or replace function public.document_intake_append_only()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin raise exception 'P8_APPEND_ONLY'; end; $$;
drop trigger if exists document_intake_events_append_only_guard on public.document_intake_events;
create trigger document_intake_events_append_only_guard before update or delete on public.document_intake_events
for each row execute function public.document_intake_append_only();
drop trigger if exists document_intake_confirmations_append_only_guard on public.document_intake_confirmations;
create trigger document_intake_confirmations_append_only_guard before update or delete on public.document_intake_confirmations
for each row execute function public.document_intake_append_only();
drop trigger if exists document_intake_idempotency_append_only_guard on public.document_intake_idempotency_keys;
create trigger document_intake_idempotency_append_only_guard before update or delete on public.document_intake_idempotency_keys
for each row execute function public.document_intake_append_only();

create or replace function public.document_intake_actor_role(p_business_id uuid,p_actor_id uuid)
returns text language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(
    (select 'owner' from public.businesses where id=p_business_id and owner_id=p_actor_id),
    (select role from public.business_memberships
      where business_id=p_business_id and user_id=p_actor_id and status='active' limit 1)
  );
$$;

create or replace function public.document_intake_transition_allowed(p_from text,p_to text)
returns boolean language sql immutable as $$
  select p_from=p_to or (p_from,p_to) in (
    ('draft','awaiting_upload'),('draft','cancelled'),
    ('awaiting_upload','uploaded'),('awaiting_upload','failed'),('awaiting_upload','cancelled'),
    ('uploaded','awaiting_upload'),('uploaded','processing'),('uploaded','needs_review'),
    ('uploaded','ready_to_submit'),('uploaded','failed'),('uploaded','cancelled'),
    ('processing','awaiting_upload'),('processing','needs_review'),('processing','ready_to_submit'),('processing','failed'),('processing','cancelled'),
    ('needs_review','awaiting_upload'),('needs_review','processing'),('needs_review','ready_to_submit'),('needs_review','cancelled'),
    ('ready_to_submit','awaiting_upload'),('ready_to_submit','needs_review'),
    ('ready_to_submit','submitted'),('ready_to_submit','cancelled'),
    ('failed','awaiting_upload'),('failed','processing'),('failed','cancelled')
  );
$$;

create or replace function public.document_intake_create(
  p_business_id uuid,p_actor_id uuid,p_source text,p_intended_workflow text,
  p_currency_hint text,p_idempotency_key text,p_request_hash text,p_correlation_id uuid
) returns public.document_intakes language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_existing public.document_intake_idempotency_keys; v_intake public.document_intakes;
begin
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id);
  if v_role is null then raise exception 'P8_MEMBERSHIP_REQUIRED'; end if;
  if v_role='viewer' then raise exception 'P8_PERMISSION_DENIED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':create:'||p_idempotency_key,0));
  select * into v_existing from public.document_intake_idempotency_keys
    where business_id=p_business_id and action_scope='create' and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_hash<>p_request_hash then raise exception 'P8_IDEMPOTENCY_CONFLICT'; end if;
    select * into v_intake from public.document_intakes where id=v_existing.resource_id and business_id=p_business_id;
    return v_intake;
  end if;
  insert into public.document_intakes(business_id,created_by,status,source,intended_workflow,currency_hint,retention_until)
  values(p_business_id,p_actor_id,'draft',p_source,p_intended_workflow,nullif(upper(p_currency_hint),''),(current_date+interval '7 years')::date)
  returning * into v_intake;
  insert into public.document_intake_idempotency_keys(business_id,action_scope,idempotency_key,request_hash,actor_id,resource_type,resource_id,response_status)
  values(p_business_id,'create',p_idempotency_key,p_request_hash,p_actor_id,'document_intake',v_intake.id,201);
  insert into public.document_intake_events(intake_id,business_id,to_status,intake_version,actor_id,actor_role,action,correlation_id,idempotency_key)
  values(v_intake.id,p_business_id,'draft',v_intake.version,p_actor_id,v_role,'document_intake.created',p_correlation_id,p_idempotency_key);
  insert into public.audit_logs(business_id,action,actor_type,actor_id,actor_role,entity_type,entity_id,correlation_id,idempotency_key,metadata)
  values(p_business_id,'document_intake.created','staff',p_actor_id,v_role,'document_intake',v_intake.id::text,p_correlation_id,p_idempotency_key,
    jsonb_build_object('source',p_source,'intended_workflow',p_intended_workflow));
  return v_intake;
end; $$;

create or replace function public.document_intake_transition(
  p_business_id uuid,p_intake_id uuid,p_actor_id uuid,p_to_status text,
  p_action text,p_error_code text default null,p_correlation_id uuid default null
) returns public.document_intakes language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_old public.document_intakes; v_new public.document_intakes;
begin
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id);
  if v_role is null or v_role='viewer' then raise exception 'P8_PERMISSION_DENIED'; end if;
  if p_to_status='submitted' then raise exception 'P8_USE_FINALISE'; end if;
  select * into v_old from public.document_intakes where id=p_intake_id and business_id=p_business_id and deleted_at is null for update;
  if not found then raise exception 'P8_INTAKE_NOT_FOUND'; end if;
  if not public.document_intake_transition_allowed(v_old.status,p_to_status) then raise exception 'P8_INVALID_STATUS_TRANSITION'; end if;
  if v_old.status=p_to_status then return v_old; end if;
  update public.document_intakes set status=p_to_status,version=version+1,updated_at=now(),last_error_code=p_error_code,
    submitted_at=case when p_to_status='submitted' then now() else submitted_at end,
    cancelled_at=case when p_to_status='cancelled' then now() else cancelled_at end
  where id=p_intake_id returning * into v_new;
  insert into public.document_intake_events(intake_id,business_id,from_status,to_status,intake_version,actor_id,actor_role,action,error_code,correlation_id)
  values(p_intake_id,p_business_id,v_old.status,p_to_status,v_new.version,p_actor_id,v_role,p_action,p_error_code,p_correlation_id);
  insert into public.audit_logs(business_id,action,actor_type,actor_id,actor_role,entity_type,entity_id,correlation_id,metadata)
  values(p_business_id,p_action,'staff',p_actor_id,v_role,'document_intake',p_intake_id::text,p_correlation_id,
    jsonb_build_object('from_status',v_old.status,'to_status',p_to_status,'error_code',p_error_code));
  return v_new;
end; $$;

create or replace function public.document_intake_attach_evidence(
  p_business_id uuid,p_intake_id uuid,p_actor_id uuid,p_evidence_id uuid,
  p_original_filename text,p_generated_storage_name text,p_storage_bucket text,p_object_path text,
  p_declared_mime_type text,p_magic_mime_type text,p_file_size_bytes integer,p_page_count integer,p_sha256 text,
  p_document_kind text,p_upload_source text,p_action_scope text,p_idempotency_key text,
  p_request_hash text,p_supersedes_evidence_id uuid,p_scan_provider text,p_correlation_id uuid
) returns public.evidence_files language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_intake public.document_intakes; v_existing_key public.document_intake_idempotency_keys;
  v_existing_file public.evidence_files; v_duplicate_id uuid; v_version integer; v_file public.evidence_files; v_old_status text;
begin
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id);
  if v_role is null or v_role='viewer' then raise exception 'P8_PERMISSION_DENIED'; end if;
  if p_action_scope not in ('upload','replace') then raise exception 'P8_INVALID_ACTION_SCOPE'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':'||p_action_scope||':'||p_idempotency_key,0));
  select * into v_existing_key from public.document_intake_idempotency_keys
    where business_id=p_business_id and action_scope=p_action_scope and idempotency_key=p_idempotency_key;
  if found then
    if v_existing_key.request_hash<>p_request_hash then raise exception 'P8_IDEMPOTENCY_CONFLICT'; end if;
    select * into v_existing_file from public.evidence_files where id=v_existing_key.resource_id and business_id=p_business_id;
    return v_existing_file;
  end if;
  select * into v_intake from public.document_intakes
    where id=p_intake_id and business_id=p_business_id and deleted_at is null for update;
  if not found then raise exception 'P8_INTAKE_NOT_FOUND'; end if;
  if v_intake.status in ('submitted','cancelled') then raise exception 'P8_INTAKE_LOCKED'; end if;
  if not public.document_intake_transition_allowed(v_intake.status,'uploaded') then raise exception 'P8_INVALID_STATUS_TRANSITION'; end if;
  if p_storage_bucket<>'transaction-evidence' or p_object_path<>(p_business_id::text||'/'||p_intake_id::text||'/'||p_evidence_id::text||'/'||p_generated_storage_name)
    then raise exception 'P8_INVALID_STORAGE_PATH'; end if;
  if p_sha256 !~ '^[0-9a-f]{64}$' or p_file_size_bytes<=0 or (p_page_count is not null and p_page_count<=0)
    then raise exception 'P8_INVALID_FILE_METADATA'; end if;
  if p_supersedes_evidence_id is not null then
    select * into v_existing_file from public.evidence_files
      where id=p_supersedes_evidence_id and intake_id=p_intake_id and business_id=p_business_id
        and kind='original' and soft_deleted_at is null for update;
    if not found then raise exception 'P8_EVIDENCE_NOT_FOUND'; end if;
    update public.evidence_files set is_current=false where id=p_supersedes_evidence_id;
  end if;
  select id into v_duplicate_id from public.evidence_files
    where business_id=p_business_id and content_sha256=p_sha256 and archived_at is null and soft_deleted_at is null
    order by uploaded_at,id limit 1;
  select coalesce(max(evidence_version),0)+1 into v_version from public.evidence_files
    where intake_id=p_intake_id and kind='original';
  insert into public.evidence_files(
    id,case_id,business_id,intake_id,file_name,file_type,file_url,file_size_bytes,page_count,evidence_type,object_path,
    retention_until,content_sha256,kind,generated_storage_name,storage_bucket,declared_mime_type,magic_mime_type,
    upload_source,is_immutable,is_original,evidence_version,is_current,supersedes_evidence_id,scan_provider,scan_status,
    processing_status,processing_version,duplicate_match_status,duplicate_of_evidence_id,idempotency_scope,idempotency_key,request_hash
  ) values(
    p_evidence_id,null,p_business_id,p_intake_id,left(p_original_filename,255),upper(regexp_replace(p_generated_storage_name,'^.*\.','','g')),
    null,p_file_size_bytes,p_page_count,p_document_kind,p_object_path,v_intake.retention_until,p_sha256,'original',p_generated_storage_name,
    p_storage_bucket,p_declared_mime_type,p_magic_mime_type,p_upload_source,true,true,v_version,true,p_supersedes_evidence_id,
    p_scan_provider,'pending','queued',1,case when v_duplicate_id is null then 'none' else 'exact_hash_warning' end,
    v_duplicate_id,p_action_scope,p_idempotency_key,p_request_hash
  ) returning * into v_file;
  insert into public.document_intake_extractions(intake_id,evidence_id,business_id,provider,parser_version,status,idempotency_key)
  values(p_intake_id,v_file.id,p_business_id,'unassigned','pending','queued','extract:'||v_file.id::text);
  v_old_status:=v_intake.status;
  update public.document_intakes set status='uploaded',version=version+1,updated_at=now(),last_error_code=null
    where id=p_intake_id returning * into v_intake;
  insert into public.document_intake_idempotency_keys(business_id,action_scope,idempotency_key,request_hash,actor_id,resource_type,resource_id,response_status)
  values(p_business_id,p_action_scope,p_idempotency_key,p_request_hash,p_actor_id,'evidence_file',v_file.id,201);
  insert into public.document_intake_events(intake_id,business_id,from_status,to_status,intake_version,actor_id,actor_role,action,metadata,correlation_id,idempotency_key)
  values(p_intake_id,p_business_id,v_old_status,'uploaded',v_intake.version,p_actor_id,v_role,
    case when p_action_scope='replace' then 'document_evidence.replaced' else 'document_evidence.uploaded' end,
    jsonb_build_object('evidence_id',v_file.id,'evidence_version',v_version,'duplicate_warning',v_duplicate_id is not null,'scan_status','pending'),
    p_correlation_id,p_idempotency_key);
  insert into public.audit_logs(business_id,action,actor_type,actor_id,actor_role,entity_type,entity_id,correlation_id,idempotency_key,metadata)
  values(p_business_id,case when p_action_scope='replace' then 'document_evidence.replaced' else 'document_evidence.uploaded' end,
    'staff',p_actor_id,v_role,'evidence_file',v_file.id::text,p_correlation_id,p_idempotency_key,
    jsonb_build_object('intake_id',p_intake_id,'evidence_version',v_version,'document_kind',p_document_kind,
      'bytes',p_file_size_bytes,'duplicate_warning',v_duplicate_id is not null,'scan_status','pending'));
  return v_file;
end; $$;

create or replace function public.document_intake_remove_evidence(
  p_business_id uuid,p_intake_id uuid,p_actor_id uuid,p_evidence_id uuid,
  p_idempotency_key text,p_request_hash text,p_correlation_id uuid
) returns public.document_intakes language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_intake public.document_intakes; v_file public.evidence_files;
  v_existing public.document_intake_idempotency_keys; v_old_status text;
begin
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id);
  if v_role is null or v_role='viewer' then raise exception 'P8_PERMISSION_DENIED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':remove:'||p_idempotency_key,0));
  select * into v_existing from public.document_intake_idempotency_keys
    where business_id=p_business_id and action_scope='remove' and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_hash<>p_request_hash then raise exception 'P8_IDEMPOTENCY_CONFLICT'; end if;
    select * into v_intake from public.document_intakes where id=p_intake_id and business_id=p_business_id;
    return v_intake;
  end if;
  select * into v_intake from public.document_intakes
    where id=p_intake_id and business_id=p_business_id and deleted_at is null for update;
  if not found then raise exception 'P8_INTAKE_NOT_FOUND'; end if;
  if v_intake.status in ('submitted','cancelled') then raise exception 'P8_INTAKE_LOCKED'; end if;
  select * into v_file from public.evidence_files
    where id=p_evidence_id and intake_id=p_intake_id and business_id=p_business_id
      and kind='original' and is_current and soft_deleted_at is null for update;
  if not found then raise exception 'P9_CURRENT_EVIDENCE_REQUIRED'; end if;
  if not public.document_intake_transition_allowed(v_intake.status,'awaiting_upload')
    then raise exception 'P8_INVALID_STATUS_TRANSITION'; end if;
  update public.evidence_files set is_current=false,soft_deleted_at=now(),processing_status='cancelled'
    where id=p_evidence_id;
  v_old_status:=v_intake.status;
  if v_old_status<>'awaiting_upload' then
    update public.document_intakes set status='awaiting_upload',version=version+1,updated_at=now(),last_error_code=null
      where id=p_intake_id returning * into v_intake;
  end if;
  insert into public.document_intake_idempotency_keys(
    business_id,action_scope,idempotency_key,request_hash,actor_id,resource_type,resource_id,response_status
  ) values(p_business_id,'remove',p_idempotency_key,p_request_hash,p_actor_id,'evidence_file',p_evidence_id,200);
  insert into public.document_intake_events(
    intake_id,business_id,from_status,to_status,intake_version,actor_id,actor_role,action,metadata,correlation_id,idempotency_key
  ) values(
    p_intake_id,p_business_id,v_old_status,v_intake.status,v_intake.version,p_actor_id,v_role,'document_evidence.removed',
    jsonb_build_object('evidence_id',p_evidence_id,'evidence_version',v_file.evidence_version,'object_retained',true),
    p_correlation_id,p_idempotency_key
  );
  insert into public.audit_logs(
    business_id,action,actor_type,actor_id,actor_role,entity_type,entity_id,correlation_id,idempotency_key,metadata
  ) values(
    p_business_id,'document_evidence.removed','staff',p_actor_id,v_role,'evidence_file',p_evidence_id::text,
    p_correlation_id,p_idempotency_key,jsonb_build_object('intake_id',p_intake_id,'object_retained',true)
  );
  return v_intake;
end; $$;

create or replace function public.document_intake_confirm(
  p_business_id uuid,p_intake_id uuid,p_actor_id uuid,p_document_kind text,p_amount_minor bigint,
  p_currency text,p_document_datetime timestamptz,p_reference text,p_bank text,p_sender text,p_recipient text,
  p_transaction_nature text,p_notes text,p_idempotency_key text,p_request_hash text,p_correlation_id uuid
) returns public.document_intake_confirmations language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_intake public.document_intakes; v_existing public.document_intake_confirmations;
  v_confirmation public.document_intake_confirmations; v_version integer; v_old_status text;
begin
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id);
  if v_role is null or v_role='viewer' then raise exception 'P8_PERMISSION_DENIED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':confirm:'||p_idempotency_key,0));
  select * into v_existing from public.document_intake_confirmations
    where business_id=p_business_id and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_hash<>p_request_hash then raise exception 'P8_IDEMPOTENCY_CONFLICT'; end if;
    return v_existing;
  end if;
  select * into v_intake from public.document_intakes where id=p_intake_id and business_id=p_business_id and deleted_at is null for update;
  if not found then raise exception 'P8_INTAKE_NOT_FOUND'; end if;
  if v_intake.status not in ('uploaded','needs_review','ready_to_submit') then raise exception 'P8_CONFIRMATION_NOT_ALLOWED'; end if;
  if not exists(select 1 from public.evidence_files where intake_id=p_intake_id and is_original and is_current and soft_deleted_at is null)
    then raise exception 'P8_EVIDENCE_REQUIRED'; end if;
  select coalesce(max(confirmation_version),0)+1 into v_version from public.document_intake_confirmations where intake_id=p_intake_id;
  v_old_status:=v_intake.status;
  if v_intake.status<>'ready_to_submit' then
    update public.document_intakes set status='ready_to_submit',version=version+1,updated_at=now()
      where id=p_intake_id returning * into v_intake;
  end if;
  -- Bind the append-only confirmation to the resulting state version so
  -- finalise rejects it after any later upload or replacement.
  insert into public.document_intake_confirmations(
    intake_id,business_id,confirmation_version,intake_version,confirmed_document_kind,chosen_amount_minor,currency,
    document_datetime,reference,bank,sender,recipient,transaction_nature,notes,confirmed_by,idempotency_key,request_hash
  ) values(
    p_intake_id,p_business_id,v_version,v_intake.version,p_document_kind,p_amount_minor,nullif(upper(p_currency),''),
    p_document_datetime,nullif(btrim(p_reference),''),nullif(btrim(p_bank),''),nullif(btrim(p_sender),''),
    nullif(btrim(p_recipient),''),nullif(btrim(p_transaction_nature),''),nullif(btrim(p_notes),''),p_actor_id,p_idempotency_key,p_request_hash
  ) returning * into v_confirmation;
  insert into public.document_intake_idempotency_keys(business_id,action_scope,idempotency_key,request_hash,actor_id,resource_type,resource_id,response_status)
  values(p_business_id,'confirm',p_idempotency_key,p_request_hash,p_actor_id,'document_intake_confirmation',v_confirmation.id,200);
  insert into public.document_intake_events(intake_id,business_id,from_status,to_status,intake_version,actor_id,actor_role,action,correlation_id,idempotency_key)
  values(p_intake_id,p_business_id,v_old_status,v_intake.status,v_intake.version,p_actor_id,v_role,'document_intake.confirmed',p_correlation_id,p_idempotency_key);
  insert into public.audit_logs(business_id,action,actor_type,actor_id,actor_role,entity_type,entity_id,correlation_id,idempotency_key,metadata)
  values(p_business_id,'document_intake.confirmed','staff',p_actor_id,v_role,'document_intake',p_intake_id::text,p_correlation_id,p_idempotency_key,
    jsonb_build_object('confirmation_version',v_version,'document_kind',p_document_kind,'has_amount',p_amount_minor is not null));
  return v_confirmation;
end; $$;

create or replace function public.document_intake_finalise(
  p_business_id uuid,p_intake_id uuid,p_actor_id uuid,p_idempotency_key text,p_request_hash text,p_correlation_id uuid
) returns public.document_intakes language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_intake public.document_intakes; v_existing public.document_intake_idempotency_keys;
  v_confirmation public.document_intake_confirmations; v_new public.document_intakes;
begin
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id);
  if v_role is null or v_role not in ('owner','admin','manager') then raise exception 'P8_SUBMIT_PERMISSION_DENIED'; end if;
  if v_role='manager' and not coalesce((select manager_can_submit_document_intakes from public.business_role_settings where business_id=p_business_id),false)
    then raise exception 'P8_SUBMIT_PERMISSION_DENIED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':finalise:'||p_idempotency_key,0));
  select * into v_existing from public.document_intake_idempotency_keys
    where business_id=p_business_id and action_scope='finalise' and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_hash<>p_request_hash then raise exception 'P8_IDEMPOTENCY_CONFLICT'; end if;
    select * into v_new from public.document_intakes where id=v_existing.resource_id and business_id=p_business_id;
    return v_new;
  end if;
  select * into v_intake from public.document_intakes where id=p_intake_id and business_id=p_business_id and deleted_at is null for update;
  if not found then raise exception 'P8_INTAKE_NOT_FOUND'; end if;
  if v_intake.status<>'ready_to_submit' then raise exception 'P8_INVALID_STATUS_TRANSITION'; end if;
  select * into v_confirmation from public.document_intake_confirmations
    where intake_id=p_intake_id order by confirmation_version desc limit 1;
  if not found or v_confirmation.intake_version<>v_intake.version then raise exception 'P8_CONFIRMATION_REQUIRED'; end if;
  if not exists(select 1 from public.evidence_files where intake_id=p_intake_id and is_original and is_current and soft_deleted_at is null)
    then raise exception 'P8_EVIDENCE_REQUIRED'; end if;
  if exists(select 1 from public.evidence_files where intake_id=p_intake_id and is_original and is_current
    and soft_deleted_at is null and scan_status<>'clean') then raise exception 'P8_EVIDENCE_SCAN_PENDING'; end if;
  update public.document_intakes set status='submitted',version=version+1,submitted_at=now(),updated_at=now()
    where id=p_intake_id returning * into v_new;
  insert into public.document_intake_idempotency_keys(business_id,action_scope,idempotency_key,request_hash,actor_id,resource_type,resource_id,response_status)
  values(p_business_id,'finalise',p_idempotency_key,p_request_hash,p_actor_id,'document_intake',p_intake_id,200);
  insert into public.document_intake_events(intake_id,business_id,from_status,to_status,intake_version,actor_id,actor_role,action,correlation_id,idempotency_key)
  values(p_intake_id,p_business_id,v_intake.status,'submitted',v_new.version,p_actor_id,v_role,'document_intake.submitted',p_correlation_id,p_idempotency_key);
  insert into public.audit_logs(business_id,action,actor_type,actor_id,actor_role,entity_type,entity_id,correlation_id,idempotency_key,metadata)
  values(p_business_id,'document_intake.submitted','staff',p_actor_id,v_role,'document_intake',p_intake_id::text,p_correlation_id,p_idempotency_key,
    jsonb_build_object('intake_version',v_new.version,'confirmation_version',v_confirmation.confirmation_version));
  return v_new;
end; $$;

create or replace function public.document_intake_cancel(
  p_business_id uuid,p_intake_id uuid,p_actor_id uuid,p_idempotency_key text,p_request_hash text,p_correlation_id uuid
) returns public.document_intakes language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_intake public.document_intakes; v_existing public.document_intake_idempotency_keys; v_new public.document_intakes;
begin
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id);
  if v_role is null or v_role='viewer' then raise exception 'P8_PERMISSION_DENIED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':cancel:'||p_idempotency_key,0));
  select * into v_existing from public.document_intake_idempotency_keys
    where business_id=p_business_id and action_scope='cancel' and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_hash<>p_request_hash then raise exception 'P8_IDEMPOTENCY_CONFLICT'; end if;
    select * into v_new from public.document_intakes where id=v_existing.resource_id and business_id=p_business_id;
    return v_new;
  end if;
  select * into v_intake from public.document_intakes where id=p_intake_id and business_id=p_business_id for update;
  if not found then raise exception 'P8_INTAKE_NOT_FOUND'; end if;
  if v_intake.status='submitted' then raise exception 'P8_SUBMITTED_INTAKE_IMMUTABLE'; end if;
  if v_intake.status='cancelled' then return v_intake; end if;
  if not public.document_intake_transition_allowed(v_intake.status,'cancelled') then raise exception 'P8_INVALID_STATUS_TRANSITION'; end if;
  update public.document_intakes set status='cancelled',version=version+1,cancelled_at=now(),deleted_at=now(),updated_at=now()
    where id=p_intake_id returning * into v_new;
  insert into public.document_intake_idempotency_keys(business_id,action_scope,idempotency_key,request_hash,actor_id,resource_type,resource_id,response_status)
  values(p_business_id,'cancel',p_idempotency_key,p_request_hash,p_actor_id,'document_intake',p_intake_id,200);
  insert into public.document_intake_events(intake_id,business_id,from_status,to_status,intake_version,actor_id,actor_role,action,correlation_id,idempotency_key)
  values(p_intake_id,p_business_id,v_intake.status,'cancelled',v_new.version,p_actor_id,v_role,'document_intake.cancelled',p_correlation_id,p_idempotency_key);
  insert into public.audit_logs(business_id,action,actor_type,actor_id,actor_role,entity_type,entity_id,correlation_id,idempotency_key,metadata)
  values(p_business_id,'document_intake.cancelled','staff',p_actor_id,v_role,'document_intake',p_intake_id::text,p_correlation_id,p_idempotency_key,
    jsonb_build_object('retention_until',v_intake.retention_until));
  return v_new;
end; $$;

-- Replace the membership permission helper without introducing another role
-- system. Staff can draft/upload; manager submission remains tenant-configurable.
create or replace function public.has_business_permission(p_business_id uuid,p_permission text)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  with membership as (
    select coalesce(m.role,case when b.owner_id=auth.uid() then 'owner' end) role
    from public.businesses b
    left join public.business_memberships m on m.business_id=b.id and m.user_id=auth.uid() and m.status='active'
    where b.id=p_business_id and (b.owner_id=auth.uid() or m.id is not null)
    limit 1
  ), settings as (select * from public.business_role_settings where business_id=p_business_id)
  select coalesce((select case
    when role in ('owner','admin') then true
    when p_permission in ('case.read','document_intake.read') and role in ('manager','staff','viewer') then true
    when p_permission in ('case.manage','payment.approve') and role='manager' then true
    when p_permission='document_intake.create' and role in ('manager','staff') then true
    when p_permission='document_intake.submit' and role='manager'
      then coalesce((select manager_can_submit_document_intakes from settings),false)
    when p_permission='report.read' and role in ('manager','viewer') then true
    when p_permission in ('communication.manage','note.manage','promise.manage') and role in ('manager','staff') then true
    when p_permission='audit.read' and role='manager' then true
    when p_permission='settlement.approve' and role='manager'
      then coalesce((select manager_can_approve_settlements from settings),false)
    when p_permission='write_off.approve' and role='manager'
      then coalesce((select manager_can_approve_write_offs from settings),false)
    else false end from membership),false);
$$;

alter table public.document_intakes enable row level security;
alter table public.document_intake_idempotency_keys enable row level security;
alter table public.document_intake_events enable row level security;
alter table public.document_intake_extractions enable row level security;
alter table public.document_extraction_candidates enable row level security;
alter table public.document_intake_confirmations enable row level security;

drop policy if exists document_intakes_role_read on public.document_intakes;
create policy document_intakes_role_read on public.document_intakes for select to authenticated
  using (public.has_business_permission(business_id,'document_intake.read'));
drop policy if exists document_intake_events_role_read on public.document_intake_events;
create policy document_intake_events_role_read on public.document_intake_events for select to authenticated
  using (public.has_business_permission(business_id,'document_intake.read'));
drop policy if exists document_intake_confirmations_role_read on public.document_intake_confirmations;
create policy document_intake_confirmations_role_read on public.document_intake_confirmations for select to authenticated
  using (public.has_business_permission(business_id,'document_intake.read'));

-- Idempotency records, extraction raw content and all writes are server-only.
-- Evidence metadata remains tenant-readable; intake evidence has no browser
-- write policy. Existing case evidence retains its role-scoped write behavior.
drop policy if exists "owners can manage own evidence" on public.evidence_files;
drop policy if exists "evidence: owner read" on public.evidence_files;
drop policy if exists "evidence: owner insert" on public.evidence_files;
drop policy if exists "evidence: owner update" on public.evidence_files;
drop policy if exists "evidence_files: owner read" on public.evidence_files;
drop policy if exists "evidence_files: owner insert" on public.evidence_files;
drop policy if exists "evidence_files: owner update" on public.evidence_files;
drop policy if exists "evidence_files: owner delete" on public.evidence_files;
drop policy if exists evidence_files_role_read on public.evidence_files;
drop policy if exists evidence_files_case_role_insert on public.evidence_files;
drop policy if exists evidence_files_case_role_update on public.evidence_files;
create policy evidence_files_role_read on public.evidence_files for select to authenticated
  using (public.has_business_permission(business_id,case when intake_id is null then 'case.read' else 'document_intake.read' end));
create policy evidence_files_case_role_insert on public.evidence_files for insert to authenticated
  with check (intake_id is null and case_id is not null and public.has_business_permission(business_id,'case.manage'));
create policy evidence_files_case_role_update on public.evidence_files for update to authenticated
  using (intake_id is null and case_id is not null and public.has_business_permission(business_id,'case.manage'))
  with check (intake_id is null and case_id is not null and public.has_business_permission(business_id,'case.manage'));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('transaction-evidence','transaction-evidence',false,10485760,array['application/pdf'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
-- There is intentionally no authenticated/anonymous storage.objects policy for
-- this bucket. Validated server routes write objects and issue 60-second signed
-- URLs only after tenant authorization and a clean malware-scan state.

revoke all on public.document_intakes,public.document_intake_idempotency_keys,
  public.document_intake_events,public.document_intake_extractions,
  public.document_intake_confirmations from anon;
grant select on public.document_intakes,public.document_intake_events,
  public.document_intake_confirmations to authenticated;
revoke all on public.document_intake_idempotency_keys,public.document_intake_extractions from authenticated;
revoke all on public.document_extraction_candidates from anon,authenticated;
grant all on public.document_intakes,public.document_intake_idempotency_keys,
  public.document_intake_events,public.document_intake_extractions,
  public.document_intake_confirmations to service_role;
grant all on public.document_extraction_candidates to service_role;

revoke all on function public.document_intake_actor_role(uuid,uuid) from public,anon,authenticated;
revoke all on function public.document_intake_create(uuid,uuid,text,text,text,text,text,uuid) from public,anon,authenticated;
revoke all on function public.document_intake_transition(uuid,uuid,uuid,text,text,text,uuid) from public,anon,authenticated;
revoke all on function public.document_intake_attach_evidence(uuid,uuid,uuid,uuid,text,text,text,text,text,text,integer,integer,text,text,text,text,text,text,uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.document_intake_remove_evidence(uuid,uuid,uuid,uuid,text,text,uuid) from public,anon,authenticated;
revoke all on function public.document_intake_confirm(uuid,uuid,uuid,text,bigint,text,timestamptz,text,text,text,text,text,text,text,text,uuid) from public,anon,authenticated;
revoke all on function public.document_intake_finalise(uuid,uuid,uuid,text,text,uuid) from public,anon,authenticated;
revoke all on function public.document_intake_cancel(uuid,uuid,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.document_intake_actor_role(uuid,uuid) to service_role;
grant execute on function public.document_intake_create(uuid,uuid,text,text,text,text,text,uuid) to service_role;
grant execute on function public.document_intake_transition(uuid,uuid,uuid,text,text,text,uuid) to service_role;
grant execute on function public.document_intake_attach_evidence(uuid,uuid,uuid,uuid,text,text,text,text,text,text,integer,integer,text,text,text,text,text,text,uuid,text,uuid) to service_role;
grant execute on function public.document_intake_remove_evidence(uuid,uuid,uuid,uuid,text,text,uuid) to service_role;
grant execute on function public.document_intake_confirm(uuid,uuid,uuid,text,bigint,text,timestamptz,text,text,text,text,text,text,text,text,uuid) to service_role;
grant execute on function public.document_intake_finalise(uuid,uuid,uuid,text,text,uuid) to service_role;
grant execute on function public.document_intake_cancel(uuid,uuid,uuid,text,text,uuid) to service_role;

commit;

-- Reversible deployment plan:
-- 1. Stop application writes and preserve/export audit, intake, confirmation and
--    evidence metadata required by retention policy.
-- 2. Drop the Prompt 8 policies/functions/triggers/indexes and new tables in
--    reverse dependency order.
-- 3. Drop intake-only evidence columns only after every intake object has been
--    retained or migrated; restore case_id NOT NULL only after proving no intake
--    rows remain. Never delete originals merely to roll application code back.

-- Prompt 9 and Prompt 10 dependency deltas are mirrored before Prompt 11 so
-- this standalone schema matches the ordered migration chain.
-- Prompt 9 / Phase D: PDF-only transaction file intake.
-- Reviewable proposal only. Apply after 20260831_secure_document_intake_foundation.sql.
-- No OCR, classification, debtor/case/payment creation, or duplicate approval.

begin;

alter table public.document_intake_idempotency_keys
  drop constraint if exists document_intake_idempotency_keys_action_scope_check,
  add constraint document_intake_idempotency_keys_action_scope_check
    check (action_scope in ('create','upload','replace','remove','confirm','finalise','cancel'));

create or replace function public.document_intake_transition_allowed(p_from text,p_to text)
returns boolean language sql immutable as $$
  select p_from=p_to or (p_from,p_to) in (
    ('draft','awaiting_upload'),('draft','cancelled'),
    ('awaiting_upload','uploaded'),('awaiting_upload','failed'),('awaiting_upload','cancelled'),
    ('uploaded','awaiting_upload'),('uploaded','processing'),('uploaded','needs_review'),
    ('uploaded','ready_to_submit'),('uploaded','failed'),('uploaded','cancelled'),
    ('processing','awaiting_upload'),('processing','needs_review'),('processing','ready_to_submit'),('processing','failed'),('processing','cancelled'),
    ('needs_review','awaiting_upload'),('needs_review','processing'),('needs_review','ready_to_submit'),('needs_review','cancelled'),
    ('ready_to_submit','awaiting_upload'),('ready_to_submit','needs_review'),
    ('ready_to_submit','submitted'),('ready_to_submit','cancelled'),
    ('failed','awaiting_upload'),('failed','processing'),('failed','cancelled')
  );
$$;

create or replace function public.document_intake_original_immutable()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if old.intake_id is not null and old.is_immutable and (
    new.business_id is distinct from old.business_id or new.intake_id is distinct from old.intake_id
    or new.case_id is distinct from old.case_id or new.file_name is distinct from old.file_name
    or new.file_type is distinct from old.file_type or new.file_url is distinct from old.file_url
    or new.file_size_bytes is distinct from old.file_size_bytes or new.object_path is distinct from old.object_path
    or new.content_sha256 is distinct from old.content_sha256 or new.kind is distinct from old.kind
    or new.generated_storage_name is distinct from old.generated_storage_name
    or new.storage_bucket is distinct from old.storage_bucket
    or new.declared_mime_type is distinct from old.declared_mime_type
    or new.magic_mime_type is distinct from old.magic_mime_type
    or new.page_count is distinct from old.page_count
    or new.is_original is distinct from old.is_original
    or new.evidence_version is distinct from old.evidence_version
    or new.parent_evidence_id is distinct from old.parent_evidence_id
    or new.supersedes_evidence_id is distinct from old.supersedes_evidence_id
  ) then raise exception 'P8_ORIGINAL_IMMUTABLE'; end if;
  return new;
end; $$;

drop function if exists public.document_intake_attach_evidence(
  uuid,uuid,uuid,uuid,text,text,text,text,text,text,integer,text,text,text,text,text,text,uuid,text,uuid
);
create or replace function public.document_intake_attach_evidence(
  p_business_id uuid,p_intake_id uuid,p_actor_id uuid,p_evidence_id uuid,
  p_original_filename text,p_generated_storage_name text,p_storage_bucket text,p_object_path text,
  p_declared_mime_type text,p_magic_mime_type text,p_file_size_bytes integer,p_page_count integer,p_sha256 text,
  p_document_kind text,p_upload_source text,p_action_scope text,p_idempotency_key text,
  p_request_hash text,p_supersedes_evidence_id uuid,p_scan_provider text,p_correlation_id uuid
) returns public.evidence_files language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_intake public.document_intakes; v_existing_key public.document_intake_idempotency_keys;
  v_existing_file public.evidence_files; v_duplicate_id uuid; v_version integer; v_file public.evidence_files; v_old_status text;
begin
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id);
  if v_role is null or v_role='viewer' then raise exception 'P8_PERMISSION_DENIED'; end if;
  if p_action_scope not in ('upload','replace') then raise exception 'P8_INVALID_ACTION_SCOPE'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':'||p_action_scope||':'||p_idempotency_key,0));
  select * into v_existing_key from public.document_intake_idempotency_keys
    where business_id=p_business_id and action_scope=p_action_scope and idempotency_key=p_idempotency_key;
  if found then
    if v_existing_key.request_hash<>p_request_hash then raise exception 'P8_IDEMPOTENCY_CONFLICT'; end if;
    select * into v_existing_file from public.evidence_files where id=v_existing_key.resource_id and business_id=p_business_id;
    return v_existing_file;
  end if;
  select * into v_intake from public.document_intakes
    where id=p_intake_id and business_id=p_business_id and deleted_at is null for update;
  if not found then raise exception 'P8_INTAKE_NOT_FOUND'; end if;
  if v_intake.status in ('submitted','cancelled') then raise exception 'P8_INTAKE_LOCKED'; end if;
  if not public.document_intake_transition_allowed(v_intake.status,'uploaded') then raise exception 'P8_INVALID_STATUS_TRANSITION'; end if;
  if p_storage_bucket<>'transaction-evidence' or p_object_path<>(p_business_id::text||'/'||p_intake_id::text||'/'||p_evidence_id::text||'/'||p_generated_storage_name)
    then raise exception 'P8_INVALID_STORAGE_PATH'; end if;
  if p_declared_mime_type<>'application/pdf' or p_magic_mime_type<>'application/pdf'
    or p_generated_storage_name<>'original.pdf' or p_sha256 !~ '^[0-9a-f]{64}$'
    or p_file_size_bytes<=0 or (p_page_count is not null and p_page_count<=0)
    then raise exception 'P8_INVALID_FILE_METADATA'; end if;
  if p_supersedes_evidence_id is not null then
    select * into v_existing_file from public.evidence_files
      where id=p_supersedes_evidence_id and intake_id=p_intake_id and business_id=p_business_id
        and kind='original' and is_current and soft_deleted_at is null for update;
    if not found then raise exception 'P8_EVIDENCE_NOT_FOUND'; end if;
    update public.evidence_files set is_current=false where id=p_supersedes_evidence_id;
  end if;
  select id into v_duplicate_id from public.evidence_files
    where business_id=p_business_id and content_sha256=p_sha256 and archived_at is null and soft_deleted_at is null
    order by uploaded_at,id limit 1;
  select coalesce(max(evidence_version),0)+1 into v_version from public.evidence_files
    where intake_id=p_intake_id and kind='original';
  insert into public.evidence_files(
    id,case_id,business_id,intake_id,file_name,file_type,file_url,file_size_bytes,page_count,evidence_type,object_path,
    retention_until,content_sha256,kind,generated_storage_name,storage_bucket,declared_mime_type,magic_mime_type,
    upload_source,is_immutable,is_original,evidence_version,is_current,supersedes_evidence_id,scan_provider,scan_status,
    processing_status,processing_version,duplicate_match_status,duplicate_of_evidence_id,idempotency_scope,idempotency_key,request_hash
  ) values(
    p_evidence_id,null,p_business_id,p_intake_id,left(p_original_filename,255),'PDF',null,p_file_size_bytes,p_page_count,
    p_document_kind,p_object_path,v_intake.retention_until,p_sha256,'original',p_generated_storage_name,p_storage_bucket,
    p_declared_mime_type,p_magic_mime_type,p_upload_source,true,true,v_version,true,p_supersedes_evidence_id,
    p_scan_provider,'pending','queued',1,case when v_duplicate_id is null then 'none' else 'exact_hash_warning' end,
    v_duplicate_id,p_action_scope,p_idempotency_key,p_request_hash
  ) returning * into v_file;
  insert into public.document_intake_extractions(intake_id,evidence_id,business_id,provider,parser_version,status,idempotency_key)
  values(p_intake_id,v_file.id,p_business_id,'unassigned','pending','queued','extract:'||v_file.id::text);
  v_old_status:=v_intake.status;
  update public.document_intakes set status='uploaded',version=version+1,updated_at=now(),last_error_code=null
    where id=p_intake_id returning * into v_intake;
  insert into public.document_intake_idempotency_keys(business_id,action_scope,idempotency_key,request_hash,actor_id,resource_type,resource_id,response_status)
  values(p_business_id,p_action_scope,p_idempotency_key,p_request_hash,p_actor_id,'evidence_file',v_file.id,201);
  insert into public.document_intake_events(intake_id,business_id,from_status,to_status,intake_version,actor_id,actor_role,action,metadata,correlation_id,idempotency_key)
  values(p_intake_id,p_business_id,v_old_status,'uploaded',v_intake.version,p_actor_id,v_role,
    case when p_action_scope='replace' then 'document_evidence.replaced' else 'document_evidence.uploaded' end,
    jsonb_build_object('evidence_id',v_file.id,'evidence_version',v_version,'duplicate_warning',v_duplicate_id is not null,
      'scan_status','pending','page_count',p_page_count),p_correlation_id,p_idempotency_key);
  insert into public.audit_logs(business_id,action,actor_type,actor_id,actor_role,entity_type,entity_id,correlation_id,idempotency_key,metadata)
  values(p_business_id,case when p_action_scope='replace' then 'document_evidence.replaced' else 'document_evidence.uploaded' end,
    'staff',p_actor_id,v_role,'evidence_file',v_file.id::text,p_correlation_id,p_idempotency_key,
    jsonb_build_object('intake_id',p_intake_id,'evidence_version',v_version,'document_kind',p_document_kind,
      'bytes',p_file_size_bytes,'page_count',p_page_count,'duplicate_warning',v_duplicate_id is not null,'scan_status','pending'));
  return v_file;
end; $$;

create or replace function public.document_intake_remove_evidence(
  p_business_id uuid,p_intake_id uuid,p_actor_id uuid,p_evidence_id uuid,
  p_idempotency_key text,p_request_hash text,p_correlation_id uuid
) returns public.document_intakes language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_intake public.document_intakes; v_file public.evidence_files;
  v_existing public.document_intake_idempotency_keys; v_old_status text;
begin
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id);
  if v_role is null or v_role='viewer' then raise exception 'P8_PERMISSION_DENIED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':remove:'||p_idempotency_key,0));
  select * into v_existing from public.document_intake_idempotency_keys
    where business_id=p_business_id and action_scope='remove' and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_hash<>p_request_hash then raise exception 'P8_IDEMPOTENCY_CONFLICT'; end if;
    select * into v_intake from public.document_intakes where id=p_intake_id and business_id=p_business_id;
    return v_intake;
  end if;
  select * into v_intake from public.document_intakes
    where id=p_intake_id and business_id=p_business_id and deleted_at is null for update;
  if not found then raise exception 'P8_INTAKE_NOT_FOUND'; end if;
  if v_intake.status in ('submitted','cancelled') then raise exception 'P8_INTAKE_LOCKED'; end if;
  select * into v_file from public.evidence_files
    where id=p_evidence_id and intake_id=p_intake_id and business_id=p_business_id
      and kind='original' and is_current and soft_deleted_at is null for update;
  if not found then raise exception 'P9_CURRENT_EVIDENCE_REQUIRED'; end if;
  if not public.document_intake_transition_allowed(v_intake.status,'awaiting_upload')
    then raise exception 'P8_INVALID_STATUS_TRANSITION'; end if;
  update public.evidence_files set is_current=false,soft_deleted_at=now(),processing_status='cancelled'
    where id=p_evidence_id;
  v_old_status:=v_intake.status;
  if v_old_status<>'awaiting_upload' then
    update public.document_intakes set status='awaiting_upload',version=version+1,updated_at=now(),last_error_code=null
      where id=p_intake_id returning * into v_intake;
  end if;
  insert into public.document_intake_idempotency_keys(
    business_id,action_scope,idempotency_key,request_hash,actor_id,resource_type,resource_id,response_status
  ) values(p_business_id,'remove',p_idempotency_key,p_request_hash,p_actor_id,'evidence_file',p_evidence_id,200);
  insert into public.document_intake_events(
    intake_id,business_id,from_status,to_status,intake_version,actor_id,actor_role,action,metadata,correlation_id,idempotency_key
  ) values(
    p_intake_id,p_business_id,v_old_status,v_intake.status,v_intake.version,p_actor_id,v_role,'document_evidence.removed',
    jsonb_build_object('evidence_id',p_evidence_id,'evidence_version',v_file.evidence_version,'object_retained',true),
    p_correlation_id,p_idempotency_key
  );
  insert into public.audit_logs(
    business_id,action,actor_type,actor_id,actor_role,entity_type,entity_id,correlation_id,idempotency_key,metadata
  ) values(
    p_business_id,'document_evidence.removed','staff',p_actor_id,v_role,'evidence_file',p_evidence_id::text,
    p_correlation_id,p_idempotency_key,jsonb_build_object('intake_id',p_intake_id,'object_retained',true)
  );
  return v_intake;
end; $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('transaction-evidence','transaction-evidence',false,10485760,array['application/pdf'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

revoke all on function public.document_intake_attach_evidence(uuid,uuid,uuid,uuid,text,text,text,text,text,text,integer,integer,text,text,text,text,text,text,uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.document_intake_remove_evidence(uuid,uuid,uuid,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.document_intake_attach_evidence(uuid,uuid,uuid,uuid,text,text,text,text,text,text,integer,integer,text,text,text,text,text,text,uuid,text,uuid) to service_role;
grant execute on function public.document_intake_remove_evidence(uuid,uuid,uuid,uuid,text,text,uuid) to service_role;

commit;

-- Rollback: stop intake traffic, retain all originals/audit records, restore the
-- Prompt 8 attach function signature and bucket MIME list, then drop only the
-- remove RPC and action-scope constraint after confirming no `remove` keys exist.

-- Prompt 10 / Phase D: screenshot and bank-in receipt intake.
-- Reviewable proposal only. Apply after 20260901_pdf_transaction_file_intake.sql.
-- No OCR, AI classification, transaction creation, authenticity decision, or perceptual auto-match.

begin;

alter table public.evidence_files
  add column if not exists evidence_source text,
  add column if not exists quality_warnings text[] not null default '{}',
  add column if not exists derivative_transform jsonb;

alter table public.evidence_files
  drop constraint if exists evidence_files_evidence_source_check,
  add constraint evidence_files_evidence_source_check check (
    intake_id is null or evidence_source in ('pdf','screenshot','bank_in_receipt','other_image')
  );

update storage.buckets
set public=false,
    file_size_limit=15728640,
    allowed_mime_types=array['application/pdf','image/png','image/jpeg','image/heic','image/heif']
where id='transaction-evidence';

create or replace function public.document_intake_original_immutable()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if old.intake_id is not null and old.is_immutable and (
    new.business_id is distinct from old.business_id or new.intake_id is distinct from old.intake_id
    or new.case_id is distinct from old.case_id or new.file_name is distinct from old.file_name
    or new.file_type is distinct from old.file_type or new.file_url is distinct from old.file_url
    or new.file_size_bytes is distinct from old.file_size_bytes or new.object_path is distinct from old.object_path
    or new.content_sha256 is distinct from old.content_sha256 or new.kind is distinct from old.kind
    or new.generated_storage_name is distinct from old.generated_storage_name
    or new.storage_bucket is distinct from old.storage_bucket
    or new.declared_mime_type is distinct from old.declared_mime_type
    or new.magic_mime_type is distinct from old.magic_mime_type
    or new.page_count is distinct from old.page_count
    or new.image_width is distinct from old.image_width or new.image_height is distinct from old.image_height
    or new.evidence_source is distinct from old.evidence_source or new.quality_warnings is distinct from old.quality_warnings
    or new.derivative_transform is distinct from old.derivative_transform
    or new.is_original is distinct from old.is_original
    or new.evidence_version is distinct from old.evidence_version
    or new.parent_evidence_id is distinct from old.parent_evidence_id
    or new.supersedes_evidence_id is distinct from old.supersedes_evidence_id
  ) then raise exception 'P8_ORIGINAL_IMMUTABLE'; end if;
  return new;
end; $$;

drop function if exists public.document_intake_attach_evidence(
  uuid,uuid,uuid,uuid,text,text,text,text,text,text,integer,integer,text,text,text,text,text,text,uuid,text,uuid
);
create or replace function public.document_intake_attach_evidence(
  p_business_id uuid,p_intake_id uuid,p_actor_id uuid,p_evidence_id uuid,
  p_original_filename text,p_generated_storage_name text,p_storage_bucket text,p_object_path text,
  p_declared_mime_type text,p_magic_mime_type text,p_file_size_bytes integer,p_page_count integer,
  p_image_width integer,p_image_height integer,p_sha256 text,p_document_kind text,p_evidence_source text,
  p_quality_warnings text[],p_preview_object_path text,p_preview_generated_name text,p_preview_size_bytes integer,
  p_preview_width integer,p_preview_height integer,p_preview_sha256 text,p_upload_source text,p_action_scope text,
  p_derivative_transform jsonb,p_idempotency_key text,p_request_hash text,p_supersedes_evidence_id uuid,p_scan_provider text,p_correlation_id uuid
) returns public.evidence_files language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_intake public.document_intakes; v_existing_key public.document_intake_idempotency_keys;
  v_existing_file public.evidence_files; v_duplicate_id uuid; v_version integer; v_file public.evidence_files; v_old_status text;
begin
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id);
  if v_role is null or v_role='viewer' then raise exception 'P8_PERMISSION_DENIED'; end if;
  if p_action_scope not in ('upload','replace') then raise exception 'P8_INVALID_ACTION_SCOPE'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':'||p_action_scope||':'||p_idempotency_key,0));
  select * into v_existing_key from public.document_intake_idempotency_keys
    where business_id=p_business_id and action_scope=p_action_scope and idempotency_key=p_idempotency_key;
  if found then
    if v_existing_key.request_hash<>p_request_hash then raise exception 'P8_IDEMPOTENCY_CONFLICT'; end if;
    select * into v_existing_file from public.evidence_files where id=v_existing_key.resource_id and business_id=p_business_id;
    return v_existing_file;
  end if;
  select * into v_intake from public.document_intakes
    where id=p_intake_id and business_id=p_business_id and deleted_at is null for update;
  if not found then raise exception 'P8_INTAKE_NOT_FOUND'; end if;
  if v_intake.status in ('submitted','cancelled') then raise exception 'P8_INTAKE_LOCKED'; end if;
  if not public.document_intake_transition_allowed(v_intake.status,'uploaded') then raise exception 'P8_INVALID_STATUS_TRANSITION'; end if;
  if p_storage_bucket<>'transaction-evidence'
    or p_object_path<>(p_business_id::text||'/'||p_intake_id::text||'/'||p_evidence_id::text||'/'||p_generated_storage_name)
    then raise exception 'P8_INVALID_STORAGE_PATH'; end if;
  if p_sha256 !~ '^[0-9a-f]{64}$' or p_file_size_bytes<=0 then raise exception 'P8_INVALID_FILE_METADATA'; end if;
  if p_evidence_source='pdf' then
    if p_magic_mime_type<>'application/pdf' or p_declared_mime_type<>'application/pdf'
      or p_generated_storage_name<>'original.pdf' or p_page_count is not null and p_page_count<=0
      or p_image_width is not null or p_image_height is not null or p_preview_object_path is not null
      then raise exception 'P8_INVALID_FILE_METADATA'; end if;
  elsif p_evidence_source in ('screenshot','bank_in_receipt','other_image') then
    if p_magic_mime_type not in ('image/png','image/jpeg','image/heic')
      or p_declared_mime_type not in ('image/png','image/jpeg','image/heic','image/heif')
      or p_image_width is null or p_image_width<=0 or p_image_height is null or p_image_height<=0
      or p_page_count is not null or p_preview_generated_name<>'preview.jpg'
      or p_preview_object_path<>(p_business_id::text||'/'||p_intake_id::text||'/'||p_evidence_id::text||'/preview.jpg')
      or p_preview_size_bytes is null or p_preview_size_bytes<=0 or p_preview_width is null or p_preview_width<=0
      or p_preview_height is null or p_preview_height<=0 or p_preview_sha256 !~ '^[0-9a-f]{64}$'
      then raise exception 'P8_INVALID_FILE_METADATA'; end if;
  else raise exception 'P8_INVALID_FILE_METADATA'; end if;
  if p_supersedes_evidence_id is not null then
    select * into v_existing_file from public.evidence_files
      where id=p_supersedes_evidence_id and intake_id=p_intake_id and business_id=p_business_id
        and kind='original' and is_current and soft_deleted_at is null for update;
    if not found then raise exception 'P8_EVIDENCE_NOT_FOUND'; end if;
    update public.evidence_files set is_current=false where id=p_supersedes_evidence_id or parent_evidence_id=p_supersedes_evidence_id;
  end if;
  select id into v_duplicate_id from public.evidence_files
    where business_id=p_business_id and kind='original' and content_sha256=p_sha256
      and archived_at is null and soft_deleted_at is null order by uploaded_at,id limit 1;
  select coalesce(max(evidence_version),0)+1 into v_version from public.evidence_files
    where intake_id=p_intake_id and kind='original';
  insert into public.evidence_files(
    id,case_id,business_id,intake_id,file_name,file_type,file_url,file_size_bytes,page_count,image_width,image_height,
    evidence_type,evidence_source,quality_warnings,object_path,retention_until,content_sha256,kind,generated_storage_name,
    storage_bucket,declared_mime_type,magic_mime_type,upload_source,is_immutable,is_original,evidence_version,is_current,
    supersedes_evidence_id,scan_provider,scan_status,processing_status,processing_version,duplicate_match_status,
    duplicate_of_evidence_id,idempotency_scope,idempotency_key,request_hash
  ) values(
    p_evidence_id,null,p_business_id,p_intake_id,left(p_original_filename,255),upper(regexp_replace(p_generated_storage_name,'^.*\.','','g')),
    null,p_file_size_bytes,p_page_count,p_image_width,p_image_height,p_document_kind,p_evidence_source,coalesce(p_quality_warnings,'{}'),
    p_object_path,v_intake.retention_until,p_sha256,'original',p_generated_storage_name,p_storage_bucket,p_declared_mime_type,
    p_magic_mime_type,p_upload_source,true,true,v_version,true,p_supersedes_evidence_id,p_scan_provider,'pending',
    case when cardinality(coalesce(p_quality_warnings,'{}'))>0 then 'needs_review' else 'completed' end,1,
    case when v_duplicate_id is null then 'none' else 'exact_hash_warning' end,v_duplicate_id,p_action_scope,p_idempotency_key,p_request_hash
  ) returning * into v_file;
  if p_preview_object_path is not null then
    insert into public.evidence_files(
      case_id,business_id,intake_id,file_name,file_type,file_size_bytes,evidence_type,evidence_source,quality_warnings,
      object_path,retention_until,content_sha256,kind,generated_storage_name,storage_bucket,declared_mime_type,magic_mime_type,
      upload_source,is_immutable,is_original,evidence_version,is_current,parent_evidence_id,scan_provider,scan_status,
      processing_status,processing_version,duplicate_match_status,image_width,image_height,derivative_transform
    ) values(
      null,p_business_id,p_intake_id,'Safe image preview','JPG',p_preview_size_bytes,p_document_kind,p_evidence_source,
      coalesce(p_quality_warnings,'{}'),p_preview_object_path,v_intake.retention_until,p_preview_sha256,'derived',
      p_preview_generated_name,p_storage_bucket,'image/jpeg','image/jpeg','server_derivative',true,false,v_version,true,
      p_evidence_id,'internal','clean','completed',1,'none',p_preview_width,p_preview_height,p_derivative_transform
    );
  end if;
  v_old_status:=v_intake.status;
  update public.document_intakes set status='uploaded',version=version+1,updated_at=now(),last_error_code=null
    where id=p_intake_id returning * into v_intake;
  insert into public.document_intake_idempotency_keys(business_id,action_scope,idempotency_key,request_hash,actor_id,resource_type,resource_id,response_status)
  values(p_business_id,p_action_scope,p_idempotency_key,p_request_hash,p_actor_id,'evidence_file',v_file.id,201);
  insert into public.document_intake_events(intake_id,business_id,from_status,to_status,intake_version,actor_id,actor_role,action,metadata,correlation_id,idempotency_key)
  values(p_intake_id,p_business_id,v_old_status,'uploaded',v_intake.version,p_actor_id,v_role,
    case when p_action_scope='replace' then 'document_evidence.replaced' else 'document_evidence.uploaded' end,
    jsonb_build_object('evidence_id',v_file.id,'evidence_version',v_version,'evidence_source',p_evidence_source,
      'duplicate_warning',v_duplicate_id is not null,'quality_warnings',coalesce(p_quality_warnings,'{}'),'scan_status','pending'),
    p_correlation_id,p_idempotency_key);
  insert into public.audit_logs(business_id,action,actor_type,actor_id,actor_role,entity_type,entity_id,correlation_id,idempotency_key,metadata)
  values(p_business_id,case when p_action_scope='replace' then 'document_evidence.replaced' else 'document_evidence.uploaded' end,
    'staff',p_actor_id,v_role,'evidence_file',v_file.id::text,p_correlation_id,p_idempotency_key,
    jsonb_build_object('intake_id',p_intake_id,'evidence_version',v_version,'document_kind',p_document_kind,
      'evidence_source',p_evidence_source,'bytes',p_file_size_bytes,'duplicate_warning',v_duplicate_id is not null,
      'quality_warnings',coalesce(p_quality_warnings,'{}'),'scan_status','pending'));
  return v_file;
end; $$;

revoke all on function public.document_intake_attach_evidence(
  uuid,uuid,uuid,uuid,text,text,text,text,text,text,integer,integer,integer,integer,text,text,text,text[],text,text,integer,
  integer,integer,text,text,text,jsonb,text,text,uuid,text,uuid
) from public,anon,authenticated;
grant execute on function public.document_intake_attach_evidence(
  uuid,uuid,uuid,uuid,text,text,text,text,text,text,integer,integer,integer,integer,text,text,text,text[],text,text,integer,
  integer,integer,text,text,text,jsonb,text,text,uuid,text,uuid
) to service_role;

commit;

-- Rollback must retain original and derivative evidence objects and audit rows.
-- Restore the Prompt 9 attach function only after application writes are stopped.

-- The following reviewed Phase D delta is mirrored from the canonical Prompt 11 migration.
-- Prompt 11 / Phase D: OCR, native PDF text extraction and document classification.
-- Reviewable proposal only. Apply after 20260902_image_receipt_intake.sql.
-- Extraction creates candidates and review state only; it never writes cases,
-- profiles, obligations, payments, balances, or other official financial data.

begin;

alter table public.document_intake_idempotency_keys
  drop constraint if exists document_intake_idempotency_keys_action_scope_check,
  add constraint document_intake_idempotency_keys_action_scope_check
    check (action_scope in ('create','upload','replace','remove','confirm','finalise','cancel','extract'));

alter table public.document_intake_extractions
  add column if not exists provider_model text,
  add column if not exists provider_version text,
  add column if not exists extraction_method text,
  add column if not exists protected_raw_result jsonb,
  drop constraint if exists document_intake_extractions_status_check,
  add constraint document_intake_extractions_status_check
    check (status in ('queued','processing','completed','needs_review','failed','cancelled')),
  drop constraint if exists document_intake_extractions_method_check,
  add constraint document_intake_extractions_method_check
    check (extraction_method is null or extraction_method in ('pdf_text_layer','ocr')),
  drop constraint if exists document_intake_extractions_raw_result_check,
  add constraint document_intake_extractions_raw_result_check
    check (protected_raw_result is null or jsonb_typeof(protected_raw_result)='object');

create index if not exists document_intake_extractions_business_intake_idx
  on public.document_intake_extractions(business_id,intake_id,created_at desc);

create or replace function public.document_intake_claim_extraction(p_worker_id text,p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_extraction public.document_intake_extractions; v_evidence public.evidence_files; v_intake public.document_intakes;
  v_old_status text;
begin
  if nullif(trim(p_worker_id),'') is null then raise exception 'P11_INVALID_WORKER'; end if;
  select extraction.* into v_extraction
  from public.document_intake_extractions extraction
  join public.evidence_files evidence on evidence.id=extraction.evidence_id
  join public.document_intakes intake on intake.id=extraction.intake_id
  where extraction.status in ('queued','failed')
    and (extraction.next_attempt_at is null or extraction.next_attempt_at<=p_now)
    and evidence.business_id=extraction.business_id and evidence.intake_id=extraction.intake_id
    and evidence.kind='original' and evidence.is_current and evidence.soft_deleted_at is null
    and evidence.scan_status='clean' and evidence.processing_status not in ('cancelled','completed','needs_review')
    and intake.business_id=extraction.business_id and intake.deleted_at is null
    and intake.status not in ('submitted','cancelled')
  order by coalesce(extraction.next_attempt_at,extraction.created_at),extraction.created_at
  for update of extraction skip locked limit 1;
  if not found then return null; end if;
  select * into v_evidence from public.evidence_files where id=v_extraction.evidence_id for update;
  select * into v_intake from public.document_intakes where id=v_extraction.intake_id for update;

  update public.document_intake_extractions set
    status='processing',attempt_count=attempt_count+1,started_at=coalesce(started_at,p_now),completed_at=null,
    error_code=null,next_attempt_at=null,locked_at=p_now,locked_by=p_worker_id,updated_at=p_now
  where id=v_extraction.id returning * into v_extraction;
  update public.evidence_files set processing_status='processing',processing_version=processing_version+1
    where id=v_evidence.id;
  if v_intake.status<>'processing' then
    v_old_status:=v_intake.status;
    update public.document_intakes set status='processing',version=version+1,updated_at=p_now,last_error_code=null
      where id=v_intake.id returning * into v_intake;
    insert into public.document_intake_events(
      intake_id,business_id,from_status,to_status,intake_version,actor_id,actor_role,action,metadata
    ) values(
      v_intake.id,v_intake.business_id,v_old_status,'processing',v_intake.version,null,null,
      'document_extraction.processing_started',jsonb_build_object('extraction_id',v_extraction.id,'evidence_id',v_evidence.id,'attempt',v_extraction.attempt_count)
    );
  end if;
  return jsonb_build_object(
    'extraction_id',v_extraction.id,'intake_id',v_extraction.intake_id,'evidence_id',v_extraction.evidence_id,
    'business_id',v_extraction.business_id,'storage_bucket',v_evidence.storage_bucket,'object_path',v_evidence.object_path,
    'magic_mime_type',v_evidence.magic_mime_type,'file_name',v_evidence.file_name,
    'file_size_bytes',v_evidence.file_size_bytes,'page_count',v_evidence.page_count,'attempt_count',v_extraction.attempt_count
  );
end; $$;

create or replace function public.document_intake_complete_extraction(
  p_business_id uuid,p_extraction_id uuid,p_worker_id text,p_provider text,p_provider_model text,
  p_provider_version text,p_parser_version text,p_extraction_method text,p_document_classification text,
  p_structured_result jsonb,p_protected_raw_result jsonb,p_confidence numeric,p_warnings jsonb,p_needs_review boolean
) returns public.document_intake_extractions language plpgsql security definer set search_path=public,pg_temp as $$
declare v_extraction public.document_intake_extractions; v_evidence public.evidence_files; v_intake public.document_intakes;
  v_old_status text; v_result_status text;
begin
  select * into v_extraction from public.document_intake_extractions
    where id=p_extraction_id and business_id=p_business_id for update;
  if not found then raise exception 'P11_EXTRACTION_NOT_FOUND'; end if;
  if v_extraction.status<>'processing' or v_extraction.locked_by is distinct from p_worker_id then
    raise exception 'P11_EXTRACTION_LEASE_MISMATCH';
  end if;
  if nullif(trim(p_provider),'') is null or nullif(trim(p_provider_model),'') is null
    or nullif(trim(p_provider_version),'') is null or nullif(trim(p_parser_version),'') is null
    or p_extraction_method not in ('pdf_text_layer','ocr')
    or p_document_classification not in (
      'online_bank_transfer_receipt','transaction_screenshot','bank_in_cash_deposit_receipt','bank_statement',
      'payment_receipt','invoice','credit_note','purchase_order','delivery_order','contract',
      'communication_record','unknown_or_other'
    ) or p_confidence is null or p_confidence<0 or p_confidence>1
    or p_structured_result is null or jsonb_typeof(p_structured_result)<>'object'
    or p_protected_raw_result is null or jsonb_typeof(p_protected_raw_result)<>'object'
    or p_warnings is null or jsonb_typeof(p_warnings)<>'array' then raise exception 'P11_INVALID_EXTRACTION_RESULT'; end if;
  select * into v_evidence from public.evidence_files
    where id=v_extraction.evidence_id and business_id=p_business_id and intake_id=v_extraction.intake_id
      and kind='original' and is_current and soft_deleted_at is null for update;
  select * into v_intake from public.document_intakes
    where id=v_extraction.intake_id and business_id=p_business_id and status not in ('submitted','cancelled') for update;
  if v_evidence.id is null or v_intake.id is null then raise exception 'P11_EXTRACTION_SCOPE_MISMATCH'; end if;
  v_result_status:=case when p_needs_review then 'needs_review' else 'completed' end;
  update public.document_intake_extractions set
    provider=p_provider,provider_model=p_provider_model,provider_version=p_provider_version,parser_version=p_parser_version,
    extraction_method=p_extraction_method,document_classification=p_document_classification,
    structured_result=p_structured_result,protected_raw_result=p_protected_raw_result,protected_raw_text=null,
    confidence=p_confidence,warnings=p_warnings,status=v_result_status,completed_at=now(),error_code=null,
    next_attempt_at=null,locked_at=null,locked_by=null,updated_at=now()
  where id=v_extraction.id returning * into v_extraction;
  update public.evidence_files set processing_status=v_result_status where id=v_evidence.id;
  v_old_status:=v_intake.status;
  update public.document_intakes set status='needs_review',version=version+1,updated_at=now(),last_error_code=null
    where id=v_intake.id returning * into v_intake;
  insert into public.document_intake_events(
    intake_id,business_id,from_status,to_status,intake_version,actor_id,actor_role,action,metadata
  ) values(
    v_intake.id,p_business_id,v_old_status,'needs_review',v_intake.version,null,null,'document_extraction.completed',
    jsonb_build_object('extraction_id',v_extraction.id,'evidence_id',v_evidence.id,'result_status',v_result_status,
      'document_classification',p_document_classification,'classification_confidence',p_confidence,
      'provider',p_provider,'provider_model',p_provider_model,'provider_version',p_provider_version,'parser_version',p_parser_version)
  );
  insert into public.audit_logs(business_id,action,actor_type,entity_type,entity_id,metadata)
  values(p_business_id,'document_extraction.completed','system','document_intake_extraction',v_extraction.id::text,
    jsonb_build_object('intake_id',v_intake.id,'evidence_id',v_evidence.id,'result_status',v_result_status,
      'provider',p_provider,'provider_model',p_provider_model,'provider_version',p_provider_version,'parser_version',p_parser_version));
  return v_extraction;
end; $$;

create or replace function public.document_intake_fail_extraction(
  p_business_id uuid,p_extraction_id uuid,p_worker_id text,p_error_code text,p_retryable boolean,p_max_attempts integer
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_extraction public.document_intake_extractions; v_evidence public.evidence_files; v_intake public.document_intakes;
  v_retry boolean; v_next timestamptz; v_old_status text;
begin
  select * into v_extraction from public.document_intake_extractions
    where id=p_extraction_id and business_id=p_business_id for update;
  if not found then raise exception 'P11_EXTRACTION_NOT_FOUND'; end if;
  if v_extraction.status<>'processing' or v_extraction.locked_by is distinct from p_worker_id then
    raise exception 'P11_EXTRACTION_LEASE_MISMATCH'; end if;
  if p_error_code !~ '^[A-Z0-9_]{3,64}$' or p_max_attempts not between 1 and 5 then
    raise exception 'P11_INVALID_FAILURE'; end if;
  select * into v_evidence from public.evidence_files
    where id=v_extraction.evidence_id and business_id=p_business_id and intake_id=v_extraction.intake_id for update;
  select * into v_intake from public.document_intakes
    where id=v_extraction.intake_id and business_id=p_business_id and status not in ('submitted','cancelled') for update;
  if v_evidence.id is null or v_intake.id is null then raise exception 'P11_EXTRACTION_SCOPE_MISMATCH'; end if;
  if not v_evidence.is_current or v_evidence.soft_deleted_at is not null then
    update public.document_intake_extractions set status='cancelled',error_code='EVIDENCE_SUPERSEDED',
      next_attempt_at=null,completed_at=now(),locked_at=null,locked_by=null,updated_at=now()
      where id=v_extraction.id;
    return jsonb_build_object('extraction_id',v_extraction.id,'retry_scheduled',false,'cancelled',true);
  end if;
  v_retry:=p_retryable and v_extraction.attempt_count<p_max_attempts;
  v_next:=case when v_retry then now()+(least(60,power(2,v_extraction.attempt_count))::text||' minutes')::interval else null end;
  update public.document_intake_extractions set status='failed',error_code=p_error_code,next_attempt_at=v_next,
    completed_at=case when v_retry then null else now() end,locked_at=null,locked_by=null,updated_at=now()
    where id=v_extraction.id returning * into v_extraction;
  update public.evidence_files set processing_status=case when v_retry then 'queued' else 'failed' end where id=v_evidence.id;
  if not v_retry then
    v_old_status:=v_intake.status;
    update public.document_intakes set status='failed',version=version+1,updated_at=now(),last_error_code=p_error_code
      where id=v_intake.id returning * into v_intake;
    insert into public.document_intake_events(
      intake_id,business_id,from_status,to_status,intake_version,actor_id,actor_role,action,error_code,metadata
    ) values(v_intake.id,p_business_id,v_old_status,'failed',v_intake.version,null,null,'document_extraction.failed',p_error_code,
      jsonb_build_object('extraction_id',v_extraction.id,'evidence_id',v_evidence.id,'attempt',v_extraction.attempt_count));
  end if;
  insert into public.audit_logs(business_id,action,actor_type,entity_type,entity_id,metadata)
  values(p_business_id,case when v_retry then 'document_extraction.retry_scheduled' else 'document_extraction.failed' end,
    'system','document_intake_extraction',v_extraction.id::text,
    jsonb_build_object('intake_id',v_intake.id,'evidence_id',v_evidence.id,'error_code',p_error_code,
      'attempt',v_extraction.attempt_count,'retry_scheduled',v_retry,'next_attempt_at',v_next));
  return jsonb_build_object('extraction_id',v_extraction.id,'retry_scheduled',v_retry,'next_attempt_at',v_next);
end; $$;

create or replace function public.document_intake_requeue_extraction(
  p_business_id uuid,p_intake_id uuid,p_actor_id uuid,p_idempotency_key text,p_request_hash text,p_correlation_id uuid
) returns public.document_intake_extractions language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_intake public.document_intakes; v_evidence public.evidence_files;
  v_extraction public.document_intake_extractions; v_existing public.document_intake_idempotency_keys; v_old_status text;
begin
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id);
  if v_role is null or v_role='viewer' then raise exception 'P8_PERMISSION_DENIED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':extract:'||p_idempotency_key,0));
  select * into v_existing from public.document_intake_idempotency_keys
    where business_id=p_business_id and action_scope='extract' and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_hash<>p_request_hash then raise exception 'P8_IDEMPOTENCY_CONFLICT'; end if;
    select * into v_extraction from public.document_intake_extractions
      where id=v_existing.resource_id and business_id=p_business_id;
    return v_extraction;
  end if;
  select * into v_intake from public.document_intakes
    where id=p_intake_id and business_id=p_business_id and deleted_at is null for update;
  if not found then raise exception 'P8_INTAKE_NOT_FOUND'; end if;
  if v_intake.status in ('submitted','cancelled') then raise exception 'P8_INTAKE_LOCKED'; end if;
  select * into v_evidence from public.evidence_files
    where intake_id=p_intake_id and business_id=p_business_id and kind='original' and is_current
      and soft_deleted_at is null for update;
  if not found then raise exception 'P8_EVIDENCE_NOT_FOUND'; end if;
  if v_evidence.scan_status<>'clean' then raise exception 'P8_EVIDENCE_SCAN_PENDING'; end if;
  select * into v_extraction from public.document_intake_extractions
    where evidence_id=v_evidence.id and business_id=p_business_id order by created_at desc limit 1 for update;
  if not found then
    insert into public.document_intake_extractions(
      intake_id,evidence_id,business_id,provider,parser_version,status,idempotency_key
    ) values(p_intake_id,v_evidence.id,p_business_id,'unassigned','pending','queued','extract:'||v_evidence.id::text)
    returning * into v_extraction;
  elsif v_extraction.status='processing' then raise exception 'P11_EXTRACTION_ALREADY_PROCESSING';
  else
    update public.document_intake_extractions set status='queued',error_code=null,next_attempt_at=null,
      completed_at=null,locked_at=null,locked_by=null,updated_at=now() where id=v_extraction.id returning * into v_extraction;
  end if;
  update public.evidence_files set processing_status='queued' where id=v_evidence.id;
  v_old_status:=v_intake.status;
  if v_intake.status<>'processing' then
    update public.document_intakes set status='processing',version=version+1,updated_at=now(),last_error_code=null
      where id=v_intake.id returning * into v_intake;
  end if;
  insert into public.document_intake_idempotency_keys(
    business_id,action_scope,idempotency_key,request_hash,actor_id,resource_type,resource_id,response_status
  ) values(p_business_id,'extract',p_idempotency_key,p_request_hash,p_actor_id,'document_intake_extraction',v_extraction.id,202);
  insert into public.document_intake_events(
    intake_id,business_id,from_status,to_status,intake_version,actor_id,actor_role,action,metadata,correlation_id,idempotency_key
  ) values(p_intake_id,p_business_id,v_old_status,v_intake.status,v_intake.version,p_actor_id,v_role,
    'document_extraction.queued',jsonb_build_object('extraction_id',v_extraction.id,'evidence_id',v_evidence.id),
    p_correlation_id,p_idempotency_key);
  return v_extraction;
end; $$;

-- Extraction payloads, full text, and provider raw results remain service-role
-- only. Authenticated clients receive the explicitly reduced route response.
revoke all on public.document_intake_extractions from anon,authenticated;
grant all on public.document_intake_extractions to service_role;
revoke all on function public.document_intake_claim_extraction(text,timestamptz) from public,anon,authenticated;
revoke all on function public.document_intake_complete_extraction(uuid,uuid,text,text,text,text,text,text,text,jsonb,jsonb,numeric,jsonb,boolean) from public,anon,authenticated;
revoke all on function public.document_intake_fail_extraction(uuid,uuid,text,text,boolean,integer) from public,anon,authenticated;
revoke all on function public.document_intake_requeue_extraction(uuid,uuid,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.document_intake_claim_extraction(text,timestamptz) to service_role;
grant execute on function public.document_intake_complete_extraction(uuid,uuid,text,text,text,text,text,text,text,jsonb,jsonb,numeric,jsonb,boolean) to service_role;
grant execute on function public.document_intake_fail_extraction(uuid,uuid,text,text,boolean,integer) to service_role;
grant execute on function public.document_intake_requeue_extraction(uuid,uuid,uuid,text,text,uuid) to service_role;

commit;

-- Rollback: disable /api/cron/document-extractions first; retain every protected
-- extraction result and audit event required by policy. Drop the four Prompt 11
-- RPCs before removing added columns or restoring the previous status constraint.

-- Prompt 12 is re-applied after the ordered Prompt 9-11 mirrors above so its
-- candidate-aware worker RPC signatures remain the final standalone state.
-- Prompt 12 / Phase D: immutable structured financial and party candidates.
-- Apply after 20260903_document_extraction_intelligence.sql.
-- Candidates are unapproved observations only and never update business records.

begin;

alter table public.document_intake_extractions
  add column if not exists extraction_version integer,
  add column if not exists document_version integer;

with numbered as (
  select id,evidence_id,row_number() over(partition by evidence_id order by created_at,id)::integer as version
  from public.document_intake_extractions
)
update public.document_intake_extractions extraction set
  extraction_version=numbered.version,
  document_version=evidence.evidence_version
from numbered join public.evidence_files evidence on evidence.id=numbered.evidence_id
where extraction.id=numbered.id and (extraction.extraction_version is null or extraction.document_version is null);

alter table public.document_intake_extractions
  alter column extraction_version set not null,
  alter column document_version set not null,
  add constraint document_intake_extractions_version_positive check(extraction_version>0 and document_version>0);

alter table public.document_intake_extractions
  drop constraint if exists document_intake_extractions_evidence_id_provider_parser_version_key;
create unique index if not exists document_intake_extractions_evidence_version_uidx
  on public.document_intake_extractions(evidence_id,extraction_version);

create table if not exists public.document_extraction_candidates (
  id uuid primary key default gen_random_uuid(),
  extraction_id uuid not null references public.document_intake_extractions(id) on delete restrict,
  intake_id uuid not null references public.document_intakes(id) on delete restrict,
  evidence_id uuid not null references public.evidence_files(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  extraction_version integer not null check(extraction_version>0),
  document_version integer not null check(document_version>0),
  candidate_ordinal integer not null check(candidate_ordinal>=0),
  field_type text not null check(field_type in (
    'company_name','debtor_name','company_identifier','debtor_identifier','invoice_number',
    'issue_date','due_date','amount','tax','currency','bank_reference','transaction_date',
    'credit_note_value','contract_term','account_reference','line_item_amount','document_total'
  )),
  original_text text not null check(length(original_text) between 1 and 2000),
  normalized_value jsonb not null,
  confidence numeric(5,4) not null check(confidence between 0 and 1),
  extraction_method text not null check(extraction_method in ('pdf_text_layer','ocr')),
  provider text not null,
  provider_version text not null,
  parser_version text not null,
  source_page integer check(source_page is null or source_page>0),
  source_image_id text,
  source_bounding_box jsonb,
  source_text_span jsonb,
  source_snippet text not null check(length(source_snippet) between 1 and 4000),
  validation_flags text[] not null default '{}',
  sensitivity text not null default 'standard' check(sensitivity in ('standard','sensitive_identifier')),
  duplicate_group text,
  created_at timestamptz not null default now(),
  unique(extraction_id,candidate_ordinal),
  check(source_page is not null or source_image_id is not null or source_text_span is not null),
  check(source_bounding_box is null or jsonb_typeof(source_bounding_box)='object'),
  check(source_text_span is null or (
    jsonb_typeof(source_text_span)='object' and (source_text_span->>'start')::integer>=0
    and (source_text_span->>'end')::integer>(source_text_span->>'start')::integer
  )),
  check(validation_flags <@ array['IMPOSSIBLE_DATE','AMBIGUOUS_DATE','MALFORMED_CURRENCY',
    'DUPLICATE_INVOICE_IDENTIFIER','TOTAL_DOES_NOT_RECONCILE']::text[])
);
create index if not exists document_extraction_candidates_lookup_idx
  on public.document_extraction_candidates(business_id,intake_id,extraction_version desc,field_type);
create index if not exists document_extraction_candidates_invoice_idx
  on public.document_extraction_candidates(business_id,field_type,((normalized_value #>> '{}')))
  where field_type='invoice_number';

create or replace function public.document_extraction_candidates_immutable()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin raise exception 'P12_CANDIDATES_IMMUTABLE'; end; $$;
drop trigger if exists document_extraction_candidates_immutable on public.document_extraction_candidates;
create trigger document_extraction_candidates_immutable before update or delete on public.document_extraction_candidates
for each row execute function public.document_extraction_candidates_immutable();

create or replace function public.document_intake_claim_extraction(p_worker_id text,p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_extraction public.document_intake_extractions; v_evidence public.evidence_files; v_intake public.document_intakes;
  v_old_status text;
begin
  if nullif(trim(p_worker_id),'') is null then raise exception 'P11_INVALID_WORKER'; end if;
  select extraction.* into v_extraction from public.document_intake_extractions extraction
  join public.evidence_files evidence on evidence.id=extraction.evidence_id
  join public.document_intakes intake on intake.id=extraction.intake_id
  where extraction.status in ('queued','failed') and (extraction.next_attempt_at is null or extraction.next_attempt_at<=p_now)
    and evidence.business_id=extraction.business_id and evidence.intake_id=extraction.intake_id
    and evidence.evidence_version=extraction.document_version and evidence.kind='original' and evidence.is_current
    and evidence.soft_deleted_at is null and evidence.scan_status='clean'
    and evidence.processing_status not in ('cancelled','completed','needs_review')
    and intake.business_id=extraction.business_id and intake.deleted_at is null and intake.status not in ('submitted','cancelled')
  order by coalesce(extraction.next_attempt_at,extraction.created_at),extraction.created_at
  for update of extraction skip locked limit 1;
  if not found then return null; end if;
  select * into v_evidence from public.evidence_files where id=v_extraction.evidence_id for update;
  select * into v_intake from public.document_intakes where id=v_extraction.intake_id for update;
  update public.document_intake_extractions set status='processing',attempt_count=attempt_count+1,
    started_at=coalesce(started_at,p_now),completed_at=null,error_code=null,next_attempt_at=null,
    locked_at=p_now,locked_by=p_worker_id,updated_at=p_now where id=v_extraction.id returning * into v_extraction;
  update public.evidence_files set processing_status='processing',processing_version=processing_version+1 where id=v_evidence.id;
  if v_intake.status<>'processing' then
    v_old_status:=v_intake.status;
    update public.document_intakes set status='processing',version=version+1,updated_at=p_now,last_error_code=null
      where id=v_intake.id returning * into v_intake;
    insert into public.document_intake_events(intake_id,business_id,from_status,to_status,intake_version,actor_id,actor_role,action,metadata)
    values(v_intake.id,v_intake.business_id,v_old_status,'processing',v_intake.version,null,null,
      'document_extraction.processing_started',jsonb_build_object('extraction_id',v_extraction.id,'evidence_id',v_evidence.id,
        'extraction_version',v_extraction.extraction_version,'document_version',v_extraction.document_version,'attempt',v_extraction.attempt_count));
  end if;
  return jsonb_build_object('extraction_id',v_extraction.id,'intake_id',v_extraction.intake_id,'evidence_id',v_extraction.evidence_id,
    'business_id',v_extraction.business_id,'storage_bucket',v_evidence.storage_bucket,'object_path',v_evidence.object_path,
    'magic_mime_type',v_evidence.magic_mime_type,'file_name',v_evidence.file_name,'file_size_bytes',v_evidence.file_size_bytes,
    'page_count',v_evidence.page_count,'document_version',v_extraction.document_version,'attempt_count',v_extraction.attempt_count);
end; $$;

drop function if exists public.document_intake_complete_extraction(uuid,uuid,text,text,text,text,text,text,text,jsonb,jsonb,numeric,jsonb,boolean);
create or replace function public.document_intake_complete_extraction(
  p_business_id uuid,p_extraction_id uuid,p_worker_id text,p_provider text,p_provider_model text,
  p_provider_version text,p_parser_version text,p_extraction_method text,p_document_classification text,
  p_structured_result jsonb,p_protected_raw_result jsonb,p_candidates jsonb,p_confidence numeric,p_warnings jsonb,p_needs_review boolean
) returns public.document_intake_extractions language plpgsql security definer set search_path=public,pg_temp as $$
declare v_extraction public.document_intake_extractions; v_evidence public.evidence_files; v_intake public.document_intakes;
  v_old_status text; v_result_status text; v_candidate jsonb; v_ordinal integer:=0; v_flags text[]; v_duplicate text;
begin
  select * into v_extraction from public.document_intake_extractions where id=p_extraction_id and business_id=p_business_id for update;
  if not found then raise exception 'P11_EXTRACTION_NOT_FOUND'; end if;
  if v_extraction.status<>'processing' or v_extraction.locked_by is distinct from p_worker_id then raise exception 'P11_EXTRACTION_LEASE_MISMATCH'; end if;
  if nullif(trim(p_provider),'') is null or nullif(trim(p_provider_model),'') is null or nullif(trim(p_provider_version),'') is null
    or nullif(trim(p_parser_version),'') is null or p_extraction_method not in ('pdf_text_layer','ocr')
    or p_confidence is null or p_confidence<0 or p_confidence>1 or jsonb_typeof(p_structured_result)<>'object'
    or jsonb_typeof(p_protected_raw_result)<>'object' or jsonb_typeof(p_candidates)<>'array'
    or jsonb_array_length(p_candidates)>250 or jsonb_typeof(p_warnings)<>'array' then raise exception 'P11_INVALID_EXTRACTION_RESULT'; end if;
  select * into v_evidence from public.evidence_files where id=v_extraction.evidence_id and business_id=p_business_id
    and intake_id=v_extraction.intake_id and evidence_version=v_extraction.document_version for update;
  select * into v_intake from public.document_intakes where id=v_extraction.intake_id and business_id=p_business_id
    and status not in ('submitted','cancelled') for update;
  if v_evidence.id is null or v_intake.id is null then raise exception 'P11_EXTRACTION_SCOPE_MISMATCH'; end if;
  if exists(select 1 from public.document_extraction_candidates where extraction_id=v_extraction.id) then raise exception 'P12_CANDIDATES_ALREADY_WRITTEN'; end if;
  for v_candidate in select value from jsonb_array_elements(p_candidates) loop
    if not (v_candidate ?& array['field_type','original_text','normalized_value','confidence','evidence','validation_flags','sensitivity'])
      or length(v_candidate->>'original_text') not between 1 and 2000 or (v_candidate->>'confidence')::numeric not between 0 and 1
      or jsonb_typeof(v_candidate->'evidence')<>'object' or jsonb_typeof(v_candidate->'validation_flags')<>'array'
      or nullif(trim(v_candidate->'evidence'->>'snippet'),'') is null then raise exception 'P12_INVALID_CANDIDATE'; end if;
    select coalesce(array_agg(value), '{}') into v_flags from jsonb_array_elements_text(v_candidate->'validation_flags');
    v_duplicate:=nullif(v_candidate->>'duplicate_group','');
    if v_candidate->>'field_type'='invoice_number' and exists(
      select 1 from public.document_extraction_candidates prior where prior.business_id=p_business_id
        and prior.field_type='invoice_number' and prior.normalized_value=v_candidate->'normalized_value'
        and prior.evidence_id<>v_extraction.evidence_id
    ) then
      v_flags:=array_append(v_flags,'DUPLICATE_INVOICE_IDENTIFIER');
      v_duplicate:=coalesce(v_duplicate,upper(v_candidate->>'normalized_value'));
    end if;
    insert into public.document_extraction_candidates(
      extraction_id,intake_id,evidence_id,business_id,extraction_version,document_version,candidate_ordinal,field_type,
      original_text,normalized_value,confidence,extraction_method,provider,provider_version,parser_version,
      source_page,source_image_id,source_bounding_box,source_text_span,source_snippet,validation_flags,sensitivity,duplicate_group
    ) values(v_extraction.id,v_extraction.intake_id,v_extraction.evidence_id,p_business_id,v_extraction.extraction_version,
      v_extraction.document_version,v_ordinal,v_candidate->>'field_type',v_candidate->>'original_text',v_candidate->'normalized_value',
      (v_candidate->>'confidence')::numeric,p_extraction_method,p_provider,p_provider_version,p_parser_version,
      nullif(v_candidate->'evidence'->>'page','null')::integer,nullif(v_candidate->'evidence'->>'imageId',''),
      v_candidate->'evidence'->'boundingBox',v_candidate->'evidence'->'textSpan',v_candidate->'evidence'->>'snippet',
      array(select distinct value from unnest(v_flags) value),v_candidate->>'sensitivity',v_duplicate);
    v_ordinal:=v_ordinal+1;
  end loop;
  v_result_status:=case when p_needs_review then 'needs_review' else 'completed' end;
  update public.document_intake_extractions set provider=p_provider,provider_model=p_provider_model,provider_version=p_provider_version,
    parser_version=p_parser_version,extraction_method=p_extraction_method,document_classification=p_document_classification,
    structured_result=p_structured_result,protected_raw_result=p_protected_raw_result,protected_raw_text=null,confidence=p_confidence,
    warnings=p_warnings,status=v_result_status,completed_at=now(),error_code=null,next_attempt_at=null,locked_at=null,locked_by=null,updated_at=now()
    where id=v_extraction.id returning * into v_extraction;
  update public.evidence_files set processing_status=v_result_status where id=v_evidence.id;
  v_old_status:=v_intake.status;
  update public.document_intakes set status='needs_review',version=version+1,updated_at=now(),last_error_code=null
    where id=v_intake.id returning * into v_intake;
  insert into public.document_intake_events(intake_id,business_id,from_status,to_status,intake_version,actor_id,actor_role,action,metadata)
  values(v_intake.id,p_business_id,v_old_status,'needs_review',v_intake.version,null,null,'document_extraction.completed',
    jsonb_build_object('extraction_id',v_extraction.id,'evidence_id',v_evidence.id,'extraction_version',v_extraction.extraction_version,
      'document_version',v_extraction.document_version,'candidate_count',v_ordinal,'result_status',v_result_status));
  insert into public.audit_logs(business_id,action,actor_type,entity_type,entity_id,metadata)
  values(p_business_id,'document_extraction.completed','system','document_intake_extraction',v_extraction.id::text,
    jsonb_build_object('intake_id',v_intake.id,'evidence_id',v_evidence.id,'extraction_version',v_extraction.extraction_version,
      'document_version',v_extraction.document_version,'candidate_count',v_ordinal,'provider',p_provider,'provider_version',p_provider_version,'parser_version',p_parser_version));
  return v_extraction;
end; $$;

create or replace function public.document_intake_requeue_extraction(
  p_business_id uuid,p_intake_id uuid,p_actor_id uuid,p_idempotency_key text,p_request_hash text,p_correlation_id uuid
) returns public.document_intake_extractions language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_intake public.document_intakes; v_evidence public.evidence_files;
  v_extraction public.document_intake_extractions; v_existing public.document_intake_idempotency_keys; v_old_status text; v_version integer;
begin
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id);
  if v_role is null or v_role='viewer' then raise exception 'P8_PERMISSION_DENIED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':extract:'||p_idempotency_key,0));
  select * into v_existing from public.document_intake_idempotency_keys where business_id=p_business_id and action_scope='extract' and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_hash<>p_request_hash then raise exception 'P8_IDEMPOTENCY_CONFLICT'; end if;
    select * into v_extraction from public.document_intake_extractions where id=v_existing.resource_id and business_id=p_business_id;
    return v_extraction;
  end if;
  select * into v_intake from public.document_intakes where id=p_intake_id and business_id=p_business_id and deleted_at is null for update;
  if not found then raise exception 'P8_INTAKE_NOT_FOUND'; end if;
  if v_intake.status in ('submitted','cancelled') then raise exception 'P8_INTAKE_LOCKED'; end if;
  select * into v_evidence from public.evidence_files where intake_id=p_intake_id and business_id=p_business_id and kind='original'
    and is_current and soft_deleted_at is null for update;
  if not found then raise exception 'P8_EVIDENCE_NOT_FOUND'; end if;
  if v_evidence.scan_status<>'clean' then raise exception 'P8_EVIDENCE_SCAN_PENDING'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':extract-rate',0));
  if (select count(*) from public.document_intake_extractions where business_id=p_business_id and created_at>now()-interval '1 hour')>=10 then
    raise exception 'P12_EXTRACTION_RATE_LIMITED';
  end if;
  if exists(select 1 from public.document_intake_extractions where evidence_id=v_evidence.id and status in ('queued','processing')) then
    raise exception 'P11_EXTRACTION_ALREADY_PROCESSING';
  end if;
  select coalesce(max(extraction_version),0)+1 into v_version from public.document_intake_extractions where evidence_id=v_evidence.id;
  insert into public.document_intake_extractions(intake_id,evidence_id,business_id,provider,parser_version,status,idempotency_key,extraction_version,document_version)
  values(p_intake_id,v_evidence.id,p_business_id,'unassigned','pending','queued',
    'extract:'||v_evidence.id::text||':v:'||v_version::text,v_version,v_evidence.evidence_version) returning * into v_extraction;
  update public.evidence_files set processing_status='queued' where id=v_evidence.id;
  v_old_status:=v_intake.status;
  if v_intake.status<>'processing' then update public.document_intakes set status='processing',version=version+1,updated_at=now(),last_error_code=null
    where id=v_intake.id returning * into v_intake; end if;
  insert into public.document_intake_idempotency_keys(business_id,action_scope,idempotency_key,request_hash,actor_id,resource_type,resource_id,response_status)
  values(p_business_id,'extract',p_idempotency_key,p_request_hash,p_actor_id,'document_intake_extraction',v_extraction.id,202);
  insert into public.document_intake_events(intake_id,business_id,from_status,to_status,intake_version,actor_id,actor_role,action,metadata,correlation_id,idempotency_key)
  values(p_intake_id,p_business_id,v_old_status,v_intake.status,v_intake.version,p_actor_id,v_role,'document_extraction.queued',
    jsonb_build_object('extraction_id',v_extraction.id,'evidence_id',v_evidence.id,'extraction_version',v_version,'document_version',v_evidence.evidence_version),
    p_correlation_id,p_idempotency_key);
  return v_extraction;
end; $$;

alter table public.document_extraction_candidates enable row level security;
revoke all on public.document_extraction_candidates from public,anon,authenticated;
grant all on public.document_extraction_candidates to service_role;
revoke all on function public.document_intake_complete_extraction(uuid,uuid,text,text,text,text,text,text,text,jsonb,jsonb,jsonb,numeric,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.document_intake_complete_extraction(uuid,uuid,text,text,text,text,text,text,text,jsonb,jsonb,jsonb,numeric,jsonb,boolean) to service_role;
revoke all on function public.document_extraction_candidates_immutable() from public,anon,authenticated;

commit;

-- Rollback: disable extraction workers first. Restore the Prompt 11 claim,
-- completion and requeue functions. Keep this table and both version columns
-- read-only for audit/history. Dropping candidate history is intentionally not
-- part of routine rollback and requires separately approved retention review.
\n+-- Prompt 13 / Phase D: human review, evidence citations and transaction confirmation.
-- Reviewable proposal only. Apply after 20260904_structured_financial_party_candidates.sql.
-- This migration records proposals and human decisions but never creates or
-- updates cases, debtors, obligations, payments, balances, or accounting rows.

begin;

alter table public.document_intake_confirmations
  alter column confirmed_document_kind drop not null,
  drop constraint if exists document_intake_confirmations_confirmed_document_kind_check,
  add constraint document_intake_confirmations_confirmed_document_kind_check check (
    confirmed_document_kind is null or confirmed_document_kind in (
      'online_bank_transfer_receipt','transaction_screenshot','bank_in_cash_deposit_receipt',
      'payment_receipt','unknown_or_other','invoice','receipt','payment_proof','bank_statement',
      'contract','purchase_order','delivery_order','credit_note','communication_record',
      'communication_evidence','other'
    )
  ),
  add column if not exists review_status text not null default 'draft',
  add column if not exists extraction_id uuid references public.document_intake_extractions(id) on delete restrict,
  add column if not exists represents_financial_movement boolean,
  add column if not exists document_kind_confidence numeric(5,4),
  add column if not exists chosen_amount_candidate_id text,
  add column if not exists chosen_amount_original text,
  add column if not exists manual_amount_reason text,
  add column if not exists currency_confirmed boolean not null default false,
  add column if not exists date_interpretation_confirmed boolean not null default false,
  add column if not exists confirmed_timezone text,
  add column if not exists reference_original text,
  add column if not exists transaction_status text,
  add column if not exists transaction_nature_note text,
  add column if not exists field_decisions jsonb not null default '{}'::jsonb,
  add column if not exists evidence_citations jsonb not null default '[]'::jsonb,
  add column if not exists validation_issues jsonb not null default '[]'::jsonb,
  drop constraint if exists document_intake_confirmations_review_status_check,
  add constraint document_intake_confirmations_review_status_check check (review_status in ('draft','confirmed')),
  drop constraint if exists document_intake_confirmations_document_kind_confidence_check,
  add constraint document_intake_confirmations_document_kind_confidence_check
    check (document_kind_confidence is null or document_kind_confidence between 0 and 1),
  drop constraint if exists document_intake_confirmations_transaction_status_check,
  add constraint document_intake_confirmations_transaction_status_check
    check (transaction_status is null or transaction_status in ('successful','pending','failed','unknown')),
  drop constraint if exists document_intake_confirmations_transaction_nature_check,
  add constraint document_intake_confirmations_transaction_nature_check check (
    transaction_nature is null or transaction_nature in (
      'loan_disbursement','repayment','partial_repayment','refund','deposit','fee_adjustment','other'
    )
  ),
  drop constraint if exists document_intake_confirmations_review_json_check,
  add constraint document_intake_confirmations_review_json_check check (
    jsonb_typeof(field_decisions)='object' and jsonb_typeof(evidence_citations)='array'
    and jsonb_typeof(validation_issues)='array'
  );

-- Existing Prompt 8 confirmations did not enforce the Prompt 13 mandatory
-- fields. Keep them immutable but classify them as drafts so they cannot be
-- used to finalise an intake without a new human confirmation.
update public.document_intake_confirmations set review_status='draft';

create index if not exists document_intake_confirmations_extraction_idx
  on public.document_intake_confirmations(business_id,extraction_id,confirmation_version desc);

create or replace function public.document_intake_transition_allowed(p_from text,p_to text)
returns boolean language sql immutable as $$
  select p_from=p_to or (p_from,p_to) in (
    ('draft','awaiting_upload'),('draft','cancelled'),
    ('awaiting_upload','uploaded'),('awaiting_upload','failed'),('awaiting_upload','cancelled'),
    ('uploaded','awaiting_upload'),('uploaded','processing'),('uploaded','needs_review'),
    ('uploaded','ready_to_submit'),('uploaded','failed'),('uploaded','cancelled'),
    ('processing','awaiting_upload'),('processing','needs_review'),('processing','ready_to_submit'),('processing','failed'),('processing','cancelled'),
    ('needs_review','awaiting_upload'),('needs_review','processing'),('needs_review','ready_to_submit'),('needs_review','cancelled'),
    ('ready_to_submit','awaiting_upload'),('ready_to_submit','needs_review'),
    ('ready_to_submit','submitted'),('ready_to_submit','cancelled'),
    ('failed','awaiting_upload'),('failed','processing'),('failed','needs_review'),('failed','ready_to_submit'),('failed','cancelled')
  );
$$;

create or replace function public.document_intake_save_review(
  p_business_id uuid,p_intake_id uuid,p_actor_id uuid,p_action text,p_review jsonb,
  p_idempotency_key text,p_request_hash text,p_correlation_id uuid
) returns public.document_intake_confirmations language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_role text; v_intake public.document_intakes; v_evidence public.evidence_files;
  v_extraction public.document_intake_extractions; v_existing public.document_intake_confirmations;
  v_confirmation public.document_intake_confirmations; v_version integer; v_old_status text;
  v_target_status text; v_default_currency text; v_candidate jsonb; v_candidate_index integer;
  v_amount bigint; v_currency text; v_extraction_id uuid;
begin
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id);
  if v_role is null or v_role='viewer' then raise exception 'P8_PERMISSION_DENIED'; end if;
  if p_action not in ('save_draft','confirm') or p_review is null or jsonb_typeof(p_review)<>'object'
    then raise exception 'P13_INVALID_REVIEW'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':review:'||p_idempotency_key,0));
  select * into v_existing from public.document_intake_confirmations
    where business_id=p_business_id and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_hash<>p_request_hash then raise exception 'P8_IDEMPOTENCY_CONFLICT'; end if;
    return v_existing;
  end if;

  select * into v_intake from public.document_intakes
    where id=p_intake_id and business_id=p_business_id and deleted_at is null for update;
  if not found then raise exception 'P8_INTAKE_NOT_FOUND'; end if;
  if v_intake.status not in ('uploaded','needs_review','ready_to_submit','failed')
    then raise exception 'P8_CONFIRMATION_NOT_ALLOWED'; end if;
  select * into v_evidence from public.evidence_files
    where intake_id=p_intake_id and business_id=p_business_id and kind='original' and is_current
      and soft_deleted_at is null for update;
  if not found then raise exception 'P8_EVIDENCE_REQUIRED'; end if;

  begin v_extraction_id:=(p_review->>'extraction_id')::uuid;
  exception when invalid_text_representation then raise exception 'P13_EXTRACTION_REQUIRED'; end;
  select * into v_extraction from public.document_intake_extractions
    where id=v_extraction_id and intake_id=p_intake_id and evidence_id=v_evidence.id
      and business_id=p_business_id and status in ('completed','needs_review','failed');
  if not found then raise exception 'P13_EXTRACTION_REQUIRED'; end if;
  if jsonb_typeof(coalesce(p_review->'field_decisions','{}'::jsonb))<>'object'
    or jsonb_typeof(coalesce(p_review->'evidence_citations','[]'::jsonb))<>'array'
    or jsonb_typeof(coalesce(p_review->'validation_issues','[]'::jsonb))<>'array'
    then raise exception 'P13_INVALID_REVIEW'; end if;

  v_amount:=nullif(p_review->>'amount_minor','')::bigint;
  v_currency:=nullif(upper(p_review->>'currency'),'');
  select upper(default_currency) into v_default_currency from public.businesses where id=p_business_id;

  if p_action='confirm' then
    if p_review->>'review_status'<>'confirmed' or jsonb_array_length(p_review->'validation_issues')<>0
      then raise exception 'P13_REVIEW_INCOMPLETE'; end if;
    if nullif(p_review->>'document_kind','') is null or (p_review->>'represents_financial_movement')::boolean is null
      then raise exception 'P13_REVIEW_INCOMPLETE'; end if;
    if (p_review->>'represents_financial_movement')::boolean then
      if v_amount is null or v_amount<=0 or v_currency is null or v_currency<>v_default_currency
        or coalesce((p_review->>'currency_confirmed')::boolean,false) is not true
        or nullif(p_review->>'transaction_datetime','') is null or nullif(p_review->>'timezone','') is null
        or coalesce((p_review->>'date_interpretation_confirmed')::boolean,false) is not true
        or nullif(p_review->>'transaction_nature','') is null
        then raise exception 'P13_REVIEW_INCOMPLETE'; end if;
      if p_review->>'transaction_nature'='other' and nullif(trim(p_review->>'transaction_nature_note'),'') is null
        then raise exception 'P13_REVIEW_INCOMPLETE'; end if;
    end if;
    if nullif(p_review->>'chosen_amount_candidate_id','') is not null then
      if p_review->>'chosen_amount_candidate_id' !~ '^amount:[0-9]+$' then raise exception 'P13_INVALID_CANDIDATE'; end if;
      v_candidate_index:=substring(p_review->>'chosen_amount_candidate_id' from '[0-9]+$')::integer;
      v_candidate:=v_extraction.structured_result->'amount_candidates'->v_candidate_index;
      if v_candidate is null or (v_candidate->>'minor_units')::bigint is distinct from v_amount
        or upper(v_candidate->>'currency') is distinct from v_currency
        or v_candidate->>'recognized_string' is distinct from p_review->>'chosen_amount_original'
        then raise exception 'P13_INVALID_CANDIDATE'; end if;
    elsif (p_review->>'represents_financial_movement')::boolean
      and nullif(trim(p_review->>'manual_amount_reason'),'') is null
      then raise exception 'P13_MANUAL_REASON_REQUIRED';
    end if;
    if v_evidence.scan_status<>'clean' then raise exception 'P8_EVIDENCE_SCAN_PENDING'; end if;
  elsif p_review->>'review_status'<>'draft' then
    raise exception 'P13_INVALID_REVIEW';
  end if;

  v_target_status:=case when p_action='confirm' then 'ready_to_submit' else 'needs_review' end;
  if not public.document_intake_transition_allowed(v_intake.status,v_target_status)
    then raise exception 'P8_INVALID_STATUS_TRANSITION'; end if;
  v_old_status:=v_intake.status;
  update public.document_intakes set status=v_target_status,version=version+1,updated_at=now(),last_error_code=null
    where id=p_intake_id returning * into v_intake;
  select coalesce(max(confirmation_version),0)+1 into v_version
    from public.document_intake_confirmations where intake_id=p_intake_id;

  insert into public.document_intake_confirmations(
    intake_id,business_id,confirmation_version,intake_version,review_status,extraction_id,
    confirmed_document_kind,document_kind_confidence,represents_financial_movement,
    chosen_amount_minor,currency,document_datetime,confirmed_timezone,reference,bank,sender,recipient,
    transaction_status,transaction_nature,transaction_nature_note,notes,chosen_amount_candidate_id,
    chosen_amount_original,manual_amount_reason,reference_original,currency_confirmed,date_interpretation_confirmed,
    field_decisions,evidence_citations,validation_issues,confirmed_by,idempotency_key,request_hash
  ) values(
    p_intake_id,p_business_id,v_version,v_intake.version,p_review->>'review_status',v_extraction.id,
    nullif(p_review->>'document_kind',''),nullif(p_review->>'document_kind_confidence','')::numeric,
    nullif(p_review->>'represents_financial_movement','')::boolean,v_amount,v_currency,
    nullif(p_review->>'transaction_datetime','')::timestamptz,nullif(p_review->>'timezone',''),
    nullif(trim(p_review->>'reference'),''),nullif(trim(p_review->>'bank'),''),
    nullif(trim(p_review->>'sender'),''),nullif(trim(p_review->>'recipient'),''),
    nullif(p_review->>'transaction_status',''),nullif(p_review->>'transaction_nature',''),
    nullif(trim(p_review->>'transaction_nature_note'),''),nullif(trim(p_review->>'notes'),''),
    nullif(p_review->>'chosen_amount_candidate_id',''),nullif(p_review->>'chosen_amount_original',''),
    nullif(trim(p_review->>'manual_amount_reason'),''),nullif(p_review->>'reference_original',''),
    coalesce((p_review->>'currency_confirmed')::boolean,false),
    coalesce((p_review->>'date_interpretation_confirmed')::boolean,false),
    coalesce(p_review->'field_decisions','{}'::jsonb),coalesce(p_review->'evidence_citations','[]'::jsonb),
    coalesce(p_review->'validation_issues','[]'::jsonb),p_actor_id,p_idempotency_key,p_request_hash
  ) returning * into v_confirmation;

  insert into public.document_intake_idempotency_keys(
    business_id,action_scope,idempotency_key,request_hash,actor_id,resource_type,resource_id,response_status
  ) values(p_business_id,'confirm',p_idempotency_key,p_request_hash,p_actor_id,'document_intake_confirmation',v_confirmation.id,200);
  insert into public.document_intake_events(
    intake_id,business_id,from_status,to_status,intake_version,actor_id,actor_role,action,metadata,correlation_id,idempotency_key
  ) values(
    p_intake_id,p_business_id,v_old_status,v_target_status,v_intake.version,p_actor_id,v_role,
    case when p_action='confirm' then 'document_review.confirmed' else 'document_review.draft_saved' end,
    jsonb_build_object('confirmation_id',v_confirmation.id,'confirmation_version',v_version,'extraction_id',v_extraction.id,
      'field_decisions',p_review->'field_decisions','evidence_citations',p_review->'evidence_citations',
      'validation_issues',p_review->'validation_issues'),p_correlation_id,p_idempotency_key
  );
  insert into public.audit_logs(
    business_id,action,actor_type,actor_id,actor_role,entity_type,entity_id,correlation_id,idempotency_key,metadata
  ) values(
    p_business_id,case when p_action='confirm' then 'document_review.confirmed' else 'document_review.draft_saved' end,
    'staff',p_actor_id,v_role,'document_intake',p_intake_id::text,p_correlation_id,p_idempotency_key,
    jsonb_build_object('confirmation_id',v_confirmation.id,'confirmation_version',v_version,'extraction_id',v_extraction.id,
      'original_candidates_and_corrections',p_review->'field_decisions','evidence_citations',p_review->'evidence_citations',
      'reviewed_at',v_confirmation.confirmed_at,'reviewed_by',p_actor_id)
  );
  return v_confirmation;
end; $$;

create or replace function public.document_intake_finalise(
  p_business_id uuid,p_intake_id uuid,p_actor_id uuid,p_idempotency_key text,p_request_hash text,p_correlation_id uuid
) returns public.document_intakes language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_intake public.document_intakes; v_existing public.document_intake_idempotency_keys;
  v_confirmation public.document_intake_confirmations; v_new public.document_intakes;
begin
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id);
  if v_role is null or v_role not in ('owner','admin','manager') then raise exception 'P8_SUBMIT_PERMISSION_DENIED'; end if;
  if v_role='manager' and not coalesce((select manager_can_submit_document_intakes from public.business_role_settings where business_id=p_business_id),false)
    then raise exception 'P8_SUBMIT_PERMISSION_DENIED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':finalise:'||p_idempotency_key,0));
  select * into v_existing from public.document_intake_idempotency_keys
    where business_id=p_business_id and action_scope='finalise' and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_hash<>p_request_hash then raise exception 'P8_IDEMPOTENCY_CONFLICT'; end if;
    select * into v_new from public.document_intakes where id=v_existing.resource_id and business_id=p_business_id;
    return v_new;
  end if;
  select * into v_intake from public.document_intakes where id=p_intake_id and business_id=p_business_id and deleted_at is null for update;
  if not found then raise exception 'P8_INTAKE_NOT_FOUND'; end if;
  if v_intake.status<>'ready_to_submit' then raise exception 'P8_INVALID_STATUS_TRANSITION'; end if;
  select * into v_confirmation from public.document_intake_confirmations
    where intake_id=p_intake_id order by confirmation_version desc limit 1;
  if not found or v_confirmation.intake_version<>v_intake.version or v_confirmation.review_status<>'confirmed'
    then raise exception 'P8_CONFIRMATION_REQUIRED'; end if;
  if not exists(
    select 1 from public.evidence_files evidence
    join public.document_intake_extractions extraction on extraction.id=v_confirmation.extraction_id
    where evidence.intake_id=p_intake_id and evidence.business_id=p_business_id and evidence.is_original
      and evidence.is_current and evidence.soft_deleted_at is null and evidence.scan_status='clean'
      and extraction.intake_id=p_intake_id and extraction.evidence_id=evidence.id and extraction.business_id=p_business_id
  ) then raise exception 'P8_CONFIRMATION_REQUIRED'; end if;
  update public.document_intakes set status='submitted',version=version+1,submitted_at=now(),updated_at=now()
    where id=p_intake_id returning * into v_new;
  insert into public.document_intake_idempotency_keys(business_id,action_scope,idempotency_key,request_hash,actor_id,resource_type,resource_id,response_status)
  values(p_business_id,'finalise',p_idempotency_key,p_request_hash,p_actor_id,'document_intake',p_intake_id,200);
  insert into public.document_intake_events(intake_id,business_id,from_status,to_status,intake_version,actor_id,actor_role,action,correlation_id,idempotency_key)
  values(p_intake_id,p_business_id,v_intake.status,'submitted',v_new.version,p_actor_id,v_role,'document_intake.submitted',p_correlation_id,p_idempotency_key);
  insert into public.audit_logs(business_id,action,actor_type,actor_id,actor_role,entity_type,entity_id,correlation_id,idempotency_key,metadata)
  values(p_business_id,'document_intake.submitted','staff',p_actor_id,v_role,'document_intake',p_intake_id::text,p_correlation_id,p_idempotency_key,
    jsonb_build_object('intake_version',v_new.version,'confirmation_version',v_confirmation.confirmation_version,
      'confirmation_id',v_confirmation.id,'extraction_id',v_confirmation.extraction_id));
  return v_new;
end; $$;

revoke all on function public.document_intake_save_review(uuid,uuid,uuid,text,jsonb,text,text,uuid) from public,anon,authenticated;
grant execute on function public.document_intake_save_review(uuid,uuid,uuid,text,jsonb,text,text,uuid) to service_role;

commit;

-- Rollback requires first disabling the Prompt 13 review route. Preserve the
-- append-only review and audit rows for the configured retention period. Restore
-- the previous finalise RPC only after all ready_to_submit drafts are reviewed.

-- Canonical Prompt 14 additions (kept identical to the forward migration).
-- Prompt 14: profile matching, duplicate review, and atomic draft-to-domain routing.
-- Forward-only proposal. Review in staging before applying.
begin;

-- This migration sorts before Prompt 13 in existing deployments. Add only the
-- prerequisite column here; Prompt 13 remains authoritative for its constraints
-- and review workflow. Existing rows default to draft and cannot be submitted.
alter table public.document_intake_confirmations
  add column if not exists review_status text not null default 'draft';

alter table public.document_intake_idempotency_keys
  drop constraint if exists document_intake_idempotency_keys_action_scope_check,
  add constraint document_intake_idempotency_keys_action_scope_check check (action_scope in (
    'create','upload','replace','remove','confirm','extract','finalise','cancel','save_workflow','submit_workflow'
  ));

create table if not exists public.document_intake_workflow_drafts (
  intake_id uuid primary key references public.document_intakes(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  version integer not null default 1 check (version>0),
  step text not null check (step in ('ai_result','transaction_nature','profile_match','required_details','duplicate_review','review_create','success')),
  draft_data jsonb not null default '{}'::jsonb check (jsonb_typeof(draft_data)='object'),
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (intake_id,business_id)
);

create table if not exists public.document_intake_outcomes (
  id uuid primary key default gen_random_uuid(),
  intake_id uuid not null unique references public.document_intakes(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  route text not null check (route in ('loan_disbursement','repayment','partial_repayment','refund','deposit_or_other','collection_case')),
  customer_id uuid references public.debtors(id) on delete restrict,
  account_id uuid references public.customer_accounts(id) on delete restrict,
  obligation_id uuid references public.obligations(id) on delete restrict,
  payment_id uuid references public.payments(id) on delete restrict,
  original_payment_id uuid references public.payments(id) on delete restrict,
  case_id text references public.cases(id) on delete restrict,
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result)='object'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (id,business_id)
);

create table if not exists public.document_intake_record_evidence_links (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete restrict,
  intake_id uuid not null references public.document_intakes(id) on delete restrict,
  evidence_id uuid not null references public.evidence_files(id) on delete restrict,
  entity_type text not null check (entity_type in ('customer','account','obligation','payment','case')),
  entity_id text not null, created_at timestamptz not null default now(),
  unique (evidence_id,entity_type,entity_id)
);

create index if not exists document_intake_outcomes_business_idx on public.document_intake_outcomes(business_id,created_at desc);
create index if not exists document_intake_record_links_intake_idx on public.document_intake_record_evidence_links(intake_id,created_at);

create or replace function public.document_intake_append_only()
returns trigger language plpgsql set search_path=public,pg_temp as $$ begin raise exception 'P8_APPEND_ONLY'; end; $$;
drop trigger if exists document_intake_outcomes_append_only_guard on public.document_intake_outcomes;
create trigger document_intake_outcomes_append_only_guard before update or delete on public.document_intake_outcomes
for each row execute function public.document_intake_append_only();
drop trigger if exists document_intake_record_links_append_only_guard on public.document_intake_record_evidence_links;
create trigger document_intake_record_links_append_only_guard before update or delete on public.document_intake_record_evidence_links
for each row execute function public.document_intake_append_only();

create or replace function public.document_intake_save_workflow(
  p_business_id uuid,p_intake_id uuid,p_actor_id uuid,p_expected_version integer,p_step text,p_draft_data jsonb,
  p_idempotency_key text,p_request_hash text,p_correlation_id uuid
) returns public.document_intake_workflow_drafts language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_intake public.document_intakes; v_draft public.document_intake_workflow_drafts; v_existing public.document_intake_idempotency_keys;
begin
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id);
  if v_role is null then raise exception 'P8_MEMBERSHIP_REQUIRED'; end if;
  if v_role='viewer' then raise exception 'P8_PERMISSION_DENIED'; end if;
  if p_step not in ('ai_result','transaction_nature','profile_match','required_details','duplicate_review','review_create') or jsonb_typeof(p_draft_data)<>'object' then raise exception 'P14_INVALID_WORKFLOW_DRAFT'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':workflow:'||p_intake_id::text,0));
  select * into v_existing from public.document_intake_idempotency_keys where business_id=p_business_id and action_scope='save_workflow' and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_hash<>p_request_hash then raise exception 'P8_IDEMPOTENCY_CONFLICT'; end if;
    select * into v_draft from public.document_intake_workflow_drafts where intake_id=p_intake_id and business_id=p_business_id; return v_draft;
  end if;
  select * into v_intake from public.document_intakes where id=p_intake_id and business_id=p_business_id and deleted_at is null for update;
  if not found then raise exception 'P8_INTAKE_NOT_FOUND'; end if;
  if v_intake.status in ('submitted','cancelled') then raise exception 'P8_INTAKE_LOCKED'; end if;
  select * into v_draft from public.document_intake_workflow_drafts where intake_id=p_intake_id and business_id=p_business_id for update;
  if found then
    if v_draft.version<>p_expected_version then raise exception 'P14_WORKFLOW_VERSION_CONFLICT'; end if;
    update public.document_intake_workflow_drafts set version=version+1,step=p_step,draft_data=p_draft_data,updated_by=p_actor_id,updated_at=now()
      where intake_id=p_intake_id returning * into v_draft;
  else
    if p_expected_version<>1 then raise exception 'P14_WORKFLOW_VERSION_CONFLICT'; end if;
    insert into public.document_intake_workflow_drafts(intake_id,business_id,step,draft_data,updated_by)
      values(p_intake_id,p_business_id,p_step,p_draft_data,p_actor_id) returning * into v_draft;
  end if;
  update public.document_intakes set status=case when p_step='review_create' then 'ready_to_submit' else 'needs_review' end,version=version+1,updated_at=now() where id=p_intake_id;
  insert into public.document_intake_idempotency_keys(business_id,action_scope,idempotency_key,request_hash,actor_id,resource_type,resource_id,response_status)
    values(p_business_id,'save_workflow',p_idempotency_key,p_request_hash,p_actor_id,'document_intake_workflow_draft',p_intake_id,200);
  insert into public.document_intake_events(intake_id,business_id,from_status,to_status,intake_version,actor_id,actor_role,action,metadata,correlation_id,idempotency_key)
    values(p_intake_id,p_business_id,v_intake.status,case when p_step='review_create' then 'ready_to_submit' else 'needs_review' end,v_intake.version+1,p_actor_id,v_role,'document_intake.workflow_saved',jsonb_build_object('step',p_step,'workflow_version',v_draft.version),p_correlation_id,p_idempotency_key);
  return v_draft;
end; $$;

create or replace function public.document_intake_submit_workflow(
  p_business_id uuid,p_intake_id uuid,p_actor_id uuid,p_idempotency_key text,p_request_hash text,p_correlation_id uuid
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_role text; v_intake public.document_intakes; v_draft public.document_intake_workflow_drafts; v_data jsonb; v_existing public.document_intake_idempotency_keys;
  v_outcome public.document_intake_outcomes; v_confirmation public.document_intake_confirmations; v_evidence public.evidence_files;
  v_route text; v_customer public.debtors; v_account public.customer_accounts; v_obligation public.obligations; v_payment public.payments; v_original public.payments; v_case public.cases;
  v_customer_id uuid; v_account_id uuid; v_obligation_id uuid; v_payment_id uuid; v_case_id text; v_amount bigint; v_currency char(3); v_due date; v_reference text; v_profile jsonb; v_candidate_count integer;
begin
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id);
  if v_role is null then raise exception 'P8_MEMBERSHIP_REQUIRED'; end if;
  if v_role not in ('owner','admin') and not (v_role='manager' and coalesce((select manager_can_submit_document_intakes from public.business_role_settings where business_id=p_business_id),false)) then raise exception 'P8_SUBMIT_PERMISSION_DENIED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':submit-workflow:'||p_intake_id::text,0));
  select * into v_existing from public.document_intake_idempotency_keys where business_id=p_business_id and action_scope='submit_workflow' and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_hash<>p_request_hash then raise exception 'P8_IDEMPOTENCY_CONFLICT'; end if;
    select * into v_outcome from public.document_intake_outcomes where id=v_existing.resource_id and business_id=p_business_id;
    return jsonb_build_object('outcome',to_jsonb(v_outcome),'idempotent_replay',true);
  end if;
  select * into v_intake from public.document_intakes where id=p_intake_id and business_id=p_business_id and deleted_at is null for update;
  if not found then raise exception 'P8_INTAKE_NOT_FOUND'; end if;
  if v_intake.status='submitted' then select * into v_outcome from public.document_intake_outcomes where intake_id=p_intake_id; return jsonb_build_object('outcome',to_jsonb(v_outcome),'idempotent_replay',true); end if;
  if v_intake.status<>'ready_to_submit' then raise exception 'P14_WORKFLOW_NOT_READY'; end if;
  select * into v_draft from public.document_intake_workflow_drafts where intake_id=p_intake_id and business_id=p_business_id for update;
  select * into v_confirmation from public.document_intake_confirmations where intake_id=p_intake_id and business_id=p_business_id order by confirmation_version desc limit 1;
  select * into v_evidence from public.evidence_files where intake_id=p_intake_id and business_id=p_business_id and is_original and is_current and soft_deleted_at is null order by evidence_version desc limit 1;
  if v_draft is null or v_confirmation is null or v_confirmation.review_status<>'confirmed' then raise exception 'P8_CONFIRMATION_REQUIRED'; end if;
  if v_evidence is null then raise exception 'P8_EVIDENCE_REQUIRED'; end if;
  if v_evidence.scan_status<>'clean' or v_evidence.processing_status not in ('completed','needs_review') then raise exception 'P8_EVIDENCE_SCAN_PENDING'; end if;
  v_data:=v_draft.draft_data; v_route:=v_data->>'transactionNature'; v_amount:=(v_data->>'amountMinor')::bigint; v_currency:=upper(v_data->>'currency'); v_due:=nullif(v_data->>'dueDate','')::date; v_reference:=nullif(btrim(v_data->>'reference'),'');
  if v_route not in ('loan_disbursement','repayment','partial_repayment','refund','deposit_or_other','collection_case') or v_amount is null or v_amount<=0 or v_currency is null or v_currency !~ '^[A-Z]{3}$' then raise exception 'P14_INVALID_WORKFLOW_DRAFT'; end if;
  if v_confirmation.chosen_amount_minor is distinct from v_amount or v_confirmation.currency is distinct from v_currency then raise exception 'P14_CONFIRMATION_MISMATCH'; end if;
  if v_data->'profileDecision' is null then raise exception 'P14_PROFILE_DECISION_REQUIRED'; end if;
  if v_data#>>'{profileDecision,kind}'='existing' then
    v_customer_id:=(v_data#>>'{profileDecision,customerId}')::uuid;
    select * into v_customer from public.debtors where id=v_customer_id and business_id=p_business_id and archived_at is null;
    if not found then raise exception 'P14_CUSTOMER_SCOPE_MISMATCH'; end if;
  elsif v_data#>>'{profileDecision,kind}'='new' then
    v_profile:=v_data#>'{profileDecision,profile}';
    if nullif(btrim(v_profile->>'name'),'') is null or v_profile->>'debtorType' not in ('individual','business') then raise exception 'P14_NEW_PROFILE_INVALID'; end if;
    insert into public.debtors(business_id,debtor_type,individual_name,business_name,contact_name,registration_no,phone,email,address)
      values(p_business_id,v_profile->>'debtorType',case when v_profile->>'debtorType'='individual' then left(v_profile->>'name',160) end,case when v_profile->>'debtorType'='business' then left(v_profile->>'name',160) end,left(nullif(v_profile->>'contactName',''),160),left(nullif(v_profile->>'registrationNo',''),100),left(nullif(v_profile->>'phone',''),50),left(nullif(lower(v_profile->>'email'),''),254),left(nullif(v_profile->>'address',''),500)) returning * into v_customer;
    v_customer_id:=v_customer.id;
  else raise exception 'P14_PROFILE_DECISION_REQUIRED'; end if;
  v_account_id:=nullif(v_data->>'accountId','')::uuid;
  if v_account_id is not null then
    select * into v_account from public.customer_accounts where id=v_account_id and business_id=p_business_id and customer_id=v_customer_id and currency=v_currency and archived_at is null;
    if not found then raise exception 'P14_ACCOUNT_SCOPE_MISMATCH'; end if;
  elsif v_route in ('loan_disbursement','collection_case') then
    select * into v_account from public.customer_accounts where business_id=p_business_id and customer_id=v_customer_id and currency=v_currency and account_number is null and archived_at is null order by created_at limit 1;
    if not found then insert into public.customer_accounts(business_id,customer_id,account_type,display_name,currency,metadata)
      values(p_business_id,v_customer_id,'general',coalesce(v_customer.business_name,v_customer.individual_name,'Transaction account'),v_currency,jsonb_build_object('source_intake_id',p_intake_id)) returning * into v_account; end if;
    v_account_id:=v_account.id;
  end if;
  v_obligation_id:=nullif(v_data->>'obligationId','')::uuid;
  if v_obligation_id is not null then
    select * into v_obligation from public.obligations where id=v_obligation_id and business_id=p_business_id and customer_id=v_customer_id and currency=v_currency and archived_at is null for update;
    if not found then raise exception 'P14_OBLIGATION_SCOPE_MISMATCH'; end if;
  elsif v_route in ('loan_disbursement','collection_case') then
    if v_due is null or v_reference is null then raise exception 'P14_REQUIRED_DETAILS_MISSING'; end if;
    insert into public.obligations(business_id,customer_id,account_id,obligation_type,reference,issue_date,due_date,currency,original_amount_minor,status,metadata)
      values(p_business_id,v_customer_id,v_account_id,'general_obligation',v_reference,coalesce(nullif(v_data->>'transactionDate','')::date,current_date),v_due,v_currency,v_amount,case when v_due<current_date then 'overdue' else 'open' end,jsonb_build_object('transaction_nature',v_route,'source_intake_id',p_intake_id)) returning * into v_obligation;
    v_obligation_id:=v_obligation.id;
  end if;
  select count(*) into v_candidate_count from public.evidence_files e where e.business_id=p_business_id and e.id<>v_evidence.id and e.soft_deleted_at is null and e.content_sha256=v_evidence.content_sha256;
  if v_candidate_count>0 and coalesce((v_data#>>'{duplicateReview,acknowledged}')::boolean,false)=false then raise exception 'P14_DUPLICATE_REVIEW_REQUIRED'; end if;
  if v_route in ('repayment','partial_repayment') then
    v_case_id:=nullif(v_data->>'caseId','');
    select c.* into v_case from public.cases c join public.recovery_case_obligations r on r.case_id=c.id and r.obligation_id=v_obligation_id where c.id=v_case_id and c.business_id=p_business_id and c.debtor_id=v_customer_id and c.currency=v_currency and c.archived_at is null for update;
    if not found then raise exception 'P14_CASE_OBLIGATION_SCOPE_MISMATCH'; end if;
    insert into public.payments(case_id,amount,amount_minor,currency,payment_method,reference_no,review_status,notes)
      values(v_case.id,public.currency_minor_to_major(v_amount,v_currency),v_amount,v_currency,coalesce(nullif(v_data->>'paymentMethod',''),'bank_transfer'),v_reference,'pending_review',left(nullif(v_data->>'notes',''),2000)) returning * into v_payment;
    v_payment_id:=v_payment.id; v_case_id:=v_case.id;
  elsif v_route='refund' then
    if v_role not in ('owner','admin','manager') then raise exception 'P14_REFUND_PERMISSION_DENIED'; end if;
    select p.* into v_original from public.payments p join public.cases c on c.id=p.case_id where p.id=nullif(v_data->>'originalPaymentId','')::uuid and c.business_id=p_business_id and p.review_status='approved' for update;
    if not found or v_original.amount_minor<>v_amount or v_original.currency<>v_currency then raise exception 'P14_REFUND_ORIGINAL_MISMATCH'; end if;
    insert into public.case_financial_events(case_id,event_type,amount_minor,currency,source_table,source_id,idempotency_key,note,created_by)
      values(v_original.case_id,'payment_reversal',v_original.amount_minor,v_original.currency,'payment_reversal',v_original.id,gen_random_uuid(),coalesce(nullif(v_data->>'notes',''),'Document intake refund'),p_actor_id);
    update public.payments set review_status='reversed',reversed_at=now(),reversed_by=p_actor_id,reversal_reason=coalesce(nullif(v_data->>'notes',''),'Document intake refund') where id=v_original.id;
    perform public.financial_recalculate_case(v_original.case_id); v_payment_id:=v_original.id; v_case_id:=v_original.case_id;
  elsif v_route='collection_case' then
    if not coalesce((v_data->>'createCollectionCase')::boolean,false) or v_due>=current_date or v_obligation.outstanding_minor<=0 then raise exception 'P14_CASE_NOT_JUSTIFIED'; end if;
    v_case_id:='CB-'||extract(year from current_date)::integer::text||'-'||substr(replace(gen_random_uuid()::text,'-',''),1,12);
    insert into public.cases(id,business_id,debtor_id,account_id,case_scope,debtor_type,debtor_name,debtor_phone,debtor_email,debtor_company,debtor_reg_no,debtor_location,currency,amount_owed,amount_paid,due_date,invoice_no,status,payment_lock_mode,notes)
      values(v_case_id,p_business_id,v_customer_id,v_account_id,'single_obligation',v_customer.debtor_type,coalesce(v_customer.business_name,v_customer.individual_name,''),v_customer.phone,v_customer.email,v_customer.business_name,v_customer.registration_no,v_customer.address,v_currency,public.currency_minor_to_major(v_obligation.contractual_due_minor,v_currency),0,v_due,v_reference,'overdue','approval',left(nullif(v_data->>'notes',''),2000));
    insert into public.recovery_case_obligations(case_id,obligation_id,business_id,linked_by) values(v_case_id,v_obligation_id,p_business_id,p_actor_id);
    perform public.receivables_sync_case_obligations(v_case_id);
  end if;
  insert into public.document_intake_outcomes(intake_id,business_id,route,customer_id,account_id,obligation_id,payment_id,original_payment_id,case_id,result,created_by)
    values(p_intake_id,p_business_id,v_route,v_customer_id,v_account_id,v_obligation_id,v_payment_id,case when v_route='refund' then v_payment_id end,v_case_id,jsonb_build_object('payment_status',case when v_payment_id is not null and v_route<>'refund' then 'pending_review' end,'evidence_id',v_evidence.id),p_actor_id) returning * into v_outcome;
  insert into public.document_intake_record_evidence_links(business_id,intake_id,evidence_id,entity_type,entity_id)
    select p_business_id,p_intake_id,v_evidence.id,x.entity_type,x.entity_id from (values
      ('customer',v_customer_id::text),('account',v_account_id::text),('obligation',v_obligation_id::text),('payment',v_payment_id::text),('case',v_case_id)
    ) x(entity_type,entity_id) where x.entity_id is not null;
  update public.document_intakes set status='submitted',submitted_at=now(),version=version+1,updated_at=now() where id=p_intake_id;
  insert into public.document_intake_idempotency_keys(business_id,action_scope,idempotency_key,request_hash,actor_id,resource_type,resource_id,response_status)
    values(p_business_id,'submit_workflow',p_idempotency_key,p_request_hash,p_actor_id,'document_intake_outcome',v_outcome.id,201);
  insert into public.document_intake_events(intake_id,business_id,from_status,to_status,intake_version,actor_id,actor_role,action,metadata,correlation_id,idempotency_key)
    values(p_intake_id,p_business_id,v_intake.status,'submitted',v_intake.version+1,p_actor_id,v_role,'document_intake.workflow_submitted',jsonb_build_object('route',v_route,'outcome_id',v_outcome.id,'duplicate_review',v_data->'duplicateReview'),p_correlation_id,p_idempotency_key);
  insert into public.audit_logs(business_id,case_id,action,actor_type,actor_id,actor_role,entity_type,entity_id,correlation_id,idempotency_key,metadata)
    values(p_business_id,v_case_id,'document_intake.workflow_submitted','staff',p_actor_id,v_role,'document_intake_outcome',v_outcome.id::text,p_correlation_id,p_idempotency_key,jsonb_build_object('route',v_route,'customer_id',v_customer_id,'obligation_id',v_obligation_id,'payment_id',v_payment_id));
  return jsonb_build_object('outcome',to_jsonb(v_outcome),'idempotent_replay',false);
end; $$;

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
commit;

-- Prompt 15: transaction-evidence module release hardening.
-- Apply after 20260905_human_review_evidence_confirmation.sql and
-- 20260904_profile_matching_draft_to_case.sql.

begin;

alter table public.evidence_files
  add column if not exists scan_attempt_count integer not null default 0 check(scan_attempt_count between 0 and 5),
  add column if not exists scan_started_at timestamptz,
  add column if not exists scan_completed_at timestamptz,
  add column if not exists scan_next_attempt_at timestamptz,
  add column if not exists scan_locked_at timestamptz,
  add column if not exists scan_locked_by text,
  add column if not exists scan_provider_version text,
  add column if not exists scan_error_code text,
  add column if not exists scan_sha256 char(64) check(scan_sha256 is null or scan_sha256~'^[0-9a-f]{64}$');

create index if not exists evidence_files_scan_queue_idx
  on public.evidence_files(scan_status,scan_next_attempt_at,uploaded_at)
  where intake_id is not null and kind='original' and is_current and soft_deleted_at is null
    and scan_status in ('pending','failed');

create or replace function public.document_evidence_claim_scan(p_worker_id text,p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_file public.evidence_files;
begin
  if nullif(trim(p_worker_id),'') is null then raise exception 'P15_INVALID_SCAN_WORKER'; end if;
  select file.* into v_file from public.evidence_files file
  join public.document_intakes intake on intake.id=file.intake_id and intake.business_id=file.business_id
  where file.kind='original' and file.is_current and file.soft_deleted_at is null
    and file.scan_status in ('pending','failed')
    and (file.scan_next_attempt_at is null or file.scan_next_attempt_at<=p_now)
    and (file.scan_locked_at is null or file.scan_locked_at<p_now-interval '2 minutes')
    and file.scan_attempt_count<5 and intake.deleted_at is null and intake.status not in ('submitted','cancelled')
  order by coalesce(file.scan_next_attempt_at,file.uploaded_at),file.uploaded_at
  for update of file skip locked limit 1;
  if not found then return null; end if;
  update public.evidence_files set scan_status='pending',scan_attempt_count=scan_attempt_count+1,
    scan_started_at=coalesce(scan_started_at,p_now),scan_completed_at=null,scan_next_attempt_at=null,
    scan_locked_at=p_now,scan_locked_by=p_worker_id,scan_error_code=null
  where id=v_file.id returning * into v_file;
  return jsonb_build_object('evidence_id',v_file.id,'intake_id',v_file.intake_id,'business_id',v_file.business_id,
    'storage_bucket',v_file.storage_bucket,'object_path',v_file.object_path,'file_size_bytes',v_file.file_size_bytes,
    'magic_mime_type',v_file.magic_mime_type,'content_sha256',v_file.content_sha256,'attempt_count',v_file.scan_attempt_count);
end; $$;

create or replace function public.document_evidence_complete_scan(
  p_business_id uuid,p_evidence_id uuid,p_worker_id text,p_provider text,p_provider_version text,
  p_verdict text,p_scanned_sha256 text
) returns public.evidence_files language plpgsql security definer set search_path=public,pg_temp as $$
declare v_file public.evidence_files; v_intake public.document_intakes; v_old_status text;
begin
  select * into v_file from public.evidence_files where id=p_evidence_id and business_id=p_business_id for update;
  if not found then raise exception 'P15_SCAN_NOT_FOUND'; end if;
  if v_file.scan_locked_by is distinct from p_worker_id or v_file.scan_locked_at is null then raise exception 'P15_SCAN_LEASE_MISMATCH'; end if;
  if nullif(trim(p_provider),'') is null or nullif(trim(p_provider_version),'') is null
    or p_verdict not in ('clean','suspected','malicious') or p_scanned_sha256!~'^[0-9a-f]{64}$'
    or p_scanned_sha256<>v_file.content_sha256 then raise exception 'P15_INVALID_SCAN_RESULT'; end if;
  select * into v_intake from public.document_intakes where id=v_file.intake_id and business_id=p_business_id for update;
  if not found then raise exception 'P15_SCAN_SCOPE_MISMATCH'; end if;
  update public.evidence_files set scan_status=case when p_verdict='clean' then 'clean' else 'quarantined' end,
    scan_provider=p_provider,scan_provider_version=p_provider_version,scan_sha256=p_scanned_sha256,
    scan_completed_at=now(),scan_next_attempt_at=null,scan_locked_at=null,scan_locked_by=null,scan_error_code=null,
    processing_status=case when p_verdict='clean' then processing_status else 'failed' end
  where id=v_file.id returning * into v_file;
  if p_verdict<>'clean' then
    v_old_status:=v_intake.status;
    update public.document_intakes set status='failed',version=version+1,updated_at=now(),last_error_code='EVIDENCE_QUARANTINED'
      where id=v_intake.id returning * into v_intake;
    insert into public.document_intake_events(intake_id,business_id,from_status,to_status,intake_version,action,error_code,metadata)
      values(v_intake.id,p_business_id,v_old_status,'failed',v_intake.version,'document_evidence.quarantined','EVIDENCE_QUARANTINED',
        jsonb_build_object('evidence_id',v_file.id,'provider',p_provider,'provider_version',p_provider_version,'verdict',p_verdict));
  else
    insert into public.document_intake_events(intake_id,business_id,from_status,to_status,intake_version,action,metadata)
      values(v_intake.id,p_business_id,v_intake.status,v_intake.status,v_intake.version,'document_evidence.scan_completed',
        jsonb_build_object('evidence_id',v_file.id,'provider',p_provider,'provider_version',p_provider_version,'verdict','clean'));
  end if;
  insert into public.audit_logs(business_id,action,actor_type,entity_type,entity_id,metadata)
    values(p_business_id,case when p_verdict='clean' then 'document_evidence.scan_completed' else 'document_evidence.quarantined' end,
      'system','evidence_file',v_file.id::text,jsonb_build_object('intake_id',v_file.intake_id,'provider',p_provider,
      'provider_version',p_provider_version,'verdict',p_verdict,'attempt',v_file.scan_attempt_count));
  return v_file;
end; $$;

create or replace function public.document_evidence_fail_scan(
  p_business_id uuid,p_evidence_id uuid,p_worker_id text,p_error_code text,p_retryable boolean,p_max_attempts integer
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_file public.evidence_files; v_intake public.document_intakes; v_retry boolean; v_next timestamptz; v_old_status text;
begin
  select * into v_file from public.evidence_files where id=p_evidence_id and business_id=p_business_id for update;
  if not found then raise exception 'P15_SCAN_NOT_FOUND'; end if;
  if v_file.scan_locked_by is distinct from p_worker_id or v_file.scan_locked_at is null then raise exception 'P15_SCAN_LEASE_MISMATCH'; end if;
  if p_error_code!~'^[A-Z0-9_]{3,64}$' or p_max_attempts not between 1 and 5 then raise exception 'P15_INVALID_SCAN_FAILURE'; end if;
  select * into v_intake from public.document_intakes where id=v_file.intake_id and business_id=p_business_id for update;
  if not found then raise exception 'P15_SCAN_SCOPE_MISMATCH'; end if;
  v_retry:=p_retryable and v_file.scan_attempt_count<p_max_attempts;
  v_next:=case when v_retry then now()+(least(60,power(2,v_file.scan_attempt_count))::text||' minutes')::interval else null end;
  update public.evidence_files set scan_status=case when v_retry then 'pending' else 'failed' end,
    scan_error_code=p_error_code,scan_next_attempt_at=v_next,scan_completed_at=case when v_retry then null else now() end,
    scan_locked_at=null,scan_locked_by=null,processing_status=case when v_retry then processing_status else 'failed' end
    where id=v_file.id returning * into v_file;
  if not v_retry then
    v_old_status:=v_intake.status;
    update public.document_intakes set status='failed',version=version+1,updated_at=now(),last_error_code=p_error_code
      where id=v_intake.id returning * into v_intake;
    insert into public.document_intake_events(intake_id,business_id,from_status,to_status,intake_version,action,error_code,metadata)
      values(v_intake.id,p_business_id,v_old_status,'failed',v_intake.version,'document_evidence.scan_failed',p_error_code,
        jsonb_build_object('evidence_id',v_file.id,'attempt',v_file.scan_attempt_count));
  end if;
  insert into public.audit_logs(business_id,action,actor_type,entity_type,entity_id,metadata)
    values(p_business_id,case when v_retry then 'document_evidence.scan_retry_scheduled' else 'document_evidence.scan_failed' end,
      'system','evidence_file',v_file.id::text,jsonb_build_object('intake_id',v_file.intake_id,'error_code',p_error_code,
      'attempt',v_file.scan_attempt_count,'retry_scheduled',v_retry,'next_attempt_at',v_next));
  return jsonb_build_object('evidence_id',v_file.id,'retry_scheduled',v_retry,'next_attempt_at',v_next);
end; $$;

create or replace function public.document_evidence_requeue_scan(
  p_business_id uuid,p_evidence_id uuid,p_actor_id uuid,p_reason_code text,p_correlation_id uuid
) returns public.evidence_files language plpgsql security definer set search_path=public,pg_temp as $$
declare v_file public.evidence_files; v_intake public.document_intakes; v_role text; v_old_status text;
begin
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id);
  if v_role is null or v_role not in ('owner','manager') then raise exception 'P8_PERMISSION_DENIED'; end if;
  if p_reason_code!~'^[A-Z0-9_]{3,64}$' then raise exception 'P15_INVALID_REQUEUE_REASON'; end if;
  select * into v_file from public.evidence_files where id=p_evidence_id and business_id=p_business_id
    and kind='original' and is_current and soft_deleted_at is null for update;
  if not found then raise exception 'P8_EVIDENCE_NOT_FOUND'; end if;
  if v_file.scan_status<>'failed' then raise exception 'P15_SCAN_NOT_REQUEUEABLE'; end if;
  select * into v_intake from public.document_intakes where id=v_file.intake_id and business_id=p_business_id for update;
  if not found or v_intake.status in ('submitted','cancelled') then raise exception 'P8_INTAKE_LOCKED'; end if;
  update public.evidence_files set scan_status='pending',scan_attempt_count=0,scan_started_at=null,scan_completed_at=null,
    scan_next_attempt_at=now(),scan_locked_at=null,scan_locked_by=null,scan_error_code=null,processing_status='queued'
    where id=v_file.id returning * into v_file;
  v_old_status:=v_intake.status;
  update public.document_intakes set status='processing',version=version+1,updated_at=now(),last_error_code=null
    where id=v_intake.id returning * into v_intake;
  insert into public.document_intake_events(intake_id,business_id,from_status,to_status,intake_version,actor_id,actor_role,action,metadata,correlation_id)
    values(v_intake.id,p_business_id,v_old_status,'processing',v_intake.version,p_actor_id,v_role,'document_evidence.scan_requeued',
      jsonb_build_object('evidence_id',v_file.id,'reason_code',p_reason_code),p_correlation_id);
  insert into public.audit_logs(business_id,action,actor_type,actor_id,actor_role,entity_type,entity_id,correlation_id,metadata)
    values(p_business_id,'document_evidence.scan_requeued','staff',p_actor_id,v_role,'evidence_file',v_file.id::text,p_correlation_id,
      jsonb_build_object('intake_id',v_file.intake_id,'reason_code',p_reason_code));
  return v_file;
end; $$;

create or replace function public.document_intake_outcome_release_guard()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_evidence public.evidence_files; v_draft public.document_intake_workflow_drafts;
  v_confirmation public.document_intake_confirmations; v_reference text; v_amount bigint; v_currency text;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.business_id::text||':document-outcome-release',0));
  if (select count(*) from public.document_intake_outcomes where business_id=new.business_id and created_at>now()-interval '1 hour')>=30
    then raise exception 'P15_FINAL_SUBMIT_RATE_LIMITED'; end if;
  select * into v_evidence from public.evidence_files where intake_id=new.intake_id and business_id=new.business_id
    and kind='original' and is_current and soft_deleted_at is null order by evidence_version desc limit 1;
  select * into v_draft from public.document_intake_workflow_drafts where intake_id=new.intake_id and business_id=new.business_id;
  select * into v_confirmation from public.document_intake_confirmations where intake_id=new.intake_id and business_id=new.business_id
    and review_status='confirmed' order by confirmation_version desc limit 1;
  if v_evidence.id is null or v_draft.intake_id is null or v_confirmation.id is null then raise exception 'P15_RELEASE_CONTEXT_MISSING'; end if;
  if exists(select 1 from public.evidence_files prior where prior.business_id=new.business_id and prior.id<>v_evidence.id
      and prior.soft_deleted_at is null and prior.content_sha256=v_evidence.content_sha256)
    then raise exception 'P15_EXACT_DUPLICATE_BLOCKED'; end if;
  v_reference:=upper(regexp_replace(coalesce(v_draft.draft_data->>'reference',''),'[^A-Za-z0-9]','','g'));
  v_amount:=nullif(v_draft.draft_data->>'amountMinor','')::bigint;
  v_currency:=upper(v_draft.draft_data->>'currency');
  if length(v_reference)>=4 and (
    exists(select 1 from public.payments p join public.cases c on c.id=p.case_id
      where c.business_id=new.business_id and upper(regexp_replace(coalesce(p.reference_no,''),'[^A-Za-z0-9]','','g'))=v_reference
        and p.amount_minor=v_amount and p.currency=v_currency)
    or (new.route in ('loan_disbursement','collection_case') and exists(select 1 from public.obligations o
      where o.business_id=new.business_id and upper(regexp_replace(coalesce(o.reference,''),'[^A-Za-z0-9]','','g'))=v_reference
        and o.original_amount_minor=v_amount and o.currency=v_currency))
  ) then raise exception 'P15_EXACT_DUPLICATE_BLOCKED'; end if;
  if v_confirmation.represents_financial_movement is distinct from true then raise exception 'P15_FINANCIAL_CONFIRMATION_MISMATCH'; end if;
  if (v_confirmation.transaction_nature in ('repayment','partial_repayment','refund') and v_confirmation.transaction_nature<>new.route)
    or (v_confirmation.transaction_nature in ('deposit','fee_adjustment','other') and new.route<>'deposit_or_other')
    or (v_confirmation.transaction_nature='loan_disbursement' and new.route not in ('loan_disbursement','collection_case'))
    then raise exception 'P15_TRANSACTION_NATURE_MISMATCH'; end if;
  return new;
end; $$;
drop trigger if exists document_intake_outcome_release_guard on public.document_intake_outcomes;
create trigger document_intake_outcome_release_guard before insert on public.document_intake_outcomes
for each row execute function public.document_intake_outcome_release_guard();

create or replace function public.document_intake_redact_review_log()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare v_decisions jsonb; v_citations jsonb; v_corrections integer:=0; v_item jsonb;
begin
  if new.action not in ('document_review.confirmed','document_review.draft_saved') then return new; end if;
  v_decisions:=coalesce(new.metadata->'field_decisions',new.metadata->'original_candidates_and_corrections','{}'::jsonb);
  v_citations:=coalesce(new.metadata->'evidence_citations','[]'::jsonb);
  if jsonb_typeof(v_decisions)='object' then
    for v_item in select value from jsonb_each(v_decisions) loop
      if v_item->>'source'='manual' or (v_item->>'source'='user' and v_item->>'original_value' is distinct from v_item->>'confirmed_value') then
        v_corrections:=v_corrections+1;
      end if;
    end loop;
  end if;
  new.metadata:=jsonb_strip_nulls(jsonb_build_object(
    'confirmation_id',new.metadata->'confirmation_id','confirmation_version',new.metadata->'confirmation_version',
    'extraction_id',new.metadata->'extraction_id','reviewed_at',new.metadata->'reviewed_at',
    'reviewed_by',new.metadata->'reviewed_by','correction_count',v_corrections,
    'citation_count',case when jsonb_typeof(v_citations)='array' then jsonb_array_length(v_citations) else 0 end
  ));
  return new;
end; $$;
drop trigger if exists document_intake_events_review_log_redaction on public.document_intake_events;
create trigger document_intake_events_review_log_redaction before insert or update on public.document_intake_events
for each row execute function public.document_intake_redact_review_log();
drop trigger if exists audit_logs_review_log_redaction on public.audit_logs;
create trigger audit_logs_review_log_redaction before insert or update on public.audit_logs
for each row execute function public.document_intake_redact_review_log();

-- Existing append-only events are deliberately not rewritten. Deploy this
-- before enabling production review traffic; historical remediation requires
-- a separately approved retention and incident-response procedure.

create or replace function public.document_intake_module_health(p_now timestamptz default now())
returns jsonb language sql security definer set search_path=public,pg_temp as $$
  select jsonb_build_object(
    'window_hours',24,
    'uploads',jsonb_build_object('succeeded',(select count(*) from public.audit_logs where action in ('document_evidence.uploaded','document_evidence.replaced') and created_at>=p_now-interval '24 hours'),
      'failed',(select count(*) from public.document_intake_events where action='document_evidence.upload_failed' and created_at>=p_now-interval '24 hours')),
    'scans',jsonb_build_object('clean',(select count(*) from public.audit_logs where action='document_evidence.scan_completed' and created_at>=p_now-interval '24 hours'),
      'failed',(select count(*) from public.audit_logs where action in ('document_evidence.scan_failed','document_evidence.quarantined') and created_at>=p_now-interval '24 hours')),
    'extractions',jsonb_build_object('succeeded',(select count(*) from public.audit_logs where action='document_extraction.completed' and created_at>=p_now-interval '24 hours'),
      'failed',(select count(*) from public.audit_logs where action='document_extraction.failed' and created_at>=p_now-interval '24 hours'),
      'average_latency_ms',(select coalesce(round(avg(extract(epoch from (completed_at-started_at))*1000)),0)::bigint
        from public.document_intake_extractions where completed_at is not null and started_at is not null and completed_at>=p_now-interval '24 hours')),
    'manual_corrections',(select coalesce(sum((metadata->>'correction_count')::integer),0) from public.audit_logs where action='document_review.confirmed' and created_at>=p_now-interval '24 hours'),
    'duplicate_warnings',(select count(*) from public.evidence_files where intake_id is not null and duplicate_match_status='exact_hash_warning' and uploaded_at>=p_now-interval '24 hours'),
    'final_submits',jsonb_build_object('succeeded',(select count(*) from public.document_intake_outcomes where created_at>=p_now-interval '24 hours'),
      'failed',(select count(*) from public.audit_logs where action='document_intake.workflow_submit_failed' and created_at>=p_now-interval '24 hours')),
    'stuck_scans',(select count(*) from public.evidence_files where intake_id is not null and is_current and scan_status='pending' and coalesce(scan_locked_at,uploaded_at)<p_now-interval '15 minutes'),
    'stuck_extractions',(select count(*) from public.document_intake_extractions where status='processing' and locked_at<p_now-interval '15 minutes'),
    'orphan_cleanup_failures',(select count(*) from public.audit_logs where action='document_evidence.cleanup_failed' and created_at>=p_now-interval '24 hours')
  );
$$;

revoke all on function public.document_evidence_claim_scan(text,timestamptz) from public,anon,authenticated;
revoke all on function public.document_evidence_complete_scan(uuid,uuid,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.document_evidence_fail_scan(uuid,uuid,text,text,boolean,integer) from public,anon,authenticated;
revoke all on function public.document_evidence_requeue_scan(uuid,uuid,uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.document_intake_module_health(timestamptz) from public,anon,authenticated;
revoke all on function public.document_intake_outcome_release_guard() from public,anon,authenticated;
revoke all on function public.document_intake_redact_review_log() from public,anon,authenticated;
grant execute on function public.document_evidence_claim_scan(text,timestamptz) to service_role;
grant execute on function public.document_evidence_complete_scan(uuid,uuid,text,text,text,text,text) to service_role;
grant execute on function public.document_evidence_fail_scan(uuid,uuid,text,text,boolean,integer) to service_role;
grant execute on function public.document_evidence_requeue_scan(uuid,uuid,uuid,text,uuid) to service_role;
grant execute on function public.document_intake_module_health(timestamptz) to service_role;

commit;

-- Rollback: disable document scan/extraction crons, drop the release-guard and
-- redaction triggers, then drop these five service RPCs. Retain scan verdict,
-- attempt, audit and outcome history. Removing retained security evidence is a
-- separate destructive operation requiring policy approval.
-- Prompt 16: deterministic, explainable payment candidate matching.
-- Apply after 20260906_transaction_evidence_release_hardening.sql.
begin;

create table if not exists public.payment_matching_settings (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  high_confidence_threshold smallint not null default 75 check(high_confidence_threshold between 70 and 95),
  ambiguous_threshold smallint not null default 45 check(ambiguous_threshold between 30 and 69),
  date_window_days smallint not null default 14 check(date_window_days between 1 and 30),
  maximum_candidates smallint not null default 10 check(maximum_candidates between 3 and 20),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  check(high_confidence_threshold>=ambiguous_threshold+10)
);

create table if not exists public.normalized_payment_transactions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  source_type text not null check(source_type in ('bank_statement','accounting','manual','payment_proof')),
  source_system text not null check(char_length(btrim(source_system)) between 1 and 80),
  source_record_id text not null check(char_length(btrim(source_record_id)) between 1 and 255),
  source_batch_key text,
  import_batch_id uuid references public.import_batches(id) on delete restrict,
  document_intake_id uuid references public.document_intakes(id) on delete restrict,
  payment_submission_id uuid references public.public_payment_submissions(id) on delete restrict,
  existing_payment_id uuid references public.payments(id) on delete restrict,
  amount_minor bigint not null check(amount_minor>0),
  currency char(3) not null check(currency~'^[A-Z]{3}$'),
  occurred_at timestamptz,
  reference text,
  invoice_number text,
  party_name text,
  account_reference text,
  phone text,
  phone_match_permitted boolean not null default false,
  duplicate_of_transaction_id uuid references public.normalized_payment_transactions(id) on delete restrict,
  duplicate_signals jsonb not null default '[]'::jsonb check(jsonb_typeof(duplicate_signals)='array'),
  fingerprint_hash char(64) not null check(fingerprint_hash~'^[0-9a-f]{64}$'),
  queue_status text not null default 'ready' check(queue_status in ('ready','high_confidence_review','ambiguous','unmatched','allocated')),
  metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata)='object'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,business_id),
  unique(business_id,source_type,source_system,source_record_id)
);
create index if not exists normalized_payment_transactions_queue_idx
  on public.normalized_payment_transactions(business_id,queue_status,created_at desc);
create index if not exists normalized_payment_transactions_reference_idx
  on public.normalized_payment_transactions(business_id,reference) where reference is not null;

create table if not exists public.payment_match_jobs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  transaction_id uuid not null references public.normalized_payment_transactions(id) on delete restrict,
  algorithm_version text not null,
  thresholds jsonb not null check(jsonb_typeof(thresholds)='object'),
  queue_result text not null check(queue_result in ('high_confidence_review','ambiguous','unmatched')),
  candidate_count integer not null check(candidate_count>=0),
  idempotency_key text not null,
  request_hash char(64) not null check(request_hash~'^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(id,business_id),
  unique(business_id,idempotency_key)
);
create index if not exists payment_match_jobs_transaction_idx
  on public.payment_match_jobs(business_id,transaction_id,created_at desc);

create table if not exists public.payment_match_candidates (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  job_id uuid not null references public.payment_match_jobs(id) on delete restrict,
  transaction_id uuid not null references public.normalized_payment_transactions(id) on delete restrict,
  rank integer not null check(rank>0),
  score smallint not null check(score between 0 and 100),
  confidence_band text not null check(confidence_band in ('high','ambiguous','low')),
  customer_id uuid not null references public.debtors(id) on delete restrict,
  account_id uuid references public.customer_accounts(id) on delete restrict,
  obligation_id uuid references public.obligations(id) on delete restrict,
  case_id text not null references public.cases(id) on delete restrict,
  existing_payment_id uuid references public.payments(id) on delete restrict,
  matched_signals jsonb not null check(jsonb_typeof(matched_signals)='array'),
  conflicting_signals jsonb not null check(jsonb_typeof(conflicting_signals)='array'),
  reason text not null,
  ranking_reason text not null,
  review_status text not null default 'pending' check(review_status in ('pending','approved','rejected','deferred','superseded')),
  reviewed_by uuid references auth.users(id) on delete restrict,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  unique(id,business_id),
  unique(job_id,rank),
  unique(job_id,case_id,obligation_id)
);
create index if not exists payment_match_candidates_queue_idx
  on public.payment_match_candidates(business_id,review_status,confidence_band,score desc,created_at desc);

create table if not exists public.payment_match_candidate_events (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.payment_match_candidates(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  transaction_id uuid not null references public.normalized_payment_transactions(id) on delete restrict,
  event_type text not null check(event_type in ('proposed','approved','rejected','deferred','superseded')),
  from_status text,
  to_status text not null,
  actor_id uuid references auth.users(id) on delete restrict,
  actor_role text,
  note text,
  metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now()
);

create table if not exists public.payment_match_allocations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  transaction_id uuid not null references public.normalized_payment_transactions(id) on delete restrict,
  candidate_id uuid not null references public.payment_match_candidates(id) on delete restrict,
  case_id text not null references public.cases(id) on delete restrict,
  obligation_id uuid references public.obligations(id) on delete restrict,
  payment_id uuid not null references public.payments(id) on delete restrict,
  amount_minor bigint not null check(amount_minor>0),
  currency char(3) not null check(currency~'^[A-Z]{3}$'),
  split_group_id uuid,
  approved_by uuid not null references auth.users(id) on delete restrict,
  approved_at timestamptz not null default now(),
  idempotency_key text not null,
  unique(transaction_id,candidate_id),
  unique(payment_id),
  unique(business_id,idempotency_key,candidate_id)
);
create unique index if not exists payment_match_allocations_one_unsplit_idx
  on public.payment_match_allocations(transaction_id) where split_group_id is null;

create table if not exists public.payment_matching_idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  action_scope text not null check(action_scope in ('import','review')),
  idempotency_key text not null,
  request_hash char(64) not null check(request_hash~'^[0-9a-f]{64}$'),
  response jsonb not null default '{}'::jsonb check(jsonb_typeof(response)='object'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(business_id,action_scope,idempotency_key)
);

create or replace function public.payment_matching_capture_document_outcome()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_confirmation public.document_intake_confirmations; v_obligation public.obligations; v_account public.customer_accounts; v_fingerprint text;
begin
  if new.payment_id is null or new.route not in ('repayment','partial_repayment') then return new; end if;
  select * into v_confirmation from public.document_intake_confirmations where intake_id=new.intake_id and business_id=new.business_id and review_status='confirmed' order by confirmation_version desc limit 1;
  if not found or v_confirmation.chosen_amount_minor is null or v_confirmation.currency is null then return new; end if;
  if new.obligation_id is not null then select * into v_obligation from public.obligations where id=new.obligation_id and business_id=new.business_id; end if;
  if new.account_id is not null then select * into v_account from public.customer_accounts where id=new.account_id and business_id=new.business_id; end if;
  v_fingerprint:=encode(digest(convert_to(concat_ws('|','payment_proof','document_intake',new.intake_id::text,v_confirmation.chosen_amount_minor::text,v_confirmation.currency,coalesce(v_confirmation.document_datetime::text,''),coalesce(v_confirmation.reference,'')),'UTF8'),'sha256'),'hex');
  insert into public.normalized_payment_transactions(
    business_id,source_type,source_system,source_record_id,source_batch_key,document_intake_id,existing_payment_id,
    amount_minor,currency,occurred_at,reference,invoice_number,party_name,account_reference,phone_match_permitted,
    duplicate_signals,fingerprint_hash,metadata,created_by
  ) values(
    new.business_id,'payment_proof','document_intake',new.intake_id::text,new.id::text,new.intake_id,new.payment_id,
    v_confirmation.chosen_amount_minor,v_confirmation.currency,v_confirmation.document_datetime,v_confirmation.reference,
    v_obligation.reference,v_confirmation.sender,v_account.account_number,false,
    coalesce((select jsonb_agg(jsonb_build_object('code','document_intake_duplicate_signal','detail',j.value)) from jsonb_array_elements_text(coalesce((select draft_data#>'{duplicateReview,candidateKeys}' from public.document_intake_workflow_drafts where intake_id=new.intake_id),'[]'::jsonb)) as j(value)),'[]'::jsonb),
    v_fingerprint,jsonb_build_object('document_intake_outcome_id',new.id,'evidence_id',new.result->>'evidence_id'),new.created_by
  ) on conflict(business_id,source_type,source_system,source_record_id) do nothing;
  return new;
end; $$;
drop trigger if exists payment_matching_document_outcome_capture on public.document_intake_outcomes;
create trigger payment_matching_document_outcome_capture after insert on public.document_intake_outcomes
for each row execute function public.payment_matching_capture_document_outcome();

create or replace function public.payment_matching_capture_public_proof()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_case public.cases; v_fingerprint text;
begin
  select * into v_case from public.cases where id=new.case_id and business_id=new.business_id;
  if not found then return new; end if;
  v_fingerprint:=encode(digest(convert_to(concat_ws('|','payment_proof','public_portal',new.id::text,new.amount_minor::text,new.currency,new.payment_date::text,coalesce(new.reference_no,'')),'UTF8'),'sha256'),'hex');
  insert into public.normalized_payment_transactions(
    business_id,source_type,source_system,source_record_id,source_batch_key,payment_submission_id,
    amount_minor,currency,occurred_at,reference,invoice_number,party_name,account_reference,phone_match_permitted,
    fingerprint_hash,metadata
  ) values(
    new.business_id,'payment_proof','public_portal',new.id::text,new.public_access_token_id::text,new.id,
    new.amount_minor,new.currency,new.payment_date::timestamptz,new.reference_no,new.invoice_reference,v_case.debtor_name,v_case.invoice_no,false,
    v_fingerprint,jsonb_build_object('case_hint',new.case_id,'proof_sha256',new.proof_sha256)
  ) on conflict(business_id,source_type,source_system,source_record_id) do nothing;
  return new;
end; $$;
drop trigger if exists payment_matching_public_proof_capture on public.public_payment_submissions;
create trigger payment_matching_public_proof_capture after insert on public.public_payment_submissions
for each row execute function public.payment_matching_capture_public_proof();

create or replace function public.payment_matching_import_transactions(
  p_business_id uuid,p_actor_id uuid,p_transactions jsonb,p_idempotency_key text,p_request_hash text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_existing public.payment_matching_idempotency_keys; v_item jsonb; v_row public.normalized_payment_transactions;
  v_rows jsonb:='[]'::jsonb; v_import_batch uuid; v_duplicate uuid; v_count integer:=0;
begin
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id);
  if v_role not in ('owner','admin','manager') then raise exception 'P16_PERMISSION_DENIED'; end if;
  if jsonb_typeof(p_transactions)<>'array' or jsonb_array_length(p_transactions) not between 1 and 500 then raise exception 'P16_INVALID_IMPORT'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':payment-import:'||p_idempotency_key,0));
  select * into v_existing from public.payment_matching_idempotency_keys where business_id=p_business_id and action_scope='import' and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_hash<>p_request_hash then raise exception 'P16_IDEMPOTENCY_CONFLICT'; end if;
    return v_existing.response||jsonb_build_object('idempotent_replay',true);
  end if;
  for v_item in select value from jsonb_array_elements(p_transactions) loop
    if v_item->>'sourceType' not in ('bank_statement','accounting','manual','payment_proof')
      or nullif(btrim(v_item->>'sourceSystem'),'') is null or nullif(btrim(v_item->>'sourceRecordId'),'') is null
      or coalesce((v_item->>'amountMinor')::bigint,0)<=0 or upper(v_item->>'currency')!~'^[A-Z]{3}$'
      or coalesce(v_item->>'fingerprintHash','')!~'^[0-9a-f]{64}$' then raise exception 'P16_INVALID_IMPORT'; end if;
    v_import_batch:=nullif(v_item->>'importBatchId','')::uuid;
    if v_import_batch is not null and not exists(select 1 from public.import_batches where id=v_import_batch and business_id=p_business_id) then raise exception 'P16_IMPORT_BATCH_SCOPE_MISMATCH'; end if;
    v_duplicate:=nullif(v_item->>'duplicateOfTransactionId','')::uuid;
    if v_duplicate is not null and not exists(select 1 from public.normalized_payment_transactions where id=v_duplicate and business_id=p_business_id) then raise exception 'P16_DUPLICATE_SCOPE_MISMATCH'; end if;
    insert into public.normalized_payment_transactions(
      business_id,source_type,source_system,source_record_id,source_batch_key,import_batch_id,amount_minor,currency,
      occurred_at,reference,invoice_number,party_name,account_reference,phone,phone_match_permitted,
      duplicate_of_transaction_id,duplicate_signals,fingerprint_hash,metadata,created_by
    ) values(
      p_business_id,v_item->>'sourceType',left(v_item->>'sourceSystem',80),left(v_item->>'sourceRecordId',255),left(nullif(v_item->>'sourceBatchKey',''),255),v_import_batch,
      (v_item->>'amountMinor')::bigint,upper(v_item->>'currency'),nullif(v_item->>'occurredAt','')::timestamptz,
      left(nullif(v_item->>'reference',''),255),left(nullif(v_item->>'invoiceNumber',''),255),left(nullif(v_item->>'partyName',''),255),
      left(nullif(v_item->>'accountReference',''),255),left(nullif(v_item->>'phone',''),50),coalesce((v_item->>'phoneMatchPermitted')::boolean,false),
      v_duplicate,coalesce(v_item->'duplicateSignals','[]'::jsonb),v_item->>'fingerprintHash',coalesce(v_item->'metadata','{}'::jsonb),p_actor_id
    ) on conflict(business_id,source_type,source_system,source_record_id) do update set updated_at=normalized_payment_transactions.updated_at
    returning * into v_row;
    v_rows:=v_rows||jsonb_build_array(jsonb_build_object('id',v_row.id,'sourceRecordId',v_row.source_record_id,'queueStatus',v_row.queue_status));
    v_count:=v_count+1;
  end loop;
  insert into public.audit_logs(business_id,action,actor_type,actor_id,actor_role,entity_type,entity_id,idempotency_key,metadata)
    values(p_business_id,'payment_matching.transactions_imported','staff',p_actor_id,v_role,'normalized_payment_transaction',null,p_idempotency_key,jsonb_build_object('row_count',v_count));
  insert into public.payment_matching_idempotency_keys(business_id,action_scope,idempotency_key,request_hash,response,created_by)
    values(p_business_id,'import',p_idempotency_key,p_request_hash,jsonb_build_object('transactions',v_rows,'imported_count',v_count,'idempotent_replay',false),p_actor_id);
  return jsonb_build_object('transactions',v_rows,'imported_count',v_count,'idempotent_replay',false);
end; $$;

create or replace function public.payment_matching_store_job(
  p_business_id uuid,p_transaction_id uuid,p_actor_id uuid,p_algorithm_version text,p_thresholds jsonb,
  p_queue_result text,p_candidates jsonb,p_idempotency_key text,p_request_hash text
) returns public.payment_match_jobs language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_job public.payment_match_jobs; v_item jsonb; v_transaction public.normalized_payment_transactions; v_candidate public.payment_match_candidates;
begin
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id);
  if v_role not in ('owner','admin','manager') then raise exception 'P16_PERMISSION_DENIED'; end if;
  if p_queue_result not in ('high_confidence_review','ambiguous','unmatched') or jsonb_typeof(p_candidates)<>'array' then raise exception 'P16_INVALID_MATCH_JOB'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':payment-match:'||p_transaction_id::text,0));
  select * into v_job from public.payment_match_jobs where business_id=p_business_id and idempotency_key=p_idempotency_key;
  if found then if v_job.request_hash<>p_request_hash then raise exception 'P16_IDEMPOTENCY_CONFLICT'; end if; return v_job; end if;
  select * into v_transaction from public.normalized_payment_transactions where id=p_transaction_id and business_id=p_business_id for update;
  if not found then raise exception 'P16_TRANSACTION_NOT_FOUND'; end if;
  if v_transaction.queue_status='allocated' then raise exception 'P16_TRANSACTION_ALREADY_ALLOCATED'; end if;
  insert into public.payment_match_jobs(business_id,transaction_id,algorithm_version,thresholds,queue_result,candidate_count,idempotency_key,request_hash,created_by)
    values(p_business_id,p_transaction_id,p_algorithm_version,p_thresholds,p_queue_result,jsonb_array_length(p_candidates),p_idempotency_key,p_request_hash,p_actor_id) returning * into v_job;
  for v_item in select value from jsonb_array_elements(p_candidates) loop
    if not exists(select 1 from public.cases c where c.id=v_item->>'caseId' and c.business_id=p_business_id and c.debtor_id=(v_item->>'customerId')::uuid) then raise exception 'P16_CANDIDATE_SCOPE_MISMATCH'; end if;
    if nullif(v_item->>'obligationId','') is not null and not exists(select 1 from public.recovery_case_obligations r where r.case_id=v_item->>'caseId' and r.obligation_id=(v_item->>'obligationId')::uuid and r.business_id=p_business_id) then raise exception 'P16_CANDIDATE_SCOPE_MISMATCH'; end if;
    insert into public.payment_match_candidates(business_id,job_id,transaction_id,rank,score,confidence_band,customer_id,account_id,obligation_id,case_id,existing_payment_id,matched_signals,conflicting_signals,reason,ranking_reason)
      values(p_business_id,v_job.id,p_transaction_id,(v_item->>'rank')::integer,(v_item->>'score')::smallint,v_item->>'confidenceBand',(v_item->>'customerId')::uuid,
        nullif(v_item->>'accountId','')::uuid,nullif(v_item->>'obligationId','')::uuid,v_item->>'caseId',nullif(v_item->>'existingPaymentId','')::uuid,
        v_item->'matchedSignals',v_item->'conflictingSignals',v_item->>'reason',v_item->>'rankingReason') returning * into v_candidate;
    insert into public.payment_match_candidate_events(candidate_id,business_id,transaction_id,event_type,to_status,actor_id,actor_role,metadata)
      values(v_candidate.id,p_business_id,p_transaction_id,'proposed','pending',p_actor_id,v_role,jsonb_build_object('rank',v_candidate.rank,'score',v_candidate.score,'confidence_band',v_candidate.confidence_band));
  end loop;
  update public.normalized_payment_transactions set queue_status=p_queue_result,updated_at=now() where id=p_transaction_id;
  insert into public.audit_logs(business_id,action,actor_type,actor_id,actor_role,entity_type,entity_id,idempotency_key,metadata)
    values(p_business_id,'payment_matching.candidates_generated','staff',p_actor_id,v_role,'normalized_payment_transaction',p_transaction_id::text,p_idempotency_key,jsonb_build_object('job_id',v_job.id,'queue',p_queue_result,'candidate_count',v_job.candidate_count,'algorithm_version',p_algorithm_version));
  return v_job;
end; $$;

create or replace function public.payment_matching_review_candidate(
  p_business_id uuid,p_transaction_id uuid,p_actor_id uuid,p_decision text,p_candidate_id uuid,p_allocations jsonb,
  p_split_authorization boolean,p_note text,p_idempotency_key text,p_request_hash text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_existing public.payment_matching_idempotency_keys; v_transaction public.normalized_payment_transactions;
  v_candidate public.payment_match_candidates; v_item jsonb; v_case public.cases; v_payment public.payments; v_event_id uuid;
  v_amount bigint; v_total bigint:=0; v_count integer; v_split_group uuid; v_response jsonb; v_old_status text;
begin
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id);
  if v_role not in ('owner','admin','manager') then raise exception 'P16_PERMISSION_DENIED'; end if;
  if p_decision not in ('approve','approve_split','reject','defer') then raise exception 'P16_INVALID_REVIEW'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':payment-review:'||p_transaction_id::text,0));
  select * into v_existing from public.payment_matching_idempotency_keys where business_id=p_business_id and action_scope='review' and idempotency_key=p_idempotency_key;
  if found then if v_existing.request_hash<>p_request_hash then raise exception 'P16_IDEMPOTENCY_CONFLICT'; end if; return v_existing.response||jsonb_build_object('idempotent_replay',true); end if;
  select * into v_transaction from public.normalized_payment_transactions where id=p_transaction_id and business_id=p_business_id for update;
  if not found then raise exception 'P16_TRANSACTION_NOT_FOUND'; end if;
  select * into v_candidate from public.payment_match_candidates where id=p_candidate_id and transaction_id=p_transaction_id and business_id=p_business_id for update;
  if not found then raise exception 'P16_CANDIDATE_NOT_FOUND'; end if;
  if v_candidate.job_id is distinct from (select id from public.payment_match_jobs where transaction_id=p_transaction_id and business_id=p_business_id order by created_at desc,id desc limit 1) then raise exception 'P16_CANDIDATE_STALE'; end if;
  if p_decision in ('reject','defer') then
    if v_candidate.review_status not in ('pending','deferred') then raise exception 'P16_CANDIDATE_ALREADY_REVIEWED'; end if;
    v_old_status:=v_candidate.review_status;
    update public.payment_match_candidates set review_status=case when p_decision='reject' then 'rejected' else 'deferred' end,
      reviewed_by=p_actor_id,reviewed_at=now(),review_note=btrim(p_note) where id=v_candidate.id returning * into v_candidate;
    insert into public.payment_match_candidate_events(candidate_id,business_id,transaction_id,event_type,from_status,to_status,actor_id,actor_role,note)
      values(v_candidate.id,p_business_id,p_transaction_id,case when p_decision='reject' then 'rejected' else 'deferred' end,v_old_status,v_candidate.review_status,p_actor_id,v_role,btrim(p_note));
    v_response:=jsonb_build_object('transaction_id',p_transaction_id,'candidate_id',v_candidate.id,'decision',p_decision,'queue_status',v_transaction.queue_status,'idempotent_replay',false);
  else
    if exists(select 1 from public.payment_match_allocations where transaction_id=p_transaction_id)
      or exists(select 1 from public.payment_match_allocations a join public.normalized_payment_transactions t on t.id=a.transaction_id
        where t.business_id=p_business_id and (t.id=v_transaction.duplicate_of_transaction_id or t.duplicate_of_transaction_id=p_transaction_id))
      or v_transaction.queue_status='allocated' then raise exception 'P16_TRANSACTION_ALREADY_ALLOCATED'; end if;
    if p_decision='approve_split' then
      if not p_split_authorization or jsonb_typeof(p_allocations)<>'array' or jsonb_array_length(p_allocations)<2 then raise exception 'P16_SPLIT_AUTHORIZATION_REQUIRED'; end if;
      v_split_group:=gen_random_uuid();
    else
      if p_split_authorization then raise exception 'P16_INVALID_REVIEW'; end if;
      p_allocations:=jsonb_build_array(jsonb_build_object('candidateId',p_candidate_id,'amountMinor',v_transaction.amount_minor));
    end if;
    v_count:=jsonb_array_length(p_allocations);
    select coalesce(sum((value->>'amountMinor')::bigint),0) into v_total from jsonb_array_elements(p_allocations);
    if v_total<>v_transaction.amount_minor then raise exception 'P16_ALLOCATION_TOTAL_MISMATCH'; end if;
    for v_item in select value from jsonb_array_elements(p_allocations) loop
      v_amount:=(v_item->>'amountMinor')::bigint;
      if v_amount<=0 then raise exception 'P16_INVALID_REVIEW'; end if;
      select * into v_candidate from public.payment_match_candidates where id=(v_item->>'candidateId')::uuid and transaction_id=p_transaction_id and business_id=p_business_id for update;
      if not found or v_candidate.review_status not in ('pending','deferred') then raise exception 'P16_CANDIDATE_ALREADY_REVIEWED'; end if;
      select * into v_case from public.cases where id=v_candidate.case_id and business_id=p_business_id and currency=v_transaction.currency and archived_at is null for update;
      if not found then raise exception 'P16_CASE_UNAVAILABLE'; end if;
      if v_candidate.existing_payment_id is not null and v_count=1 then
        select * into v_payment from public.payments where id=v_candidate.existing_payment_id and case_id=v_case.id for update;
        if not found or v_payment.review_status<>'pending_review' or v_payment.amount_minor<>v_amount or v_payment.currency<>v_transaction.currency then raise exception 'P16_EXISTING_PAYMENT_UNAVAILABLE'; end if;
        update public.payments set review_status='approved',reviewed_at=now(),reviewed_by=p_actor_id where id=v_payment.id returning * into v_payment;
      else
        insert into public.payments(case_id,amount,amount_minor,currency,payment_method,reference_no,review_status,reviewed_at,reviewed_by,notes)
          values(v_case.id,public.currency_minor_to_major(v_amount,v_transaction.currency),v_amount,v_transaction.currency,'bank_transfer',left(v_transaction.reference,255),'approved',now(),p_actor_id,'Approved from explainable transaction matching') returning * into v_payment;
      end if;
      insert into public.case_financial_events(case_id,event_type,amount_minor,currency,source_table,source_id,note,created_by)
        values(v_case.id,'payment_approved',v_amount,v_transaction.currency,'payments',v_payment.id,'Approved payment candidate match',p_actor_id) returning id into v_event_id;
      update public.payments set financial_event_id=v_event_id where id=v_payment.id;
      insert into public.payment_match_allocations(business_id,transaction_id,candidate_id,case_id,obligation_id,payment_id,amount_minor,currency,split_group_id,approved_by,idempotency_key)
        values(p_business_id,p_transaction_id,v_candidate.id,v_case.id,v_candidate.obligation_id,v_payment.id,v_amount,v_transaction.currency,v_split_group,p_actor_id,p_idempotency_key);
      update public.payment_match_candidates set review_status='approved',reviewed_by=p_actor_id,reviewed_at=now(),review_note=nullif(btrim(p_note),'') where id=v_candidate.id;
      insert into public.payment_match_candidate_events(candidate_id,business_id,transaction_id,event_type,from_status,to_status,actor_id,actor_role,note,metadata)
        values(v_candidate.id,p_business_id,p_transaction_id,'approved',v_candidate.review_status,'approved',p_actor_id,v_role,nullif(btrim(p_note),''),jsonb_build_object('payment_id',v_payment.id,'amount_minor',v_amount,'split',v_split_group is not null));
      perform public.financial_recalculate_case(v_case.id);
    end loop;
    insert into public.payment_match_candidate_events(candidate_id,business_id,transaction_id,event_type,from_status,to_status,actor_id,actor_role,metadata)
      select id,p_business_id,p_transaction_id,'superseded',review_status,'superseded',p_actor_id,v_role,jsonb_build_object('approved_candidate_id',p_candidate_id)
      from public.payment_match_candidates where transaction_id=p_transaction_id and review_status in ('pending','deferred');
    update public.payment_match_candidates set review_status='superseded',reviewed_at=now(),reviewed_by=p_actor_id
      where transaction_id=p_transaction_id and review_status in ('pending','deferred');
    update public.normalized_payment_transactions set queue_status='allocated',updated_at=now() where id=p_transaction_id;
    v_response:=jsonb_build_object('transaction_id',p_transaction_id,'candidate_id',p_candidate_id,'decision',p_decision,'allocation_count',v_count,'queue_status','allocated','idempotent_replay',false);
  end if;
  insert into public.payment_matching_idempotency_keys(business_id,action_scope,idempotency_key,request_hash,response,created_by)
    values(p_business_id,'review',p_idempotency_key,p_request_hash,v_response,p_actor_id);
  insert into public.audit_logs(business_id,case_id,action,actor_type,actor_id,actor_role,entity_type,entity_id,idempotency_key,metadata)
    values(p_business_id,v_candidate.case_id,'payment_matching.candidate_'||p_decision,'staff',p_actor_id,v_role,'normalized_payment_transaction',p_transaction_id::text,p_idempotency_key,
      jsonb_build_object('candidate_id',p_candidate_id,'split_authorized',p_split_authorization,'allocation_count',case when p_decision in ('approve','approve_split') then v_count else 0 end));
  return v_response;
end; $$;

create or replace function public.payment_matching_candidate_events_append_only()
returns trigger language plpgsql set search_path=public,pg_temp as $$ begin raise exception 'P16_APPEND_ONLY'; end; $$;
drop trigger if exists payment_match_candidate_events_append_only on public.payment_match_candidate_events;
create trigger payment_match_candidate_events_append_only before update or delete on public.payment_match_candidate_events
for each row execute function public.payment_matching_candidate_events_append_only();

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

commit;

-- Rollback (history-preserving): disable matching routes/workers, revoke the
-- three service RPC grants, and leave normalized transactions, candidate
-- explanations, review events, allocations, and audit records read-only.
-- After confirming no allocation references remain, a destructive rollback may
-- drop tables in reverse dependency order and then drop the three functions.
-- Prompt 17: complex payment allocation, reversal, refund and reconciliation.
-- Apply after 20260907_automatic_payment_candidate_matching.sql.
-- All financial history introduced here is append-only. Case and obligation
-- balances remain projections of immutable case_financial_events.
begin;

create table if not exists public.payment_operation_settings (
  business_id uuid primary key references public.businesses(id) on delete restrict,
  unusual_reallocation_threshold_minor bigint not null default 1000000 check (unusual_reallocation_threshold_minor > 0),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.payment_operation_settings(business_id)
select id from public.businesses on conflict (business_id) do nothing;

create table if not exists public.payment_receipts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  receipt_kind text not null default 'payment' check (receipt_kind in ('payment','credit')),
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  received_at timestamptz not null,
  source_type text not null check (source_type in ('bank_statement','accounting','manual','payment_proof','credit_note')),
  source_system text not null check (nullif(btrim(source_system),'') is not null),
  source_record_id text not null check (nullif(btrim(source_record_id),'') is not null),
  normalized_transaction_id uuid references public.normalized_payment_transactions(id) on delete restrict,
  reference text,
  payer_name text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  idempotency_key text not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (business_id,source_type,source_system,source_record_id),
  unique (business_id,idempotency_key),
  unique nulls not distinct (business_id,normalized_transaction_id),
  unique (id,business_id)
);
create index if not exists payment_receipts_business_received_idx on public.payment_receipts(business_id,received_at desc);

create table if not exists public.payment_exchange_rates (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  source_currency char(3) not null check (source_currency ~ '^[A-Z]{3}$'),
  target_currency char(3) not null check (target_currency ~ '^[A-Z]{3}$'),
  numerator bigint not null check (numerator > 0),
  denominator bigint not null check (denominator > 0),
  effective_at timestamptz not null,
  provider text not null check (nullif(btrim(provider),'') is not null),
  provider_record_id text not null check (nullif(btrim(provider_record_id),'') is not null),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence)='object'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (source_currency <> target_currency),
  unique (business_id,provider,provider_record_id),
  unique (id,business_id)
);

create table if not exists public.payment_allocation_approval_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  receipt_id uuid not null,
  operation_type text not null check (operation_type='reallocation'),
  proposed_allocations jsonb not null check (jsonb_typeof(proposed_allocations)='array' and jsonb_array_length(proposed_allocations)>0),
  reason text not null check (char_length(btrim(reason)) between 3 and 1000),
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled','consumed')),
  requested_by uuid not null references auth.users(id) on delete restrict,
  decided_by uuid references auth.users(id) on delete restrict,
  decision_reason text,
  decided_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (receipt_id,business_id) references public.payment_receipts(id,business_id) on delete restrict,
  unique (id,business_id)
);
create index if not exists payment_allocation_approvals_queue_idx on public.payment_allocation_approval_requests(business_id,status,created_at);

create table if not exists public.payment_ledger_journals (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  operation_type text not null check (operation_type in ('receipt','allocation','allocation_reversal','refund','receipt_reversal')),
  source_table text not null,
  source_id uuid not null,
  idempotency_key text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (business_id,idempotency_key),
  unique (source_table,source_id,operation_type),
  unique (id,business_id)
);

create table if not exists public.payment_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  journal_id uuid not null,
  business_id uuid not null,
  account_code text not null check (account_code in ('cash_received','unallocated_funds','credit_contra_revenue','credit_available','accounts_receivable_control','fx_clearing','refunds_payable')),
  entry_side text not null check (entry_side in ('debit','credit')),
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  foreign key (journal_id,business_id) references public.payment_ledger_journals(id,business_id) on delete restrict
);
create index if not exists payment_ledger_entries_journal_idx on public.payment_ledger_entries(journal_id,currency);

create table if not exists public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  receipt_id uuid not null,
  event_type text not null check (event_type in ('allocation','reversal')),
  reverses_allocation_id uuid references public.payment_allocations(id) on delete restrict,
  case_id text not null,
  obligation_id uuid,
  receipt_amount_minor bigint not null check (receipt_amount_minor > 0),
  receipt_currency char(3) not null check (receipt_currency ~ '^[A-Z]{3}$'),
  target_amount_minor bigint not null check (target_amount_minor > 0),
  target_currency char(3) not null check (target_currency ~ '^[A-Z]{3}$'),
  overpayment_minor bigint not null default 0 check (overpayment_minor >= 0 and overpayment_minor <= target_amount_minor),
  exchange_rate_id uuid,
  payment_id uuid references public.payments(id) on delete restrict,
  case_financial_event_id uuid not null references public.case_financial_events(id) on delete restrict,
  journal_id uuid not null references public.payment_ledger_journals(id) on delete restrict,
  reason text,
  approval_request_id uuid references public.payment_allocation_approval_requests(id) on delete restrict,
  idempotency_key text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (receipt_id,business_id) references public.payment_receipts(id,business_id) on delete restrict,
  foreign key (case_id,business_id) references public.cases(id,business_id) on delete restrict,
  foreign key (exchange_rate_id,business_id) references public.payment_exchange_rates(id,business_id) on delete restrict,
  check ((event_type='allocation' and reverses_allocation_id is null) or (event_type='reversal' and reverses_allocation_id is not null)),
  check ((receipt_currency=target_currency and exchange_rate_id is null and receipt_amount_minor=target_amount_minor) or (receipt_currency<>target_currency and exchange_rate_id is not null)),
  unique (business_id,idempotency_key),
  unique (reverses_allocation_id),
  unique (case_financial_event_id),
  unique (journal_id),
  unique (id,business_id)
);
create index if not exists payment_allocations_receipt_idx on public.payment_allocations(receipt_id,created_at,id);
create index if not exists payment_allocations_case_idx on public.payment_allocations(business_id,case_id,created_at);
create index if not exists payment_allocations_obligation_idx on public.payment_allocations(business_id,obligation_id) where obligation_id is not null;

create table if not exists public.payment_refunds (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  receipt_id uuid not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  reason text not null check (char_length(btrim(reason)) between 3 and 1000),
  journal_id uuid not null references public.payment_ledger_journals(id) on delete restrict,
  external_reference text,
  idempotency_key text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (receipt_id,business_id) references public.payment_receipts(id,business_id) on delete restrict,
  unique (business_id,idempotency_key),
  unique (journal_id),
  unique (id,business_id)
);

create table if not exists public.payment_receipt_reversals (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  receipt_id uuid not null,
  reason text not null check (char_length(btrim(reason)) between 3 and 1000),
  journal_id uuid not null references public.payment_ledger_journals(id) on delete restrict,
  idempotency_key text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (receipt_id,business_id) references public.payment_receipts(id,business_id) on delete restrict,
  unique (receipt_id),
  unique (business_id,idempotency_key),
  unique (journal_id),
  unique (id,business_id)
);

create table if not exists public.accounting_payment_operation_outbox (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  connection_id uuid not null,
  provider text not null check (provider in ('xero','quickbooks','bukku','autocount')),
  operation_type text not null check (operation_type in ('allocation','allocation_reversal','refund','receipt_reversal')),
  source_table text not null,
  source_id uuid not null,
  payload jsonb not null check (jsonb_typeof(payload)='object'),
  idempotency_key text not null,
  status text not null default 'pending' check (status in ('pending','processing','synced','failed','configuration_required')),
  attempts integer not null default 0 check (attempts>=0),
  next_attempt_at timestamptz not null default now(),
  external_record_id text,
  last_error_code text,
  last_error_message text,
  locked_at timestamptz,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (connection_id,business_id) references public.accounting_connections(id,business_id) on delete restrict,
  unique (connection_id,idempotency_key),
  unique (id,business_id)
);
create index if not exists accounting_payment_outbox_queue_idx on public.accounting_payment_operation_outbox(status,next_attempt_at,created_at) where status in ('pending','failed');

create table if not exists public.payment_operation_idempotency_keys (
  business_id uuid not null references public.businesses(id) on delete restrict,
  action_scope text not null,
  idempotency_key text not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  response jsonb not null check (jsonb_typeof(response)='object'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (business_id,action_scope,idempotency_key)
);

create or replace function public.payment_operation_append_only()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin raise exception 'P17_APPEND_ONLY'; end; $$;

do $$ declare v_table text; begin
  foreach v_table in array array['payment_receipts','payment_exchange_rates','payment_ledger_journals','payment_ledger_entries','payment_allocations','payment_refunds','payment_receipt_reversals'] loop
    execute format('drop trigger if exists %I on public.%I','p17_'||v_table||'_append_only',v_table);
    execute format('create trigger %I before update or delete on public.%I for each row execute function public.payment_operation_append_only()','p17_'||v_table||'_append_only',v_table);
  end loop;
end $$;

create or replace function public.payment_operation_create_journal(
  p_business_id uuid,p_operation_type text,p_source_table text,p_source_id uuid,p_idempotency_key text,p_entries jsonb,p_actor_id uuid
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_journal_id uuid:=gen_random_uuid(); v_entry jsonb;
begin
  if jsonb_typeof(p_entries)<>'array' or jsonb_array_length(p_entries)<2 or jsonb_array_length(p_entries)>8 then raise exception 'P17_INVALID_JOURNAL'; end if;
  if exists(
    select 1 from (
      select value->>'currency' currency,
        sum(case value->>'side' when 'debit' then (value->>'amountMinor')::bigint when 'credit' then -(value->>'amountMinor')::bigint else 1 end) balance
      from jsonb_array_elements(p_entries) group by value->>'currency'
    ) x where x.currency is null or x.currency !~ '^[A-Z]{3}$' or x.balance<>0
  ) then raise exception 'P17_UNBALANCED_JOURNAL'; end if;
  insert into public.payment_ledger_journals(id,business_id,operation_type,source_table,source_id,idempotency_key,created_by)
    values(v_journal_id,p_business_id,p_operation_type,p_source_table,p_source_id,p_idempotency_key,p_actor_id);
  for v_entry in select value from jsonb_array_elements(p_entries) loop
    if (v_entry->>'amountMinor')::bigint<=0 then raise exception 'P17_INVALID_JOURNAL'; end if;
    insert into public.payment_ledger_entries(journal_id,business_id,account_code,entry_side,amount_minor,currency)
      values(v_journal_id,p_business_id,v_entry->>'account',v_entry->>'side',(v_entry->>'amountMinor')::bigint,v_entry->>'currency');
  end loop;
  return v_journal_id;
end; $$;

create or replace view public.payment_receipt_positions with (security_invoker=true) as
with allocation_totals as (
  select a.receipt_id,
    coalesce(sum(case when a.event_type='allocation' then a.receipt_amount_minor else -a.receipt_amount_minor end),0)::bigint allocated_minor,
    coalesce(sum(case when a.event_type='allocation' then a.overpayment_minor else -a.overpayment_minor end),0)::bigint overpayment_minor
  from public.payment_allocations a group by a.receipt_id
), refund_totals as (
  select receipt_id,sum(amount_minor)::bigint refunded_minor from public.payment_refunds group by receipt_id
)
select r.id,r.business_id,r.receipt_kind,r.amount_minor,r.currency,r.received_at,r.reference,r.source_type,r.source_system,r.source_record_id,
  coalesce(a.allocated_minor,0)::bigint allocated_minor,coalesce(f.refunded_minor,0)::bigint refunded_minor,
  case when rr.id is null then greatest(r.amount_minor-coalesce(a.allocated_minor,0)-coalesce(f.refunded_minor,0),0) else 0 end::bigint unallocated_minor,
  coalesce(a.overpayment_minor,0)::bigint overpayment_minor,
  case when rr.id is not null then 'reversed'
    when coalesce(f.refunded_minor,0)=r.amount_minor then 'refunded'
    when coalesce(a.overpayment_minor,0)>0 then 'overpaid'
    when coalesce(a.allocated_minor,0)=0 then 'unallocated'
    when coalesce(a.allocated_minor,0)+coalesce(f.refunded_minor,0)<r.amount_minor then 'partially_allocated'
    else 'fully_allocated' end state
from public.payment_receipts r
left join allocation_totals a on a.receipt_id=r.id
left join refund_totals f on f.receipt_id=r.id
left join public.payment_receipt_reversals rr on rr.receipt_id=r.id;

create or replace function public.payment_operation_record_receipt(
  p_business_id uuid,p_actor_id uuid,p_receipt_kind text,p_amount_minor bigint,p_currency text,p_received_at timestamptz,
  p_source_type text,p_source_system text,p_source_record_id text,p_normalized_transaction_id uuid,p_reference text,p_payer_name text,
  p_metadata jsonb,p_idempotency_key text,p_request_hash text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_receipt public.payment_receipts; v_journal uuid; v_existing public.payment_operation_idempotency_keys;
  v_available_account text; v_debit_account text; v_response jsonb;
begin
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id);
  if v_role not in ('owner','admin','manager') then raise exception 'P17_PERMISSION_DENIED'; end if;
  select * into v_existing from public.payment_operation_idempotency_keys where business_id=p_business_id and action_scope='record_receipt' and idempotency_key=p_idempotency_key;
  if found then if v_existing.request_hash<>p_request_hash then raise exception 'P17_IDEMPOTENCY_CONFLICT'; end if; return v_existing.response||jsonb_build_object('idempotent_replay',true); end if;
  if p_amount_minor<=0 or upper(p_currency)!~'^[A-Z]{3}$' or p_receipt_kind not in ('payment','credit') then raise exception 'P17_INVALID_RECEIPT'; end if;
  insert into public.payment_receipts(business_id,receipt_kind,amount_minor,currency,received_at,source_type,source_system,source_record_id,normalized_transaction_id,reference,payer_name,metadata,idempotency_key,request_hash,created_by)
    values(p_business_id,p_receipt_kind,p_amount_minor,upper(p_currency),p_received_at,p_source_type,btrim(p_source_system),btrim(p_source_record_id),p_normalized_transaction_id,nullif(btrim(p_reference),''),nullif(btrim(p_payer_name),''),coalesce(p_metadata,'{}'),p_idempotency_key,p_request_hash,p_actor_id) returning * into v_receipt;
  v_debit_account:=case when p_receipt_kind='payment' then 'cash_received' else 'credit_contra_revenue' end;
  v_available_account:=case when p_receipt_kind='payment' then 'unallocated_funds' else 'credit_available' end;
  v_journal:=public.payment_operation_create_journal(p_business_id,'receipt','payment_receipts',v_receipt.id,'receipt:'||p_idempotency_key,
    jsonb_build_array(jsonb_build_object('account',v_debit_account,'side','debit','amountMinor',p_amount_minor,'currency',upper(p_currency)),jsonb_build_object('account',v_available_account,'side','credit','amountMinor',p_amount_minor,'currency',upper(p_currency))),p_actor_id);
  v_response:=jsonb_build_object('receipt_id',v_receipt.id,'journal_id',v_journal,'state','unallocated','idempotent_replay',false);
  insert into public.payment_operation_idempotency_keys values(p_business_id,'record_receipt',p_idempotency_key,p_request_hash,v_response,p_actor_id,now());
  insert into public.audit_logs(business_id,action,actor_type,actor_id,actor_role,entity_type,entity_id,idempotency_key,metadata)
    values(p_business_id,'payment.receipt_recorded','staff',p_actor_id,v_role,'payment_receipt',v_receipt.id::text,p_idempotency_key,jsonb_build_object('amount_minor',p_amount_minor,'currency',upper(p_currency),'receipt_kind',p_receipt_kind));
  return v_response;
end; $$;

create or replace function public.payment_operation_allocate(
  p_business_id uuid,p_receipt_id uuid,p_actor_id uuid,p_allocations jsonb,p_reason text,p_approval_request_id uuid,p_idempotency_key text,p_request_hash text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_receipt public.payment_receipts; v_position record; v_existing public.payment_operation_idempotency_keys; v_item jsonb; v_case public.cases; v_obligation public.obligations;
  v_rate public.payment_exchange_rates; v_allocation_id uuid; v_payment public.payments; v_event_id uuid; v_journal uuid; v_receipt_amount bigint; v_target_amount bigint; v_total bigint:=0; v_count integer:=0;
  v_overpayment bigint; v_available_account text; v_event_type text; v_entries jsonb; v_response jsonb; v_approval public.payment_allocation_approval_requests; v_threshold bigint; v_unusual boolean:=false;
begin
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id);
  if v_role not in ('owner','admin','manager') then raise exception 'P17_PERMISSION_DENIED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':receipt:'||p_receipt_id::text,0));
  select * into v_existing from public.payment_operation_idempotency_keys where business_id=p_business_id and action_scope='allocate' and idempotency_key=p_idempotency_key;
  if found then if v_existing.request_hash<>p_request_hash then raise exception 'P17_IDEMPOTENCY_CONFLICT'; end if; return v_existing.response||jsonb_build_object('idempotent_replay',true); end if;
  select * into v_receipt from public.payment_receipts where id=p_receipt_id and business_id=p_business_id for update;
  if not found then raise exception 'P17_RECEIPT_NOT_FOUND'; end if;
  select * into v_position from public.payment_receipt_positions where id=p_receipt_id;
  if v_position.state='reversed' then raise exception 'P17_RECEIPT_REVERSED'; end if;
  if jsonb_typeof(p_allocations)<>'array' or jsonb_array_length(p_allocations)<1 or jsonb_array_length(p_allocations)>20 then raise exception 'P17_INVALID_ALLOCATION'; end if;
  select coalesce(sum((value->>'receiptAmountMinor')::bigint),0) into v_total from jsonb_array_elements(p_allocations);
  if v_total<=0 or v_total>v_position.unallocated_minor then raise exception 'P17_AVAILABLE_AMOUNT_EXCEEDED'; end if;
  select unusual_reallocation_threshold_minor into v_threshold from public.payment_operation_settings where business_id=p_business_id;
  select exists(select 1 from jsonb_array_elements(p_allocations) proposed
    where nullif(proposed->>'exchangeRateId','') is not null or not exists(
      select 1 from public.payment_allocations original
      where original.receipt_id=p_receipt_id and original.event_type='allocation'
        and exists(select 1 from public.payment_allocations reversed where reversed.reverses_allocation_id=original.id)
        and original.case_id=proposed->>'caseId'
        and original.obligation_id is not distinct from nullif(proposed->>'obligationId','')::uuid
    )) into v_unusual;
  if exists(select 1 from public.payment_allocations where receipt_id=p_receipt_id and event_type='reversal') and (v_total>=coalesce(v_threshold,1000000) or v_unusual) then
    select * into v_approval from public.payment_allocation_approval_requests where id=p_approval_request_id and business_id=p_business_id and receipt_id=p_receipt_id and status='approved' for update;
    if not found or v_approval.proposed_allocations is distinct from p_allocations then raise exception 'P17_REALLOCATION_APPROVAL_REQUIRED'; end if;
    update public.payment_allocation_approval_requests set status='consumed',consumed_at=now() where id=v_approval.id;
  end if;
  v_available_account:=case when v_receipt.receipt_kind='payment' then 'unallocated_funds' else 'credit_available' end;
  for v_item in select value from jsonb_array_elements(p_allocations) loop
    v_receipt_amount:=(v_item->>'receiptAmountMinor')::bigint; v_target_amount:=(v_item->>'targetAmountMinor')::bigint;
    if v_receipt_amount<=0 or v_target_amount<=0 then raise exception 'P17_INVALID_ALLOCATION'; end if;
    select * into v_case from public.cases where id=v_item->>'caseId' and business_id=p_business_id and archived_at is null for update;
    if not found then raise exception 'P17_CASE_NOT_FOUND'; end if;
    if nullif(v_item->>'obligationId','') is not null then
      select o.* into v_obligation from public.obligations o join public.recovery_case_obligations r on r.obligation_id=o.id and r.case_id=v_case.id
        where o.id=(v_item->>'obligationId')::uuid and o.business_id=p_business_id and o.archived_at is null for update;
      if not found then raise exception 'P17_OBLIGATION_NOT_FOUND'; end if;
      if v_obligation.currency<>v_case.currency then raise exception 'P17_TARGET_CURRENCY_MISMATCH'; end if;
    end if;
    if v_receipt.currency=v_case.currency then
      if nullif(v_item->>'exchangeRateId','') is not null or v_receipt_amount<>v_target_amount then raise exception 'P17_SILENT_CURRENCY_CONVERSION'; end if;
      v_entries:=jsonb_build_array(jsonb_build_object('account',v_available_account,'side','debit','amountMinor',v_receipt_amount,'currency',v_receipt.currency),jsonb_build_object('account','accounts_receivable_control','side','credit','amountMinor',v_target_amount,'currency',v_case.currency));
    else
      select * into v_rate from public.payment_exchange_rates where id=nullif(v_item->>'exchangeRateId','')::uuid and business_id=p_business_id and source_currency=v_receipt.currency and target_currency=v_case.currency;
      if not found or round(v_receipt_amount::numeric*v_rate.numerator/v_rate.denominator)::bigint<>v_target_amount then raise exception 'P17_EXCHANGE_RATE_REQUIRED'; end if;
      v_entries:=jsonb_build_array(
        jsonb_build_object('account',v_available_account,'side','debit','amountMinor',v_receipt_amount,'currency',v_receipt.currency),jsonb_build_object('account','fx_clearing','side','credit','amountMinor',v_receipt_amount,'currency',v_receipt.currency),
        jsonb_build_object('account','fx_clearing','side','debit','amountMinor',v_target_amount,'currency',v_case.currency),jsonb_build_object('account','accounts_receivable_control','side','credit','amountMinor',v_target_amount,'currency',v_case.currency));
    end if;
    v_allocation_id:=gen_random_uuid(); v_overpayment:=greatest(v_target_amount-v_case.outstanding_minor,0);
    v_journal:=public.payment_operation_create_journal(p_business_id,'allocation','payment_allocations',v_allocation_id,'allocation:'||p_idempotency_key||':'||v_count,v_entries,p_actor_id);
    v_event_type:=case when v_receipt.receipt_kind='payment' then 'payment_approved' else 'adjustment_credit' end;
    if v_receipt.receipt_kind='payment' then
      insert into public.payments(case_id,amount,amount_minor,currency,payment_method,reference_no,review_status,reviewed_at,reviewed_by,notes)
        values(v_case.id,public.currency_minor_to_major(v_target_amount,v_case.currency),v_target_amount,v_case.currency,'bank_transfer',left(v_receipt.reference,255),'approved',now(),p_actor_id,'Allocated from payment receipt '||v_receipt.id) returning * into v_payment;
    else v_payment:=null; end if;
    insert into public.case_financial_events(case_id,event_type,amount_minor,currency,source_table,source_id,note,created_by)
      values(v_case.id,v_event_type,v_target_amount,v_case.currency,'payment_allocations',v_allocation_id,coalesce(nullif(btrim(p_reason),''),'Approved payment allocation'),p_actor_id) returning id into v_event_id;
    if v_payment.id is not null then update public.payments set financial_event_id=v_event_id where id=v_payment.id; end if;
    insert into public.payment_allocations(id,business_id,receipt_id,event_type,case_id,obligation_id,receipt_amount_minor,receipt_currency,target_amount_minor,target_currency,overpayment_minor,exchange_rate_id,payment_id,case_financial_event_id,journal_id,reason,approval_request_id,idempotency_key,created_by)
      values(v_allocation_id,p_business_id,p_receipt_id,'allocation',v_case.id,nullif(v_item->>'obligationId','')::uuid,v_receipt_amount,v_receipt.currency,v_target_amount,v_case.currency,v_overpayment,nullif(v_item->>'exchangeRateId','')::uuid,v_payment.id,v_event_id,v_journal,nullif(btrim(p_reason),''),p_approval_request_id,p_idempotency_key||':'||v_count,p_actor_id);
    perform public.financial_recalculate_case(v_case.id);
    insert into public.accounting_payment_operation_outbox(business_id,connection_id,provider,operation_type,source_table,source_id,payload,idempotency_key)
      select p_business_id,c.id,c.provider,'allocation','payment_allocations',v_allocation_id,jsonb_build_object('allocationId',v_allocation_id,'receiptId',p_receipt_id,'caseId',v_case.id,'obligationId',nullif(v_item->>'obligationId',''),'amountMinor',v_target_amount,'currency',v_case.currency,'receivedOn',v_receipt.received_at::date,'reference',v_receipt.reference),p_idempotency_key||':'||v_count
      from public.accounting_connections c where c.business_id=p_business_id and c.status in ('connected','error');
    v_count:=v_count+1;
  end loop;
  select * into v_position from public.payment_receipt_positions where id=p_receipt_id;
  v_response:=jsonb_build_object('receipt_id',p_receipt_id,'allocation_count',v_count,'state',v_position.state,'allocated_minor',v_position.allocated_minor,'unallocated_minor',v_position.unallocated_minor,'idempotent_replay',false);
  insert into public.payment_operation_idempotency_keys values(p_business_id,'allocate',p_idempotency_key,p_request_hash,v_response,p_actor_id,now());
  insert into public.audit_logs(business_id,action,actor_type,actor_id,actor_role,entity_type,entity_id,idempotency_key,metadata)
    values(p_business_id,'payment.allocated','staff',p_actor_id,v_role,'payment_receipt',p_receipt_id::text,p_idempotency_key,jsonb_build_object('allocation_count',v_count,'receipt_amount_minor',v_total,'reason',nullif(btrim(p_reason),'')));
  return v_response;
end; $$;

create or replace function public.payment_operation_reverse_allocation(
  p_business_id uuid,p_allocation_id uuid,p_actor_id uuid,p_reason text,p_idempotency_key text,p_request_hash text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_original public.payment_allocations; v_receipt public.payment_receipts; v_existing public.payment_operation_idempotency_keys; v_reversal_id uuid:=gen_random_uuid(); v_event_id uuid; v_journal uuid; v_entries jsonb; v_response jsonb;
begin
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id); if v_role not in ('owner','admin','manager') then raise exception 'P17_PERMISSION_DENIED'; end if;
  if char_length(btrim(coalesce(p_reason,'')))<3 then raise exception 'P17_REASON_REQUIRED'; end if;
  select * into v_existing from public.payment_operation_idempotency_keys where business_id=p_business_id and action_scope='reverse_allocation' and idempotency_key=p_idempotency_key;
  if found then if v_existing.request_hash<>p_request_hash then raise exception 'P17_IDEMPOTENCY_CONFLICT'; end if; return v_existing.response||jsonb_build_object('idempotent_replay',true); end if;
  select * into v_original from public.payment_allocations where id=p_allocation_id and business_id=p_business_id and event_type='allocation' for update;
  if not found then raise exception 'P17_ALLOCATION_NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':receipt:'||v_original.receipt_id::text,0));
  if exists(select 1 from public.payment_allocations where reverses_allocation_id=p_allocation_id) then raise exception 'P17_ALLOCATION_ALREADY_REVERSED'; end if;
  select * into v_receipt from public.payment_receipts where id=v_original.receipt_id for update;
  v_entries:=case when v_original.receipt_currency=v_original.target_currency then jsonb_build_array(
    jsonb_build_object('account','accounts_receivable_control','side','debit','amountMinor',v_original.target_amount_minor,'currency',v_original.target_currency),jsonb_build_object('account',case when v_receipt.receipt_kind='payment' then 'unallocated_funds' else 'credit_available' end,'side','credit','amountMinor',v_original.receipt_amount_minor,'currency',v_original.receipt_currency)) else jsonb_build_array(
    jsonb_build_object('account','accounts_receivable_control','side','debit','amountMinor',v_original.target_amount_minor,'currency',v_original.target_currency),jsonb_build_object('account','fx_clearing','side','credit','amountMinor',v_original.target_amount_minor,'currency',v_original.target_currency),
    jsonb_build_object('account','fx_clearing','side','debit','amountMinor',v_original.receipt_amount_minor,'currency',v_original.receipt_currency),jsonb_build_object('account',case when v_receipt.receipt_kind='payment' then 'unallocated_funds' else 'credit_available' end,'side','credit','amountMinor',v_original.receipt_amount_minor,'currency',v_original.receipt_currency)) end;
  v_journal:=public.payment_operation_create_journal(p_business_id,'allocation_reversal','payment_allocations',v_reversal_id,'allocation-reversal:'||p_idempotency_key,v_entries,p_actor_id);
  insert into public.case_financial_events(case_id,event_type,amount_minor,currency,source_table,source_id,note,created_by)
    values(v_original.case_id,case when v_receipt.receipt_kind='payment' then 'payment_reversal' else 'adjustment_debit' end,v_original.target_amount_minor,v_original.target_currency,'payment_allocations',v_reversal_id,btrim(p_reason),p_actor_id) returning id into v_event_id;
  insert into public.payment_allocations(id,business_id,receipt_id,event_type,reverses_allocation_id,case_id,obligation_id,receipt_amount_minor,receipt_currency,target_amount_minor,target_currency,overpayment_minor,exchange_rate_id,payment_id,case_financial_event_id,journal_id,reason,idempotency_key,created_by)
    values(v_reversal_id,p_business_id,v_original.receipt_id,'reversal',v_original.id,v_original.case_id,v_original.obligation_id,v_original.receipt_amount_minor,v_original.receipt_currency,v_original.target_amount_minor,v_original.target_currency,v_original.overpayment_minor,v_original.exchange_rate_id,v_original.payment_id,v_event_id,v_journal,btrim(p_reason),p_idempotency_key,p_actor_id);
  if v_original.payment_id is not null then update public.payments set review_status='reversed',reversed_at=now(),reversed_by=p_actor_id,reversal_reason=btrim(p_reason) where id=v_original.payment_id; end if;
  perform public.financial_recalculate_case(v_original.case_id);
  insert into public.accounting_payment_operation_outbox(business_id,connection_id,provider,operation_type,source_table,source_id,payload,idempotency_key)
    select p_business_id,c.id,c.provider,'allocation_reversal','payment_allocations',v_reversal_id,jsonb_build_object('reversalId',v_reversal_id,'reversesAllocationId',v_original.id,'caseId',v_original.case_id,'obligationId',v_original.obligation_id,'amountMinor',v_original.target_amount_minor,'currency',v_original.target_currency,'reason',btrim(p_reason)),p_idempotency_key
    from public.accounting_connections c where c.business_id=p_business_id and c.status in ('connected','error');
  v_response:=jsonb_build_object('reversal_id',v_reversal_id,'allocation_id',v_original.id,'receipt_id',v_original.receipt_id,'reason',btrim(p_reason),'actor_id',p_actor_id,'idempotent_replay',false);
  insert into public.payment_operation_idempotency_keys values(p_business_id,'reverse_allocation',p_idempotency_key,p_request_hash,v_response,p_actor_id,now());
  insert into public.audit_logs(business_id,case_id,action,actor_type,actor_id,actor_role,entity_type,entity_id,idempotency_key,metadata)
    values(p_business_id,v_original.case_id,'payment.allocation_reversed','staff',p_actor_id,v_role,'payment_allocation',v_original.id::text,p_idempotency_key,jsonb_build_object('reversal_id',v_reversal_id,'reason',btrim(p_reason)));
  return v_response;
end; $$;

create or replace function public.payment_operation_refund(
  p_business_id uuid,p_receipt_id uuid,p_actor_id uuid,p_amount_minor bigint,p_reason text,p_external_reference text,p_idempotency_key text,p_request_hash text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_receipt public.payment_receipts; v_position record; v_existing public.payment_operation_idempotency_keys; v_refund_id uuid:=gen_random_uuid(); v_journal uuid; v_response jsonb;
begin
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id); if v_role not in ('owner','admin','manager') then raise exception 'P17_PERMISSION_DENIED'; end if;
  if p_amount_minor<=0 or char_length(btrim(coalesce(p_reason,'')))<3 then raise exception 'P17_INVALID_REFUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':receipt:'||p_receipt_id::text,0));
  select * into v_existing from public.payment_operation_idempotency_keys where business_id=p_business_id and action_scope='refund' and idempotency_key=p_idempotency_key;
  if found then if v_existing.request_hash<>p_request_hash then raise exception 'P17_IDEMPOTENCY_CONFLICT'; end if; return v_existing.response||jsonb_build_object('idempotent_replay',true); end if;
  select * into v_receipt from public.payment_receipts where id=p_receipt_id and business_id=p_business_id and receipt_kind='payment' for update; if not found then raise exception 'P17_RECEIPT_NOT_FOUND'; end if;
  select * into v_position from public.payment_receipt_positions where id=p_receipt_id;
  if v_position.state='reversed' or p_amount_minor>v_position.unallocated_minor then raise exception 'P17_REFUND_REQUIRES_UNALLOCATED_FUNDS'; end if;
  v_journal:=public.payment_operation_create_journal(p_business_id,'refund','payment_refunds',v_refund_id,'refund:'||p_idempotency_key,jsonb_build_array(
    jsonb_build_object('account','unallocated_funds','side','debit','amountMinor',p_amount_minor,'currency',v_receipt.currency),jsonb_build_object('account','cash_received','side','credit','amountMinor',p_amount_minor,'currency',v_receipt.currency)),p_actor_id);
  insert into public.payment_refunds(id,business_id,receipt_id,amount_minor,currency,reason,journal_id,external_reference,idempotency_key,created_by)
    values(v_refund_id,p_business_id,p_receipt_id,p_amount_minor,v_receipt.currency,btrim(p_reason),v_journal,nullif(btrim(p_external_reference),''),p_idempotency_key,p_actor_id);
  insert into public.accounting_payment_operation_outbox(business_id,connection_id,provider,operation_type,source_table,source_id,payload,idempotency_key)
    select p_business_id,c.id,c.provider,'refund','payment_refunds',v_refund_id,jsonb_build_object('refundId',v_refund_id,'receiptId',p_receipt_id,'amountMinor',p_amount_minor,'currency',v_receipt.currency,'reason',btrim(p_reason),'externalReference',nullif(btrim(p_external_reference),'')),p_idempotency_key
    from public.accounting_connections c where c.business_id=p_business_id and c.status in ('connected','error');
  select * into v_position from public.payment_receipt_positions where id=p_receipt_id;
  v_response:=jsonb_build_object('refund_id',v_refund_id,'receipt_id',p_receipt_id,'state',v_position.state,'refunded_minor',v_position.refunded_minor,'unallocated_minor',v_position.unallocated_minor,'idempotent_replay',false);
  insert into public.payment_operation_idempotency_keys values(p_business_id,'refund',p_idempotency_key,p_request_hash,v_response,p_actor_id,now());
  insert into public.audit_logs(business_id,action,actor_type,actor_id,actor_role,entity_type,entity_id,idempotency_key,metadata)
    values(p_business_id,'payment.refunded','staff',p_actor_id,v_role,'payment_receipt',p_receipt_id::text,p_idempotency_key,jsonb_build_object('refund_id',v_refund_id,'amount_minor',p_amount_minor,'reason',btrim(p_reason)));
  return v_response;
end; $$;

create or replace function public.payment_operation_decide_approval(p_business_id uuid,p_request_id uuid,p_actor_id uuid,p_decision text,p_reason text)
returns public.payment_allocation_approval_requests language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_request public.payment_allocation_approval_requests;
begin
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id); if v_role not in ('owner','admin') then raise exception 'P17_APPROVAL_PERMISSION_DENIED'; end if;
  if p_decision not in ('approved','rejected') or char_length(btrim(coalesce(p_reason,'')))<3 then raise exception 'P17_INVALID_APPROVAL_DECISION'; end if;
  select * into v_request from public.payment_allocation_approval_requests where id=p_request_id and business_id=p_business_id for update;
  if not found then raise exception 'P17_APPROVAL_NOT_FOUND'; end if; if v_request.status<>'pending' then raise exception 'P17_APPROVAL_ALREADY_DECIDED'; end if;
  if v_request.requested_by=p_actor_id then raise exception 'P17_SELF_APPROVAL_FORBIDDEN'; end if;
  update public.payment_allocation_approval_requests set status=p_decision,decided_by=p_actor_id,decision_reason=btrim(p_reason),decided_at=now() where id=p_request_id returning * into v_request;
  insert into public.audit_logs(business_id,action,actor_type,actor_id,actor_role,entity_type,entity_id,metadata)
    values(p_business_id,'payment.reallocation_'||p_decision,'staff',p_actor_id,v_role,'payment_allocation_approval',p_request_id::text,jsonb_build_object('reason',btrim(p_reason),'requested_by',v_request.requested_by));
  return v_request;
end; $$;

create or replace function public.payment_operation_reverse_receipt(
  p_business_id uuid,p_receipt_id uuid,p_actor_id uuid,p_reason text,p_idempotency_key text,p_request_hash text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_receipt public.payment_receipts; v_position record; v_existing public.payment_operation_idempotency_keys; v_reversal_id uuid:=gen_random_uuid(); v_journal uuid; v_response jsonb; v_available text; v_origin text;
begin
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id); if v_role not in ('owner','admin','manager') then raise exception 'P17_PERMISSION_DENIED'; end if;
  if char_length(btrim(coalesce(p_reason,'')))<3 then raise exception 'P17_REASON_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':receipt:'||p_receipt_id::text,0));
  select * into v_existing from public.payment_operation_idempotency_keys where business_id=p_business_id and action_scope='reverse_receipt' and idempotency_key=p_idempotency_key;
  if found then if v_existing.request_hash<>p_request_hash then raise exception 'P17_IDEMPOTENCY_CONFLICT'; end if; return v_existing.response||jsonb_build_object('idempotent_replay',true); end if;
  select * into v_receipt from public.payment_receipts where id=p_receipt_id and business_id=p_business_id for update; if not found then raise exception 'P17_RECEIPT_NOT_FOUND'; end if;
  select * into v_position from public.payment_receipt_positions where id=p_receipt_id;
  if v_position.state='reversed' then raise exception 'P17_RECEIPT_ALREADY_REVERSED'; end if;
  if v_position.allocated_minor<>0 or v_position.refunded_minor<>0 then raise exception 'P17_RECEIPT_REVERSAL_REQUIRES_UNALLOCATED_FUNDS'; end if;
  v_available:=case when v_receipt.receipt_kind='payment' then 'unallocated_funds' else 'credit_available' end;
  v_origin:=case when v_receipt.receipt_kind='payment' then 'cash_received' else 'credit_contra_revenue' end;
  v_journal:=public.payment_operation_create_journal(p_business_id,'receipt_reversal','payment_receipt_reversals',v_reversal_id,'receipt-reversal:'||p_idempotency_key,jsonb_build_array(
    jsonb_build_object('account',v_available,'side','debit','amountMinor',v_receipt.amount_minor,'currency',v_receipt.currency),jsonb_build_object('account',v_origin,'side','credit','amountMinor',v_receipt.amount_minor,'currency',v_receipt.currency)),p_actor_id);
  insert into public.payment_receipt_reversals(id,business_id,receipt_id,reason,journal_id,idempotency_key,created_by)
    values(v_reversal_id,p_business_id,p_receipt_id,btrim(p_reason),v_journal,p_idempotency_key,p_actor_id);
  insert into public.accounting_payment_operation_outbox(business_id,connection_id,provider,operation_type,source_table,source_id,payload,idempotency_key)
    select p_business_id,c.id,c.provider,'receipt_reversal','payment_receipt_reversals',v_reversal_id,jsonb_build_object('reversalId',v_reversal_id,'receiptId',p_receipt_id,'amountMinor',v_receipt.amount_minor,'currency',v_receipt.currency,'reason',btrim(p_reason)),p_idempotency_key
    from public.accounting_connections c where c.business_id=p_business_id and c.status in ('connected','error');
  v_response:=jsonb_build_object('reversal_id',v_reversal_id,'receipt_id',p_receipt_id,'state','reversed','reason',btrim(p_reason),'actor_id',p_actor_id,'idempotent_replay',false);
  insert into public.payment_operation_idempotency_keys values(p_business_id,'reverse_receipt',p_idempotency_key,p_request_hash,v_response,p_actor_id,now());
  insert into public.audit_logs(business_id,action,actor_type,actor_id,actor_role,entity_type,entity_id,idempotency_key,metadata)
    values(p_business_id,'payment.receipt_reversed','staff',p_actor_id,v_role,'payment_receipt',p_receipt_id::text,p_idempotency_key,jsonb_build_object('reversal_id',v_reversal_id,'reason',btrim(p_reason)));
  return v_response;
end; $$;

create or replace function public.payment_operation_reconciliation(p_business_id uuid,p_from timestamptz,p_to timestamptz)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_result jsonb;
begin
  if not (public.has_business_permission(p_business_id,'report.read') or public.has_business_permission(p_business_id,'payment.approve')) then raise exception 'P17_PERMISSION_DENIED'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.currency),'[]'::jsonb) into v_result from (
    select p.currency,sum(p.amount_minor)::bigint imported_total,
      sum(p.allocated_minor)::bigint allocated_total,sum(p.unallocated_minor)::bigint unallocated_total,
      sum(p.refunded_minor)::bigint refunded_total,sum(case when p.state='reversed' then p.amount_minor else 0 end)::bigint reversed_total,
      coalesce((select sum(a.receipt_amount_minor)::bigint
        from public.payment_allocations a where a.business_id=p_business_id and a.receipt_currency=p.currency and a.created_at>=p_from and a.created_at<p_to
          and exists(select 1 from public.accounting_payment_operation_outbox o where o.source_id=a.id and o.status<>'synced')),0)::bigint integration_difference
    from public.payment_receipt_positions p where p.business_id=p_business_id and p.received_at>=p_from and p.received_at<p_to group by p.currency
  ) x;
  return jsonb_build_object('business_id',p_business_id,'from',p_from,'to',p_to,'currencies',v_result,'generated_at',now());
end; $$;

alter table public.payment_match_allocations
  add column if not exists payment_operation_allocation_id uuid references public.payment_allocations(id) on delete restrict;
create unique index if not exists payment_match_allocations_operation_unique
  on public.payment_match_allocations(payment_operation_allocation_id) where payment_operation_allocation_id is not null;

create or replace function public.payment_operation_capture_matched_allocation()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_transaction public.normalized_payment_transactions; v_receipt public.payment_receipts; v_case public.cases; v_payment public.payments;
  v_receipt_journal uuid; v_allocation_id uuid:=gen_random_uuid(); v_allocation_journal uuid; v_request_hash text; v_overpayment bigint;
begin
  select * into v_transaction from public.normalized_payment_transactions where id=new.transaction_id and business_id=new.business_id;
  select * into v_case from public.cases where id=new.case_id and business_id=new.business_id for update;
  select * into v_payment from public.payments where id=new.payment_id and case_id=new.case_id;
  if v_transaction is null or v_case is null or v_payment is null or v_payment.financial_event_id is null then raise exception 'P17_MATCHED_ALLOCATION_INCOMPLETE'; end if;
  v_request_hash:=encode(digest(v_transaction.id::text,'sha256'),'hex');
  select * into v_receipt from public.payment_receipts where business_id=new.business_id and normalized_transaction_id=new.transaction_id;
  if not found then
    insert into public.payment_receipts(business_id,receipt_kind,amount_minor,currency,received_at,source_type,source_system,source_record_id,normalized_transaction_id,reference,payer_name,metadata,idempotency_key,request_hash,created_by)
      values(new.business_id,'payment',v_transaction.amount_minor,v_transaction.currency,coalesce(v_transaction.occurred_at,v_transaction.created_at),v_transaction.source_type,v_transaction.source_system,v_transaction.source_record_id,v_transaction.id,v_transaction.reference,v_transaction.party_name,jsonb_build_object('payment_matching_transaction_id',v_transaction.id),'p16:'||v_transaction.id,v_request_hash,new.approved_by) returning * into v_receipt;
    v_receipt_journal:=public.payment_operation_create_journal(new.business_id,'receipt','payment_receipts',v_receipt.id,'receipt:p16:'||v_transaction.id,jsonb_build_array(
      jsonb_build_object('account','cash_received','side','debit','amountMinor',v_receipt.amount_minor,'currency',v_receipt.currency),
      jsonb_build_object('account','unallocated_funds','side','credit','amountMinor',v_receipt.amount_minor,'currency',v_receipt.currency)),new.approved_by);
  end if;
  if new.currency<>v_receipt.currency or new.currency<>v_case.currency then raise exception 'P17_MATCHED_ALLOCATION_CURRENCY_MISMATCH'; end if;
  v_overpayment:=greatest(new.amount_minor-v_case.outstanding_minor,0);
  v_allocation_journal:=public.payment_operation_create_journal(new.business_id,'allocation','payment_allocations',v_allocation_id,'allocation:p16:'||new.id,jsonb_build_array(
    jsonb_build_object('account','unallocated_funds','side','debit','amountMinor',new.amount_minor,'currency',new.currency),
    jsonb_build_object('account','accounts_receivable_control','side','credit','amountMinor',new.amount_minor,'currency',new.currency)),new.approved_by);
  insert into public.payment_allocations(id,business_id,receipt_id,event_type,case_id,obligation_id,receipt_amount_minor,receipt_currency,target_amount_minor,target_currency,overpayment_minor,payment_id,case_financial_event_id,journal_id,reason,idempotency_key,created_by)
    values(v_allocation_id,new.business_id,v_receipt.id,'allocation',new.case_id,new.obligation_id,new.amount_minor,new.currency,new.amount_minor,new.currency,v_overpayment,new.payment_id,v_payment.financial_event_id,v_allocation_journal,'Approved from explainable transaction matching','p16:'||new.id,new.approved_by);
  update public.payment_match_allocations set payment_operation_allocation_id=v_allocation_id where id=new.id;
  insert into public.accounting_payment_operation_outbox(business_id,connection_id,provider,operation_type,source_table,source_id,payload,idempotency_key)
    select new.business_id,c.id,c.provider,'allocation','payment_allocations',v_allocation_id,jsonb_build_object('allocationId',v_allocation_id,'receiptId',v_receipt.id,'caseId',new.case_id,'obligationId',new.obligation_id,'amountMinor',new.amount_minor,'currency',new.currency,'receivedOn',v_receipt.received_at::date,'reference',v_receipt.reference),'p16:'||new.id
    from public.accounting_connections c where c.business_id=new.business_id and c.status in ('connected','error');
  return new;
end; $$;
drop trigger if exists payment_operation_capture_matched_allocation on public.payment_match_allocations;
create trigger payment_operation_capture_matched_allocation after insert or update of payment_operation_allocation_id on public.payment_match_allocations
for each row when (new.payment_operation_allocation_id is null) execute function public.payment_operation_capture_matched_allocation();
-- Backfill Prompt 16 approvals into the receipt/allocation journal without
-- changing their existing case_financial_events or payment history.
update public.payment_match_allocations set payment_operation_allocation_id=null
where payment_operation_allocation_id is null;
revoke all on function public.payment_operation_capture_matched_allocation() from public,anon,authenticated;

alter table public.obligations
  add column if not exists payment_operation_base_adjustments_minor bigint;
update public.obligations set payment_operation_base_adjustments_minor=adjustments_minor
where payment_operation_base_adjustments_minor is null;
alter table public.obligations alter column payment_operation_base_adjustments_minor set not null;

create or replace function public.payment_operation_initialize_obligation_base()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if new.payment_operation_base_adjustments_minor is null then new.payment_operation_base_adjustments_minor:=new.adjustments_minor; end if;
  return new;
end; $$;
drop trigger if exists payment_operation_initialize_obligation_base on public.obligations;
create trigger payment_operation_initialize_obligation_base before insert on public.obligations
for each row execute function public.payment_operation_initialize_obligation_base();

create or replace function public.receivables_sync_case_obligations(p_case_id text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare current_case public.cases; linked_count integer; projected_due bigint; explicit_payment bigint; residual_payment bigint;
begin
  select * into current_case from public.cases where id=p_case_id for update;
  if not found then return; end if;
  select count(*) into linked_count from public.recovery_case_obligations where case_id=p_case_id;
  if linked_count=0 then return; end if;
  perform set_config('collectboss.receivables_sync','on',true);
  with credit_totals as (
    select a.obligation_id,
      coalesce(sum(case when a.event_type='allocation' then a.target_amount_minor else -a.target_amount_minor end),0)::bigint credit_minor
    from public.payment_allocations a join public.payment_receipts r on r.id=a.receipt_id
    where a.case_id=p_case_id and a.obligation_id is not null and r.receipt_kind='credit'
    group by a.obligation_id
  )
  update public.obligations o set adjustments_minor=o.payment_operation_base_adjustments_minor-coalesce(c.credit_minor,0)
  from public.recovery_case_obligations r left join credit_totals c on c.obligation_id=r.obligation_id
  where r.case_id=p_case_id and o.id=r.obligation_id
    and o.adjustments_minor is distinct from o.payment_operation_base_adjustments_minor-coalesce(c.credit_minor,0);
  if exists(select 1 from public.obligations o join public.recovery_case_obligations r on r.obligation_id=o.id where r.case_id=p_case_id and o.contractual_due_minor<0) then
    raise exception 'P17_CREDIT_EXCEEDS_OBLIGATION';
  end if;
  select coalesce(sum(o.contractual_due_minor),0) into projected_due
  from public.recovery_case_obligations r join public.obligations o on o.id=r.obligation_id
  where r.case_id=p_case_id and o.archived_at is null;
  if projected_due<>current_case.contractual_due_minor then raise exception 'Linked obligation total does not reconcile with the case ledger'; end if;
  select coalesce(sum(case when a.event_type='allocation' then a.target_amount_minor else -a.target_amount_minor end),0)::bigint
    into explicit_payment
  from public.payment_allocations a join public.payment_receipts r on r.id=a.receipt_id
  where a.case_id=p_case_id and a.obligation_id is not null and r.receipt_kind='payment';
  residual_payment:=greatest(current_case.approved_payment_minor-explicit_payment,0);
  with explicit as (
    select a.obligation_id,
      coalesce(sum(case when a.event_type='allocation' then a.target_amount_minor else -a.target_amount_minor end),0)::bigint amount_minor
    from public.payment_allocations a join public.payment_receipts pr on pr.id=a.receipt_id
    where a.case_id=p_case_id and a.obligation_id is not null and pr.receipt_kind='payment'
    group by a.obligation_id
  ), ordered as (
    select o.id,o.contractual_due_minor,least(coalesce(e.amount_minor,0),o.contractual_due_minor)::bigint explicit_minor,
      coalesce(sum(greatest(o.contractual_due_minor-least(coalesce(e.amount_minor,0),o.contractual_due_minor),0)) over (
        order by o.due_date,o.created_at,o.id rows between unbounded preceding and 1 preceding),0)::bigint prior_remaining
    from public.recovery_case_obligations r join public.obligations o on o.id=r.obligation_id
    left join explicit e on e.obligation_id=o.id where r.case_id=p_case_id and o.archived_at is null
  ), projected as (
    select id,(explicit_minor+greatest(least(residual_payment-prior_remaining,contractual_due_minor-explicit_minor),0))::bigint paid_minor from ordered
  )
  update public.obligations o set paid_minor=p.paid_minor from projected p where o.id=p.id and o.paid_minor is distinct from p.paid_minor;
end; $$;

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
grant all on public.payment_operation_settings,public.payment_receipts,public.payment_exchange_rates,public.payment_allocation_approval_requests,public.payment_ledger_journals,public.payment_ledger_entries,public.payment_allocations,public.payment_refunds,public.payment_receipt_reversals,public.accounting_payment_operation_outbox,public.payment_operation_idempotency_keys to service_role;
grant select on public.payment_receipt_positions to authenticated,service_role;

revoke all on function public.payment_operation_create_journal(uuid,text,text,uuid,text,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.payment_operation_record_receipt(uuid,uuid,text,bigint,text,timestamptz,text,text,text,uuid,text,text,jsonb,text,text) from public,anon,authenticated;
revoke all on function public.payment_operation_allocate(uuid,uuid,uuid,jsonb,text,uuid,text,text) from public,anon,authenticated;
revoke all on function public.payment_operation_reverse_allocation(uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.payment_operation_refund(uuid,uuid,uuid,bigint,text,text,text,text) from public,anon,authenticated;
revoke all on function public.payment_operation_reverse_receipt(uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.payment_operation_decide_approval(uuid,uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.payment_operation_reconciliation(uuid,timestamptz,timestamptz) from public,anon;
grant execute on function public.payment_operation_create_journal(uuid,text,text,uuid,text,jsonb,uuid) to service_role;
grant execute on function public.payment_operation_record_receipt(uuid,uuid,text,bigint,text,timestamptz,text,text,text,uuid,text,text,jsonb,text,text) to service_role;
grant execute on function public.payment_operation_allocate(uuid,uuid,uuid,jsonb,text,uuid,text,text) to service_role;
grant execute on function public.payment_operation_reverse_allocation(uuid,uuid,uuid,text,text,text) to service_role;
grant execute on function public.payment_operation_refund(uuid,uuid,uuid,bigint,text,text,text,text) to service_role;
grant execute on function public.payment_operation_reverse_receipt(uuid,uuid,uuid,text,text,text) to service_role;
grant execute on function public.payment_operation_decide_approval(uuid,uuid,uuid,text,text) to service_role;
grant execute on function public.payment_operation_reconciliation(uuid,timestamptz,timestamptz) to authenticated,service_role;

-- Prompt 19 explainable discrepancy detection. Transition, projection, queue
-- synchronization and source-change reopen functions are defined in the
-- reversible 20260910_explainable_discrepancy_detection.sql migration.
alter table public.cases add column if not exists open_discrepancy_count integer not null default 0;
alter table public.cases add column if not exists discrepancy_impacted_minor bigint not null default 0;
create table if not exists public.discrepancy_findings (
  id uuid primary key default gen_random_uuid(),business_id uuid not null references public.businesses(id) on delete restrict,
  case_id text not null references public.cases(id) on delete restrict,finding_key char(64) not null,
  category text not null,state_class text not null,severity text not null,confidence text not null,confidence_score smallint not null,
  impacted_amount_minor bigint not null default 0,currency char(3) not null,title text not null,explanation text not null,
  conflicting_values jsonb not null,source_references jsonb not null,recommended_action text not null,
  detector_version text not null,source_fingerprint char(64) not null,status text not null default 'open',status_reason text,
  deferred_until timestamptz,corrective_workflow jsonb,detected_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),status_changed_at timestamptz,status_changed_by uuid references auth.users(id),
  unique(business_id,finding_key),unique(id,business_id)
);
create table if not exists public.discrepancy_finding_events (
  id uuid primary key default gen_random_uuid(),finding_id uuid not null,business_id uuid not null,
  case_id text not null references public.cases(id) on delete restrict,event_type text not null,from_status text,to_status text not null,
  reason text,actor_type text not null,actor_id uuid references auth.users(id),source_fingerprint char(64) not null,
  metadata jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),
  foreign key(finding_id,business_id) references public.discrepancy_findings(id,business_id) on delete restrict
);
alter table public.discrepancy_findings enable row level security;
alter table public.discrepancy_finding_events enable row level security;
create policy discrepancy_findings_tenant_read on public.discrepancy_findings for select to authenticated using(public.has_business_permission(business_id,'case.read'));
create policy discrepancy_finding_events_tenant_read on public.discrepancy_finding_events for select to authenticated using(public.has_business_permission(business_id,'case.read'));
revoke all on public.discrepancy_findings,public.discrepancy_finding_events from anon;
grant select on public.discrepancy_findings,public.discrepancy_finding_events to authenticated;
grant all on public.discrepancy_findings,public.discrepancy_finding_events to service_role;
revoke all on function public.discrepancy_record_scan(uuid,text,uuid,text,jsonb) from public,anon;
revoke all on function public.discrepancy_transition(uuid,uuid,uuid,text,text,timestamptz,jsonb) from public,anon;
grant execute on function public.discrepancy_record_scan(uuid,text,uuid,text,jsonb) to authenticated,service_role;
grant execute on function public.discrepancy_transition(uuid,uuid,uuid,text,text,timestamptz,jsonb) to authenticated,service_role;

commit;

-- Rollback (history preserving): disable the payment-operation routes and
-- outbox worker, revoke the RPC grants, and leave receipts, journals, entries,
-- allocations, refunds, reversals and integration attempts read-only. Never
-- drop posted rows merely to restore old totals. A destructive rollback is
-- safe only on an empty non-production install and must drop dependants in
-- reverse order, ending with payment_receipts and payment_operation_settings.

-- Prompt 18 canonical Debt Truth Engine schema. Calculation, append-only and
-- reconciliation functions are defined in 20260909_debt_truth_engine.sql.
alter table public.cases add column if not exists debt_truth_version integer not null default 0;
alter table public.cases add column if not exists confirmed_outstanding_minor bigint not null default 0;
alter table public.cases add column if not exists disputed_balance_minor bigint not null default 0;
alter table public.cases add column if not exists unverified_balance_minor bigint not null default 0;
alter table public.cases add column if not exists total_displayed_exposure_minor bigint not null default 0;
create table if not exists public.debt_ledger_events (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete restrict,
  case_id text not null references public.cases(id) on delete restrict, event_kind text not null,
  amount_minor bigint not null check(amount_minor>0), currency char(3) not null,
  approval_status text not null, approval_authority text, requested_by uuid references auth.users(id),
  approved_by uuid references auth.users(id), approved_at timestamptz, source_table text not null,
  source_id text not null, source_version integer not null default 1, evidence_citations jsonb not null,
  reverses_event_id uuid references public.debt_ledger_events(id) on delete restrict, reason text,
  metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(),
  unique(case_id,source_table,source_id,event_kind,source_version)
);
create table if not exists public.debt_balance_versions (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete restrict,
  case_id text not null references public.cases(id) on delete restrict, version integer not null, currency char(3) not null,
  original_principal_minor bigint not null, invoiced_amount_minor bigint not null, approved_adjustments_minor bigint not null,
  approved_fees_minor bigint not null, credit_notes_minor bigint not null, confirmed_payments_minor bigint not null,
  disputed_amount_minor bigint not null, unverified_amount_minor bigint not null, unverified_credit_minor bigint not null,
  confirmed_outstanding_minor bigint not null, total_displayed_exposure_minor bigint not null, overpayment_minor bigint not null,
  source_fingerprint char(64) not null, explanation_tree jsonb not null, user_explanation text not null,
  calculated_at timestamptz not null default now(), unique(case_id,version),unique(case_id,source_fingerprint)
);
create table if not exists public.debt_ledger_reconciliation_exceptions (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete restrict,
  case_id text not null references public.cases(id) on delete restrict, run_id uuid not null,
  legacy_outstanding_minor bigint not null, canonical_exposure_minor bigint not null,difference_minor bigint not null,
  exception_code text not null,details jsonb not null default '{}'::jsonb,resolved_at timestamptz,
  resolved_by uuid references auth.users(id),created_at timestamptz not null default now(),unique(run_id,case_id,exception_code)
);
alter table public.debt_ledger_events enable row level security;
alter table public.debt_balance_versions enable row level security;
alter table public.debt_ledger_reconciliation_exceptions enable row level security;
create policy debt_ledger_events_tenant_read on public.debt_ledger_events for select to authenticated using(public.has_business_permission(business_id,'case.read'));
create policy debt_balance_versions_tenant_read on public.debt_balance_versions for select to authenticated using(public.has_business_permission(business_id,'case.read'));
create policy debt_reconciliation_exceptions_audit_read on public.debt_ledger_reconciliation_exceptions for select to authenticated using(public.has_business_permission(business_id,'audit.read'));
create or replace view public.debt_balance_versions_api with (security_invoker=true) as select
  id,business_id,case_id,version,currency,original_principal_minor::text original_principal_minor,
  invoiced_amount_minor::text invoiced_amount_minor,approved_adjustments_minor::text approved_adjustments_minor,
  approved_fees_minor::text approved_fees_minor,credit_notes_minor::text credit_notes_minor,
  confirmed_payments_minor::text confirmed_payments_minor,disputed_amount_minor::text disputed_amount_minor,
  unverified_amount_minor::text unverified_amount_minor,unverified_credit_minor::text unverified_credit_minor,
  confirmed_outstanding_minor::text confirmed_outstanding_minor,total_displayed_exposure_minor::text total_displayed_exposure_minor,
  overpayment_minor::text overpayment_minor,source_fingerprint,explanation_tree,user_explanation,calculated_at
from public.debt_balance_versions;
create or replace view public.debt_ledger_events_api with (security_invoker=true) as select
  id,business_id,case_id,event_kind,amount_minor::text amount_minor,currency,approval_status,source_table,source_id,
  source_version,evidence_citations,reverses_event_id,reason,created_at from public.debt_ledger_events;
revoke all on public.debt_balance_versions_api,public.debt_ledger_events_api from anon;
grant select on public.debt_balance_versions_api,public.debt_ledger_events_api to authenticated,service_role;

-- Prompt 20 canonical compliance guardrail structures. Enforcement functions,
-- triggers, the counsel-pending MY seed, grants, and rollback guidance are in
-- 20260910_compliance_guardrails_approval_gates.sql.
create table if not exists public.compliance_policy_versions (
  id uuid primary key default gen_random_uuid(), scope_business_id uuid references public.businesses(id) on delete cascade,
  jurisdiction text not null check(char_length(btrim(jurisdiction)) between 2 and 32),
  version text not null check(char_length(btrim(version)) between 1 and 64),
  status text not null default 'draft' check(status in ('draft','counsel_approved','retired')),
  effective_from timestamptz not null,effective_until timestamptz,rules jsonb not null check(jsonb_typeof(rules)='object'),
  counsel_validated_at timestamptz,counsel_validator_name text,counsel_validation_reference text,
  created_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now(),
  check(effective_until is null or effective_until>effective_from),
  check(status<>'counsel_approved' or (counsel_validated_at is not null and nullif(btrim(counsel_validator_name),'') is not null and nullif(btrim(counsel_validation_reference),'') is not null))
);
create unique index if not exists compliance_policy_version_scope_uidx on public.compliance_policy_versions(
  coalesce(scope_business_id,'00000000-0000-0000-0000-000000000000'::uuid),jurisdiction,version);
create index if not exists compliance_policy_effective_idx on public.compliance_policy_versions(jurisdiction,scope_business_id,effective_from desc) where status='counsel_approved';
create table if not exists public.compliance_policy_checks (
  id uuid primary key default gen_random_uuid(),business_id uuid not null references public.businesses(id) on delete restrict,
  case_id text not null references public.cases(id) on delete restrict,policy_version_id uuid not null references public.compliance_policy_versions(id) on delete restrict,
  action_kind text not null check(action_kind in ('communication','reminder','legal_action','payment_action','other')),
  channel text check(channel is null or channel in ('whatsapp','call','email','portal','other')),
  content_hash char(64) not null check(content_hash~'^[0-9a-f]{64}$'),result text not null check(result in ('allow','approval_required','prohibited')),
  required_approval text not null check(required_approval in ('automatic','agent','supervisor','legal','prohibited')),
  warnings jsonb not null default '[]'::jsonb check(jsonb_typeof(warnings)='array'),signals jsonb not null default '[]'::jsonb check(jsonb_typeof(signals)='array'),
  approval_state text not null check(approval_state in ('approved','pending','rejected','invalidated','prohibited')),
  requested_by uuid references auth.users(id) on delete set null,approved_by uuid references auth.users(id) on delete restrict,
  approved_at timestamptz,approval_note text,bypassed boolean not null default false,bypass_reason text,expires_at timestamptz not null,
  final_action text,executed_at timestamptz,invalidated_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  check(approval_state<>'approved' or approved_at is not null),check(not bypassed or (approved_by is not null and char_length(btrim(bypass_reason)) between 10 and 1000)),
  check(expires_at>created_at)
);
create index if not exists compliance_policy_checks_case_idx on public.compliance_policy_checks(business_id,case_id,created_at desc);
create index if not exists compliance_policy_checks_pending_idx on public.compliance_policy_checks(business_id,required_approval,created_at) where approval_state='pending';
create table if not exists public.compliance_case_holds (
  id uuid primary key default gen_random_uuid(),business_id uuid not null references public.businesses(id) on delete restrict,
  case_id text not null references public.cases(id) on delete restrict,
  category text not null check(category in ('identity_theft','paid_in_full_dispute','legal_representation','serious_complaint','vulnerability','bereavement','wrong_party')),
  source_check_id uuid references public.compliance_policy_checks(id) on delete restrict,action_item_id uuid references public.action_centre_items(id) on delete restrict,
  status text not null default 'active' check(status in ('active','resolved')),detail text not null check(char_length(btrim(detail)) between 3 and 1000),
  owner_id uuid not null references auth.users(id) on delete restrict,created_by uuid references auth.users(id) on delete set null,
  resolved_by uuid references auth.users(id) on delete restrict,resolution_note text,created_at timestamptz not null default now(),resolved_at timestamptz,
  check((status='resolved')=(resolved_at is not null)),check(status<>'resolved' or (resolved_by is not null and char_length(btrim(resolution_note)) between 3 and 1000))
);
create unique index if not exists compliance_case_holds_active_uidx on public.compliance_case_holds(business_id,case_id,category) where status='active';
alter table public.communication_activities add column if not exists policy_check_id uuid references public.compliance_policy_checks(id) on delete restrict;
alter table public.communication_activities add column if not exists policy_version_id uuid references public.compliance_policy_versions(id) on delete restrict;
alter table public.communication_activities add column if not exists policy_result text not null default 'not_applicable' check(policy_result in ('not_applicable','allow','approval_required','prohibited'));
alter table public.communication_activities add column if not exists policy_content_hash char(64);
alter table public.scheduled_email_followups add column if not exists policy_check_id uuid references public.compliance_policy_checks(id) on delete restrict;
alter table public.scheduled_email_followups add column if not exists policy_content_hash char(64);
alter table public.compliance_policy_versions enable row level security;
alter table public.compliance_policy_checks enable row level security;
alter table public.compliance_case_holds enable row level security;
create policy compliance_policy_versions_tenant_read on public.compliance_policy_versions for select to authenticated using(scope_business_id is null or public.has_business_permission(scope_business_id,'case.read'));
create policy compliance_policy_checks_tenant_read on public.compliance_policy_checks for select to authenticated using(public.has_business_permission(business_id,'case.read'));
create policy compliance_case_holds_tenant_read on public.compliance_case_holds for select to authenticated using(public.has_business_permission(business_id,'case.read'));
grant select on public.compliance_policy_versions,public.compliance_policy_checks,public.compliance_case_holds to authenticated;
grant all on public.compliance_policy_versions,public.compliance_policy_checks,public.compliance_case_holds to service_role;

-- Prompt 21 enterprise security declarations. Trigger/function bodies and the
-- ordered backfill are in 20260910_enterprise_security_hardening.sql.
alter table public.public_access_tokens
  add column if not exists business_id uuid references public.businesses(id) on delete restrict;
create index if not exists public_access_tokens_business_active_idx
  on public.public_access_tokens(business_id,expires_at)
  where revoked_at is null and consumed_at is null;

create table if not exists public.security_rate_limit_buckets(
  scope text not null check(char_length(scope) between 1 and 100),
  key_hash char(64) not null check(key_hash ~ '^[0-9a-f]{64}$'),
  window_expires_at timestamptz not null,
  request_count integer not null check(request_count>0),
  blocked_until timestamptz,
  last_seen_at timestamptz not null default now(),
  primary key(scope,key_hash)
);
alter table public.security_rate_limit_buckets enable row level security;
revoke all on table public.security_rate_limit_buckets from public,anon,authenticated;
grant all on table public.security_rate_limit_buckets to service_role;

alter table public.audit_logs
  add column if not exists hash_version smallint,
  add column if not exists previous_event_hash char(64),
  add column if not exists event_hash char(64);
create unique index if not exists audit_logs_event_hash_unique
  on public.audit_logs(business_id,event_hash) where event_hash is not null;

insert into storage.buckets(id,name,public) values
  ('evidence-files','evidence-files',false),('payment-proofs','payment-proofs',false),
  ('receiving-account-qr','receiving-account-qr',false),('dispute-evidence','dispute-evidence',false),
  ('transaction-evidence','transaction-evidence',false)
on conflict(id) do update set public=false;
drop policy if exists "evidence_files_owner_read" on storage.objects;
drop policy if exists "evidence_files_owner_select" on storage.objects;
drop policy if exists "payment_proofs_owner_read" on storage.objects;

-- Prompt 22 production integration recovery. Atomic worker/replay functions
-- and rollback details are in 20260911_production_integrations_failure_recovery.sql.
create table if not exists public.integration_jobs(
  id uuid primary key default gen_random_uuid(),business_id uuid references public.businesses(id) on delete cascade,
  provider text not null check(provider in('stripe','resend','xero','quickbooks','bukku','autocount')),
  job_type text not null check(job_type in('stripe_event_replay','email_delivery','accounting_sync','accounting_webhook')),
  resource_id text not null,deduplication_key char(64) not null unique check(deduplication_key~'^[0-9a-f]{64}$'),
  payload jsonb not null default '{}'::jsonb check(jsonb_typeof(payload)='object'),
  status text not null default 'pending' check(status in('pending','processing','retry_scheduled','succeeded','dead_letter','cancelled')),
  attempts integer not null default 0 check(attempts between 0 and 100),max_attempts integer not null default 8 check(max_attempts between 1 and 20),
  next_attempt_at timestamptz not null default now(),lease_expires_at timestamptz,last_error_code text,last_error_message text,
  created_by uuid references auth.users(id) on delete set null,last_replayed_by uuid references auth.users(id) on delete set null,
  last_replayed_at timestamptz,completed_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  check(char_length(resource_id) between 1 and 500),check(last_error_message is null or char_length(last_error_message)<=1000),
  check(business_id is not null or provider='stripe')
);
create index if not exists integration_jobs_ready_idx on public.integration_jobs(next_attempt_at,created_at) where status in('pending','retry_scheduled');
create index if not exists integration_jobs_tenant_idx on public.integration_jobs(business_id,status,created_at desc) where business_id is not null;
create table if not exists public.integration_health(
  id uuid primary key default gen_random_uuid(),business_id uuid not null references public.businesses(id) on delete cascade,
  provider text not null check(provider in('stripe','resend','xero','quickbooks','bukku','autocount')),
  status text not null default 'unknown' check(status in('unknown','healthy','degraded','action_required','outage','disconnected')),
  last_checked_at timestamptz,last_success_at timestamptz,last_failure_at timestamptz,consecutive_failures integer not null default 0 check(consecutive_failures>=0),
  error_code text,actionable_message text,metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata)='object'),updated_at timestamptz not null default now(),
  unique(business_id,provider),check(actionable_message is null or char_length(actionable_message)<=500)
);
create table if not exists public.email_suppressions(
  id uuid primary key default gen_random_uuid(),business_id uuid not null references public.businesses(id) on delete cascade,
  recipient_hash char(64) not null check(recipient_hash~'^[0-9a-f]{64}$'),masked_recipient text not null,
  reason text not null check(reason in('bounce','complaint','provider_suppression','manual','invalid')),source_event_id text,
  active boolean not null default true,created_at timestamptz not null default now(),lifted_at timestamptz,lifted_by uuid references auth.users(id) on delete set null,
  unique(business_id,recipient_hash)
);
create index if not exists email_suppressions_active_idx on public.email_suppressions(business_id,recipient_hash) where active;
alter table public.integration_jobs enable row level security;
alter table public.integration_health enable row level security;
alter table public.email_suppressions enable row level security;
drop policy if exists integration_jobs_tenant_read on public.integration_jobs;
create policy integration_jobs_tenant_read on public.integration_jobs for select to authenticated using(business_id is not null and public.has_business_permission(business_id,'settings.sensitive.manage'));
drop policy if exists integration_health_tenant_read on public.integration_health;
create policy integration_health_tenant_read on public.integration_health for select to authenticated using(public.has_business_permission(business_id,'settings.sensitive.manage'));
drop policy if exists email_suppressions_tenant_read on public.email_suppressions;
create policy email_suppressions_tenant_read on public.email_suppressions for select to authenticated using(public.has_business_permission(business_id,'communication.manage'));
alter table public.billing_events add column if not exists status text not null default 'pending',add column if not exists attempts integer not null default 0,
  add column if not exists next_attempt_at timestamptz not null default now(),add column if not exists event_created_at timestamptz,
  add column if not exists processed_at timestamptz,add column if not exists last_error_code text,add column if not exists last_error_message text;
alter table public.accounting_webhook_events add column if not exists business_id uuid references public.businesses(id) on delete cascade,
  add column if not exists connection_id uuid references public.accounting_connections(id) on delete cascade,
  add column if not exists next_attempt_at timestamptz not null default now(),add column if not exists last_attempt_at timestamptz,add column if not exists dead_lettered_at timestamptz;
alter table public.email_webhook_events add column if not exists status text not null default 'processing',add column if not exists attempts integer not null default 1,
  add column if not exists last_error_code text,add column if not exists last_error_message text,add column if not exists event_created_at timestamptz;
alter table public.billing_events drop constraint if exists billing_events_status_check;
alter table public.billing_events add constraint billing_events_status_check check(status in('pending','processing','retry_scheduled','succeeded','dead_letter'));
alter table public.accounting_webhook_events drop constraint if exists accounting_webhook_events_status_check;
update public.accounting_webhook_events set status='retry_scheduled',next_attempt_at=now() where status='failed';
alter table public.accounting_webhook_events add constraint accounting_webhook_events_status_check check(status in('pending','processing','retry_scheduled','processed','dead_letter'));
alter table public.email_webhook_events drop constraint if exists email_webhook_events_status_check;
alter table public.email_webhook_events add constraint email_webhook_events_status_check check(status in('processing','processed','ignored','retry_scheduled','dead_letter'));
alter table public.accounting_payment_operation_outbox drop constraint if exists accounting_payment_operation_outbox_status_check;
alter table public.accounting_payment_operation_outbox add constraint accounting_payment_operation_outbox_status_check check(status in('pending','processing','synced','failed','configuration_required','dead_letter'));
create or replace function public.integration_claim_jobs(p_limit integer default 25) returns setof public.integration_jobs
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'service role required';end if;
  return query with candidates as(select j.id from public.integration_jobs j where
    (j.status in('pending','retry_scheduled') and j.next_attempt_at<=now()) or (j.status='processing' and j.lease_expires_at<now())
    order by j.next_attempt_at,j.created_at for update skip locked limit greatest(1,least(coalesce(p_limit,25),100)))
  update public.integration_jobs j set status='processing',attempts=j.attempts+1,lease_expires_at=now()+interval '5 minutes',updated_at=now()
  from candidates c where j.id=c.id returning j.*;
end $$;
create or replace function public.integration_finish_job(p_job_id uuid,p_succeeded boolean,p_error_code text default null,p_error_message text default null)
returns public.integration_jobs language plpgsql security definer set search_path=public,pg_temp as $$
declare v_job public.integration_jobs;begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'service role required';end if;
  select * into v_job from public.integration_jobs where id=p_job_id for update;
  if not found or v_job.status<>'processing' then raise exception 'job is not processing';end if;
  update public.integration_jobs set status=case when p_succeeded then 'succeeded' when attempts>=max_attempts then 'dead_letter' else 'retry_scheduled' end,
    next_attempt_at=case when p_succeeded or attempts>=max_attempts then next_attempt_at else now()+least(interval '24 hours',interval '1 minute'*power(2,least(attempts,10))) end,
    lease_expires_at=null,last_error_code=case when p_succeeded then null else left(coalesce(p_error_code,'INTEGRATION_FAILURE'),100) end,
    last_error_message=case when p_succeeded then null else left(coalesce(p_error_message,'Integration operation failed.'),1000) end,
    completed_at=case when p_succeeded or attempts>=max_attempts then now() else null end,updated_at=now() where id=p_job_id returning * into v_job;return v_job;
end $$;
create or replace function public.integration_replay_job(p_job_id uuid,p_business_id uuid,p_actor_id uuid)
returns public.integration_jobs language plpgsql security definer set search_path=public,pg_temp as $$
declare v_job public.integration_jobs;begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'service role required';end if;
  update public.integration_jobs set status='pending',attempts=0,next_attempt_at=now(),lease_expires_at=null,last_error_code=null,last_error_message=null,
    completed_at=null,last_replayed_by=p_actor_id,last_replayed_at=now(),updated_at=now()
  where id=p_job_id and business_id=p_business_id and status in('retry_scheduled','dead_letter') returning * into v_job;
  if not found then raise exception 'replayable job not found';end if;return v_job;
end $$;
create or replace function public.billing_claim_event(p_stripe_event_id text,p_event_type text,p_event_created_at timestamptz default null)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare v_inserted integer;v_processed boolean;v_status text;v_attempts integer;v_next_attempt_at timestamptz;v_event_type text;begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'service role required';end if;
  insert into public.billing_events(stripe_event_id,event_type,processed,status,attempts,next_attempt_at,event_created_at,metadata)
  values(p_stripe_event_id,p_event_type,false,'processing',1,now()+interval '5 minutes',p_event_created_at,
    jsonb_build_object('received_at',now(),'stripe_event_created_at',p_event_created_at)) on conflict(stripe_event_id) do nothing;
  get diagnostics v_inserted=row_count;if v_inserted=1 then return 'new';end if;
  select processed,status,attempts,next_attempt_at,event_type into v_processed,v_status,v_attempts,v_next_attempt_at,v_event_type
  from public.billing_events where stripe_event_id=p_stripe_event_id for update;
  if not found then raise exception 'billing event claim disappeared';end if;
  if v_event_type<>p_event_type then raise exception 'billing event type mismatch';end if;
  if v_processed or v_status in('succeeded','dead_letter') then return 'done';end if;
  if v_status in('processing','retry_scheduled') and v_next_attempt_at>now() then return 'busy';end if;
  update public.billing_events set status='processing',attempts=v_attempts+1,next_attempt_at=now()+interval '5 minutes',
    last_error_code=null,last_error_message=null where stripe_event_id=p_stripe_event_id;return 'retry';
end $$;
create or replace function public.billing_apply_subscription_state(
  p_business_id uuid,p_customer_id text,p_subscription_id text,p_price_id text,p_plan_slug text,p_status text,
  p_period_start timestamptz,p_period_end timestamptz,p_cancel_at_period_end boolean,p_extra_seats integer default 0) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_effective_slug text;v_plan record;v_seats integer;v_team_limit integer;begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'service role required';end if;
  if not exists(select 1 from public.businesses where id=p_business_id) then raise exception 'billing business not found';end if;
  if p_status not in('active','trialing','past_due','canceled','incomplete','incomplete_expired','unpaid','paused') then raise exception 'invalid subscription status';end if;
  if coalesce(p_extra_seats,0) not between 0 and 100 then raise exception 'invalid extra seat quantity';end if;
  v_effective_slug:=case when p_status in('active','trialing') then p_plan_slug else 'free' end;
  select * into v_plan from public.plans where slug=v_effective_slug;if not found then raise exception 'billing plan not found';end if;
  v_seats:=case when v_effective_slug<>'free' then coalesce(p_extra_seats,0) else 0 end;
  v_team_limit:=case when v_plan.team_member_limit=-1 then -1 else v_plan.team_member_limit+v_seats end;
  insert into public.subscriptions(business_id,stripe_customer_id,stripe_subscription_id,stripe_price_id,plan_slug,status,current_period_start,current_period_end,cancel_at_period_end,extra_seats)
  values(p_business_id,p_customer_id,p_subscription_id,p_price_id,p_plan_slug,p_status,p_period_start,p_period_end,p_cancel_at_period_end,coalesce(p_extra_seats,0))
  on conflict(business_id) do update set stripe_customer_id=excluded.stripe_customer_id,stripe_subscription_id=excluded.stripe_subscription_id,stripe_price_id=excluded.stripe_price_id,
    plan_slug=excluded.plan_slug,status=excluded.status,current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end,
    cancel_at_period_end=excluded.cancel_at_period_end,extra_seats=excluded.extra_seats,updated_at=now();
  insert into public.entitlements(business_id,plan_slug,case_limit,evidence_pack_limit,team_member_limit,extra_seats,payment_lock_enabled,formal_demand_enabled,lawyer_referral_enabled,reports_enabled)
  values(p_business_id,v_effective_slug,v_plan.case_limit,v_plan.evidence_pack_limit,v_team_limit,v_seats,v_plan.payment_lock_enabled,v_plan.formal_demand_enabled,v_plan.lawyer_referral_enabled,v_plan.reports_enabled)
  on conflict(business_id) do update set plan_slug=excluded.plan_slug,case_limit=excluded.case_limit,evidence_pack_limit=excluded.evidence_pack_limit,
    team_member_limit=excluded.team_member_limit,extra_seats=excluded.extra_seats,payment_lock_enabled=excluded.payment_lock_enabled,formal_demand_enabled=excluded.formal_demand_enabled,
    lawyer_referral_enabled=excluded.lawyer_referral_enabled,reports_enabled=excluded.reports_enabled,updated_at=now();
end $$;
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
revoke all on function public.billing_apply_subscription_state(uuid,text,text,text,text,text,timestamptz,timestamptz,boolean,integer) from public,anon,authenticated;
grant execute on function public.billing_apply_subscription_state(uuid,text,text,text,text,text,timestamptz,timestamptz,boolean,integer) to service_role;

-- Pocket workspace product ownership. Existing businesses without a row are Main.
create table if not exists public.workspace_product_states(
  business_id uuid primary key references public.businesses(id) on delete cascade,
  product_type text not null check(product_type in('main','pocket')),
  lifecycle_state text not null default 'active' check(lifecycle_state in('active','grace_read_only','suspended')),
  activated_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
create table if not exists public.workspace_product_state_events(
  id uuid primary key default gen_random_uuid(),business_id uuid not null references public.businesses(id) on delete cascade,
  from_product_type text check(from_product_type is null or from_product_type in('main','pocket')),
  to_product_type text not null check(to_product_type in('main','pocket')),
  from_lifecycle_state text check(from_lifecycle_state is null or from_lifecycle_state in('active','grace_read_only','suspended')),
  to_lifecycle_state text not null check(to_lifecycle_state in('active','grace_read_only','suspended')),
  actor_id uuid references auth.users(id) on delete set null,created_at timestamptz not null default now()
);
create index if not exists workspace_product_state_events_business_created_idx on public.workspace_product_state_events(business_id,created_at desc);
create or replace function public.capture_workspace_product_state_event() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_op='INSERT' then
    insert into public.workspace_product_state_events(business_id,from_product_type,to_product_type,from_lifecycle_state,to_lifecycle_state,actor_id)
    values(new.business_id,null,new.product_type,null,new.lifecycle_state,coalesce(new.updated_by,auth.uid()));
  elsif old.product_type is distinct from new.product_type or old.lifecycle_state is distinct from new.lifecycle_state then
    insert into public.workspace_product_state_events(business_id,from_product_type,to_product_type,from_lifecycle_state,to_lifecycle_state,actor_id)
    values(new.business_id,old.product_type,new.product_type,old.lifecycle_state,new.lifecycle_state,coalesce(new.updated_by,auth.uid()));
  end if;new.updated_at:=now();return new;
end $$;
drop trigger if exists workspace_product_state_audit on public.workspace_product_states;
create trigger workspace_product_state_audit before insert or update on public.workspace_product_states
for each row execute function public.capture_workspace_product_state_event();
alter table public.workspace_product_states enable row level security;
alter table public.workspace_product_state_events enable row level security;
drop policy if exists workspace_product_states_tenant_read on public.workspace_product_states;
create policy workspace_product_states_tenant_read on public.workspace_product_states for select to authenticated using(public.has_business_permission(business_id,'case.read'));
drop policy if exists workspace_product_state_events_tenant_read on public.workspace_product_state_events;
create policy workspace_product_state_events_tenant_read on public.workspace_product_state_events for select to authenticated using(public.has_business_permission(business_id,'case.read'));
revoke all on public.workspace_product_states,public.workspace_product_state_events from anon;
revoke insert,update,delete on public.workspace_product_states,public.workspace_product_state_events from authenticated;
grant select on public.workspace_product_states,public.workspace_product_state_events to authenticated;
grant all on public.workspace_product_states,public.workspace_product_state_events to service_role;
create or replace function public.my_workspace_context()
returns table(business_id uuid,workspace_name text,product_type text,lifecycle_state text,plan_slug text,subscription_status text)
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_business_id uuid;begin
  if auth.uid() is null then return;end if;v_business_id:=public.my_business_id();if v_business_id is null then return;end if;
  return query select b.id,b.business_name,coalesce(w.product_type,'main'),coalesce(w.lifecycle_state,'active'),
    coalesce(s.plan_slug,e.plan_slug,'free'),s.status from public.businesses b
    left join public.workspace_product_states w on w.business_id=b.id left join public.subscriptions s on s.business_id=b.id
    left join public.entitlements e on e.business_id=b.id where b.id=v_business_id;
end $$;
revoke all on function public.my_workspace_context() from public,anon;
grant execute on function public.my_workspace_context() to authenticated,service_role;

-- Pocket commercial policy. Canonical copy of migration 20260913.
-- Pocket commercial policy, entitlements, billing lifecycle, and atomic usage enforcement.
-- Additive proposal only: review and apply after 20260912_workspace_product_state.sql.

create table if not exists public.commercial_offers (
  offer_key text primary key,
  product_type text not null check (product_type in ('main','pocket')),
  offer_kind text not null check (offer_kind in ('base','addon','cycle_pack')),
  amount_minor bigint not null check (amount_minor >= 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  interval_kind text not null check (interval_kind in ('month','year','cycle')),
  recurring boolean not null,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.commercial_offers(offer_key,product_type,offer_kind,amount_minor,currency,interval_kind,recurring,metadata)
values
  ('pocket_monthly','pocket','base',990,'MYR','month',true,'{"capability_set":"pocket_base"}'),
  ('pocket_annual','pocket','base',9900,'MYR','year',true,'{"capability_set":"pocket_base"}'),
  ('pocket_invoice_addon','pocket','addon',1000,'MYR','month',true,'{"invoice_units":30}'),
  ('pocket_extra_invoice_pack','pocket','cycle_pack',1000,'MYR','cycle',false,'{"invoice_units":30,"maximum_per_cycle":1}')
on conflict(offer_key) do update set
  product_type=excluded.product_type,offer_kind=excluded.offer_kind,amount_minor=excluded.amount_minor,
  currency=excluded.currency,interval_kind=excluded.interval_kind,recurring=excluded.recurring,
  metadata=excluded.metadata,updated_at=now();

create table if not exists public.workspace_commercial_states (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  product_type text not null check (product_type='pocket'),
  base_offer_key text references public.commercial_offers(offer_key) on delete restrict,
  lifecycle_state text not null check (lifecycle_state in (
    'trialing','active','past_due','payment_retry','cancelled_at_period_end','cancelled','grace_read_only','suspended'
  )),
  cycle_start timestamptz,
  cycle_end timestamptz,
  grace_until timestamptz,
  read_only_at timestamptz,
  stripe_customer_id text unique,
  last_provider_event_id text,
  last_provider_event_created_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cycle_end is null or cycle_start is not null),
  check (cycle_end is null or cycle_end > cycle_start)
);

create table if not exists public.workspace_subscription_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  offer_key text not null references public.commercial_offers(offer_key) on delete restrict,
  provider_subscription_id text not null,
  provider_item_id text not null,
  provider_price_id text not null,
  provider_status text not null,
  period_start timestamptz,
  period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  last_provider_event_id text not null,
  last_provider_event_created_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider_item_id),
  unique(business_id,offer_key,provider_subscription_id)
);
create index if not exists workspace_subscription_items_business_idx
  on public.workspace_subscription_items(business_id,offer_key,period_end desc);

create table if not exists public.workspace_cycle_purchases (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  offer_key text not null references public.commercial_offers(offer_key) on delete restrict,
  cycle_start timestamptz not null,
  cycle_end timestamptz not null,
  checkout_session_id text not null unique,
  payment_intent_id text,
  provider_event_id text not null unique,
  provider_event_created_at timestamptz not null,
  purchased_by uuid references auth.users(id) on delete set null,
  purchased_at timestamptz not null default now(),
  unique(business_id,offer_key,cycle_start)
);

create table if not exists public.workspace_usage_counters (
  business_id uuid not null references public.businesses(id) on delete cascade,
  capability_key text not null,
  cycle_start timestamptz not null,
  cycle_end timestamptz not null,
  used_units integer not null default 0 check (used_units >= 0),
  updated_at timestamptz not null default now(),
  primary key(business_id,capability_key,cycle_start)
);

create table if not exists public.workspace_usage_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  capability_key text not null,
  cycle_start timestamptz not null,
  operation_key text not null,
  units integer not null default 1 check (units > 0),
  actor_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now(),
  unique(business_id,capability_key,cycle_start,operation_key)
);

create table if not exists public.workspace_checkout_reservations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete restrict,
  offer_key text not null references public.commercial_offers(offer_key) on delete restrict,
  idempotency_key text not null,
  cycle_start timestamptz,
  cycle_end timestamptz,
  checkout_session_id text unique,
  status text not null default 'pending' check(status in('pending','completed','expired')),
  expires_at timestamptz not null default now()+interval '30 minutes',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(business_id,idempotency_key)
);
create unique index if not exists pocket_cycle_pack_live_reservation_uidx
  on public.workspace_checkout_reservations(business_id,offer_key,cycle_start)
  where offer_key='pocket_extra_invoice_pack' and status in('pending','completed');
create unique index if not exists pocket_base_live_reservation_uidx
  on public.workspace_checkout_reservations(business_id)
  where offer_key in('pocket_monthly','pocket_annual') and status='pending';

create table if not exists public.pocket_active_debt_counters (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  active_count integer not null default 0 check(active_count between 0 and 100),
  updated_at timestamptz not null default now()
);

create or replace function public.pocket_actor_belongs_to_business(p_business_id uuid,p_actor_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.businesses where id=p_business_id and owner_id=p_actor_id)
    or exists(select 1 from public.business_memberships
      where business_id=p_business_id and user_id=p_actor_id and status='active')
$$;

create or replace function public.pocket_is_workspace(p_business_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.workspace_product_states
    where business_id=p_business_id and product_type='pocket')
$$;

create or replace function public.pocket_capability_limit(
  p_business_id uuid,p_capability_key text,p_cycle_start timestamptz,p_cycle_end timestamptz
) returns integer language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_addon boolean; v_pack boolean;
begin
  if p_capability_key='pocket.receipt.process' then return 100; end if;
  if p_capability_key='pocket.invoice.create' then
    select exists(select 1 from public.workspace_subscription_items
      where business_id=p_business_id and offer_key='pocket_invoice_addon'
        and provider_status in('active','trialing') and coalesce(period_end,p_cycle_end)>=p_cycle_start)
      into v_addon;
    if not v_addon then return 0; end if;
    select exists(select 1 from public.workspace_cycle_purchases
      where business_id=p_business_id and offer_key='pocket_extra_invoice_pack' and cycle_start=p_cycle_start)
      into v_pack;
    return case when v_pack then 60 else 30 end;
  end if;
  return null;
end $$;

create or replace function public.pocket_authorize_capability_internal(
  p_business_id uuid,p_actor_id uuid,p_capability_key text,p_operation_key text default null,
  p_consume boolean default false,p_metadata jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_state public.workspace_commercial_states; v_limit integer; v_used integer:=0; v_inserted uuid;
begin
  if not public.pocket_is_workspace(p_business_id) then raise exception 'PLAN_NOT_AUTHORISED'; end if;
  select * into v_state from public.workspace_commercial_states where business_id=p_business_id for update;
  if not found or v_state.base_offer_key not in('pocket_monthly','pocket_annual') then raise exception 'PLAN_NOT_AUTHORISED'; end if;
  if p_capability_key in('pocket.data.read','pocket.data.export') then
    return jsonb_build_object('allowed',true,'limit',null,'used',null,'remaining',null,'readOnly',v_state.lifecycle_state not in('trialing','active','cancelled_at_period_end','payment_retry'));
  end if;
  if p_capability_key not in('pocket.customer.manage','pocket.debt.manage','pocket.payment.record','pocket.receipt.process',
    'pocket.invoice.create','pocket.reminder.manage','pocket.report.basic','pocket.workspace.user') then
    raise exception 'PLAN_NOT_AUTHORISED';
  end if;
  if v_state.lifecycle_state='past_due' then raise exception 'SUBSCRIPTION_PAST_DUE'; end if;
  if v_state.lifecycle_state='payment_retry' and v_state.grace_until is not null and now()>v_state.grace_until then raise exception 'READ_ONLY_MODE'; end if;
  if v_state.lifecycle_state in('cancelled','grace_read_only','suspended') then raise exception 'READ_ONLY_MODE'; end if;
  if v_state.cycle_start is null or v_state.cycle_end is null then raise exception 'PLAN_NOT_AUTHORISED'; end if;
  v_limit:=public.pocket_capability_limit(p_business_id,p_capability_key,v_state.cycle_start,v_state.cycle_end);
  if p_capability_key='pocket.invoice.create' and coalesce(v_limit,0)=0 then raise exception 'ADD_ON_REQUIRED'; end if;
  if v_limit is null then return jsonb_build_object('allowed',true,'limit',null,'used',null,'remaining',null,'readOnly',false); end if;
  insert into public.workspace_usage_counters(business_id,capability_key,cycle_start,cycle_end)
    values(p_business_id,p_capability_key,v_state.cycle_start,v_state.cycle_end) on conflict do nothing;
  select used_units into v_used from public.workspace_usage_counters
    where business_id=p_business_id and capability_key=p_capability_key and cycle_start=v_state.cycle_start for update;
  if p_consume then
    if nullif(btrim(p_operation_key),'') is null then raise exception 'PLAN_NOT_AUTHORISED'; end if;
    if exists(select 1 from public.workspace_usage_events where business_id=p_business_id
      and capability_key=p_capability_key and cycle_start=v_state.cycle_start and operation_key=p_operation_key) then
      return jsonb_build_object('allowed',true,'limit',v_limit,'used',v_used,'remaining',greatest(v_limit-v_used,0),'readOnly',false,'duplicate',true);
    end if;
    if v_used>=v_limit then raise exception 'LIMIT_REACHED'; end if;
    insert into public.workspace_usage_events(business_id,capability_key,cycle_start,operation_key,actor_id,metadata)
      values(p_business_id,p_capability_key,v_state.cycle_start,p_operation_key,p_actor_id,coalesce(p_metadata,'{}'::jsonb)) returning id into v_inserted;
    update public.workspace_usage_counters set used_units=used_units+1,updated_at=now()
      where business_id=p_business_id and capability_key=p_capability_key and cycle_start=v_state.cycle_start
      returning used_units into v_used;
  end if;
  return jsonb_build_object('allowed',true,'limit',v_limit,'used',v_used,'remaining',greatest(v_limit-v_used,0),'readOnly',false,'duplicate',false);
end $$;

create or replace function public.pocket_authorize_capability(
  p_business_id uuid,p_actor_id uuid,p_capability_key text,p_operation_key text default null,p_consume boolean default false
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.pocket_actor_belongs_to_business(p_business_id,p_actor_id) then raise exception 'PLAN_NOT_AUTHORISED'; end if;
  return public.pocket_authorize_capability_internal(p_business_id,p_actor_id,p_capability_key,p_operation_key,p_consume,'{}'::jsonb);
end $$;

create or replace function public.pocket_get_entitlements(p_business_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v public.workspace_commercial_states; v_debt integer:=0; v_ocr integer:=0; v_invoice integer:=0; v_invoice_limit integer:=0; v_addon boolean; v_pack boolean;
begin
  select * into v from public.workspace_commercial_states where business_id=p_business_id;
  if not found or not public.pocket_is_workspace(p_business_id) then raise exception 'PLAN_NOT_AUTHORISED'; end if;
  select coalesce((select active_count from public.pocket_active_debt_counters where business_id=p_business_id),0) into v_debt;
  select coalesce(max(used_units),0) into v_ocr from public.workspace_usage_counters where business_id=p_business_id and capability_key='pocket.receipt.process' and cycle_start=v.cycle_start;
  select coalesce(max(used_units),0) into v_invoice from public.workspace_usage_counters where business_id=p_business_id and capability_key='pocket.invoice.create' and cycle_start=v.cycle_start;
  v_invoice_limit:=coalesce(public.pocket_capability_limit(p_business_id,'pocket.invoice.create',v.cycle_start,v.cycle_end),0);
  v_addon:=v_invoice_limit>0; v_pack:=v_invoice_limit=60;
  return jsonb_build_object(
    'productType','pocket','baseOffer',v.base_offer_key,'lifecycleState',v.lifecycle_state,
    'readOnly',v.lifecycle_state in('past_due','cancelled','grace_read_only','suspended') or (v.lifecycle_state='payment_retry' and now()>coalesce(v.grace_until,now())),
    'billingCycle',jsonb_build_object('startsAt',v.cycle_start,'endsAt',v.cycle_end),
    'addOns',jsonb_build_object('simpleInvoice',v_addon,'extraInvoicePack',v_pack),
    'capabilities',jsonb_build_object(
      'pocket.data.read',jsonb_build_object('enabled',true),'pocket.data.export',jsonb_build_object('enabled',true),
      'pocket.customer.manage',jsonb_build_object('enabled',v.lifecycle_state in('trialing','active','cancelled_at_period_end','payment_retry')),
      'pocket.debt.manage',jsonb_build_object('enabled',v.lifecycle_state in('trialing','active','cancelled_at_period_end','payment_retry'),'limit',100,'used',v_debt,'remaining',greatest(100-v_debt,0)),
      'pocket.payment.record',jsonb_build_object('enabled',v.lifecycle_state in('trialing','active','cancelled_at_period_end','payment_retry')),
      'pocket.receipt.process',jsonb_build_object('enabled',v.lifecycle_state in('trialing','active','cancelled_at_period_end','payment_retry'),'limit',100,'used',v_ocr,'remaining',greatest(100-v_ocr,0)),
      'pocket.invoice.create',jsonb_build_object('enabled',v_addon and v.lifecycle_state in('trialing','active','cancelled_at_period_end','payment_retry'),'limit',v_invoice_limit,'used',v_invoice,'remaining',greatest(v_invoice_limit-v_invoice,0)),
      'pocket.reminder.manage',jsonb_build_object('enabled',v.lifecycle_state in('trialing','active','cancelled_at_period_end','payment_retry')),
      'pocket.report.basic',jsonb_build_object('enabled',true),
      'pocket.workspace.user',jsonb_build_object('enabled',v.lifecycle_state in('trialing','active','cancelled_at_period_end','payment_retry'),'limit',1,'used',1,'remaining',0)
    )
  );
end $$;

create or replace function public.pocket_apply_subscription_state(
  p_business_id uuid,p_customer_id text,p_provider_event_id text,p_provider_event_created_at timestamptz,p_items jsonb
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare r jsonb; v_base public.workspace_subscription_items; v_state text:='suspended'; v_grace timestamptz; v_shell_state text;
begin
  if not public.pocket_is_workspace(p_business_id) or jsonb_typeof(p_items)<>'array' then raise exception 'PLAN_NOT_AUTHORISED'; end if;
  for r in select * from jsonb_array_elements(p_items) loop
    if r->>'offer_key' not in('pocket_monthly','pocket_annual','pocket_invoice_addon') then raise exception 'PLAN_NOT_AUTHORISED'; end if;
    insert into public.workspace_subscription_items(business_id,offer_key,provider_subscription_id,provider_item_id,provider_price_id,
      provider_status,period_start,period_end,cancel_at_period_end,last_provider_event_id,last_provider_event_created_at)
    values(p_business_id,r->>'offer_key',r->>'provider_subscription_id',r->>'provider_item_id',r->>'provider_price_id',r->>'provider_status',
      nullif(r->>'period_start','')::timestamptz,nullif(r->>'period_end','')::timestamptz,coalesce((r->>'cancel_at_period_end')::boolean,false),
      p_provider_event_id,p_provider_event_created_at)
    on conflict(provider_item_id) do update set
      provider_status=excluded.provider_status,period_start=excluded.period_start,period_end=excluded.period_end,
      cancel_at_period_end=excluded.cancel_at_period_end,provider_price_id=excluded.provider_price_id,
      last_provider_event_id=excluded.last_provider_event_id,last_provider_event_created_at=excluded.last_provider_event_created_at,updated_at=now()
    where excluded.last_provider_event_created_at>=workspace_subscription_items.last_provider_event_created_at;
  end loop;
  select * into v_base from public.workspace_subscription_items where business_id=p_business_id
    and offer_key in('pocket_monthly','pocket_annual') order by last_provider_event_created_at desc limit 1;
  if not found then return; end if;
  if v_base.provider_status='trialing' then v_state:='trialing';
  elsif v_base.provider_status='active' and v_base.cancel_at_period_end then v_state:='cancelled_at_period_end';
  elsif v_base.provider_status='active' then v_state:='active';
  elsif v_base.provider_status='past_due' then v_state:='payment_retry'; v_grace:=now()+interval '7 days';
  elsif v_base.provider_status='canceled' then v_state:=case when coalesce(v_base.period_end,now())>now() then 'cancelled' else 'grace_read_only' end;
  else v_state:='suspended'; end if;
  v_shell_state:=case when v_state in('trialing','active','payment_retry','cancelled_at_period_end') then 'active' when v_state='suspended' then 'suspended' else 'grace_read_only' end;
  insert into public.workspace_commercial_states(business_id,product_type,base_offer_key,lifecycle_state,cycle_start,cycle_end,grace_until,read_only_at,
    stripe_customer_id,last_provider_event_id,last_provider_event_created_at)
  values(p_business_id,'pocket',v_base.offer_key,v_state,v_base.period_start,v_base.period_end,v_grace,
    case when v_shell_state='grace_read_only' then now() else null end,p_customer_id,p_provider_event_id,p_provider_event_created_at)
  on conflict(business_id) do update set base_offer_key=excluded.base_offer_key,lifecycle_state=excluded.lifecycle_state,
    cycle_start=excluded.cycle_start,cycle_end=excluded.cycle_end,grace_until=excluded.grace_until,
    read_only_at=excluded.read_only_at,stripe_customer_id=excluded.stripe_customer_id,
    last_provider_event_id=case when excluded.last_provider_event_created_at>=coalesce(workspace_commercial_states.last_provider_event_created_at,'-infinity'::timestamptz)
      then excluded.last_provider_event_id else workspace_commercial_states.last_provider_event_id end,
    last_provider_event_created_at=greatest(workspace_commercial_states.last_provider_event_created_at,excluded.last_provider_event_created_at),updated_at=now();
  update public.workspace_product_states set lifecycle_state=v_shell_state,updated_at=now() where business_id=p_business_id and product_type='pocket';
end $$;

create or replace function public.pocket_refresh_lifecycle_states(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare v_count integer;
begin
  update public.workspace_commercial_states set lifecycle_state='grace_read_only',read_only_at=coalesce(read_only_at,p_now),updated_at=p_now
    where (lifecycle_state='payment_retry' and grace_until is not null and grace_until<=p_now)
       or (lifecycle_state='cancelled' and cycle_end is not null and cycle_end<=p_now);
  get diagnostics v_count=row_count;
  update public.workspace_product_states w set lifecycle_state='grace_read_only',updated_at=p_now
    where product_type='pocket' and exists(select 1 from public.workspace_commercial_states c where c.business_id=w.business_id and c.lifecycle_state='grace_read_only');
  return v_count;
end $$;

create or replace function public.pocket_reserve_checkout(
  p_business_id uuid,p_actor_id uuid,p_offer_key text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.workspace_commercial_states; x public.workspace_checkout_reservations;
begin
  if not public.pocket_is_workspace(p_business_id) or not public.pocket_actor_belongs_to_business(p_business_id,p_actor_id) then raise exception 'PLAN_NOT_AUTHORISED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text,913));
  if p_offer_key not in('pocket_monthly','pocket_annual','pocket_invoice_addon','pocket_extra_invoice_pack') then raise exception 'PLAN_NOT_AUTHORISED'; end if;
  select * into x from public.workspace_checkout_reservations where business_id=p_business_id and idempotency_key=p_idempotency_key;
  if found then return jsonb_build_object('reservation_id',x.id,'cycle_start',x.cycle_start,'cycle_end',x.cycle_end); end if;
  select * into v from public.workspace_commercial_states where business_id=p_business_id for update;
  update public.workspace_checkout_reservations set status='expired',updated_at=now()
    where business_id=p_business_id and status='pending' and expires_at<=now();
  if p_offer_key in('pocket_monthly','pocket_annual') and exists(select 1 from public.workspace_checkout_reservations
    where business_id=p_business_id and offer_key in('pocket_monthly','pocket_annual') and status='pending') then raise exception 'PLAN_NOT_AUTHORISED'; end if;
  if p_offer_key in('pocket_monthly','pocket_annual') and found
    and v.lifecycle_state in('trialing','active','payment_retry','cancelled_at_period_end') then
    raise exception 'PLAN_NOT_AUTHORISED';
  end if;
  if p_offer_key in('pocket_invoice_addon','pocket_extra_invoice_pack') and (not found or v.lifecycle_state not in('trialing','active','cancelled_at_period_end','payment_retry')) then raise exception 'PLAN_NOT_AUTHORISED'; end if;
  if p_offer_key='pocket_invoice_addon' and exists(select 1 from public.workspace_subscription_items
    where business_id=p_business_id and offer_key=p_offer_key and provider_status in('active','trialing')) then raise exception 'PLAN_NOT_AUTHORISED'; end if;
  if p_offer_key='pocket_extra_invoice_pack' then
    if public.pocket_capability_limit(p_business_id,'pocket.invoice.create',v.cycle_start,v.cycle_end)=0 then raise exception 'ADD_ON_REQUIRED'; end if;
    update public.workspace_checkout_reservations set status='expired',updated_at=now() where business_id=p_business_id and offer_key=p_offer_key and status='pending' and expires_at<=now();
    if exists(select 1 from public.workspace_cycle_purchases where business_id=p_business_id and offer_key=p_offer_key and cycle_start=v.cycle_start) then raise exception 'LIMIT_REACHED'; end if;
  end if;
  insert into public.workspace_checkout_reservations(business_id,actor_id,offer_key,idempotency_key,cycle_start,cycle_end)
    values(p_business_id,p_actor_id,p_offer_key,p_idempotency_key,case when p_offer_key='pocket_extra_invoice_pack' then v.cycle_start end,
      case when p_offer_key='pocket_extra_invoice_pack' then v.cycle_end end) returning * into x;
  return jsonb_build_object('reservation_id',x.id,'cycle_start',x.cycle_start,'cycle_end',x.cycle_end);
end $$;

create or replace function public.pocket_attach_checkout_session(p_reservation_id uuid,p_checkout_session_id text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update public.workspace_checkout_reservations set checkout_session_id=p_checkout_session_id,updated_at=now()
    where id=p_reservation_id and status='pending';
  if not found then raise exception 'PLAN_NOT_AUTHORISED'; end if;
end $$;

create or replace function public.pocket_record_cycle_pack(
  p_business_id uuid,p_actor_id uuid,p_checkout_session_id text,p_payment_intent_id text,
  p_provider_event_id text,p_provider_event_created_at timestamptz
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare x public.workspace_checkout_reservations;
begin
  select * into x from public.workspace_checkout_reservations where business_id=p_business_id and checkout_session_id=p_checkout_session_id for update;
  if not found or x.offer_key<>'pocket_extra_invoice_pack' then raise exception 'PLAN_NOT_AUTHORISED'; end if;
  if not public.pocket_actor_belongs_to_business(p_business_id,p_actor_id)
    or not exists(select 1 from public.workspace_commercial_states where business_id=p_business_id and cycle_start=x.cycle_start and cycle_end=x.cycle_end)
    or now()>=x.cycle_end then raise exception 'PLAN_NOT_AUTHORISED'; end if;
  insert into public.workspace_cycle_purchases(business_id,offer_key,cycle_start,cycle_end,checkout_session_id,payment_intent_id,
    provider_event_id,provider_event_created_at,purchased_by)
  values(p_business_id,x.offer_key,x.cycle_start,x.cycle_end,p_checkout_session_id,p_payment_intent_id,p_provider_event_id,p_provider_event_created_at,p_actor_id)
  on conflict do nothing;
  update public.workspace_checkout_reservations set status='completed',updated_at=now() where id=x.id;
end $$;

create or replace function public.pocket_commit_invoice_usage(
  p_business_id uuid,p_actor_id uuid,p_invoice_id uuid,p_invoice_number text,p_operation_key text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if nullif(btrim(p_invoice_number),'') is null then raise exception 'PLAN_NOT_AUTHORISED'; end if;
  if not public.pocket_actor_belongs_to_business(p_business_id,p_actor_id) then raise exception 'PLAN_NOT_AUTHORISED'; end if;
  return public.pocket_authorize_capability_internal(p_business_id,p_actor_id,'pocket.invoice.create',p_operation_key,true,
    jsonb_build_object('invoice_id',p_invoice_id,'invoice_number',p_invoice_number,'usage_rule','committed_numbers_are_not_restored_on_cancellation'));
end $$;

create or replace function public.pocket_extraction_usage_guard()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_hash text;
begin
  if public.pocket_is_workspace(new.business_id) then
    select content_sha256 into v_hash from public.evidence_files where id=new.evidence_id and business_id=new.business_id;
    perform public.pocket_authorize_capability_internal(new.business_id,null,'pocket.receipt.process','ocr:'||coalesce(v_hash,new.evidence_id::text),true,
      jsonb_build_object('evidence_id',new.evidence_id));
  end if;
  return new;
end $$;
drop trigger if exists pocket_extraction_usage_guard on public.document_intake_extractions;
create trigger pocket_extraction_usage_guard before insert on public.document_intake_extractions
for each row execute function public.pocket_extraction_usage_guard();

create or replace function public.pocket_obligation_is_active(v public.obligations)
returns boolean language sql immutable as $$
  select v.archived_at is null and greatest(v.original_amount_minor+v.adjustments_minor-v.paid_minor,0)>0
    and v.status not in('paid','void','written_off')
$$;
create or replace function public.pocket_active_debt_guard()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_business uuid:=coalesce(new.business_id,old.business_id); v_old boolean:=false; v_new boolean:=false; v_count integer;
begin
  if not public.pocket_is_workspace(v_business) then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  if tg_op<>'INSERT' then v_old:=public.pocket_obligation_is_active(old); end if;
  if tg_op<>'DELETE' then v_new:=public.pocket_obligation_is_active(new); end if;
  if v_old=v_new then if tg_op='DELETE' then return old; else return new; end if; end if;
  insert into public.pocket_active_debt_counters(business_id,active_count) values(v_business,0) on conflict do nothing;
  select active_count into v_count from public.pocket_active_debt_counters where business_id=v_business for update;
  if v_new and not v_old and v_count>=100 then raise exception 'LIMIT_REACHED'; end if;
  update public.pocket_active_debt_counters set active_count=greatest(0,active_count+case when v_new then 1 else -1 end),updated_at=now() where business_id=v_business;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;
drop trigger if exists pocket_active_debt_guard on public.obligations;
create trigger pocket_active_debt_guard before insert or update or delete on public.obligations
for each row execute function public.pocket_active_debt_guard();

create or replace function public.pocket_active_user_guard()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_count integer;
begin
  if new.status='active' and (tg_op='INSERT' or old.status is distinct from 'active') and public.pocket_is_workspace(new.business_id) then
    perform pg_advisory_xact_lock(hashtextextended(new.business_id::text,913));
    select 1+count(*) into v_count from public.business_memberships
      where business_id=new.business_id and status='active' and (tg_op='INSERT' or id<>new.id);
    if v_count>=1 then raise exception 'LIMIT_REACHED'; end if;
  end if;
  return new;
end $$;
drop trigger if exists pocket_active_user_guard on public.business_memberships;
create trigger pocket_active_user_guard before insert or update of status on public.business_memberships
for each row execute function public.pocket_active_user_guard();

insert into public.pocket_active_debt_counters(business_id,active_count)
select w.business_id,count(o.id)::integer from public.workspace_product_states w
left join public.obligations o on o.business_id=w.business_id and public.pocket_obligation_is_active(o)
where w.product_type='pocket' group by w.business_id
on conflict(business_id) do update set active_count=excluded.active_count,updated_at=now();

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

-- Rollback only after Pocket writes and billing webhooks are disabled. Preserve
-- usage/event rows for audit export before dropping tables. Drop the three
-- enforcement triggers first, then the functions and tables in reverse order.
-- Prompt 4 Pocket customer/debt projection. Canonical deployment SQL is kept in
-- supabase/migrations/20260914_pocket_customer_debt_ledger.sql.
alter table public.debtors
  add column if not exists pocket_note text,
  add column if not exists preferred_reminder_language text,
  add column if not exists normalized_phone text,
  add column if not exists normalized_email text;
alter table public.obligations
  add column if not exists origin_product_type text,
  add column if not exists pocket_description text,
  add column if not exists pocket_debt_date date,
  add column if not exists pocket_due_date date,
  add column if not exists pocket_reminder_preference text;
create table if not exists public.pocket_debt_attachments (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete restrict,
  debt_id uuid not null, evidence_id uuid not null, created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key(debt_id,business_id) references public.obligations(id,business_id) on delete restrict,
  foreign key(evidence_id,business_id) references public.evidence_files(id,business_id) on delete restrict,
  unique(debt_id,evidence_id)
);
create index if not exists debtors_pocket_phone_lookup_idx on public.debtors(business_id,normalized_phone) where normalized_phone is not null and merged_into_id is null;
create index if not exists debtors_pocket_email_lookup_idx on public.debtors(business_id,normalized_email) where normalized_email is not null and merged_into_id is null;
alter table public.obligations drop constraint if exists obligations_origin_product_type_check;
alter table public.obligations add constraint obligations_origin_product_type_check check(origin_product_type is null or origin_product_type in('main','pocket'));
alter table public.obligations drop constraint if exists obligations_pocket_dates_check;
alter table public.obligations add constraint obligations_pocket_dates_check check(pocket_debt_date is null or pocket_due_date is null or pocket_due_date>=pocket_debt_date);
alter table public.obligations drop constraint if exists obligations_pocket_description_check;
alter table public.obligations add constraint obligations_pocket_description_check check(origin_product_type<>'pocket' or nullif(btrim(pocket_description),'') is not null);
create index if not exists obligations_pocket_list_idx on public.obligations(business_id,pocket_due_date,created_at desc) where origin_product_type='pocket';
create index if not exists pocket_debt_attachments_debt_idx on public.pocket_debt_attachments(business_id,debt_id,created_at);
alter table public.pocket_debt_attachments enable row level security;
revoke all on public.pocket_debt_attachments from public,anon,authenticated;
grant select,insert on public.pocket_debt_attachments to service_role;

create or replace function public.pocket_normalize_email(p_value text) returns text language sql immutable parallel safe as $$
  select nullif(lower(btrim(coalesce(p_value,''))),'')
$$;
create or replace function public.pocket_normalize_phone(p_value text) returns text language sql immutable parallel safe as $$
  select nullif(regexp_replace(coalesce(p_value,''),'[^0-9]+','','g'),'')
$$;
create or replace function public.pocket_customer_normalize() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin new.normalized_email:=public.pocket_normalize_email(new.email); new.normalized_phone:=public.pocket_normalize_phone(new.phone); return new; end $$;
drop trigger if exists pocket_customer_normalize on public.debtors;
create trigger pocket_customer_normalize before insert or update of email,phone on public.debtors for each row execute function public.pocket_customer_normalize();
update public.debtors set normalized_email=public.pocket_normalize_email(email),normalized_phone=public.pocket_normalize_phone(phone)
where normalized_email is distinct from public.pocket_normalize_email(email) or normalized_phone is distinct from public.pocket_normalize_phone(phone);

create or replace function public.pocket_obligation_is_active(v public.obligations) returns boolean language sql immutable as $$
  select v.origin_product_type='pocket' and v.archived_at is null
    and greatest(v.original_amount_minor+v.adjustments_minor-v.paid_minor,0)>0 and v.status in('open','partial','overdue')
$$;
create or replace function public.pocket_sync_debt_status() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_timezone text; v_today date; v_status text;
begin
  if new.origin_product_type<>'pocket' or new.archived_at is not null or new.status in('draft','void','written_off') then return new; end if;
  select coalesce(timezone,'UTC') into v_timezone from public.businesses where id=new.business_id;
  v_today:=(now() at time zone coalesce(v_timezone,'UTC'))::date;
  v_status:=case when new.outstanding_minor=0 then 'paid' when new.pocket_due_date is not null and new.pocket_due_date<v_today then 'overdue' when new.paid_minor>0 then 'partial' else 'open' end;
  if new.status is distinct from v_status then
    update public.obligations set status=v_status,updated_at=now() where id=new.id;
    insert into public.audit_logs(business_id,action,actor_type,actor_id,metadata) values(new.business_id,'pocket.debt.status_changed','system',null,jsonb_build_object('entity_type','obligation','entity_id',new.id,'from_status',new.status,'to_status',v_status,'remaining_minor',new.outstanding_minor));
  end if;
  return new;
end $$;
drop trigger if exists pocket_sync_debt_status on public.obligations;
create trigger pocket_sync_debt_status after insert or update of paid_minor,adjustments_minor,original_amount_minor,pocket_due_date,archived_at on public.obligations for each row execute function public.pocket_sync_debt_status();
insert into public.pocket_active_debt_counters(business_id,active_count,updated_at)
select w.business_id,count(o.id)::integer,now() from public.workspace_product_states w
left join public.obligations o on o.business_id=w.business_id and public.pocket_obligation_is_active(o)
where w.product_type='pocket' group by w.business_id
on conflict(business_id) do update set active_count=excluded.active_count,updated_at=excluded.updated_at;

-- Canonical Prompt 5 Pocket authoritative payment extension.
-- Prompt 5: Pocket payments through the shared receipt/allocation/journal truth.
-- Review and apply after 20260914. No data is deleted or rewritten.

alter table public.payment_allocations alter column case_id drop not null;
alter table public.payment_allocations alter column case_financial_event_id drop not null;
alter table public.payment_allocations drop constraint if exists payment_allocations_target_scope_check;
alter table public.payment_allocations add constraint payment_allocations_target_scope_check check (
  (case_id is not null and case_financial_event_id is not null)
  or
  (case_id is null and case_financial_event_id is null and obligation_id is not null
    and payment_id is null and exchange_rate_id is null and receipt_currency=target_currency
    and receipt_amount_minor=target_amount_minor and overpayment_minor=0)
);

create unique index if not exists payment_receipts_pocket_reference_unique
  on public.payment_receipts(business_id,lower(reference))
  where source_system='collectboss_pocket' and reference is not null;
create index if not exists payment_allocations_pocket_obligation_timeline_idx
  on public.payment_allocations(business_id,obligation_id,created_at desc)
  where case_id is null and obligation_id is not null;

create or replace function public.pocket_post_payment(
  p_business_id uuid,p_actor_id uuid,p_debt_id uuid,p_amount_minor bigint,p_expected_outstanding_minor bigint,
  p_payment_date date,p_method text,p_reference text,p_note text,p_idempotency_key text,p_request_hash text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_role text; v_debt public.obligations; v_customer public.debtors; v_existing public.payment_operation_idempotency_keys;
  v_timezone text; v_today date; v_received_at timestamptz; v_receipt_response jsonb; v_receipt_id uuid;
  v_allocation_id uuid:=gen_random_uuid(); v_journal_id uuid; v_response jsonb; v_status text;
begin
  if not public.pocket_is_workspace(p_business_id) then raise exception 'POCKET_PAYMENT_NOT_AUTHORISED'; end if;
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id);
  if v_role not in('owner','admin','manager') then raise exception 'POCKET_PAYMENT_NOT_AUTHORISED'; end if;
  perform public.pocket_authorize_capability_internal(p_business_id,p_actor_id,'pocket.payment.record',p_idempotency_key,false,'{}'::jsonb);
  if nullif(btrim(coalesce(p_idempotency_key,'')),'') is null or p_request_hash!~'^[0-9a-f]{64}$' then raise exception 'POCKET_PAYMENT_INVALID_REQUEST'; end if;
  if p_method not in('cash','bank_transfer','card','cheque','other') or p_amount_minor<=0 then raise exception 'POCKET_PAYMENT_INVALID_REQUEST'; end if;

  select * into v_existing from public.payment_operation_idempotency_keys
    where business_id=p_business_id and action_scope='pocket_post_payment' and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_hash<>p_request_hash then raise exception 'P17_IDEMPOTENCY_CONFLICT'; end if;
    return v_existing.response||jsonb_build_object('idempotentReplay',true);
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':pocket-debt:'||p_debt_id::text,0));
  select * into v_debt from public.obligations where id=p_debt_id and business_id=p_business_id
    and origin_product_type='pocket' and archived_at is null for update;
  if not found then raise exception 'POCKET_DEBT_NOT_FOUND'; end if;
  if v_debt.status in('draft','void','written_off') or v_debt.outstanding_minor<=0 then raise exception 'POCKET_DEBT_NOT_PAYABLE'; end if;
  if p_expected_outstanding_minor is distinct from v_debt.outstanding_minor then raise exception 'POCKET_PAYMENT_STALE_BALANCE'; end if;
  if p_amount_minor>v_debt.outstanding_minor then raise exception 'POCKET_PAYMENT_AMOUNT_TOO_HIGH'; end if;
  if upper(v_debt.currency)<>(select upper(default_currency) from public.businesses where id=p_business_id) then raise exception 'POCKET_PAYMENT_CURRENCY_MISMATCH'; end if;

  select coalesce(timezone,'UTC') into v_timezone from public.businesses where id=p_business_id;
  v_today:=(now() at time zone coalesce(v_timezone,'UTC'))::date;
  if p_payment_date is null or p_payment_date>v_today then raise exception 'POCKET_PAYMENT_INVALID_DATE'; end if;
  v_received_at:=p_payment_date::timestamp at time zone coalesce(v_timezone,'UTC');
  if nullif(btrim(coalesce(p_reference,'')),'') is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':pocket-payment-reference:'||lower(btrim(p_reference)),0));
    if exists(select 1 from public.payment_receipts where business_id=p_business_id and source_system='collectboss_pocket'
      and lower(reference)=lower(btrim(p_reference))) then raise exception 'POCKET_PAYMENT_DUPLICATE_REFERENCE'; end if;
  end if;

  select * into v_customer from public.debtors where id=v_debt.customer_id and business_id=p_business_id;
  v_receipt_response:=public.payment_operation_record_receipt(
    p_business_id,p_actor_id,'payment',p_amount_minor,v_debt.currency,v_received_at,'manual','collectboss_pocket',
    'pocket:'||p_idempotency_key,null,nullif(btrim(p_reference),''),coalesce(v_customer.individual_name,v_customer.business_name),
    jsonb_build_object('product','pocket','debt_id',p_debt_id,'customer_id',v_debt.customer_id,'payment_date',p_payment_date,'method',p_method,'note',nullif(btrim(p_note),'')),
    'pocket-receipt:'||p_idempotency_key,p_request_hash
  );
  v_receipt_id:=(v_receipt_response->>'receipt_id')::uuid;
  v_journal_id:=public.payment_operation_create_journal(p_business_id,'allocation','payment_allocations',v_allocation_id,
    'pocket-allocation:'||p_idempotency_key,jsonb_build_array(
      jsonb_build_object('account','unallocated_funds','side','debit','amountMinor',p_amount_minor,'currency',v_debt.currency),
      jsonb_build_object('account','accounts_receivable_control','side','credit','amountMinor',p_amount_minor,'currency',v_debt.currency)
    ),p_actor_id);
  insert into public.payment_allocations(
    id,business_id,receipt_id,event_type,reverses_allocation_id,case_id,obligation_id,
    receipt_amount_minor,receipt_currency,target_amount_minor,target_currency,overpayment_minor,
    exchange_rate_id,payment_id,case_financial_event_id,journal_id,reason,approval_request_id,idempotency_key,created_by
  ) values(
    v_allocation_id,p_business_id,v_receipt_id,'allocation',null,null,p_debt_id,
    p_amount_minor,v_debt.currency,p_amount_minor,v_debt.currency,0,null,null,null,v_journal_id,
    nullif(btrim(p_note),''),null,'pocket-allocation:'||p_idempotency_key,p_actor_id
  );
  update public.obligations set paid_minor=paid_minor+p_amount_minor,updated_at=now() where id=p_debt_id;
  select case when status='paid' or outstanding_minor=0 then 'settled'
    when pocket_due_date is not null and pocket_due_date<v_today then 'overdue'
    when paid_minor>0 then 'partially_paid' else 'active' end into v_status
    from public.obligations where id=p_debt_id;
  select jsonb_build_object(
    'allocationId',v_allocation_id,'receiptId',v_receipt_id,'debtId',p_debt_id,'customerId',v_debt.customer_id,
    'amountMinor',p_amount_minor,'paidMinor',paid_minor,'remainingMinor',outstanding_minor,'currency',currency,
    'status',v_status,'paymentDate',p_payment_date,'method',p_method,'reference',nullif(btrim(p_reference),''),
    'idempotentReplay',false
  ) into v_response from public.obligations where id=p_debt_id;
  insert into public.payment_operation_idempotency_keys(business_id,action_scope,idempotency_key,request_hash,response,created_by)
    values(p_business_id,'pocket_post_payment',p_idempotency_key,p_request_hash,v_response,p_actor_id);
  insert into public.audit_logs(business_id,action,actor_type,actor_id,actor_role,entity_type,entity_id,idempotency_key,metadata)
    values(p_business_id,'pocket.payment.confirmed','staff',p_actor_id,v_role,'payment_allocation',v_allocation_id::text,p_idempotency_key,
      jsonb_build_object('receipt_id',v_receipt_id,'debt_id',p_debt_id,'customer_id',v_debt.customer_id,'amount_minor',p_amount_minor,'currency',v_debt.currency,'method',p_method));
  return v_response;
end $$;

create or replace function public.pocket_reverse_payment(
  p_business_id uuid,p_actor_id uuid,p_allocation_id uuid,p_reason text,p_idempotency_key text,p_request_hash text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_role text; v_original public.payment_allocations; v_debt public.obligations; v_receipt public.payment_receipts;
  v_existing public.payment_operation_idempotency_keys; v_reversal_id uuid:=gen_random_uuid(); v_journal_id uuid; v_response jsonb; v_today date; v_timezone text; v_status text;
begin
  if not public.pocket_is_workspace(p_business_id) then raise exception 'POCKET_PAYMENT_NOT_AUTHORISED'; end if;
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id);
  if v_role not in('owner','admin') then raise exception 'POCKET_PAYMENT_REVERSE_NOT_AUTHORISED'; end if;
  perform public.pocket_authorize_capability_internal(p_business_id,p_actor_id,'pocket.payment.record',p_idempotency_key,false,'{}'::jsonb);
  if char_length(btrim(coalesce(p_reason,'')))<3 then raise exception 'P17_REASON_REQUIRED'; end if;
  select * into v_existing from public.payment_operation_idempotency_keys
    where business_id=p_business_id and action_scope='pocket_reverse_payment' and idempotency_key=p_idempotency_key;
  if found then if v_existing.request_hash<>p_request_hash then raise exception 'P17_IDEMPOTENCY_CONFLICT'; end if; return v_existing.response||jsonb_build_object('idempotentReplay',true); end if;

  select * into v_original from public.payment_allocations where id=p_allocation_id and business_id=p_business_id
    and event_type='allocation' and case_id is null and obligation_id is not null for update;
  if not found then raise exception 'P17_ALLOCATION_NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':pocket-debt:'||v_original.obligation_id::text,0));
  if exists(select 1 from public.payment_allocations where reverses_allocation_id=p_allocation_id) then raise exception 'P17_ALLOCATION_ALREADY_REVERSED'; end if;
  select * into v_debt from public.obligations where id=v_original.obligation_id and business_id=p_business_id and origin_product_type='pocket' for update;
  if not found or v_debt.paid_minor<v_original.target_amount_minor then raise exception 'POCKET_PAYMENT_REVERSAL_CONFLICT'; end if;
  select * into v_receipt from public.payment_receipts where id=v_original.receipt_id and business_id=p_business_id for update;
  perform set_config('collectboss.pocket_financial_correction','on',true);
  v_journal_id:=public.payment_operation_create_journal(p_business_id,'allocation_reversal','payment_allocations',v_reversal_id,
    'pocket-reversal:'||p_idempotency_key,jsonb_build_array(
      jsonb_build_object('account','accounts_receivable_control','side','debit','amountMinor',v_original.target_amount_minor,'currency',v_original.target_currency),
      jsonb_build_object('account','unallocated_funds','side','credit','amountMinor',v_original.receipt_amount_minor,'currency',v_original.receipt_currency)
    ),p_actor_id);
  insert into public.payment_allocations(
    id,business_id,receipt_id,event_type,reverses_allocation_id,case_id,obligation_id,
    receipt_amount_minor,receipt_currency,target_amount_minor,target_currency,overpayment_minor,
    exchange_rate_id,payment_id,case_financial_event_id,journal_id,reason,approval_request_id,idempotency_key,created_by
  ) values(
    v_reversal_id,p_business_id,v_original.receipt_id,'reversal',v_original.id,null,v_original.obligation_id,
    v_original.receipt_amount_minor,v_original.receipt_currency,v_original.target_amount_minor,v_original.target_currency,0,
    null,null,null,v_journal_id,btrim(p_reason),null,'pocket-reversal:'||p_idempotency_key,p_actor_id
  );
  update public.obligations set paid_minor=paid_minor-v_original.target_amount_minor,updated_at=now() where id=v_debt.id;
  select coalesce(timezone,'UTC') into v_timezone from public.businesses where id=p_business_id;
  v_today:=(now() at time zone coalesce(v_timezone,'UTC'))::date;
  select case when pocket_due_date is not null and pocket_due_date<v_today then 'overdue' when paid_minor>0 then 'partially_paid' else 'active' end into v_status from public.obligations where id=v_debt.id;
  select jsonb_build_object(
    'reversalId',v_reversal_id,'allocationId',p_allocation_id,'receiptId',v_original.receipt_id,'debtId',v_debt.id,
    'amountMinor',v_original.target_amount_minor,'paidMinor',paid_minor,'remainingMinor',outstanding_minor,'currency',currency,
    'status',v_status,'reason',btrim(p_reason),'idempotentReplay',false
  ) into v_response from public.obligations where id=v_debt.id;
  insert into public.payment_operation_idempotency_keys(business_id,action_scope,idempotency_key,request_hash,response,created_by)
    values(p_business_id,'pocket_reverse_payment',p_idempotency_key,p_request_hash,v_response,p_actor_id);
  insert into public.audit_logs(business_id,action,actor_type,actor_id,actor_role,entity_type,entity_id,idempotency_key,metadata)
    values(p_business_id,'pocket.payment.reversed','staff',p_actor_id,v_role,'payment_allocation',p_allocation_id::text,p_idempotency_key,
      jsonb_build_object('reversal_id',v_reversal_id,'debt_id',v_debt.id,'receipt_id',v_original.receipt_id,'amount_minor',v_original.target_amount_minor,'currency',v_original.target_currency,'reason',btrim(p_reason)));
  return v_response;
end $$;

-- Financial reversals must restore truth even when they put the workspace over its plan limit.
create or replace function public.pocket_active_debt_guard()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_business uuid:=coalesce(new.business_id,old.business_id); v_old boolean:=false; v_new boolean:=false; v_count integer;
begin
  if not public.pocket_is_workspace(v_business) then if tg_op='DELETE' then return old; else return new; end if; end if;
  if tg_op<>'INSERT' then v_old:=public.pocket_obligation_is_active(old); end if;
  if tg_op<>'DELETE' then v_new:=public.pocket_obligation_is_active(new); end if;
  if v_old=v_new then if tg_op='DELETE' then return old; else return new; end if; end if;
  insert into public.pocket_active_debt_counters(business_id,active_count) values(v_business,0) on conflict do nothing;
  select active_count into v_count from public.pocket_active_debt_counters where business_id=v_business for update;
  if v_new and not v_old and v_count>=100 and coalesce(current_setting('collectboss.pocket_financial_correction',true),'off')<>'on' then raise exception 'LIMIT_REACHED'; end if;
  update public.pocket_active_debt_counters set active_count=greatest(0,active_count+case when v_new then 1 else -1 end),updated_at=now() where business_id=v_business;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;

revoke all on function public.pocket_post_payment(uuid,uuid,uuid,bigint,bigint,date,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.pocket_reverse_payment(uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.pocket_post_payment(uuid,uuid,uuid,bigint,bigint,date,text,text,text,text,text) to service_role;
grant execute on function public.pocket_reverse_payment(uuid,uuid,uuid,text,text,text) to service_role;

-- Rollback: disable Pocket payment writes, reverse or export any Pocket allocations,
-- then drop the two RPCs and indexes. Restore NOT NULL only after confirming no
-- case-free allocation rows remain. Existing Main allocations are never modified.

-- Prompt 6: Pocket receipt capture, reviewed extraction, and authoritative payment handoff.
-- Additive proposal only. Apply after 20260915_pocket_authoritative_payments.sql.
-- The shared document-intake/OCR and payment-operation tables remain authoritative.

begin;

create table if not exists public.pocket_receipt_payment_links (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  intake_id uuid not null references public.document_intakes(id) on delete restrict,
  evidence_id uuid not null references public.evidence_files(id) on delete restrict,
  confirmation_id uuid not null references public.document_intake_confirmations(id) on delete restrict,
  allocation_id uuid not null references public.payment_allocations(id) on delete restrict,
  receipt_id uuid not null references public.payment_receipts(id) on delete restrict,
  debt_id uuid not null references public.obligations(id) on delete restrict,
  customer_id uuid not null references public.debtors(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(intake_id),
  unique(allocation_id),
  unique(receipt_id)
);
create index if not exists pocket_receipt_payment_links_business_idx
  on public.pocket_receipt_payment_links(business_id,created_at desc);

drop trigger if exists pocket_receipt_payment_links_append_only_guard on public.pocket_receipt_payment_links;
create trigger pocket_receipt_payment_links_append_only_guard
before update or delete on public.pocket_receipt_payment_links
for each row execute function public.document_intake_append_only();

alter table public.pocket_receipt_payment_links enable row level security;
drop policy if exists pocket_receipt_payment_links_read on public.pocket_receipt_payment_links;
create policy pocket_receipt_payment_links_read on public.pocket_receipt_payment_links
for select to authenticated
using (
  public.has_business_permission(business_id,'document_intake.read')
  and public.has_business_permission(business_id,'case.read')
);
revoke all on public.pocket_receipt_payment_links from public,anon,authenticated;
grant select on public.pocket_receipt_payment_links to authenticated;
grant all on public.pocket_receipt_payment_links to service_role;

create or replace function public.pocket_confirm_receipt_payment(
  p_business_id uuid,p_actor_id uuid,p_intake_id uuid,p_debt_id uuid,
  p_expected_outstanding_minor bigint,p_method text,p_note text,p_duplicate_acknowledged boolean,
  p_idempotency_key text,p_request_hash text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_role text; v_intake public.document_intakes; v_evidence public.evidence_files;
  v_extraction public.document_intake_extractions; v_confirmation public.document_intake_confirmations;
  v_existing public.payment_operation_idempotency_keys; v_existing_link public.pocket_receipt_payment_links;
  v_payment jsonb; v_response jsonb; v_allocation_id uuid; v_receipt_id uuid; v_payment_date date; v_timezone text;
  v_customer_id uuid; v_duplicate boolean:=false;
begin
  if not public.pocket_is_workspace(p_business_id) then raise exception 'POCKET_RECEIPT_NOT_AUTHORISED'; end if;
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id);
  if v_role not in('owner','admin','manager') then raise exception 'POCKET_RECEIPT_NOT_AUTHORISED'; end if;
  perform public.pocket_authorize_capability_internal(p_business_id,p_actor_id,'pocket.receipt.process',p_idempotency_key,false,'{}'::jsonb);
  perform public.pocket_authorize_capability_internal(p_business_id,p_actor_id,'pocket.payment.record',p_idempotency_key,false,'{}'::jsonb);
  if char_length(btrim(coalesce(p_idempotency_key,''))) not between 8 and 96 or p_request_hash!~'^[0-9a-f]{64}$' then
    raise exception 'POCKET_PAYMENT_INVALID_REQUEST';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':pocket-receipt:'||p_intake_id::text,0));
  select * into v_existing from public.payment_operation_idempotency_keys
    where business_id=p_business_id and action_scope='pocket_confirm_receipt_payment' and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_hash<>p_request_hash then raise exception 'P17_IDEMPOTENCY_CONFLICT'; end if;
    return v_existing.response||jsonb_build_object('idempotentReplay',true);
  end if;
  select * into v_existing_link from public.pocket_receipt_payment_links
    where business_id=p_business_id and intake_id=p_intake_id;
  if found then
    raise exception 'POCKET_RECEIPT_REVIEW_STALE';
  end if;
  select * into v_intake from public.document_intakes
    where id=p_intake_id and business_id=p_business_id and intended_workflow='payment_evidence' and deleted_at is null for update;
  if not found then raise exception 'POCKET_RECEIPT_NOT_FOUND'; end if;
  if v_intake.status in('submitted','cancelled','failed') then raise exception 'POCKET_RECEIPT_REVIEW_STALE'; end if;
  select * into v_evidence from public.evidence_files
    where intake_id=p_intake_id and business_id=p_business_id and kind='original' and is_current and soft_deleted_at is null
    order by evidence_version desc limit 1 for update;
  if not found or v_evidence.scan_status<>'clean' or v_evidence.processing_status not in('completed','needs_review') then
    raise exception 'POCKET_RECEIPT_EVIDENCE_NOT_READY';
  end if;
  select * into v_extraction from public.document_intake_extractions
    where intake_id=p_intake_id and business_id=p_business_id and evidence_id=v_evidence.id
      and document_version=v_evidence.evidence_version and status in('completed','needs_review')
    order by extraction_version desc limit 1 for update;
  if not found then raise exception 'POCKET_RECEIPT_EVIDENCE_NOT_READY'; end if;
  select * into v_confirmation from public.document_intake_confirmations
    where intake_id=p_intake_id and business_id=p_business_id and extraction_id=v_extraction.id and review_status='confirmed'
    order by confirmation_version desc limit 1 for update;
  if not found or v_confirmation.chosen_amount_minor is null or v_confirmation.chosen_amount_minor<=0
    or v_confirmation.currency is null or not v_confirmation.currency_confirmed
    or not v_confirmation.date_interpretation_confirmed then raise exception 'POCKET_RECEIPT_REVIEW_REQUIRED'; end if;
  if v_confirmation.confirmed_document_kind not in(
    'online_bank_transfer_receipt','transaction_screenshot','bank_in_cash_deposit_receipt','payment_receipt'
  ) or v_confirmation.represents_financial_movement is distinct from true then raise exception 'POCKET_RECEIPT_KIND_UNSUPPORTED'; end if;
  if v_confirmation.document_datetime is null then raise exception 'POCKET_RECEIPT_DATE_REQUIRED'; end if;
  v_payment_date:=(v_confirmation.document_datetime at time zone 'UTC')::date;
  select coalesce(timezone,'UTC') into v_timezone from public.businesses where id=p_business_id;
  v_duplicate:=v_evidence.duplicate_match_status='exact_hash_warning' or exists(
    select 1 from public.evidence_files prior where prior.business_id=p_business_id and prior.id<>v_evidence.id
      and prior.kind='original' and prior.soft_deleted_at is null and prior.content_sha256=v_evidence.content_sha256
  ) or exists(
    select 1 from public.payment_receipts prior where prior.business_id=p_business_id
      and prior.amount_minor=v_confirmation.chosen_amount_minor and prior.currency=v_confirmation.currency
      and (prior.received_at at time zone v_timezone)::date=v_payment_date
  );
  if v_duplicate and not coalesce(p_duplicate_acknowledged,false) then raise exception 'POCKET_RECEIPT_DUPLICATE_REVIEW_REQUIRED'; end if;
  select customer_id into v_customer_id from public.obligations
    where id=p_debt_id and business_id=p_business_id and origin_product_type='pocket' and archived_at is null;
  if not found then raise exception 'POCKET_DEBT_NOT_FOUND'; end if;

  v_payment:=public.pocket_post_payment(
    p_business_id,p_actor_id,p_debt_id,v_confirmation.chosen_amount_minor,p_expected_outstanding_minor,
    v_payment_date,p_method,v_confirmation.reference,p_note,
    'receipt:'||p_idempotency_key,p_request_hash
  );
  v_allocation_id:=(v_payment->>'allocationId')::uuid;
  v_receipt_id:=(v_payment->>'receiptId')::uuid;
  insert into public.pocket_receipt_payment_links(
    business_id,intake_id,evidence_id,confirmation_id,allocation_id,receipt_id,debt_id,customer_id,created_by
  ) values(
    p_business_id,p_intake_id,v_evidence.id,v_confirmation.id,v_allocation_id,v_receipt_id,p_debt_id,v_customer_id,p_actor_id
  );
  update public.document_intakes set status='submitted',submitted_at=now(),version=version+1,updated_at=now()
    where id=p_intake_id;
  insert into public.document_intake_events(
    intake_id,business_id,from_status,to_status,intake_version,actor_id,actor_role,action,metadata,idempotency_key
  ) values(
    p_intake_id,p_business_id,v_intake.status,'submitted',v_intake.version+1,p_actor_id,v_role,
    'pocket.receipt.payment_confirmed',jsonb_build_object('evidence_id',v_evidence.id,'confirmation_id',v_confirmation.id,
      'allocation_id',v_allocation_id,'receipt_id',v_receipt_id,'debt_id',p_debt_id,'duplicate_acknowledged',coalesce(p_duplicate_acknowledged,false)),
    p_idempotency_key
  );
  v_response:=v_payment||jsonb_build_object(
    'intakeId',p_intake_id,'evidenceId',v_evidence.id,'confirmationId',v_confirmation.id,'idempotentReplay',false
  );
  insert into public.payment_operation_idempotency_keys(business_id,action_scope,idempotency_key,request_hash,response,created_by)
    values(p_business_id,'pocket_confirm_receipt_payment',p_idempotency_key,p_request_hash,v_response,p_actor_id);
  insert into public.audit_logs(
    business_id,action,actor_type,actor_id,actor_role,entity_type,entity_id,idempotency_key,metadata
  ) values(
    p_business_id,'pocket.receipt.payment_confirmed','staff',p_actor_id,v_role,'document_intake',p_intake_id::text,p_idempotency_key,
    jsonb_build_object('evidence_id',v_evidence.id,'confirmation_id',v_confirmation.id,'allocation_id',v_allocation_id,
      'receipt_id',v_receipt_id,'debt_id',p_debt_id,'customer_id',v_customer_id,'amount_minor',v_confirmation.chosen_amount_minor,
      'currency',v_confirmation.currency,'duplicate_acknowledged',coalesce(p_duplicate_acknowledged,false))
  );
  return v_response;
end $$;

revoke all on function public.pocket_confirm_receipt_payment(uuid,uuid,uuid,uuid,bigint,text,text,boolean,text,text)
  from public,anon,authenticated;
grant execute on function public.pocket_confirm_receipt_payment(uuid,uuid,uuid,uuid,bigint,text,text,boolean,text,text)
  to service_role;

commit;

-- Rollback: disable Pocket receipt confirmation writes first. Keep immutable
-- intake, evidence, extraction, review, payment, allocation and audit history.
-- Drop pocket_confirm_receipt_payment, then the link-table policy/trigger/table
-- only after exporting its evidence-to-payment provenance. Do not delete shared
-- originals or reverse confirmed payments merely to remove this feature.

-- Prompt 7: Pocket reminder schedule projection and WhatsApp handoff audit.
alter table public.notifications add column if not exists push_enabled boolean not null default true;

create table if not exists public.pocket_reminder_preferences (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  obligation_id uuid not null, customer_id uuid not null,
  enabled boolean not null default true,
  due_soon_enabled boolean not null default true,
  due_today_enabled boolean not null default true,
  overdue_enabled boolean not null default true,
  still_overdue_enabled boolean not null default true,
  partial_balance_enabled boolean not null default false,
  push_enabled boolean not null default true,
  snoozed_until timestamptz, updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(obligation_id,business_id) references public.obligations(id,business_id) on delete restrict,
  foreign key(customer_id,business_id) references public.debtors(id,business_id) on delete restrict,
  unique(business_id,obligation_id)
);
create table if not exists public.pocket_reminder_schedules (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete restrict,
  obligation_id uuid not null, customer_id uuid not null,
  event_type text not null check(event_type in('due_soon','due_today','overdue','still_overdue','partial_balance')),
  notification_group text not null check(notification_group in('today','overdue','payments','system')),
  scheduled_local_date date not null, event_timezone text not null,
  source_key text not null check(char_length(source_key) between 10 and 300),
  source_fingerprint char(64) not null check(source_fingerprint~'^[0-9a-f]{64}$'),
  remaining_minor bigint not null check(remaining_minor>0), currency char(3) not null check(currency~'^[A-Z]{3}$'),
  status text not null default 'pending' check(status in('pending','snoozed','notified','cancelled')),
  snoozed_until timestamptz, notification_id uuid references public.notifications(id) on delete restrict,
  cancellation_reason text, notified_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(obligation_id,business_id) references public.obligations(id,business_id) on delete restrict,
  foreign key(customer_id,business_id) references public.debtors(id,business_id) on delete restrict,
  unique(business_id,source_key),
  check((status='snoozed')=(snoozed_until is not null)),
  check((status='notified')=(notification_id is not null)),
  check(status<>'cancelled' or cancellation_reason is not null)
);
create table if not exists public.pocket_reminder_events (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete restrict,
  obligation_id uuid not null, customer_id uuid not null,
  schedule_id uuid references public.pocket_reminder_schedules(id) on delete restrict,
  event_type text not null check(event_type in('prepared','opened_to_whatsapp')),
  template_key text not null check(template_key in('gentle','due_today','overdue','partial_balance')),
  language text not null check(language in('en','ms','zh')),
  message_sha256 char(64) not null check(message_sha256~'^[0-9a-f]{64}$'),
  remaining_minor bigint not null check(remaining_minor>0), currency char(3) not null check(currency~'^[A-Z]{3}$'),
  due_date date, user_edited boolean not null default false,
  created_by uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null, metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now(),
  foreign key(obligation_id,business_id) references public.obligations(id,business_id) on delete restrict,
  foreign key(customer_id,business_id) references public.debtors(id,business_id) on delete restrict,
  unique(business_id,idempotency_key)
);
create index if not exists pocket_reminder_schedules_due_idx on public.pocket_reminder_schedules(business_id,scheduled_local_date,status,created_at);
create index if not exists pocket_reminder_schedules_debt_idx on public.pocket_reminder_schedules(business_id,obligation_id,created_at desc);
create index if not exists pocket_reminder_events_customer_idx on public.pocket_reminder_events(business_id,customer_id,created_at desc);
create index if not exists pocket_reminder_events_debt_idx on public.pocket_reminder_events(business_id,obligation_id,created_at desc);

create or replace function public.pocket_reminder_validate_scope() returns trigger
language plpgsql set search_path=public,pg_temp as $$
declare v_debt public.obligations;
begin
  select * into v_debt from public.obligations where id=new.obligation_id and business_id=new.business_id;
  if not found or v_debt.origin_product_type<>'pocket' then raise exception 'Pocket reminder debt was not found';end if;
  if v_debt.customer_id<>new.customer_id then raise exception 'Pocket reminder customer does not match debt';end if;
  if tg_table_name='pocket_reminder_events' and new.schedule_id is not null and not exists(
    select 1 from public.pocket_reminder_schedules s where s.id=new.schedule_id and s.business_id=new.business_id
      and s.obligation_id=new.obligation_id and s.customer_id=new.customer_id
  ) then raise exception 'Pocket reminder schedule does not match debt';end if;
  if tg_table_name in('pocket_reminder_preferences','pocket_reminder_schedules') then new.updated_at:=now();end if;
  return new;
end $$;
drop trigger if exists pocket_reminder_preferences_scope on public.pocket_reminder_preferences;
create trigger pocket_reminder_preferences_scope before insert or update on public.pocket_reminder_preferences for each row execute function public.pocket_reminder_validate_scope();
drop trigger if exists pocket_reminder_schedules_scope on public.pocket_reminder_schedules;
create trigger pocket_reminder_schedules_scope before insert or update on public.pocket_reminder_schedules for each row execute function public.pocket_reminder_validate_scope();
drop trigger if exists pocket_reminder_events_scope on public.pocket_reminder_events;
create trigger pocket_reminder_events_scope before insert or update on public.pocket_reminder_events for each row execute function public.pocket_reminder_validate_scope();

create or replace function public.pocket_cancel_stale_reminder_schedules() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.origin_product_type='pocket' and(
    new.customer_id is distinct from old.customer_id or new.pocket_due_date is distinct from old.pocket_due_date
    or new.original_amount_minor is distinct from old.original_amount_minor or new.adjustments_minor is distinct from old.adjustments_minor
    or new.paid_minor is distinct from old.paid_minor or new.status is distinct from old.status or new.archived_at is distinct from old.archived_at
  )then update public.pocket_reminder_schedules set status='cancelled',snoozed_until=null,cancellation_reason='debt_changed',updated_at=now()
    where business_id=new.business_id and obligation_id=new.id and status in('pending','snoozed');end if;
  return new;
end $$;
drop trigger if exists pocket_cancel_stale_reminders_on_debt on public.obligations;
create trigger pocket_cancel_stale_reminders_on_debt after update of customer_id,pocket_due_date,original_amount_minor,adjustments_minor,paid_minor,status,archived_at
on public.obligations for each row execute function public.pocket_cancel_stale_reminder_schedules();
create or replace function public.pocket_cancel_reminders_on_contact_change() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.phone is distinct from old.phone or new.archived_at is distinct from old.archived_at or new.merged_into_id is distinct from old.merged_into_id then
    update public.pocket_reminder_schedules set status='cancelled',snoozed_until=null,cancellation_reason='customer_contact_changed',updated_at=now()
    where business_id=new.business_id and customer_id=new.id and status in('pending','snoozed');end if;
  return new;
end $$;
drop trigger if exists pocket_cancel_reminders_on_contact_change on public.debtors;
create trigger pocket_cancel_reminders_on_contact_change after update of phone,archived_at,merged_into_id on public.debtors
for each row execute function public.pocket_cancel_reminders_on_contact_change();

create or replace function public.notifications_protect_content() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if current_setting('collectboss.notification_system_write',true) is distinct from 'on' and(
    new.business_id is distinct from old.business_id or new.user_id is distinct from old.user_id
    or new.case_id is distinct from old.case_id or new.customer_id is distinct from old.customer_id
    or new.type is distinct from old.type or new.event_type is distinct from old.event_type
    or new.title is distinct from old.title or new.message is distinct from old.message
    or new.severity is distinct from old.severity or new.action_url is distinct from old.action_url
    or new.entity_type is distinct from old.entity_type or new.entity_id is distinct from old.entity_id
    or new.dedupe_key is distinct from old.dedupe_key or new.domain_event_id is distinct from old.domain_event_id
    or new.push_enabled is distinct from old.push_enabled or new.created_at is distinct from old.created_at
  )then raise exception 'Only notification read/archive state may be changed directly';end if;
  return new;
end $$;

alter table public.pocket_reminder_preferences enable row level security;
alter table public.pocket_reminder_schedules enable row level security;
alter table public.pocket_reminder_events enable row level security;
create policy pocket_reminder_preferences_tenant_read on public.pocket_reminder_preferences for select to authenticated using(business_id=public.my_business_id());
create policy pocket_reminder_schedules_tenant_read on public.pocket_reminder_schedules for select to authenticated using(business_id=public.my_business_id());
create policy pocket_reminder_events_tenant_read on public.pocket_reminder_events for select to authenticated using(business_id=public.my_business_id());
revoke all on public.pocket_reminder_preferences,public.pocket_reminder_schedules,public.pocket_reminder_events from public,anon,authenticated;
grant select on public.pocket_reminder_preferences,public.pocket_reminder_schedules,public.pocket_reminder_events to authenticated;
grant all on public.pocket_reminder_preferences,public.pocket_reminder_schedules,public.pocket_reminder_events to service_role;
+-- Prompt 8: optional Pocket Simple Invoice add-on.
-- Review after 20260917. This migration is additive and must not be applied
-- until the private storage/RLS and billing configuration have been reviewed.

begin;

create table if not exists public.pocket_invoice_sequences (
  business_id uuid not null references public.businesses(id) on delete restrict,
  sequence_year integer not null check (sequence_year between 2000 and 9999),
  last_value bigint not null default 0 check (last_value >= 0),
  updated_at timestamptz not null default now(),
  primary key (business_id, sequence_year)
);

create table if not exists public.pocket_simple_invoices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  customer_id uuid not null,
  status text not null default 'draft' check (status in ('draft','issued','partially_paid','paid','cancelled')),
  invoice_number text,
  sequence_year integer,
  sequence_value bigint,
  issue_date date,
  due_date date,
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  business_name text not null check (char_length(btrim(business_name)) between 1 and 160),
  business_contact text,
  logo_object_path text,
  customer_name text not null check (char_length(btrim(customer_name)) between 1 and 160),
  customer_contact text,
  subtotal_minor bigint not null default 0 check (subtotal_minor >= 0),
  discount_minor bigint not null default 0 check (discount_minor >= 0),
  tax_label text,
  tax_minor bigint not null default 0 check (tax_minor >= 0),
  total_minor bigint not null default 0 check (total_minor >= 0),
  note text,
  payment_instructions text,
  obligation_id uuid,
  issued_snapshot jsonb,
  pdf_object_path text,
  pdf_sha256 char(64),
  pdf_generated_at timestamptz,
  version integer not null default 1 check (version > 0),
  issued_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (customer_id,business_id) references public.debtors(id,business_id) on delete restrict,
  foreign key (obligation_id,business_id) references public.obligations(id,business_id) on delete restrict,
  unique (id,business_id),
  unique (business_id,invoice_number),
  unique (business_id,sequence_year,sequence_value),
  unique (business_id,obligation_id),
  check (issue_date is null or due_date is null or due_date >= issue_date),
  check (discount_minor <= subtotal_minor),
  check (total_minor = subtotal_minor - discount_minor + tax_minor),
  check ((tax_label is null and tax_minor=0) or nullif(btrim(tax_label),'') is not null),
  check ((status='draft' and invoice_number is null and issued_at is null and issued_snapshot is null)
    or (status<>'draft' and invoice_number is not null and issue_date is not null and due_date is not null
      and issued_at is not null and issued_snapshot is not null and sequence_year is not null and sequence_value is not null)),
  check ((status='cancelled')=(cancelled_at is not null)),
  check ((pdf_object_path is null and pdf_sha256 is null and pdf_generated_at is null)
    or (pdf_object_path is not null and pdf_sha256 ~ '^[0-9a-f]{64}$' and pdf_generated_at is not null))
);

create table if not exists public.pocket_simple_invoice_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  invoice_id uuid not null,
  position integer not null check (position between 1 and 100),
  description text not null check (char_length(btrim(description)) between 1 and 300),
  quantity_milli bigint not null check (quantity_milli > 0),
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  line_total_minor bigint not null check (line_total_minor >= 0),
  created_at timestamptz not null default now(),
  foreign key (invoice_id,business_id) references public.pocket_simple_invoices(id,business_id) on delete cascade,
  unique (invoice_id,position)
);

create table if not exists public.pocket_simple_invoice_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  invoice_id uuid not null,
  event_type text not null check (event_type in ('draft_created','draft_updated','issued','pdf_generated','whatsapp_handoff','debt_linked','cancelled')),
  actor_id uuid references auth.users(id) on delete set null,
  idempotency_key text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now(),
  foreign key (invoice_id,business_id) references public.pocket_simple_invoices(id,business_id) on delete restrict,
  unique nulls not distinct (business_id,event_type,idempotency_key)
);

create index if not exists pocket_simple_invoices_list_idx
  on public.pocket_simple_invoices(business_id,created_at desc);
create index if not exists pocket_simple_invoices_due_idx
  on public.pocket_simple_invoices(business_id,due_date,status)
  where status in ('issued','partially_paid');
create index if not exists pocket_simple_invoice_items_invoice_idx
  on public.pocket_simple_invoice_items(business_id,invoice_id,position);
create index if not exists pocket_simple_invoice_events_invoice_idx
  on public.pocket_simple_invoice_events(business_id,invoice_id,created_at desc);

-- Extend the existing Pocket reminder projection instead of creating a second
-- invoice scheduler. Invoice reminders are owner notifications only.
alter table public.pocket_reminder_schedules alter column obligation_id drop not null;
alter table public.pocket_reminder_schedules add column if not exists invoice_id uuid;
alter table public.pocket_reminder_schedules drop constraint if exists pocket_reminder_schedules_event_type_check;
alter table public.pocket_reminder_schedules add constraint pocket_reminder_schedules_event_type_check
  check (event_type in ('due_soon','due_today','overdue','still_overdue','partial_balance','invoice_due'));
alter table public.pocket_reminder_schedules drop constraint if exists pocket_reminder_schedules_source_check;
alter table public.pocket_reminder_schedules add constraint pocket_reminder_schedules_source_check
  check ((obligation_id is not null)::integer+(invoice_id is not null)::integer=1);
alter table public.pocket_reminder_schedules drop constraint if exists pocket_reminder_schedules_invoice_tenant_fk;
alter table public.pocket_reminder_schedules add constraint pocket_reminder_schedules_invoice_tenant_fk
  foreign key(invoice_id,business_id) references public.pocket_simple_invoices(id,business_id) on delete restrict;
create index if not exists pocket_reminder_schedules_invoice_idx
  on public.pocket_reminder_schedules(business_id,invoice_id,created_at desc) where invoice_id is not null;

create or replace function public.pocket_reminder_validate_scope()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare v_debt public.obligations; v_invoice public.pocket_simple_invoices;
begin
  if tg_table_name='pocket_reminder_schedules' and new.invoice_id is not null then
    select * into v_invoice from public.pocket_simple_invoices where id=new.invoice_id and business_id=new.business_id;
    if not found or v_invoice.customer_id<>new.customer_id or new.obligation_id is not null or new.event_type<>'invoice_due' then
      raise exception 'Pocket invoice reminder scope is invalid';
    end if;
    new.updated_at:=now();
    return new;
  end if;
  select * into v_debt from public.obligations where id=new.obligation_id and business_id=new.business_id;
  if not found or v_debt.origin_product_type<>'pocket' or v_debt.customer_id<>new.customer_id then
    raise exception 'Pocket reminder debt scope is invalid';
  end if;
  if tg_table_name='pocket_reminder_events' and new.schedule_id is not null and not exists(
    select 1 from public.pocket_reminder_schedules s where s.id=new.schedule_id and s.business_id=new.business_id
      and s.obligation_id=new.obligation_id and s.customer_id=new.customer_id
  ) then raise exception 'Pocket reminder schedule does not match debt'; end if;
  if tg_table_name in ('pocket_reminder_preferences','pocket_reminder_schedules') then new.updated_at:=now(); end if;
  return new;
end $$;

create or replace function public.pocket_simple_invoice_validate()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_op='UPDATE' and old.status<>'draft' then
    if new.business_id is distinct from old.business_id
      or new.customer_id is distinct from old.customer_id
      or new.invoice_number is distinct from old.invoice_number
      or new.sequence_year is distinct from old.sequence_year
      or new.sequence_value is distinct from old.sequence_value
      or new.issue_date is distinct from old.issue_date
      or new.due_date is distinct from old.due_date
      or new.currency is distinct from old.currency
      or new.business_name is distinct from old.business_name
      or new.business_contact is distinct from old.business_contact
      or new.logo_object_path is distinct from old.logo_object_path
      or new.customer_name is distinct from old.customer_name
      or new.customer_contact is distinct from old.customer_contact
      or new.subtotal_minor is distinct from old.subtotal_minor
      or new.discount_minor is distinct from old.discount_minor
      or new.tax_label is distinct from old.tax_label
      or new.tax_minor is distinct from old.tax_minor
      or new.total_minor is distinct from old.total_minor
      or new.note is distinct from old.note
      or new.payment_instructions is distinct from old.payment_instructions
      or new.issued_snapshot is distinct from old.issued_snapshot
      or new.issued_at is distinct from old.issued_at then
      raise exception 'POCKET_INVOICE_IMMUTABLE';
    end if;
    if old.status='cancelled' and new.status<>'cancelled' then raise exception 'POCKET_INVOICE_IMMUTABLE'; end if;
  end if;
  if tg_op='UPDATE' and new.version<=old.version then new.version:=old.version+1; end if;
  new.updated_at:=now();
  return new;
end $$;

drop trigger if exists pocket_simple_invoice_validate on public.pocket_simple_invoices;
create trigger pocket_simple_invoice_validate before insert or update on public.pocket_simple_invoices
for each row execute function public.pocket_simple_invoice_validate();

create or replace function public.pocket_simple_invoice_item_validate()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare v_status text;
begin
  select status into v_status from public.pocket_simple_invoices
    where id=coalesce(new.invoice_id,old.invoice_id) and business_id=coalesce(new.business_id,old.business_id);
  if v_status is distinct from 'draft' then raise exception 'POCKET_INVOICE_IMMUTABLE'; end if;
  if tg_op<>'DELETE' then
    new.line_total_minor:=((new.quantity_milli*new.unit_price_minor)+500)/1000;
    return new;
  end if;
  return old;
end $$;

drop trigger if exists pocket_simple_invoice_item_validate on public.pocket_simple_invoice_items;
create trigger pocket_simple_invoice_item_validate before insert or update or delete on public.pocket_simple_invoice_items
for each row execute function public.pocket_simple_invoice_item_validate();

create or replace function public.pocket_save_simple_invoice_draft(
  p_business_id uuid,p_actor_id uuid,p_invoice_id uuid,p_expected_version integer,
  p_payload jsonb,p_items jsonb,p_operation_key text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_invoice public.pocket_simple_invoices; v_invoice_id uuid:=coalesce(p_invoice_id,gen_random_uuid());
  v_item jsonb; v_position integer:=0; v_subtotal bigint;
begin
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id);
  if not public.pocket_is_workspace(p_business_id) or v_role not in('owner','admin','manager') then raise exception 'POCKET_INVOICE_NOT_AUTHORISED'; end if;
  perform public.pocket_authorize_capability_internal(p_business_id,p_actor_id,'pocket.invoice.create',p_operation_key,false,'{}'::jsonb);
  if jsonb_typeof(p_payload)<>'object' or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 100 then raise exception 'POCKET_INVOICE_INVALID'; end if;
  if not exists(select 1 from public.debtors where id=(p_payload->>'customerId')::uuid and business_id=p_business_id and archived_at is null and merged_into_id is null) then raise exception 'POCKET_INVOICE_CUSTOMER_NOT_FOUND'; end if;
  if p_invoice_id is null then
    insert into public.pocket_simple_invoices(id,business_id,customer_id,status,issue_date,due_date,currency,business_name,business_contact,
      logo_object_path,customer_name,customer_contact,subtotal_minor,discount_minor,tax_label,tax_minor,total_minor,note,payment_instructions,created_by,updated_by)
    values(v_invoice_id,p_business_id,(p_payload->>'customerId')::uuid,'draft',(p_payload->>'issueDate')::date,(p_payload->>'dueDate')::date,
      upper(p_payload->>'currency'),p_payload->>'businessName',nullif(p_payload->>'businessContact',''),nullif(p_payload->>'logoObjectPath',''),p_payload->>'customerName',nullif(p_payload->>'customerContact',''),
      (p_payload->>'subtotalMinor')::bigint,(p_payload->>'discountMinor')::bigint,nullif(p_payload->>'taxLabel',''),(p_payload->>'taxMinor')::bigint,
      (p_payload->>'totalMinor')::bigint,nullif(p_payload->>'note',''),nullif(p_payload->>'paymentInstructions',''),p_actor_id,p_actor_id)
    returning * into v_invoice;
  else
    select * into v_invoice from public.pocket_simple_invoices where id=p_invoice_id and business_id=p_business_id for update;
    if not found then raise exception 'POCKET_INVOICE_NOT_FOUND'; end if;
    if v_invoice.status<>'draft' then raise exception 'POCKET_INVOICE_IMMUTABLE'; end if;
    if p_expected_version is null or v_invoice.version<>p_expected_version then raise exception 'POCKET_INVOICE_STALE'; end if;
    update public.pocket_simple_invoices set customer_id=(p_payload->>'customerId')::uuid,issue_date=(p_payload->>'issueDate')::date,
      due_date=(p_payload->>'dueDate')::date,currency=upper(p_payload->>'currency'),business_name=p_payload->>'businessName',
      business_contact=nullif(p_payload->>'businessContact',''),logo_object_path=nullif(p_payload->>'logoObjectPath',''),customer_name=p_payload->>'customerName',customer_contact=nullif(p_payload->>'customerContact',''),
      subtotal_minor=(p_payload->>'subtotalMinor')::bigint,discount_minor=(p_payload->>'discountMinor')::bigint,tax_label=nullif(p_payload->>'taxLabel',''),
      tax_minor=(p_payload->>'taxMinor')::bigint,total_minor=(p_payload->>'totalMinor')::bigint,note=nullif(p_payload->>'note',''),
      payment_instructions=nullif(p_payload->>'paymentInstructions',''),updated_by=p_actor_id
    where id=v_invoice_id returning * into v_invoice;
    delete from public.pocket_simple_invoice_items where invoice_id=v_invoice_id and business_id=p_business_id;
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_position:=v_position+1;
    insert into public.pocket_simple_invoice_items(business_id,invoice_id,position,description,quantity_milli,unit_price_minor,line_total_minor)
    values(p_business_id,v_invoice_id,v_position,v_item->>'description',(v_item->>'quantityMilli')::bigint,(v_item->>'unitPriceMinor')::bigint,(v_item->>'lineTotalMinor')::bigint);
  end loop;
  select coalesce(sum(line_total_minor),0) into v_subtotal from public.pocket_simple_invoice_items where invoice_id=v_invoice_id and business_id=p_business_id;
  if v_subtotal<>v_invoice.subtotal_minor then raise exception 'POCKET_INVOICE_TOTAL_MISMATCH'; end if;
  insert into public.pocket_simple_invoice_events(business_id,invoice_id,event_type,actor_id,idempotency_key,metadata)
  values(p_business_id,v_invoice_id,case when p_invoice_id is null then 'draft_created' else 'draft_updated' end,p_actor_id,p_operation_key,
    jsonb_build_object('version',v_invoice.version,'total_minor',v_invoice.total_minor)) on conflict do nothing;
  return jsonb_build_object('invoiceId',v_invoice_id,'version',v_invoice.version,'status','draft');
end $$;

create or replace function public.pocket_issue_simple_invoice(
  p_business_id uuid,p_actor_id uuid,p_invoice_id uuid,p_expected_version integer,p_operation_key text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_invoice public.pocket_simple_invoices; v_year integer; v_sequence bigint; v_number text;
  v_subtotal bigint; v_items jsonb; v_authorization jsonb;
begin
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id);
  if not public.pocket_is_workspace(p_business_id) or v_role not in('owner','admin','manager') then raise exception 'POCKET_INVOICE_NOT_AUTHORISED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':pocket-invoice:'||p_invoice_id::text,0));
  select * into v_invoice from public.pocket_simple_invoices where id=p_invoice_id and business_id=p_business_id for update;
  if not found then raise exception 'POCKET_INVOICE_NOT_FOUND'; end if;
  if v_invoice.status<>'draft' then
    if v_invoice.invoice_number is not null then return jsonb_build_object('invoiceId',v_invoice.id,'invoiceNumber',v_invoice.invoice_number,'status',v_invoice.status,'idempotentReplay',true); end if;
    raise exception 'POCKET_INVOICE_INVALID_STATE';
  end if;
  if v_invoice.version<>p_expected_version then raise exception 'POCKET_INVOICE_STALE'; end if;
  select coalesce(sum(line_total_minor),0),jsonb_agg(jsonb_build_object(
    'description',description,'quantityMilli',quantity_milli,'unitPriceMinor',unit_price_minor,'lineTotalMinor',line_total_minor
  ) order by position) into v_subtotal,v_items from public.pocket_simple_invoice_items where invoice_id=p_invoice_id and business_id=p_business_id;
  if v_subtotal<=0 or v_items is null then raise exception 'POCKET_INVOICE_EMPTY'; end if;
  if v_subtotal<>v_invoice.subtotal_minor or v_invoice.total_minor<=0 then raise exception 'POCKET_INVOICE_TOTAL_MISMATCH'; end if;
  v_year:=extract(year from v_invoice.issue_date)::integer;
  insert into public.pocket_invoice_sequences(business_id,sequence_year,last_value) values(p_business_id,v_year,0) on conflict do nothing;
  select last_value+1 into v_sequence from public.pocket_invoice_sequences where business_id=p_business_id and sequence_year=v_year for update;
  v_number:='CBP-'||v_year::text||'-'||lpad(v_sequence::text,6,'0');
  v_authorization:=public.pocket_commit_invoice_usage(p_business_id,p_actor_id,p_invoice_id,v_number,p_operation_key);
  update public.pocket_invoice_sequences set last_value=v_sequence,updated_at=now() where business_id=p_business_id and sequence_year=v_year;
  update public.pocket_simple_invoices set
    status='issued',invoice_number=v_number,sequence_year=v_year,sequence_value=v_sequence,issued_at=now(),
    issued_snapshot=jsonb_build_object(
      'formatVersion',1,'invoiceNumber',v_number,'businessName',business_name,'businessContact',business_contact,
      'customerId',customer_id,'customerName',customer_name,'customerContact',customer_contact,
      'issueDate',issue_date,'dueDate',due_date,'currency',currency,'logoObjectPath',logo_object_path,'items',v_items,
      'subtotalMinor',subtotal_minor,'discountMinor',discount_minor,'taxLabel',tax_label,'taxMinor',tax_minor,
      'totalMinor',total_minor,'note',note,'paymentInstructions',payment_instructions,
      'disclaimer','NOT AN OFFICIAL E-INVOICE SERVICE'
    ),updated_by=p_actor_id
  where id=p_invoice_id;
  insert into public.pocket_simple_invoice_events(business_id,invoice_id,event_type,actor_id,idempotency_key,metadata)
    values(p_business_id,p_invoice_id,'issued',p_actor_id,p_operation_key,jsonb_build_object('invoice_number',v_number,'usage',v_authorization))
    on conflict do nothing;
  return jsonb_build_object('invoiceId',p_invoice_id,'invoiceNumber',v_number,'status','issued','idempotentReplay',false,'authorization',v_authorization);
end $$;

create or replace function public.pocket_convert_invoice_to_debt(
  p_business_id uuid,p_actor_id uuid,p_invoice_id uuid,p_operation_key text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_invoice public.pocket_simple_invoices; v_debt_id uuid; v_status text;
begin
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id);
  if not public.pocket_is_workspace(p_business_id) or v_role not in('owner','admin','manager') then raise exception 'POCKET_INVOICE_NOT_AUTHORISED'; end if;
  perform public.pocket_authorize_capability_internal(p_business_id,p_actor_id,'pocket.debt.manage',p_operation_key,false,'{}'::jsonb);
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':pocket-invoice-debt:'||p_invoice_id::text,0));
  select * into v_invoice from public.pocket_simple_invoices where id=p_invoice_id and business_id=p_business_id for update;
  if not found then raise exception 'POCKET_INVOICE_NOT_FOUND'; end if;
  if v_invoice.status not in('issued','partially_paid','paid') then raise exception 'POCKET_INVOICE_INVALID_STATE'; end if;
  if v_invoice.obligation_id is not null then
    return jsonb_build_object('invoiceId',p_invoice_id,'debtId',v_invoice.obligation_id,'idempotentReplay',true);
  end if;
  v_debt_id:=gen_random_uuid();
  v_status:=case when v_invoice.due_date<(now() at time zone coalesce((select timezone from public.businesses where id=p_business_id),'UTC'))::date then 'overdue' else 'open' end;
  insert into public.obligations(id,business_id,customer_id,account_id,obligation_type,reference,issue_date,due_date,currency,
    original_amount_minor,adjustments_minor,paid_minor,status,metadata,custom_fields,origin_product_type,pocket_description,pocket_debt_date,pocket_due_date)
  values(v_debt_id,p_business_id,v_invoice.customer_id,null,'invoice',v_invoice.invoice_number,v_invoice.issue_date,v_invoice.due_date,v_invoice.currency,
    v_invoice.total_minor,0,0,v_status,jsonb_build_object('pocket',jsonb_build_object('version',1,'simple_invoice_id',p_invoice_id)),
    '{}'::jsonb,'pocket','Invoice '||v_invoice.invoice_number,v_invoice.issue_date,v_invoice.due_date);
  update public.pocket_simple_invoices set obligation_id=v_debt_id,updated_by=p_actor_id where id=p_invoice_id;
  insert into public.pocket_simple_invoice_events(business_id,invoice_id,event_type,actor_id,idempotency_key,metadata)
    values(p_business_id,p_invoice_id,'debt_linked',p_actor_id,p_operation_key,jsonb_build_object('obligation_id',v_debt_id))
    on conflict do nothing;
  return jsonb_build_object('invoiceId',p_invoice_id,'debtId',v_debt_id,'idempotentReplay',false);
end $$;

create or replace function public.pocket_sync_invoice_payment_status()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update public.pocket_simple_invoices set status=case when new.outstanding_minor=0 then 'paid' when new.paid_minor>0 then 'partially_paid' else 'issued' end
  where business_id=new.business_id and obligation_id=new.id and status<>'cancelled';
  return new;
end $$;
drop trigger if exists pocket_sync_invoice_payment_status on public.obligations;
create trigger pocket_sync_invoice_payment_status after update of paid_minor,status on public.obligations
for each row execute function public.pocket_sync_invoice_payment_status();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('pocket-invoices','pocket-invoices',false,10485760,array['application/pdf','image/jpeg','image/png']::text[])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

alter table public.pocket_invoice_sequences enable row level security;
alter table public.pocket_simple_invoices enable row level security;
alter table public.pocket_simple_invoice_items enable row level security;
alter table public.pocket_simple_invoice_events enable row level security;
drop policy if exists pocket_simple_invoices_tenant_read on public.pocket_simple_invoices;
create policy pocket_simple_invoices_tenant_read on public.pocket_simple_invoices for select to authenticated using(business_id=public.my_business_id());
drop policy if exists pocket_simple_invoice_items_tenant_read on public.pocket_simple_invoice_items;
create policy pocket_simple_invoice_items_tenant_read on public.pocket_simple_invoice_items for select to authenticated using(business_id=public.my_business_id());
drop policy if exists pocket_simple_invoice_events_tenant_read on public.pocket_simple_invoice_events;
create policy pocket_simple_invoice_events_tenant_read on public.pocket_simple_invoice_events for select to authenticated using(business_id=public.my_business_id());
revoke all on public.pocket_invoice_sequences,public.pocket_simple_invoices,public.pocket_simple_invoice_items,public.pocket_simple_invoice_events from public,anon,authenticated;
grant select on public.pocket_simple_invoices,public.pocket_simple_invoice_items,public.pocket_simple_invoice_events to authenticated;
grant select,insert,update on public.pocket_invoice_sequences,public.pocket_simple_invoices,public.pocket_simple_invoice_items to service_role;
grant select,insert on public.pocket_simple_invoice_events to service_role;
revoke all on function public.pocket_issue_simple_invoice(uuid,uuid,uuid,integer,text) from public,anon,authenticated;
revoke all on function public.pocket_convert_invoice_to_debt(uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.pocket_save_simple_invoice_draft(uuid,uuid,uuid,integer,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.pocket_issue_simple_invoice(uuid,uuid,uuid,integer,text) to service_role;
grant execute on function public.pocket_convert_invoice_to_debt(uuid,uuid,uuid,text) to service_role;
grant execute on function public.pocket_save_simple_invoice_draft(uuid,uuid,uuid,integer,jsonb,jsonb,text) to service_role;

commit;

-- Rollback: first export retained invoice PDFs and invoice/event rows. Then remove
-- the private bucket objects, drop the sync/item/validation triggers and functions,
-- drop invoice events/items/invoices/sequences in that order, and finally remove
-- the pocket-invoices bucket. Do not delete linked obligations or payment history.

-- Prompt 10: staged, idempotent Pocket-to-Solo upgrade.
-- Additive proposal only. Review and apply to a backed-up staging database
-- after migrations 20260912 through 20260918. This file is not evidence that
-- any remote migration, backup, billing checkout, or rollback rehearsal ran.

begin;

create table if not exists public.pocket_solo_upgrade_runs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  initiated_by uuid not null references auth.users(id) on delete restrict,
  status text not null default 'prepared' check (status in (
    'prepared','review_required','checkout_pending','processing','completed','failed'
  )),
  target_plan_slug text not null default 'starter' check (target_plan_slug='starter'),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 120),
  request_hash char(64) not null check (request_hash ~ '^[0-9a-f]{64}$'),
  checkout_session_id text unique,
  provider_event_id text unique,
  source_counts jsonb not null default '{}'::jsonb check (jsonb_typeof(source_counts)='object'),
  reconciliation jsonb not null default '{}'::jsonb check (jsonb_typeof(reconciliation)='object'),
  pocket_subscription_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(pocket_subscription_ids)='array'),
  pocket_subscription_cleanup_status text not null default 'not_started'
    check (pocket_subscription_cleanup_status in ('not_started','pending','completed','failed')),
  last_error_code text,
  started_at timestamptz not null default now(),
  checkout_attached_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (business_id,idempotency_key)
);

create unique index if not exists pocket_solo_upgrade_one_completed_business_idx
  on public.pocket_solo_upgrade_runs(business_id) where status='completed';
create unique index if not exists pocket_solo_upgrade_one_active_business_idx
  on public.pocket_solo_upgrade_runs(business_id) where status in('prepared','checkout_pending','processing');
create index if not exists pocket_solo_upgrade_runs_business_created_idx
  on public.pocket_solo_upgrade_runs(business_id,started_at desc);

create table if not exists public.pocket_solo_upgrade_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.pocket_solo_upgrade_runs(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  obligation_id uuid not null,
  disposition text not null check (disposition in (
    'migrate_active','migrate_settled','preserve_cancelled',
    'review_disputed','review_ambiguous','review_malformed'
  )),
  status text not null check (status in ('ready','preserve_only','review_required','migrated')),
  review_reason text,
  target_case_id text,
  source_snapshot jsonb not null check (jsonb_typeof(source_snapshot)='object'),
  reconciliation jsonb not null default '{}'::jsonb check (jsonb_typeof(reconciliation)='object'),
  created_at timestamptz not null default now(),
  migrated_at timestamptz,
  foreign key(obligation_id,business_id) references public.obligations(id,business_id) on delete restrict,
  foreign key(target_case_id,business_id) references public.cases(id,business_id) on delete restrict,
  unique(run_id,obligation_id)
);

create index if not exists pocket_solo_upgrade_items_review_idx
  on public.pocket_solo_upgrade_items(business_id,run_id,status,created_at);

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

create or replace function public.pocket_prepare_solo_upgrade(
  p_business_id uuid,p_actor_id uuid,p_idempotency_key text,p_request_hash text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_run public.pocket_solo_upgrade_runs;
  v_review_count integer;
begin
  if char_length(btrim(coalesce(p_idempotency_key,''))) not between 8 and 120
    or p_request_hash !~ '^[0-9a-f]{64}$' then raise exception 'POCKET_UPGRADE_INVALID_REQUEST'; end if;
  if not exists(select 1 from public.businesses where id=p_business_id and owner_id=p_actor_id) then
    raise exception 'POCKET_UPGRADE_OWNER_REQUIRED';
  end if;
  if exists(select 1 from public.business_memberships where business_id=p_business_id and status='active') then
    raise exception 'POCKET_UPGRADE_SINGLE_USER_REQUIRED';
  end if;
  if not exists(select 1 from public.workspace_product_states where business_id=p_business_id and product_type='pocket') then
    raise exception 'POCKET_UPGRADE_SOURCE_NOT_POCKET';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':pocket-solo-upgrade',0));
  select * into v_run from public.pocket_solo_upgrade_runs
    where business_id=p_business_id and idempotency_key=btrim(p_idempotency_key) for update;
  if found then
    if v_run.request_hash<>p_request_hash then raise exception 'POCKET_UPGRADE_IDEMPOTENCY_CONFLICT'; end if;
    return jsonb_build_object('runId',v_run.id,'status',v_run.status,'counts',v_run.source_counts,'idempotentReplay',true);
  end if;
  if exists(select 1 from public.pocket_solo_upgrade_runs where business_id=p_business_id and status='completed') then
    raise exception 'POCKET_UPGRADE_ALREADY_COMPLETED';
  end if;

  select * into v_run from public.pocket_solo_upgrade_runs
    where business_id=p_business_id and status in('prepared','checkout_pending','processing')
    order by started_at desc limit 1 for update;
  if found then
    return jsonb_build_object('runId',v_run.id,'status',v_run.status,'counts',v_run.source_counts,'idempotentReplay',true);
  end if;
  -- A new preparation is the explicit refresh path after the owner corrects
  -- review-queue source records. Historical review snapshots remain auditable.
  update public.pocket_solo_upgrade_runs set status='failed',last_error_code='REVIEW_REFRESHED',updated_at=now()
    where business_id=p_business_id and status='review_required';

  insert into public.pocket_solo_upgrade_runs(
    business_id,initiated_by,idempotency_key,request_hash
  ) values(p_business_id,p_actor_id,btrim(p_idempotency_key),p_request_hash)
  returning * into v_run;

  insert into public.pocket_solo_upgrade_items(
    run_id,business_id,obligation_id,disposition,status,review_reason,target_case_id,source_snapshot
  )
  select
    v_run.id,o.business_id,o.id,
    case
      when rco.obligation_id is not null then 'review_ambiguous'
      when o.status='disputed' then 'review_disputed'
      when d.id is null or o.due_date is null or o.currency !~ '^[A-Z]{3}$'
        or nullif(btrim(o.reference),'') is null
        or o.original_amount_minor+o.adjustments_minor<o.paid_minor then 'review_malformed'
      when o.archived_at is not null or o.status in('draft','void','written_off') then 'preserve_cancelled'
      when o.status='paid' or o.outstanding_minor=0 then 'migrate_settled'
      else 'migrate_active'
    end,
    case
      when rco.obligation_id is not null or o.status='disputed' or d.id is null or o.due_date is null
        or o.currency !~ '^[A-Z]{3}$' or nullif(btrim(o.reference),'') is null
        or o.original_amount_minor+o.adjustments_minor<o.paid_minor then 'review_required'
      when o.archived_at is not null or o.status in('draft','void','written_off') then 'preserve_only'
      else 'ready'
    end,
    case
      when rco.obligation_id is not null then 'Debt is already linked to a recovery case.'
      when o.status='disputed' then 'Disputed debt requires an authorised mapping decision.'
      when d.id is null then 'Customer ownership could not be verified.'
      when o.due_date is null or o.currency !~ '^[A-Z]{3}$' or nullif(btrim(o.reference),'') is null
        or o.original_amount_minor+o.adjustments_minor<o.paid_minor then 'Debt financial or identifying fields require review.'
      when o.archived_at is not null or o.status in('draft','void','written_off')
        then 'Cancelled, draft, written-off, or archived debt is preserved without an active Solo case.'
      else null
    end,
    case when rco.obligation_id is null and o.status<>'disputed' and o.archived_at is null
      and o.status not in('draft','void','written_off')
      then 'CB-SOLO-'||substr(replace(o.id::text,'-',''),1,20) end,
    jsonb_build_object(
      'customerId',o.customer_id,'reference',o.reference,'currency',o.currency,'status',o.status,
      'originalAmountMinor',o.original_amount_minor,'adjustmentsMinor',o.adjustments_minor,
      'contractualDueMinor',o.contractual_due_minor,'paidMinor',o.paid_minor,
      'outstandingMinor',o.outstanding_minor,'dueDate',o.due_date,'archivedAt',o.archived_at,
      'allocationCount',(select count(*) from public.payment_allocations pa where pa.business_id=o.business_id and pa.obligation_id=o.id),
      'receiptLinkCount',(select count(*) from public.pocket_receipt_payment_links pr where pr.business_id=o.business_id and pr.debt_id=o.id),
      'reminderEventCount',(select count(*) from public.pocket_reminder_events pe where pe.business_id=o.business_id and pe.obligation_id=o.id),
      'invoiceCount',(select count(*) from public.pocket_simple_invoices pi where pi.business_id=o.business_id and pi.obligation_id=o.id)
    )
  from public.obligations o
  left join public.debtors d on d.id=o.customer_id and d.business_id=o.business_id
  left join public.recovery_case_obligations rco on rco.obligation_id=o.id
  where o.business_id=p_business_id and o.origin_product_type='pocket';

  select count(*) into v_review_count from public.pocket_solo_upgrade_items
    where run_id=v_run.id and status='review_required';
  update public.pocket_solo_upgrade_runs set
    status=case when v_review_count>0 then 'review_required' else 'prepared' end,
    source_counts=jsonb_build_object(
      'customers',(select count(*) from public.debtors where business_id=p_business_id),
      'debts',(select count(*) from public.obligations where business_id=p_business_id and origin_product_type='pocket'),
      'migrate',(select count(*) from public.pocket_solo_upgrade_items where run_id=v_run.id and status='ready'),
      'preserveOnly',(select count(*) from public.pocket_solo_upgrade_items where run_id=v_run.id and status='preserve_only'),
      'reviewRequired',v_review_count,
      'paymentEvents',(select count(*) from public.payment_allocations where business_id=p_business_id and obligation_id is not null),
      'receipts',(select count(*) from public.pocket_receipt_payment_links where business_id=p_business_id),
      'reminderEvents',(select count(*) from public.pocket_reminder_events where business_id=p_business_id),
      'simpleInvoices',(select count(*) from public.pocket_simple_invoices where business_id=p_business_id)
    ),updated_at=now()
  where id=v_run.id returning * into v_run;
  insert into public.audit_logs(business_id,action,actor_type,actor_id,entity_type,entity_id,idempotency_key,metadata)
  values(p_business_id,'pocket.solo_upgrade.prepared','owner',p_actor_id,'pocket_solo_upgrade',v_run.id::text,
    p_idempotency_key,jsonb_build_object('status',v_run.status,'counts',v_run.source_counts));
  return jsonb_build_object('runId',v_run.id,'status',v_run.status,'counts',v_run.source_counts,'idempotentReplay',false);
end $$;

create or replace function public.pocket_attach_solo_upgrade_checkout(
  p_business_id uuid,p_actor_id uuid,p_run_id uuid,p_checkout_session_id text
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not exists(select 1 from public.businesses where id=p_business_id and owner_id=p_actor_id) then
    raise exception 'POCKET_UPGRADE_OWNER_REQUIRED';
  end if;
  update public.pocket_solo_upgrade_runs set status='checkout_pending',
    checkout_session_id=p_checkout_session_id,checkout_attached_at=coalesce(checkout_attached_at,now()),updated_at=now()
  where id=p_run_id and business_id=p_business_id and status in('prepared','checkout_pending')
    and (checkout_session_id is null or checkout_session_id=p_checkout_session_id);
  if not found then raise exception 'POCKET_UPGRADE_CHECKOUT_CONFLICT'; end if;
end $$;

create or replace function public.pocket_commit_solo_upgrade(
  p_business_id uuid,p_run_id uuid,p_actor_id uuid,p_provider_event_id text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_run public.pocket_solo_upgrade_runs;
  v_item public.pocket_solo_upgrade_items;
  v_obligation public.obligations;
  v_customer public.debtors;
  v_case_status text;
  v_subscription_ids jsonb;
  v_migrated integer:=0;
  v_due bigint:=0;
  v_paid bigint:=0;
  v_outstanding bigint:=0;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':pocket-solo-upgrade',0));
  select * into v_run from public.pocket_solo_upgrade_runs
    where id=p_run_id and business_id=p_business_id for update;
  if not found then raise exception 'POCKET_UPGRADE_RUN_NOT_FOUND'; end if;
  if v_run.status='completed' then
    return jsonb_build_object('runId',v_run.id,'status','completed','reconciliation',v_run.reconciliation,
      'pocketSubscriptionIds',v_run.pocket_subscription_ids,'idempotentReplay',true);
  end if;
  if v_run.status<>'checkout_pending' or v_run.initiated_by<>p_actor_id then
    raise exception 'POCKET_UPGRADE_NOT_READY';
  end if;
  if exists(select 1 from public.pocket_solo_upgrade_items where run_id=p_run_id and status='review_required') then
    raise exception 'POCKET_UPGRADE_REVIEW_REQUIRED';
  end if;
  if not exists(select 1 from public.subscriptions where business_id=p_business_id
    and plan_slug='starter' and status in('active','trialing')) then
    raise exception 'POCKET_UPGRADE_SOLO_SUBSCRIPTION_REQUIRED';
  end if;
  if not exists(select 1 from public.workspace_product_states where business_id=p_business_id and product_type='pocket') then
    raise exception 'POCKET_UPGRADE_SOURCE_NOT_POCKET';
  end if;

  -- Validate every source snapshot before the first financial projection write.
  for v_item in select * from public.pocket_solo_upgrade_items where run_id=p_run_id and status='ready' order by obligation_id loop
    select * into v_obligation from public.obligations
      where id=v_item.obligation_id and business_id=p_business_id and origin_product_type='pocket' for update;
    if not found or v_obligation.customer_id::text<>v_item.source_snapshot->>'customerId'
      or v_obligation.status<>v_item.source_snapshot->>'status'
      or v_obligation.contractual_due_minor<>(v_item.source_snapshot->>'contractualDueMinor')::bigint
      or v_obligation.paid_minor<>(v_item.source_snapshot->>'paidMinor')::bigint
      or v_obligation.outstanding_minor<>(v_item.source_snapshot->>'outstandingMinor')::bigint then
      raise exception 'POCKET_UPGRADE_SOURCE_CHANGED';
    end if;
  end loop;

  update public.pocket_solo_upgrade_runs set status='processing',provider_event_id=p_provider_event_id,updated_at=now()
    where id=p_run_id;

  for v_item in select * from public.pocket_solo_upgrade_items where run_id=p_run_id and status='ready' order by obligation_id loop
    select * into v_obligation from public.obligations where id=v_item.obligation_id and business_id=p_business_id;
    select * into v_customer from public.debtors where id=v_obligation.customer_id and business_id=p_business_id;
    v_case_status:=case when v_obligation.status='paid' or v_obligation.outstanding_minor=0 then 'paid'
      when v_obligation.status='overdue' then 'overdue'
      when v_obligation.paid_minor>0 then 'partial_paid' else 'action_needed' end;
    insert into public.cases(
      id,business_id,debtor_id,account_id,case_scope,debtor_type,debtor_name,debtor_phone,debtor_email,
      debtor_company,debtor_reg_no,debtor_location,currency,amount_owed,amount_paid,
      original_principal_minor,contractual_due_minor,approved_payment_minor,outstanding_minor,overpayment_minor,
      due_date,invoice_no,status,payment_lock_mode,notes,metadata
    ) values(
      v_item.target_case_id,p_business_id,v_customer.id,v_obligation.account_id,'single_obligation',v_customer.debtor_type,
      coalesce(v_customer.business_name,v_customer.individual_name,''),v_customer.phone,v_customer.email,
      case when v_customer.debtor_type='business' then v_customer.business_name end,v_customer.registration_no,v_customer.address,
      v_obligation.currency,public.currency_minor_to_major(v_obligation.contractual_due_minor,v_obligation.currency),
      public.currency_minor_to_major(v_obligation.paid_minor,v_obligation.currency),v_obligation.original_amount_minor,
      v_obligation.contractual_due_minor,v_obligation.paid_minor,v_obligation.outstanding_minor,0,v_obligation.due_date,
      coalesce((select invoice_number from public.pocket_simple_invoices where business_id=p_business_id
        and obligation_id=v_obligation.id limit 1),v_obligation.reference),v_case_status,'approval',
      'Upgraded from CollectBoss Pocket without copying the authoritative debt or payment ledger.',
      jsonb_build_object('source_product','pocket','source_obligation_id',v_obligation.id,'upgrade_run_id',p_run_id)
    ) on conflict(id) do nothing;
    if not exists(select 1 from public.cases where id=v_item.target_case_id and business_id=p_business_id
      and debtor_id=v_obligation.customer_id and contractual_due_minor=v_obligation.contractual_due_minor
      and approved_payment_minor=v_obligation.paid_minor and outstanding_minor=v_obligation.outstanding_minor) then
      raise exception 'POCKET_UPGRADE_CASE_CONFLICT';
    end if;
    insert into public.recovery_case_obligations(case_id,obligation_id,business_id,linked_by)
      values(v_item.target_case_id,v_obligation.id,p_business_id,p_actor_id)
      on conflict(obligation_id) do nothing;
    if not exists(select 1 from public.recovery_case_obligations where obligation_id=v_obligation.id
      and case_id=v_item.target_case_id and business_id=p_business_id) then
      raise exception 'POCKET_UPGRADE_LINK_CONFLICT';
    end if;
    perform public.receivables_sync_case_obligations(v_item.target_case_id);
    update public.pocket_solo_upgrade_items set status='migrated',migrated_at=now(),
      reconciliation=jsonb_build_object('caseId',v_item.target_case_id,
        'contractualDueMinor',v_obligation.contractual_due_minor,'paidMinor',v_obligation.paid_minor,
        'outstandingMinor',v_obligation.outstanding_minor,'reconciled',true)
      where id=v_item.id;
    v_migrated:=v_migrated+1;
    v_due:=v_due+v_obligation.contractual_due_minor;
    v_paid:=v_paid+v_obligation.paid_minor;
    v_outstanding:=v_outstanding+v_obligation.outstanding_minor;
  end loop;

  update public.pocket_reminder_schedules set status='cancelled',snoozed_until=null,
    cancellation_reason='workspace_upgraded_to_solo',updated_at=now()
  where business_id=p_business_id and status in('pending','snoozed');

  select coalesce(jsonb_agg(distinct provider_subscription_id),'[]'::jsonb) into v_subscription_ids
  from public.workspace_subscription_items where business_id=p_business_id
    and offer_key in('pocket_monthly','pocket_annual','pocket_invoice_addon')
    and provider_status<>'canceled';

  update public.workspace_product_states set product_type='main',lifecycle_state='active',updated_by=p_actor_id
    where business_id=p_business_id and product_type='pocket';
  if not found then raise exception 'POCKET_UPGRADE_PRODUCT_SWITCH_CONFLICT'; end if;

  update public.pocket_solo_upgrade_runs set status='completed',completed_at=now(),updated_at=now(),
    pocket_subscription_ids=v_subscription_ids,
    pocket_subscription_cleanup_status=case when jsonb_array_length(v_subscription_ids)>0 then 'pending' else 'completed' end,
    reconciliation=jsonb_build_object('migratedCases',v_migrated,'contractualDueMinor',v_due,
      'paidMinor',v_paid,'outstandingMinor',v_outstanding,
      'sourceDebts',(source_counts->>'debts')::integer,
      'preserveOnly',(source_counts->>'preserveOnly')::integer,'reviewRequired',0,'reconciled',v_due-v_paid=v_outstanding)
  where id=p_run_id returning * into v_run;
  if (v_run.reconciliation->>'reconciled')::boolean is distinct from true then
    raise exception 'POCKET_UPGRADE_FINANCIAL_MISMATCH';
  end if;
  insert into public.audit_logs(business_id,action,actor_type,actor_id,entity_type,entity_id,metadata)
  values(p_business_id,'pocket.solo_upgrade.completed','system',p_actor_id,'pocket_solo_upgrade',p_run_id::text,
    jsonb_build_object('provider_event_id',p_provider_event_id,'reconciliation',v_run.reconciliation));
  return jsonb_build_object('runId',v_run.id,'status',v_run.status,'reconciliation',v_run.reconciliation,
    'pocketSubscriptionIds',v_subscription_ids,'idempotentReplay',false);
end $$;

create or replace function public.pocket_mark_solo_upgrade_cleanup(
  p_business_id uuid,p_run_id uuid,p_status text,p_error_code text default null
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if p_status not in('completed','failed') then raise exception 'POCKET_UPGRADE_INVALID_CLEANUP_STATUS'; end if;
  update public.pocket_solo_upgrade_runs set pocket_subscription_cleanup_status=p_status,
    last_error_code=case when p_status='failed' then left(coalesce(p_error_code,'BILLING_CLEANUP_FAILED'),100) else null end,
    updated_at=now() where id=p_run_id and business_id=p_business_id and status='completed';
  if not found then raise exception 'POCKET_UPGRADE_RUN_NOT_FOUND'; end if;
end $$;

revoke all on function public.pocket_prepare_solo_upgrade(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.pocket_attach_solo_upgrade_checkout(uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.pocket_commit_solo_upgrade(uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.pocket_mark_solo_upgrade_cleanup(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.pocket_prepare_solo_upgrade(uuid,uuid,text,text) to service_role;
grant execute on function public.pocket_attach_solo_upgrade_checkout(uuid,uuid,uuid,text) to service_role;
grant execute on function public.pocket_commit_solo_upgrade(uuid,uuid,uuid,text) to service_role;
grant execute on function public.pocket_mark_solo_upgrade_cleanup(uuid,uuid,text,text) to service_role;

commit;

-- Rollback: disable the upgrade checkout and webhook commit path first. Keep
-- completed run/item rows and recovery links as financial provenance. Before
-- first successful use only, the four functions, two policies, two tables and
-- indexes may be dropped in reverse dependency order. Solo-to-Pocket downgrade
-- is intentionally unsupported in V1; never delete cases or unlink obligations
-- to simulate a downgrade. Use the verified backup/restore procedure for a
-- financial incident.




revoke all on function public.pocket_reminder_validate_scope() from public,anon,authenticated;
revoke all on function public.pocket_cancel_stale_reminder_schedules() from public,anon,authenticated;
revoke all on function public.pocket_cancel_reminders_on_contact_change() from public,anon,authenticated;

-- Recurring charges (migration 20260920_recurring_charges.sql)
create table if not exists public.recurring_charges (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_id uuid not null references public.debtors(id) on delete restrict,
  account_id uuid not null,
  label text not null,
  reference_prefix text not null,
  obligation_type text not null default 'invoice'
    check (obligation_type in ('invoice','general_obligation','rent','vehicle','property','project','supplier','catering_event','other')),
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  day_of_month smallint not null check (day_of_month between 1 and 28),
  due_days smallint not null default 0 check (due_days between 0 and 60),
  start_date date not null,
  end_date date,
  next_run_date date not null,
  last_generated_period text,
  status text not null default 'active' check (status in ('active','paused','ended')),
  last_error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recurring_charges_label_check check (nullif(btrim(label), '') is not null),
  constraint recurring_charges_prefix_check check (reference_prefix ~ '^[A-Z0-9][A-Z0-9-]{0,23}$'),
  constraint recurring_charges_dates_check check (end_date is null or end_date >= start_date),
  constraint recurring_charges_account_fk foreign key (account_id, business_id, customer_id)
    references public.customer_accounts(id, business_id, customer_id) on delete restrict
);

create index if not exists recurring_charges_due_idx
  on public.recurring_charges (next_run_date) where status = 'active';
create index if not exists recurring_charges_account_idx
  on public.recurring_charges (business_id, account_id);

alter table public.recurring_charges enable row level security;
drop policy if exists "recurring_charges: tenant read" on public.recurring_charges;
create policy "recurring_charges: tenant read" on public.recurring_charges
  for select to authenticated using (has_business_permission(business_id, 'case.read'));
-- Writes go through the reviewed API route with the service role.
revoke insert, update, delete on public.recurring_charges from anon, authenticated;
grant select on public.recurring_charges to authenticated;
grant all on public.recurring_charges to service_role;

create or replace function public.recurring_charges_generate(p_today date default null, p_limit integer default 500)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_today date := coalesce(p_today, (now() at time zone 'Asia/Kuala_Lumpur')::date);
  v_charge public.recurring_charges;
  v_period date;
  v_reference text;
  v_created integer := 0;
  v_failed integer := 0;
  v_iterations integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'service role required'; end if;
  for v_charge in
    select * from public.recurring_charges
    where status = 'active' and next_run_date <= v_today
    order by next_run_date
    limit greatest(1, least(coalesce(p_limit, 500), 2000))
    for update skip locked
  loop
    begin
      v_period := v_charge.next_run_date;
      v_iterations := 0;
      -- Catch up at most 12 missed periods per run.
      while v_period <= v_today and v_iterations < 12
        and (v_charge.end_date is null or v_period <= v_charge.end_date) loop
        v_reference := v_charge.reference_prefix || '-' || to_char(v_period, 'YYYY-MM');
        insert into public.obligations(
          business_id, customer_id, account_id, obligation_type, reference, issue_date, due_date,
          currency, original_amount_minor, status, metadata)
        values (
          v_charge.business_id, v_charge.customer_id, v_charge.account_id, v_charge.obligation_type,
          v_reference, v_period, v_period + v_charge.due_days, v_charge.currency, v_charge.amount_minor, 'open',
          jsonb_build_object('recurring_charge_id', v_charge.id, 'period', to_char(v_period, 'YYYY-MM'), 'label', v_charge.label))
        on conflict (business_id, customer_id, account_id, reference) do nothing;
        if found then v_created := v_created + 1; end if;
        v_charge.last_generated_period := to_char(v_period, 'YYYY-MM');
        v_period := (date_trunc('month', v_period) + interval '1 month')::date + (v_charge.day_of_month - 1);
        v_iterations := v_iterations + 1;
      end loop;
      update public.recurring_charges set
        next_run_date = v_period,
        last_generated_period = v_charge.last_generated_period,
        status = case when end_date is not null and v_period > end_date then 'ended' else status end,
        last_error = null,
        updated_at = now()
      where id = v_charge.id;
    exception when others then
      v_failed := v_failed + 1;
      update public.recurring_charges set last_error = left(sqlerrm, 500), updated_at = now() where id = v_charge.id;
    end;
  end loop;
  return jsonb_build_object('created', v_created, 'failed', v_failed);
end $$;

revoke all on function public.recurring_charges_generate(date, integer) from public, anon, authenticated;
grant execute on function public.recurring_charges_generate(date, integer) to service_role;

-- Automatic WhatsApp reminders (migration 20260921_whatsapp_auto_reminders.sql)
create table if not exists public.whatsapp_reminder_policies (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  enabled boolean not null default false,
  day_offsets integer[] not null default '{-3,0,3,7,14}',
  language text not null default 'en' check (language in ('en','ms')),
  consent_attested_at timestamptz,
  consent_attested_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_policy_offsets_check check (
    cardinality(day_offsets) between 1 and 8
    and day_offsets <@ array[-7,-3,-1,0,1,3,7,14,21,30]
  ),
  constraint whatsapp_policy_consent_check check (not enabled or consent_attested_at is not null)
);

create table if not exists public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_id uuid references public.debtors(id) on delete set null,
  obligation_id uuid references public.obligations(id) on delete set null,
  to_phone_e164 text not null check (to_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  template_kind text not null check (template_kind in ('before_due','due_today','overdue')),
  language text not null check (language in ('en','ms')),
  variables jsonb not null default '[]'::jsonb check (jsonb_typeof(variables) = 'array'),
  day_offset integer not null,
  local_send_date date not null,
  status text not null default 'queued'
    check (status in ('queued','sending','sent','delivered','read','failed','skipped')),
  skip_reason text,
  provider_message_id text unique,
  error_code text,
  error_message text,
  attempts integer not null default 0,
  lease_expires_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, obligation_id, day_offset),
  unique (business_id, customer_id, local_send_date)
);

create index if not exists whatsapp_messages_queue_idx
  on public.whatsapp_messages (status, created_at) where status in ('queued','sending');
create index if not exists whatsapp_messages_business_idx
  on public.whatsapp_messages (business_id, created_at desc);

create table if not exists public.whatsapp_opt_outs (
  phone_e164 text primary key check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  source text not null default 'reply' check (source in ('reply','business','support')),
  created_at timestamptz not null default now()
);

alter table public.whatsapp_reminder_policies enable row level security;
alter table public.whatsapp_messages enable row level security;
alter table public.whatsapp_opt_outs enable row level security;

drop policy if exists "whatsapp_reminder_policies: tenant read" on public.whatsapp_reminder_policies;
create policy "whatsapp_reminder_policies: tenant read" on public.whatsapp_reminder_policies
  for select to authenticated using (has_business_permission(business_id, 'case.read'));
drop policy if exists "whatsapp_messages: tenant read" on public.whatsapp_messages;
create policy "whatsapp_messages: tenant read" on public.whatsapp_messages
  for select to authenticated using (has_business_permission(business_id, 'case.read'));

-- Writes go through reviewed API routes and the scheduled worker.
revoke insert, update, delete on public.whatsapp_reminder_policies, public.whatsapp_messages from anon, authenticated;
revoke all on public.whatsapp_opt_outs from anon, authenticated;
grant select on public.whatsapp_reminder_policies, public.whatsapp_messages to authenticated;
grant all on public.whatsapp_reminder_policies, public.whatsapp_messages, public.whatsapp_opt_outs to service_role;

-- Normalise a Malaysian or international phone number to E.164, or null.
create or replace function public.whatsapp_normalize_phone(p_phone text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case
    when v is null or v = '' then null
    when v ~ '^\+[1-9][0-9]{7,14}$' then v
    when v ~ '^60[1-9][0-9]{7,10}$' then '+' || v
    when v ~ '^0[1-9][0-9]{7,10}$' then '+60' || substr(v, 2)
    else null end
  from (select regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g') as v) s;
$$;

create or replace function public.whatsapp_enqueue_due_reminders(p_now timestamptz default null, p_limit integer default 1000)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_today date := (coalesce(p_now, now()) at time zone 'Asia/Kuala_Lumpur')::date;
  v_inserted integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'service role required'; end if;
  with candidates as (
    select
      o.business_id, o.customer_id, o.id as obligation_id,
      whatsapp_normalize_phone(d.phone) as phone,
      p.language, offs.day_offset,
      case when offs.day_offset < 0 then 'before_due' when offs.day_offset = 0 then 'due_today' else 'overdue' end as template_kind,
      jsonb_build_array(
        coalesce(nullif(btrim(d.contact_name), ''), nullif(btrim(d.business_name), ''), nullif(btrim(d.individual_name), ''), 'Customer'),
        coalesce(nullif(btrim(b.business_name), ''), 'your supplier'),
        o.currency || ' ' || to_char(o.outstanding_minor / 100.0, 'FM999,999,999,990.00'),
        to_char(o.due_date, 'DD/MM/YYYY'),
        o.reference
      ) as variables
    from public.whatsapp_reminder_policies p
    join public.businesses b on b.id = p.business_id
    join public.entitlements e on e.business_id = p.business_id and e.plan_slug <> 'free'
    cross join lateral unnest(p.day_offsets) as offs(day_offset)
    join public.obligations o on o.business_id = p.business_id
      and o.archived_at is null
      and o.status in ('open','overdue','partial')
      and o.outstanding_minor > 0
      and o.due_date + offs.day_offset = v_today
    join public.debtors d on d.id = o.customer_id and d.archived_at is null
    where p.enabled and p.consent_attested_at is not null
    limit greatest(1, least(coalesce(p_limit, 1000), 5000))
  ), inserted as (
    insert into public.whatsapp_messages(business_id, customer_id, obligation_id, to_phone_e164, template_kind, language, variables, day_offset, local_send_date)
    select business_id, customer_id, obligation_id, phone, template_kind, language, variables, day_offset, v_today
    from candidates where phone is not null
    on conflict do nothing
    returning 1
  )
  select count(*) into v_inserted from inserted;
  return jsonb_build_object('queued', v_inserted, 'date', v_today);
end $$;

-- Lease queued messages for the sending worker.
create or replace function public.whatsapp_claim_messages(p_limit integer default 50)
returns setof public.whatsapp_messages language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'service role required'; end if;
  return query
  update public.whatsapp_messages m set status = 'sending', attempts = m.attempts + 1,
    lease_expires_at = now() + interval '5 minutes', updated_at = now()
  where m.id in (
    select id from public.whatsapp_messages
    where ((status = 'queued' and (lease_expires_at is null or lease_expires_at < now()))
        or (status = 'sending' and lease_expires_at < now()))
      and attempts < 3
    order by created_at
    limit greatest(1, least(coalesce(p_limit, 50), 200))
    for update skip locked
  )
  returning m.*;
end $$;

revoke all on function public.whatsapp_normalize_phone(text) from public, anon;
grant execute on function public.whatsapp_normalize_phone(text) to authenticated, service_role;
revoke all on function public.whatsapp_enqueue_due_reminders(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.whatsapp_enqueue_due_reminders(timestamptz, integer) to service_role;
revoke all on function public.whatsapp_claim_messages(integer) from public, anon, authenticated;
grant execute on function public.whatsapp_claim_messages(integer) to service_role;

-- Online debtor payments via Stripe Connect (migration 20260922_stripe_connect_online_payments.sql)
create table if not exists public.business_payment_connections (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  provider text not null default 'stripe' check (provider = 'stripe'),
  stripe_account_id text not null unique check (stripe_account_id ~ '^acct_[A-Za-z0-9]+$'),
  charges_enabled boolean not null default false,
  payouts_enabled boolean not null default false,
  details_submitted boolean not null default false,
  disconnected_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.online_payment_sessions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  case_id text not null references public.cases(id) on delete cascade,
  stripe_account_id text not null,
  checkout_session_id text not null unique,
  payment_intent_id text,
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'open' check (status in ('open','paid','expired','failed')),
  payment_id uuid unique references public.payments(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists online_payment_sessions_case_idx on public.online_payment_sessions (case_id, created_at desc);

alter table public.business_payment_connections enable row level security;
alter table public.online_payment_sessions enable row level security;
drop policy if exists "business_payment_connections: tenant read" on public.business_payment_connections;
create policy "business_payment_connections: tenant read" on public.business_payment_connections
  for select to authenticated using (has_business_permission(business_id, 'case.read'));
drop policy if exists "online_payment_sessions: tenant read" on public.online_payment_sessions;
create policy "online_payment_sessions: tenant read" on public.online_payment_sessions
  for select to authenticated using (has_business_permission(business_id, 'case.read'));
revoke insert, update, delete on public.business_payment_connections, public.online_payment_sessions from anon, authenticated;
grant select on public.business_payment_connections, public.online_payment_sessions to authenticated;
grant all on public.business_payment_connections, public.online_payment_sessions to service_role;

-- Records a Stripe-confirmed payment exactly once per checkout session.
create or replace function public.online_payment_record(
  p_checkout_session_id text, p_stripe_account_id text, p_payment_intent_id text,
  p_amount_minor bigint, p_currency text, p_payment_method text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_session public.online_payment_sessions; v_payment_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'service role required'; end if;
  if p_payment_method not in ('online_fpx','online_card','online_other') then raise exception 'invalid online payment method'; end if;
  select * into v_session from public.online_payment_sessions where checkout_session_id = p_checkout_session_id for update;
  if not found then raise exception 'unknown checkout session'; end if;
  if v_session.stripe_account_id <> p_stripe_account_id then raise exception 'checkout account mismatch'; end if;
  if v_session.amount_minor <> p_amount_minor or v_session.currency <> upper(p_currency) then raise exception 'checkout amount mismatch'; end if;
  if v_session.payment_id is not null then return v_session.payment_id; end if;

  insert into public.payments(case_id, amount, amount_minor, currency, payment_method, reference_no, review_status, notes)
  values (v_session.case_id, v_session.amount_minor / 100.0, v_session.amount_minor, v_session.currency, p_payment_method,
    p_payment_intent_id, 'pending_review',
    'Paid online through Stripe and confirmed by Stripe. The money goes to your Stripe account; approve to update the balance.')
  returning id into v_payment_id;

  update public.online_payment_sessions set status = 'paid', payment_intent_id = p_payment_intent_id,
    payment_id = v_payment_id, updated_at = now() where id = v_session.id;
  return v_payment_id;
end $$;

revoke all on function public.online_payment_record(text, text, text, bigint, text, text) from public, anon, authenticated;
grant execute on function public.online_payment_record(text, text, text, bigint, text, text) to service_role;

-- LHDN MyInvois e-Invoicing (migration 20260923_myinvois_einvoicing.sql)
create table if not exists public.einvoice_profiles (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  enabled boolean not null default false,
  supplier_tin text not null default '',
  supplier_brn text not null default '',
  supplier_sst text,
  supplier_ttx text,
  msic_code text not null default '' check (msic_code = '' or msic_code ~ '^\d{5}$'),
  activity_description text not null default '',
  phone text not null default '',
  email text,
  address_line text not null default '',
  city text not null default '',
  postcode text not null default '' check (postcode = '' or postcode ~ '^\d{5}$'),
  state_code text not null default '14' check (state_code ~ '^(0[1-9]|1[0-7])$'),
  tax_type text not null default '06' check (tax_type in ('01','02','06','E')),
  tax_rate_percent numeric(5,2) not null default 0 check (tax_rate_percent between 0 and 100),
  intermediary_authorised_at timestamptz,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_tax_details (
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_id uuid not null references public.debtors(id) on delete cascade,
  tin text,
  id_scheme text check (id_scheme is null or id_scheme in ('BRN','NRIC','PASSPORT','ARMY')),
  id_value text,
  sst_no text,
  address_line text,
  city text,
  postcode text,
  state_code text check (state_code is null or state_code ~ '^(0[1-9]|1[0-7])$'),
  country_code text not null default 'MYS' check (country_code ~ '^[A-Z]{3}$'),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (business_id, customer_id)
);

create table if not exists public.einvoice_documents (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  obligation_id uuid references public.obligations(id) on delete set null,
  customer_id uuid references public.debtors(id) on delete set null,
  environment text not null check (environment in ('preprod','production')),
  code_number text not null,
  document_hash text not null,
  submission_uid text,
  uuid text unique,
  long_id text,
  status text not null default 'submitted' check (status in ('submitted','valid','invalid','cancelled','rejected')),
  errors jsonb not null default '[]'::jsonb,
  submitted_by uuid references auth.users(id) on delete set null,
  submitted_at timestamptz not null default now(),
  validated_at timestamptz,
  cancelled_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists einvoice_documents_obligation_idx on public.einvoice_documents (business_id, obligation_id, submitted_at desc);
create index if not exists einvoice_documents_pending_idx on public.einvoice_documents (status, submitted_at) where status = 'submitted';
-- Only one live (submitted or valid) e-Invoice per invoice.
create unique index if not exists einvoice_documents_live_uidx
  on public.einvoice_documents (business_id, obligation_id) where status in ('submitted','valid');

alter table public.einvoice_profiles enable row level security;
alter table public.customer_tax_details enable row level security;
alter table public.einvoice_documents enable row level security;
drop policy if exists "einvoice_profiles: tenant read" on public.einvoice_profiles;
create policy "einvoice_profiles: tenant read" on public.einvoice_profiles
  for select to authenticated using (has_business_permission(business_id, 'case.read'));
drop policy if exists "customer_tax_details: tenant read" on public.customer_tax_details;
create policy "customer_tax_details: tenant read" on public.customer_tax_details
  for select to authenticated using (has_business_permission(business_id, 'case.read'));
drop policy if exists "einvoice_documents: tenant read" on public.einvoice_documents;
create policy "einvoice_documents: tenant read" on public.einvoice_documents
  for select to authenticated using (has_business_permission(business_id, 'case.read'));
revoke insert, update, delete on public.einvoice_profiles, public.customer_tax_details, public.einvoice_documents from anon, authenticated;
grant select on public.einvoice_profiles, public.customer_tax_details, public.einvoice_documents to authenticated;
grant all on public.einvoice_profiles, public.customer_tax_details, public.einvoice_documents to service_role;
