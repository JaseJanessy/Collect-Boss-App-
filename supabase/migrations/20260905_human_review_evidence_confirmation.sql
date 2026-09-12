-- Prompt 13 / Phase D: human review, evidence citations and transaction confirmation.
-- Reviewable proposal only. Apply after 20260904_structured_financial_party_candidates.sql.
-- This migration records proposals and human decisions but never creates or
-- updates cases, debtors, obligations, payments, balances, or accounting rows.

begin;

alter table public.document_intake_confirmations
  alter column confirmed_document_kind drop not null,
  drop constraint if exists document_intake_confirmations_confirmed_document_kind_check,
  add constraint document_intake_confirmations_confirmed_document_kind_check check (
    confirmed_document_kind is null or confirmed_document_kind in (
      'online_bank_transfer_receipt','transaction_screenshot','bank_in_cash_deposit_receipt',
      'payment_receipt','unknown_or_other','invoice','receipt','payment_proof','bank_statement',
      'contract','purchase_order','delivery_order','credit_note','communication_record',
      'communication_evidence','other'
    )
  ),
  add column if not exists review_status text not null default 'draft',
  add column if not exists extraction_id uuid references public.document_intake_extractions(id) on delete restrict,
  add column if not exists represents_financial_movement boolean,
  add column if not exists document_kind_confidence numeric(5,4),
  add column if not exists chosen_amount_candidate_id text,
  add column if not exists chosen_amount_original text,
  add column if not exists manual_amount_reason text,
  add column if not exists currency_confirmed boolean not null default false,
  add column if not exists date_interpretation_confirmed boolean not null default false,
  add column if not exists confirmed_timezone text,
  add column if not exists reference_original text,
  add column if not exists transaction_status text,
  add column if not exists transaction_nature_note text,
  add column if not exists field_decisions jsonb not null default '{}'::jsonb,
  add column if not exists evidence_citations jsonb not null default '[]'::jsonb,
  add column if not exists validation_issues jsonb not null default '[]'::jsonb,
  drop constraint if exists document_intake_confirmations_review_status_check,
  add constraint document_intake_confirmations_review_status_check check (review_status in ('draft','confirmed')),
  drop constraint if exists document_intake_confirmations_document_kind_confidence_check,
  add constraint document_intake_confirmations_document_kind_confidence_check
    check (document_kind_confidence is null or document_kind_confidence between 0 and 1),
  drop constraint if exists document_intake_confirmations_transaction_status_check,
  add constraint document_intake_confirmations_transaction_status_check
    check (transaction_status is null or transaction_status in ('successful','pending','failed','unknown')),
  drop constraint if exists document_intake_confirmations_transaction_nature_check,
  add constraint document_intake_confirmations_transaction_nature_check check (
    transaction_nature is null or transaction_nature in (
      'loan_disbursement','repayment','partial_repayment','refund','deposit','fee_adjustment','other'
    )
  ),
  drop constraint if exists document_intake_confirmations_review_json_check,
  add constraint document_intake_confirmations_review_json_check check (
    jsonb_typeof(field_decisions)='object' and jsonb_typeof(evidence_citations)='array'
    and jsonb_typeof(validation_issues)='array'
  );

-- Existing Prompt 8 confirmations did not enforce the Prompt 13 mandatory
-- fields. Keep them immutable but classify them as drafts so they cannot be
-- used to finalise an intake without a new human confirmation.
update public.document_intake_confirmations set review_status='draft';

create index if not exists document_intake_confirmations_extraction_idx
  on public.document_intake_confirmations(business_id,extraction_id,confirmation_version desc);

create or replace function public.document_intake_transition_allowed(p_from text,p_to text)
returns boolean language sql immutable as $$
  select p_from=p_to or (p_from,p_to) in (
    ('draft','awaiting_upload'),('draft','cancelled'),
    ('awaiting_upload','uploaded'),('awaiting_upload','failed'),('awaiting_upload','cancelled'),
    ('uploaded','awaiting_upload'),('uploaded','processing'),('uploaded','needs_review'),
    ('uploaded','ready_to_submit'),('uploaded','failed'),('uploaded','cancelled'),
    ('processing','awaiting_upload'),('processing','needs_review'),('processing','ready_to_submit'),('processing','failed'),('processing','cancelled'),
    ('needs_review','awaiting_upload'),('needs_review','processing'),('needs_review','ready_to_submit'),('needs_review','cancelled'),
    ('ready_to_submit','awaiting_upload'),('ready_to_submit','needs_review'),
    ('ready_to_submit','submitted'),('ready_to_submit','cancelled'),
    ('failed','awaiting_upload'),('failed','processing'),('failed','needs_review'),('failed','ready_to_submit'),('failed','cancelled')
  );
