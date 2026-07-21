-- Server-authoritative payment-plan proposals and tokenized debtor responses.
-- Apply after 20260722_payment_proof_metadata_hardening.sql.
-- Legacy plans remain readable. Do not issue acknowledgement links for them;
-- reissue a reviewed proposal to gain an immutable terms snapshot.

begin;

do $$
begin
  if exists (
    select 1 from public.payment_plans
    where status not in ('active', 'completed', 'cancelled')
  ) then
    raise exception 'Unexpected legacy payment plan status prevents lifecycle migration';
  end if;

  if exists (
    select case_id from public.payment_plans
    where status = 'active'
    group by case_id having count(*) > 1
  ) then
    raise exception 'More than one active legacy payment plan exists for a case; resolve before migration';
  end if;
end $$;

alter table public.payment_plans
  add column if not exists frequency text not null default 'monthly'
    check (frequency in ('weekly', 'monthly', 'custom')),
  add column if not exists timezone text not null default 'Asia/Kuala_Lumpur'
    check (timezone = 'Asia/Kuala_Lumpur'),
  add column if not exists terms_version integer not null default 1
    check (terms_version > 0),
  add column if not exists terms_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists accepted_at timestamptz,
  add column if not exists rejected_at timestamptz,
  add column if not exists rejection_reason text,
  add column if not exists acceptance_token_id uuid references public.public_access_tokens(id) on delete set null;

alter table public.payment_plans
  drop constraint if exists payment_plans_status_check,
  add constraint payment_plans_status_check
    check (status in ('pending_acceptance', 'active', 'defaulted', 'completed', 'cancelled'));

create table if not exists public.payment_plan_installments (
  id uuid primary key default gen_random_uuid(),
  payment_plan_id uuid not null references public.payment_plans(id) on delete restrict,
  sequence_no integer not null check (sequence_no > 0),
  due_date date not null,
  amount_minor bigint not null check (amount_minor > 0),
  paid_minor bigint not null default 0 check (paid_minor >= 0 and paid_minor <= amount_minor),
  status text not null default 'scheduled'
    check (status in ('scheduled', 'partial', 'paid', 'overdue', 'cancelled')),
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  unique (payment_plan_id, sequence_no)
);

create unique index if not exists payment_plans_one_open_plan_per_case_idx
  on public.payment_plans(case_id)
  where status in ('pending_acceptance', 'active', 'defaulted');
create index if not exists payment_plan_installments_due_idx
  on public.payment_plan_installments(payment_plan_id, due_date, sequence_no);

alter table public.payment_plan_acknowledgements
  add column if not exists decision text not null default 'accepted'
    check (decision in ('accepted', 'rejected')),
  add column if not exists terms_version integer not null default 1
    check (terms_version > 0),
  add column if not exists terms_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists actor_context jsonb not null default '{}'::jsonb,
  add column if not exists rejection_reason text;

-- Browser clients retain owner-scoped reads only. Plan writes are performed by
-- the reviewed functions below so browser data cannot set amount/status/terms.
drop policy if exists "owners can manage own payment plans" on public.payment_plans;
drop policy if exists "payment_plans_owner_read" on public.payment_plans;
create policy "payment_plans_owner_read" on public.payment_plans for select to authenticated
using (exists (
  select 1 from public.cases c join public.businesses b on b.id = c.business_id
  where c.id = payment_plans.case_id and b.owner_id = auth.uid()
));

alter table public.payment_plan_installments enable row level security;
drop policy if exists "payment_plan_installments_owner_read" on public.payment_plan_installments;
create policy "payment_plan_installments_owner_read" on public.payment_plan_installments for select to authenticated
using (exists (
  select 1 from public.payment_plans p join public.cases c on c.id = p.case_id
  join public.businesses b on b.id = c.business_id
  where p.id = payment_plan_installments.payment_plan_id and b.owner_id = auth.uid()
));

