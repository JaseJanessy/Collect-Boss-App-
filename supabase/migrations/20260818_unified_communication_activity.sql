begin;

-- R10 unified communication activity. V1 records device handoffs and manual
-- outcomes; no personal WhatsApp messages are read or imported automatically.
create table if not exists public.communication_activities (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  customer_id uuid references public.debtors(id) on delete restrict,
  case_id text not null references public.cases(id) on delete restrict,
  channel text not null check (channel in ('whatsapp','call','email','portal','other')),
  direction text not null check (direction in ('outbound','inbound')),
  status text not null default 'initiated'
    check (status in ('initiated','sent','delivered','read','replied','failed','completed')),
  outcome text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  staff_user_id uuid references auth.users(id) on delete set null,
  external_reference text,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  related_promise_id uuid references public.payment_promises(id) on delete set null,
  related_dispute_id uuid references public.disputes(id) on delete set null,
  related_action_id uuid references public.action_centre_items(id) on delete set null,
  idempotency_key uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id,idempotency_key),
  check (completed_at is null or completed_at >= started_at),
  check (
    channel <> 'whatsapp'
    or status in ('initiated','sent','delivered','read','replied','failed')
  ),
  check (
    channel <> 'call'
    or status in ('initiated','failed','completed')
  ),
  check (
    outcome is null
    or channel <> 'call'
    or outcome in (
      'no_answer','spoke_to_customer','promise_to_pay','call_back_later',
      'payment_difficulty','other'
    )
  ),
  check (channel <> 'call' or status <> 'completed' or outcome is not null)
);

create index if not exists communication_activities_case_timeline_idx
  on public.communication_activities(business_id,case_id,started_at desc,id);
create index if not exists communication_activities_customer_counters_idx
  on public.communication_activities(business_id,customer_id,channel,started_at desc)
  where customer_id is not null;
create unique index if not exists communication_activities_external_ref_uidx
  on public.communication_activities(business_id,channel,external_reference)
  where external_reference is not null;

create or replace function public.communication_activity_validate_scope()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare
  v_case public.cases;
begin
  select c.* into v_case from public.cases c where c.id=new.case_id;
  if not found or v_case.business_id <> new.business_id then
    raise exception 'Communication case does not belong to tenant';
  end if;
  if new.customer_id is distinct from v_case.debtor_id then
    raise exception 'Communication customer does not match case customer';
  end if;
  if new.related_promise_id is not null and not exists (
    select 1 from public.payment_promises p
    where p.id=new.related_promise_id and p.business_id=new.business_id and p.case_id=new.case_id
  ) then raise exception 'Related promise does not belong to communication case';
  end if;
  if new.related_dispute_id is not null and not exists (
    select 1 from public.disputes d
    where d.id=new.related_dispute_id and d.business_id=new.business_id and d.case_id=new.case_id
  ) then raise exception 'Related dispute does not belong to communication case';
  end if;
  if new.related_action_id is not null and not exists (
    select 1 from public.action_centre_items a
    where a.id=new.related_action_id and a.business_id=new.business_id and a.case_id=new.case_id
  ) then raise exception 'Related action does not belong to communication case';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists communication_activity_scope_guard on public.communication_activities;
create trigger communication_activity_scope_guard
  before insert or update on public.communication_activities
  for each row execute function public.communication_activity_validate_scope();

-- Preserve prior communication history. Drafts that were never handed off are
-- intentionally excluded because they are not contact attempts.
insert into public.communication_activities (
  business_id,customer_id,case_id,channel,direction,status,started_at,
  completed_at,staff_user_id,metadata,idempotency_key
)
select
  c.business_id,c.debtor_id,r.case_id,
  case when r.sent_channel in ('whatsapp','email') then r.sent_channel else 'other' end,
  'outbound',
  case when r.status='failed' then 'failed'
       when r.status in ('sent','sent_manually') or r.manually_confirmed_at is not null then 'sent'
       else 'initiated' end,
  coalesce(r.composer_opened_at,r.manually_confirmed_at,r.sent_at,r.generated_at),
  case when r.status='failed' then coalesce(r.sent_at,r.generated_at) else null end,
  null,
  jsonb_build_object('source','reminder','reminder_id',r.id,'message_type',r.message_type),
  r.request_key
