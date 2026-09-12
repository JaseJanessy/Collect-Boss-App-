-- Prompt 14: profile matching, duplicate review, and atomic draft-to-domain routing.
-- Forward-only proposal. Review in staging before applying.
begin;

-- This migration sorts before Prompt 13 in existing deployments. Add only the
-- prerequisite column here; Prompt 13 remains authoritative for its constraints
-- and review workflow. Existing rows default to draft and cannot be submitted.
alter table public.document_intake_confirmations
  add column if not exists review_status text not null default 'draft';

alter table public.document_intake_idempotency_keys
  drop constraint if exists document_intake_idempotency_keys_action_scope_check,
  add constraint document_intake_idempotency_keys_action_scope_check check (action_scope in (
    'create','upload','replace','remove','confirm','extract','finalise','cancel','save_workflow','submit_workflow'
  ));

create table if not exists public.document_intake_workflow_drafts (
  intake_id uuid primary key references public.document_intakes(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  version integer not null default 1 check (version>0),
  step text not null check (step in ('ai_result','transaction_nature','profile_match','required_details','duplicate_review','review_create','success')),
  draft_data jsonb not null default '{}'::jsonb check (jsonb_typeof(draft_data)='object'),
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (intake_id,business_id)
);

create table if not exists public.document_intake_outcomes (
  id uuid primary key default gen_random_uuid(),
  intake_id uuid not null unique references public.document_intakes(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  route text not null check (route in ('loan_disbursement','repayment','partial_repayment','refund','deposit_or_other','collection_case')),
  customer_id uuid references public.debtors(id) on delete restrict,
  account_id uuid references public.customer_accounts(id) on delete restrict,
  obligation_id uuid references public.obligations(id) on delete restrict,
  payment_id uuid references public.payments(id) on delete restrict,
  original_payment_id uuid references public.payments(id) on delete restrict,
  case_id text references public.cases(id) on delete restrict,
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result)='object'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (id,business_id)
);

create table if not exists public.document_intake_record_evidence_links (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete restrict,
  intake_id uuid not null references public.document_intakes(id) on delete restrict,
  evidence_id uuid not null references public.evidence_files(id) on delete restrict,
  entity_type text not null check (entity_type in ('customer','account','obligation','payment','case')),
  entity_id text not null, created_at timestamptz not null default now(),
  unique (evidence_id,entity_type,entity_id)
);

create index if not exists document_intake_outcomes_business_idx on public.document_intake_outcomes(business_id,created_at desc);
create index if not exists document_intake_record_links_intake_idx on public.document_intake_record_evidence_links(intake_id,created_at);

create or replace function public.document_intake_append_only()
returns trigger language plpgsql set search_path=public,pg_temp as $$ begin raise exception 'P8_APPEND_ONLY'; end; $$;
drop trigger if exists document_intake_outcomes_append_only_guard on public.document_intake_outcomes;
create trigger document_intake_outcomes_append_only_guard before update or delete on public.document_intake_outcomes
for each row execute function public.document_intake_append_only();
drop trigger if exists document_intake_record_links_append_only_guard on public.document_intake_record_evidence_links;
create trigger document_intake_record_links_append_only_guard before update or delete on public.document_intake_record_evidence_links
for each row execute function public.document_intake_append_only();

create or replace function public.document_intake_save_workflow(
  p_business_id uuid,p_intake_id uuid,p_actor_id uuid,p_expected_version integer,p_step text,p_draft_data jsonb,
  p_idempotency_key text,p_request_hash text,p_correlation_id uuid
) returns public.document_intake_workflow_drafts language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_intake public.document_intakes; v_draft public.document_intake_workflow_drafts; v_existing public.document_intake_idempotency_keys;
begin
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id);
  if v_role is null then raise exception 'P8_MEMBERSHIP_REQUIRED'; end if;
  if v_role='viewer' then raise exception 'P8_PERMISSION_DENIED'; end if;
  if p_step not in ('ai_result','transaction_nature','profile_match','required_details','duplicate_review','review_create') or jsonb_typeof(p_draft_data)<>'object' then raise exception 'P14_INVALID_WORKFLOW_DRAFT'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':workflow:'||p_intake_id::text,0));
  select * into v_existing from public.document_intake_idempotency_keys where business_id=p_business_id and action_scope='save_workflow' and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_hash<>p_request_hash then raise exception 'P8_IDEMPOTENCY_CONFLICT'; end if;
    select * into v_draft from public.document_intake_workflow_drafts where intake_id=p_intake_id and business_id=p_business_id; return v_draft;
  end if;
  select * into v_intake from public.document_intakes where id=p_intake_id and business_id=p_business_id and deleted_at is null for update;
  if not found then raise exception 'P8_INTAKE_NOT_FOUND'; end if;
  if v_intake.status in ('submitted','cancelled') then raise exception 'P8_INTAKE_LOCKED'; end if;
  select * into v_draft from public.document_intake_workflow_drafts where intake_id=p_intake_id and business_id=p_business_id for update;
  if found then
    if v_draft.version<>p_expected_version then raise exception 'P14_WORKFLOW_VERSION_CONFLICT'; end if;
    update public.document_intake_workflow_drafts set version=version+1,step=p_step,draft_data=p_draft_data,updated_by=p_actor_id,updated_at=now()
      where intake_id=p_intake_id returning * into v_draft;
  else
    if p_expected_version<>1 then raise exception 'P14_WORKFLOW_VERSION_CONFLICT'; end if;
    insert into public.document_intake_workflow_drafts(intake_id,business_id,step,draft_data,updated_by)
      values(p_intake_id,p_business_id,p_step,p_draft_data,p_actor_id) returning * into v_draft;
  end if;
  update public.document_intakes set status=case when p_step='review_create' then 'ready_to_submit' else 'needs_review' end,version=version+1,updated_at=now() where id=p_intake_id;
  insert into public.document_intake_idempotency_keys(business_id,action_scope,idempotency_key,request_hash,actor_id,resource_type,resource_id,response_status)
    values(p_business_id,'save_workflow',p_idempotency_key,p_request_hash,p_actor_id,'document_intake_workflow_draft',p_intake_id,200);
  insert into public.document_intake_events(intake_id,business_id,from_status,to_status,intake_version,actor_id,actor_role,action,metadata,correlation_id,idempotency_key)
    values(p_intake_id,p_business_id,v_intake.status,case when p_step='review_create' then 'ready_to_submit' else 'needs_review' end,v_intake.version+1,p_actor_id,v_role,'document_intake.workflow_saved',jsonb_build_object('step',p_step,'workflow_version',v_draft.version),p_correlation_id,p_idempotency_key);
  return v_draft;
