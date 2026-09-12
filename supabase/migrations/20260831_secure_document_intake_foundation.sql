-- Prompt 8: secure document ingestion, draft, storage and audit foundation.
-- Local proposal only. Review and apply after 20260830_mobile_companion_foundation.sql.
-- No OCR, classification, debtor matching, case creation or payment creation is
-- performed here. Originals remain private and immutable.

begin;

alter table public.business_role_settings
  add column if not exists manager_can_submit_document_intakes boolean not null default false;

create table if not exists public.document_intakes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  assigned_to uuid references auth.users(id) on delete set null,
  status text not null default 'draft' check (status in (
    'draft','awaiting_upload','uploaded','processing','needs_review',
    'ready_to_submit','submitted','failed','cancelled'
  )),
  source text not null check (source in ('web_upload','mobile_upload','api','email_import')),
  intended_workflow text not null check (intended_workflow in (
    'transaction_evidence','payment_evidence','general_document'
  )),
  currency_hint char(3) check (currency_hint is null or currency_hint ~ '^[A-Z]{3}$'),
  version integer not null default 1 check (version > 0),
  submitted_at timestamptz,
  cancelled_at timestamptz,
  deleted_at timestamptz,
  retention_until date,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'submitted') = (submitted_at is not null)),
  check ((status = 'cancelled') = (cancelled_at is not null))
);
create index if not exists document_intakes_business_status_idx
  on public.document_intakes(business_id,status,updated_at desc);
create index if not exists document_intakes_assigned_idx
  on public.document_intakes(business_id,assigned_to,updated_at desc)
  where assigned_to is not null and deleted_at is null;

create table if not exists public.document_intake_idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  action_scope text not null check (action_scope in ('create','upload','replace','remove','confirm','finalise','cancel')),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 128),
  request_hash char(64) not null check (request_hash ~ '^[0-9a-f]{64}$'),
  actor_id uuid not null references auth.users(id) on delete restrict,
  resource_type text,
  resource_id uuid,
  response_status integer,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  unique (business_id,action_scope,idempotency_key)
);
create index if not exists document_intake_idempotency_expiry_idx
  on public.document_intake_idempotency_keys(expires_at);

