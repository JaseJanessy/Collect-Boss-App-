begin;

-- R11 professional contact controls. These are configurable operational
-- recommendations, not legal determinations or permanent communication bans.
create table if not exists public.contact_frequency_policies (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  max_attempts_24h integer not null default 2 check (max_attempts_24h between 1 and 100),
  max_attempts_7d integer not null default 5 check (max_attempts_7d between 1 and 500),
  max_attempts_30d integer not null default 12 check (max_attempts_30d between 1 and 2000),
  frequency_mode text not null default 'warn' check (frequency_mode in ('warn','require_override')),
  preference_mode text not null default 'require_override' check (preference_mode in ('warn','require_override')),
  bulk_mode text not null default 'exclude' check (bulk_mode in ('exclude','require_override')),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (max_attempts_24h <= max_attempts_7d and max_attempts_7d <= max_attempts_30d)
);

insert into public.contact_frequency_policies (business_id)
select id from public.businesses
on conflict (business_id) do nothing;

create table if not exists public.contact_preferences (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_id uuid not null references public.debtors(id) on delete cascade,
  preferred_channel text check (preferred_channel is null or preferred_channel in ('whatsapp','call','email','portal','other')),
  preferred_time_start time,
  preferred_time_end time,
  email_only boolean not null default false,
  do_not_call boolean not null default false,
  wrong_number boolean not null default false,
  invalid_contact boolean not null default false,
  note text,
  documented_at timestamptz not null default now(),
  documented_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id,customer_id),
  check (
    (preferred_time_start is null and preferred_time_end is null)
    or (preferred_time_start is not null and preferred_time_end is not null and preferred_time_start <> preferred_time_end)
  ),
  check (not email_only or preferred_channel is null or preferred_channel='email')
);
create index if not exists contact_preferences_customer_idx
  on public.contact_preferences(business_id,customer_id);

