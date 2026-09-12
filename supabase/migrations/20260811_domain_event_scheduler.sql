-- Tenant-aware, timezone-aware recovery domain-event scheduler.
-- Apply after 20260810_safe_receivables_backfill.sql.
--
-- Detection is deliberately separated from notification/message delivery.
-- This migration creates domain events only; it never contacts a debtor.

begin;

alter table public.businesses
  add column if not exists timezone text not null default 'Asia/Kuala_Lumpur';

create or replace function public.validate_business_timezone()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from pg_catalog.pg_timezone_names where name = new.timezone
  ) then
    raise exception 'Unsupported business timezone';
  end if;
  return new;
end;
$$;

drop trigger if exists businesses_validate_timezone on public.businesses;
create trigger businesses_validate_timezone
before insert or update of timezone on public.businesses
for each row execute function public.validate_business_timezone();

alter table public.obligations
  add column if not exists dispute_review_at timestamptz;

alter table public.action_centre_items
  add column if not exists due_at timestamptz;

create index if not exists obligations_dispute_review_due_idx
  on public.obligations (business_id, dispute_review_at)
  where status = 'disputed' and archived_at is null and dispute_review_at is not null;

create index if not exists action_centre_items_due_idx
  on public.action_centre_items (business_id, due_at)
  where status = 'open' and due_at is not null;

create index if not exists reminders_next_action_due_idx
  on public.reminders (next_action_at, case_id)
  where next_action_at is not null;

create index if not exists cases_promise_scheduler_idx
  on public.cases (business_id, promise_due_date)
  where status = 'payment_promise' and archived_at is null;

create index if not exists cases_invoice_scheduler_idx
  on public.cases (business_id, due_date)
  where archived_at is null and outstanding_minor > 0;

create index if not exists obligations_invoice_scheduler_idx
  on public.obligations (business_id, due_date)
  where archived_at is null and outstanding_minor > 0;

create index if not exists payment_proof_review_scheduler_idx
  on public.public_payment_submissions (status, created_at);

create table if not exists public.domain_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  case_id text references public.cases(id) on delete set null,
  customer_id uuid references public.debtors(id) on delete set null,
  account_id uuid references public.customer_accounts(id) on delete set null,
  obligation_id uuid references public.obligations(id) on delete set null,
  event_type text not null check (event_type in (
    'FOLLOW_UP_DUE',
    'INVOICE_OVERDUE',
    'PROMISE_DUE',
    'PROMISE_MISSED',
    'PLAN_INSTALLMENT_DUE',
    'PLAN_INSTALLMENT_MISSED',
    'DISPUTE_REVIEW_DUE',
    'PAYMENT_PROOF_REVIEW_REQUIRED'
  )),
  source_entity_type text not null,
  source_entity_id text not null,
  source_version text not null,
  effective_date date not null,
  event_timezone text not null,
  occurred_at timestamptz not null,
  event_status text not null default 'pending'
    check (event_status in ('pending', 'acknowledged', 'resolved', 'ignored')),
  resolved_at timestamptz,
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object'),
  deduplication_key text not null unique,
  created_at timestamptz not null default now(),
  constraint domain_events_source_check check (
    nullif(btrim(source_entity_type), '') is not null
    and nullif(btrim(source_entity_id), '') is not null
    and nullif(btrim(source_version), '') is not null
  ),
  constraint domain_events_resolution_check check (
    (event_status in ('pending', 'acknowledged') and resolved_at is null)
    or (event_status in ('resolved', 'ignored') and resolved_at is not null)
  )
);

create index if not exists domain_events_business_pending_idx
  on public.domain_events (business_id, effective_date, created_at)
  where event_status = 'pending';
create index if not exists domain_events_case_timeline_idx
  on public.domain_events (case_id, effective_date, created_at, id)
  where case_id is not null;
create index if not exists domain_events_type_effective_idx
  on public.domain_events (event_type, effective_date);

alter table public.domain_events enable row level security;