create table if not exists public.document_intake_events (
  id uuid primary key default gen_random_uuid(),
  intake_id uuid not null references public.document_intakes(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  from_status text,
  to_status text not null,
  intake_version integer not null check (intake_version > 0),
  actor_id uuid references auth.users(id) on delete set null,
  actor_role text check (actor_role is null or actor_role in ('owner','admin','manager','staff','viewer')),
  action text not null,
  error_code text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  correlation_id uuid,
  idempotency_key text,
  created_at timestamptz not null default now()
);
create index if not exists document_intake_events_intake_idx
  on public.document_intake_events(intake_id,created_at,id);

alter table public.evidence_files
  alter column case_id drop not null,
  add column if not exists business_id uuid references public.businesses(id) on delete restrict,
  add column if not exists intake_id uuid references public.document_intakes(id) on delete restrict,
  add column if not exists kind text not null default 'original' check (kind in ('original','thumbnail','page_image','derived')),
  add column if not exists generated_storage_name text,
  add column if not exists storage_bucket text,
  add column if not exists declared_mime_type text,
  add column if not exists magic_mime_type text,
  add column if not exists upload_source text,
  add column if not exists is_immutable boolean not null default true,
  add column if not exists is_original boolean not null default true,
  add column if not exists evidence_version integer not null default 1 check (evidence_version > 0),
  add column if not exists is_current boolean not null default true,
  add column if not exists parent_evidence_id uuid references public.evidence_files(id) on delete restrict,
  add column if not exists supersedes_evidence_id uuid references public.evidence_files(id) on delete restrict,
  add column if not exists page_count integer check (page_count is null or page_count > 0),
  add column if not exists image_width integer check (image_width is null or image_width > 0),
  add column if not exists image_height integer check (image_height is null or image_height > 0),
  add column if not exists scan_provider text,
  add column if not exists scan_status text not null default 'pending' check (scan_status in ('pending','clean','suspected','quarantined','failed')),
  add column if not exists scan_completed_at timestamptz,
  add column if not exists processing_status text not null default 'queued' check (processing_status in ('queued','processing','needs_review','completed','failed','cancelled')),
  add column if not exists processing_version integer not null default 1 check (processing_version > 0),
  add column if not exists normalized_reference text,
  add column if not exists external_transaction_id text,
  add column if not exists duplicate_match_status text not null default 'unchecked' check (duplicate_match_status in ('unchecked','none','exact_hash_warning','reviewed')),
  add column if not exists duplicate_of_evidence_id uuid references public.evidence_files(id) on delete restrict,
  add column if not exists duplicate_reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists duplicate_review_outcome text,
  add column if not exists idempotency_scope text,
  add column if not exists idempotency_key text,
  add column if not exists request_hash char(64),
  add column if not exists soft_deleted_at timestamptz;

update public.evidence_files evidence
set business_id = cases.business_id,
    storage_bucket = coalesce(evidence.storage_bucket,'evidence-files'),
    generated_storage_name = coalesce(evidence.generated_storage_name,
      nullif(regexp_replace(coalesce(evidence.object_path,evidence.file_url,''), '^.*/', ''),'')),
    declared_mime_type = coalesce(evidence.declared_mime_type,
      case upper(evidence.file_type) when 'PDF' then 'application/pdf' when 'PNG' then 'image/png'
        when 'JPG' then 'image/jpeg' when 'JPEG' then 'image/jpeg' else 'application/octet-stream' end),
    magic_mime_type = coalesce(evidence.magic_mime_type,
      case upper(evidence.file_type) when 'PDF' then 'application/pdf' when 'PNG' then 'image/png'
        when 'JPG' then 'image/jpeg' when 'JPEG' then 'image/jpeg' else 'application/octet-stream' end),
    upload_source = coalesce(evidence.upload_source,'legacy_case_evidence'),
    scan_status = case when evidence.scan_status = 'pending' then 'clean' else evidence.scan_status end,
    processing_status = case when evidence.processing_status = 'queued' then 'completed' else evidence.processing_status end
from public.cases cases
where evidence.case_id = cases.id and evidence.business_id is null;

alter table public.evidence_files
  alter column business_id set not null,
  drop constraint if exists evidence_files_parent_required_check,
  add constraint evidence_files_parent_required_check check (case_id is not null or intake_id is not null),
  drop constraint if exists evidence_files_intake_original_metadata_check,
  add constraint evidence_files_intake_original_metadata_check check (
    intake_id is null or (
      object_path is not null and storage_bucket is not null and generated_storage_name is not null
      and declared_mime_type is not null and magic_mime_type is not null
      and file_size_bytes is not null and file_size_bytes > 0 and content_sha256 is not null
      and content_sha256 ~ '^[0-9a-f]{64}$' and upload_source is not null
    )
  ),
  drop constraint if exists evidence_files_derivative_parent_check,
  add constraint evidence_files_derivative_parent_check check (
    (kind = 'original' and is_original and parent_evidence_id is null)
    or (kind <> 'original' and not is_original and parent_evidence_id is not null)
  );

create unique index if not exists evidence_files_intake_original_version_uidx
  on public.evidence_files(intake_id,evidence_version)
  where intake_id is not null and kind='original';
create unique index if not exists evidence_files_intake_idempotency_uidx
  on public.evidence_files(business_id,idempotency_scope,idempotency_key)
  where intake_id is not null and idempotency_scope is not null and idempotency_key is not null;
create index if not exists evidence_files_business_hash_idx
  on public.evidence_files(business_id,content_sha256)
  where content_sha256 is not null and archived_at is null and soft_deleted_at is null;
create index if not exists evidence_files_intake_current_idx
  on public.evidence_files(intake_id,evidence_version desc)
  where intake_id is not null and is_current and soft_deleted_at is null;

create table if not exists public.document_intake_extractions (
  id uuid primary key default gen_random_uuid(),
  intake_id uuid not null references public.document_intakes(id) on delete restrict,
  evidence_id uuid not null references public.evidence_files(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  provider text not null,
  parser_version text not null,
  status text not null default 'queued' check (status in ('queued','processing','completed','failed','cancelled')),
  raw_text_object_path text,
  protected_raw_text text,
  document_classification text,
  structured_result jsonb not null default '{}'::jsonb check (jsonb_typeof(structured_result) = 'object'),
  confidence numeric(5,4) check (confidence is null or confidence between 0 and 1),
  warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings) = 'array'),
  started_at timestamptz,
  completed_at timestamptz,
  error_code text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz,
  locked_at timestamptz,
  locked_by text,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (evidence_id,provider,parser_version),
  unique (business_id,idempotency_key),
  check (raw_text_object_path is null or protected_raw_text is null)
);
create index if not exists document_intake_extractions_retry_idx
  on public.document_intake_extractions(status,next_attempt_at,created_at)
  where status in ('queued','failed');