$$;

create or replace function public.document_intake_save_review(
  p_business_id uuid,p_intake_id uuid,p_actor_id uuid,p_action text,p_review jsonb,
  p_idempotency_key text,p_request_hash text,p_correlation_id uuid
) returns public.document_intake_confirmations language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_role text; v_intake public.document_intakes; v_evidence public.evidence_files;
  v_extraction public.document_intake_extractions; v_existing public.document_intake_confirmations;
  v_confirmation public.document_intake_confirmations; v_version integer; v_old_status text;
  v_target_status text; v_default_currency text; v_candidate jsonb; v_candidate_index integer;
  v_amount bigint; v_currency text; v_extraction_id uuid;
begin
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id);
  if v_role is null or v_role='viewer' then raise exception 'P8_PERMISSION_DENIED'; end if;
  if p_action not in ('save_draft','confirm') or p_review is null or jsonb_typeof(p_review)<>'object'
    then raise exception 'P13_INVALID_REVIEW'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':review:'||p_idempotency_key,0));
  select * into v_existing from public.document_intake_confirmations
    where business_id=p_business_id and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_hash<>p_request_hash then raise exception 'P8_IDEMPOTENCY_CONFLICT'; end if;
    return v_existing;
  end if;

  select * into v_intake from public.document_intakes
    where id=p_intake_id and business_id=p_business_id and deleted_at is null for update;
  if not found then raise exception 'P8_INTAKE_NOT_FOUND'; end if;
  if v_intake.status not in ('uploaded','needs_review','ready_to_submit','failed')
    then raise exception 'P8_CONFIRMATION_NOT_ALLOWED'; end if;
  select * into v_evidence from public.evidence_files
    where intake_id=p_intake_id and business_id=p_business_id and kind='original' and is_current
      and soft_deleted_at is null for update;
  if not found then raise exception 'P8_EVIDENCE_REQUIRED'; end if;

  begin v_extraction_id:=(p_review->>'extraction_id')::uuid;
  exception when invalid_text_representation then raise exception 'P13_EXTRACTION_REQUIRED'; end;
  select * into v_extraction from public.document_intake_extractions
    where id=v_extraction_id and intake_id=p_intake_id and evidence_id=v_evidence.id
      and business_id=p_business_id and status in ('completed','needs_review','failed');
  if not found then raise exception 'P13_EXTRACTION_REQUIRED'; end if;
  if jsonb_typeof(coalesce(p_review->'field_decisions','{}'::jsonb))<>'object'
    or jsonb_typeof(coalesce(p_review->'evidence_citations','[]'::jsonb))<>'array'
    or jsonb_typeof(coalesce(p_review->'validation_issues','[]'::jsonb))<>'array'
    then raise exception 'P13_INVALID_REVIEW'; end if;

  v_amount:=nullif(p_review->>'amount_minor','')::bigint;
  v_currency:=nullif(upper(p_review->>'currency'),'');
  select upper(default_currency) into v_default_currency from public.businesses where id=p_business_id;

  if p_action='confirm' then
    if p_review->>'review_status'<>'confirmed' or jsonb_array_length(p_review->'validation_issues')<>0
      then raise exception 'P13_REVIEW_INCOMPLETE'; end if;
    if nullif(p_review->>'document_kind','') is null or (p_review->>'represents_financial_movement')::boolean is null
      then raise exception 'P13_REVIEW_INCOMPLETE'; end if;
    if (p_review->>'represents_financial_movement')::boolean then
      if v_amount is null or v_amount<=0 or v_currency is null or v_currency<>v_default_currency
        or coalesce((p_review->>'currency_confirmed')::boolean,false) is not true
        or nullif(p_review->>'transaction_datetime','') is null or nullif(p_review->>'timezone','') is null
        or coalesce((p_review->>'date_interpretation_confirmed')::boolean,false) is not true
        or nullif(p_review->>'transaction_nature','') is null
        then raise exception 'P13_REVIEW_INCOMPLETE'; end if;
      if p_review->>'transaction_nature'='other' and nullif(trim(p_review->>'transaction_nature_note'),'') is null
        then raise exception 'P13_REVIEW_INCOMPLETE'; end if;
    end if;
    if nullif(p_review->>'chosen_amount_candidate_id','') is not null then
      if p_review->>'chosen_amount_candidate_id' !~ '^amount:[0-9]+$' then raise exception 'P13_INVALID_CANDIDATE'; end if;
      v_candidate_index:=substring(p_review->>'chosen_amount_candidate_id' from '[0-9]+$')::integer;
      v_candidate:=v_extraction.structured_result->'amount_candidates'->v_candidate_index;
      if v_candidate is null or (v_candidate->>'minor_units')::bigint is distinct from v_amount
        or upper(v_candidate->>'currency') is distinct from v_currency
        or v_candidate->>'recognized_string' is distinct from p_review->>'chosen_amount_original'
        then raise exception 'P13_INVALID_CANDIDATE'; end if;
    elsif (p_review->>'represents_financial_movement')::boolean
      and nullif(trim(p_review->>'manual_amount_reason'),'') is null
      then raise exception 'P13_MANUAL_REASON_REQUIRED';
    end if;
    if v_evidence.scan_status<>'clean' then raise exception 'P8_EVIDENCE_SCAN_PENDING'; end if;
  elsif p_review->>'review_status'<>'draft' then
    raise exception 'P13_INVALID_REVIEW';
  end if;

  v_target_status:=case when p_action='confirm' then 'ready_to_submit' else 'needs_review' end;
  if not public.document_intake_transition_allowed(v_intake.status,v_target_status)
    then raise exception 'P8_INVALID_STATUS_TRANSITION'; end if;
  v_old_status:=v_intake.status;
  update public.document_intakes set status=v_target_status,version=version+1,updated_at=now(),last_error_code=null
    where id=p_intake_id returning * into v_intake;
  select coalesce(max(confirmation_version),0)+1 into v_version
    from public.document_intake_confirmations where intake_id=p_intake_id;

  insert into public.document_intake_confirmations(
    intake_id,business_id,confirmation_version,intake_version,review_status,extraction_id,
    confirmed_document_kind,document_kind_confidence,represents_financial_movement,
    chosen_amount_minor,currency,document_datetime,confirmed_timezone,reference,bank,sender,recipient,
    transaction_status,transaction_nature,transaction_nature_note,notes,chosen_amount_candidate_id,
    chosen_amount_original,manual_amount_reason,reference_original,currency_confirmed,date_interpretation_confirmed,
    field_decisions,evidence_citations,validation_issues,confirmed_by,idempotency_key,request_hash
  ) values(
    p_intake_id,p_business_id,v_version,v_intake.version,p_review->>'review_status',v_extraction.id,
    nullif(p_review->>'document_kind',''),nullif(p_review->>'document_kind_confidence','')::numeric,
    nullif(p_review->>'represents_financial_movement','')::boolean,v_amount,v_currency,
    nullif(p_review->>'transaction_datetime','')::timestamptz,nullif(p_review->>'timezone',''),
    nullif(trim(p_review->>'reference'),''),nullif(trim(p_review->>'bank'),''),
    nullif(trim(p_review->>'sender'),''),nullif(trim(p_review->>'recipient'),''),
    nullif(p_review->>'transaction_status',''),nullif(p_review->>'transaction_nature',''),
    nullif(trim(p_review->>'transaction_nature_note'),''),nullif(trim(p_review->>'notes'),''),
    nullif(p_review->>'chosen_amount_candidate_id',''),nullif(p_review->>'chosen_amount_original',''),
    nullif(trim(p_review->>'manual_amount_reason'),''),nullif(p_review->>'reference_original',''),
    coalesce((p_review->>'currency_confirmed')::boolean,false),
    coalesce((p_review->>'date_interpretation_confirmed')::boolean,false),
    coalesce(p_review->'field_decisions','{}'::jsonb),coalesce(p_review->'evidence_citations','[]'::jsonb),
    coalesce(p_review->'validation_issues','[]'::jsonb),p_actor_id,p_idempotency_key,p_request_hash
  ) returning * into v_confirmation;

  insert into public.document_intake_idempotency_keys(
    business_id,action_scope,idempotency_key,request_hash,actor_id,resource_type,resource_id,response_status
  ) values(p_business_id,'confirm',p_idempotency_key,p_request_hash,p_actor_id,'document_intake_confirmation',v_confirmation.id,200);
  insert into public.document_intake_events(
    intake_id,business_id,from_status,to_status,intake_version,actor_id,actor_role,action,metadata,correlation_id,idempotency_key
  ) values(
    p_intake_id,p_business_id,v_old_status,v_target_status,v_intake.version,p_actor_id,v_role,
    case when p_action='confirm' then 'document_review.confirmed' else 'document_review.draft_saved' end,
    jsonb_build_object('confirmation_id',v_confirmation.id,'confirmation_version',v_version,'extraction_id',v_extraction.id,
      'field_decisions',p_review->'field_decisions','evidence_citations',p_review->'evidence_citations',
      'validation_issues',p_review->'validation_issues'),p_correlation_id,p_idempotency_key
  );
  insert into public.audit_logs(
    business_id,action,actor_type,actor_id,actor_role,entity_type,entity_id,correlation_id,idempotency_key,metadata
  ) values(
    p_business_id,case when p_action='confirm' then 'document_review.confirmed' else 'document_review.draft_saved' end,
    'staff',p_actor_id,v_role,'document_intake',p_intake_id::text,p_correlation_id,p_idempotency_key,
    jsonb_build_object('confirmation_id',v_confirmation.id,'confirmation_version',v_version,'extraction_id',v_extraction.id,
      'original_candidates_and_corrections',p_review->'field_decisions','evidence_citations',p_review->'evidence_citations',
      'reviewed_at',v_confirmation.confirmed_at,'reviewed_by',p_actor_id)
  );
  return v_confirmation;
