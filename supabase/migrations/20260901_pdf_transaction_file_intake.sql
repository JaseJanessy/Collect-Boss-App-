-- Prompt 9 / Phase D: PDF-only transaction file intake.
-- Reviewable proposal only. Apply after 20260831_secure_document_intake_foundation.sql.
-- No OCR, classification, debtor/case/payment creation, or duplicate approval.

begin;

alter table public.document_intake_idempotency_keys
  drop constraint if exists document_intake_idempotency_keys_action_scope_check,
  add constraint document_intake_idempotency_keys_action_scope_check
    check (action_scope in ('create','upload','replace','remove','confirm','finalise','cancel'));

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
    ('failed','awaiting_upload'),('failed','processing'),('failed','cancelled')
  );
$$;

create or replace function public.document_intake_original_immutable()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if old.intake_id is not null and old.is_immutable and (
    new.business_id is distinct from old.business_id or new.intake_id is distinct from old.intake_id
    or new.case_id is distinct from old.case_id or new.file_name is distinct from old.file_name
    or new.file_type is distinct from old.file_type or new.file_url is distinct from old.file_url
    or new.file_size_bytes is distinct from old.file_size_bytes or new.object_path is distinct from old.object_path
    or new.content_sha256 is distinct from old.content_sha256 or new.kind is distinct from old.kind
    or new.generated_storage_name is distinct from old.generated_storage_name
    or new.storage_bucket is distinct from old.storage_bucket
    or new.declared_mime_type is distinct from old.declared_mime_type
    or new.magic_mime_type is distinct from old.magic_mime_type
    or new.page_count is distinct from old.page_count
    or new.is_original is distinct from old.is_original
    or new.evidence_version is distinct from old.evidence_version
    or new.parent_evidence_id is distinct from old.parent_evidence_id
    or new.supersedes_evidence_id is distinct from old.supersedes_evidence_id
  ) then raise exception 'P8_ORIGINAL_IMMUTABLE'; end if;
  return new;
end; $$;

drop function if exists public.document_intake_attach_evidence(
  uuid,uuid,uuid,uuid,text,text,text,text,text,text,integer,text,text,text,text,text,text,uuid,text,uuid
);
create or replace function public.document_intake_attach_evidence(
  p_business_id uuid,p_intake_id uuid,p_actor_id uuid,p_evidence_id uuid,
  p_original_filename text,p_generated_storage_name text,p_storage_bucket text,p_object_path text,
  p_declared_mime_type text,p_magic_mime_type text,p_file_size_bytes integer,p_page_count integer,p_sha256 text,
  p_document_kind text,p_upload_source text,p_action_scope text,p_idempotency_key text,
  p_request_hash text,p_supersedes_evidence_id uuid,p_scan_provider text,p_correlation_id uuid
) returns public.evidence_files language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_intake public.document_intakes; v_existing_key public.document_intake_idempotency_keys;
  v_existing_file public.evidence_files; v_duplicate_id uuid; v_version integer; v_file public.evidence_files; v_old_status text;
