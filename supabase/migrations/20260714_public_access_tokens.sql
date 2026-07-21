-- Tokenized public payment and acknowledgement access.
-- Prerequisite: the canonical schema uses text cases.id and text case_id
-- foreign keys. This matches client-generated CB-... case identifiers.
-- This migration deliberately creates no anonymous table or storage policies.
--
-- Rollback note: this migration creates audit-bearing submission records. Do
-- not drop its tables to roll back a release. Revoke or expire public tokens to
-- contain access, then deploy an application rollback separately.

begin;

create extension if not exists pgcrypto;

-- Preflight only: abort before any DDL if this is not the canonical text-ID
-- schema. A UUID case-ID deployment requires a separately reviewed data
-- migration; do not cast or rewrite existing case IDs here.
do $$
declare
  case_id_type text;
  payment_method_type text;
begin
  select data_type into case_id_type
  from information_schema.columns
  where table_schema = 'public' and table_name = 'cases' and column_name = 'id';

  if case_id_type is distinct from 'text' then
    raise exception 'Expected public.cases.id to be text; found %', coalesce(case_id_type, 'missing');
  end if;

  select data_type into payment_method_type
  from information_schema.columns
  where table_schema = 'public' and table_name = 'payments' and column_name = 'payment_method';

  if payment_method_type is distinct from 'text' then
    raise exception 'Expected public.payments.payment_method to be text; found %', coalesce(payment_method_type, 'missing');
  end if;
end;
$$;

do $$
begin
  create type public_access_purpose as enum ('payment', 'acknowledgement');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public_submission_status as enum ('pending_review', 'approved', 'rejected');
exception when duplicate_object then null;
end $$;

create table if not exists public_access_tokens (
  id                        uuid primary key default gen_random_uuid(),
  token_hash                text not null unique check (char_length(token_hash) = 64),
  purpose                   public_access_purpose not null,
  case_id                   text not null references cases(id) on delete cascade,
  payment_plan_id           uuid references payment_plans(id) on delete cascade,
  payment_access_request_id uuid references payment_access_requests(id) on delete set null,
  created_by                uuid references auth.users(id) on delete set null,
  created_at                timestamptz not null default now(),
  expires_at                timestamptz not null,
  revoked_at                timestamptz,
  consumed_at               timestamptz,
  last_viewed_at            timestamptz,
  constraint public_access_token_expiry_check check (expires_at > created_at),
  constraint public_access_token_target_check check (
    (purpose = 'payment' and payment_plan_id is null)
    or
    (purpose = 'acknowledgement' and payment_plan_id is not null)
  )
);

create index if not exists public_access_tokens_case_idx
  on public_access_tokens (case_id);
create index if not exists public_access_tokens_active_idx
  on public_access_tokens (expires_at)
  where revoked_at is null and consumed_at is null;

create table if not exists public_payment_submissions (
  id                     uuid primary key default gen_random_uuid(),
  public_access_token_id uuid not null unique
                         references public_access_tokens(id) on delete restrict,
  amount                 numeric(12,2) not null check (amount > 0),
  payment_method         text not null check (payment_method in (
                         'duitnow_qr', 'bank_transfer', 'cash', 'cheque', 'tng_ewallet'
                       )),
  reference_no           text,
  proof_object_path      text,
  status                 public_submission_status not null default 'pending_review',
  reviewed_at            timestamptz,
  reviewed_by            uuid references auth.users(id) on delete set null,
  review_notes           text,
  idempotency_key        uuid not null unique,
  created_at             timestamptz not null default now()
);

create index if not exists public_payment_submissions_status_idx
  on public_payment_submissions (status, created_at desc);

create table if not exists payment_plan_acknowledgements (
  id                     uuid primary key default gen_random_uuid(),
  public_access_token_id uuid not null unique
                         references public_access_tokens(id) on delete restrict,
  payment_plan_id        uuid not null unique
                         references payment_plans(id) on delete restrict,
  signer_name            text not null,
  signer_phone           text,
  consent_version        text not null,
  ip_hash                text,
  acknowledged_at        timestamptz not null default now()
);

-- Prevent a privileged bug from attaching a token to another case or plan.
create or replace function validate_public_access_token_target()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.purpose = 'acknowledgement' and not exists (
    select 1 from payment_plans p
    where p.id = new.payment_plan_id and p.case_id = new.case_id
  ) then
    raise exception 'acknowledgement token plan must belong to its case';
  end if;

  if new.payment_access_request_id is not null and not exists (
    select 1 from payment_access_requests r
    where r.id = new.payment_access_request_id and r.case_id = new.case_id
  ) then
    raise exception 'payment access request must belong to token case';
  end if;

  return new;
