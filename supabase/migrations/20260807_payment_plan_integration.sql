-- Payment-plan scheduler, lifecycle timeline, and once-only action integration.
-- Apply after 20260806_secure_payment_proof_flow.sql.

begin;

create table if not exists public.payment_plan_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  case_id text not null references public.cases(id) on delete cascade,
  payment_plan_id uuid not null references public.payment_plans(id) on delete restrict,
  payment_plan_installment_id uuid references public.payment_plan_installments(id) on delete restrict,
  event_type text not null check (event_type in (
    'due_soon', 'due_today', 'missed', 'partial_payment', 'paid', 'plan_completed'
  )),
  event_date date not null,
  amount_minor bigint,
  paid_minor bigint,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index if not exists payment_plan_events_installment_once_idx
  on public.payment_plan_events(payment_plan_installment_id, event_type)
  where payment_plan_installment_id is not null;
create unique index if not exists payment_plan_events_plan_once_idx
  on public.payment_plan_events(payment_plan_id, event_type)
  where payment_plan_installment_id is null;
create index if not exists payment_plan_events_case_timeline_idx
  on public.payment_plan_events(case_id, created_at, id);

alter table public.payment_plan_events enable row level security;
drop policy if exists "payment_plan_events_owner_read" on public.payment_plan_events;
create policy "payment_plan_events_owner_read" on public.payment_plan_events
  for select to authenticated using (exists (
    select 1 from public.businesses b
    where b.id = payment_plan_events.business_id and b.owner_id = auth.uid()
  ));

