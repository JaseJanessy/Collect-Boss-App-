-- Deterministic payment-plan progress derived from the authoritative ledger.
-- Apply after 20260723_payment_plan_proposal_acceptance.sql.

begin;

alter table public.payment_plans
  add column if not exists grace_days integer not null default 0
    check (grace_days between 0 and 31);

create table if not exists public.payment_plan_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_plan_id uuid not null references public.payment_plans(id) on delete restrict,
  payment_plan_installment_id uuid not null references public.payment_plan_installments(id) on delete restrict,
  financial_event_id uuid not null references public.case_financial_events(id) on delete restrict,
  amount_minor bigint not null check (amount_minor > 0),
  created_at timestamptz not null default now(),
  unique (payment_plan_installment_id, financial_event_id)
);
create index if not exists payment_plan_allocations_plan_idx on public.payment_plan_allocations(payment_plan_id, created_at);

alter table public.payment_plan_allocations enable row level security;
drop policy if exists "payment_plan_allocations_owner_read" on public.payment_plan_allocations;
create policy "payment_plan_allocations_owner_read" on public.payment_plan_allocations for select to authenticated
using (exists (
  select 1 from public.payment_plans p join public.cases c on c.id = p.case_id
  join public.businesses b on b.id = c.business_id
  where p.id = payment_plan_allocations.payment_plan_id and b.owner_id = auth.uid()
));