create table if not exists public.document_intake_confirmations (
  id uuid primary key default gen_random_uuid(),
  intake_id uuid not null references public.document_intakes(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  confirmation_version integer not null check (confirmation_version > 0),
  intake_version integer not null check (intake_version > 0),
  confirmed_document_kind text not null check (confirmed_document_kind in (
    'invoice','receipt','payment_proof','bank_statement','contract','purchase_order',
    'delivery_order','credit_note','communication_evidence','other'
  )),
  chosen_amount_minor bigint check (chosen_amount_minor is null or chosen_amount_minor >= 0),
  currency char(3) check (currency is null or currency ~ '^[A-Z]{3}$'),
  document_datetime timestamptz,
  reference text,
  bank text,
  sender text,
  recipient text,
  transaction_nature text,
  notes text,
  confirmed_by uuid not null references auth.users(id) on delete restrict,
  confirmed_at timestamptz not null default now(),
  idempotency_key text not null,
  request_hash char(64) not null check (request_hash ~ '^[0-9a-f]{64}$'),
  unique (intake_id,confirmation_version),
  unique (business_id,idempotency_key)
);

alter table public.audit_logs
  add column if not exists correlation_id uuid,
  add column if not exists idempotency_key text;
create index if not exists audit_logs_correlation_idx
  on public.audit_logs(business_id,correlation_id,created_at) where correlation_id is not null;

create or replace function public.document_intake_evidence_scope()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_business_id uuid;
begin
  if new.intake_id is not null then
    select business_id into v_business_id from public.document_intakes where id=new.intake_id;
  elsif new.case_id is not null then
    select business_id into v_business_id from public.cases where id=new.case_id;
  end if;
  if v_business_id is null then raise exception 'P8_INVALID_EVIDENCE_PARENT'; end if;
  if new.business_id is not null and new.business_id <> v_business_id then
    raise exception 'P8_TENANT_SCOPE_MISMATCH';
  end if;
  new.business_id := v_business_id;
  return new;
end; $$;
drop trigger if exists document_intake_evidence_scope_guard on public.evidence_files;
create trigger document_intake_evidence_scope_guard
before insert or update of case_id,intake_id,business_id on public.evidence_files
for each row execute function public.document_intake_evidence_scope();

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
drop trigger if exists document_intake_original_immutable_guard on public.evidence_files;
create trigger document_intake_original_immutable_guard
before update on public.evidence_files for each row
execute function public.document_intake_original_immutable();

create or replace function public.document_intake_no_hard_delete()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if old.intake_id is not null then raise exception 'P8_EVIDENCE_RETENTION_REQUIRED'; end if;
  return old;
end; $$;
drop trigger if exists document_intake_no_hard_delete_guard on public.evidence_files;
create trigger document_intake_no_hard_delete_guard
before delete on public.evidence_files for each row
execute function public.document_intake_no_hard_delete();

create or replace function public.document_intake_append_only()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin raise exception 'P8_APPEND_ONLY'; end; $$;
drop trigger if exists document_intake_events_append_only_guard on public.document_intake_events;
create trigger document_intake_events_append_only_guard before update or delete on public.document_intake_events
for each row execute function public.document_intake_append_only();
drop trigger if exists document_intake_confirmations_append_only_guard on public.document_intake_confirmations;
create trigger document_intake_confirmations_append_only_guard before update or delete on public.document_intake_confirmations
for each row execute function public.document_intake_append_only();
drop trigger if exists document_intake_idempotency_append_only_guard on public.document_intake_idempotency_keys;
create trigger document_intake_idempotency_append_only_guard before update or delete on public.document_intake_idempotency_keys
for each row execute function public.document_intake_append_only();

create or replace function public.document_intake_actor_role(p_business_id uuid,p_actor_id uuid)
returns text language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(
    (select 'owner' from public.businesses where id=p_business_id and owner_id=p_actor_id),
    (select role from public.business_memberships
      where business_id=p_business_id and user_id=p_actor_id and status='active' limit 1)
  );
$$;

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

create or replace function public.document_intake_create(
  p_business_id uuid,p_actor_id uuid,p_source text,p_intended_workflow text,
  p_currency_hint text,p_idempotency_key text,p_request_hash text,p_correlation_id uuid
) returns public.document_intakes language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_existing public.document_intake_idempotency_keys; v_intake public.document_intakes;
begin
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id);
  if v_role is null then raise exception 'P8_MEMBERSHIP_REQUIRED'; end if;
  if v_role='viewer' then raise exception 'P8_PERMISSION_DENIED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':create:'||p_idempotency_key,0));
  select * into v_existing from public.document_intake_idempotency_keys
    where business_id=p_business_id and action_scope='create' and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_hash<>p_request_hash then raise exception 'P8_IDEMPOTENCY_CONFLICT'; end if;
    select * into v_intake from public.document_intakes where id=v_existing.resource_id and business_id=p_business_id;
    return v_intake;
  end if;
  insert into public.document_intakes(business_id,created_by,status,source,intended_workflow,currency_hint,retention_until)
  values(p_business_id,p_actor_id,'draft',p_source,p_intended_workflow,nullif(upper(p_currency_hint),''),(current_date+interval '7 years')::date)
  returning * into v_intake;
  insert into public.document_intake_idempotency_keys(business_id,action_scope,idempotency_key,request_hash,actor_id,resource_type,resource_id,response_status)
  values(p_business_id,'create',p_idempotency_key,p_request_hash,p_actor_id,'document_intake',v_intake.id,201);
  insert into public.document_intake_events(intake_id,business_id,to_status,intake_version,actor_id,actor_role,action,correlation_id,idempotency_key)
  values(v_intake.id,p_business_id,'draft',v_intake.version,p_actor_id,v_role,'document_intake.created',p_correlation_id,p_idempotency_key);
  insert into public.audit_logs(business_id,action,actor_type,actor_id,actor_role,entity_type,entity_id,correlation_id,idempotency_key,metadata)
  values(p_business_id,'document_intake.created','staff',p_actor_id,v_role,'document_intake',v_intake.id::text,p_correlation_id,p_idempotency_key,
    jsonb_build_object('source',p_source,'intended_workflow',p_intended_workflow));
  return v_intake;
