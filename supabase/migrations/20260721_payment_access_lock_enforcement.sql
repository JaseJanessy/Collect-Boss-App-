-- Phase 4 receiving-account and payment-access enforcement.
-- Apply after 20260714_public_access_tokens.sql, 20260719_case_lifecycle.sql,
-- and 20260720_financial_balance_engine.sql. Local-only: not applied remotely.
-- Rollback (after revoking any newly issued payment links):
-- begin;
-- drop trigger if exists payment_access_request_audit_transition on public.payment_access_requests;
-- drop trigger if exists receiving_accounts_revoke_payment_access_on_change on public.receiving_accounts;
-- drop trigger if exists cases_revoke_payment_access_on_change on public.cases;
-- drop function if exists public.audit_payment_access_request_transition();
-- drop function if exists public.revoke_payment_access_for_account_change();
-- drop function if exists public.revoke_payment_access_for_case_change();
-- drop function if exists public.log_payment_access_event(text,text,uuid,uuid,uuid,text,jsonb);
-- drop table if exists public.payment_access_events;
-- drop index if exists public.public_access_tokens_receiving_account_idx;
-- drop index if exists public.cases_receiving_account_idx;
-- drop index if exists public.receiving_accounts_one_primary_per_business;
-- alter table public.public_access_tokens drop column if exists receiving_account_id;
-- alter table public.cases drop column if exists receiving_account_id;
-- alter table public.receiving_accounts drop column if exists version, drop column if exists updated_at;
-- commit;
begin;

alter table public.receiving_accounts
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists version integer not null default 1;

alter table public.cases
  add column if not exists receiving_account_id uuid references public.receiving_accounts(id) on delete set null;

alter table public.public_access_tokens
  add column if not exists receiving_account_id uuid references public.receiving_accounts(id) on delete set null;

create unique index if not exists receiving_accounts_one_primary_per_business
  on public.receiving_accounts (business_id) where is_primary;
create index if not exists cases_receiving_account_idx on public.cases (receiving_account_id);
create index if not exists public_access_tokens_receiving_account_idx
  on public.public_access_tokens (receiving_account_id) where purpose = 'payment';

-- Preserve current immediate-mode behaviour only. Approval/manual links were
-- previously able to bypass the lock and are deliberately revoked.
update public.cases c
set receiving_account_id = (
  select a.id
  from public.receiving_accounts a
  where a.business_id = c.business_id and a.is_primary
  order by a.created_at asc, a.id asc
  limit 1
)
where c.receiving_account_id is null
  and exists (
    select 1
    from public.receiving_accounts a
    where a.business_id = c.business_id and a.is_primary
  );

update public.public_access_tokens t set receiving_account_id = c.receiving_account_id
from public.cases c
where t.case_id = c.id and t.purpose = 'payment' and t.receiving_account_id is null;

update public.public_access_tokens t set revoked_at = now()
from public.cases c
where t.case_id = c.id and t.purpose = 'payment' and t.revoked_at is null
  and (c.payment_lock_mode <> 'immediate' or c.status = 'closed' or c.archived_at is not null);

