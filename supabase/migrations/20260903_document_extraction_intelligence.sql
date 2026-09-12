-- Prompt 11 / Phase D: OCR, native PDF text extraction and document classification.
-- Reviewable proposal only. Apply after 20260902_image_receipt_intake.sql.
-- Extraction creates candidates and review state only; it never writes cases,
-- profiles, obligations, payments, balances, or other official financial data.

begin;

alter table public.document_intake_idempotency_keys
  drop constraint if exists document_intake_idempotency_keys_action_scope_check,
  add constraint document_intake_idempotency_keys_action_scope_check
    check (action_scope in ('create','upload','replace','remove','confirm','finalise','cancel','extract'));

alter table public.document_intake_extractions
  add column if not exists provider_model text,
  add column if not exists provider_version text,
  add column if not exists extraction_method text,
  add column if not exists protected_raw_result jsonb,
  drop constraint if exists document_intake_extractions_status_check,
  add constraint document_intake_extractions_status_check
    check (status in ('queued','processing','completed','needs_review','failed','cancelled')),
  drop constraint if exists document_intake_extractions_method_check,
  add constraint document_intake_extractions_method_check
    check (extraction_method is null or extraction_method in ('pdf_text_layer','ocr')),
  drop constraint if exists document_intake_extractions_raw_result_check,
  add constraint document_intake_extractions_raw_result_check
    check (protected_raw_result is null or jsonb_typeof(protected_raw_result)='object');

create index if not exists document_intake_extractions_business_intake_idx
  on public.document_intake_extractions(business_id,intake_id,created_at desc);

