-- R08 Hardship + Negotiation + Payment Plan Resolution.
-- Apply after 20260815_dispute_system.sql.
--
-- This is an additive negotiation layer. Accepted instalment proposals are
-- projected into the existing payment_plan_create_proposal service and the
-- existing payment-plan scheduler remains authoritative.

begin;

create table if not exists public.payment_negotiations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  case_id text not null references public.cases(id) on delete restrict,
  customer_id uuid not null references public.debtors(id) on delete restrict,
  public_access_token_id uuid references public.public_access_tokens(id) on delete set null,
  option_type text not null check (option_type in (
    'promise_to_pay','installment_plan','payment_difficulty'
  )),
  status text not null default 'proposed' check (status in (
    'proposed','countered','accepted','declined','withdrawn','expired'
  )),
  current_revision_no integer not null default 1 check (current_revision_no > 0),
  accepted_revision_no integer,
  payment_plan_id uuid references public.payment_plans(id) on delete restrict,
  payment_promise_id uuid references public.payment_promises(id) on delete restrict,
  idempotency_key uuid not null,
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  declined_at timestamptz,
  withdrawn_at timestamptz,
  expired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (public_access_token_id, idempotency_key),
  check (
    (status='accepted' and accepted_revision_no is not null and accepted_at is not null)
    or (status<>'accepted' and accepted_revision_no is null and accepted_at is null)
  )
);

create unique index if not exists payment_negotiations_one_open_case_idx
  on public.payment_negotiations(case_id)
  where status in ('proposed','countered');
create index if not exists payment_negotiations_tenant_status_idx
  on public.payment_negotiations(business_id,status,expires_at);

