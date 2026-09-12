begin;

create table if not exists public.disputes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  case_id text not null references public.cases(id) on delete restrict,
  obligation_id uuid references public.obligations(id) on delete restrict,
  customer_id uuid references public.debtors(id) on delete restrict,
  public_access_token_id uuid references public.public_access_tokens(id) on delete set null,
  category text not null check (category in (
    'amount_incorrect','already_paid','duplicate_invoice','goods_not_received',
    'damaged_quality_issue','service_incomplete','incorrect_pricing',
    'do_not_recognise_debt','other'
  )),
  original_amount_minor bigint not null check (original_amount_minor >= 0),
  balance_snapshot_minor bigint not null check (balance_snapshot_minor > 0),
  disputed_amount_minor bigint not null check (
    disputed_amount_minor > 0 and disputed_amount_minor <= balance_snapshot_minor
  ),
  undisputed_amount_minor bigint generated always as
    (balance_snapshot_minor-disputed_amount_minor) stored,
  reason text not null check (nullif(btrim(reason),'') is not null),
  description text not null check (nullif(btrim(description),'') is not null),
  status text not null default 'submitted' check (status in (
    'submitted','under_review','information_requested','partially_accepted',
    'accepted','rejected','resolved','withdrawn'
  )),
  creditor_response text,
  resolution_amount_minor bigint check (
    resolution_amount_minor is null
    or (resolution_amount_minor >= 0 and resolution_amount_minor <= disputed_amount_minor)
  ),
  review_due_at timestamptz,
  resolution_adjustment_event_id uuid references public.case_financial_events(id) on delete restrict,
  submitted_by_type text not null check (submitted_by_type in ('debtor','owner')),
  created_by uuid references auth.users(id) on delete set null,
  idempotency_key uuid not null,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  withdrawn_at timestamptz,
  unique (business_id,idempotency_key),
  check (
    status <> 'rejected'
    or nullif(btrim(coalesce(creditor_response,'')),'') is not null
  )
);
create unique index if not exists disputes_one_active_obligation_uidx
  on public.disputes(obligation_id)
  where obligation_id is not null
    and status in ('submitted','under_review','information_requested','partially_accepted');
create unique index if not exists disputes_one_active_standalone_case_uidx
  on public.disputes(case_id)
  where obligation_id is null
    and status in ('submitted','under_review','information_requested','partially_accepted');
create index if not exists disputes_case_history_idx
  on public.disputes(case_id,submitted_at desc,id);
create index if not exists disputes_review_due_idx
  on public.disputes(business_id,review_due_at)
  where status in ('submitted','under_review','information_requested','partially_accepted');