from public.reminders r
join public.cases c on c.id=r.case_id
where (
    r.composer_opened_at is not null
    or r.manually_confirmed_at is not null
    or r.status in ('sent','sent_manually','failed')
  )
on conflict (business_id,idempotency_key) do nothing;

alter table public.communication_activities enable row level security;
create policy "communication_activities_owner_read" on public.communication_activities
  for select to authenticated using (
    exists (
      select 1 from public.businesses b
      where b.id=communication_activities.business_id and b.owner_id=auth.uid()
    )
  );

create or replace function public.communication_activity_create(
  p_case_id text,
  p_channel text,
  p_direction text,
  p_status text default 'initiated',
  p_started_at timestamptz default null,
  p_external_reference text default null,
  p_duration_seconds integer default null,
  p_metadata jsonb default '{}'::jsonb,
  p_related_promise_id uuid default null,
  p_related_dispute_id uuid default null,
  p_related_action_id uuid default null,
  p_idempotency_key uuid default gen_random_uuid()
) returns public.communication_activities
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_case public.cases;
  v_activity public.communication_activities;
begin
  select c.* into v_case
  from public.cases c join public.businesses b on b.id=c.business_id
  where c.id=p_case_id and b.owner_id=auth.uid();
  if not found then raise exception 'Case not found'; end if;

  select ca.* into v_activity from public.communication_activities ca
  where ca.business_id=v_case.business_id and ca.idempotency_key=p_idempotency_key;
  if found then return v_activity; end if;

  insert into public.communication_activities (
    business_id,customer_id,case_id,channel,direction,status,started_at,
    staff_user_id,external_reference,duration_seconds,metadata,
    related_promise_id,related_dispute_id,related_action_id,idempotency_key
  ) values (
    v_case.business_id,v_case.debtor_id,v_case.id,p_channel,p_direction,p_status,
    coalesce(p_started_at,now()),auth.uid(),nullif(btrim(p_external_reference),''),
    p_duration_seconds,coalesce(p_metadata,'{}'::jsonb),p_related_promise_id,
    p_related_dispute_id,p_related_action_id,p_idempotency_key
  ) returning * into v_activity;

  insert into public.audit_logs (business_id,case_id,action,actor_type,actor_id,metadata)
  values (
    v_case.business_id,v_case.id,'communication.initiated','owner',auth.uid(),
    jsonb_build_object('activity_id',v_activity.id,'channel',v_activity.channel,'direction',v_activity.direction)
  );
  return v_activity;
exception when unique_violation then
  select ca.* into v_activity from public.communication_activities ca
  where ca.business_id=v_case.business_id and ca.idempotency_key=p_idempotency_key;
  if found then return v_activity; end if;
  raise;
end;
$$;