begin
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id);
  if v_role is null or v_role='viewer' then raise exception 'P8_PERMISSION_DENIED'; end if;
  if p_action_scope not in ('upload','replace') then raise exception 'P8_INVALID_ACTION_SCOPE'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':'||p_action_scope||':'||p_idempotency_key,0));
  select * into v_existing_key from public.document_intake_idempotency_keys
    where business_id=p_business_id and action_scope=p_action_scope and idempotency_key=p_idempotency_key;
  if found then
    if v_existing_key.request_hash<>p_request_hash then raise exception 'P8_IDEMPOTENCY_CONFLICT'; end if;
    select * into v_existing_file from public.evidence_files where id=v_existing_key.resource_id and business_id=p_business_id;
    return v_existing_file;
  end if;
  select * into v_intake from public.document_intakes
    where id=p_intake_id and business_id=p_business_id and deleted_at is null for update;
  if not found then raise exception 'P8_INTAKE_NOT_FOUND'; end if;
  if v_intake.status in ('submitted','cancelled') then raise exception 'P8_INTAKE_LOCKED'; end if;
  if not public.document_intake_transition_allowed(v_intake.status,'uploaded') then raise exception 'P8_INVALID_STATUS_TRANSITION'; end if;
  if p_storage_bucket<>'transaction-evidence' or p_object_path<>(p_business_id::text||'/'||p_intake_id::text||'/'||p_evidence_id::text||'/'||p_generated_storage_name)
    then raise exception 'P8_INVALID_STORAGE_PATH'; end if;
  if p_declared_mime_type<>'application/pdf' or p_magic_mime_type<>'application/pdf'
    or p_generated_storage_name<>'original.pdf' or p_sha256 !~ '^[0-9a-f]{64}$'
    or p_file_size_bytes<=0 or (p_page_count is not null and p_page_count<=0)
    then raise exception 'P8_INVALID_FILE_METADATA'; end if;
  if p_supersedes_evidence_id is not null then
    select * into v_existing_file from public.evidence_files
      where id=p_supersedes_evidence_id and intake_id=p_intake_id and business_id=p_business_id
        and kind='original' and is_current and soft_deleted_at is null for update;
    if not found then raise exception 'P8_EVIDENCE_NOT_FOUND'; end if;
    update public.evidence_files set is_current=false where id=p_supersedes_evidence_id;
  end if;
  select id into v_duplicate_id from public.evidence_files
    where business_id=p_business_id and content_sha256=p_sha256 and archived_at is null and soft_deleted_at is null
    order by uploaded_at,id limit 1;
  select coalesce(max(evidence_version),0)+1 into v_version from public.evidence_files
    where intake_id=p_intake_id and kind='original';
  insert into public.evidence_files(
    id,case_id,business_id,intake_id,file_name,file_type,file_url,file_size_bytes,page_count,evidence_type,object_path,
    retention_until,content_sha256,kind,generated_storage_name,storage_bucket,declared_mime_type,magic_mime_type,
    upload_source,is_immutable,is_original,evidence_version,is_current,supersedes_evidence_id,scan_provider,scan_status,
    processing_status,processing_version,duplicate_match_status,duplicate_of_evidence_id,idempotency_scope,idempotency_key,request_hash
  ) values(
    p_evidence_id,null,p_business_id,p_intake_id,left(p_original_filename,255),'PDF',null,p_file_size_bytes,p_page_count,
    p_document_kind,p_object_path,v_intake.retention_until,p_sha256,'original',p_generated_storage_name,p_storage_bucket,
    p_declared_mime_type,p_magic_mime_type,p_upload_source,true,true,v_version,true,p_supersedes_evidence_id,
    p_scan_provider,'pending','queued',1,case when v_duplicate_id is null then 'none' else 'exact_hash_warning' end,
    v_duplicate_id,p_action_scope,p_idempotency_key,p_request_hash
  ) returning * into v_file;
  insert into public.document_intake_extractions(intake_id,evidence_id,business_id,provider,parser_version,status,idempotency_key)
  values(p_intake_id,v_file.id,p_business_id,'unassigned','pending','queued','extract:'||v_file.id::text);
  v_old_status:=v_intake.status;
  update public.document_intakes set status='uploaded',version=version+1,updated_at=now(),last_error_code=null
    where id=p_intake_id returning * into v_intake;
  insert into public.document_intake_idempotency_keys(business_id,action_scope,idempotency_key,request_hash,actor_id,resource_type,resource_id,response_status)
  values(p_business_id,p_action_scope,p_idempotency_key,p_request_hash,p_actor_id,'evidence_file',v_file.id,201);
  insert into public.document_intake_events(intake_id,business_id,from_status,to_status,intake_version,actor_id,actor_role,action,metadata,correlation_id,idempotency_key)
  values(p_intake_id,p_business_id,v_old_status,'uploaded',v_intake.version,p_actor_id,v_role,
    case when p_action_scope='replace' then 'document_evidence.replaced' else 'document_evidence.uploaded' end,
    jsonb_build_object('evidence_id',v_file.id,'evidence_version',v_version,'duplicate_warning',v_duplicate_id is not null,
      'scan_status','pending','page_count',p_page_count),p_correlation_id,p_idempotency_key);
  insert into public.audit_logs(business_id,action,actor_type,actor_id,actor_role,entity_type,entity_id,correlation_id,idempotency_key,metadata)
  values(p_business_id,case when p_action_scope='replace' then 'document_evidence.replaced' else 'document_evidence.uploaded' end,
    'staff',p_actor_id,v_role,'evidence_file',v_file.id::text,p_correlation_id,p_idempotency_key,
    jsonb_build_object('intake_id',p_intake_id,'evidence_version',v_version,'document_kind',p_document_kind,
      'bytes',p_file_size_bytes,'page_count',p_page_count,'duplicate_warning',v_duplicate_id is not null,'scan_status','pending'));
  return v_file;