create table if not exists public.dispute_evidence (
  id uuid primary key default gen_random_uuid(),
  dispute_id uuid not null references public.disputes(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  case_id text not null references public.cases(id) on delete restrict,
  evidence_file_id uuid references public.evidence_files(id) on delete restrict,
  object_path text,
  file_name text not null,
  content_type text,
  size_bytes bigint check (size_bytes is null or size_bytes between 1 and 10485760),
  content_sha256 text,
  submitted_by_type text not null check (submitted_by_type in ('debtor','owner')),
  created_at timestamptz not null default now(),
  check ((evidence_file_id is not null) <> (object_path is not null))
);
create index if not exists dispute_evidence_dispute_idx
  on public.dispute_evidence(dispute_id,created_at,id);

create table if not exists public.dispute_events (
  id uuid primary key default gen_random_uuid(),
  dispute_id uuid not null references public.disputes(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  case_id text not null references public.cases(id) on delete restrict,
  from_status text,
  to_status text not null,
  event_type text not null check (event_type in (
    'submitted','under_review','information_requested','partially_accepted',
    'accepted','rejected','resolved','withdrawn','evidence_attached','credit_adjustment_created'
  )),
  actor_type text not null check (actor_type in ('debtor','owner','system')),
  actor_id uuid references auth.users(id) on delete set null,
  response text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now()
);
create index if not exists dispute_events_case_timeline_idx
  on public.dispute_events(case_id,created_at,id);

alter table public.reminders
  add column if not exists dispute_snapshot_minor bigint,
  add column if not exists collectable_snapshot_minor bigint;

create or replace view public.case_recovery_amounts with (security_invoker=true) as
select
  c.business_id,c.id case_id,c.outstanding_minor total_outstanding_minor,
  least(coalesce(sum(
    case
      when d.status in ('submitted','under_review','information_requested')
        then d.disputed_amount_minor
      when d.status='partially_accepted'
        then greatest(d.disputed_amount_minor-coalesce(d.resolution_amount_minor,0),0)
      else 0
    end
  ),0),c.outstanding_minor)::bigint active_disputed_minor,
  greatest(c.outstanding_minor-least(coalesce(sum(
    case
      when d.status in ('submitted','under_review','information_requested')
        then d.disputed_amount_minor
      when d.status='partially_accepted'
        then greatest(d.disputed_amount_minor-coalesce(d.resolution_amount_minor,0),0)
      else 0
    end
  ),0),c.outstanding_minor),0)::bigint collectable_minor,
  count(d.id) filter (
    where d.status in ('submitted','under_review','information_requested','partially_accepted')
  )::integer active_dispute_count
from public.cases c
left join public.disputes d on d.case_id=c.id and d.business_id=c.business_id
group by c.business_id,c.id,c.outstanding_minor;

alter table public.disputes enable row level security;
alter table public.dispute_evidence enable row level security;
alter table public.dispute_events enable row level security;
create policy "disputes_owner_read" on public.disputes for select to authenticated using (
  exists (select 1 from public.businesses b where b.id=business_id and b.owner_id=auth.uid())
);
create policy "dispute_evidence_owner_read" on public.dispute_evidence for select to authenticated using (
  exists (select 1 from public.businesses b where b.id=business_id and b.owner_id=auth.uid())
);
create policy "dispute_events_owner_read" on public.dispute_events for select to authenticated using (
  exists (select 1 from public.businesses b where b.id=business_id and b.owner_id=auth.uid())
);

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('dispute-evidence','dispute-evidence',false,10485760,array['application/pdf','image/png','image/jpeg'])
on conflict (id) do update set public=false,file_size_limit=10485760,
  allowed_mime_types=excluded.allowed_mime_types;

create or replace function public.dispute_create_internal(
  p_dispute_id uuid,p_business_id uuid,p_case_id text,p_obligation_id uuid,
  p_public_access_token_id uuid,p_category text,p_disputed_amount_minor bigint,
  p_reason text,p_description text,p_submitted_by_type text,p_created_by uuid,
  p_idempotency_key uuid
) returns public.disputes
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_case public.cases;
  v_obligation public.obligations;
  v_dispute public.disputes;
  v_original bigint;
  v_balance bigint;
  v_event_id uuid;
  v_owner_id uuid;
begin
  if p_category not in (
    'amount_incorrect','already_paid','duplicate_invoice','goods_not_received',
    'damaged_quality_issue','service_incomplete','incorrect_pricing',
    'do_not_recognise_debt','other'
  ) then raise exception 'Unsupported dispute category'; end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null
     or nullif(btrim(coalesce(p_description,'')),'') is null then
    raise exception 'A reason and description are required';
  end if;
  select c,b.owner_id into v_case,v_owner_id
  from public.cases c join public.businesses b on b.id=c.business_id
  where c.id=p_case_id and c.business_id=p_business_id for update of c;
  if not found or v_case.archived_at is not null or v_case.status in ('paid','closed') then
    raise exception 'Case is unavailable';
  end if;
  if p_obligation_id is not null then
    select o.* into v_obligation
    from public.obligations o join public.recovery_case_obligations rco on rco.obligation_id=o.id
    where o.id=p_obligation_id and o.business_id=p_business_id and rco.case_id=p_case_id
      and o.archived_at is null for update of o;
    if not found then raise exception 'Invoice or obligation is unavailable'; end if;
    v_original:=v_obligation.original_amount_minor;
    v_balance:=v_obligation.outstanding_minor;
  else
    if exists (select 1 from public.recovery_case_obligations rco where rco.case_id=p_case_id) then
      raise exception 'Select an invoice or obligation for this case';
    end if;
    v_original:=v_case.original_principal_minor;
    v_balance:=v_case.outstanding_minor;
  end if;
  if p_disputed_amount_minor<=0 or p_disputed_amount_minor>v_balance then
    raise exception 'Disputed amount must not exceed the current balance';
  end if;
  select d.* into v_dispute from public.disputes d
  where d.business_id=p_business_id and d.idempotency_key=p_idempotency_key;
  if found then return v_dispute; end if;

  insert into public.disputes (
    id,business_id,case_id,obligation_id,customer_id,public_access_token_id,
    category,original_amount_minor,balance_snapshot_minor,disputed_amount_minor,
    reason,description,review_due_at,submitted_by_type,created_by,idempotency_key
  ) values (
    p_dispute_id,p_business_id,p_case_id,p_obligation_id,v_case.debtor_id,p_public_access_token_id,
    p_category,v_original,v_balance,p_disputed_amount_minor,btrim(p_reason),btrim(p_description),
    now()+interval '3 days',p_submitted_by_type,p_created_by,p_idempotency_key
  ) returning * into v_dispute;
  insert into public.dispute_events (
    dispute_id,business_id,case_id,to_status,event_type,actor_type,actor_id,metadata
  ) values (
    v_dispute.id,p_business_id,p_case_id,'submitted','submitted',p_submitted_by_type,p_created_by,
    jsonb_build_object('disputed_amount_minor',p_disputed_amount_minor,'undisputed_amount_minor',v_balance-p_disputed_amount_minor)
  );
  if p_obligation_id is not null then
    update public.obligations set status='disputed',dispute_review_at=v_dispute.review_due_at
    where id=p_obligation_id;
  end if;
  insert into public.domain_events (
    business_id,case_id,customer_id,obligation_id,event_type,source_entity_type,
    source_entity_id,source_version,effective_date,event_timezone,occurred_at,payload,deduplication_key
  )
  select
    p_business_id,p_case_id,v_case.debtor_id,p_obligation_id,'DISPUTE_SUBMITTED',
    'structured_dispute',v_dispute.id::text,v_dispute.submitted_at::text,
    timezone(b.timezone,v_dispute.submitted_at)::date,b.timezone,v_dispute.submitted_at,
    jsonb_build_object('dispute_id',v_dispute.id,'disputed_amount_minor',p_disputed_amount_minor),
    concat_ws(':',p_business_id::text,'DISPUTE_SUBMITTED','structured_dispute',v_dispute.id::text)
  from public.businesses b where b.id=p_business_id
  on conflict (deduplication_key) do update set deduplication_key=excluded.deduplication_key
  returning id into v_event_id;
  insert into public.action_centre_items (
    business_id,case_id,customer_id,assignee_id,type,title,description,reason,href,
    entity_type,entity_id,amount_minor,priority,due_at,status,recommended_action,
    source_event_id,dedupe_key
  ) values (
    p_business_id,p_case_id,v_case.debtor_id,v_owner_id,'review_dispute','Review customer dispute',
    'A structured amount dispute requires creditor review.','Customer contested part or all of the balance.',
    '/cases/'||p_case_id,'structured_dispute',v_dispute.id,p_disputed_amount_minor,'high',
    v_dispute.review_due_at,'open','Review dispute and evidence',v_event_id,
    'structured-dispute:'||v_dispute.id::text
  ) on conflict (type,entity_id) do nothing;
  insert into public.audit_logs (business_id,case_id,action,actor_type,actor_id,metadata)
  values (
    p_business_id,p_case_id,'dispute.submitted',p_submitted_by_type,p_created_by,
    jsonb_build_object('dispute_id',v_dispute.id,'obligation_id',p_obligation_id,'disputed_amount_minor',p_disputed_amount_minor)
  );
  return v_dispute;
end;
$$;

create or replace function public.dispute_create_owner(
  p_case_id text,p_obligation_id uuid,p_category text,p_disputed_amount_minor bigint,
  p_reason text,p_description text,p_idempotency_key uuid
) returns public.disputes
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_business_id uuid;
begin
  select c.business_id into v_business_id
  from public.cases c join public.businesses b on b.id=c.business_id
  where c.id=p_case_id and b.owner_id=auth.uid();
  if not found then raise exception 'Case not found'; end if;
  return public.dispute_create_internal(
    gen_random_uuid(),v_business_id,p_case_id,p_obligation_id,null,p_category,
    p_disputed_amount_minor,p_reason,p_description,'owner',auth.uid(),p_idempotency_key
  );
end;
$$;

create or replace function public.dispute_submit_public(
  p_dispute_id uuid,p_public_access_token_id uuid,p_obligation_id uuid,p_category text,
  p_disputed_amount_minor bigint,p_reason text,p_description text,p_idempotency_key uuid,
  p_file_name text default null,p_object_path text default null,p_content_type text default null,
  p_size_bytes bigint default null,p_content_sha256 text default null
) returns public.disputes
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_token public.public_access_tokens; v_case public.cases; v_dispute public.disputes;
begin
  select t.* into v_token from public.public_access_tokens t
  where t.id=p_public_access_token_id and t.purpose='payment' and t.revoked_at is null
    and t.consumed_at is null and t.expires_at>now() for update;
  if not found then raise exception 'Payment link is unavailable'; end if;
  select c.* into v_case from public.cases c where c.id=v_token.case_id;
  if not found or v_case.status in ('paid','closed') or v_case.archived_at is not null then
    raise exception 'Case is unavailable';
  end if;
  v_dispute:=public.dispute_create_internal(
    p_dispute_id,v_case.business_id,v_case.id,p_obligation_id,v_token.id,p_category,
    p_disputed_amount_minor,p_reason,p_description,'debtor',null,p_idempotency_key
  );
  if p_object_path is not null then
    insert into public.dispute_evidence (
      dispute_id,business_id,case_id,object_path,file_name,content_type,size_bytes,
      content_sha256,submitted_by_type
    ) values (
      v_dispute.id,v_dispute.business_id,v_dispute.case_id,p_object_path,
      left(coalesce(p_file_name,'Evidence'),255),p_content_type,p_size_bytes,p_content_sha256,'debtor'
    ) on conflict do nothing;
    insert into public.dispute_events (
      dispute_id,business_id,case_id,from_status,to_status,event_type,actor_type,metadata
    ) values (
      v_dispute.id,v_dispute.business_id,v_dispute.case_id,v_dispute.status,v_dispute.status,
      'evidence_attached','debtor',jsonb_build_object('file_name',left(coalesce(p_file_name,'Evidence'),255))
    );
  end if;
  return v_dispute;
end;
$$;

create or replace function public.dispute_transition(
  p_dispute_id uuid,p_to_status text,p_response text default null,
  p_resolution_amount_minor bigint default null
) returns public.disputes
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_dispute public.disputes;
  v_case public.cases;
  v_event_id uuid;
  v_resolution bigint;
  v_from_status text;
begin
  select d.* into v_dispute
  from public.disputes d join public.businesses b on b.id=d.business_id
  where d.id=p_dispute_id and b.owner_id=auth.uid() for update of d;
  if not found then raise exception 'Dispute not found'; end if;
  if p_to_status not in (
    'under_review','information_requested','partially_accepted','accepted',
    'rejected','resolved','withdrawn'
  ) then raise exception 'Unsupported dispute status'; end if;
  v_from_status:=v_dispute.status;
  if v_from_status in ('accepted','rejected','resolved','withdrawn') then
    if v_from_status=p_to_status then return v_dispute; end if;
    raise exception 'A terminal dispute cannot be changed';
  end if;
  if p_to_status in ('rejected','information_requested')
     and nullif(btrim(coalesce(p_response,'')),'') is null then
    raise exception 'A creditor response is required';
  end if;
  if p_to_status='partially_accepted' and (
    p_resolution_amount_minor is null or p_resolution_amount_minor<=0
    or p_resolution_amount_minor>=v_dispute.disputed_amount_minor
  ) then raise exception 'Partial acceptance requires an amount below the disputed amount'; end if;
  v_resolution:=case when p_to_status='accepted'
    then coalesce(p_resolution_amount_minor,v_dispute.disputed_amount_minor)
    when p_to_status='partially_accepted' then p_resolution_amount_minor else null end;
  if v_resolution is not null and (v_resolution<=0 or v_resolution>v_dispute.disputed_amount_minor) then
    raise exception 'Resolution amount is outside the disputed amount';
  end if;

  if v_resolution is not null and v_dispute.resolution_adjustment_event_id is null then
    select c.* into v_case from public.cases c where c.id=v_dispute.case_id for update;
    if v_dispute.obligation_id is not null then
      perform set_config('collectboss.receivables_sync','on',true);
      update public.obligations set adjustments_minor=adjustments_minor-v_resolution
      where id=v_dispute.obligation_id;
      perform set_config('collectboss.receivables_sync','off',true);
    end if;
    insert into public.case_financial_events (
      case_id,event_type,amount_minor,source_table,source_id,note,created_by
    ) values (
      v_dispute.case_id,'adjustment_credit',v_resolution,'dispute_adjustment',
      v_dispute.id,'Accepted dispute credit adjustment',auth.uid()
    ) returning id into v_event_id;
    perform public.financial_recalculate_case(v_dispute.case_id);
  end if;

  update public.disputes set
    status=p_to_status,creditor_response=coalesce(nullif(btrim(p_response),''),creditor_response),
    resolution_amount_minor=coalesce(v_resolution,resolution_amount_minor),
    resolution_adjustment_event_id=coalesce(v_event_id,resolution_adjustment_event_id),
    resolved_at=case when p_to_status in ('accepted','rejected','resolved') then now() else null end,
    withdrawn_at=case when p_to_status='withdrawn' then now() else null end,
    updated_at=now()
  where id=v_dispute.id returning * into v_dispute;
  insert into public.dispute_events (
    dispute_id,business_id,case_id,from_status,to_status,event_type,actor_type,
    actor_id,response,metadata
  ) values (
    v_dispute.id,v_dispute.business_id,v_dispute.case_id,
    v_from_status,p_to_status,p_to_status,
    'owner',auth.uid(),nullif(btrim(p_response),''),
    jsonb_build_object('resolution_amount_minor',v_resolution)
  );
  if v_event_id is not null then
    insert into public.dispute_events (
      dispute_id,business_id,case_id,from_status,to_status,event_type,actor_type,actor_id,metadata
    ) values (
      v_dispute.id,v_dispute.business_id,v_dispute.case_id,p_to_status,p_to_status,
      'credit_adjustment_created','owner',auth.uid(),jsonb_build_object('financial_event_id',v_event_id,'amount_minor',v_resolution)
    );
  end if;
  if p_to_status in ('accepted','rejected','resolved','withdrawn') and v_dispute.obligation_id is not null then
    update public.obligations set status='open',dispute_review_at=null where id=v_dispute.obligation_id;
  end if;
  if p_to_status in ('accepted','rejected','resolved','withdrawn') then
    update public.action_centre_items set status='completed',completed_at=now()
    where business_id=v_dispute.business_id and entity_type='structured_dispute'
      and entity_id=v_dispute.id and status in ('open','in_progress','snoozed');
  end if;
  insert into public.audit_logs (business_id,case_id,action,actor_type,actor_id,metadata)
  values (
    v_dispute.business_id,v_dispute.case_id,'dispute.'||p_to_status,'owner',auth.uid(),
    jsonb_build_object('dispute_id',v_dispute.id,'response',p_response,'resolution_amount_minor',v_resolution)
  );
  return v_dispute;
end;
$$;

revoke all on function public.dispute_create_internal(uuid,uuid,text,uuid,uuid,text,bigint,text,text,text,uuid,uuid) from public,authenticated,anon;
revoke all on function public.dispute_create_owner(text,uuid,text,bigint,text,text,uuid) from public,anon;
revoke all on function public.dispute_submit_public(uuid,uuid,uuid,text,bigint,text,text,uuid,text,text,text,bigint,text) from public,authenticated,anon;
revoke all on function public.dispute_transition(uuid,text,text,bigint) from public,anon;
grant execute on function public.dispute_create_owner(text,uuid,text,bigint,text,text,uuid) to authenticated;
grant execute on function public.dispute_submit_public(uuid,uuid,uuid,text,bigint,text,text,uuid,text,text,text,bigint,text) to service_role;
grant execute on function public.dispute_transition(uuid,text,text,bigint) to authenticated;

commit;

-- Rollback: disable public and owner dispute creation before application
-- rollback. Preserve disputes, evidence links, transitions and any case hold or
-- balance effect; revoke mutation RPCs and retain tenant-scoped reads. Schema
-- removal is destructive and requires a separate approved export/retention
-- plan, never an incident-time shortcut.