end;
$$;

drop trigger if exists public_access_token_target_guard on public_access_tokens;
create trigger public_access_token_target_guard
before insert or update of purpose, case_id, payment_plan_id, payment_access_request_id
on public_access_tokens
for each row execute function validate_public_access_token_target();

create or replace function validate_public_submission_token()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  access_token public_access_tokens%rowtype;
begin
  select * into access_token
  from public_access_tokens
  where id = new.public_access_token_id
  for update;

  if not found
     or access_token.purpose <> 'payment'
     or access_token.revoked_at is not null
     or access_token.consumed_at is not null
     or access_token.expires_at <= now() then
    raise exception 'payment token is not active';
  end if;

  return new;
end;
$$;

drop trigger if exists public_submission_token_guard on public_payment_submissions;
create trigger public_submission_token_guard
before insert on public_payment_submissions
for each row execute function validate_public_submission_token();

create or replace function validate_public_acknowledgement_token()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  access_token public_access_tokens%rowtype;
begin
  select * into access_token
  from public_access_tokens
  where id = new.public_access_token_id
  for update;

  if not found
     or access_token.purpose <> 'acknowledgement'
     or access_token.payment_plan_id <> new.payment_plan_id
     or access_token.revoked_at is not null
     or access_token.consumed_at is not null
     or access_token.expires_at <= now() then
    raise exception 'acknowledgement token is not active';
  end if;

  return new;
end;
$$;

drop trigger if exists public_acknowledgement_token_guard on payment_plan_acknowledgements;
create trigger public_acknowledgement_token_guard
before insert on payment_plan_acknowledgements
for each row execute function validate_public_acknowledgement_token();

alter table public_access_tokens enable row level security;
alter table public_payment_submissions enable row level security;
alter table payment_plan_acknowledgements enable row level security;

-- No anon policy exists for these tables. Owner controls are server routes that
-- validate auth.uid() before using service_role. Owners may read review queues.
drop policy if exists "payment_submissions_owner_read" on public_payment_submissions;
create policy "payment_submissions_owner_read"
on public_payment_submissions for select to authenticated
using (
  exists (
    select 1
    from public_access_tokens t
    join cases c on c.id = t.case_id
    join businesses b on b.id = c.business_id
    where t.id = public_payment_submissions.public_access_token_id
      and b.owner_id = auth.uid()
  )
);

drop policy if exists "plan_acknowledgements_owner_read" on payment_plan_acknowledgements;
create policy "plan_acknowledgements_owner_read"
on payment_plan_acknowledgements for select to authenticated
using (
  exists (
    select 1
    from public_access_tokens t
    join cases c on c.id = t.case_id
    join businesses b on b.id = c.business_id
    where t.id = payment_plan_acknowledgements.public_access_token_id
      and b.owner_id = auth.uid()
  )
);

-- Retire legacy anonymous paths. Public debtor actions now go through the two
-- token-validated server handlers above, so no browser client needs direct
-- anonymous table access.
drop policy if exists "debtors can request access" on payment_access_requests;
drop policy if exists "debtors can submit payment proofs" on payments;
drop policy if exists "debtors can read and confirm payment plans" on payment_plans;
drop policy if exists "debtors can confirm payment plans" on payment_plans;
drop policy if exists "anyone can insert audit logs" on audit_logs;
drop policy if exists "owners can append own audit logs" on audit_logs;
create policy "owners can append own audit logs"
on audit_logs for insert to authenticated
with check (
  exists (
    select 1 from businesses b
    where b.id = audit_logs.business_id and b.owner_id = auth.uid()
  )
);

-- The bucket remains private. Server-side uploads use service_role; owners can
-- read only proof objects for cases belonging to their own business.
insert into storage.buckets (id, name, public)
values ('payment-proofs', 'payment-proofs', false)
on conflict (id) do update set public = false;

drop policy if exists "payment_proofs_owner_read" on storage.objects;
create policy "payment_proofs_owner_read"
on storage.objects for select to authenticated
using (
  bucket_id = 'payment-proofs'
  and exists (
    select 1
    from cases c
    join businesses b on b.id = c.business_id
    where c.id::text = (storage.foldername(name))[1]
      and b.owner_id = auth.uid()
  )
);

commit;
