-- Prompt 19: explainable, review-only discrepancy detection.
-- Apply after 20260909_debt_truth_engine.sql. This migration never mutates an
-- approved financial record and never initiates communication or escalation.
begin;

alter table public.cases
  add column if not exists open_discrepancy_count integer not null default 0,
  add column if not exists discrepancy_impacted_minor bigint not null default 0;
alter table public.cases drop constraint if exists cases_discrepancy_projection_nonnegative;
alter table public.cases add constraint cases_discrepancy_projection_nonnegative
  check(open_discrepancy_count>=0 and discrepancy_impacted_minor>=0);

create table if not exists public.discrepancy_findings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  case_id text not null references public.cases(id) on delete restrict,
  finding_key char(64) not null check(finding_key~'^[a-f0-9]{64}$'),
  category text not null check(category in (
    'duplicate_invoice','duplicate_transaction','unapplied_credit_note','stale_balance',
    'payment_proof_unmatched','accounting_sync_difference','contract_invoice_conflict','debtor_paid_claim_conflict'
  )),
  state_class text not null check(state_class in ('suspicious','inconsistent','incomplete','confirmed_error')),
  severity text not null check(severity in ('low','medium','high','critical')),
  confidence text not null check(confidence in ('deterministic','high','medium','low')),
  confidence_score smallint not null check(confidence_score between 0 and 100),
  impacted_amount_minor bigint not null default 0 check(impacted_amount_minor>=0),
  currency char(3) not null check(currency~'^[A-Z]{3}$'),
  title text not null check(char_length(btrim(title)) between 3 and 160),
  explanation text not null check(char_length(btrim(explanation)) between 3 and 2000),
  conflicting_values jsonb not null check(jsonb_typeof(conflicting_values)='object'),
  source_references jsonb not null check(jsonb_typeof(source_references)='array' and jsonb_array_length(source_references)>0),
  recommended_action text not null check(char_length(btrim(recommended_action)) between 3 and 1000),
  detector_version text not null check(char_length(detector_version) between 1 and 40),
  source_fingerprint char(64) not null check(source_fingerprint~'^[a-f0-9]{64}$'),
  status text not null default 'open' check(status in ('open','confirmed','dismissed','deferred','resolved')),
  status_reason text,
  deferred_until timestamptz,
  corrective_workflow jsonb check(corrective_workflow is null or jsonb_typeof(corrective_workflow)='object'),
  detected_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),
  status_changed_at timestamptz,
  status_changed_by uuid references auth.users(id) on delete set null,
  unique(business_id,finding_key),
  unique(id,business_id),
  check((status='deferred')=(deferred_until is not null)),
  check(status not in ('dismissed','resolved') or nullif(btrim(coalesce(status_reason,'')),'') is not null),
  check(status<>'resolved' or (corrective_workflow ? 'href' and left(corrective_workflow->>'href',1)='/' and left(corrective_workflow->>'href',2)<>'//'))
);
create index if not exists discrepancy_findings_case_idx on public.discrepancy_findings(business_id,case_id,status,severity,last_detected_at desc);

create table if not exists public.discrepancy_finding_events (
  id uuid primary key default gen_random_uuid(),
  finding_id uuid not null,
  business_id uuid not null,
  case_id text not null references public.cases(id) on delete restrict,
  event_type text not null check(event_type in ('detected','source_changed','reopened','confirmed','dismissed','deferred','resolved')),
  from_status text,
  to_status text not null check(to_status in ('open','confirmed','dismissed','deferred','resolved')),
  reason text,
  actor_type text not null check(actor_type in ('system','staff')),
  actor_id uuid references auth.users(id) on delete set null,
  source_fingerprint char(64) not null check(source_fingerprint~'^[a-f0-9]{64}$'),
  metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now(),
  foreign key(finding_id,business_id) references public.discrepancy_findings(id,business_id) on delete restrict
);
create index if not exists discrepancy_finding_events_history_idx on public.discrepancy_finding_events(finding_id,created_at,id);

create or replace function public.discrepancy_event_append_only()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin raise exception 'DISCREPANCY_HISTORY_APPEND_ONLY'; end; $$;
drop trigger if exists discrepancy_finding_events_append_only on public.discrepancy_finding_events;
create trigger discrepancy_finding_events_append_only before update or delete on public.discrepancy_finding_events
for each row execute function public.discrepancy_event_append_only();