create or replace function public.communication_activity_update(
  p_activity_id uuid,
  p_status text,
  p_outcome text default null,
  p_completed_at timestamptz default null,
  p_external_reference text default null,
  p_duration_seconds integer default null,
  p_metadata jsonb default '{}'::jsonb,
  p_related_promise_id uuid default null,
  p_related_dispute_id uuid default null,
  p_related_action_id uuid default null
) returns public.communication_activities
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_activity public.communication_activities;
begin
  select ca.* into v_activity
  from public.communication_activities ca
  join public.businesses b on b.id=ca.business_id
  where ca.id=p_activity_id and b.owner_id=auth.uid()
  for update of ca;
  if not found then raise exception 'Communication activity not found'; end if;

  if v_activity.status <> p_status and not (
    (v_activity.status='initiated' and p_status in ('sent','delivered','read','replied','failed','completed'))
    or (v_activity.status='sent' and p_status in ('delivered','read','replied','failed','completed'))
    or (v_activity.status='delivered' and p_status in ('read','replied','failed','completed'))
    or (v_activity.status='read' and p_status in ('replied','failed','completed'))
  ) then raise exception 'Invalid communication status transition'; end if;

  update public.communication_activities set
    status=p_status,
    outcome=coalesce(nullif(btrim(p_outcome),''),outcome),
    completed_at=case
      when p_status in ('replied','failed','completed') then coalesce(p_completed_at,completed_at,now())
      else completed_at
    end,
    external_reference=coalesce(nullif(btrim(p_external_reference),''),external_reference),
    duration_seconds=coalesce(p_duration_seconds,duration_seconds),
    metadata=metadata || coalesce(p_metadata,'{}'::jsonb),
    related_promise_id=coalesce(p_related_promise_id,related_promise_id),
    related_dispute_id=coalesce(p_related_dispute_id,related_dispute_id),
    related_action_id=coalesce(p_related_action_id,related_action_id)
  where id=p_activity_id
  returning * into v_activity;

  insert into public.audit_logs (business_id,case_id,action,actor_type,actor_id,metadata)
  values (
    v_activity.business_id,v_activity.case_id,'communication.updated','owner',auth.uid(),
    jsonb_build_object('activity_id',v_activity.id,'status',v_activity.status,'outcome',v_activity.outcome)
  );
  return v_activity;
end;
$$;

create or replace function public.communication_activity_counters(p_case_id text)
returns jsonb language plpgsql security definer stable set search_path=public,pg_temp as $$
declare
  v_case public.cases;
  v_case_counters jsonb;
  v_customer_counters jsonb;
begin
  select c.* into v_case
  from public.cases c join public.businesses b on b.id=c.business_id
  where c.id=p_case_id and b.owner_id=auth.uid();
  if not found then raise exception 'Case not found'; end if;

  select jsonb_build_object(
    'calls',count(*) filter (where channel='call'),
    'whatsapps',count(*) filter (where channel='whatsapp'),
    'emails',count(*) filter (where channel='email'),
    'last_contact_at',max(started_at) filter (where direction='outbound' and status<>'failed'),
    'last_response_at',max(coalesce(completed_at,started_at)) filter (where direction='inbound' or status='replied')
  ) into v_case_counters
  from public.communication_activities
  where business_id=v_case.business_id and case_id=v_case.id;

  if v_case.debtor_id is null then
    v_customer_counters:=v_case_counters;
  else
    select jsonb_build_object(
      'calls',count(*) filter (where channel='call'),
      'whatsapps',count(*) filter (where channel='whatsapp'),
      'emails',count(*) filter (where channel='email'),
      'last_contact_at',max(started_at) filter (where direction='outbound' and status<>'failed'),
      'last_response_at',max(coalesce(completed_at,started_at)) filter (where direction='inbound' or status='replied')
    ) into v_customer_counters
    from public.communication_activities
    where business_id=v_case.business_id and customer_id=v_case.debtor_id;
  end if;
  return jsonb_build_object('case',v_case_counters,'customer',v_customer_counters);
end;
$$;

revoke all on function public.communication_activity_create(
  text,text,text,text,timestamptz,text,integer,jsonb,uuid,uuid,uuid,uuid
) from public;
grant execute on function public.communication_activity_create(
  text,text,text,text,timestamptz,text,integer,jsonb,uuid,uuid,uuid,uuid
) to authenticated;
revoke all on function public.communication_activity_update(
  uuid,text,text,timestamptz,text,integer,jsonb,uuid,uuid,uuid
) from public;
grant execute on function public.communication_activity_update(
  uuid,text,text,timestamptz,text,integer,jsonb,uuid,uuid,uuid
) to authenticated;
revoke all on function public.communication_activity_counters(text) from public;
grant execute on function public.communication_activity_counters(text) to authenticated;

commit;

-- Rollback: stop communication writes/device handoffs and deploy the prior
-- activity UI first. Revoke the create/update RPCs while retaining activity
-- rows as audit history; counters may remain unused. Remove schema objects only
-- after exported history and retention obligations are verified.
