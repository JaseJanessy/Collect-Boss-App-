-- Prompt 20: versioned compliance guardrails and approval gates.
-- Apply after 20260909_debt_truth_engine.sql. The seeded Malaysia policy is
-- deliberately draft-only and cannot authorize production execution.
begin;

create table if not exists public.compliance_policy_versions (
  id uuid primary key default gen_random_uuid(),
  scope_business_id uuid references public.businesses(id) on delete cascade,
  jurisdiction text not null check (char_length(btrim(jurisdiction)) between 2 and 32),
  version text not null check (char_length(btrim(version)) between 1 and 64),
  status text not null default 'draft' check (status in ('draft','counsel_approved','retired')),
  effective_from timestamptz not null,
  effective_until timestamptz,
  rules jsonb not null check (jsonb_typeof(rules)='object'),
  counsel_validated_at timestamptz,
  counsel_validator_name text,
  counsel_validation_reference text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (effective_until is null or effective_until>effective_from),
  check (
    status<>'counsel_approved'
    or (counsel_validated_at is not null
      and nullif(btrim(counsel_validator_name),'') is not null
      and nullif(btrim(counsel_validation_reference),'') is not null)
  )
);
create unique index if not exists compliance_policy_version_scope_uidx
  on public.compliance_policy_versions(coalesce(scope_business_id,'00000000-0000-0000-0000-000000000000'::uuid),jurisdiction,version);
create index if not exists compliance_policy_effective_idx
  on public.compliance_policy_versions(jurisdiction,scope_business_id,effective_from desc)
  where status='counsel_approved';

create table if not exists public.compliance_policy_checks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  case_id text not null references public.cases(id) on delete restrict,
  policy_version_id uuid not null references public.compliance_policy_versions(id) on delete restrict,
  action_kind text not null check (action_kind in ('communication','reminder','legal_action','payment_action','other')),
  channel text check (channel is null or channel in ('whatsapp','call','email','portal','other')),
  content_hash char(64) not null check (content_hash~'^[0-9a-f]{64}$'),
  result text not null check (result in ('allow','approval_required','prohibited')),
  required_approval text not null check (required_approval in ('automatic','agent','supervisor','legal','prohibited')),
  warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings)='array'),
  signals jsonb not null default '[]'::jsonb check (jsonb_typeof(signals)='array'),
  approval_state text not null check (approval_state in ('approved','pending','rejected','invalidated','prohibited')),
  requested_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete restrict,
  approved_at timestamptz,
  approval_note text,
  bypassed boolean not null default false,
  bypass_reason text,
  expires_at timestamptz not null,
  final_action text,
  executed_at timestamptz,
  invalidated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (approval_state<>'approved' or approved_at is not null),
  check (not bypassed or (approved_by is not null and char_length(btrim(bypass_reason)) between 10 and 1000)),
  check (expires_at>created_at)
);
create index if not exists compliance_policy_checks_case_idx
  on public.compliance_policy_checks(business_id,case_id,created_at desc);
create index if not exists compliance_policy_checks_pending_idx
  on public.compliance_policy_checks(business_id,required_approval,created_at)
  where approval_state='pending';