create table if not exists public.contact_guard_overrides (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  customer_id uuid references public.debtors(id) on delete set null,
  case_id text not null references public.cases(id) on delete restrict,
  communication_activity_id uuid references public.communication_activities(id) on delete set null,
  action_item_id uuid references public.action_centre_items(id) on delete set null,
  channel text not null check (channel in ('whatsapp','call','email','portal','other')),
  is_bulk boolean not null default false,
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  evaluation jsonb not null check (jsonb_typeof(evaluation)='object'),
  overridden_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index if not exists contact_guard_overrides_case_idx
  on public.contact_guard_overrides(business_id,case_id,created_at desc);
create unique index if not exists contact_guard_overrides_activity_uidx
  on public.contact_guard_overrides(communication_activity_id)
  where communication_activity_id is not null and is_bulk=false;

alter table public.contact_frequency_policies enable row level security;
alter table public.contact_preferences enable row level security;
alter table public.contact_guard_overrides enable row level security;
create policy "contact_frequency_policies_owner_read" on public.contact_frequency_policies
  for select to authenticated using (business_id=public.my_business_id());
create policy "contact_preferences_owner_read" on public.contact_preferences
  for select to authenticated using (business_id=public.my_business_id());
create policy "contact_guard_overrides_owner_read" on public.contact_guard_overrides
  for select to authenticated using (business_id=public.my_business_id());

create or replace function public.contact_preferences_upsert(
  p_customer_id uuid,
  p_preferred_channel text default null,
  p_preferred_time_start time default null,
  p_preferred_time_end time default null,
  p_email_only boolean default false,
  p_do_not_call boolean default false,
  p_wrong_number boolean default false,
  p_invalid_contact boolean default false,
  p_note text default null
) returns public.contact_preferences
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_business_id uuid; v_row public.contact_preferences;
begin
  select d.business_id into v_business_id from public.debtors d
  join public.businesses b on b.id=d.business_id
  where d.id=p_customer_id and b.owner_id=auth.uid();
  if not found then raise exception 'Customer not found'; end if;
  if p_email_only and p_preferred_channel is not null and p_preferred_channel<>'email' then
    raise exception 'Email-only preference requires email as the preferred channel';
  end if;
  insert into public.contact_preferences (
    business_id,customer_id,preferred_channel,preferred_time_start,preferred_time_end,
    email_only,do_not_call,wrong_number,invalid_contact,note,documented_at,documented_by
  ) values (
    v_business_id,p_customer_id,p_preferred_channel,p_preferred_time_start,p_preferred_time_end,
    p_email_only,p_do_not_call,p_wrong_number,p_invalid_contact,
    nullif(btrim(p_note),''),now(),auth.uid()
  )
  on conflict (business_id,customer_id) do update set
    preferred_channel=excluded.preferred_channel,
    preferred_time_start=excluded.preferred_time_start,
    preferred_time_end=excluded.preferred_time_end,
    email_only=excluded.email_only,do_not_call=excluded.do_not_call,
    wrong_number=excluded.wrong_number,invalid_contact=excluded.invalid_contact,
    note=excluded.note,documented_at=now(),documented_by=auth.uid(),updated_at=now()
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.contact_frequency_policy_upsert(
  p_max_attempts_24h integer,
  p_max_attempts_7d integer,
  p_max_attempts_30d integer,
  p_frequency_mode text,
  p_preference_mode text,
  p_bulk_mode text
) returns public.contact_frequency_policies
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_business_id uuid; v_row public.contact_frequency_policies;
begin
  select b.id into v_business_id from public.businesses b where b.owner_id=auth.uid();
  if not found then raise exception 'Business not found'; end if;
  insert into public.contact_frequency_policies (
    business_id,max_attempts_24h,max_attempts_7d,max_attempts_30d,
    frequency_mode,preference_mode,bulk_mode,updated_by
  ) values (
    v_business_id,p_max_attempts_24h,p_max_attempts_7d,p_max_attempts_30d,
    p_frequency_mode,p_preference_mode,p_bulk_mode,auth.uid()
  )
  on conflict (business_id) do update set
    max_attempts_24h=excluded.max_attempts_24h,max_attempts_7d=excluded.max_attempts_7d,
    max_attempts_30d=excluded.max_attempts_30d,frequency_mode=excluded.frequency_mode,
    preference_mode=excluded.preference_mode,bulk_mode=excluded.bulk_mode,
    updated_by=auth.uid(),updated_at=now()
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.contact_guard_context(p_case_ids text[])
returns jsonb language plpgsql security definer stable set search_path=public,pg_temp as $$
declare v_result jsonb; v_owned_count integer;
begin
  if coalesce(array_length(p_case_ids,1),0)<1 or array_length(p_case_ids,1)>250 then
    raise exception 'Contact guard supports 1 to 250 cases';
  end if;
  select count(*) into v_owned_count
  from public.cases c join public.businesses b on b.id=c.business_id
  where c.id=any(p_case_ids) and b.owner_id=auth.uid();
  if v_owned_count <> cardinality(p_case_ids) then raise exception 'One or more cases were not found'; end if;

  select coalesce(jsonb_object_agg(rows.case_id,rows.payload),'{}'::jsonb) into v_result
  from (
    select c.id as case_id,jsonb_build_object(
      'case_id',c.id,'customer_id',c.debtor_id,'timezone',b.timezone,
      'counts',jsonb_build_object('attempts_24h',counts.attempts_24h,'attempts_7d',counts.attempts_7d,'attempts_30d',counts.attempts_30d),
      'policy',jsonb_build_object(
        'max_attempts_24h',coalesce(fp.max_attempts_24h,2),
        'max_attempts_7d',coalesce(fp.max_attempts_7d,5),
        'max_attempts_30d',coalesce(fp.max_attempts_30d,12),
        'frequency_mode',coalesce(fp.frequency_mode,'warn'),
        'preference_mode',coalesce(fp.preference_mode,'require_override'),
        'bulk_mode',coalesce(fp.bulk_mode,'exclude')
      ),
      'preferences',case when cp.id is null then null else jsonb_build_object(
        'id',cp.id,'business_id',cp.business_id,'customer_id',cp.customer_id,
        'preferred_channel',cp.preferred_channel,
        'preferred_time_start',cp.preferred_time_start,
        'preferred_time_end',cp.preferred_time_end,
        'email_only',cp.email_only,'do_not_call',cp.do_not_call,
        'wrong_number',cp.wrong_number,'invalid_contact',cp.invalid_contact,
        'note',cp.note,'documented_at',cp.documented_at,'documented_by',cp.documented_by,
        'created_at',cp.created_at,'updated_at',cp.updated_at
      ) end
    ) as payload
    from public.cases c
    join public.businesses b on b.id=c.business_id and b.owner_id=auth.uid()
    left join public.contact_frequency_policies fp on fp.business_id=c.business_id
    left join public.contact_preferences cp on cp.business_id=c.business_id and cp.customer_id=c.debtor_id
    cross join lateral (
      select
        count(*) filter (where ca.started_at>=now()-interval '24 hours')::integer attempts_24h,
        count(*) filter (where ca.started_at>=now()-interval '7 days')::integer attempts_7d,
        count(*) filter (where ca.started_at>=now()-interval '30 days')::integer attempts_30d
      from public.communication_activities ca
      where ca.business_id=c.business_id and ca.direction='outbound'
        and ((c.debtor_id is not null and ca.customer_id=c.debtor_id) or (c.debtor_id is null and ca.case_id=c.id))
    ) counts
    where c.id=any(p_case_ids)
  ) rows;
  return v_result;
end;
$$;

create or replace function public.contact_guard_record_override(
  p_case_id text,
  p_communication_activity_id uuid,
  p_action_item_id uuid,
  p_channel text,
  p_is_bulk boolean,
  p_reason text,
  p_evaluation jsonb
) returns public.contact_guard_overrides
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_case public.cases; v_row public.contact_guard_overrides;
begin
  select c.* into v_case from public.cases c join public.businesses b on b.id=c.business_id
  where c.id=p_case_id and b.owner_id=auth.uid();
  if not found then raise exception 'Case not found'; end if;
  if p_communication_activity_id is not null and not exists (
    select 1 from public.communication_activities ca
    where ca.id=p_communication_activity_id and ca.business_id=v_case.business_id and ca.case_id=v_case.id
  ) then raise exception 'Communication activity does not belong to case'; end if;
  if p_action_item_id is not null and not exists (
    select 1 from public.action_centre_items a
    where a.id=p_action_item_id and a.business_id=v_case.business_id and a.case_id=v_case.id
  ) then raise exception 'Action item does not belong to case'; end if;
  if p_communication_activity_id is not null then
    select o.* into v_row from public.contact_guard_overrides o
    where o.communication_activity_id=p_communication_activity_id and o.is_bulk=false;
    if found then return v_row; end if;
  end if;
  insert into public.contact_guard_overrides (
    business_id,customer_id,case_id,communication_activity_id,action_item_id,
    channel,is_bulk,reason,evaluation,overridden_by
  ) values (
    v_case.business_id,v_case.debtor_id,v_case.id,p_communication_activity_id,p_action_item_id,
    p_channel,p_is_bulk,btrim(p_reason),p_evaluation,auth.uid()
  ) returning * into v_row;
  insert into public.audit_logs (business_id,case_id,action,actor_type,actor_id,metadata)
  values (v_case.business_id,v_case.id,'contact_guard.overridden','owner',auth.uid(),
    jsonb_build_object('override_id',v_row.id,'channel',p_channel,'is_bulk',p_is_bulk,'reason',btrim(p_reason)));
  return v_row;
end;
$$;

revoke all on function public.contact_preferences_upsert(uuid,text,time,time,boolean,boolean,boolean,boolean,text) from public;
grant execute on function public.contact_preferences_upsert(uuid,text,time,time,boolean,boolean,boolean,boolean,text) to authenticated;
revoke all on function public.contact_frequency_policy_upsert(integer,integer,integer,text,text,text) from public;
grant execute on function public.contact_frequency_policy_upsert(integer,integer,integer,text,text,text) to authenticated;
revoke all on function public.contact_guard_context(text[]) from public;
grant execute on function public.contact_guard_context(text[]) to authenticated;
revoke all on function public.contact_guard_record_override(text,uuid,uuid,text,boolean,text,jsonb) from public;
grant execute on function public.contact_guard_record_override(text,uuid,uuid,text,boolean,text,jsonb) to authenticated;

commit;

-- Rollback: stop all outbound contact producers before changing these controls,
-- or keep the stricter guard active while the prior application is restored.
-- Preserve contact preferences, policies and override audit rows. Revoke the
-- mutation RPCs first; never remove frequency protections while any sender can
-- still deliver messages.