create or replace function public.payment_plan_immutable_terms_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if old.accepted_at is not null and (
    new.case_id is distinct from old.case_id or
    new.total_amount is distinct from old.total_amount or
    new.installment_count is distinct from old.installment_count or
    new.installment_amount is distinct from old.installment_amount or
    new.start_date is distinct from old.start_date or
    new.due_dates is distinct from old.due_dates or
    new.frequency is distinct from old.frequency or
    new.timezone is distinct from old.timezone or
    new.terms_version is distinct from old.terms_version or
    new.terms_snapshot is distinct from old.terms_snapshot or
    new.notes is distinct from old.notes
  ) then
    raise exception 'Accepted payment-plan terms are immutable; create an amendment instead';
  end if;
  return new;
end;
$$;

drop trigger if exists payment_plan_immutable_terms on public.payment_plans;
create trigger payment_plan_immutable_terms
before update on public.payment_plans
for each row execute function public.payment_plan_immutable_terms_guard();

create or replace function public.payment_plan_create_proposal(
  p_case_id text,
  p_frequency text,
  p_first_due_date date,
  p_installment_count integer,
  p_custom_due_dates jsonb default '[]'::jsonb,
  p_notes text default null
) returns public.payment_plans language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_case public.cases;
  v_plan public.payment_plans;
  v_total_minor bigint;
  v_base_minor bigint;
  v_remainder_minor bigint;
  v_due_date date;
  v_previous_due_date date;
  v_due_dates jsonb := '[]'::jsonb;
  v_schedule jsonb := '[]'::jsonb;
  v_custom_value text;
  i integer;
begin
  if p_frequency not in ('weekly', 'monthly', 'custom') then raise exception 'Unsupported payment-plan frequency'; end if;
  if p_installment_count < 1 or p_installment_count > 24 then raise exception 'Installment count must be between 1 and 24'; end if;
  if p_first_due_date < timezone('Asia/Kuala_Lumpur', now())::date then raise exception 'First due date cannot be in the past'; end if;
  if char_length(coalesce(p_notes, '')) > 1000 then raise exception 'Plan notes are too long'; end if;

  select c.* into v_case
  from public.cases c join public.businesses b on b.id = c.business_id
  where c.id = p_case_id and b.owner_id = auth.uid()
  for update;
  if not found then raise exception 'Case not found'; end if;
  if v_case.archived_at is not null or v_case.status = 'closed' then raise exception 'Closed or archived cases cannot receive payment plans'; end if;
  v_total_minor := v_case.outstanding_minor;
  if v_total_minor <= 0 then raise exception 'A payment plan requires an outstanding case balance'; end if;
  if exists (select 1 from public.payment_plans p where p.case_id = p_case_id and p.status in ('pending_acceptance', 'active', 'defaulted')) then
    raise exception 'An open payment plan already exists for this case';
  end if;

  if p_frequency = 'custom' then
    if jsonb_typeof(p_custom_due_dates) <> 'array' or jsonb_array_length(p_custom_due_dates) <> p_installment_count then
      raise exception 'Custom plans require one due date for every installment';
    end if;
  elsif coalesce(jsonb_array_length(p_custom_due_dates), 0) <> 0 then
    raise exception 'Only custom plans may provide custom due dates';
  end if;

  v_base_minor := v_total_minor / p_installment_count;
  v_remainder_minor := v_total_minor % p_installment_count;
  insert into public.payment_plans (
    case_id, total_amount, installment_count, installment_amount, start_date,
    due_dates, status, debtor_confirmed, debtor_name, debtor_phone, signature_url,
    confirmed_at, notes, frequency, timezone, terms_version, terms_snapshot
  ) values (
    p_case_id, v_total_minor::numeric / 100, p_installment_count,
    v_base_minor::numeric / 100, p_first_due_date, '[]'::jsonb,
    'pending_acceptance', false, null, null, null, null, nullif(btrim(p_notes), ''),
    p_frequency, 'Asia/Kuala_Lumpur', 1, '{}'::jsonb
  ) returning * into v_plan;

  for i in 1..p_installment_count loop
    if p_frequency = 'weekly' then
      v_due_date := p_first_due_date + ((i - 1) * 7);
    elsif p_frequency = 'monthly' then
      v_due_date := (p_first_due_date + make_interval(months => i - 1))::date;
    else
      v_custom_value := p_custom_due_dates ->> (i - 1);
      if v_custom_value !~ '^\\d{4}-\\d{2}-\\d{2}$' then raise exception 'Custom due dates must be ISO calendar dates'; end if;
      v_due_date := v_custom_value::date;
      if to_char(v_due_date, 'YYYY-MM-DD') <> v_custom_value then raise exception 'Custom due dates must be valid calendar dates'; end if;
      if i = 1 and v_due_date <> p_first_due_date then raise exception 'The first custom due date must match the first due date'; end if;
      if v_previous_due_date is not null and v_due_date <= v_previous_due_date then raise exception 'Custom due dates must be strictly increasing'; end if;
    end if;
    v_previous_due_date := v_due_date;
    insert into public.payment_plan_installments (payment_plan_id, sequence_no, due_date, amount_minor)
    values (v_plan.id, i, v_due_date, v_base_minor + case when i = p_installment_count then v_remainder_minor else 0 end);
    v_due_dates := v_due_dates || to_jsonb(to_char(v_due_date, 'YYYY-MM-DD'));
    v_schedule := v_schedule || jsonb_build_array(jsonb_build_object(
      'sequence', i,
      'due_date', to_char(v_due_date, 'YYYY-MM-DD'),
      'amount_minor', v_base_minor + case when i = p_installment_count then v_remainder_minor else 0 end
    ));
  end loop;

  update public.payment_plans set
    due_dates = v_due_dates,
    terms_snapshot = jsonb_build_object(
      'version', 1, 'currency', 'MYR', 'timezone', 'Asia/Kuala_Lumpur',
      'frequency', p_frequency, 'first_due_date', to_char(p_first_due_date, 'YYYY-MM-DD'),
      'total_minor', v_total_minor, 'schedule', v_schedule, 'notes', nullif(btrim(p_notes), '')
    )
  where id = v_plan.id returning * into v_plan;

  insert into public.audit_logs (business_id, case_id, action, actor_type, actor_id, metadata)
  values (v_case.business_id, v_case.id, 'payment_plan.proposed', 'owner', auth.uid(),
    jsonb_build_object('payment_plan_id', v_plan.id, 'terms_version', v_plan.terms_version));
  return v_plan;