end; $$;

create or replace function public.document_intake_transition(
  p_business_id uuid,p_intake_id uuid,p_actor_id uuid,p_to_status text,
  p_action text,p_error_code text default null,p_correlation_id uuid default null
) returns public.document_intakes language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_old public.document_intakes; v_new public.document_intakes;
begin
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id);
  if v_role is null or v_role='viewer' then raise exception 'P8_PERMISSION_DENIED'; end if;
  if p_to_status='submitted' then raise exception 'P8_USE_FINALISE'; end if;
  select * into v_old from public.document_intakes where id=p_intake_id and business_id=p_business_id and deleted_at is null for update;
  if not found then raise exception 'P8_INTAKE_NOT_FOUND'; end if;
  if not public.document_intake_transition_allowed(v_old.status,p_to_status) then raise exception 'P8_INVALID_STATUS_TRANSITION'; end if;
  if v_old.status=p_to_status then return v_old; end if;
  update public.document_intakes set status=p_to_status,version=version+1,updated_at=now(),last_error_code=p_error_code,
    submitted_at=case when p_to_status='submitted' then now() else submitted_at end,
    cancelled_at=case when p_to_status='cancelled' then now() else cancelled_at end
  where id=p_intake_id returning * into v_new;
  insert into public.document_intake_events(intake_id,business_id,from_status,to_status,intake_version,actor_id,actor_role,action,error_code,correlation_id)
  values(p_intake_id,p_business_id,v_old.status,p_to_status,v_new.version,p_actor_id,v_role,p_action,p_error_code,p_correlation_id);
  insert into public.audit_logs(business_id,action,actor_type,actor_id,actor_role,entity_type,entity_id,correlation_id,metadata)
  values(p_business_id,p_action,'staff',p_actor_id,v_role,'document_intake',p_intake_id::text,p_correlation_id,
    jsonb_build_object('from_status',v_old.status,'to_status',p_to_status,'error_code',p_error_code));
  return v_new;