end; $$;

create or replace function public.document_intake_remove_evidence(
  p_business_id uuid,p_intake_id uuid,p_actor_id uuid,p_evidence_id uuid,
  p_idempotency_key text,p_request_hash text,p_correlation_id uuid
) returns public.document_intakes language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_intake public.document_intakes; v_file public.evidence_files;
  v_existing public.document_intake_idempotency_keys; v_old_status text;
begin
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id);
  if v_role is null or v_role='viewer' then raise exception 'P8_PERMISSION_DENIED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':remove:'||p_idempotency_key,0));
  select * into v_existing from public.document_intake_idempotency_keys
    where business_id=p_business_id and action_scope='remove' and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_hash<>p_request_hash then raise exception 'P8_IDEMPOTENCY_CONFLICT'; end if;
    select * into v_intake from public.document_intakes where id=p_intake_id and business_id=p_business_id;
    return v_intake;
  end if;
  select * into v_intake from public.document_intakes
    where id=p_intake_id and business_id=p_business_id and deleted_at is null for update;
  if not found then raise exception 'P8_INTAKE_NOT_FOUND'; end if;
  if v_intake.status in ('submitted','cancelled') then raise exception 'P8_INTAKE_LOCKED'; end if;
  select * into v_file from public.evidence_files
    where id=p_evidence_id and intake_id=p_intake_id and business_id=p_business_id
      and kind='original' and is_current and soft_deleted_at is null for update;
  if not found then raise exception 'P9_CURRENT_EVIDENCE_REQUIRED'; end if;
  if not public.document_intake_transition_allowed(v_intake.status,'awaiting_upload')
    then raise exception 'P8_INVALID_STATUS_TRANSITION'; end if;
  update public.evidence_files set is_current=false,soft_deleted_at=now(),processing_status='cancelled'
    where id=p_evidence_id;
  v_old_status:=v_intake.status;
  if v_old_status<>'awaiting_upload' then
    update public.document_intakes set status='awaiting_upload',version=version+1,updated_at=now(),last_error_code=null
      where id=p_intake_id returning * into v_intake;
  end if;
  insert into public.document_intake_idempotency_keys(
    business_id,action_scope,idempotency_key,request_hash,actor_id,resource_type,resource_id,response_status
  ) values(p_business_id,'remove',p_idempotency_key,p_request_hash,p_actor_id,'evidence_file',p_evidence_id,200);
  insert into public.document_intake_events(
    intake_id,business_id,from_status,to_status,intake_version,actor_id,actor_role,action,metadata,correlation_id,idempotency_key
  ) values(
    p_intake_id,p_business_id,v_old_status,v_intake.status,v_intake.version,p_actor_id,v_role,'document_evidence.removed',
    jsonb_build_object('evidence_id',p_evidence_id,'evidence_version',v_file.evidence_version,'object_retained',true),
    p_correlation_id,p_idempotency_key
  );
  insert into public.audit_logs(
    business_id,action,actor_type,actor_id,actor_role,entity_type,entity_id,correlation_id,idempotency_key,metadata
  ) values(
    p_business_id,'document_evidence.removed','staff',p_actor_id,v_role,'evidence_file',p_evidence_id::text,
    p_correlation_id,p_idempotency_key,jsonb_build_object('intake_id',p_intake_id,'object_retained',true)
  );
  return v_intake;
end; $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('transaction-evidence','transaction-evidence',false,10485760,array['application/pdf'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

revoke all on function public.document_intake_attach_evidence(uuid,uuid,uuid,uuid,text,text,text,text,text,text,integer,integer,text,text,text,text,text,text,uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.document_intake_remove_evidence(uuid,uuid,uuid,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.document_intake_attach_evidence(uuid,uuid,uuid,uuid,text,text,text,text,text,text,integer,integer,text,text,text,text,text,text,uuid,text,uuid) to service_role;
grant execute on function public.document_intake_remove_evidence(uuid,uuid,uuid,uuid,text,text,uuid) to service_role;

commit;

-- Rollback: stop intake traffic, retain all originals/audit records, restore the
-- Prompt 8 attach function signature and bucket MIME list, then drop only the
-- remove RPC and action-scope constraint after confirming no `remove` keys exist.