create or replace function public.action_centre_queue(p_type text)
returns text language sql immutable parallel safe as $$
  select case
    when p_type='promise.missed' then 'promises'
    when p_type='review_payment_proof' then 'payment_proofs'
    when p_type='review_dispute' then 'disputes'
    when p_type='missing_evidence' then 'evidence'
    when p_type='approval_required' then 'approvals'
    when p_type='integration_failed' then 'integrations'
    when p_type='review_discrepancy' then 'discrepancies'
    when p_type in ('compliance_alert','review_payment_access_report') then 'compliance'
    when p_type like 'payment_plan.%' then 'payment_plans'
    when p_type='follow_up.due' then 'follow_ups'
    else 'other'
  end
$$;

create or replace function public.discrepancy_refresh_projection(p_case_id text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_case public.cases; v_count integer; v_amount bigint; v_priority text; v_finding_id uuid;
begin
  select * into v_case from public.cases where id=p_case_id for update;
  if not found then return; end if;
  select count(*)::integer,coalesce(sum(impacted_amount_minor),0)::bigint,
    case when bool_or(severity='critical') then 'critical' when bool_or(severity='high') then 'high'
      when bool_or(severity='medium') then 'medium' else 'low' end,
    (array_agg(id order by id))[1]
  into v_count,v_amount,v_priority,v_finding_id
  from public.discrepancy_findings where case_id=p_case_id and business_id=v_case.business_id and status in ('open','confirmed','deferred');
  update public.cases set open_discrepancy_count=v_count,discrepancy_impacted_minor=v_amount where id=p_case_id;
  if v_count>0 then
    insert into public.action_centre_items(
      business_id,case_id,customer_id,type,title,description,href,entity_type,entity_id,status,
      reason,amount_minor,priority,recommended_action,dedupe_key
    ) values(
      v_case.business_id,v_case.id,v_case.debtor_id,'review_discrepancy','Review balance discrepancies',
      format('%s reviewable finding(s) affect this case. No communication or escalation has been triggered.',v_count),
      '/cases/'||v_case.id||'?section=financials','discrepancy_finding',v_finding_id,'open',
      'Evidence, ledger, accounting, or claim records do not fully agree.',v_amount,v_priority,
      'Review each cited source and record a finding decision.','discrepancy:case:'||v_case.id
    ) on conflict(business_id,dedupe_key) do update set
      entity_id=excluded.entity_id,status='open',completed_at=null,snoozed_until=null,
      description=excluded.description,reason=excluded.reason,amount_minor=excluded.amount_minor,
      priority=excluded.priority,recommended_action=excluded.recommended_action;
  else
    update public.action_centre_items set status='completed',completed_at=coalesce(completed_at,now()),snoozed_until=null
      where business_id=v_case.business_id and dedupe_key='discrepancy:case:'||v_case.id
        and status in ('open','in_progress','snoozed');
  end if;
end; $$;

create or replace function public.discrepancy_record_scan(
  p_business_id uuid,p_case_id text,p_actor_id uuid,p_detector_version text,p_findings jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_item jsonb; v_existing public.discrepancy_findings; v_result public.discrepancy_findings;
  v_reopened boolean; v_created integer:=0; v_changed integer:=0;
begin
  if auth.uid() is distinct from p_actor_id or not public.has_business_permission(p_business_id,'case.manage') then raise exception 'DISCREPANCY_PERMISSION_DENIED'; end if;
  if not exists(select 1 from public.cases where id=p_case_id and business_id=p_business_id) then raise exception 'DISCREPANCY_CASE_NOT_FOUND'; end if;
  if p_findings is null or jsonb_typeof(p_findings)<>'array' or jsonb_array_length(p_findings)>100
    or nullif(btrim(p_detector_version),'') is null then raise exception 'DISCREPANCY_INVALID_SCAN'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':discrepancy:'||p_case_id,0));
  for v_item in select value from jsonb_array_elements(p_findings) loop
    if v_item->>'finding_key' !~ '^[a-f0-9]{64}$' or v_item->>'source_fingerprint' !~ '^[a-f0-9]{64}$'
      or jsonb_typeof(v_item->'conflicting_values')<>'object' or jsonb_typeof(v_item->'source_references')<>'array'
      or jsonb_array_length(v_item->'source_references')=0 then raise exception 'DISCREPANCY_INVALID_FINDING'; end if;
    select * into v_existing from public.discrepancy_findings
      where business_id=p_business_id and finding_key=v_item->>'finding_key' for update;
    if not found then
      insert into public.discrepancy_findings(
        business_id,case_id,finding_key,category,state_class,severity,confidence,confidence_score,
        impacted_amount_minor,currency,title,explanation,conflicting_values,source_references,
        recommended_action,detector_version,source_fingerprint
      ) values(
        p_business_id,p_case_id,v_item->>'finding_key',v_item->>'category',v_item->>'state_class',
        v_item->>'severity',v_item->>'confidence',(v_item->>'confidence_score')::smallint,
        (v_item->>'impacted_amount_minor')::bigint,upper(v_item->>'currency'),left(v_item->>'title',160),
        left(v_item->>'explanation',2000),v_item->'conflicting_values',v_item->'source_references',
        left(v_item->>'recommended_action',1000),p_detector_version,v_item->>'source_fingerprint'
      ) returning * into v_result;
      insert into public.discrepancy_finding_events(finding_id,business_id,case_id,event_type,to_status,actor_type,actor_id,source_fingerprint,metadata)
        values(v_result.id,p_business_id,p_case_id,'detected','open','system',p_actor_id,v_result.source_fingerprint,jsonb_build_object('detector_version',p_detector_version));
      v_created:=v_created+1;
    else
      if v_existing.case_id<>p_case_id then raise exception 'DISCREPANCY_KEY_SCOPE_MISMATCH'; end if;
      v_reopened:=v_existing.source_fingerprint<>(v_item->>'source_fingerprint') and v_existing.status in ('dismissed','resolved','deferred');
      update public.discrepancy_findings set
        category=v_item->>'category',state_class=case when status='confirmed' and not v_reopened then 'confirmed_error' else v_item->>'state_class' end,
        severity=v_item->>'severity',confidence=v_item->>'confidence',confidence_score=(v_item->>'confidence_score')::smallint,
        impacted_amount_minor=(v_item->>'impacted_amount_minor')::bigint,currency=upper(v_item->>'currency'),
        title=left(v_item->>'title',160),explanation=left(v_item->>'explanation',2000),
        conflicting_values=v_item->'conflicting_values',source_references=v_item->'source_references',
        recommended_action=left(v_item->>'recommended_action',1000),detector_version=p_detector_version,
        source_fingerprint=v_item->>'source_fingerprint',last_detected_at=now(),
        status=case when v_reopened then 'open' else status end,
        status_reason=case when v_reopened then null else status_reason end,
        deferred_until=case when v_reopened then null else deferred_until end,
        corrective_workflow=case when v_reopened then null else corrective_workflow end,
        status_changed_at=case when v_reopened then now() else status_changed_at end,
        status_changed_by=case when v_reopened then p_actor_id else status_changed_by end
      where id=v_existing.id returning * into v_result;
      if v_existing.source_fingerprint<>v_result.source_fingerprint then
        insert into public.discrepancy_finding_events(finding_id,business_id,case_id,event_type,from_status,to_status,reason,actor_type,actor_id,source_fingerprint,metadata)
          values(v_result.id,p_business_id,p_case_id,case when v_reopened then 'reopened' else 'source_changed' end,
            v_existing.status,v_result.status,case when v_reopened then 'Source data changed after the prior decision.' end,
            'system',p_actor_id,v_result.source_fingerprint,jsonb_build_object('previous_fingerprint',v_existing.source_fingerprint));
        v_changed:=v_changed+1;
      end if;
    end if;
  end loop;
  perform public.discrepancy_refresh_projection(p_case_id);
  return jsonb_build_object('created',v_created,'source_changed',v_changed,'detected',jsonb_array_length(p_findings));