end; $$;

create or replace function public.document_intake_finalise(
  p_business_id uuid,p_intake_id uuid,p_actor_id uuid,p_idempotency_key text,p_request_hash text,p_correlation_id uuid
) returns public.document_intakes language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_intake public.document_intakes; v_existing public.document_intake_idempotency_keys;
  v_confirmation public.document_intake_confirmations; v_new public.document_intakes;
begin
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id);
  if v_role is null or v_role not in ('owner','admin','manager') then raise exception 'P8_SUBMIT_PERMISSION_DENIED'; end if;
  if v_role='manager' and not coalesce((select manager_can_submit_document_intakes from public.business_role_settings where business_id=p_business_id),false)
    then raise exception 'P8_SUBMIT_PERMISSION_DENIED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':finalise:'||p_idempotency_key,0));
  select * into v_existing from public.document_intake_idempotency_keys
    where business_id=p_business_id and action_scope='finalise' and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_hash<>p_request_hash then raise exception 'P8_IDEMPOTENCY_CONFLICT'; end if;
    select * into v_new from public.document_intakes where id=v_existing.resource_id and business_id=p_business_id;
    return v_new;
  end if;
  select * into v_intake from public.document_intakes where id=p_intake_id and business_id=p_business_id and deleted_at is null for update;
  if not found then raise exception 'P8_INTAKE_NOT_FOUND'; end if;
  if v_intake.status<>'ready_to_submit' then raise exception 'P8_INVALID_STATUS_TRANSITION'; end if;
  select * into v_confirmation from public.document_intake_confirmations
    where intake_id=p_intake_id order by confirmation_version desc limit 1;
  if not found or v_confirmation.intake_version<>v_intake.version or v_confirmation.review_status<>'confirmed'
    then raise exception 'P8_CONFIRMATION_REQUIRED'; end if;
  if not exists(
    select 1 from public.evidence_files evidence
    join public.document_intake_extractions extraction on extraction.id=v_confirmation.extraction_id
    where evidence.intake_id=p_intake_id and evidence.business_id=p_business_id and evidence.is_original
      and evidence.is_current and evidence.soft_deleted_at is null and evidence.scan_status='clean'
      and extraction.intake_id=p_intake_id and extraction.evidence_id=evidence.id and extraction.business_id=p_business_id
  ) then raise exception 'P8_CONFIRMATION_REQUIRED'; end if;
  update public.document_intakes set status='submitted',version=version+1,submitted_at=now(),updated_at=now()
    where id=p_intake_id returning * into v_new;
  insert into public.document_intake_idempotency_keys(business_id,action_scope,idempotency_key,request_hash,actor_id,resource_type,resource_id,response_status)
  values(p_business_id,'finalise',p_idempotency_key,p_request_hash,p_actor_id,'document_intake',p_intake_id,200);
  insert into public.document_intake_events(intake_id,business_id,from_status,to_status,intake_version,actor_id,actor_role,action,correlation_id,idempotency_key)
  values(p_intake_id,p_business_id,v_intake.status,'submitted',v_new.version,p_actor_id,v_role,'document_intake.submitted',p_correlation_id,p_idempotency_key);
  insert into public.audit_logs(business_id,action,actor_type,actor_id,actor_role,entity_type,entity_id,correlation_id,idempotency_key,metadata)
  values(p_business_id,'document_intake.submitted','staff',p_actor_id,v_role,'document_intake',p_intake_id::text,p_correlation_id,p_idempotency_key,
    jsonb_build_object('intake_version',v_new.version,'confirmation_version',v_confirmation.confirmation_version,
      'confirmation_id',v_confirmation.id,'extraction_id',v_confirmation.extraction_id));
  return v_new;
end; $$;

revoke all on function public.document_intake_save_review(uuid,uuid,uuid,text,jsonb,text,text,uuid) from public,anon,authenticated;
grant execute on function public.document_intake_save_review(uuid,uuid,uuid,text,jsonb,text,text,uuid) to service_role;

commit;

-- Rollback requires first disabling the Prompt 13 review route. Preserve the
-- append-only review and audit rows for the configured retention period. Restore
-- the previous finalise RPC only after all ready_to_submit drafts are reviewed.
