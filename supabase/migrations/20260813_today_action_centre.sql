-- R05 Today / Action Centre.
-- Apply after 20260812_smart_notification_engine.sql.
--
-- This migration extends the existing Action Centre. It does not copy
-- notifications into work items and does not replace existing Y02/Y04/Y05
-- writers or their underlying-task completion behavior.

begin;

alter table public.action_centre_items
  add column if not exists customer_id uuid references public.debtors(id) on delete set null,
  add column if not exists assignee_id uuid references auth.users(id) on delete set null,
  add column if not exists reason text,
  add column if not exists amount_minor bigint,
  add column if not exists priority text not null default 'medium',
  add column if not exists recommended_action text,
  add column if not exists source_event_id uuid references public.domain_events(id) on delete restrict,
  add column if not exists snoozed_until timestamptz,
  add column if not exists dedupe_key text;

update public.action_centre_items a
set
  customer_id = coalesce(a.customer_id, c.debtor_id),
  assignee_id = coalesce(a.assignee_id, b.owner_id),
  reason = coalesce(nullif(btrim(a.reason), ''), a.description),
  amount_minor = coalesce(a.amount_minor, greatest(c.outstanding_minor, 0)),
  priority = case
    when a.type in ('payment_plan.missed', 'promise.missed') then 'high'
    when a.type in ('review_payment_proof', 'legal_handoff.documents_requested') then 'medium'
    else coalesce(a.priority, 'medium')
  end,
  recommended_action = coalesce(nullif(btrim(a.recommended_action), ''), a.title),
  dedupe_key = coalesce(a.dedupe_key, 'legacy:' || a.id::text)
from public.cases c
join public.businesses b on b.id = c.business_id
where c.id = a.case_id and c.business_id = a.business_id;

update public.action_centre_items
set
  reason = coalesce(nullif(btrim(reason), ''), description),
  amount_minor = coalesce(amount_minor, 0),
  recommended_action = coalesce(nullif(btrim(recommended_action), ''), title),
  dedupe_key = coalesce(dedupe_key, 'legacy:' || id::text),
  completed_at = case
    when status in ('completed', 'dismissed') then coalesce(completed_at, created_at)
    else null
  end
where reason is null
   or amount_minor is null
   or recommended_action is null
   or dedupe_key is null;

alter table public.action_centre_items
  alter column reason set not null,
  alter column amount_minor set not null,
  alter column recommended_action set not null,
  alter column dedupe_key set not null,
  drop constraint if exists action_centre_items_status_check,
  add constraint action_centre_items_status_check check (
    status in ('open', 'in_progress', 'snoozed', 'completed', 'dismissed')
  ),
  drop constraint if exists action_centre_items_priority_check,
  add constraint action_centre_items_priority_check check (
    priority in ('critical', 'high', 'medium', 'low')
  ),
  drop constraint if exists action_centre_items_amount_check,
  add constraint action_centre_items_amount_check check (amount_minor >= 0),
  drop constraint if exists action_centre_items_href_check,
  add constraint action_centre_items_href_check check (
    left(href, 1) = '/' and left(href, 2) <> '//'
  ),
  drop constraint if exists action_centre_items_state_check,
  add constraint action_centre_items_state_check check (
    (status = 'snoozed' and snoozed_until is not null)
    or (status <> 'snoozed' and snoozed_until is null)
  ),
  drop constraint if exists action_centre_items_completion_check,
  add constraint action_centre_items_completion_check check (
    (status in ('completed', 'dismissed') and completed_at is not null)
    or (status not in ('completed', 'dismissed') and completed_at is null)
  );

create unique index if not exists action_centre_items_business_dedupe_uidx
  on public.action_centre_items (business_id, dedupe_key);
drop index if exists public.action_centre_items_business_open_idx;
drop index if exists public.action_centre_items_due_idx;
create index action_centre_items_business_active_idx
  on public.action_centre_items (business_id, priority, due_at, created_at)
  where status in ('open', 'in_progress', 'snoozed');
create index if not exists action_centre_items_assignee_active_idx
  on public.action_centre_items (assignee_id, priority, due_at)
  where assignee_id is not null and status in ('open', 'in_progress', 'snoozed');