end; $$;

create or replace function public.discrepancy_transition(
  p_business_id uuid,p_finding_id uuid,p_actor_id uuid,p_status text,p_reason text,
  p_deferred_until timestamptz default null,p_corrective_workflow jsonb default null
) returns public.discrepancy_findings language plpgsql security definer set search_path=public,pg_temp as $$
declare v_finding public.discrepancy_findings; v_event text; v_old_status text;
begin
  if auth.uid() is distinct from p_actor_id or not public.has_business_permission(p_business_id,'case.manage') then raise exception 'DISCREPANCY_PERMISSION_DENIED'; end if;
  select * into v_finding from public.discrepancy_findings where id=p_finding_id and business_id=p_business_id for update;
  if not found then raise exception 'DISCREPANCY_NOT_FOUND'; end if;
  if p_status not in ('open','confirmed','dismissed','deferred','resolved') then raise exception 'DISCREPANCY_INVALID_STATUS'; end if;
  if p_status in ('confirmed','dismissed','resolved') and nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'DISCREPANCY_REASON_REQUIRED'; end if;
  if p_status='deferred' and (p_deferred_until is null or p_deferred_until<=now()) then raise exception 'DISCREPANCY_VALID_DEFER_DATE_REQUIRED'; end if;
  if p_status='resolved' and (p_corrective_workflow is null or jsonb_typeof(p_corrective_workflow)<>'object'
    or left(coalesce(p_corrective_workflow->>'href',''),1)<>'/' or left(p_corrective_workflow->>'href',2)='//') then raise exception 'DISCREPANCY_WORKFLOW_REQUIRED'; end if;
  v_old_status:=v_finding.status;
  v_event:=case when p_status='open' then 'reopened' else p_status end;
  update public.discrepancy_findings set status=p_status,
    state_class=case when p_status='confirmed' then 'confirmed_error' else state_class end,
    status_reason=nullif(btrim(p_reason),''),deferred_until=case when p_status='deferred' then p_deferred_until end,
    corrective_workflow=case when p_status='resolved' then p_corrective_workflow end,
    status_changed_at=now(),status_changed_by=p_actor_id
  where id=v_finding.id returning * into v_finding;
  insert into public.discrepancy_finding_events(finding_id,business_id,case_id,event_type,from_status,to_status,reason,actor_type,actor_id,source_fingerprint,metadata)
    values(v_finding.id,p_business_id,v_finding.case_id,v_event,v_old_status,p_status,p_reason,'staff',p_actor_id,v_finding.source_fingerprint,
      case when p_status='resolved' then jsonb_build_object('corrective_workflow',p_corrective_workflow) else '{}'::jsonb end);
  perform public.discrepancy_refresh_projection(v_finding.case_id);
  insert into public.audit_logs(business_id,case_id,action,actor_type,actor_id,entity_type,entity_id,metadata)
    values(p_business_id,v_finding.case_id,'discrepancy.'||v_event,'staff',p_actor_id,'discrepancy_finding',v_finding.id::text,
      jsonb_build_object('from_status',v_old_status,'to_status',p_status,'reason',p_reason));
  return v_finding;
