-- Persistent actionable notification engine.
-- Apply after 20260811_domain_event_scheduler.sql.
--
-- Existing Y02/Y04/Y05 notification writers remain compatible. Domain-event
-- consumption is separate from detection and never creates Action Centre work.

begin;

alter table public.notifications
  add column if not exists user_id uuid references auth.users(id) on delete set null,
  add column if not exists customer_id uuid references public.debtors(id) on delete set null,
  add column if not exists event_type text,
  add column if not exists severity text not null default 'medium',
  add column if not exists action_url text,
  add column if not exists archived_at timestamptz,
  add column if not exists dedupe_key text,
  add column if not exists domain_event_id uuid references public.domain_events(id) on delete restrict;

update public.notifications
set
  event_type = coalesce(event_type, type),
  severity = case
    when lower(type) like '%missed%' then 'high'
    when lower(type) like '%failed%' then 'high'
    when lower(type) like '%requested%' then 'medium'
    else coalesce(severity, 'medium')
  end,
  action_url = coalesce(
    action_url,
    case
      when type in ('payment_proof_submitted', 'review_payment_proof') then '/payments'
      when case_id is not null then '/cases/' || case_id
      else null
    end
  ),
  dedupe_key = coalesce(dedupe_key, 'legacy:' || id::text)
where event_type is null or dedupe_key is null or action_url is null;

alter table public.notifications
  alter column event_type set not null,
  alter column dedupe_key set not null,
  drop constraint if exists notifications_severity_check,
  add constraint notifications_severity_check check (
    severity in ('critical', 'high', 'medium', 'informational', 'positive')
  ),
  drop constraint if exists notifications_action_url_check,
  add constraint notifications_action_url_check check (
    action_url is null
    or (left(action_url, 1) = '/' and left(action_url, 2) <> '//')
  );

create unique index if not exists notifications_business_dedupe_uidx
  on public.notifications (business_id, dedupe_key);
create unique index if not exists notifications_domain_event_uidx
  on public.notifications (domain_event_id)
  where domain_event_id is not null;
drop index if exists public.notifications_business_unread_idx;
create index notifications_business_unread_idx
  on public.notifications (business_id, created_at desc)
  where read_at is null and archived_at is null;
create index if not exists notifications_business_active_idx
  on public.notifications (business_id, created_at desc)
  where archived_at is null;
create index if not exists notifications_user_unread_idx
  on public.notifications (user_id, created_at desc)
  where user_id is not null and read_at is null and archived_at is null;

create or replace function public.notifications_normalize_and_validate()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if nullif(btrim(coalesce(new.event_type, new.type)), '') is null then
    raise exception 'Notification event type is required';
  end if;
  if new.event_type is not null and new.type is not null and new.event_type <> new.type then
    raise exception 'Notification event type aliases must match';
  end if;
  new.event_type := coalesce(new.event_type, new.type);
  new.type := coalesce(new.type, new.event_type);
  new.dedupe_key := coalesce(
    nullif(btrim(new.dedupe_key), ''),
    concat_ws(
      ':',
      'legacy',
      new.type,
      coalesce(new.entity_type, 'notification'),
      coalesce(new.entity_id::text, new.id::text)
    )
  );

  if new.case_id is not null and not exists (
    select 1 from public.cases c
    where c.id = new.case_id and c.business_id = new.business_id
  ) then
    raise exception 'Notification case is outside the tenant';
  end if;
  if new.customer_id is not null and not exists (
    select 1 from public.debtors d
    where d.id = new.customer_id and d.business_id = new.business_id
  ) then
    raise exception 'Notification customer is outside the tenant';
  end if;
  if new.domain_event_id is not null and not exists (
    select 1 from public.domain_events de
    where de.id = new.domain_event_id and de.business_id = new.business_id
  ) then
    raise exception 'Notification domain event is outside the tenant';
  end if;
  return new;
end;
$$;

drop trigger if exists notifications_normalize_and_validate_trigger
  on public.notifications;
create trigger notifications_normalize_and_validate_trigger
before insert or update on public.notifications
for each row execute function public.notifications_normalize_and_validate();

create or replace function public.notifications_protect_content()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_setting('collectboss.notification_system_write', true) is distinct from 'on'
     and (
       new.business_id is distinct from old.business_id
       or new.user_id is distinct from old.user_id
       or new.case_id is distinct from old.case_id
       or new.customer_id is distinct from old.customer_id
       or new.type is distinct from old.type
       or new.event_type is distinct from old.event_type
       or new.title is distinct from old.title
       or new.message is distinct from old.message
       or new.severity is distinct from old.severity
       or new.action_url is distinct from old.action_url
       or new.entity_type is distinct from old.entity_type
       or new.entity_id is distinct from old.entity_id
       or new.dedupe_key is distinct from old.dedupe_key
       or new.domain_event_id is distinct from old.domain_event_id
       or new.created_at is distinct from old.created_at
     )
  then
    raise exception 'Only notification read/archive state may be changed directly';
  end if;
  return new;