end; $$;

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
  if p_sha256 !~ '^[0-9a-f]{64}$' or p_file_size_bytes<=0 or p_page_count is not null and p_page_count<=0
    then raise exception 'P8_INVALID_FILE_METADATA'; end if;
  if p_supersedes_evidence_id is not null then
    select * into v_existing_file from public.evidence_files
      where id=p_supersedes_evidence_id and intake_id=p_intake_id and business_id=p_business_id
        and kind='original' and soft_deleted_at is null for update;
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
    p_evidence_id,null,p_business_id,p_intake_id,left(p_original_filename,255),upper(regexp_replace(p_generated_storage_name,'^.*\.','','g')),
    null,p_file_size_bytes,p_page_count,p_document_kind,p_object_path,v_intake.retention_until,p_sha256,'original',p_generated_storage_name,
    p_storage_bucket,p_declared_mime_type,p_magic_mime_type,p_upload_source,true,true,v_version,true,p_supersedes_evidence_id,
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
    jsonb_build_object('evidence_id',v_file.id,'evidence_version',v_version,'duplicate_warning',v_duplicate_id is not null,'scan_status','pending'),
    p_correlation_id,p_idempotency_key);
  insert into public.audit_logs(business_id,action,actor_type,actor_id,actor_role,entity_type,entity_id,correlation_id,idempotency_key,metadata)
  values(p_business_id,case when p_action_scope='replace' then 'document_evidence.replaced' else 'document_evidence.uploaded' end,
    'staff',p_actor_id,v_role,'evidence_file',v_file.id::text,p_correlation_id,p_idempotency_key,
    jsonb_build_object('intake_id',p_intake_id,'evidence_version',v_version,'document_kind',p_document_kind,
      'bytes',p_file_size_bytes,'duplicate_warning',v_duplicate_id is not null,'scan_status','pending'));
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

create or replace function public.document_intake_confirm(
  p_business_id uuid,p_intake_id uuid,p_actor_id uuid,p_document_kind text,p_amount_minor bigint,
  p_currency text,p_document_datetime timestamptz,p_reference text,p_bank text,p_sender text,p_recipient text,
  p_transaction_nature text,p_notes text,p_idempotency_key text,p_request_hash text,p_correlation_id uuid
) returns public.document_intake_confirmations language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_intake public.document_intakes; v_existing public.document_intake_confirmations;
  v_confirmation public.document_intake_confirmations; v_version integer; v_old_status text;
