-- Debtor portal settlement hardening. Apply after 20260724_payment_plan_progress.sql.
-- Local proposal only: do not apply to staging/production without approval.

begin;

create or replace function public.revoke_payment_access_for_case_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status in ('closed', 'paid') or new.archived_at is not null then
    update public.public_access_tokens set revoked_at = coalesce(revoked_at, now())
    where case_id = new.id and purpose in ('payment', 'acknowledgement') and revoked_at is null and consumed_at is null;
    perform public.log_payment_access_event(new.id, 'payment_access.revoked_by_case_settlement', null, null, null, 'system');
  elsif new.payment_lock_mode is distinct from old.payment_lock_mode or new.receiving_account_id is distinct from old.receiving_account_id then
    update public.public_access_tokens set revoked_at = coalesce(revoked_at, now())
    where case_id = new.id and purpose = 'payment' and revoked_at is null and consumed_at is null;
    perform public.log_payment_access_event(new.id, 'payment_access.revoked_by_case_change', null, null, null, 'system');
  end if;
  return new;
end;
$$;

create or replace function public.validate_public_submission_token()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare access_token public.public_access_tokens%rowtype; current_case public.cases%rowtype; request_row public.payment_access_requests%rowtype;
begin
  select * into access_token from public.public_access_tokens where id = new.public_access_token_id for update;
  if not found or access_token.purpose <> 'payment' or access_token.revoked_at is not null or access_token.consumed_at is not null or access_token.expires_at <= now() then raise exception 'payment token is not active'; end if;
  select * into current_case from public.cases where id = access_token.case_id;
  if not found or current_case.status in ('closed', 'paid') or current_case.archived_at is not null or current_case.outstanding_minor <= 0 or access_token.receiving_account_id is null then raise exception 'payment access is no longer available'; end if;
  if current_case.payment_lock_mode = 'manual' then raise exception 'payment access is manually controlled'; end if;
  if current_case.payment_lock_mode = 'approval' then
    select * into request_row from public.payment_access_requests where id = access_token.payment_access_request_id;
    if not found or request_row.case_id <> current_case.id or request_row.status <> 'approved' or (request_row.expires_at is not null and request_row.expires_at <= now()) then raise exception 'payment access approval is not active'; end if;
  end if;
  return new;
end;
$$;

create or replace function public.validate_payment_plan_acknowledgement_case()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (
    select 1 from public.public_access_tokens t
    join public.payment_plans p on p.id = new.payment_plan_id and p.id = t.payment_plan_id
    join public.cases c on c.id = p.case_id and c.id = t.case_id
    where t.id = new.public_access_token_id and t.purpose = 'acknowledgement'
      and c.status not in ('closed', 'paid') and c.archived_at is null and c.outstanding_minor > 0
  ) then raise exception 'payment plan is unavailable for response'; end if;
  return new;
end;
$$;
drop trigger if exists payment_plan_acknowledgement_case_guard on public.payment_plan_acknowledgements;
create trigger payment_plan_acknowledgement_case_guard
before insert on public.payment_plan_acknowledgements
for each row execute function public.validate_payment_plan_acknowledgement_case();

commit;

-- Rollback: begin;
-- drop trigger if exists payment_plan_acknowledgement_case_guard on public.payment_plan_acknowledgements;
-- drop function if exists public.validate_payment_plan_acknowledgement_case();
-- commit;
