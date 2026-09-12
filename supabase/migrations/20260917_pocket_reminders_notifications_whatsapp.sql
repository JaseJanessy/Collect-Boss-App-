-- Prompt 7: deterministic Pocket owner reminders and user-confirmed WhatsApp handoff.
-- Review after 20260916. This migration is additive and does not send customer messages.

begin;

alter table public.notifications
  add column if not exists push_enabled boolean not null default true;

create table if not exists public.pocket_reminder_preferences (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  obligation_id uuid not null,
  customer_id uuid not null,
  enabled boolean not null default true,
  due_soon_enabled boolean not null default true,
  due_today_enabled boolean not null default true,
  overdue_enabled boolean not null default true,
  still_overdue_enabled boolean not null default true,
  partial_balance_enabled boolean not null default false,
  push_enabled boolean not null default true,
  snoozed_until timestamptz,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (obligation_id,business_id) references public.obligations(id,business_id) on delete restrict,
  foreign key (customer_id,business_id) references public.debtors(id,business_id) on delete restrict,
  unique (business_id,obligation_id)
);

create table if not exists public.pocket_reminder_schedules (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  obligation_id uuid not null,
  customer_id uuid not null,
  event_type text not null check (event_type in (
    'due_soon','due_today','overdue','still_overdue','partial_balance'
  )),
  notification_group text not null check (notification_group in ('today','overdue','payments','system')),
  scheduled_local_date date not null,
  event_timezone text not null,
  source_key text not null check (char_length(source_key) between 10 and 300),
  source_fingerprint char(64) not null check (source_fingerprint ~ '^[0-9a-f]{64}$'),
  remaining_minor bigint not null check (remaining_minor > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'pending' check (status in ('pending','snoozed','notified','cancelled')),
  snoozed_until timestamptz,
  notification_id uuid references public.notifications(id) on delete restrict,
  cancellation_reason text,
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (obligation_id,business_id) references public.obligations(id,business_id) on delete restrict,
  foreign key (customer_id,business_id) references public.debtors(id,business_id) on delete restrict,
  unique (business_id,source_key),
  check ((status='snoozed')=(snoozed_until is not null)),
  check ((status='notified')=(notification_id is not null)),
  check (status<>'cancelled' or cancellation_reason is not null)
);

create table if not exists public.pocket_reminder_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  obligation_id uuid not null,
  customer_id uuid not null,
  schedule_id uuid references public.pocket_reminder_schedules(id) on delete restrict,
  event_type text not null check (event_type in ('prepared','opened_to_whatsapp')),
  template_key text not null check (template_key in ('gentle','due_today','overdue','partial_balance')),
  language text not null check (language in ('en','ms','zh')),
  message_sha256 char(64) not null check (message_sha256 ~ '^[0-9a-f]{64}$'),
  remaining_minor bigint not null check (remaining_minor > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  due_date date,
  user_edited boolean not null default false,
  created_by uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now(),
  foreign key (obligation_id,business_id) references public.obligations(id,business_id) on delete restrict,
  foreign key (customer_id,business_id) references public.debtors(id,business_id) on delete restrict,
  unique (business_id,idempotency_key)
);

create index if not exists pocket_reminder_schedules_due_idx
  on public.pocket_reminder_schedules(business_id,scheduled_local_date,status,created_at);
create index if not exists pocket_reminder_schedules_debt_idx
  on public.pocket_reminder_schedules(business_id,obligation_id,created_at desc);
create index if not exists pocket_reminder_events_customer_idx
  on public.pocket_reminder_events(business_id,customer_id,created_at desc);
create index if not exists pocket_reminder_events_debt_idx
  on public.pocket_reminder_events(business_id,obligation_id,created_at desc);

create or replace function public.pocket_reminder_validate_scope()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare v_debt public.obligations;
begin
  select * into v_debt from public.obligations
  where id=new.obligation_id and business_id=new.business_id;
  if not found or v_debt.origin_product_type<>'pocket' then
    raise exception 'Pocket reminder debt was not found';
  end if;
  if v_debt.customer_id<>new.customer_id then
    raise exception 'Pocket reminder customer does not match debt';
  end if;
  if tg_table_name='pocket_reminder_events' and new.schedule_id is not null and not exists(
    select 1 from public.pocket_reminder_schedules s
    where s.id=new.schedule_id and s.business_id=new.business_id
      and s.obligation_id=new.obligation_id and s.customer_id=new.customer_id
  ) then
    raise exception 'Pocket reminder schedule does not match debt';
  end if;
  if tg_table_name in ('pocket_reminder_preferences','pocket_reminder_schedules') then
    new.updated_at:=now();
  end if;
  return new;
end $$;

drop trigger if exists pocket_reminder_preferences_scope on public.pocket_reminder_preferences;
create trigger pocket_reminder_preferences_scope before insert or update on public.pocket_reminder_preferences
for each row execute function public.pocket_reminder_validate_scope();
drop trigger if exists pocket_reminder_schedules_scope on public.pocket_reminder_schedules;
create trigger pocket_reminder_schedules_scope before insert or update on public.pocket_reminder_schedules
for each row execute function public.pocket_reminder_validate_scope();
drop trigger if exists pocket_reminder_events_scope on public.pocket_reminder_events;
create trigger pocket_reminder_events_scope before insert or update on public.pocket_reminder_events
for each row execute function public.pocket_reminder_validate_scope();

create or replace function public.pocket_cancel_stale_reminder_schedules()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.origin_product_type='pocket' and (
    new.customer_id is distinct from old.customer_id
    or new.pocket_due_date is distinct from old.pocket_due_date
    or new.original_amount_minor is distinct from old.original_amount_minor
    or new.adjustments_minor is distinct from old.adjustments_minor
    or new.paid_minor is distinct from old.paid_minor
    or new.status is distinct from old.status
    or new.archived_at is distinct from old.archived_at
  ) then
    update public.pocket_reminder_schedules set
      status='cancelled',snoozed_until=null,cancellation_reason='debt_changed',updated_at=now()
    where business_id=new.business_id and obligation_id=new.id and status in ('pending','snoozed');
  end if;
  return new;
end $$;
drop trigger if exists pocket_cancel_stale_reminders_on_debt on public.obligations;
create trigger pocket_cancel_stale_reminders_on_debt
after update of customer_id,pocket_due_date,original_amount_minor,adjustments_minor,paid_minor,status,archived_at
on public.obligations for each row execute function public.pocket_cancel_stale_reminder_schedules();

create or replace function public.pocket_cancel_reminders_on_contact_change()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.phone is distinct from old.phone
    or new.archived_at is distinct from old.archived_at
    or new.merged_into_id is distinct from old.merged_into_id then
    update public.pocket_reminder_schedules set
      status='cancelled',snoozed_until=null,cancellation_reason='customer_contact_changed',updated_at=now()
    where business_id=new.business_id and customer_id=new.id and status in ('pending','snoozed');
  end if;
  return new;
end $$;
drop trigger if exists pocket_cancel_reminders_on_contact_change on public.debtors;
create trigger pocket_cancel_reminders_on_contact_change
after update of phone,archived_at,merged_into_id on public.debtors
for each row execute function public.pocket_cancel_reminders_on_contact_change();

create or replace function public.notifications_protect_content()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if current_setting('collectboss.notification_system_write',true) is distinct from 'on' and (
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
    or new.push_enabled is distinct from old.push_enabled
    or new.created_at is distinct from old.created_at
  ) then raise exception 'Only notification read/archive state may be changed directly'; end if;
  return new;
end $$;

alter table public.pocket_reminder_preferences enable row level security;
alter table public.pocket_reminder_schedules enable row level security;
alter table public.pocket_reminder_events enable row level security;

drop policy if exists pocket_reminder_preferences_tenant_read on public.pocket_reminder_preferences;
create policy pocket_reminder_preferences_tenant_read on public.pocket_reminder_preferences
for select to authenticated using (business_id=public.my_business_id());
drop policy if exists pocket_reminder_schedules_tenant_read on public.pocket_reminder_schedules;
create policy pocket_reminder_schedules_tenant_read on public.pocket_reminder_schedules
for select to authenticated using (business_id=public.my_business_id());
drop policy if exists pocket_reminder_events_tenant_read on public.pocket_reminder_events;
create policy pocket_reminder_events_tenant_read on public.pocket_reminder_events
for select to authenticated using (business_id=public.my_business_id());

revoke all on public.pocket_reminder_preferences,public.pocket_reminder_schedules,public.pocket_reminder_events from public,anon,authenticated;
grant select on public.pocket_reminder_preferences,public.pocket_reminder_schedules,public.pocket_reminder_events to authenticated;
grant all on public.pocket_reminder_preferences,public.pocket_reminder_schedules,public.pocket_reminder_events to service_role;
revoke all on function public.pocket_reminder_validate_scope() from public,anon,authenticated;
revoke all on function public.pocket_cancel_stale_reminder_schedules() from public,anon,authenticated;
revoke all on function public.pocket_cancel_reminders_on_contact_change() from public,anon,authenticated;

commit;

-- Rollback: first disable the Pocket reminder cron and composer APIs. Export and
-- retain schedule/event rows if their audit history is required. Then drop the
-- Pocket triggers/functions/tables and notifications.push_enabled. Existing Main
-- notification rows, communication activity, balances, and customer data remain.