end;
$$;

drop trigger if exists notifications_protect_content_trigger
  on public.notifications;
create trigger notifications_protect_content_trigger
before update on public.notifications
for each row execute function public.notifications_protect_content();

alter table public.domain_events
  drop constraint if exists domain_events_event_type_check,
  add constraint domain_events_event_type_check check (event_type in (
    'FOLLOW_UP_DUE',
    'INVOICE_OVERDUE',
    'PROMISE_DUE',
    'PROMISE_MISSED',
    'PLAN_INSTALLMENT_DUE',
    'PLAN_INSTALLMENT_MISSED',
    'DISPUTE_REVIEW_DUE',
    'PAYMENT_PROOF_REVIEW_REQUIRED',
    'DISPUTE_SUBMITTED',
    'PAYMENT_RECEIVED'
  ));

create or replace function public.notification_payment_received_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_case public.cases;
  v_timezone text;
begin
  if new.event_type <> 'payment_approved' then return new; end if;
  select c, b.timezone
    into v_case, v_timezone
  from public.cases c
  join public.businesses b on b.id = c.business_id
  where c.id = new.case_id;
  if not found then return new; end if;

  insert into public.domain_events (
    business_id, case_id, customer_id, account_id, event_type,
    source_entity_type, source_entity_id, source_version,
    effective_date, event_timezone, occurred_at, payload, deduplication_key
  ) values (
    v_case.business_id, v_case.id, v_case.debtor_id, v_case.account_id,
    'PAYMENT_RECEIVED', 'case_financial_event', new.id::text, new.id::text,
    timezone(v_timezone, new.created_at)::date, v_timezone, new.created_at,
    jsonb_build_object(
      'financial_event_id', new.id,
      'amount_minor', new.amount_minor,
      'source_table', new.source_table,
      'source_id', new.source_id
    ),
    concat_ws(':', v_case.business_id::text, 'PAYMENT_RECEIVED', 'case_financial_event', new.id::text, new.id::text)
  )
  on conflict (deduplication_key) do nothing;
  return new;
end;
$$;

drop trigger if exists case_financial_event_notification_trigger
  on public.case_financial_events;
create trigger case_financial_event_notification_trigger
after insert on public.case_financial_events
for each row execute function public.notification_payment_received_event();

create or replace function public.notification_dispute_submitted_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_case_id text;
  v_timezone text;
begin
  if new.status <> 'disputed'
     or (tg_op = 'UPDATE' and old.status = 'disputed')
  then
    return new;
  end if;
  select rco.case_id into v_case_id
  from public.recovery_case_obligations rco
  where rco.obligation_id = new.id;
  select b.timezone into v_timezone
  from public.businesses b where b.id = new.business_id;

  insert into public.domain_events (
    business_id, case_id, customer_id, account_id, obligation_id, event_type,
    source_entity_type, source_entity_id, source_version,
    effective_date, event_timezone, occurred_at, payload, deduplication_key
  ) values (
    new.business_id, v_case_id, new.customer_id, new.account_id, new.id,
    'DISPUTE_SUBMITTED', 'obligation_dispute', new.id::text, new.updated_at::text,
    timezone(v_timezone, new.updated_at)::date, v_timezone, new.updated_at,
    jsonb_build_object('obligation_id', new.id, 'reference', new.reference),
    concat_ws(':', new.business_id::text, 'DISPUTE_SUBMITTED', 'obligation_dispute', new.id::text, new.updated_at::text)
  )
  on conflict (deduplication_key) do nothing;
  return new;
end;
$$;

drop trigger if exists obligation_dispute_notification_trigger
  on public.obligations;
create trigger obligation_dispute_notification_trigger
after insert or update of status on public.obligations
for each row execute function public.notification_dispute_submitted_event();

