-- Phase B / Prompt 6: deterministic action-priority dashboard.
-- Apply after 20260828_i03_email_communications_2.sql.
begin;

create or replace function public.action_centre_queue(p_type text)
returns text
language sql
immutable
parallel safe
as $$
  select case
    when p_type='promise.missed' then 'promises'
    when p_type='review_payment_proof' then 'payment_proofs'
    when p_type='review_dispute' then 'disputes'
    when p_type='missing_evidence' then 'evidence'
    when p_type='approval_required' then 'approvals'
    when p_type='integration_failed' then 'integrations'
    when p_type in ('compliance_alert','review_payment_access_report') then 'compliance'
    when p_type like 'payment_plan.%' then 'payment_plans'
    when p_type='follow_up.due' then 'follow_ups'
    else 'other'
  end
$$;

-- Materialise real operational gaps that are not emitted as domain events.
-- This function does not calculate balances: it snapshots stored ledger values.
create or replace function public.action_centre_refresh_priority_gaps(p_limit integer default 500)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_limit integer:=least(greatest(coalesce(p_limit,500),1),2000);
  v_closed integer:=0;
  v_written integer:=0;
  v_count integer:=0;
begin
  if auth.role()<>'service_role' then raise exception 'Service role required'; end if;

  update public.action_centre_items a set status='completed',completed_at=now(),snoozed_until=null
  where a.type='approval_required' and a.status in ('open','in_progress','snoozed')
    and not exists(select 1 from public.financial_adjustments f where f.id=a.entity_id and f.approval_status='pending');
  get diagnostics v_count=row_count; v_closed:=v_closed+v_count;

  update public.action_centre_items a set status='completed',completed_at=now(),snoozed_until=null
  where a.type='missing_evidence' and a.status in ('open','in_progress','snoozed')
    and (exists(select 1 from public.evidence_files e where e.case_id=a.case_id and e.archived_at is null)
      or not exists(select 1 from public.cases c where c.id=a.case_id and c.archived_at is null and c.status not in ('paid','closed') and c.outstanding_minor>0));
  get diagnostics v_count=row_count; v_closed:=v_closed+v_count;

  update public.action_centre_items a set status='completed',completed_at=now(),snoozed_until=null
  where a.type='integration_failed' and a.status in ('open','in_progress','snoozed')
    and not exists(select 1 from public.accounting_connections c where c.id=a.entity_id and c.status='error');
  get diagnostics v_count=row_count; v_closed:=v_closed+v_count;

  update public.action_centre_items a set status='completed',completed_at=now(),snoozed_until=null
  where a.type='compliance_alert' and a.status in ('open','in_progress','snoozed')
    and not exists(
      select 1 from public.businesses b where b.id=a.business_id
        and (b.verification_state in ('rejected','restricted') or b.payment_links_restricted_until>now())
    );
  get diagnostics v_count=row_count; v_closed:=v_closed+v_count;

  insert into public.action_centre_items(
    business_id,case_id,customer_id,assignee_id,type,title,description,reason,href,
    entity_type,entity_id,amount_minor,currency,priority,due_at,status,recommended_action,dedupe_key
  )
  select f.business_id,f.case_id,c.debtor_id,b.owner_id,'approval_required','Approve financial adjustment',
    'A financial adjustment is waiting for an authorised decision.',
    'A pending adjustment cannot post until an authorised approver reviews it.',
    '/cases/'||f.case_id||'?section=financials','financial_adjustment',f.id,f.amount_minor,c.currency,
    case when f.adjustment_type='write_off' then 'high' else 'medium' end,
    f.created_at,'open','Review approval','financial-adjustment-approval:'||f.id::text
  from public.financial_adjustments f
  join public.cases c on c.id=f.case_id and c.business_id=f.business_id
  join public.businesses b on b.id=f.business_id
  where f.approval_status='pending' and c.archived_at is null
  order by f.created_at,f.id limit v_limit
  on conflict(business_id,dedupe_key) do update set
    amount_minor=excluded.amount_minor,currency=excluded.currency,priority=excluded.priority,
    assignee_id=excluded.assignee_id,
    status=case when public.action_centre_items.status='completed' then 'open' else public.action_centre_items.status end,
    completed_at=case when public.action_centre_items.status='completed' then null else public.action_centre_items.completed_at end;
  get diagnostics v_count=row_count; v_written:=v_written+v_count;

  insert into public.action_centre_items(
    business_id,case_id,customer_id,assignee_id,type,title,description,reason,href,
    entity_type,amount_minor,currency,priority,due_at,status,recommended_action,dedupe_key
  )
  select c.business_id,c.id,c.debtor_id,coalesce(c.assigned_to,b.owner_id),'missing_evidence','Add missing case evidence',
    'This overdue case has no active evidence file.',
    'At least one factual record is needed before an evidence-based review or handoff.',
    '/evidence/'||c.id,'recovery_case',c.outstanding_minor,c.currency,
    case when c.days_overdue>=90 then 'critical' when c.days_overdue>=30 then 'high' else 'medium' end,
    c.due_date::timestamp at time zone b.timezone,'open','Upload evidence','missing-evidence:'||c.id
  from public.cases c join public.businesses b on b.id=c.business_id
  where c.archived_at is null and c.status not in ('paid','closed') and c.outstanding_minor>0
    and c.due_date<=timezone(b.timezone,now())::date
    and not exists(select 1 from public.evidence_files e where e.case_id=c.id and e.archived_at is null)
  order by c.days_overdue desc,c.due_date,c.id limit v_limit
  on conflict(business_id,dedupe_key) do update set
    amount_minor=excluded.amount_minor,currency=excluded.currency,priority=excluded.priority,
    due_at=excluded.due_at,assignee_id=excluded.assignee_id,
    status=case when public.action_centre_items.status='completed' then 'open' else public.action_centre_items.status end,
    completed_at=case when public.action_centre_items.status='completed' then null else public.action_centre_items.completed_at end;
  get diagnostics v_count=row_count; v_written:=v_written+v_count;

  insert into public.action_centre_items(
    business_id,assignee_id,type,title,description,reason,href,entity_type,entity_id,
    amount_minor,currency,priority,due_at,status,recommended_action,dedupe_key
  )
  select c.business_id,b.owner_id,'integration_failed','Resolve failed accounting integration',
    initcap(c.provider)||' could not complete its latest synchronisation.',
    coalesce(nullif(c.last_error_message,''),'The integration reported an error.'),
    '/settings#accounting','accounting_connection',c.id,0,b.default_currency,'high',
    coalesce(c.last_attempted_sync_at,c.updated_at),'open','Review integration','integration-failed:'||c.id::text
  from public.accounting_connections c join public.businesses b on b.id=c.business_id
  where c.status='error' order by coalesce(c.last_attempted_sync_at,c.updated_at),c.id limit v_limit
  on conflict(business_id,dedupe_key) do update set
    reason=excluded.reason,due_at=excluded.due_at,assignee_id=excluded.assignee_id,
    status=case when public.action_centre_items.status='completed' then 'open' else public.action_centre_items.status end,
    completed_at=case when public.action_centre_items.status='completed' then null else public.action_centre_items.completed_at end;
  get diagnostics v_count=row_count; v_written:=v_written+v_count;

  insert into public.action_centre_items(
    business_id,assignee_id,type,title,description,reason,href,entity_type,entity_id,
    amount_minor,currency,priority,due_at,status,recommended_action,dedupe_key
  )
  select b.id,b.owner_id,'compliance_alert','Review business compliance restriction',
    'Payment access or business verification is restricted and requires review.',
    coalesce(b.payment_link_restriction_reason,b.verification_public_note,'A compliance control requires attention.'),
    '/settings#trust-safety','business',b.id,0,b.default_currency,
    case when b.verification_state='restricted' or b.payment_links_restricted_until>now() then 'critical' else 'high' end,
    coalesce(b.payment_links_restricted_until,b.updated_at),'open','Review compliance status','compliance-alert:'||b.id::text
  from public.businesses b
  where b.verification_state in ('rejected','restricted') or b.payment_links_restricted_until>now()
  order by b.updated_at,b.id limit v_limit
  on conflict(business_id,dedupe_key) do update set
    reason=excluded.reason,priority=excluded.priority,due_at=excluded.due_at,
    status=case when public.action_centre_items.status='completed' then 'open' else public.action_centre_items.status end,
    completed_at=case when public.action_centre_items.status='completed' then null else public.action_centre_items.completed_at end;
  get diagnostics v_count=row_count; v_written:=v_written+v_count;

  return jsonb_build_object('closed',v_closed,'written',v_written);