drop policy if exists "domain_events: owner read" on public.domain_events;
create policy "domain_events: owner read"
  on public.domain_events for select to authenticated
  using (exists (
    select 1 from public.businesses b
    where b.id = business_id and b.owner_id = auth.uid()
  ));

create or replace function public.domain_events_detect(
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_inserted integer := 0;
  v_by_type jsonb := '{}'::jsonb;
begin
  -- One database transaction performs a run at a time. Unique deterministic
  -- keys remain the final concurrency and retry-safety boundary.
  if not pg_try_advisory_xact_lock(hashtext('collectboss:domain_events_detect')) then
    return jsonb_build_object(
      'status', 'skipped_concurrent',
      'executed_at', v_now,
      'inserted', 0,
      'by_type', '{}'::jsonb
    );
  end if;

  with candidates as (
    -- Explicit follow-up dates from the existing reminder lifecycle.
    select
      c.business_id,
      c.id as case_id,
      c.debtor_id as customer_id,
      c.account_id,
      null::uuid as obligation_id,
      'FOLLOW_UP_DUE'::text as event_type,
      'reminder'::text as source_entity_type,
      r.id::text as source_entity_id,
      r.next_action_at::text as source_version,
      timezone(b.timezone, r.next_action_at)::date as effective_date,
      b.timezone as event_timezone,
      jsonb_build_object(
        'reminder_id', r.id,
        'scheduled_at', r.next_action_at
      ) as payload
    from public.reminders r
    join public.cases c on c.id = r.case_id
    join public.businesses b on b.id = c.business_id
    where r.next_action_at is not null
      and r.next_action_at <= v_now
      and c.archived_at is null
      and c.status not in ('paid', 'closed')

    union all

    -- Due unresolved Action Centre work. This remains event detection only.
    select
      a.business_id,
      c.id,
      c.debtor_id,
      c.account_id,
      null::uuid,
      'FOLLOW_UP_DUE',
      'action_centre_item',
      a.id::text,
      a.due_at::text,
      timezone(b.timezone, a.due_at)::date,
      b.timezone,
      jsonb_build_object('action_centre_item_id', a.id, 'scheduled_at', a.due_at)
    from public.action_centre_items a
    join public.cases c on c.id = a.case_id and c.business_id = a.business_id
    join public.businesses b on b.id = a.business_id
    where a.status = 'open'
      and a.due_at is not null
      and a.due_at <= v_now
      and c.archived_at is null
      and c.status not in ('paid', 'closed')

    union all

    -- Enhanced-model invoices/obligations become overdue on the day after due.
    select
      o.business_id,
      rco.case_id,
      o.customer_id,
      o.account_id,
      o.id,
      'INVOICE_OVERDUE',
      'obligation',
      o.id::text,
      o.due_date::text,
      o.due_date + 1,
      b.timezone,
      jsonb_build_object(
        'obligation_id', o.id,
        'reference', o.reference,
        'due_date', o.due_date,
        'outstanding_minor', o.outstanding_minor
      )
    from public.obligations o
    join public.businesses b on b.id = o.business_id
    left join public.recovery_case_obligations rco on rco.obligation_id = o.id
    where o.archived_at is null
      and o.status in ('open', 'overdue', 'partial')
      and o.outstanding_minor > 0
      and o.due_date < timezone(b.timezone, v_now)::date

    union all

    -- Standalone legacy cases retain their existing invoice/due-date behavior.
    select
      c.business_id,
      c.id,
      c.debtor_id,
      c.account_id,
      null::uuid,
      'INVOICE_OVERDUE',
      'legacy_case',
      c.id,
      c.due_date::text,
      c.due_date + 1,
      b.timezone,
      jsonb_build_object(
        'case_id', c.id,
        'invoice_reference', c.invoice_no,
        'due_date', c.due_date,
        'outstanding_minor', c.outstanding_minor
      )
    from public.cases c
    join public.businesses b on b.id = c.business_id
    where c.archived_at is null
      and c.status not in ('paid', 'closed')
      and c.outstanding_minor > 0
      and c.due_date < timezone(b.timezone, v_now)::date
      and not exists (
        select 1 from public.recovery_case_obligations rco
        where rco.case_id = c.id
      )

    union all

    -- Standalone promises only; accepted plans have their own schedule events.
    select
      c.business_id,
      c.id,
      c.debtor_id,
      c.account_id,
      null::uuid,
      'PROMISE_DUE',
      'case_promise',
      c.id,
      c.status_version::text || ':' || c.promise_due_date::text,
      c.promise_due_date,
      b.timezone,
      jsonb_build_object('case_id', c.id, 'promise_due_date', c.promise_due_date)
    from public.cases c
    join public.businesses b on b.id = c.business_id
    where c.status = 'payment_promise'
      and c.promise_due_date = timezone(b.timezone, v_now)::date
      and c.archived_at is null
      and c.outstanding_minor > 0
      and not exists (
        select 1 from public.payment_plans p
        where p.case_id = c.id and p.status in ('pending_acceptance', 'active', 'defaulted')
      )

    union all

    select
      c.business_id,
      c.id,
      c.debtor_id,
      c.account_id,
      null::uuid,
      'PROMISE_MISSED',
      'case_promise',
      c.id,
      c.status_version::text || ':' || c.promise_due_date::text,
      c.promise_due_date + 1,
      b.timezone,
      jsonb_build_object('case_id', c.id, 'promise_due_date', c.promise_due_date)
    from public.cases c
    join public.businesses b on b.id = c.business_id
    where c.status = 'payment_promise'
      and c.promise_due_date < timezone(b.timezone, v_now)::date
      and c.archived_at is null
      and c.outstanding_minor > 0
      and not exists (
        select 1 from public.payment_plans p
        where p.case_id = c.id and p.status in ('pending_acceptance', 'active', 'defaulted')
      )

    union all

    select
      c.business_id,
      c.id,
      c.debtor_id,
      c.account_id,
      null::uuid,
      'PLAN_INSTALLMENT_DUE',
      'payment_plan_installment',
      i.id::text,
      i.due_date::text || ':' || p.grace_days::text,
      i.due_date,
      p.timezone,
      jsonb_build_object(
        'payment_plan_id', p.id,
        'installment_id', i.id,
        'sequence_no', i.sequence_no,
        'due_date', i.due_date,
        'amount_minor', i.amount_minor,
        'paid_minor', i.paid_minor
      )
    from public.payment_plans p
    join public.payment_plan_installments i on i.payment_plan_id = p.id
    join public.cases c on c.id = p.case_id
    where p.status in ('active', 'defaulted')
      and i.paid_minor < i.amount_minor
      and i.due_date = timezone(p.timezone, v_now)::date
      and c.archived_at is null
      and c.status <> 'closed'

    union all

    select
      c.business_id,
      c.id,
      c.debtor_id,
      c.account_id,
      null::uuid,
      'PLAN_INSTALLMENT_MISSED',
      'payment_plan_installment',
      i.id::text,
      i.due_date::text || ':' || p.grace_days::text,
      i.due_date + p.grace_days + 1,
      p.timezone,
      jsonb_build_object(
        'payment_plan_id', p.id,
        'installment_id', i.id,
        'sequence_no', i.sequence_no,
        'due_date', i.due_date,
        'grace_days', p.grace_days,
        'amount_minor', i.amount_minor,
        'paid_minor', i.paid_minor
      )
    from public.payment_plans p
    join public.payment_plan_installments i on i.payment_plan_id = p.id
    join public.cases c on c.id = p.case_id
    where p.status in ('active', 'defaulted')
      and i.paid_minor < i.amount_minor
      and i.due_date + p.grace_days < timezone(p.timezone, v_now)::date
      and c.archived_at is null
      and c.status <> 'closed'

    union all

    select
      o.business_id,
      rco.case_id,
      o.customer_id,
      o.account_id,
      o.id,
      'DISPUTE_REVIEW_DUE',
      'obligation_dispute',
      o.id::text,
      o.dispute_review_at::text,
      timezone(b.timezone, o.dispute_review_at)::date,
      b.timezone,
      jsonb_build_object(
        'obligation_id', o.id,
        'reference', o.reference,
        'review_at', o.dispute_review_at
      )
    from public.obligations o
    join public.businesses b on b.id = o.business_id
    left join public.recovery_case_obligations rco on rco.obligation_id = o.id
    where o.status = 'disputed'
      and o.archived_at is null
      and o.dispute_review_at is not null
      and o.dispute_review_at <= v_now

    union all

    select
      s.business_id,
      s.case_id,
      s.debtor_id,
      c.account_id,
      null::uuid,
      'PAYMENT_PROOF_REVIEW_REQUIRED',
      'payment_proof_submission',
      s.id::text,
      s.created_at::text,
      timezone(b.timezone, s.created_at)::date,
      b.timezone,
      jsonb_build_object(
        'submission_id', s.id,
        'submitted_at', s.created_at,
        'payment_date', s.payment_date,
        'amount', s.amount
      )
    from public.public_payment_submissions s
    join public.cases c on c.id = s.case_id and c.business_id = s.business_id
    join public.businesses b on b.id = s.business_id
    where s.status::text in ('pending_review', 'submitted', 'under_review')
      and c.archived_at is null
  ),
  prepared as (
    select
      candidates.*,
      concat_ws(
        ':',
        business_id::text,
        event_type,
        source_entity_type,
        source_entity_id,
        source_version
      ) as deduplication_key
    from candidates
  ),
  inserted as (
    insert into public.domain_events (
      business_id,
      case_id,
      customer_id,
      account_id,
      obligation_id,
      event_type,
      source_entity_type,
      source_entity_id,
      source_version,
      effective_date,
      event_timezone,
      occurred_at,
      payload,
      deduplication_key
    )
    select
      business_id,
      case_id,
      customer_id,
      account_id,
      obligation_id,
      event_type,
      source_entity_type,
      source_entity_id,
      source_version,
      effective_date,
      event_timezone,
      v_now,
      payload,
      deduplication_key
    from prepared
    on conflict (deduplication_key) do nothing
    returning event_type
  ),
  counts as (
    select event_type, count(*)::integer as inserted_count
    from inserted
    group by event_type
  )
  select
    coalesce(sum(inserted_count), 0)::integer,
    coalesce(jsonb_object_agg(event_type, inserted_count), '{}'::jsonb)
  into v_inserted, v_by_type
  from counts;

  return jsonb_build_object(
    'status', 'completed',
    'executed_at', v_now,
    'inserted', v_inserted,
    'by_type', v_by_type
  );
end;
$$;

revoke all on function public.domain_events_detect(timestamptz) from public;
revoke all on function public.domain_events_detect(timestamptz) from authenticated;
revoke all on function public.domain_events_detect(timestamptz) from anon;
grant execute on function public.domain_events_detect(timestamptz) to service_role;

commit;

-- Verification:
-- 1. Run select public.domain_events_detect(now()); twice as service_role.
--    The second result must report inserted = 0.
-- 2. SET LOCAL ROLE authenticated and test one owner JWT. Selecting domain_events
--    must expose that owner's business only; direct insert/update/delete must fail.
-- 3. Set two businesses to timezones on opposite sides of UTC and run with a
--    fixed p_now around midnight. Each event must use its tenant-local date.
--
-- Rollback considerations:
-- Disable /api/cron/domain-events first. Preserve domain_events where audit
-- retention is required. Drop domain_events_detect, its policies/indexes/table,
-- then the two scheduling indexes/columns and timezone trigger/function/column.
-- Dropping dispute_review_at or due_at discards newly scheduled review dates, so
-- export or migrate them first. No debtor message rows exist to roll back.