end;
$$;

create or replace function public.payment_plan_record_response(
  p_token_id uuid,
  p_decision text,
  p_signer_name text,
  p_signer_phone text,
  p_rejection_reason text default null,
  p_ip_hash text default null,
  p_actor_context jsonb default '{}'::jsonb
) returns public.payment_plans language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_token public.public_access_tokens;
  v_plan public.payment_plans;
  v_case public.cases;
  v_previous_status text;
begin
  if p_decision not in ('accepted', 'rejected') then raise exception 'Unsupported payment-plan response'; end if;
  if char_length(coalesce(p_signer_name, '')) > 160 or char_length(coalesce(p_signer_phone, '')) > 50 or char_length(coalesce(p_rejection_reason, '')) > 500 then
    raise exception 'Payment-plan response is too long';
  end if;
  if p_decision = 'accepted' and nullif(btrim(p_signer_name), '') is null then raise exception 'Signer name is required'; end if;

  select * into v_token from public.public_access_tokens where id = p_token_id for update;
  if not found or v_token.purpose <> 'acknowledgement' or v_token.payment_plan_id is null or v_token.revoked_at is not null or v_token.consumed_at is not null or v_token.expires_at <= now() then
    raise exception 'Acknowledgement link is not active';
  end if;
  select p.* into v_plan from public.payment_plans p where p.id = v_token.payment_plan_id for update;
  if not found or v_plan.case_id <> v_token.case_id or v_plan.status <> 'pending_acceptance' or v_plan.terms_snapshot = '{}'::jsonb then
    raise exception 'Payment plan is unavailable for response';
  end if;
  select * into v_case from public.cases where id = v_plan.case_id for update;
  if not found or v_case.archived_at is not null or v_case.status = 'closed' then raise exception 'Payment plan is unavailable for response'; end if;

  insert into public.payment_plan_acknowledgements (
    public_access_token_id, payment_plan_id, signer_name, signer_phone,
    consent_version, ip_hash, decision, terms_version, terms_snapshot,
    actor_context, rejection_reason
  ) values (
    v_token.id, v_plan.id, coalesce(nullif(btrim(p_signer_name), ''), 'Debtor'),
    nullif(btrim(p_signer_phone), ''), 'public-payment-plan-v1', p_ip_hash,
    p_decision, v_plan.terms_version, v_plan.terms_snapshot,
    coalesce(p_actor_context, '{}'::jsonb), nullif(btrim(p_rejection_reason), '')
  );

  if p_decision = 'accepted' then
    update public.payment_plans set status = 'active', debtor_confirmed = true,
      debtor_name = nullif(btrim(p_signer_name), ''), debtor_phone = nullif(btrim(p_signer_phone), ''),
      confirmed_at = now(), accepted_at = now(), acceptance_token_id = v_token.id
    where id = v_plan.id returning * into v_plan;
    v_previous_status := v_case.status;
    if v_case.status <> 'payment_promise' then
      perform set_config('collectboss.lifecycle_transition', 'on', true);
      update public.cases set status = 'payment_promise', promise_due_date = v_plan.start_date,
        status_version = status_version + 1, updated_at = now() where id = v_case.id;
      insert into public.case_status_history(case_id, from_status, to_status, transition_reason, actor_type)
      values (v_case.id, v_previous_status, 'payment_promise', 'payment plan accepted', 'system');
    end if;
  else
    update public.payment_plans set status = 'cancelled', debtor_confirmed = false,
      rejected_at = now(), rejection_reason = nullif(btrim(p_rejection_reason), ''), acceptance_token_id = v_token.id
    where id = v_plan.id returning * into v_plan;
  end if;

  update public.public_access_tokens set consumed_at = now()
  where id = v_token.id and consumed_at is null;
  insert into public.audit_logs (business_id, case_id, action, actor_type, actor_id, metadata)
  values (v_case.business_id, v_case.id, concat('payment_plan.', p_decision), 'debtor', null,
    jsonb_build_object('payment_plan_id', v_plan.id, 'token_id', v_token.id, 'terms_version', v_plan.terms_version));
  return v_plan;