create table if not exists public.compliance_case_holds (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  case_id text not null references public.cases(id) on delete restrict,
  category text not null check (category in (
    'identity_theft','paid_in_full_dispute','legal_representation','serious_complaint',
    'vulnerability','bereavement','wrong_party'
  )),
  source_check_id uuid references public.compliance_policy_checks(id) on delete restrict,
  action_item_id uuid references public.action_centre_items(id) on delete restrict,
  status text not null default 'active' check (status in ('active','resolved')),
  detail text not null check (char_length(btrim(detail)) between 3 and 1000),
  owner_id uuid not null references auth.users(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  resolved_by uuid references auth.users(id) on delete restrict,
  resolution_note text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  check ((status='resolved')=(resolved_at is not null)),
  check (status<>'resolved' or (resolved_by is not null and char_length(btrim(resolution_note)) between 3 and 1000))
);
create unique index if not exists compliance_case_holds_active_uidx
  on public.compliance_case_holds(business_id,case_id,category) where status='active';

alter table public.communication_activities
  add column if not exists policy_check_id uuid references public.compliance_policy_checks(id) on delete restrict,
  add column if not exists policy_version_id uuid references public.compliance_policy_versions(id) on delete restrict,
  add column if not exists policy_result text not null default 'not_applicable'
    check (policy_result in ('not_applicable','allow','approval_required','prohibited')),
  add column if not exists policy_content_hash char(64);
alter table public.scheduled_email_followups
  add column if not exists policy_check_id uuid references public.compliance_policy_checks(id) on delete restrict,
  add column if not exists policy_content_hash char(64);

alter table public.compliance_policy_versions enable row level security;
alter table public.compliance_policy_checks enable row level security;
alter table public.compliance_case_holds enable row level security;
create policy compliance_policy_versions_tenant_read on public.compliance_policy_versions
  for select to authenticated using (
    scope_business_id is null or public.has_business_permission(scope_business_id,'case.read')
  );
create policy compliance_policy_checks_tenant_read on public.compliance_policy_checks
  for select to authenticated using (public.has_business_permission(business_id,'case.read'));
create policy compliance_case_holds_tenant_read on public.compliance_case_holds
  for select to authenticated using (public.has_business_permission(business_id,'case.read'));
-- Writes are server-only. There are intentionally no authenticated mutation policies.
grant select on public.compliance_policy_versions,public.compliance_policy_checks,public.compliance_case_holds to authenticated;
grant all on public.compliance_policy_versions,public.compliance_policy_checks,public.compliance_case_holds to service_role;

insert into public.compliance_policy_versions(
  scope_business_id,jurisdiction,version,status,effective_from,rules
) values (
  null,'MY','MY-DRAFT-2026-01','draft','2026-01-01T00:00:00Z',
  jsonb_build_object(
    'policy_notice','Draft operational safeguards only. This policy is not legal advice, does not guarantee compliance, and must not be activated until documented review by qualified Malaysian counsel.',
    'contact_windows',jsonb_build_object(
      'email',jsonb_build_object('start','08:00','end','20:00','days',jsonb_build_array(1,2,3,4,5,6)),
      'whatsapp',jsonb_build_object('start','08:00','end','20:00','days',jsonb_build_array(1,2,3,4,5,6)),
      'call',jsonb_build_object('start','09:00','end','18:00','days',jsonb_build_array(1,2,3,4,5)),
      'other',jsonb_build_object('start','08:00','end','20:00','days',jsonb_build_array(1,2,3,4,5,6))
    ),
    'frequency',jsonb_build_object('max_attempts_24h',2,'max_attempts_7d',5,'max_attempts_30d',12),
    'prohibited_phrases',jsonb_build_array(
      jsonb_build_object('id','guaranteed_arrest','phrases',jsonb_build_array('you will be arrested','we will have you arrested'),'approval','prohibited','warning','Message contains an arrest threat.'),
      jsonb_build_object('id','guaranteed_imprisonment','phrases',jsonb_build_array('you will go to jail','you will be imprisoned'),'approval','prohibited','warning','Message contains an imprisonment threat.')
    ),
    'threat_indicators',jsonb_build_array('we will ruin you','pay or else','visit your workplace','contact your employer'),
    'authority_impersonation_indicators',jsonb_build_array('we are the court','on behalf of the police','government enforcement unit','court officer'),
    'unsupported_legal_claim_indicators',jsonb_build_array('legal action is guaranteed','you have committed a crime','court judgment has been entered','warrant has been issued'),
    'third_party_disclosure_indicators',jsonb_build_array('tell your family about this debt','inform your employer of this debt','notify your neighbours'),
    'sensitive_case_indicators',jsonb_build_object(
      'identity_theft',jsonb_build_array('identity theft','stolen identity','not my account'),
      'paid_in_full_dispute',jsonb_build_array('paid in full','already paid everything','nothing outstanding'),
      'legal_representation',jsonb_build_array('my lawyer','my solicitor','represented by counsel','contact my attorney'),
      'serious_complaint',jsonb_build_array('formal complaint','reporting harassment','regulator complaint'),
      'vulnerability',jsonb_build_array('financial hardship','medical emergency','mental health crisis','cannot afford food'),
      'bereavement',jsonb_build_array('passed away','deceased','bereavement','died'),
      'wrong_party',jsonb_build_array('wrong person','wrong party','do not know this person','not the debtor')
    ),
    'unverified_balance',jsonb_build_object('block_amount_references',true,'amount_reference_indicators',jsonb_build_array('rm','myr','amount due','outstanding balance','total owed','pay ')),
    'approval_thresholds',jsonb_build_object('amount_minor_supervisor',100000,'bulk_requires_supervisor',true)
  )
) on conflict do nothing;

create or replace function public.compliance_validate_communication_execution()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_check public.compliance_policy_checks; v_policy public.compliance_policy_versions;
begin
  if new.direction<>'outbound' then
    new.policy_result:='not_applicable';
    return new;
  end if;
  if new.policy_check_id is null or new.policy_content_hash is null then
    raise exception using errcode='23514',message='COMPLIANCE_CHECK_REQUIRED';
  end if;
  select * into v_check from public.compliance_policy_checks where id=new.policy_check_id for update;
  if not found or v_check.business_id<>new.business_id or v_check.case_id<>new.case_id
    or v_check.content_hash<>new.policy_content_hash then
    raise exception using errcode='23514',message='COMPLIANCE_CHECK_MISMATCH';
  end if;
  select * into v_policy from public.compliance_policy_versions where id=v_check.policy_version_id;
  if v_policy.status<>'counsel_approved' or v_policy.effective_from>now()
    or (v_policy.effective_until is not null and v_policy.effective_until<=now()) then
    raise exception using errcode='23514',message='COMPLIANCE_POLICY_NOT_ACTIVE';
  end if;
  if v_check.approval_state<>'approved' or v_check.result='prohibited' or v_check.expires_at<=now() then
    raise exception using errcode='23514',message='COMPLIANCE_APPROVAL_REQUIRED';
  end if;
  if exists(select 1 from public.compliance_case_holds h where h.business_id=new.business_id and h.case_id=new.case_id and h.status='active') then
    raise exception using errcode='23514',message='COMPLIANCE_CASE_PAUSED';
  end if;
  new.policy_version_id:=v_check.policy_version_id;
  new.policy_result:=v_check.result;
  update public.compliance_policy_checks set final_action='communication_executed',executed_at=coalesce(executed_at,now()),updated_at=now()
  where id=v_check.id;
  return new;
end;
$$;
drop trigger if exists compliance_communication_execution_guard on public.communication_activities;
create trigger compliance_communication_execution_guard
  before insert or update of status,policy_check_id,policy_content_hash on public.communication_activities
  for each row execute function public.compliance_validate_communication_execution();

create or replace function public.compliance_validate_scheduled_email()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_check public.compliance_policy_checks;
begin
  if tg_op='UPDATE' and (
    new.subject is distinct from old.subject or new.body_text is distinct from old.body_text
    or new.to_recipients is distinct from old.to_recipients
    or new.cc_recipients is distinct from old.cc_recipients
    or new.bcc_recipients is distinct from old.bcc_recipients
  ) then
    update public.compliance_policy_checks set approval_state='invalidated',invalidated_at=now(),
      final_action='content_changed',updated_at=now() where id=old.policy_check_id;
    insert into public.audit_logs(business_id,case_id,action,actor_type,actor_id,entity_type,entity_id,metadata)
    select new.business_id,new.case_id,'compliance.approval_invalidated','system',new.created_by,
      'compliance_policy_check',c.id,jsonb_build_object('policy_version_id',c.policy_version_id,'result',c.result,
        'warnings',c.warnings,'approver',c.approved_by,'final_action','content_changed')
    from public.compliance_policy_checks c where c.id=old.policy_check_id;
    new.status:='cancelled';
    new.policy_check_id:=null;
    new.policy_content_hash:=null;
    return new;
  end if;
  if new.status not in ('pending','processing','sent') then return new; end if;
  if new.policy_check_id is null or new.policy_content_hash is null then
    raise exception using errcode='23514',message='COMPLIANCE_CHECK_REQUIRED';
  end if;
  select * into v_check from public.compliance_policy_checks where id=new.policy_check_id;
  if not found or v_check.business_id<>new.business_id or v_check.case_id<>new.case_id
    or v_check.content_hash<>new.policy_content_hash or v_check.approval_state<>'approved'
    or v_check.result='prohibited' or v_check.expires_at<=now() then
    raise exception using errcode='23514',message='COMPLIANCE_APPROVAL_REQUIRED';
  end if;
  return new;
end;
$$;
drop trigger if exists compliance_scheduled_email_guard on public.scheduled_email_followups;
create trigger compliance_scheduled_email_guard
  before insert or update of status,subject,body_text,to_recipients,cc_recipients,bcc_recipients,policy_check_id,policy_content_hash
  on public.scheduled_email_followups for each row execute function public.compliance_validate_scheduled_email();

create or replace function public.compliance_audit_communication_execution()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_check public.compliance_policy_checks;
begin
  if new.direction='outbound' and new.policy_check_id is not null then
    select * into v_check from public.compliance_policy_checks where id=new.policy_check_id;
    insert into public.audit_logs(business_id,case_id,action,actor_type,actor_id,entity_type,entity_id,metadata)
    values(new.business_id,new.case_id,'compliance.communication_executed','system',new.staff_user_id,'communication_activity',new.id,
      jsonb_build_object('policy_check_id',v_check.id,'policy_version_id',v_check.policy_version_id,'result',v_check.result,
        'warnings',v_check.warnings,'approver',v_check.approved_by,'final_action','communication_executed','bypassed',v_check.bypassed));
  end if;
  return new;
end;
$$;
drop trigger if exists compliance_communication_execution_audit on public.communication_activities;
create trigger compliance_communication_execution_audit
  after insert on public.communication_activities for each row execute function public.compliance_audit_communication_execution();

create or replace function public.compliance_communication_activity_create(
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
  p_idempotency_key uuid default gen_random_uuid(),
  p_policy_check_id uuid default null,
  p_policy_content_hash text default null
) returns public.communication_activities
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_case public.cases; v_activity public.communication_activities;
begin
  select * into v_case from public.cases c
  where c.id=p_case_id and public.has_business_permission(c.business_id,'communication.manage');
  if not found then raise exception 'Case not found or communication permission denied'; end if;
  select * into v_activity from public.communication_activities
  where business_id=v_case.business_id and idempotency_key=p_idempotency_key;
  if found then return v_activity; end if;
  insert into public.communication_activities(
    business_id,customer_id,case_id,channel,direction,status,started_at,staff_user_id,
    external_reference,duration_seconds,metadata,related_promise_id,related_dispute_id,
    related_action_id,idempotency_key,policy_check_id,policy_content_hash
  ) values(
    v_case.business_id,v_case.debtor_id,v_case.id,p_channel,p_direction,p_status,
    coalesce(p_started_at,now()),auth.uid(),nullif(btrim(p_external_reference),''),p_duration_seconds,
    coalesce(p_metadata,'{}'::jsonb),p_related_promise_id,p_related_dispute_id,p_related_action_id,
    p_idempotency_key,p_policy_check_id,p_policy_content_hash
  ) returning * into v_activity;
  return v_activity;
end;
$$;
revoke all on function public.compliance_communication_activity_create(text,text,text,text,timestamptz,text,integer,jsonb,uuid,uuid,uuid,uuid,uuid,text) from public,anon;
grant execute on function public.compliance_communication_activity_create(text,text,text,text,timestamptz,text,integer,jsonb,uuid,uuid,uuid,uuid,uuid,text) to authenticated;

create or replace function public.compliance_pause_paid_in_full_dispute()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_owner uuid; v_hold_id uuid; v_action_id uuid;
begin
  if new.category<>'already_paid' then return new; end if;
  if exists(select 1 from public.compliance_case_holds where business_id=new.business_id and case_id=new.case_id and category='paid_in_full_dispute' and status='active') then
    return new;
  end if;
  select owner_id into v_owner from public.businesses where id=new.business_id;
  v_hold_id:=gen_random_uuid();
  insert into public.compliance_case_holds(id,business_id,case_id,category,status,detail,owner_id,created_by)
  values(v_hold_id,new.business_id,new.case_id,'paid_in_full_dispute','active','A paid-in-full dispute requires owned review before standard automation resumes.',v_owner,new.created_by);
  insert into public.action_centre_items(
    business_id,case_id,customer_id,assignee_id,type,title,description,reason,amount_minor,priority,
    recommended_action,href,entity_type,entity_id,status,completed_at,snoozed_until,dedupe_key
  ) values(
    new.business_id,new.case_id,new.customer_id,v_owner,'compliance.sensitive_review','Review paused sensitive case',
    'A paid-in-full dispute requires owned review before standard automation resumes.','Sensitive case: paid_in_full_dispute',0,'critical',
    'Review the dispute, document the outcome, and resolve the hold before communication resumes.',
    '/cases/'||new.case_id,'compliance_case_hold',v_hold_id,'open',null,null,'compliance-hold:'||v_hold_id
  ) returning id into v_action_id;
  update public.compliance_case_holds set action_item_id=v_action_id where id=v_hold_id;
  insert into public.audit_logs(business_id,case_id,action,actor_type,actor_id,entity_type,entity_id,metadata)
  values(new.business_id,new.case_id,'compliance.case_paused','system',new.created_by,'compliance_case_hold',v_hold_id,
    jsonb_build_object('category','paid_in_full_dispute','dispute_id',new.id,'final_action','automation_paused'));
  return new;
end;
$$;
drop trigger if exists compliance_paid_in_full_dispute_pause on public.disputes;
create trigger compliance_paid_in_full_dispute_pause after insert on public.disputes
  for each row execute function public.compliance_pause_paid_in_full_dispute();
revoke all on function public.compliance_pause_paid_in_full_dispute() from public,anon,authenticated;

revoke all on function public.compliance_validate_communication_execution() from public,anon,authenticated;
revoke all on function public.compliance_validate_scheduled_email() from public,anon,authenticated;
revoke all on function public.compliance_audit_communication_execution() from public,anon,authenticated;

commit;

-- Rollback (preserves evidence): disable outbound communication routes/workers,
-- drop the three compliance triggers, then drop only the added communication
-- columns after exporting their snapshots. Retain policy checks, holds and
-- audit_logs as immutable operational evidence. On an empty non-production
-- database only, the three compliance tables may then be dropped in the order
-- holds, checks, policy versions.
