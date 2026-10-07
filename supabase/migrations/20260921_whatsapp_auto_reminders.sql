-- Automatic WhatsApp payment reminders through the WhatsApp Business
-- Platform (Meta Cloud API) from one verified CollectBoss number.
--
-- * whatsapp_reminder_policies: per-business opt-in, schedule and consent
--   attestation. Paid plans only (enforced when queueing).
-- * whatsapp_messages: outbox and delivery log. One automatic reminder per
--   customer per local day; idempotent per obligation and schedule offset.
-- * whatsapp_opt_outs: global STOP list keyed by phone number. Replies such as
--   STOP / BERHENTI to the shared number stop all automatic reminders.
--
-- Review before applying. Safe to re-run.

begin;

create table if not exists public.whatsapp_reminder_policies (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  enabled boolean not null default false,
  day_offsets integer[] not null default '{-3,0,3,7,14}',
  language text not null default 'en' check (language in ('en','ms')),
  consent_attested_at timestamptz,
  consent_attested_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_policy_offsets_check check (
    cardinality(day_offsets) between 1 and 8
    and day_offsets <@ array[-7,-3,-1,0,1,3,7,14,21,30]
  ),
  constraint whatsapp_policy_consent_check check (not enabled or consent_attested_at is not null)
);

create table if not exists public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_id uuid references public.debtors(id) on delete set null,
  obligation_id uuid references public.obligations(id) on delete set null,
  to_phone_e164 text not null check (to_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  template_kind text not null check (template_kind in ('before_due','due_today','overdue')),
  language text not null check (language in ('en','ms')),
  variables jsonb not null default '[]'::jsonb check (jsonb_typeof(variables) = 'array'),
  day_offset integer not null,
  local_send_date date not null,
  status text not null default 'queued'
    check (status in ('queued','sending','sent','delivered','read','failed','skipped')),
  skip_reason text,
  provider_message_id text unique,
  error_code text,
  error_message text,
  attempts integer not null default 0,
  lease_expires_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, obligation_id, day_offset),
  unique (business_id, customer_id, local_send_date)
);

create index if not exists whatsapp_messages_queue_idx
  on public.whatsapp_messages (status, created_at) where status in ('queued','sending');
create index if not exists whatsapp_messages_business_idx
  on public.whatsapp_messages (business_id, created_at desc);

create table if not exists public.whatsapp_opt_outs (
  phone_e164 text primary key check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  source text not null default 'reply' check (source in ('reply','business','support')),
  created_at timestamptz not null default now()
);

alter table public.whatsapp_reminder_policies enable row level security;
alter table public.whatsapp_messages enable row level security;
alter table public.whatsapp_opt_outs enable row level security;

drop policy if exists "whatsapp_reminder_policies: tenant read" on public.whatsapp_reminder_policies;
create policy "whatsapp_reminder_policies: tenant read" on public.whatsapp_reminder_policies
  for select to authenticated using (has_business_permission(business_id, 'case.read'));
drop policy if exists "whatsapp_messages: tenant read" on public.whatsapp_messages;
create policy "whatsapp_messages: tenant read" on public.whatsapp_messages
  for select to authenticated using (has_business_permission(business_id, 'case.read'));

-- Writes go through reviewed API routes and the scheduled worker.
revoke insert, update, delete on public.whatsapp_reminder_policies, public.whatsapp_messages from anon, authenticated;
revoke all on public.whatsapp_opt_outs from anon, authenticated;
grant select on public.whatsapp_reminder_policies, public.whatsapp_messages to authenticated;
grant all on public.whatsapp_reminder_policies, public.whatsapp_messages, public.whatsapp_opt_outs to service_role;

-- Normalise a Malaysian or international phone number to E.164, or null.
create or replace function public.whatsapp_normalize_phone(p_phone text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case
    when v is null or v = '' then null
    when v ~ '^\+[1-9][0-9]{7,14}$' then v
    when v ~ '^60[1-9][0-9]{7,10}$' then '+' || v
    when v ~ '^0[1-9][0-9]{7,10}$' then '+60' || substr(v, 2)
    else null end
  from (select regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g') as v) s;
$$;

create or replace function public.whatsapp_enqueue_due_reminders(p_now timestamptz default null, p_limit integer default 1000)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_today date := (coalesce(p_now, now()) at time zone 'Asia/Kuala_Lumpur')::date;
  v_inserted integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'service role required'; end if;
  with candidates as (
    select
      o.business_id, o.customer_id, o.id as obligation_id,
      whatsapp_normalize_phone(d.phone) as phone,
      p.language, offs.day_offset,
      case when offs.day_offset < 0 then 'before_due' when offs.day_offset = 0 then 'due_today' else 'overdue' end as template_kind,
      jsonb_build_array(
        coalesce(nullif(btrim(d.contact_name), ''), nullif(btrim(d.business_name), ''), nullif(btrim(d.individual_name), ''), 'Customer'),
        coalesce(nullif(btrim(b.business_name), ''), 'your supplier'),
        o.currency || ' ' || to_char(o.outstanding_minor / 100.0, 'FM999,999,999,990.00'),
        to_char(o.due_date, 'DD/MM/YYYY'),
        o.reference
      ) as variables
    from public.whatsapp_reminder_policies p
    join public.businesses b on b.id = p.business_id
    join public.entitlements e on e.business_id = p.business_id and e.plan_slug <> 'free'
    cross join lateral unnest(p.day_offsets) as offs(day_offset)
    join public.obligations o on o.business_id = p.business_id
      and o.archived_at is null
      and o.status in ('open','overdue','partial')
      and o.outstanding_minor > 0
      and o.due_date + offs.day_offset = v_today
    join public.debtors d on d.id = o.customer_id and d.archived_at is null
    where p.enabled and p.consent_attested_at is not null
    limit greatest(1, least(coalesce(p_limit, 1000), 5000))
  ), inserted as (
    insert into public.whatsapp_messages(business_id, customer_id, obligation_id, to_phone_e164, template_kind, language, variables, day_offset, local_send_date)
    select business_id, customer_id, obligation_id, phone, template_kind, language, variables, day_offset, v_today
    from candidates where phone is not null
    on conflict do nothing
    returning 1
  )
  select count(*) into v_inserted from inserted;
  return jsonb_build_object('queued', v_inserted, 'date', v_today);
end $$;

-- Lease queued messages for the sending worker.
create or replace function public.whatsapp_claim_messages(p_limit integer default 50)
returns setof public.whatsapp_messages language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'service role required'; end if;
  return query
  update public.whatsapp_messages m set status = 'sending', attempts = m.attempts + 1,
    lease_expires_at = now() + interval '5 minutes', updated_at = now()
  where m.id in (
    select id from public.whatsapp_messages
    where ((status = 'queued' and (lease_expires_at is null or lease_expires_at < now()))
        or (status = 'sending' and lease_expires_at < now()))
      and attempts < 3
    order by created_at
    limit greatest(1, least(coalesce(p_limit, 50), 200))
    for update skip locked
  )
  returning m.*;
end $$;

revoke all on function public.whatsapp_normalize_phone(text) from public, anon;
grant execute on function public.whatsapp_normalize_phone(text) to authenticated, service_role;
revoke all on function public.whatsapp_enqueue_due_reminders(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.whatsapp_enqueue_due_reminders(timestamptz, integer) to service_role;
revoke all on function public.whatsapp_claim_messages(integer) from public, anon, authenticated;
grant execute on function public.whatsapp_claim_messages(integer) to service_role;

commit;