begin
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id);
  if v_role is null or v_role='viewer' then raise exception 'P8_PERMISSION_DENIED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':confirm:'||p_idempotency_key,0));
  select * into v_existing from public.document_intake_confirmations
    where business_id=p_business_id and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_hash<>p_request_hash then raise exception 'P8_IDEMPOTENCY_CONFLICT'; end if;
    return v_existing;
  end if;
  select * into v_intake from public.document_intakes where id=p_intake_id and business_id=p_business_id and deleted_at is null for update;
  if not found then raise exception 'P8_INTAKE_NOT_FOUND'; end if;
  if v_intake.status not in ('uploaded','needs_review','ready_to_submit') then raise exception 'P8_CONFIRMATION_NOT_ALLOWED'; end if;
  if not exists(select 1 from public.evidence_files where intake_id=p_intake_id and is_original and is_current and soft_deleted_at is null)
    then raise exception 'P8_EVIDENCE_REQUIRED'; end if;
  select coalesce(max(confirmation_version),0)+1 into v_version from public.document_intake_confirmations where intake_id=p_intake_id;
  v_old_status:=v_intake.status;
  if v_intake.status<>'ready_to_submit' then
    update public.document_intakes set status='ready_to_submit',version=version+1,updated_at=now()
      where id=p_intake_id returning * into v_intake;
  end if;
  -- Bind the append-only confirmation to the resulting state version so
  -- finalise rejects it after any later upload or replacement.
  insert into public.document_intake_confirmations(
    intake_id,business_id,confirmation_version,intake_version,confirmed_document_kind,chosen_amount_minor,currency,
    document_datetime,reference,bank,sender,recipient,transaction_nature,notes,confirmed_by,idempotency_key,request_hash
  ) values(
    p_intake_id,p_business_id,v_version,v_intake.version,p_document_kind,p_amount_minor,nullif(upper(p_currency),''),
    p_document_datetime,nullif(btrim(p_reference),''),nullif(btrim(p_bank),''),nullif(btrim(p_sender),''),
    nullif(btrim(p_recipient),''),nullif(btrim(p_transaction_nature),''),nullif(btrim(p_notes),''),p_actor_id,p_idempotency_key,p_request_hash
  ) returning * into v_confirmation;
  insert into public.document_intake_idempotency_keys(business_id,action_scope,idempotency_key,request_hash,actor_id,resource_type,resource_id,response_status)
  values(p_business_id,'confirm',p_idempotency_key,p_request_hash,p_actor_id,'document_intake_confirmation',v_confirmation.id,200);
  insert into public.document_intake_events(intake_id,business_id,from_status,to_status,intake_version,actor_id,actor_role,action,correlation_id,idempotency_key)
  values(p_intake_id,p_business_id,v_old_status,v_intake.status,v_intake.version,p_actor_id,v_role,'document_intake.confirmed',p_correlation_id,p_idempotency_key);
  insert into public.audit_logs(business_id,action,actor_type,actor_id,actor_role,entity_type,entity_id,correlation_id,idempotency_key,metadata)
  values(p_business_id,'document_intake.confirmed','staff',p_actor_id,v_role,'document_intake',p_intake_id::text,p_correlation_id,p_idempotency_key,
    jsonb_build_object('confirmation_version',v_version,'document_kind',p_document_kind,'has_amount',p_amount_minor is not null));
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
  if not found or v_confirmation.intake_version<>v_intake.version then raise exception 'P8_CONFIRMATION_REQUIRED'; end if;
  if not exists(select 1 from public.evidence_files where intake_id=p_intake_id and is_original and is_current and soft_deleted_at is null)
    then raise exception 'P8_EVIDENCE_REQUIRED'; end if;
  if exists(select 1 from public.evidence_files where intake_id=p_intake_id and is_original and is_current
    and soft_deleted_at is null and scan_status<>'clean') then raise exception 'P8_EVIDENCE_SCAN_PENDING'; end if;
  update public.document_intakes set status='submitted',version=version+1,submitted_at=now(),updated_at=now()
    where id=p_intake_id returning * into v_new;
  insert into public.document_intake_idempotency_keys(business_id,action_scope,idempotency_key,request_hash,actor_id,resource_type,resource_id,response_status)
  values(p_business_id,'finalise',p_idempotency_key,p_request_hash,p_actor_id,'document_intake',p_intake_id,200);
  insert into public.document_intake_events(intake_id,business_id,from_status,to_status,intake_version,actor_id,actor_role,action,correlation_id,idempotency_key)
  values(p_intake_id,p_business_id,v_intake.status,'submitted',v_new.version,p_actor_id,v_role,'document_intake.submitted',p_correlation_id,p_idempotency_key);
  insert into public.audit_logs(business_id,action,actor_type,actor_id,actor_role,entity_type,entity_id,correlation_id,idempotency_key,metadata)
  values(p_business_id,'document_intake.submitted','staff',p_actor_id,v_role,'document_intake',p_intake_id::text,p_correlation_id,p_idempotency_key,
    jsonb_build_object('intake_version',v_new.version,'confirmation_version',v_confirmation.confirmation_version));
  return v_new;
end; $$;