create or replace function public.payment_plan_reconcile_case(p_case_id text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_plan public.payment_plans;
  v_event record;
  v_installment public.payment_plan_installments;
  v_case public.cases;
  v_remaining_event bigint;
  v_remaining_installment bigint;
  v_allocated bigint;
  v_today date := timezone('Asia/Kuala_Lumpur', now())::date;
  v_completed boolean := false;
begin
  select * into v_plan from public.payment_plans
  where case_id = p_case_id and status in ('active', 'defaulted', 'completed')
  for update;
  if not found then return; end if;
  select * into v_case from public.cases where id = p_case_id;

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
      update public.payment_plan_installments set paid_minor = paid_minor + v_allocated where id = v_installment.id;
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

  insert into public.payment_plan_events(
    business_id, case_id, payment_plan_id, payment_plan_installment_id,
    event_type, event_date, amount_minor, paid_minor
  )
  select v_case.business_id, v_case.id, v_plan.id, i.id,
    case when i.status = 'paid' then 'paid' else 'partial_payment' end,
    v_today, i.amount_minor, i.paid_minor
  from public.payment_plan_installments i
  where i.payment_plan_id = v_plan.id and i.status in ('paid', 'partial')
  on conflict do nothing;

  update public.action_centre_items set status = 'completed', completed_at = coalesce(completed_at, now())
  where status = 'open' and entity_type = 'payment_plan_installment'
    and entity_id in (
      select id from public.payment_plan_installments
      where payment_plan_id = v_plan.id and status = 'paid'
    );

  v_completed := not exists (
    select 1 from public.payment_plan_installments
    where payment_plan_id = v_plan.id and paid_minor < amount_minor
  ) and v_case.outstanding_minor = 0;
  if v_completed then
    update public.payment_plans set status = 'completed' where id = v_plan.id and status <> 'completed';
    insert into public.payment_plan_events(
      business_id, case_id, payment_plan_id, event_type, event_date, metadata
    ) values (
      v_case.business_id, v_case.id, v_plan.id, 'plan_completed', v_today,
      jsonb_build_object('outstanding_minor', v_case.outstanding_minor)
    ) on conflict do nothing;
    update public.action_centre_items set status = 'completed', completed_at = coalesce(completed_at, now())
    where status = 'open' and case_id = v_case.id
      and entity_type in ('payment_plan', 'payment_plan_installment')
      and (entity_id = v_plan.id or entity_id in (
        select id from public.payment_plan_installments where payment_plan_id = v_plan.id
      ));
  elsif v_plan.status = 'completed' then
    -- A reversal reopens only the projection. Financial balances remain authoritative.
    update public.payment_plans set status = 'active' where id = v_plan.id;
  end if;
end;
$$;

create or replace function public.payment_plan_run_scheduler(
  p_as_of_date date default timezone('Asia/Kuala_Lumpur', now())::date,
  p_due_soon_days integer default 3
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row record;
  v_inserted uuid;
  v_due_soon integer := 0;
  v_due_today integer := 0;
  v_missed integer := 0;
  v_previous_status text;
  v_plan_defaulted integer := 0;
begin
  p_as_of_date := coalesce(p_as_of_date, timezone('Asia/Kuala_Lumpur', now())::date);
  if p_due_soon_days < 1 or p_due_soon_days > 31 then
    raise exception 'Due-soon window must be between 1 and 31 days';
  end if;

  for v_row in
    select p.id as plan_id, p.case_id, c.business_id, c.status as case_status,
      p.status as plan_status, p.grace_days, i.id as installment_id,
      i.sequence_no, i.due_date, i.amount_minor, i.paid_minor
    from public.payment_plans p
    join public.cases c on c.id = p.case_id
    join public.payment_plan_installments i on i.payment_plan_id = p.id
    where p.status in ('active', 'defaulted') and c.archived_at is null
      and c.status <> 'closed' and i.paid_minor < i.amount_minor
    order by i.due_date, i.sequence_no
    for update of p, c, i
  loop
    v_inserted := null;
    if v_row.due_date > p_as_of_date and v_row.due_date <= p_as_of_date + p_due_soon_days then
      insert into public.payment_plan_events(
        business_id, case_id, payment_plan_id, payment_plan_installment_id,
        event_type, event_date, amount_minor, paid_minor
      ) values (
        v_row.business_id, v_row.case_id, v_row.plan_id, v_row.installment_id,
        'due_soon', p_as_of_date, v_row.amount_minor, v_row.paid_minor
      ) on conflict do nothing returning id into v_inserted;
      if v_inserted is not null then v_due_soon := v_due_soon + 1; end if;
    elsif v_row.due_date = p_as_of_date then
      insert into public.payment_plan_events(
        business_id, case_id, payment_plan_id, payment_plan_installment_id,
        event_type, event_date, amount_minor, paid_minor
      ) values (
        v_row.business_id, v_row.case_id, v_row.plan_id, v_row.installment_id,
        'due_today', p_as_of_date, v_row.amount_minor, v_row.paid_minor
      ) on conflict do nothing returning id into v_inserted;
      if v_inserted is not null then v_due_today := v_due_today + 1; end if;
    elsif v_row.due_date + v_row.grace_days < p_as_of_date then
      insert into public.payment_plan_events(
        business_id, case_id, payment_plan_id, payment_plan_installment_id,
        event_type, event_date, amount_minor, paid_minor,
        metadata
      ) values (
        v_row.business_id, v_row.case_id, v_row.plan_id, v_row.installment_id,
        'missed', p_as_of_date, v_row.amount_minor, v_row.paid_minor,
        jsonb_build_object('due_date', v_row.due_date, 'sequence_no', v_row.sequence_no)
      ) on conflict do nothing returning id into v_inserted;

      if v_inserted is not null then
        v_missed := v_missed + 1;
        update public.payment_plan_installments
          set status = case when paid_minor > 0 then 'partial' else 'overdue' end
          where id = v_row.installment_id;
        insert into public.notifications(
          business_id, case_id, type, title, message, entity_type, entity_id
        ) values (
          v_row.business_id, v_row.case_id, 'payment_plan.missed', 'Payment-plan installment missed',
          format('Installment %s was due on %s. RM %s remains unpaid.', v_row.sequence_no, v_row.due_date,
            to_char((v_row.amount_minor - v_row.paid_minor)::numeric / 100, 'FM9999999990.00')),
          'payment_plan_installment', v_row.installment_id
        );
        insert into public.action_centre_items(
          business_id, case_id, type, title, description, href, entity_type, entity_id
        ) values (
          v_row.business_id, v_row.case_id, 'payment_plan.missed', 'Follow up missed installment',
          format('Installment %s due %s has RM %s remaining.', v_row.sequence_no, v_row.due_date,
            to_char((v_row.amount_minor - v_row.paid_minor)::numeric / 100, 'FM9999999990.00')),
          '/cases/' || v_row.case_id, 'payment_plan_installment', v_row.installment_id
        ) on conflict (type, entity_id) do nothing;
        insert into public.audit_logs(business_id, case_id, action, actor_type, metadata)
        values (v_row.business_id, v_row.case_id, 'payment_plan.installment_missed', 'system',
          jsonb_build_object('payment_plan_id', v_row.plan_id, 'installment_id', v_row.installment_id,
            'due_date', v_row.due_date, 'as_of_date', p_as_of_date));
      end if;

      if v_row.plan_status = 'active' then
        update public.payment_plans set status = 'defaulted' where id = v_row.plan_id and status = 'active';
        get diagnostics v_plan_defaulted = row_count;
        if v_plan_defaulted = 1 then
          select status into v_previous_status from public.cases where id = v_row.case_id;
          perform set_config('collectboss.lifecycle_transition', 'on', true);
          update public.cases set status = 'overdue', promise_due_date = null,
            status_version = status_version + 1, updated_at = now()
          where id = v_row.case_id and status <> 'overdue';
          if v_previous_status <> 'overdue' then
            insert into public.case_status_history(case_id, from_status, to_status, transition_reason, actor_type)
            values (v_row.case_id, v_previous_status, 'overdue', 'payment plan installment missed', 'system');
          end if;
        end if;
      end if;
    end if;
  end loop;

  return jsonb_build_object('due_soon', v_due_soon, 'due_today', v_due_today, 'missed', v_missed);
end;
$$;

-- Backward-compatible wrapper for existing scheduler callers.
create or replace function public.payment_plan_detect_missed(
  p_as_of_date date default timezone('Asia/Kuala_Lumpur', now())::date
) returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_result jsonb;
begin
  v_result := public.payment_plan_run_scheduler(p_as_of_date, 3);
  return coalesce((v_result ->> 'missed')::integer, 0);
end;
$$;

revoke all on function public.payment_plan_run_scheduler(date, integer) from public;
grant execute on function public.payment_plan_run_scheduler(date, integer) to service_role;
revoke all on function public.payment_plan_detect_missed(date) from public;
grant execute on function public.payment_plan_detect_missed(date) to service_role;

commit;

-- Rollback considerations:
-- Keep payment_plan_events for audit retention. Disable the scheduler route first,
-- restore payment_plan_reconcile_case/payment_plan_detect_missed from migration
-- 20260724, then drop payment_plan_run_scheduler. Drop the table only where audit
-- retention permits it; notifications and actions are intentionally preserved.
