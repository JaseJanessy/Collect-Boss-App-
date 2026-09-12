-- Prompt 10 / Phase D: screenshot and bank-in receipt intake.
-- Reviewable proposal only. Apply after 20260901_pdf_transaction_file_intake.sql.
-- No OCR, AI classification, transaction creation, authenticity decision, or perceptual auto-match.

begin;

alter table public.evidence_files
  add column if not exists evidence_source text,
  add column if not exists quality_warnings text[] not null default '{}',
  add column if not exists derivative_transform jsonb;

alter table public.evidence_files
  drop constraint if exists evidence_files_evidence_source_check,
  add constraint evidence_files_evidence_source_check check (
    intake_id is null or evidence_source in ('pdf','screenshot','bank_in_receipt','other_image')
  );

update storage.buckets
set public=false,
    file_size_limit=15728640,
    allowed_mime_types=array['application/pdf','image/png','image/jpeg','image/heic','image/heif']
where id='transaction-evidence';

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
    or new.image_width is distinct from old.image_width or new.image_height is distinct from old.image_height
    or new.evidence_source is distinct from old.evidence_source or new.quality_warnings is distinct from old.quality_warnings
    or new.derivative_transform is distinct from old.derivative_transform
    or new.is_original is distinct from old.is_original
    or new.evidence_version is distinct from old.evidence_version
    or new.parent_evidence_id is distinct from old.parent_evidence_id
    or new.supersedes_evidence_id is distinct from old.supersedes_evidence_id
  ) then raise exception 'P8_ORIGINAL_IMMUTABLE'; end if;
  return new;
end; $$;

