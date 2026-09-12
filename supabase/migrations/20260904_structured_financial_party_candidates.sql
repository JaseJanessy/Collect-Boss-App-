-- Prompt 12 / Phase D: immutable structured financial and party candidates.
-- Apply after 20260903_document_extraction_intelligence.sql.
-- Candidates are unapproved observations only and never update business records.

begin;

alter table public.document_intake_extractions
  add column if not exists extraction_version integer,
  add column if not exists document_version integer;

with numbered as (
  select id,evidence_id,row_number() over(partition by evidence_id order by created_at,id)::integer as version
  from public.document_intake_extractions
)
update public.document_intake_extractions extraction set
  extraction_version=numbered.version,
  document_version=evidence.evidence_version
from numbered join public.evidence_files evidence on evidence.id=numbered.evidence_id
where extraction.id=numbered.id and (extraction.extraction_version is null or extraction.document_version is null);

alter table public.document_intake_extractions
  alter column extraction_version set not null,
  alter column document_version set not null,
  add constraint document_intake_extractions_version_positive check(extraction_version>0 and document_version>0);

alter table public.document_intake_extractions
  drop constraint if exists document_intake_extractions_evidence_id_provider_parser_version_key;
create unique index if not exists document_intake_extractions_evidence_version_uidx
  on public.document_intake_extractions(evidence_id,extraction_version);