create or replace function public.document_intake_cancel(
  p_business_id uuid,p_intake_id uuid,p_actor_id uuid,p_idempotency_key text,p_request_hash text,p_correlation_id uuid
) returns public.document_intakes language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_intake public.document_intakes; v_existing public.document_intake_idempotency_keys; v_new public.document_intakes;
begin
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id);
  if v_role is null or v_role='viewer' then raise exception 'P8_PERMISSION_DENIED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':cancel:'||p_idempotency_key,0));
  select * into v_existing from public.document_intake_idempotency_keys
    where business_id=p_business_id and action_scope='cancel' and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_hash<>p_request_hash then raise exception 'P8_IDEMPOTENCY_CONFLICT'; end if;
    select * into v_new from public.document_intakes where id=v_existing.resource_id and business_id=p_business_id;
    return v_new;
  end if;
  select * into v_intake from public.document_intakes where id=p_intake_id and business_id=p_business_id for update;
  if not found then raise exception 'P8_INTAKE_NOT_FOUND'; end if;
  if v_intake.status='submitted' then raise exception 'P8_SUBMITTED_INTAKE_IMMUTABLE'; end if;
  if v_intake.status='cancelled' then return v_intake; end if;
  if not public.document_intake_transition_allowed(v_intake.status,'cancelled') then raise exception 'P8_INVALID_STATUS_TRANSITION'; end if;
  update public.document_intakes set status='cancelled',version=version+1,cancelled_at=now(),deleted_at=now(),updated_at=now()
    where id=p_intake_id returning * into v_new;
  insert into public.document_intake_idempotency_keys(business_id,action_scope,idempotency_key,request_hash,actor_id,resource_type,resource_id,response_status)
  values(p_business_id,'cancel',p_idempotency_key,p_request_hash,p_actor_id,'document_intake',p_intake_id,200);
  insert into public.document_intake_events(intake_id,business_id,from_status,to_status,intake_version,actor_id,actor_role,action,correlation_id,idempotency_key)
  values(p_intake_id,p_business_id,v_intake.status,'cancelled',v_new.version,p_actor_id,v_role,'document_intake.cancelled',p_correlation_id,p_idempotency_key);
  insert into public.audit_logs(business_id,action,actor_type,actor_id,actor_role,entity_type,entity_id,correlation_id,idempotency_key,metadata)
  values(p_business_id,'document_intake.cancelled','staff',p_actor_id,v_role,'document_intake',p_intake_id::text,p_correlation_id,p_idempotency_key,
    jsonb_build_object('retention_until',v_intake.retention_until));
  return v_new;
end; $$;

-- Replace the membership permission helper without introducing another role
-- system. Staff can draft/upload; manager submission remains tenant-configurable.
create or replace function public.has_business_permission(p_business_id uuid,p_permission text)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  with membership as (
    select coalesce(m.role,case when b.owner_id=auth.uid() then 'owner' end) role
    from public.businesses b
    left join public.business_memberships m on m.business_id=b.id and m.user_id=auth.uid() and m.status='active'
    where b.id=p_business_id and (b.owner_id=auth.uid() or m.id is not null)
    limit 1
  ), settings as (select * from public.business_role_settings where business_id=p_business_id)
  select coalesce((select case
    when role in ('owner','admin') then true
    when p_permission in ('case.read','document_intake.read') and role in ('manager','staff','viewer') then true
    when p_permission in ('case.manage','payment.approve') and role='manager' then true
    when p_permission='document_intake.create' and role in ('manager','staff') then true
    when p_permission='document_intake.submit' and role='manager'
      then coalesce((select manager_can_submit_document_intakes from settings),false)
    when p_permission='report.read' and role in ('manager','viewer') then true
    when p_permission in ('communication.manage','note.manage','promise.manage') and role in ('manager','staff') then true
    when p_permission='audit.read' and role='manager' then true
    when p_permission='settlement.approve' and role='manager'
      then coalesce((select manager_can_approve_settlements from settings),false)
    when p_permission='write_off.approve' and role='manager'
      then coalesce((select manager_can_approve_write_offs from settings),false)
    else false end from membership),false);
$$;

alter table public.document_intakes enable row level security;
alter table public.document_intake_idempotency_keys enable row level security;
alter table public.document_intake_events enable row level security;
alter table public.document_intake_extractions enable row level security;
alter table public.document_intake_confirmations enable row level security;

drop policy if exists document_intakes_role_read on public.document_intakes;
create policy document_intakes_role_read on public.document_intakes for select to authenticated
  using (public.has_business_permission(business_id,'document_intake.read'));
drop policy if exists document_intake_events_role_read on public.document_intake_events;
create policy document_intake_events_role_read on public.document_intake_events for select to authenticated
  using (public.has_business_permission(business_id,'document_intake.read'));
drop policy if exists document_intake_confirmations_role_read on public.document_intake_confirmations;
create policy document_intake_confirmations_role_read on public.document_intake_confirmations for select to authenticated
  using (public.has_business_permission(business_id,'document_intake.read'));