end;
$$;

-- One server-side query owns filtering, permission scope, ordering, financial
-- summary and pagination. The browser never re-ranks or recomputes money.
create or replace function public.action_centre_dashboard(
  p_scope text default 'active',p_owner text default null,p_queue text default null,
  p_case_scope text default null,p_priority text default null,p_due text default null,
  p_offset integer default 0,p_limit integer default 25
)
returns jsonb
language plpgsql
security definer
stable
set search_path=public,pg_temp
as $$
declare
  v_business_id uuid:=public.my_business_id();
  v_user_id uuid:=auth.uid();
  v_timezone text;
  v_can_filter_team boolean;
  v_result jsonb;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if v_business_id is null then raise exception 'Business membership required'; end if;
  if p_scope not in ('active','history') then raise exception 'Invalid scope'; end if;
  if p_queue is not null and p_queue not in ('promises','payment_proofs','disputes','evidence','approvals','integrations','compliance','payment_plans','follow_ups','other') then raise exception 'Invalid queue'; end if;
  if p_case_scope is not null and p_case_scope not in ('standalone','single_obligation','multiple_obligations','account_balance') then raise exception 'Invalid case scope'; end if;
  if p_priority is not null and p_priority not in ('critical','high','medium','low') then raise exception 'Invalid priority'; end if;
  if p_due is not null and p_due not in ('overdue','today','next_7_days','no_due_date') then raise exception 'Invalid due filter'; end if;
  if p_offset<0 or p_offset>1000000 or p_limit<5 or p_limit>50 then raise exception 'Invalid pagination'; end if;

  select b.timezone into v_timezone from public.businesses b where b.id=v_business_id;
  v_timezone:=coalesce(v_timezone,'UTC');
  v_can_filter_team:=public.has_business_permission(v_business_id,'case.manage');

  with visible as (
    select a.*,c.debtor_name,c.currency as case_currency,c.outstanding_minor,c.case_scope,
      public.action_centre_queue(a.type) as queue,
      case a.priority when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end as priority_rank,
      case when a.assignee_id=v_user_id then 'You'
        when a.assignee_id is null then 'Unassigned'
        when a.assignee_id=b.owner_id then 'Business owner'
        else initcap(coalesce(m.role,'team member')) end as owner_name,
      coalesce(d.business_name,d.individual_name,c.debtor_name,'Business operation') as customer_name
    from public.action_centre_items a
    join public.businesses b on b.id=a.business_id
    left join public.cases c on c.id=a.case_id and c.business_id=a.business_id
    left join public.debtors d on d.id=coalesce(a.customer_id,c.debtor_id) and d.business_id=a.business_id
    left join public.business_memberships m on m.business_id=a.business_id and m.user_id=a.assignee_id and m.status='active'
    where a.business_id=v_business_id
      and (v_can_filter_team or a.assignee_id is null or a.assignee_id=v_user_id)
      and ((p_scope='active' and a.status in ('open','in_progress','snoozed')
          and (a.status<>'snoozed' or a.snoozed_until is null or a.snoozed_until<=now()))
        or (p_scope='history' and a.status in ('completed','dismissed')))
  ), filtered as (
    select * from visible v where
      (p_owner is null or (p_owner='me' and v.assignee_id=v_user_id)
        or (p_owner='unassigned' and v.assignee_id is null)
        or v.assignee_id=case when p_owner~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then p_owner::uuid else null end)
      and (p_queue is null or v.queue=p_queue)
      and (p_case_scope is null or v.case_scope=p_case_scope)
      and (p_priority is null or v.priority=p_priority)
      and (p_due is null
        or (p_due='overdue' and v.due_at<now())
        or (p_due='today' and timezone(v_timezone,v.due_at)::date=timezone(v_timezone,now())::date)
        or (p_due='next_7_days' and timezone(v_timezone,v.due_at)::date between timezone(v_timezone,now())::date and timezone(v_timezone,now())::date+7)
        or (p_due='no_due_date' and v.due_at is null))
  ), represented as (
    select distinct on (case when f.case_id is null then 'action:'||f.id::text else 'case:'||f.case_id end)
      case when f.case_id is null then f.amount_minor else f.outstanding_minor end as amount_minor,
      coalesce(f.case_currency,f.currency) as currency
    from filtered f
    order by case when f.case_id is null then 'action:'||f.id::text else 'case:'||f.case_id end,f.priority_rank,f.created_at,f.id
  ), page_rows as (
    select f.id,f.business_id,f.case_id,f.customer_id,f.assignee_id,f.type,f.title,f.description,f.href,
      f.entity_type,f.entity_id,f.status,f.reason,f.amount_minor,coalesce(f.case_currency,f.currency) as currency,
      f.priority,f.due_at,f.recommended_action,f.source_event_id,f.completed_at,f.snoozed_until,
      f.dedupe_key,f.created_at,f.customer_name,coalesce(f.outstanding_minor,f.amount_minor) as outstanding_minor,
      f.owner_name,greatest(0,extract(epoch from (now()-f.created_at)))::bigint as age_seconds,
      f.queue,f.case_scope as case_type,f.priority_rank
    from filtered f order by f.priority_rank,f.due_at asc nulls last,f.created_at,f.id
    offset p_offset limit p_limit
  )
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(to_jsonb(p)-'priority_rank' order by p.priority_rank,p.due_at asc nulls last,p.created_at,p.id) from page_rows p),'[]'::jsonb),
    'summary',jsonb_build_object(
      'actionCount',(select count(*) from filtered),
      'actionableCaseCount',(select count(distinct case_id) from filtered where case_id is not null),
      'amountMinor',case when (select count(distinct currency) from represented)=1 then coalesce((select sum(amount_minor) from represented),0) else 0 end,
      'totalsByCurrency',coalesce((select jsonb_agg(jsonb_build_object('currency',x.currency,'amountMinor',x.amount_minor) order by x.currency) from (select currency,sum(amount_minor) amount_minor from represented group by currency)x),'[]'::jsonb),
      'byPriority',coalesce((select jsonb_object_agg(priority,total) from (select priority,count(*) total from filtered group by priority)x),'{}'::jsonb),
      'byQueue',coalesce((select jsonb_object_agg(queue,total) from (select queue,count(*) total from filtered group by queue)x),'{}'::jsonb)
    ),
    'filters',jsonb_build_object(
      'owners',coalesce((select jsonb_agg(jsonb_build_object('id',x.owner_id,'label',x.owner_name) order by x.owner_name) from (select distinct coalesce(assignee_id::text,'unassigned') owner_id,owner_name from visible)x),'[]'::jsonb),
      'queues',coalesce((select jsonb_agg(queue order by queue) from (select distinct queue from visible)x),'[]'::jsonb),
      'caseTypes',coalesce((select jsonb_agg(case_scope order by case_scope) from (select distinct case_scope from visible where case_scope is not null)x),'[]'::jsonb)
    ),
    'page',jsonb_build_object('hasMore',p_offset+p_limit<(select count(*) from filtered),'nextOffset',case when p_offset+p_limit<(select count(*) from filtered) then p_offset+p_limit else null end),
    'permissions',jsonb_build_object('canFilterTeam',v_can_filter_team)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.action_centre_queue(text) from public,anon;
grant execute on function public.action_centre_queue(text) to authenticated,service_role;
revoke all on function public.action_centre_refresh_priority_gaps(integer) from public,anon,authenticated;
grant execute on function public.action_centre_refresh_priority_gaps(integer) to service_role;
revoke all on function public.action_centre_dashboard(text,text,text,text,text,text,integer,integer) from public,anon;
grant execute on function public.action_centre_dashboard(text,text,text,text,text,text,integer,integer) to authenticated;

commit;

-- Rollback: stop the priority-gap refresher/cron and remove the new dashboard
-- consumer before revoking these RPCs. Preserve action-centre rows, completion
-- history and priority projections; restore a prior compatible queue function
-- only if required by the deployed application. Do not delete queued work to
-- satisfy rollback.