create table if not exists public.payment_negotiation_revisions (
  id uuid primary key default gen_random_uuid(),
  negotiation_id uuid not null references public.payment_negotiations(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  case_id text not null references public.cases(id) on delete restrict,
  revision_no integer not null check (revision_no > 0),
  proposed_by text not null check (proposed_by in ('debtor','creditor')),
  amount_now_minor bigint not null default 0 check (amount_now_minor >= 0),
  installment_amount_minor bigint not null check (installment_amount_minor > 0),
  frequency text not null check (frequency in ('weekly','monthly')),
  start_date date not null,
  reason text,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (negotiation_id,revision_no),
  check (char_length(coalesce(reason,'')) <= 500),
  check (char_length(coalesce(note,'')) <= 1000)
);
create index if not exists payment_negotiation_revisions_timeline_idx
  on public.payment_negotiation_revisions(negotiation_id,revision_no);

create table if not exists public.payment_negotiation_events (
  id uuid primary key default gen_random_uuid(),
  negotiation_id uuid not null references public.payment_negotiations(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  case_id text not null references public.cases(id) on delete restrict,
  event_type text not null check (event_type in (
    'proposed','countered','accepted','declined','withdrawn','expired'
  )),
  actor_type text not null check (actor_type in ('debtor','owner','system')),
  actor_id uuid references auth.users(id) on delete set null,
  revision_no integer,
  note text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now()
);
create unique index if not exists payment_negotiation_events_once_idx
  on public.payment_negotiation_events(negotiation_id,event_type,revision_no)
  where revision_no is not null;
create index if not exists payment_negotiation_events_case_timeline_idx
  on public.payment_negotiation_events(case_id,created_at,id);

alter table public.payment_negotiations enable row level security;
alter table public.payment_negotiation_revisions enable row level security;
alter table public.payment_negotiation_events enable row level security;

create policy "payment_negotiations_owner_read" on public.payment_negotiations
for select to authenticated using (business_id=public.my_business_id());
create policy "payment_negotiation_revisions_owner_read" on public.payment_negotiation_revisions
for select to authenticated using (business_id=public.my_business_id());
create policy "payment_negotiation_events_owner_read" on public.payment_negotiation_events
for select to authenticated using (business_id=public.my_business_id());

create or replace function public.payment_negotiation_revision_immutable()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  raise exception 'Negotiation proposal history is immutable';
end;
$$;
create trigger payment_negotiation_revisions_immutable_trigger
before update or delete on public.payment_negotiation_revisions
for each row execute function public.payment_negotiation_revision_immutable();

create or replace function public.payment_negotiation_notify(
  p_negotiation public.payment_negotiations,
  p_event_type text,
  p_title text,
  p_message text,
  p_severity text default 'medium'
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_owner uuid;
begin
  select b.owner_id into v_owner from public.businesses b where b.id=p_negotiation.business_id;
  perform set_config('collectboss.notification_system_write','on',true);
  insert into public.notifications(
    business_id,user_id,case_id,customer_id,type,event_type,title,message,severity,
    action_url,entity_type,entity_id,dedupe_key
  ) values (
    p_negotiation.business_id,v_owner,p_negotiation.case_id,p_negotiation.customer_id,
    'negotiation.'||p_event_type,'negotiation.'||p_event_type,p_title,p_message,p_severity,
    '/cases/'||p_negotiation.case_id,'payment_negotiation',p_negotiation.id,
    'payment-negotiation:'||p_negotiation.id::text||':'||p_event_type||':'||p_negotiation.current_revision_no::text
  ) on conflict (business_id,dedupe_key) do nothing;
end;
$$;

create or replace function public.payment_negotiation_submit(
  p_token_id uuid,
  p_option_type text,
  p_amount_now_minor bigint,
  p_installment_amount_minor bigint,
  p_frequency text,
  p_start_date date,
  p_reason text default null,
  p_note text default null,
  p_idempotency_key uuid default gen_random_uuid()
) returns public.payment_negotiations language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_token public.public_access_tokens;
  v_case public.cases;
  v_negotiation public.payment_negotiations;
  v_owner uuid;
  v_action_id uuid;
begin
  select * into v_token from public.public_access_tokens where id=p_token_id for update;
  if not found or v_token.purpose<>'payment' or v_token.revoked_at is not null
    or v_token.consumed_at is not null or v_token.expires_at<=now() then
    raise exception 'Payment link is not active';
  end if;
  select * into v_case from public.cases where id=v_token.case_id for update;
  if not found or v_case.status in ('closed','paid') or v_case.archived_at is not null
    or v_case.outstanding_minor<=0 then raise exception 'Case is unavailable'; end if;
  if p_option_type not in ('promise_to_pay','installment_plan','payment_difficulty')
    or p_frequency not in ('weekly','monthly')
    or p_amount_now_minor<0 or p_installment_amount_minor<=0
    or p_installment_amount_minor>v_case.outstanding_minor
    or p_amount_now_minor>v_case.outstanding_minor
    or p_start_date<timezone('Asia/Kuala_Lumpur',now())::date
    or char_length(coalesce(p_reason,''))>500 or char_length(coalesce(p_note,''))>1000 then
    raise exception 'Invalid negotiation terms';
  end if;
  if exists (select 1 from public.disputes d where d.case_id=v_case.id
    and d.status in ('submitted','under_review','information_requested','partially_accepted')) then
    raise exception 'Resolve the amount issue before requesting payment time';
  end if;
  select * into v_negotiation from public.payment_negotiations
    where public_access_token_id=p_token_id and idempotency_key=p_idempotency_key;
  if found then return v_negotiation; end if;
  if exists (select 1 from public.payment_negotiations n where n.case_id=v_case.id
    and n.status in ('proposed','countered')) then raise exception 'An open negotiation already exists'; end if;
  if p_option_type<>'promise_to_pay' and exists (
    select 1 from public.payment_plans p where p.case_id=v_case.id
      and p.status in ('pending_acceptance','active','defaulted')
  ) then raise exception 'An open payment plan already exists'; end if;

  insert into public.payment_negotiations(
    business_id,case_id,customer_id,public_access_token_id,option_type,idempotency_key
  ) values (
    v_case.business_id,v_case.id,v_case.debtor_id,p_token_id,p_option_type,p_idempotency_key
  ) returning * into v_negotiation;
  insert into public.payment_negotiation_revisions(
    negotiation_id,business_id,case_id,revision_no,proposed_by,amount_now_minor,
    installment_amount_minor,frequency,start_date,reason,note
  ) values (
    v_negotiation.id,v_case.business_id,v_case.id,1,'debtor',p_amount_now_minor,
    p_installment_amount_minor,p_frequency,p_start_date,nullif(btrim(p_reason),''),
    nullif(btrim(p_note),'')
  );
  insert into public.payment_negotiation_events(
    negotiation_id,business_id,case_id,event_type,actor_type,revision_no,metadata
  ) values (
    v_negotiation.id,v_case.business_id,v_case.id,'proposed','debtor',1,
    jsonb_build_object('option_type',p_option_type)
  );
  insert into public.audit_logs(business_id,case_id,public_access_token_id,action,actor_type,metadata)
  values (v_case.business_id,v_case.id,p_token_id,'payment_negotiation.proposed','debtor',
    jsonb_build_object('negotiation_id',v_negotiation.id,'revision_no',1));
  perform public.payment_negotiation_notify(v_negotiation,'proposed','Payment arrangement proposed',
    'A customer proposed payment timing or instalment terms.','medium');

  select b.owner_id into v_owner from public.businesses b where b.id=v_case.business_id;
  insert into public.action_centre_items(
    business_id,case_id,customer_id,assignee_id,type,title,description,reason,href,
    entity_type,entity_id,amount_minor,priority,due_at,status,recommended_action,dedupe_key
  ) values (
    v_case.business_id,v_case.id,v_case.debtor_id,v_owner,'review_negotiation',
    'Review payment proposal','A customer submitted payment timing or instalment terms.',
    'Customer response requires a decision.','/cases/'||v_case.id,
    'payment_negotiation',v_negotiation.id,v_case.outstanding_minor,'medium',now(),'open',
    'Review, counter, accept, or decline','payment-negotiation-review:'||v_negotiation.id::text
  ) on conflict (business_id,dedupe_key) do nothing returning id into v_action_id;
  if v_action_id is not null then
    insert into public.action_centre_item_events(
      action_item_id,business_id,case_id,actor_type,event_type,to_status,metadata
    ) values (v_action_id,v_case.business_id,v_case.id,'system','created','open',
      jsonb_build_object('negotiation_id',v_negotiation.id));
  end if;
  return v_negotiation;
end;
$$;

create or replace function public.payment_negotiation_transition(
  p_negotiation_id uuid,
  p_action text,
  p_amount_now_minor bigint default null,
  p_installment_amount_minor bigint default null,
  p_frequency text default null,
  p_start_date date default null,
  p_reason text default null,
  p_note text default null
) returns public.payment_negotiations language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_negotiation public.payment_negotiations;
  v_revision public.payment_negotiation_revisions;
  v_case public.cases;
  v_plan public.payment_plans;
  v_promise public.payment_promises;
  v_revision_no integer;
  v_count integer;
  v_event text;
begin
  select n.* into v_negotiation from public.payment_negotiations n
  join public.businesses b on b.id=n.business_id
  where n.id=p_negotiation_id and b.owner_id=auth.uid() for update of n;
  if not found then raise exception 'Negotiation not found'; end if;
  if v_negotiation.status not in ('proposed','countered') then
    if v_negotiation.status=p_action then return v_negotiation; end if;
    raise exception 'Negotiation is no longer open';
  end if;
  select * into v_revision from public.payment_negotiation_revisions
    where negotiation_id=v_negotiation.id and revision_no=v_negotiation.current_revision_no;
  select * into v_case from public.cases where id=v_negotiation.case_id for update;

  if p_action='countered' then
    if p_installment_amount_minor is null or p_installment_amount_minor<=0
      or p_installment_amount_minor>v_case.outstanding_minor
      or coalesce(p_amount_now_minor,0)<0 or coalesce(p_amount_now_minor,0)>v_case.outstanding_minor
      or p_frequency not in ('weekly','monthly') or p_start_date is null
      or p_start_date<timezone('Asia/Kuala_Lumpur',now())::date then
      raise exception 'Valid counter-proposal terms are required';
    end if;
    v_revision_no:=v_negotiation.current_revision_no+1;
    insert into public.payment_negotiation_revisions(
      negotiation_id,business_id,case_id,revision_no,proposed_by,amount_now_minor,
      installment_amount_minor,frequency,start_date,reason,note,created_by
    ) values (
      v_negotiation.id,v_negotiation.business_id,v_negotiation.case_id,v_revision_no,'creditor',
      coalesce(p_amount_now_minor,0),p_installment_amount_minor,p_frequency,p_start_date,
      nullif(btrim(p_reason),''),nullif(btrim(p_note),''),auth.uid()
    );
    update public.payment_negotiations set status='countered',current_revision_no=v_revision_no,
      expires_at=now()+interval '14 days',updated_at=now()
    where id=v_negotiation.id returning * into v_negotiation;
    v_event:='countered';
  elsif p_action='accepted' then
    if v_case.status in ('closed','paid') or v_case.archived_at is not null or v_case.outstanding_minor<=0 then
      raise exception 'Case is unavailable';
    end if;
    if v_negotiation.option_type='promise_to_pay' then
      select * into v_promise from public.payment_promise_create(
        v_case.id,
        case when v_revision.amount_now_minor>0 then v_revision.amount_now_minor else v_revision.installment_amount_minor end,
        v_revision.start_date,'portal','payment_negotiation',v_negotiation.id::text,
        coalesce(v_revision.note,v_revision.reason),v_negotiation.id
      );
      update public.payment_negotiations set status='accepted',
        accepted_revision_no=current_revision_no,payment_promise_id=v_promise.id,
        accepted_at=now(),updated_at=now()
      where id=v_negotiation.id returning * into v_negotiation;
    else
      v_count:=greatest(1,least(24,ceil(v_case.outstanding_minor::numeric/v_revision.installment_amount_minor)::integer));
      select * into v_plan from public.payment_plan_create_proposal(
        v_case.id,v_revision.frequency,v_revision.start_date,v_count,'[]'::jsonb,
        concat_ws(E'\n',v_revision.note,'Accepted from negotiation '||v_negotiation.id::text)
      );
      update public.payment_plans set status='active',debtor_confirmed=true,
        debtor_name='Debtor portal proposal',confirmed_at=now(),accepted_at=now()
      where id=v_plan.id returning * into v_plan;
      update public.payment_negotiations set status='accepted',
        accepted_revision_no=current_revision_no,payment_plan_id=v_plan.id,
        accepted_at=now(),updated_at=now()
      where id=v_negotiation.id returning * into v_negotiation;
    end if;
    v_event:='accepted';
  elsif p_action='declined' then
    if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'A decline reason is required'; end if;
    update public.payment_negotiations set status='declined',declined_at=now(),updated_at=now()
      where id=v_negotiation.id returning * into v_negotiation;
    v_event:='declined';
  elsif p_action='withdrawn' then
    update public.payment_negotiations set status='withdrawn',withdrawn_at=now(),updated_at=now()
      where id=v_negotiation.id returning * into v_negotiation;
    v_event:='withdrawn';
  else
    raise exception 'Unsupported negotiation transition';
  end if;

  insert into public.payment_negotiation_events(
    negotiation_id,business_id,case_id,event_type,actor_type,actor_id,revision_no,note
  ) values (
    v_negotiation.id,v_negotiation.business_id,v_negotiation.case_id,v_event,'owner',
    auth.uid(),v_negotiation.current_revision_no,nullif(btrim(p_reason),'')
  ) on conflict (negotiation_id,event_type,revision_no) where revision_no is not null do nothing;
  insert into public.audit_logs(business_id,case_id,action,actor_type,actor_id,metadata)
  values (v_negotiation.business_id,v_negotiation.case_id,'payment_negotiation.'||v_event,
    'owner',auth.uid(),jsonb_build_object('negotiation_id',v_negotiation.id,
    'revision_no',v_negotiation.current_revision_no,'payment_plan_id',v_negotiation.payment_plan_id,
    'payment_promise_id',v_negotiation.payment_promise_id));
  perform public.payment_negotiation_notify(v_negotiation,v_event,
    case v_event when 'accepted' then 'Payment arrangement accepted'
      when 'declined' then 'Payment arrangement declined'
      when 'countered' then 'Payment arrangement countered' else 'Payment arrangement withdrawn' end,
    'Payment arrangement status changed to '||v_event||'.',
    case when v_event='accepted' then 'positive' else 'informational' end);
  if v_event in ('accepted','declined','withdrawn') then
    update public.action_centre_items set status='completed',completed_at=now(),snoozed_until=null
    where business_id=v_negotiation.business_id and entity_type='payment_negotiation'
      and entity_id=v_negotiation.id and status in ('open','in_progress','snoozed');
  end if;
  return v_negotiation;
end;
$$;

create or replace function public.payment_negotiations_expire(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.payment_negotiations; v_count integer:=0;
begin
  for v_row in select * from public.payment_negotiations
    where status in ('proposed','countered') and expires_at<=p_now
    order by expires_at,id for update skip locked
  loop
    update public.payment_negotiations set status='expired',expired_at=p_now,updated_at=p_now
      where id=v_row.id and status in ('proposed','countered');
    if not found then continue; end if;
    insert into public.payment_negotiation_events(
      negotiation_id,business_id,case_id,event_type,actor_type,revision_no,created_at
    ) values (v_row.id,v_row.business_id,v_row.case_id,'expired','system',v_row.current_revision_no,p_now)
    on conflict (negotiation_id,event_type,revision_no) where revision_no is not null do nothing;
    update public.action_centre_items set status='completed',completed_at=p_now,snoozed_until=null
    where business_id=v_row.business_id and entity_type='payment_negotiation'
      and entity_id=v_row.id and status in ('open','in_progress','snoozed');
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.payment_negotiation_submit(uuid,text,bigint,bigint,text,date,text,text,uuid) from public;
grant execute on function public.payment_negotiation_submit(uuid,text,bigint,bigint,text,date,text,text,uuid) to service_role;
revoke all on function public.payment_negotiation_transition(uuid,text,bigint,bigint,text,date,text,text) from public;
grant execute on function public.payment_negotiation_transition(uuid,text,bigint,bigint,text,date,text,text) to authenticated;
revoke all on function public.payment_negotiations_expire(timestamptz) from public;
grant execute on function public.payment_negotiations_expire(timestamptz) to service_role;

commit;

-- Rollback: disable negotiation routes first. Preserve negotiation, revision,
-- event and audit rows once used. Before first use only, drop the three RPCs,
-- policies, trigger, then events, revisions and negotiations in that order.