create or replace function public.document_intake_claim_extraction(p_worker_id text,p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_extraction public.document_intake_extractions; v_evidence public.evidence_files; v_intake public.document_intakes;
  v_old_status text;
begin
  if nullif(trim(p_worker_id),'') is null then raise exception 'P11_INVALID_WORKER'; end if;
  select extraction.* into v_extraction
  from public.document_intake_extractions extraction
  join public.evidence_files evidence on evidence.id=extraction.evidence_id
  join public.document_intakes intake on intake.id=extraction.intake_id
  where extraction.status in ('queued','failed')
    and (extraction.next_attempt_at is null or extraction.next_attempt_at<=p_now)
    and evidence.business_id=extraction.business_id and evidence.intake_id=extraction.intake_id
    and evidence.kind='original' and evidence.is_current and evidence.soft_deleted_at is null
    and evidence.scan_status='clean' and evidence.processing_status not in ('cancelled','completed','needs_review')
    and intake.business_id=extraction.business_id and intake.deleted_at is null
    and intake.status not in ('submitted','cancelled')
  order by coalesce(extraction.next_attempt_at,extraction.created_at),extraction.created_at
  for update of extraction skip locked limit 1;
  if not found then return null; end if;
  select * into v_evidence from public.evidence_files where id=v_extraction.evidence_id for update;
  select * into v_intake from public.document_intakes where id=v_extraction.intake_id for update;

  update public.document_intake_extractions set
    status='processing',attempt_count=attempt_count+1,started_at=coalesce(started_at,p_now),completed_at=null,
    error_code=null,next_attempt_at=null,locked_at=p_now,locked_by=p_worker_id,updated_at=p_now
  where id=v_extraction.id returning * into v_extraction;
  update public.evidence_files set processing_status='processing',processing_version=processing_version+1
    where id=v_evidence.id;
  if v_intake.status<>'processing' then
    v_old_status:=v_intake.status;
    update public.document_intakes set status='processing',version=version+1,updated_at=p_now,last_error_code=null
      where id=v_intake.id returning * into v_intake;
    insert into public.document_intake_events(
      intake_id,business_id,from_status,to_status,intake_version,actor_id,actor_role,action,metadata
    ) values(
      v_intake.id,v_intake.business_id,v_old_status,'processing',v_intake.version,null,null,
      'document_extraction.processing_started',jsonb_build_object('extraction_id',v_extraction.id,'evidence_id',v_evidence.id,'attempt',v_extraction.attempt_count)
    );
  end if;
  return jsonb_build_object(
    'extraction_id',v_extraction.id,'intake_id',v_extraction.intake_id,'evidence_id',v_extraction.evidence_id,
    'business_id',v_extraction.business_id,'storage_bucket',v_evidence.storage_bucket,'object_path',v_evidence.object_path,
    'magic_mime_type',v_evidence.magic_mime_type,'file_name',v_evidence.file_name,
    'file_size_bytes',v_evidence.file_size_bytes,'page_count',v_evidence.page_count,'attempt_count',v_extraction.attempt_count
  );
end; $$;

create or replace function public.document_intake_complete_extraction(
  p_business_id uuid,p_extraction_id uuid,p_worker_id text,p_provider text,p_provider_model text,
  p_provider_version text,p_parser_version text,p_extraction_method text,p_document_classification text,
  p_structured_result jsonb,p_protected_raw_result jsonb,p_confidence numeric,p_warnings jsonb,p_needs_review boolean
) returns public.document_intake_extractions language plpgsql security definer set search_path=public,pg_temp as $$
declare v_extraction public.document_intake_extractions; v_evidence public.evidence_files; v_intake public.document_intakes;
  v_old_status text; v_result_status text;
begin
  select * into v_extraction from public.document_intake_extractions
    where id=p_extraction_id and business_id=p_business_id for update;
  if not found then raise exception 'P11_EXTRACTION_NOT_FOUND'; end if;
  if v_extraction.status<>'processing' or v_extraction.locked_by is distinct from p_worker_id then
    raise exception 'P11_EXTRACTION_LEASE_MISMATCH';
  end if;
  if nullif(trim(p_provider),'') is null or nullif(trim(p_provider_model),'') is null
    or nullif(trim(p_provider_version),'') is null or nullif(trim(p_parser_version),'') is null
    or p_extraction_method not in ('pdf_text_layer','ocr')
    or p_document_classification not in (
      'online_bank_transfer_receipt','transaction_screenshot','bank_in_cash_deposit_receipt','bank_statement',
      'payment_receipt','invoice','credit_note','purchase_order','delivery_order','contract',
      'communication_record','unknown_or_other'
    ) or p_confidence is null or p_confidence<0 or p_confidence>1
    or p_structured_result is null or jsonb_typeof(p_structured_result)<>'object'
    or p_protected_raw_result is null or jsonb_typeof(p_protected_raw_result)<>'object'
    or p_warnings is null or jsonb_typeof(p_warnings)<>'array' then raise exception 'P11_INVALID_EXTRACTION_RESULT'; end if;
  select * into v_evidence from public.evidence_files
    where id=v_extraction.evidence_id and business_id=p_business_id and intake_id=v_extraction.intake_id
      and kind='original' and is_current and soft_deleted_at is null for update;
  select * into v_intake from public.document_intakes
    where id=v_extraction.intake_id and business_id=p_business_id and status not in ('submitted','cancelled') for update;
  if v_evidence.id is null or v_intake.id is null then raise exception 'P11_EXTRACTION_SCOPE_MISMATCH'; end if;
  v_result_status:=case when p_needs_review then 'needs_review' else 'completed' end;
  update public.document_intake_extractions set
    provider=p_provider,provider_model=p_provider_model,provider_version=p_provider_version,parser_version=p_parser_version,
    extraction_method=p_extraction_method,document_classification=p_document_classification,
    structured_result=p_structured_result,protected_raw_result=p_protected_raw_result,protected_raw_text=null,
    confidence=p_confidence,warnings=p_warnings,status=v_result_status,completed_at=now(),error_code=null,
    next_attempt_at=null,locked_at=null,locked_by=null,updated_at=now()
  where id=v_extraction.id returning * into v_extraction;
  update public.evidence_files set processing_status=v_result_status where id=v_evidence.id;
  v_old_status:=v_intake.status;
  update public.document_intakes set status='needs_review',version=version+1,updated_at=now(),last_error_code=null
    where id=v_intake.id returning * into v_intake;
  insert into public.document_intake_events(
    intake_id,business_id,from_status,to_status,intake_version,actor_id,actor_role,action,metadata
  ) values(
    v_intake.id,p_business_id,v_old_status,'needs_review',v_intake.version,null,null,'document_extraction.completed',
    jsonb_build_object('extraction_id',v_extraction.id,'evidence_id',v_evidence.id,'result_status',v_result_status,
      'document_classification',p_document_classification,'classification_confidence',p_confidence,
      'provider',p_provider,'provider_model',p_provider_model,'provider_version',p_provider_version,'parser_version',p_parser_version)
  );
  insert into public.audit_logs(business_id,action,actor_type,entity_type,entity_id,metadata)
  values(p_business_id,'document_extraction.completed','system','document_intake_extraction',v_extraction.id::text,
    jsonb_build_object('intake_id',v_intake.id,'evidence_id',v_evidence.id,'result_status',v_result_status,
      'provider',p_provider,'provider_model',p_provider_model,'provider_version',p_provider_version,'parser_version',p_parser_version));
  return v_extraction;
end; $$;

create or replace function public.document_intake_fail_extraction(
  p_business_id uuid,p_extraction_id uuid,p_worker_id text,p_error_code text,p_retryable boolean,p_max_attempts integer
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_extraction public.document_intake_extractions; v_evidence public.evidence_files; v_intake public.document_intakes;
  v_retry boolean; v_next timestamptz; v_old_status text;
begin
  select * into v_extraction from public.document_intake_extractions
    where id=p_extraction_id and business_id=p_business_id for update;
  if not found then raise exception 'P11_EXTRACTION_NOT_FOUND'; end if;
  if v_extraction.status<>'processing' or v_extraction.locked_by is distinct from p_worker_id then
    raise exception 'P11_EXTRACTION_LEASE_MISMATCH'; end if;
  if p_error_code !~ '^[A-Z0-9_]{3,64}$' or p_max_attempts not between 1 and 5 then
    raise exception 'P11_INVALID_FAILURE'; end if;
  select * into v_evidence from public.evidence_files
    where id=v_extraction.evidence_id and business_id=p_business_id and intake_id=v_extraction.intake_id for update;
  select * into v_intake from public.document_intakes
    where id=v_extraction.intake_id and business_id=p_business_id and status not in ('submitted','cancelled') for update;
  if v_evidence.id is null or v_intake.id is null then raise exception 'P11_EXTRACTION_SCOPE_MISMATCH'; end if;
  if not v_evidence.is_current or v_evidence.soft_deleted_at is not null then
    update public.document_intake_extractions set status='cancelled',error_code='EVIDENCE_SUPERSEDED',
      next_attempt_at=null,completed_at=now(),locked_at=null,locked_by=null,updated_at=now()
      where id=v_extraction.id;
    return jsonb_build_object('extraction_id',v_extraction.id,'retry_scheduled',false,'cancelled',true);
  end if;
  v_retry:=p_retryable and v_extraction.attempt_count<p_max_attempts;
  v_next:=case when v_retry then now()+(least(60,power(2,v_extraction.attempt_count))::text||' minutes')::interval else null end;
  update public.document_intake_extractions set status='failed',error_code=p_error_code,next_attempt_at=v_next,
    completed_at=case when v_retry then null else now() end,locked_at=null,locked_by=null,updated_at=now()
    where id=v_extraction.id returning * into v_extraction;
  update public.evidence_files set processing_status=case when v_retry then 'queued' else 'failed' end where id=v_evidence.id;
  if not v_retry then
    v_old_status:=v_intake.status;
    update public.document_intakes set status='failed',version=version+1,updated_at=now(),last_error_code=p_error_code
      where id=v_intake.id returning * into v_intake;
    insert into public.document_intake_events(
      intake_id,business_id,from_status,to_status,intake_version,actor_id,actor_role,action,error_code,metadata
    ) values(v_intake.id,p_business_id,v_old_status,'failed',v_intake.version,null,null,'document_extraction.failed',p_error_code,
      jsonb_build_object('extraction_id',v_extraction.id,'evidence_id',v_evidence.id,'attempt',v_extraction.attempt_count));
  end if;
  insert into public.audit_logs(business_id,action,actor_type,entity_type,entity_id,metadata)
  values(p_business_id,case when v_retry then 'document_extraction.retry_scheduled' else 'document_extraction.failed' end,
    'system','document_intake_extraction',v_extraction.id::text,
    jsonb_build_object('intake_id',v_intake.id,'evidence_id',v_evidence.id,'error_code',p_error_code,
      'attempt',v_extraction.attempt_count,'retry_scheduled',v_retry,'next_attempt_at',v_next));
  return jsonb_build_object('extraction_id',v_extraction.id,'retry_scheduled',v_retry,'next_attempt_at',v_next);
end; $$;

create or replace function public.document_intake_requeue_extraction(
  p_business_id uuid,p_intake_id uuid,p_actor_id uuid,p_idempotency_key text,p_request_hash text,p_correlation_id uuid
) returns public.document_intake_extractions language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_intake public.document_intakes; v_evidence public.evidence_files;
  v_extraction public.document_intake_extractions; v_existing public.document_intake_idempotency_keys; v_old_status text;
begin
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id);
  if v_role is null or v_role='viewer' then raise exception 'P8_PERMISSION_DENIED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':extract:'||p_idempotency_key,0));
  select * into v_existing from public.document_intake_idempotency_keys
    where business_id=p_business_id and action_scope='extract' and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_hash<>p_request_hash then raise exception 'P8_IDEMPOTENCY_CONFLICT'; end if;
    select * into v_extraction from public.document_intake_extractions
      where id=v_existing.resource_id and business_id=p_business_id;
    return v_extraction;
  end if;
  select * into v_intake from public.document_intakes
    where id=p_intake_id and business_id=p_business_id and deleted_at is null for update;
  if not found then raise exception 'P8_INTAKE_NOT_FOUND'; end if;
  if v_intake.status in ('submitted','cancelled') then raise exception 'P8_INTAKE_LOCKED'; end if;
  select * into v_evidence from public.evidence_files
    where intake_id=p_intake_id and business_id=p_business_id and kind='original' and is_current
      and soft_deleted_at is null for update;
  if not found then raise exception 'P8_EVIDENCE_NOT_FOUND'; end if;
  if v_evidence.scan_status<>'clean' then raise exception 'P8_EVIDENCE_SCAN_PENDING'; end if;
  select * into v_extraction from public.document_intake_extractions
    where evidence_id=v_evidence.id and business_id=p_business_id order by created_at desc limit 1 for update;
  if not found then
    insert into public.document_intake_extractions(
      intake_id,evidence_id,business_id,provider,parser_version,status,idempotency_key
    ) values(p_intake_id,v_evidence.id,p_business_id,'unassigned','pending','queued','extract:'||v_evidence.id::text)
    returning * into v_extraction;
  elsif v_extraction.status='processing' then raise exception 'P11_EXTRACTION_ALREADY_PROCESSING';
  else
    update public.document_intake_extractions set status='queued',error_code=null,next_attempt_at=null,
      completed_at=null,locked_at=null,locked_by=null,updated_at=now() where id=v_extraction.id returning * into v_extraction;
  end if;
  update public.evidence_files set processing_status='queued' where id=v_evidence.id;
  v_old_status:=v_intake.status;
  if v_intake.status<>'processing' then
    update public.document_intakes set status='processing',version=version+1,updated_at=now(),last_error_code=null
      where id=v_intake.id returning * into v_intake;
  end if;
  insert into public.document_intake_idempotency_keys(
    business_id,action_scope,idempotency_key,request_hash,actor_id,resource_type,resource_id,response_status
  ) values(p_business_id,'extract',p_idempotency_key,p_request_hash,p_actor_id,'document_intake_extraction',v_extraction.id,202);
  insert into public.document_intake_events(
    intake_id,business_id,from_status,to_status,intake_version,actor_id,actor_role,action,metadata,correlation_id,idempotency_key
  ) values(p_intake_id,p_business_id,v_old_status,v_intake.status,v_intake.version,p_actor_id,v_role,
    'document_extraction.queued',jsonb_build_object('extraction_id',v_extraction.id,'evidence_id',v_evidence.id),
    p_correlation_id,p_idempotency_key);
  return v_extraction;
end; $$;

-- Extraction payloads, full text, and provider raw results remain service-role
-- only. Authenticated clients receive the explicitly reduced route response.
revoke all on public.document_intake_extractions from anon,authenticated;
grant all on public.document_intake_extractions to service_role;
revoke all on function public.document_intake_claim_extraction(text,timestamptz) from public,anon,authenticated;
revoke all on function public.document_intake_complete_extraction(uuid,uuid,text,text,text,text,text,text,text,jsonb,jsonb,numeric,jsonb,boolean) from public,anon,authenticated;
revoke all on function public.document_intake_fail_extraction(uuid,uuid,text,text,boolean,integer) from public,anon,authenticated;
revoke all on function public.document_intake_requeue_extraction(uuid,uuid,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.document_intake_claim_extraction(text,timestamptz) to service_role;
grant execute on function public.document_intake_complete_extraction(uuid,uuid,text,text,text,text,text,text,text,jsonb,jsonb,numeric,jsonb,boolean) to service_role;
grant execute on function public.document_intake_fail_extraction(uuid,uuid,text,text,boolean,integer) to service_role;
grant execute on function public.document_intake_requeue_extraction(uuid,uuid,uuid,text,text,uuid) to service_role;

commit;

-- Rollback: disable /api/cron/document-extractions first; retain every protected
-- extraction result and audit event required by policy. Drop the four Prompt 11
-- RPCs before removing added columns or restoring the previous status constraint.