create table if not exists public.document_extraction_candidates (
  id uuid primary key default gen_random_uuid(),
  extraction_id uuid not null references public.document_intake_extractions(id) on delete restrict,
  intake_id uuid not null references public.document_intakes(id) on delete restrict,
  evidence_id uuid not null references public.evidence_files(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  extraction_version integer not null check(extraction_version>0),
  document_version integer not null check(document_version>0),
  candidate_ordinal integer not null check(candidate_ordinal>=0),
  field_type text not null check(field_type in (
    'company_name','debtor_name','company_identifier','debtor_identifier','invoice_number',
    'issue_date','due_date','amount','tax','currency','bank_reference','transaction_date',
    'credit_note_value','contract_term','account_reference','line_item_amount','document_total'
  )),
  original_text text not null check(length(original_text) between 1 and 2000),
  normalized_value jsonb not null,
  confidence numeric(5,4) not null check(confidence between 0 and 1),
  extraction_method text not null check(extraction_method in ('pdf_text_layer','ocr')),
  provider text not null,
  provider_version text not null,
  parser_version text not null,
  source_page integer check(source_page is null or source_page>0),
  source_image_id text,
  source_bounding_box jsonb,
  source_text_span jsonb,
  source_snippet text not null check(length(source_snippet) between 1 and 4000),
  validation_flags text[] not null default '{}',
  sensitivity text not null default 'standard' check(sensitivity in ('standard','sensitive_identifier')),
  duplicate_group text,
  created_at timestamptz not null default now(),
  unique(extraction_id,candidate_ordinal),
  check(source_page is not null or source_image_id is not null or source_text_span is not null),
  check(source_bounding_box is null or jsonb_typeof(source_bounding_box)='object'),
  check(source_text_span is null or (
    jsonb_typeof(source_text_span)='object' and (source_text_span->>'start')::integer>=0
    and (source_text_span->>'end')::integer>(source_text_span->>'start')::integer
  )),
  check(validation_flags <@ array['IMPOSSIBLE_DATE','AMBIGUOUS_DATE','MALFORMED_CURRENCY',
    'DUPLICATE_INVOICE_IDENTIFIER','TOTAL_DOES_NOT_RECONCILE']::text[])
);
create index if not exists document_extraction_candidates_lookup_idx
  on public.document_extraction_candidates(business_id,intake_id,extraction_version desc,field_type);
create index if not exists document_extraction_candidates_invoice_idx
  on public.document_extraction_candidates(business_id,field_type,((normalized_value #>> '{}')))
  where field_type='invoice_number';

create or replace function public.document_extraction_candidates_immutable()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin raise exception 'P12_CANDIDATES_IMMUTABLE'; end; $$;
drop trigger if exists document_extraction_candidates_immutable on public.document_extraction_candidates;
create trigger document_extraction_candidates_immutable before update or delete on public.document_extraction_candidates
for each row execute function public.document_extraction_candidates_immutable();

create or replace function public.document_intake_claim_extraction(p_worker_id text,p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_extraction public.document_intake_extractions; v_evidence public.evidence_files; v_intake public.document_intakes;
  v_old_status text;
begin
  if nullif(trim(p_worker_id),'') is null then raise exception 'P11_INVALID_WORKER'; end if;
  select extraction.* into v_extraction from public.document_intake_extractions extraction
  join public.evidence_files evidence on evidence.id=extraction.evidence_id
  join public.document_intakes intake on intake.id=extraction.intake_id
  where extraction.status in ('queued','failed') and (extraction.next_attempt_at is null or extraction.next_attempt_at<=p_now)
    and evidence.business_id=extraction.business_id and evidence.intake_id=extraction.intake_id
    and evidence.evidence_version=extraction.document_version and evidence.kind='original' and evidence.is_current
    and evidence.soft_deleted_at is null and evidence.scan_status='clean'
    and evidence.processing_status not in ('cancelled','completed','needs_review')
    and intake.business_id=extraction.business_id and intake.deleted_at is null and intake.status not in ('submitted','cancelled')
  order by coalesce(extraction.next_attempt_at,extraction.created_at),extraction.created_at
  for update of extraction skip locked limit 1;
  if not found then return null; end if;
  select * into v_evidence from public.evidence_files where id=v_extraction.evidence_id for update;
  select * into v_intake from public.document_intakes where id=v_extraction.intake_id for update;
  update public.document_intake_extractions set status='processing',attempt_count=attempt_count+1,
    started_at=coalesce(started_at,p_now),completed_at=null,error_code=null,next_attempt_at=null,
    locked_at=p_now,locked_by=p_worker_id,updated_at=p_now where id=v_extraction.id returning * into v_extraction;
  update public.evidence_files set processing_status='processing',processing_version=processing_version+1 where id=v_evidence.id;
  if v_intake.status<>'processing' then
    v_old_status:=v_intake.status;
    update public.document_intakes set status='processing',version=version+1,updated_at=p_now,last_error_code=null
      where id=v_intake.id returning * into v_intake;
    insert into public.document_intake_events(intake_id,business_id,from_status,to_status,intake_version,actor_id,actor_role,action,metadata)
    values(v_intake.id,v_intake.business_id,v_old_status,'processing',v_intake.version,null,null,
      'document_extraction.processing_started',jsonb_build_object('extraction_id',v_extraction.id,'evidence_id',v_evidence.id,
        'extraction_version',v_extraction.extraction_version,'document_version',v_extraction.document_version,'attempt',v_extraction.attempt_count));
  end if;
  return jsonb_build_object('extraction_id',v_extraction.id,'intake_id',v_extraction.intake_id,'evidence_id',v_extraction.evidence_id,
    'business_id',v_extraction.business_id,'storage_bucket',v_evidence.storage_bucket,'object_path',v_evidence.object_path,
    'magic_mime_type',v_evidence.magic_mime_type,'file_name',v_evidence.file_name,'file_size_bytes',v_evidence.file_size_bytes,
    'page_count',v_evidence.page_count,'document_version',v_extraction.document_version,'attempt_count',v_extraction.attempt_count);
end; $$;

drop function if exists public.document_intake_complete_extraction(uuid,uuid,text,text,text,text,text,text,text,jsonb,jsonb,numeric,jsonb,boolean);
create or replace function public.document_intake_complete_extraction(
  p_business_id uuid,p_extraction_id uuid,p_worker_id text,p_provider text,p_provider_model text,
  p_provider_version text,p_parser_version text,p_extraction_method text,p_document_classification text,
  p_structured_result jsonb,p_protected_raw_result jsonb,p_candidates jsonb,p_confidence numeric,p_warnings jsonb,p_needs_review boolean
) returns public.document_intake_extractions language plpgsql security definer set search_path=public,pg_temp as $$
declare v_extraction public.document_intake_extractions; v_evidence public.evidence_files; v_intake public.document_intakes;
  v_old_status text; v_result_status text; v_candidate jsonb; v_ordinal integer:=0; v_flags text[]; v_duplicate text;
begin
  select * into v_extraction from public.document_intake_extractions where id=p_extraction_id and business_id=p_business_id for update;
  if not found then raise exception 'P11_EXTRACTION_NOT_FOUND'; end if;
  if v_extraction.status<>'processing' or v_extraction.locked_by is distinct from p_worker_id then raise exception 'P11_EXTRACTION_LEASE_MISMATCH'; end if;
  if nullif(trim(p_provider),'') is null or nullif(trim(p_provider_model),'') is null or nullif(trim(p_provider_version),'') is null
    or nullif(trim(p_parser_version),'') is null or p_extraction_method not in ('pdf_text_layer','ocr')
    or p_confidence is null or p_confidence<0 or p_confidence>1 or jsonb_typeof(p_structured_result)<>'object'
    or jsonb_typeof(p_protected_raw_result)<>'object' or jsonb_typeof(p_candidates)<>'array'
    or jsonb_array_length(p_candidates)>250 or jsonb_typeof(p_warnings)<>'array' then raise exception 'P11_INVALID_EXTRACTION_RESULT'; end if;
  select * into v_evidence from public.evidence_files where id=v_extraction.evidence_id and business_id=p_business_id
    and intake_id=v_extraction.intake_id and evidence_version=v_extraction.document_version for update;
  select * into v_intake from public.document_intakes where id=v_extraction.intake_id and business_id=p_business_id
    and status not in ('submitted','cancelled') for update;
  if v_evidence.id is null or v_intake.id is null then raise exception 'P11_EXTRACTION_SCOPE_MISMATCH'; end if;
  if exists(select 1 from public.document_extraction_candidates where extraction_id=v_extraction.id) then raise exception 'P12_CANDIDATES_ALREADY_WRITTEN'; end if;
  for v_candidate in select value from jsonb_array_elements(p_candidates) loop
    if not (v_candidate ?& array['field_type','original_text','normalized_value','confidence','evidence','validation_flags','sensitivity'])
      or length(v_candidate->>'original_text') not between 1 and 2000 or (v_candidate->>'confidence')::numeric not between 0 and 1
      or jsonb_typeof(v_candidate->'evidence')<>'object' or jsonb_typeof(v_candidate->'validation_flags')<>'array'
      or nullif(trim(v_candidate->'evidence'->>'snippet'),'') is null then raise exception 'P12_INVALID_CANDIDATE'; end if;
    select coalesce(array_agg(value), '{}') into v_flags from jsonb_array_elements_text(v_candidate->'validation_flags');
    v_duplicate:=nullif(v_candidate->>'duplicate_group','');
    if v_candidate->>'field_type'='invoice_number' and exists(
      select 1 from public.document_extraction_candidates prior where prior.business_id=p_business_id
        and prior.field_type='invoice_number' and prior.normalized_value=v_candidate->'normalized_value'
        and prior.evidence_id<>v_extraction.evidence_id
    ) then
      v_flags:=array_append(v_flags,'DUPLICATE_INVOICE_IDENTIFIER');
      v_duplicate:=coalesce(v_duplicate,upper(v_candidate->>'normalized_value'));
    end if;
    insert into public.document_extraction_candidates(
      extraction_id,intake_id,evidence_id,business_id,extraction_version,document_version,candidate_ordinal,field_type,
      original_text,normalized_value,confidence,extraction_method,provider,provider_version,parser_version,
      source_page,source_image_id,source_bounding_box,source_text_span,source_snippet,validation_flags,sensitivity,duplicate_group
    ) values(v_extraction.id,v_extraction.intake_id,v_extraction.evidence_id,p_business_id,v_extraction.extraction_version,
      v_extraction.document_version,v_ordinal,v_candidate->>'field_type',v_candidate->>'original_text',v_candidate->'normalized_value',
      (v_candidate->>'confidence')::numeric,p_extraction_method,p_provider,p_provider_version,p_parser_version,
      nullif(v_candidate->'evidence'->>'page','null')::integer,nullif(v_candidate->'evidence'->>'imageId',''),
      v_candidate->'evidence'->'boundingBox',v_candidate->'evidence'->'textSpan',v_candidate->'evidence'->>'snippet',
      array(select distinct value from unnest(v_flags) value),v_candidate->>'sensitivity',v_duplicate);
    v_ordinal:=v_ordinal+1;
  end loop;
  v_result_status:=case when p_needs_review then 'needs_review' else 'completed' end;
  update public.document_intake_extractions set provider=p_provider,provider_model=p_provider_model,provider_version=p_provider_version,
    parser_version=p_parser_version,extraction_method=p_extraction_method,document_classification=p_document_classification,
    structured_result=p_structured_result,protected_raw_result=p_protected_raw_result,protected_raw_text=null,confidence=p_confidence,
    warnings=p_warnings,status=v_result_status,completed_at=now(),error_code=null,next_attempt_at=null,locked_at=null,locked_by=null,updated_at=now()
    where id=v_extraction.id returning * into v_extraction;
  update public.evidence_files set processing_status=v_result_status where id=v_evidence.id;
  v_old_status:=v_intake.status;
  update public.document_intakes set status='needs_review',version=version+1,updated_at=now(),last_error_code=null
    where id=v_intake.id returning * into v_intake;
  insert into public.document_intake_events(intake_id,business_id,from_status,to_status,intake_version,actor_id,actor_role,action,metadata)
  values(v_intake.id,p_business_id,v_old_status,'needs_review',v_intake.version,null,null,'document_extraction.completed',
    jsonb_build_object('extraction_id',v_extraction.id,'evidence_id',v_evidence.id,'extraction_version',v_extraction.extraction_version,
      'document_version',v_extraction.document_version,'candidate_count',v_ordinal,'result_status',v_result_status));
  insert into public.audit_logs(business_id,action,actor_type,entity_type,entity_id,metadata)
  values(p_business_id,'document_extraction.completed','system','document_intake_extraction',v_extraction.id::text,
    jsonb_build_object('intake_id',v_intake.id,'evidence_id',v_evidence.id,'extraction_version',v_extraction.extraction_version,
      'document_version',v_extraction.document_version,'candidate_count',v_ordinal,'provider',p_provider,'provider_version',p_provider_version,'parser_version',p_parser_version));
  return v_extraction;
end; $$;

create or replace function public.document_intake_requeue_extraction(
  p_business_id uuid,p_intake_id uuid,p_actor_id uuid,p_idempotency_key text,p_request_hash text,p_correlation_id uuid
) returns public.document_intake_extractions language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_intake public.document_intakes; v_evidence public.evidence_files;
  v_extraction public.document_intake_extractions; v_existing public.document_intake_idempotency_keys; v_old_status text; v_version integer;
begin
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id);
  if v_role is null or v_role='viewer' then raise exception 'P8_PERMISSION_DENIED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':extract:'||p_idempotency_key,0));
  select * into v_existing from public.document_intake_idempotency_keys where business_id=p_business_id and action_scope='extract' and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_hash<>p_request_hash then raise exception 'P8_IDEMPOTENCY_CONFLICT'; end if;
    select * into v_extraction from public.document_intake_extractions where id=v_existing.resource_id and business_id=p_business_id;
    return v_extraction;
  end if;
  select * into v_intake from public.document_intakes where id=p_intake_id and business_id=p_business_id and deleted_at is null for update;
  if not found then raise exception 'P8_INTAKE_NOT_FOUND'; end if;
  if v_intake.status in ('submitted','cancelled') then raise exception 'P8_INTAKE_LOCKED'; end if;
  select * into v_evidence from public.evidence_files where intake_id=p_intake_id and business_id=p_business_id and kind='original'
    and is_current and soft_deleted_at is null for update;
  if not found then raise exception 'P8_EVIDENCE_NOT_FOUND'; end if;
  if v_evidence.scan_status<>'clean' then raise exception 'P8_EVIDENCE_SCAN_PENDING'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':extract-rate',0));
  if (select count(*) from public.document_intake_extractions where business_id=p_business_id and created_at>now()-interval '1 hour')>=10 then
    raise exception 'P12_EXTRACTION_RATE_LIMITED';
  end if;
  if exists(select 1 from public.document_intake_extractions where evidence_id=v_evidence.id and status in ('queued','processing')) then
    raise exception 'P11_EXTRACTION_ALREADY_PROCESSING';
  end if;
  select coalesce(max(extraction_version),0)+1 into v_version from public.document_intake_extractions where evidence_id=v_evidence.id;
  insert into public.document_intake_extractions(intake_id,evidence_id,business_id,provider,parser_version,status,idempotency_key,extraction_version,document_version)
  values(p_intake_id,v_evidence.id,p_business_id,'unassigned','pending','queued',
    'extract:'||v_evidence.id::text||':v:'||v_version::text,v_version,v_evidence.evidence_version) returning * into v_extraction;
  update public.evidence_files set processing_status='queued' where id=v_evidence.id;
  v_old_status:=v_intake.status;
  if v_intake.status<>'processing' then update public.document_intakes set status='processing',version=version+1,updated_at=now(),last_error_code=null
    where id=v_intake.id returning * into v_intake; end if;
  insert into public.document_intake_idempotency_keys(business_id,action_scope,idempotency_key,request_hash,actor_id,resource_type,resource_id,response_status)
  values(p_business_id,'extract',p_idempotency_key,p_request_hash,p_actor_id,'document_intake_extraction',v_extraction.id,202);
  insert into public.document_intake_events(intake_id,business_id,from_status,to_status,intake_version,actor_id,actor_role,action,metadata,correlation_id,idempotency_key)
  values(p_intake_id,p_business_id,v_old_status,v_intake.status,v_intake.version,p_actor_id,v_role,'document_extraction.queued',
    jsonb_build_object('extraction_id',v_extraction.id,'evidence_id',v_evidence.id,'extraction_version',v_version,'document_version',v_evidence.evidence_version),
    p_correlation_id,p_idempotency_key);
  return v_extraction;
end; $$;

alter table public.document_extraction_candidates enable row level security;
revoke all on public.document_extraction_candidates from public,anon,authenticated;
grant all on public.document_extraction_candidates to service_role;
revoke all on function public.document_intake_complete_extraction(uuid,uuid,text,text,text,text,text,text,text,jsonb,jsonb,jsonb,numeric,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.document_intake_complete_extraction(uuid,uuid,text,text,text,text,text,text,text,jsonb,jsonb,jsonb,numeric,jsonb,boolean) to service_role;
revoke all on function public.document_extraction_candidates_immutable() from public,anon,authenticated;

commit;

-- Rollback: disable extraction workers first. Restore the Prompt 11 claim,
-- completion and requeue functions. Keep this table and both version columns
-- read-only for audit/history. Dropping candidate history is intentionally not
-- part of routine rollback and requires separately approved retention review.