create table if not exists public.payment_access_events (
  id uuid primary key default gen_random_uuid(),
  case_id text not null references public.cases(id) on delete cascade,
  receiving_account_id uuid references public.receiving_accounts(id) on delete set null,
  payment_access_request_id uuid references public.payment_access_requests(id) on delete set null,
  public_access_token_id uuid references public.public_access_tokens(id) on delete set null,
  action text not null,
  actor_id uuid references auth.users(id) on delete set null,
  actor_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.payment_access_events enable row level security;
drop policy if exists "payment_access_events_owner_read" on public.payment_access_events;
create policy "payment_access_events_owner_read" on public.payment_access_events for select to authenticated
  using (exists (select 1 from public.cases c join public.businesses b on b.id = c.business_id where c.id = payment_access_events.case_id and b.owner_id = auth.uid()));
create index if not exists payment_access_events_case_idx on public.payment_access_events(case_id, created_at desc);

create or replace function public.log_payment_access_event(p_case_id text, p_action text,
  p_account_id uuid default null, p_request_id uuid default null, p_token_id uuid default null,
  p_actor_type text default 'owner', p_metadata jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.payment_access_events(case_id, receiving_account_id, payment_access_request_id, public_access_token_id, action, actor_id, actor_type, metadata)
  values (p_case_id, p_account_id, p_request_id, p_token_id, p_action, auth.uid(), p_actor_type, coalesce(p_metadata, '{}'::jsonb));
end;
$$;

create or replace function public.revoke_payment_access_for_case_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'closed' or new.archived_at is not null or new.payment_lock_mode is distinct from old.payment_lock_mode or new.receiving_account_id is distinct from old.receiving_account_id then
    update public.public_access_tokens set revoked_at = coalesce(revoked_at, now())
    where case_id = new.id and purpose = 'payment' and revoked_at is null and consumed_at is null;
    perform public.log_payment_access_event(new.id, 'payment_access.revoked_by_case_change', null, null, null, 'system');
  end if;
  return new;
end;
$$;
drop trigger if exists cases_revoke_payment_access_on_change on public.cases;
create trigger cases_revoke_payment_access_on_change after update of status, archived_at, payment_lock_mode, receiving_account_id on public.cases
  for each row execute function public.revoke_payment_access_for_case_change();

create or replace function public.revoke_payment_access_for_account_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare affected_case_id text;
begin
  update public.public_access_tokens set revoked_at = coalesce(revoked_at, now())
  where receiving_account_id = old.id and purpose = 'payment' and revoked_at is null and consumed_at is null;
  for affected_case_id in select id from public.cases where receiving_account_id = old.id loop
    perform public.log_payment_access_event(affected_case_id, 'payment_access.revoked_by_account_change', old.id, null, null, 'system');
  end loop;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
drop trigger if exists receiving_accounts_revoke_payment_access_on_change on public.receiving_accounts;
create trigger receiving_accounts_revoke_payment_access_on_change before update of bank_name, account_holder_name, account_number, duitnow_id, is_primary, include_in_reminders or delete on public.receiving_accounts
  for each row execute function public.revoke_payment_access_for_account_change();

create or replace function public.audit_payment_access_request_transition()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status is distinct from old.status then
    perform public.log_payment_access_event(new.case_id, 'payment_access.request_' || new.status, null, new.id, null, 'owner');
  end if;
  return new;
end;
$$;
drop trigger if exists payment_access_request_audit_transition on public.payment_access_requests;
create trigger payment_access_request_audit_transition after update of status on public.payment_access_requests
  for each row execute function public.audit_payment_access_request_transition();

create or replace function public.validate_public_submission_token()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare access_token public.public_access_tokens%rowtype; current_case public.cases%rowtype; request_row public.payment_access_requests%rowtype;
begin
  select * into access_token from public.public_access_tokens where id = new.public_access_token_id for update;
  if not found or access_token.purpose <> 'payment' or access_token.revoked_at is not null or access_token.consumed_at is not null or access_token.expires_at <= now() then raise exception 'payment token is not active'; end if;
  select * into current_case from public.cases where id = access_token.case_id;
  if not found or current_case.status = 'closed' or current_case.archived_at is not null or access_token.receiving_account_id is null then raise exception 'payment access is no longer available'; end if;
  if current_case.payment_lock_mode = 'manual' then raise exception 'payment access is manually controlled'; end if;
  if current_case.payment_lock_mode = 'approval' then
    select * into request_row from public.payment_access_requests where id = access_token.payment_access_request_id;
    if not found or request_row.case_id <> current_case.id or request_row.status <> 'approved' or (request_row.expires_at is not null and request_row.expires_at <= now()) then raise exception 'payment access approval is not active'; end if;
  end if;
  return new;
end;
$$;

revoke all on function public.log_payment_access_event(text,text,uuid,uuid,uuid,text,jsonb) from public;
commit;