create or replace function public.payment_plan_reconcile_case(p_case_id text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_plan public.payment_plans;
  v_event record;
  v_installment public.payment_plan_installments;
  v_remaining_event bigint;
  v_remaining_installment bigint;
  v_allocated bigint;
  v_today date := timezone('Asia/Kuala_Lumpur', now())::date;
begin
  select * into v_plan from public.payment_plans
  where case_id = p_case_id and status in ('active', 'defaulted', 'completed')
  for update;
  if not found then return; end if;

  delete from public.payment_plan_allocations where payment_plan_id = v_plan.id;
  update public.payment_plan_installments set paid_minor = 0, settled_at = null, status = 'scheduled'
  where payment_plan_id = v_plan.id;

  for v_event in
    select e.id, e.amount_minor
    from public.case_financial_events e
    join public.payments p on p.financial_event_id = e.id
    where e.case_id = p_case_id and e.event_type = 'payment_approved'
      and p.review_status = 'approved' and e.created_at >= v_plan.accepted_at
    order by e.created_at, e.id
  loop
    v_remaining_event := v_event.amount_minor;
    for v_installment in select * from public.payment_plan_installments
      where payment_plan_id = v_plan.id order by sequence_no for update
    loop
      exit when v_remaining_event <= 0;
      v_remaining_installment := v_installment.amount_minor - v_installment.paid_minor;
      if v_remaining_installment <= 0 then continue; end if;
      v_allocated := least(v_remaining_event, v_remaining_installment);
      insert into public.payment_plan_allocations(payment_plan_id, payment_plan_installment_id, financial_event_id, amount_minor)
      values (v_plan.id, v_installment.id, v_event.id, v_allocated);
      update public.payment_plan_installments set paid_minor = paid_minor + v_allocated
      where id = v_installment.id;
      v_remaining_event := v_remaining_event - v_allocated;
    end loop;
  end loop;

  update public.payment_plan_installments set
    status = case
      when paid_minor >= amount_minor then 'paid'
      when paid_minor > 0 then 'partial'
      when due_date + v_plan.grace_days < v_today then 'overdue'
      else 'scheduled'
    end,
    settled_at = case when paid_minor >= amount_minor then coalesce(settled_at, now()) else null end
  where payment_plan_id = v_plan.id;

  if not exists (select 1 from public.payment_plan_installments where payment_plan_id = v_plan.id and paid_minor < amount_minor)
    and exists (select 1 from public.cases where id = p_case_id and outstanding_minor = 0) then
    update public.payment_plans set status = 'completed' where id = v_plan.id and status <> 'completed';
  elsif v_plan.status = 'completed' then
    -- A reversal rebuilds this projection from approved ledger events and reopens
    -- a previously settled plan without altering financial balances.
    update public.payment_plans set status = 'active' where id = v_plan.id;
  end if;
end;
$$;

create or replace function public.payment_plan_detect_missed(p_as_of_date date default timezone('Asia/Kuala_Lumpur', now())::date)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_plan record; affected integer := 0; previous_status text;
begin
  for v_plan in
    select p.*, c.status as case_status, c.business_id
    from public.payment_plans p join public.cases c on c.id = p.case_id
    where p.status = 'active' and c.archived_at is null and c.status <> 'closed'
    for update of p, c
  loop
    update public.payment_plan_installments set status = case when paid_minor > 0 then 'partial' else 'overdue' end
    where payment_plan_id = v_plan.id and due_date + v_plan.grace_days < p_as_of_date and paid_minor < amount_minor and status <> 'overdue';
    if exists (select 1 from public.payment_plan_installments where payment_plan_id = v_plan.id and due_date + v_plan.grace_days < p_as_of_date and paid_minor < amount_minor) then
      previous_status := v_plan.case_status;
      update public.payment_plans set status = 'defaulted' where id = v_plan.id and status = 'active';
      perform set_config('collectboss.lifecycle_transition', 'on', true);
      update public.cases set status = 'overdue', promise_due_date = null, status_version = status_version + 1, updated_at = now()
      where id = v_plan.case_id and status <> 'overdue';
      if previous_status <> 'overdue' then
        insert into public.case_status_history(case_id, from_status, to_status, transition_reason, actor_type)
        values (v_plan.case_id, previous_status, 'overdue', 'payment plan instalment missed', 'system');
        insert into public.audit_logs(business_id, case_id, action, actor_type, metadata)
        values (v_plan.business_id, v_plan.case_id, 'payment_plan.defaulted', 'system', jsonb_build_object('payment_plan_id', v_plan.id, 'as_of_date', p_as_of_date));
      end if;
      affected := affected + 1;
    end if;
  end loop;
  return affected;
end;
$$;

-- Replaces the ledger projection only to append the plan-progress projection.
-- Financial amounts remain calculated exactly as in 20260720.
create or replace function public.financial_recalculate_case(p_case_id text)
returns public.cases language plpgsql security definer set search_path = public, pg_temp as $$
declare current_case public.cases; debit_minor bigint := 0; credit_minor bigint := 0; payment_minor bigint := 0;
  contractual_minor bigint; outstanding_value bigint; overpayment_value bigint; next_status text;
begin
  select * into current_case from public.cases where id = p_case_id for update;
  if not found then raise exception 'Case not found'; end if;
  select coalesce(sum(case when event_type = 'adjustment_debit' then amount_minor else 0 end), 0),
    coalesce(sum(case when event_type = 'adjustment_credit' then amount_minor else 0 end), 0),
    coalesce(sum(case when event_type in ('opening_payment_credit', 'payment_approved') then amount_minor when event_type = 'payment_reversal' then -amount_minor else 0 end), 0)
  into debit_minor, credit_minor, payment_minor from public.case_financial_events where case_id = p_case_id;
  contractual_minor := current_case.original_principal_minor + debit_minor - credit_minor;
  if contractual_minor < 0 then raise exception 'Adjustment would reduce contractual due below zero'; end if;
  if payment_minor < 0 then raise exception 'Payment reversals exceed approved payment credits'; end if;
  outstanding_value := greatest(contractual_minor - payment_minor, 0);
  overpayment_value := greatest(payment_minor - contractual_minor, 0);
  next_status := case when contractual_minor > 0 and outstanding_value = 0 then 'paid'
    when payment_minor > 0 and outstanding_value > 0 then 'partial_paid'
    when current_case.status = 'paid' then 'action_needed' else current_case.status end;
  perform set_config('collectboss.financial_write', 'on', true);
  perform set_config('collectboss.lifecycle_transition', 'on', true);
  update public.cases set contractual_due_minor = contractual_minor, approved_payment_minor = payment_minor,
    outstanding_minor = outstanding_value, overpayment_minor = overpayment_value,
    amount_owed = contractual_minor::numeric / 100, amount_paid = least(payment_minor, contractual_minor)::numeric / 100,
    status = next_status, status_version = case when next_status is distinct from current_case.status then status_version + 1 else status_version end,
    financial_version = financial_version + 1, updated_at = now() where id = p_case_id returning * into current_case;
  perform public.payment_plan_reconcile_case(p_case_id);
  return current_case;
end;
$$;

revoke all on function public.payment_plan_detect_missed(date) from public;
grant execute on function public.payment_plan_detect_missed(date) to service_role;

commit;

-- Rollback (only after reconciling any retained plan reporting requirements):
-- begin;
-- drop function if exists public.payment_plan_detect_missed(date);
-- drop function if exists public.payment_plan_reconcile_case(text);
-- drop table if exists public.payment_plan_allocations;
-- alter table public.payment_plans drop column if exists grace_days;
-- commit;