end;
$$;

revoke all on function public.payment_plan_create_proposal(text,text,date,integer,jsonb,text) from public;
grant execute on function public.payment_plan_create_proposal(text,text,date,integer,jsonb,text) to authenticated;
revoke all on function public.payment_plan_record_response(uuid,text,text,text,text,text,jsonb) from public;
grant execute on function public.payment_plan_record_response(uuid,text,text,text,text,text,jsonb) to service_role;

commit;

-- Rollback: only before any new lifecycle proposal/response data is written.
-- Do not run this destructive rollback in production once audit data exists;
-- disable routes and preserve the records instead.
-- begin;
-- drop trigger if exists payment_plan_immutable_terms on public.payment_plans;
-- drop function if exists public.payment_plan_immutable_terms_guard();
-- drop function if exists public.payment_plan_record_response(uuid,text,text,text,text,text,jsonb);
-- drop function if exists public.payment_plan_create_proposal(text,text,date,integer,jsonb,text);
-- drop index if exists public.payment_plan_installments_due_idx;
-- drop index if exists public.payment_plans_one_open_plan_per_case_idx;
-- drop table if exists public.payment_plan_installments;
-- alter table public.payment_plan_acknowledgements drop column if exists rejection_reason, drop column if exists actor_context, drop column if exists terms_snapshot, drop column if exists terms_version, drop column if exists decision;
-- alter table public.payment_plans drop constraint if exists payment_plans_status_check, drop column if exists acceptance_token_id, drop column if exists rejection_reason, drop column if exists rejected_at, drop column if exists accepted_at, drop column if exists terms_snapshot, drop column if exists terms_version, drop column if exists timezone, drop column if exists frequency;
-- commit;