drop function if exists public.document_intake_attach_evidence(
  uuid,uuid,uuid,uuid,text,text,text,text,text,text,integer,integer,text,text,text,text,text,text,uuid,text,uuid
);
create or replace function public.document_intake_attach_evidence(
  p_business_id uuid,p_intake_id uuid,p_actor_id uuid,p_evidence_id uuid,
  p_original_filename text,p_generated_storage_name text,p_storage_bucket text,p_object_path text,
  p_declared_mime_type text,p_magic_mime_type text,p_file_size_bytes integer,p_page_count integer,
  p_image_width integer,p_image_height integer,p_sha256 text,p_document_kind text,p_evidence_source text,
  p_quality_warnings text[],p_preview_object_path text,p_preview_generated_name text,p_preview_size_bytes integer,
  p_preview_width integer,p_preview_height integer,p_preview_sha256 text,p_upload_source text,p_action_scope text,
  p_derivative_transform jsonb,p_idempotency_key text,p_request_hash text,p_supersedes_evidence_id uuid,p_scan_provider text,p_correlation_id uuid
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
  if p_storage_bucket<>'transaction-evidence'
    or p_object_path<>(p_business_id::text||'/'||p_intake_id::text||'/'||p_evidence_id::text||'/'||p_generated_storage_name)
    then raise exception 'P8_INVALID_STORAGE_PATH'; end if;
  if p_sha256 !~ '^[0-9a-f]{64}$' or p_file_size_bytes<=0 then raise exception 'P8_INVALID_FILE_METADATA'; end if;
  if p_evidence_source='pdf' then
    if p_magic_mime_type<>'application/pdf' or p_declared_mime_type<>'application/pdf'
      or p_generated_storage_name<>'original.pdf' or p_page_count is not null and p_page_count<=0
      or p_image_width is not null or p_image_height is not null or p_preview_object_path is not null
      then raise exception 'P8_INVALID_FILE_METADATA'; end if;
  elsif p_evidence_source in ('screenshot','bank_in_receipt','other_image') then
    if p_magic_mime_type not in ('image/png','image/jpeg','image/heic')
      or p_declared_mime_type not in ('image/png','image/jpeg','image/heic','image/heif')
      or p_image_width is null or p_image_width<=0 or p_image_height is null or p_image_height<=0
      or p_page_count is not null or p_preview_generated_name<>'preview.jpg'
      or p_preview_object_path<>(p_business_id::text||'/'||p_intake_id::text||'/'||p_evidence_id::text||'/preview.jpg')
      or p_preview_size_bytes is null or p_preview_size_bytes<=0 or p_preview_width is null or p_preview_width<=0
      or p_preview_height is null or p_preview_height<=0 or p_preview_sha256 !~ '^[0-9a-f]{64}$'
      then raise exception 'P8_INVALID_FILE_METADATA'; end if;
  else raise exception 'P8_INVALID_FILE_METADATA'; end if;
  if p_supersedes_evidence_id is not null then
    select * into v_existing_file from public.evidence_files
      where id=p_supersedes_evidence_id and intake_id=p_intake_id and business_id=p_business_id
        and kind='original' and is_current and soft_deleted_at is null for update;
    if not found then raise exception 'P8_EVIDENCE_NOT_FOUND'; end if;
    update public.evidence_files set is_current=false where id=p_supersedes_evidence_id or parent_evidence_id=p_supersedes_evidence_id;
  end if;
  select id into v_duplicate_id from public.evidence_files
    where business_id=p_business_id and kind='original' and content_sha256=p_sha256
      and archived_at is null and soft_deleted_at is null order by uploaded_at,id limit 1;
  select coalesce(max(evidence_version),0)+1 into v_version from public.evidence_files
    where intake_id=p_intake_id and kind='original';
  insert into public.evidence_files(
    id,case_id,business_id,intake_id,file_name,file_type,file_url,file_size_bytes,page_count,image_width,image_height,
    evidence_type,evidence_source,quality_warnings,object_path,retention_until,content_sha256,kind,generated_storage_name,
    storage_bucket,declared_mime_type,magic_mime_type,upload_source,is_immutable,is_original,evidence_version,is_current,
    supersedes_evidence_id,scan_provider,scan_status,processing_status,processing_version,duplicate_match_status,
    duplicate_of_evidence_id,idempotency_scope,idempotency_key,request_hash
  ) values(
    p_evidence_id,null,p_business_id,p_intake_id,left(p_original_filename,255),upper(regexp_replace(p_generated_storage_name,'^.*\.','','g')),
    null,p_file_size_bytes,p_page_count,p_image_width,p_image_height,p_document_kind,p_evidence_source,coalesce(p_quality_warnings,'{}'),
    p_object_path,v_intake.retention_until,p_sha256,'original',p_generated_storage_name,p_storage_bucket,p_declared_mime_type,
    p_magic_mime_type,p_upload_source,true,true,v_version,true,p_supersedes_evidence_id,p_scan_provider,'pending',
    case when cardinality(coalesce(p_quality_warnings,'{}'))>0 then 'needs_review' else 'completed' end,1,
    case when v_duplicate_id is null then 'none' else 'exact_hash_warning' end,v_duplicate_id,p_action_scope,p_idempotency_key,p_request_hash
  ) returning * into v_file;
  if p_preview_object_path is not null then
    insert into public.evidence_files(
      case_id,business_id,intake_id,file_name,file_type,file_size_bytes,evidence_type,evidence_source,quality_warnings,
      object_path,retention_until,content_sha256,kind,generated_storage_name,storage_bucket,declared_mime_type,magic_mime_type,
      upload_source,is_immutable,is_original,evidence_version,is_current,parent_evidence_id,scan_provider,scan_status,
      processing_status,processing_version,duplicate_match_status,image_width,image_height,derivative_transform
    ) values(
      null,p_business_id,p_intake_id,'Safe image preview','JPG',p_preview_size_bytes,p_document_kind,p_evidence_source,
      coalesce(p_quality_warnings,'{}'),p_preview_object_path,v_intake.retention_until,p_preview_sha256,'derived',
      p_preview_generated_name,p_storage_bucket,'image/jpeg','image/jpeg','server_derivative',true,false,v_version,true,
      p_evidence_id,'internal','clean','completed',1,'none',p_preview_width,p_preview_height,p_derivative_transform
    );
  end if;
  v_old_status:=v_intake.status;
  update public.document_intakes set status='uploaded',version=version+1,updated_at=now(),last_error_code=null
    where id=p_intake_id returning * into v_intake;
  insert into public.document_intake_idempotency_keys(business_id,action_scope,idempotency_key,request_hash,actor_id,resource_type,resource_id,response_status)
  values(p_business_id,p_action_scope,p_idempotency_key,p_request_hash,p_actor_id,'evidence_file',v_file.id,201);
  insert into public.document_intake_events(intake_id,business_id,from_status,to_status,intake_version,actor_id,actor_role,action,metadata,correlation_id,idempotency_key)
  values(p_intake_id,p_business_id,v_old_status,'uploaded',v_intake.version,p_actor_id,v_role,
    case when p_action_scope='replace' then 'document_evidence.replaced' else 'document_evidence.uploaded' end,
    jsonb_build_object('evidence_id',v_file.id,'evidence_version',v_version,'evidence_source',p_evidence_source,
      'duplicate_warning',v_duplicate_id is not null,'quality_warnings',coalesce(p_quality_warnings,'{}'),'scan_status','pending'),
    p_correlation_id,p_idempotency_key);
  insert into public.audit_logs(business_id,action,actor_type,actor_id,actor_role,entity_type,entity_id,correlation_id,idempotency_key,metadata)
  values(p_business_id,case when p_action_scope='replace' then 'document_evidence.replaced' else 'document_evidence.uploaded' end,
    'staff',p_actor_id,v_role,'evidence_file',v_file.id::text,p_correlation_id,p_idempotency_key,
    jsonb_build_object('intake_id',p_intake_id,'evidence_version',v_version,'document_kind',p_document_kind,
      'evidence_source',p_evidence_source,'bytes',p_file_size_bytes,'duplicate_warning',v_duplicate_id is not null,
      'quality_warnings',coalesce(p_quality_warnings,'{}'),'scan_status','pending'));
  return v_file;
end; $$;

revoke all on function public.document_intake_attach_evidence(
  uuid,uuid,uuid,uuid,text,text,text,text,text,text,integer,integer,integer,integer,text,text,text,text[],text,text,integer,
  integer,integer,text,text,text,jsonb,text,text,uuid,text,uuid
) from public,anon,authenticated;
grant execute on function public.document_intake_attach_evidence(
  uuid,uuid,uuid,uuid,text,text,text,text,text,text,integer,integer,integer,integer,text,text,text,text[],text,text,integer,
  integer,integer,text,text,text,jsonb,text,text,uuid,text,uuid
) to service_role;

commit;

-- Rollback must retain original and derivative evidence objects and audit rows.
-- Restore the Prompt 9 attach function only after application writes are stopped.