end; $$;

create or replace function public.document_intake_submit_workflow(
  p_business_id uuid,p_intake_id uuid,p_actor_id uuid,p_idempotency_key text,p_request_hash text,p_correlation_id uuid
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_role text; v_intake public.document_intakes; v_draft public.document_intake_workflow_drafts; v_data jsonb; v_existing public.document_intake_idempotency_keys;
  v_outcome public.document_intake_outcomes; v_confirmation public.document_intake_confirmations; v_evidence public.evidence_files;
  v_route text; v_customer public.debtors; v_account public.customer_accounts; v_obligation public.obligations; v_payment public.payments; v_original public.payments; v_case public.cases;
  v_customer_id uuid; v_account_id uuid; v_obligation_id uuid; v_payment_id uuid; v_case_id text; v_amount bigint; v_currency char(3); v_due date; v_reference text; v_profile jsonb; v_candidate_count integer;
begin
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id);
  if v_role is null then raise exception 'P8_MEMBERSHIP_REQUIRED'; end if;
  if v_role not in ('owner','admin') and not (v_role='manager' and coalesce((select manager_can_submit_document_intakes from public.business_role_settings where business_id=p_business_id),false)) then raise exception 'P8_SUBMIT_PERMISSION_DENIED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':submit-workflow:'||p_intake_id::text,0));
  select * into v_existing from public.document_intake_idempotency_keys where business_id=p_business_id and action_scope='submit_workflow' and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_hash<>p_request_hash then raise exception 'P8_IDEMPOTENCY_CONFLICT'; end if;
    select * into v_outcome from public.document_intake_outcomes where id=v_existing.resource_id and business_id=p_business_id;
    return jsonb_build_object('outcome',to_jsonb(v_outcome),'idempotent_replay',true);
  end if;
  select * into v_intake from public.document_intakes where id=p_intake_id and business_id=p_business_id and deleted_at is null for update;
  if not found then raise exception 'P8_INTAKE_NOT_FOUND'; end if;
  if v_intake.status='submitted' then select * into v_outcome from public.document_intake_outcomes where intake_id=p_intake_id; return jsonb_build_object('outcome',to_jsonb(v_outcome),'idempotent_replay',true); end if;
  if v_intake.status<>'ready_to_submit' then raise exception 'P14_WORKFLOW_NOT_READY'; end if;
  select * into v_draft from public.document_intake_workflow_drafts where intake_id=p_intake_id and business_id=p_business_id for update;
  select * into v_confirmation from public.document_intake_confirmations where intake_id=p_intake_id and business_id=p_business_id order by confirmation_version desc limit 1;
  select * into v_evidence from public.evidence_files where intake_id=p_intake_id and business_id=p_business_id and is_original and is_current and soft_deleted_at is null order by evidence_version desc limit 1;
  if v_draft is null or v_confirmation is null or v_confirmation.review_status<>'confirmed' then raise exception 'P8_CONFIRMATION_REQUIRED'; end if;
  if v_evidence is null then raise exception 'P8_EVIDENCE_REQUIRED'; end if;
  if v_evidence.scan_status<>'clean' or v_evidence.processing_status not in ('completed','needs_review') then raise exception 'P8_EVIDENCE_SCAN_PENDING'; end if;
  v_data:=v_draft.draft_data; v_route:=v_data->>'transactionNature'; v_amount:=(v_data->>'amountMinor')::bigint; v_currency:=upper(v_data->>'currency'); v_due:=nullif(v_data->>'dueDate','')::date; v_reference:=nullif(btrim(v_data->>'reference'),'');
  if v_route not in ('loan_disbursement','repayment','partial_repayment','refund','deposit_or_other','collection_case') or v_amount is null or v_amount<=0 or v_currency is null or v_currency !~ '^[A-Z]{3}$' then raise exception 'P14_INVALID_WORKFLOW_DRAFT'; end if;
  if v_confirmation.chosen_amount_minor is distinct from v_amount or v_confirmation.currency is distinct from v_currency then raise exception 'P14_CONFIRMATION_MISMATCH'; end if;
  if v_data->'profileDecision' is null then raise exception 'P14_PROFILE_DECISION_REQUIRED'; end if;
  if v_data#>>'{profileDecision,kind}'='existing' then
    v_customer_id:=(v_data#>>'{profileDecision,customerId}')::uuid;
    select * into v_customer from public.debtors where id=v_customer_id and business_id=p_business_id and archived_at is null;
    if not found then raise exception 'P14_CUSTOMER_SCOPE_MISMATCH'; end if;
  elsif v_data#>>'{profileDecision,kind}'='new' then
    v_profile:=v_data#>'{profileDecision,profile}';
    if nullif(btrim(v_profile->>'name'),'') is null or v_profile->>'debtorType' not in ('individual','business') then raise exception 'P14_NEW_PROFILE_INVALID'; end if;
    insert into public.debtors(business_id,debtor_type,individual_name,business_name,contact_name,registration_no,phone,email,address)
      values(p_business_id,v_profile->>'debtorType',case when v_profile->>'debtorType'='individual' then left(v_profile->>'name',160) end,case when v_profile->>'debtorType'='business' then left(v_profile->>'name',160) end,left(nullif(v_profile->>'contactName',''),160),left(nullif(v_profile->>'registrationNo',''),100),left(nullif(v_profile->>'phone',''),50),left(nullif(lower(v_profile->>'email'),''),254),left(nullif(v_profile->>'address',''),500)) returning * into v_customer;
    v_customer_id:=v_customer.id;
  else raise exception 'P14_PROFILE_DECISION_REQUIRED'; end if;
  v_account_id:=nullif(v_data->>'accountId','')::uuid;
  if v_account_id is not null then
    select * into v_account from public.customer_accounts where id=v_account_id and business_id=p_business_id and customer_id=v_customer_id and currency=v_currency and archived_at is null;
    if not found then raise exception 'P14_ACCOUNT_SCOPE_MISMATCH'; end if;
  elsif v_route in ('loan_disbursement','collection_case') then
    select * into v_account from public.customer_accounts where business_id=p_business_id and customer_id=v_customer_id and currency=v_currency and account_number is null and archived_at is null order by created_at limit 1;
    if not found then insert into public.customer_accounts(business_id,customer_id,account_type,display_name,currency,metadata)
      values(p_business_id,v_customer_id,'general',coalesce(v_customer.business_name,v_customer.individual_name,'Transaction account'),v_currency,jsonb_build_object('source_intake_id',p_intake_id)) returning * into v_account; end if;
    v_account_id:=v_account.id;
  end if;
  v_obligation_id:=nullif(v_data->>'obligationId','')::uuid;
  if v_obligation_id is not null then
    select * into v_obligation from public.obligations where id=v_obligation_id and business_id=p_business_id and customer_id=v_customer_id and currency=v_currency and archived_at is null for update;
    if not found then raise exception 'P14_OBLIGATION_SCOPE_MISMATCH'; end if;
  elsif v_route in ('loan_disbursement','collection_case') then
    if v_due is null or v_reference is null then raise exception 'P14_REQUIRED_DETAILS_MISSING'; end if;
    insert into public.obligations(business_id,customer_id,account_id,obligation_type,reference,issue_date,due_date,currency,original_amount_minor,status,metadata)
      values(p_business_id,v_customer_id,v_account_id,'general_obligation',v_reference,coalesce(nullif(v_data->>'transactionDate','')::date,current_date),v_due,v_currency,v_amount,case when v_due<current_date then 'overdue' else 'open' end,jsonb_build_object('transaction_nature',v_route,'source_intake_id',p_intake_id)) returning * into v_obligation;
    v_obligation_id:=v_obligation.id;
  end if;
  select count(*) into v_candidate_count from public.evidence_files e where e.business_id=p_business_id and e.id<>v_evidence.id and e.soft_deleted_at is null and e.content_sha256=v_evidence.content_sha256;
  if v_candidate_count>0 and coalesce((v_data#>>'{duplicateReview,acknowledged}')::boolean,false)=false then raise exception 'P14_DUPLICATE_REVIEW_REQUIRED'; end if;
  if v_route in ('repayment','partial_repayment') then
    v_case_id:=nullif(v_data->>'caseId','');
    select c.* into v_case from public.cases c join public.recovery_case_obligations r on r.case_id=c.id and r.obligation_id=v_obligation_id where c.id=v_case_id and c.business_id=p_business_id and c.debtor_id=v_customer_id and c.currency=v_currency and c.archived_at is null for update;
    if not found then raise exception 'P14_CASE_OBLIGATION_SCOPE_MISMATCH'; end if;
    insert into public.payments(case_id,amount,amount_minor,currency,payment_method,reference_no,review_status,notes)
      values(v_case.id,public.currency_minor_to_major(v_amount,v_currency),v_amount,v_currency,coalesce(nullif(v_data->>'paymentMethod',''),'bank_transfer'),v_reference,'pending_review',left(nullif(v_data->>'notes',''),2000)) returning * into v_payment;
    v_payment_id:=v_payment.id; v_case_id:=v_case.id;
  elsif v_route='refund' then
    if v_role not in ('owner','admin','manager') then raise exception 'P14_REFUND_PERMISSION_DENIED'; end if;
    select p.* into v_original from public.payments p join public.cases c on c.id=p.case_id where p.id=nullif(v_data->>'originalPaymentId','')::uuid and c.business_id=p_business_id and p.review_status='approved' for update;
    if not found or v_original.amount_minor<>v_amount or v_original.currency<>v_currency then raise exception 'P14_REFUND_ORIGINAL_MISMATCH'; end if;
    insert into public.case_financial_events(case_id,event_type,amount_minor,currency,source_table,source_id,idempotency_key,note,created_by)
      values(v_original.case_id,'payment_reversal',v_original.amount_minor,v_original.currency,'payment_reversal',v_original.id,gen_random_uuid(),coalesce(nullif(v_data->>'notes',''),'Document intake refund'),p_actor_id);
    update public.payments set review_status='reversed',reversed_at=now(),reversed_by=p_actor_id,reversal_reason=coalesce(nullif(v_data->>'notes',''),'Document intake refund') where id=v_original.id;
    perform public.financial_recalculate_case(v_original.case_id); v_payment_id:=v_original.id; v_case_id:=v_original.case_id;
  elsif v_route='collection_case' then
    if not coalesce((v_data->>'createCollectionCase')::boolean,false) or v_due>=current_date or v_obligation.outstanding_minor<=0 then raise exception 'P14_CASE_NOT_JUSTIFIED'; end if;
    v_case_id:='CB-'||extract(year from current_date)::integer::text||'-'||substr(replace(gen_random_uuid()::text,'-',''),1,12);
    insert into public.cases(id,business_id,debtor_id,account_id,case_scope,debtor_type,debtor_name,debtor_phone,debtor_email,debtor_company,debtor_reg_no,debtor_location,currency,amount_owed,amount_paid,due_date,invoice_no,status,payment_lock_mode,notes)
      values(v_case_id,p_business_id,v_customer_id,v_account_id,'single_obligation',v_customer.debtor_type,coalesce(v_customer.business_name,v_customer.individual_name,''),v_customer.phone,v_customer.email,v_customer.business_name,v_customer.registration_no,v_customer.address,v_currency,public.currency_minor_to_major(v_obligation.contractual_due_minor,v_currency),0,v_due,v_reference,'overdue','approval',left(nullif(v_data->>'notes',''),2000));
    insert into public.recovery_case_obligations(case_id,obligation_id,business_id,linked_by) values(v_case_id,v_obligation_id,p_business_id,p_actor_id);
    perform public.receivables_sync_case_obligations(v_case_id);
  end if;
  insert into public.document_intake_outcomes(intake_id,business_id,route,customer_id,account_id,obligation_id,payment_id,original_payment_id,case_id,result,created_by)
    values(p_intake_id,p_business_id,v_route,v_customer_id,v_account_id,v_obligation_id,v_payment_id,case when v_route='refund' then v_payment_id end,v_case_id,jsonb_build_object('payment_status',case when v_payment_id is not null and v_route<>'refund' then 'pending_review' end,'evidence_id',v_evidence.id),p_actor_id) returning * into v_outcome;
  insert into public.document_intake_record_evidence_links(business_id,intake_id,evidence_id,entity_type,entity_id)
    select p_business_id,p_intake_id,v_evidence.id,x.entity_type,x.entity_id from (values
      ('customer',v_customer_id::text),('account',v_account_id::text),('obligation',v_obligation_id::text),('payment',v_payment_id::text),('case',v_case_id)
    ) x(entity_type,entity_id) where x.entity_id is not null;
  update public.document_intakes set status='submitted',submitted_at=now(),version=version+1,updated_at=now() where id=p_intake_id;
  insert into public.document_intake_idempotency_keys(business_id,action_scope,idempotency_key,request_hash,actor_id,resource_type,resource_id,response_status)
    values(p_business_id,'submit_workflow',p_idempotency_key,p_request_hash,p_actor_id,'document_intake_outcome',v_outcome.id,201);
  insert into public.document_intake_events(intake_id,business_id,from_status,to_status,intake_version,actor_id,actor_role,action,metadata,correlation_id,idempotency_key)
    values(p_intake_id,p_business_id,v_intake.status,'submitted',v_intake.version+1,p_actor_id,v_role,'document_intake.workflow_submitted',jsonb_build_object('route',v_route,'outcome_id',v_outcome.id,'duplicate_review',v_data->'duplicateReview'),p_correlation_id,p_idempotency_key);
  insert into public.audit_logs(business_id,case_id,action,actor_type,actor_id,actor_role,entity_type,entity_id,correlation_id,idempotency_key,metadata)
    values(p_business_id,v_case_id,'document_intake.workflow_submitted','staff',p_actor_id,v_role,'document_intake_outcome',v_outcome.id::text,p_correlation_id,p_idempotency_key,jsonb_build_object('route',v_route,'customer_id',v_customer_id,'obligation_id',v_obligation_id,'payment_id',v_payment_id));
  return jsonb_build_object('outcome',to_jsonb(v_outcome),'idempotent_replay',false);
end; $$;

alter table public.document_intake_workflow_drafts enable row level security;
alter table public.document_intake_outcomes enable row level security;
alter table public.document_intake_record_evidence_links enable row level security;
create policy document_intake_workflow_drafts_role_read on public.document_intake_workflow_drafts for select to authenticated using(public.has_business_permission(business_id,'document_intake.read'));
create policy document_intake_outcomes_role_read on public.document_intake_outcomes for select to authenticated using(public.has_business_permission(business_id,'document_intake.read'));
create policy document_intake_record_links_role_read on public.document_intake_record_evidence_links for select to authenticated using(public.has_business_permission(business_id,'document_intake.read'));
revoke all on public.document_intake_workflow_drafts,public.document_intake_outcomes,public.document_intake_record_evidence_links from anon;
grant select on public.document_intake_workflow_drafts,public.document_intake_outcomes,public.document_intake_record_evidence_links to authenticated;
grant all on public.document_intake_workflow_drafts,public.document_intake_outcomes,public.document_intake_record_evidence_links to service_role;
revoke all on function public.document_intake_save_workflow(uuid,uuid,uuid,integer,text,jsonb,text,text,uuid) from public,anon,authenticated;
revoke all on function public.document_intake_submit_workflow(uuid,uuid,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.document_intake_save_workflow(uuid,uuid,uuid,integer,text,jsonb,text,text,uuid) to service_role;
grant execute on function public.document_intake_submit_workflow(uuid,uuid,uuid,text,text,uuid) to service_role;
commit;

-- Rollback: stop intake matching/submission workers and deploy code that no
-- longer calls these service RPCs. Preserve workflow drafts, outcomes, evidence
-- links and idempotency records; leave the additive tables tenant-readable and
-- revoke writes. Never return confirmed intake to draft or delete routed domain
-- records during routine rollback.