create index if not exists action_centre_items_customer_idx
  on public.action_centre_items (business_id, customer_id, created_at desc)
  where customer_id is not null;
create unique index if not exists action_centre_items_source_event_uidx
  on public.action_centre_items (source_event_id)
  where source_event_id is not null;

create table if not exists public.action_centre_item_events (
  id uuid primary key default gen_random_uuid(),
  action_item_id uuid not null references public.action_centre_items(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  case_id text references public.cases(id) on delete set null,
  actor_type text not null check (actor_type in ('owner', 'system')),
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null check (
    event_type in ('created', 'started', 'snoozed', 'reopened', 'completed', 'dismissed', 'auto_completed')
  ),
  from_status text,
  to_status text not null,
  snooze_duration_seconds integer,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  check (snooze_duration_seconds is null or snooze_duration_seconds between 900 and 2592000)
);
create index if not exists action_centre_item_events_action_idx
  on public.action_centre_item_events (action_item_id, created_at, id);
create index if not exists action_centre_item_events_tenant_idx
  on public.action_centre_item_events (business_id, created_at desc);

insert into public.action_centre_item_events (
  action_item_id, business_id, case_id, actor_type, event_type,
  to_status, metadata, created_at
)
select
  a.id, a.business_id, a.case_id, 'system', 'created',
  a.status, jsonb_build_object('legacy_backfill', true), a.created_at
from public.action_centre_items a
where not exists (
  select 1 from public.action_centre_item_events e
  where e.action_item_id = a.id and e.event_type = 'created'
);

create or replace function public.action_centre_normalize()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.reason := coalesce(nullif(btrim(new.reason), ''), new.description);
  new.recommended_action := coalesce(nullif(btrim(new.recommended_action), ''), new.title);
  new.amount_minor := coalesce(new.amount_minor, 0);
  new.dedupe_key := coalesce(
    nullif(btrim(new.dedupe_key), ''),
    concat_ws(':', 'legacy', new.type, coalesce(new.entity_type, 'action'), coalesce(new.entity_id::text, new.id::text))
  );

  if new.status in ('completed', 'dismissed') then
    new.completed_at := coalesce(new.completed_at, now());
    new.snoozed_until := null;
  else
    new.completed_at := null;
  end if;
  if new.status <> 'snoozed' then new.snoozed_until := null; end if;

  if new.case_id is not null and not exists (
    select 1 from public.cases c where c.id = new.case_id and c.business_id = new.business_id
  ) then raise exception 'Action case is outside the tenant'; end if;
  if new.customer_id is not null and not exists (
    select 1 from public.debtors d where d.id = new.customer_id and d.business_id = new.business_id
  ) then raise exception 'Action customer is outside the tenant'; end if;
  if new.source_event_id is not null and not exists (
    select 1 from public.domain_events de where de.id = new.source_event_id and de.business_id = new.business_id
  ) then raise exception 'Action source event is outside the tenant'; end if;
  return new;
end;
$$;

drop trigger if exists action_centre_normalize_trigger on public.action_centre_items;
create trigger action_centre_normalize_trigger
before insert or update on public.action_centre_items
for each row execute function public.action_centre_normalize();

create or replace function public.action_centre_record_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id uuid := auth.uid();
  v_event_type text;
  v_duration integer;
begin
  if tg_op = 'INSERT' then
    v_event_type := 'created';
  elsif new.status is not distinct from old.status
     and new.snoozed_until is not distinct from old.snoozed_until then
    return new;
  else
    v_event_type := case
      when new.status = 'in_progress' then 'started'
      when new.status = 'snoozed' then 'snoozed'
      when new.status = 'open' then 'reopened'
      when new.status = 'dismissed' then 'dismissed'
      when new.status = 'completed' and v_actor_id is null then 'auto_completed'
      else 'completed'
    end;
  end if;
  if new.status = 'snoozed' then
    v_duration := greatest(900, extract(epoch from new.snoozed_until - now())::integer);
  end if;
  insert into public.action_centre_item_events (
    action_item_id, business_id, case_id, actor_type, actor_id, event_type,
    from_status, to_status, snooze_duration_seconds, metadata
  ) values (
    new.id, new.business_id, new.case_id,
    case when v_actor_id is null then 'system' else 'owner' end,
    v_actor_id, v_event_type,
    case when tg_op = 'UPDATE' then old.status else null end,
    new.status, v_duration,
    jsonb_build_object('source_event_id', new.source_event_id)
  );
  return new;
end;
$$;

drop trigger if exists action_centre_record_event_trigger on public.action_centre_items;
create trigger action_centre_record_event_trigger
after insert or update of status, snoozed_until on public.action_centre_items
for each row execute function public.action_centre_record_event();

create or replace function public.action_centre_transition(
  p_action_id uuid,
  p_transition text,
  p_snoozed_until timestamptz default null
)
returns public.action_centre_items
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_action public.action_centre_items;
begin
  select a.* into v_action
  from public.action_centre_items a
  join public.businesses b on b.id = a.business_id
  where a.id = p_action_id and b.owner_id = auth.uid()
  for update of a;
  if not found then raise exception 'Action item not found'; end if;
  if v_action.status in ('completed', 'dismissed') then
    if p_transition = v_action.status then return v_action; end if;
    raise exception 'Completed Action Centre history is immutable';
  end if;
  if p_transition not in ('open', 'in_progress', 'snoozed', 'completed', 'dismissed') then
    raise exception 'Unsupported Action Centre transition';
  end if;
  if p_transition = 'snoozed' and (
    p_snoozed_until is null
    or p_snoozed_until < now() + interval '15 minutes'
    or p_snoozed_until > now() + interval '30 days'
  ) then raise exception 'Snooze must be between 15 minutes and 30 days'; end if;
  if p_transition <> 'snoozed' and p_snoozed_until is not null then
    raise exception 'Snooze time is only valid for a snoozed action'; end if;

  update public.action_centre_items
  set status = p_transition,
      snoozed_until = case when p_transition = 'snoozed' then p_snoozed_until else null end,
      completed_at = case when p_transition in ('completed', 'dismissed') then now() else null end
  where id = v_action.id
  returning * into v_action;
  return v_action;
end;
$$;

create or replace function public.action_centre_consume_domain_events(
  p_limit integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inserted integer := 0;
  v_woken integer := 0;
begin
  if p_limit < 1 or p_limit > 1000 then
    raise exception 'Action Centre batch limit must be between 1 and 1000';
  end if;

  update public.action_centre_items
  set status = 'open', snoozed_until = null
  where status = 'snoozed' and snoozed_until <= now();
  get diagnostics v_woken = row_count;

  -- R03 can detect an already-existing scheduled action. Link that event to
  -- the existing row instead of creating recursive follow-up work.
  update public.action_centre_items a
  set source_event_id = de.id,
      dedupe_key = 'domain-event:' || de.id::text
  from public.domain_events de
  where de.event_status = 'pending'
    and de.event_type = 'FOLLOW_UP_DUE'
    and de.source_entity_type = 'action_centre_item'
    and de.source_entity_id = a.id::text
    and de.business_id = a.business_id
    and a.source_event_id is null;

  -- A missed installment supersedes any still-active "due today" work.
  update public.action_centre_items a
  set status = 'completed', completed_at = now()
  from public.domain_events de
  where de.event_status = 'pending'
    and de.event_type = 'PLAN_INSTALLMENT_MISSED'
    and a.business_id = de.business_id
    and a.entity_type = 'payment_plan_installment'
    and a.entity_id::text = de.source_entity_id
    and a.type = 'payment_plan.due'
    and a.status in ('open', 'in_progress', 'snoozed');

  with selected as (
    select de.*
    from public.domain_events de
    where de.event_status = 'pending'
      and de.event_type in (
        'FOLLOW_UP_DUE', 'PROMISE_MISSED', 'PLAN_INSTALLMENT_DUE',
        'PLAN_INSTALLMENT_MISSED', 'DISPUTE_REVIEW_DUE',
        'DISPUTE_SUBMITTED', 'PAYMENT_PROOF_REVIEW_REQUIRED'
      )
      and not (
        de.event_type = 'FOLLOW_UP_DUE'
        and de.source_entity_type = 'action_centre_item'
      )
      and not exists (
        select 1 from public.action_centre_items a where a.source_event_id = de.id
      )
    order by de.effective_date, de.created_at, de.id
    limit p_limit
    for update skip locked
  ),
  inserted as (
    insert into public.action_centre_items (
      business_id, case_id, customer_id, assignee_id, type, title,
      description, reason, href, entity_type, entity_id, amount_minor,
      priority, due_at, status, recommended_action, source_event_id, dedupe_key
    )
    select
      de.business_id,
      de.case_id,
      de.customer_id,
      b.owner_id,
      case de.event_type
        when 'PROMISE_MISSED' then 'promise.missed'
        when 'PLAN_INSTALLMENT_DUE' then 'payment_plan.due'
        when 'PLAN_INSTALLMENT_MISSED' then 'payment_plan.missed'
        when 'FOLLOW_UP_DUE' then 'follow_up.due'
        when 'PAYMENT_PROOF_REVIEW_REQUIRED' then 'review_payment_proof'
        when 'DISPUTE_REVIEW_DUE' then 'review_dispute'
        when 'DISPUTE_SUBMITTED' then 'review_dispute'
      end,
      case de.event_type
        when 'PROMISE_MISSED' then 'Follow up missed promise'
        when 'PLAN_INSTALLMENT_DUE' then 'Payment-plan installment due'
        when 'PLAN_INSTALLMENT_MISSED' then 'Follow up missed installment'
        when 'FOLLOW_UP_DUE' then 'Follow-up due'
        when 'PAYMENT_PROOF_REVIEW_REQUIRED' then 'Review payment proof'
        else 'Review customer dispute'
      end,
      case de.event_type
        when 'PROMISE_MISSED' then 'The promised payment date passed while an outstanding balance remains.'
        when 'PLAN_INSTALLMENT_DUE' then 'An active payment-plan installment is due today.'
        when 'PLAN_INSTALLMENT_MISSED' then 'A payment-plan installment remains unpaid after its grace period.'
        when 'FOLLOW_UP_DUE' then 'A scheduled customer follow-up is now due.'
        when 'PAYMENT_PROOF_REVIEW_REQUIRED' then 'A debtor payment proof requires creditor review.'
        when 'DISPUTE_REVIEW_DUE' then 'A scheduled dispute review is due.'
        else 'A customer dispute requires creditor review.'
      end,
      case de.event_type
        when 'PROMISE_MISSED' then 'Promised payment was not recorded by the due date.'
        when 'PLAN_INSTALLMENT_DUE' then 'Installment due today.'
        when 'PLAN_INSTALLMENT_MISSED' then 'Installment remains unpaid after the configured grace period.'
        when 'FOLLOW_UP_DUE' then 'Scheduled follow-up date reached.'
        when 'PAYMENT_PROOF_REVIEW_REQUIRED' then 'Payment proof is awaiting a confirmation or rejection decision.'
        when 'DISPUTE_REVIEW_DUE' then 'Dispute review date reached.'
        else 'Customer submitted a dispute.'
      end,
      case
        when de.event_type = 'PAYMENT_PROOF_REVIEW_REQUIRED' then '/payments'
        when de.case_id is not null then '/cases/' || de.case_id
        else '/debtors'
      end,
      de.source_entity_type,
      case
        when de.source_entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then de.source_entity_id::uuid
        else null
      end,
      case
        when de.event_type in ('PLAN_INSTALLMENT_DUE', 'PLAN_INSTALLMENT_MISSED')
          then greatest(coalesce((de.payload ->> 'amount_minor')::bigint, 0) - coalesce((de.payload ->> 'paid_minor')::bigint, 0), 0)
        when de.event_type = 'PAYMENT_PROOF_REVIEW_REQUIRED'
          then greatest(round(coalesce((de.payload ->> 'amount')::numeric, 0) * 100)::bigint, 0)
        else greatest(coalesce(c.outstanding_minor, o.outstanding_minor, 0), 0)
      end,
      case
        when de.event_type in ('PROMISE_MISSED', 'PLAN_INSTALLMENT_MISSED') then 'high'
        when de.event_type in ('PAYMENT_PROOF_REVIEW_REQUIRED', 'DISPUTE_REVIEW_DUE', 'DISPUTE_SUBMITTED') then 'medium'
        else 'medium'
      end,
      de.effective_date::timestamp at time zone de.event_timezone,
      'open',
      case de.event_type
        when 'PROMISE_MISSED' then 'Follow up with customer'
        when 'PLAN_INSTALLMENT_DUE' then 'Review installment'
        when 'PLAN_INSTALLMENT_MISSED' then 'Follow up on installment'
        when 'FOLLOW_UP_DUE' then 'Open case follow-up'
        when 'PAYMENT_PROOF_REVIEW_REQUIRED' then 'Review payment proof'
        else 'Review dispute'
      end,
      de.id,
      'domain-event:' || de.id::text
    from selected de
    join public.businesses b on b.id = de.business_id
    left join public.cases c on c.id = de.case_id and c.business_id = de.business_id
    left join public.obligations o on o.id = de.obligation_id and o.business_id = de.business_id
    where (c.id is null or (
      c.archived_at is null
      and c.status not in ('paid', 'closed')
      and c.outstanding_minor > 0
    ))
      and (
        (de.event_type = 'PROMISE_MISSED'
          and c.status = 'payment_promise'
          and c.promise_due_date::text = (de.payload ->> 'promise_due_date'))
        or (de.event_type in ('PLAN_INSTALLMENT_DUE', 'PLAN_INSTALLMENT_MISSED') and exists (
          select 1 from public.payment_plan_installments i
          where i.id::text = de.source_entity_id and i.paid_minor < i.amount_minor
        ))
        or (de.event_type = 'PAYMENT_PROOF_REVIEW_REQUIRED' and exists (
          select 1 from public.public_payment_submissions s
          where s.id::text = de.source_entity_id
            and s.business_id = de.business_id
            and s.status::text in ('pending_review', 'submitted', 'under_review')
        ))
        or (de.event_type in ('DISPUTE_REVIEW_DUE', 'DISPUTE_SUBMITTED') and o.status = 'disputed')
        or (de.event_type = 'FOLLOW_UP_DUE' and exists (
          select 1 from public.reminders r
          where r.id::text = de.source_entity_id
            and r.next_action_at::text = de.source_version
            and r.next_action_at <= now()
        ))
      )
    on conflict (type, entity_id) do update
      set source_event_id = coalesce(public.action_centre_items.source_event_id, excluded.source_event_id),
          customer_id = coalesce(public.action_centre_items.customer_id, excluded.customer_id),
          assignee_id = coalesce(public.action_centre_items.assignee_id, excluded.assignee_id),
          amount_minor = excluded.amount_minor,
          due_at = coalesce(public.action_centre_items.due_at, excluded.due_at)
    returning id
  )
  select count(*)::integer into v_inserted from inserted;

  return jsonb_build_object('projected', v_inserted, 'woken', v_woken);
end;
$$;

-- Existing underlying workflows already close many rows. These triggers cover
-- snoozed/in-progress work and future callers without duplicating balance logic.
create or replace function public.action_centre_auto_close()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_table_name = 'payment_plan_installments' and new.status = 'paid' then
    update public.action_centre_items set status = 'completed', completed_at = now()
    where business_id = (select p.business_id from public.payment_plans p where p.id = new.payment_plan_id)
      and entity_type = 'payment_plan_installment' and entity_id = new.id
      and status in ('open', 'in_progress', 'snoozed');
  elsif tg_table_name = 'public_payment_submissions'
    and new.status::text in ('confirmed', 'approved', 'rejected') then
    update public.action_centre_items set status = 'completed', completed_at = now()
    where business_id = new.business_id and entity_type in ('payment_proof', 'payment_proof_submission')
      and entity_id = new.id and status in ('open', 'in_progress', 'snoozed');
  elsif tg_table_name = 'obligations' and new.status <> 'disputed' then
    update public.action_centre_items set status = 'completed', completed_at = now()
    where business_id = new.business_id and entity_type = 'obligation_dispute'
      and entity_id = new.id and status in ('open', 'in_progress', 'snoozed');
  elsif tg_table_name = 'legal_handoff_document_requests' and new.status <> 'open' then
    update public.action_centre_items set status = 'completed', completed_at = now()
    where business_id = new.business_id and entity_type = 'legal_handoff_document_request'
      and entity_id = new.id and status in ('open', 'in_progress', 'snoozed');
  elsif tg_table_name = 'cases'
    and (new.status in ('paid', 'closed') or new.outstanding_minor = 0 or new.archived_at is not null) then
    update public.action_centre_items set status = 'completed', completed_at = now()
    where business_id = new.business_id and case_id = new.id
      and status in ('open', 'in_progress', 'snoozed');
  end if;
  return new;
end;
$$;

drop trigger if exists action_centre_close_installment on public.payment_plan_installments;
create trigger action_centre_close_installment after update of status, paid_minor
on public.payment_plan_installments for each row execute function public.action_centre_auto_close();
drop trigger if exists action_centre_close_payment_proof on public.public_payment_submissions;
create trigger action_centre_close_payment_proof after update of status
on public.public_payment_submissions for each row execute function public.action_centre_auto_close();
drop trigger if exists action_centre_close_dispute on public.obligations;
create trigger action_centre_close_dispute after update of status
on public.obligations for each row execute function public.action_centre_auto_close();
drop trigger if exists action_centre_close_document_request on public.legal_handoff_document_requests;
create trigger action_centre_close_document_request after update of status
on public.legal_handoff_document_requests for each row execute function public.action_centre_auto_close();
drop trigger if exists action_centre_close_case on public.cases;
create trigger action_centre_close_case after update of status, outstanding_minor, archived_at
on public.cases for each row execute function public.action_centre_auto_close();

create or replace function public.action_centre_customer_response()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan public.payment_plans;
  v_case public.cases;
  v_owner uuid;
begin
  select * into v_plan from public.payment_plans where id = new.payment_plan_id;
  select * into v_case from public.cases where id = v_plan.case_id;
  select owner_id into v_owner from public.businesses where id = v_case.business_id;
  insert into public.action_centre_items (
    business_id, case_id, customer_id, assignee_id, type, title, description,
    reason, href, entity_type, entity_id, amount_minor, priority, due_at,
    recommended_action, dedupe_key
  ) values (
    v_case.business_id, v_case.id, v_case.debtor_id, v_owner,
    'customer.response', 'Customer responded to payment plan',
    'The customer ' || new.decision || ' the proposed payment plan.',
    'A customer response was received and should be acknowledged.',
    '/cases/' || v_case.id, 'payment_plan_acknowledgement', new.id,
    greatest(v_case.outstanding_minor, 0),
    case when new.decision = 'rejected' then 'high' else 'medium' end,
    now(), 'Review customer response', 'customer-response:' || new.id::text
  ) on conflict (type, entity_id) do nothing;
  return new;
end;
$$;
drop trigger if exists action_centre_customer_response_trigger on public.payment_plan_acknowledgements;
create trigger action_centre_customer_response_trigger
after insert on public.payment_plan_acknowledgements
for each row execute function public.action_centre_customer_response();

alter table public.action_centre_items enable row level security;
drop policy if exists "action_centre_items_owner_read" on public.action_centre_items;
drop policy if exists "action_centre_items_owner_update" on public.action_centre_items;
create policy "action_centre_items_owner_read"
  on public.action_centre_items for select to authenticated
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = auth.uid()
    )
    and (assignee_id is null or assignee_id = auth.uid())
  );

alter table public.action_centre_item_events enable row level security;
create policy "action_centre_item_events_owner_read"
  on public.action_centre_item_events for select to authenticated
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = auth.uid()
    )
  );

revoke all on function public.action_centre_transition(uuid,text,timestamptz) from public, anon;
grant execute on function public.action_centre_transition(uuid,text,timestamptz) to authenticated;
revoke all on function public.action_centre_consume_domain_events(integer) from public, anon, authenticated;
grant execute on function public.action_centre_consume_domain_events(integer) to service_role;
revoke all on function public.action_centre_customer_response() from public, anon, authenticated;
revoke all on function public.action_centre_auto_close() from public, anon, authenticated;
revoke all on function public.action_centre_record_event() from public, anon, authenticated;

commit;

-- Rollback considerations:
-- Stop the R03/R04/R05 cron endpoint before rollback. Preserve action rows and
-- action_centre_item_events for audit. Remove R05 triggers/functions and restore
-- the earlier read/update policies before removing additive columns. Do not
-- restore the old status constraint until every in_progress/snoozed row has
-- been deliberately transitioned; never delete those rows to satisfy rollback.