create or replace function public.notifications_consume_domain_events(
  p_limit integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inserted integer := 0;
begin
  if p_limit < 1 or p_limit > 1000 then
    raise exception 'Notification batch limit must be between 1 and 1000';
  end if;

  with selected as (
    select de.*
    from public.domain_events de
    where de.event_status = 'pending'
      and not exists (
        select 1 from public.notifications n where n.domain_event_id = de.id
      )
    order by de.effective_date, de.created_at, de.id
    limit p_limit
    for update skip locked
  ),
  inserted as (
    insert into public.notifications (
      business_id,
      case_id,
      customer_id,
      event_type,
      type,
      title,
      message,
      severity,
      action_url,
      entity_type,
      entity_id,
      dedupe_key,
      domain_event_id
    )
    select
      de.business_id,
      de.case_id,
      de.customer_id,
      de.event_type,
      de.event_type,
      case de.event_type
        when 'PROMISE_MISSED' then 'Payment promise missed'
        when 'PLAN_INSTALLMENT_MISSED' then 'Payment-plan installment missed'
        when 'FOLLOW_UP_DUE' then 'Follow-up due'
        when 'INVOICE_OVERDUE' then 'Invoice overdue'
        when 'PROMISE_DUE' then 'Payment promise due'
        when 'PLAN_INSTALLMENT_DUE' then 'Payment-plan installment due'
        when 'DISPUTE_REVIEW_DUE' then 'Dispute review due'
        when 'DISPUTE_SUBMITTED' then 'Dispute submitted'
        when 'PAYMENT_PROOF_REVIEW_REQUIRED' then 'Payment proof needs review'
        when 'PAYMENT_RECEIVED' then 'Payment received'
      end,
      case de.event_type
        when 'PROMISE_MISSED' then 'A promised payment date passed without settlement.'
        when 'PLAN_INSTALLMENT_MISSED' then 'A payment-plan installment remains unpaid after its grace period.'
        when 'FOLLOW_UP_DUE' then 'A scheduled recovery follow-up is now due.'
        when 'INVOICE_OVERDUE' then 'An invoice or obligation has passed its due date.'
        when 'PROMISE_DUE' then 'A promised payment is due today.'
        when 'PLAN_INSTALLMENT_DUE' then 'A payment-plan installment is due today.'
        when 'DISPUTE_REVIEW_DUE' then 'A submitted dispute is ready for review.'
        when 'DISPUTE_SUBMITTED' then 'A receivable has been marked as disputed.'
        when 'PAYMENT_PROOF_REVIEW_REQUIRED' then 'A debtor payment proof is waiting for creditor review.'
        when 'PAYMENT_RECEIVED' then 'An approved payment was recorded successfully.'
      end,
      case de.event_type
        when 'PROMISE_MISSED' then 'high'
        when 'PLAN_INSTALLMENT_MISSED' then 'high'
        when 'DISPUTE_REVIEW_DUE' then 'high'
        when 'DISPUTE_SUBMITTED' then 'high'
        when 'PAYMENT_RECEIVED' then 'positive'
        when 'PROMISE_DUE' then 'medium'
        when 'PLAN_INSTALLMENT_DUE' then 'medium'
        when 'PAYMENT_PROOF_REVIEW_REQUIRED' then 'medium'
        when 'FOLLOW_UP_DUE' then 'medium'
        else 'informational'
      end,
      case
        when de.event_type = 'PAYMENT_PROOF_REVIEW_REQUIRED' then '/payments'
        when de.case_id is not null then '/cases/' || de.case_id
        when de.customer_id is not null then '/debtors'
        else '/'
      end,
      de.source_entity_type,
      case
        when de.source_entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then de.source_entity_id::uuid
        else null
      end,
      'domain-event:' || de.id::text,
      de.id
    from selected de
    on conflict (business_id, dedupe_key) do nothing
    returning id
  )
  select count(*)::integer into v_inserted from inserted;

  return jsonb_build_object('inserted', v_inserted);
end;
$$;

alter table public.notifications enable row level security;
drop policy if exists "notifications_owner_read" on public.notifications;
drop policy if exists "notifications_owner_update" on public.notifications;
create policy "notifications_owner_read"
  on public.notifications for select to authenticated
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = auth.uid()
    )
    and (user_id is null or user_id = auth.uid())
  );
create policy "notifications_owner_update"
  on public.notifications for update to authenticated
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = auth.uid()
    )
    and (user_id is null or user_id = auth.uid())
  )
  with check (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = auth.uid()
    )
    and (user_id is null or user_id = auth.uid())
  );

revoke all on function public.notifications_consume_domain_events(integer) from public;
revoke all on function public.notifications_consume_domain_events(integer) from authenticated;
revoke all on function public.notifications_consume_domain_events(integer) from anon;
grant execute on function public.notifications_consume_domain_events(integer) to service_role;
revoke all on function public.notification_payment_received_event() from public, authenticated, anon;
revoke all on function public.notification_dispute_submitted_event() from public, authenticated, anon;

commit;

-- Rollback considerations:
-- Disable the notification consumer before rollback. Preserve notification and
-- domain-event rows for audit. Restore the earlier notification RLS policies and
-- writers before dropping consumer/trigger functions. New columns are additive;
-- do not drop read/archive/dedupe data without exporting it. Payment/dispute
-- domain events may remain safely even if the notification consumer is removed.