-- Idempotency records, extraction raw content and all writes are server-only.
-- Evidence metadata remains tenant-readable; intake evidence has no browser
-- write policy. Existing case evidence retains its role-scoped write behavior.
drop policy if exists "owners can manage own evidence" on public.evidence_files;
drop policy if exists "evidence: owner read" on public.evidence_files;
drop policy if exists "evidence: owner insert" on public.evidence_files;
drop policy if exists "evidence: owner update" on public.evidence_files;
drop policy if exists "evidence_files: owner read" on public.evidence_files;
drop policy if exists "evidence_files: owner insert" on public.evidence_files;
drop policy if exists "evidence_files: owner update" on public.evidence_files;
drop policy if exists "evidence_files: owner delete" on public.evidence_files;
drop policy if exists evidence_files_role_read on public.evidence_files;
drop policy if exists evidence_files_case_role_insert on public.evidence_files;
drop policy if exists evidence_files_case_role_update on public.evidence_files;
create policy evidence_files_role_read on public.evidence_files for select to authenticated
  using (public.has_business_permission(business_id,case when intake_id is null then 'case.read' else 'document_intake.read' end));
create policy evidence_files_case_role_insert on public.evidence_files for insert to authenticated
  with check (intake_id is null and case_id is not null and public.has_business_permission(business_id,'case.manage'));
create policy evidence_files_case_role_update on public.evidence_files for update to authenticated
  using (intake_id is null and case_id is not null and public.has_business_permission(business_id,'case.manage'))
  with check (intake_id is null and case_id is not null and public.has_business_permission(business_id,'case.manage'));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('transaction-evidence','transaction-evidence',false,10485760,array['application/pdf'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
-- There is intentionally no authenticated/anonymous storage.objects policy for
-- this bucket. Validated server routes write objects and issue 60-second signed
-- URLs only after tenant authorization and a clean malware-scan state.

revoke all on public.document_intakes,public.document_intake_idempotency_keys,
  public.document_intake_events,public.document_intake_extractions,
  public.document_intake_confirmations from anon;
grant select on public.document_intakes,public.document_intake_events,
  public.document_intake_confirmations to authenticated;
revoke all on public.document_intake_idempotency_keys,public.document_intake_extractions from authenticated;
grant all on public.document_intakes,public.document_intake_idempotency_keys,
  public.document_intake_events,public.document_intake_extractions,
  public.document_intake_confirmations to service_role;

revoke all on function public.document_intake_actor_role(uuid,uuid) from public,anon,authenticated;
revoke all on function public.document_intake_create(uuid,uuid,text,text,text,text,text,uuid) from public,anon,authenticated;
revoke all on function public.document_intake_transition(uuid,uuid,uuid,text,text,text,uuid) from public,anon,authenticated;
revoke all on function public.document_intake_attach_evidence(uuid,uuid,uuid,uuid,text,text,text,text,text,text,integer,integer,text,text,text,text,text,text,uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.document_intake_remove_evidence(uuid,uuid,uuid,uuid,text,text,uuid) from public,anon,authenticated;
revoke all on function public.document_intake_confirm(uuid,uuid,uuid,text,bigint,text,timestamptz,text,text,text,text,text,text,text,text,uuid) from public,anon,authenticated;
revoke all on function public.document_intake_finalise(uuid,uuid,uuid,text,text,uuid) from public,anon,authenticated;
revoke all on function public.document_intake_cancel(uuid,uuid,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.document_intake_actor_role(uuid,uuid) to service_role;
grant execute on function public.document_intake_create(uuid,uuid,text,text,text,text,text,uuid) to service_role;
grant execute on function public.document_intake_transition(uuid,uuid,uuid,text,text,text,uuid) to service_role;
grant execute on function public.document_intake_attach_evidence(uuid,uuid,uuid,uuid,text,text,text,text,text,text,integer,integer,text,text,text,text,text,text,uuid,text,uuid) to service_role;
grant execute on function public.document_intake_remove_evidence(uuid,uuid,uuid,uuid,text,text,uuid) to service_role;
grant execute on function public.document_intake_confirm(uuid,uuid,uuid,text,bigint,text,timestamptz,text,text,text,text,text,text,text,text,uuid) to service_role;
grant execute on function public.document_intake_finalise(uuid,uuid,uuid,text,text,uuid) to service_role;
grant execute on function public.document_intake_cancel(uuid,uuid,uuid,text,text,uuid) to service_role;

commit;

-- Rollback deployment plan:
-- 1. Stop application writes and preserve/export audit, intake, confirmation and
--    evidence metadata required by retention policy.
-- 2. Drop the Prompt 8 policies/functions/triggers/indexes and new tables in
--    reverse dependency order.
-- 3. Drop intake-only evidence columns only after every intake object has been
--    retained or migrated; restore case_id NOT NULL only after proving no intake
--    rows remain. Never delete originals merely to roll application code back.