end; $$;

alter table public.discrepancy_findings enable row level security;
alter table public.discrepancy_finding_events enable row level security;
create policy discrepancy_findings_tenant_read on public.discrepancy_findings for select to authenticated
  using(public.has_business_permission(business_id,'case.read'));
create policy discrepancy_finding_events_tenant_read on public.discrepancy_finding_events for select to authenticated
  using(public.has_business_permission(business_id,'case.read'));
revoke all on public.discrepancy_findings,public.discrepancy_finding_events from anon;
grant select on public.discrepancy_findings,public.discrepancy_finding_events to authenticated;
grant all on public.discrepancy_findings,public.discrepancy_finding_events to service_role;
revoke all on function public.discrepancy_record_scan(uuid,text,uuid,text,jsonb) from public,anon;
revoke all on function public.discrepancy_transition(uuid,uuid,uuid,text,text,timestamptz,jsonb) from public,anon;
grant execute on function public.discrepancy_record_scan(uuid,text,uuid,text,jsonb) to authenticated,service_role;
grant execute on function public.discrepancy_transition(uuid,uuid,uuid,text,text,timestamptz,jsonb) to authenticated,service_role;
revoke all on function public.discrepancy_refresh_projection(text) from public,anon,authenticated;
grant execute on function public.discrepancy_refresh_projection(text) to service_role;

commit;

-- Rollback: disable the discrepancy API/scan job, then drop the two RPCs,
-- projection function, event guard, tables (events first), queue mapping change,
-- and the two case projection columns. Finding history can instead be retained
-- read-only; no approved ledger/accounting/payment row needs restoration.
