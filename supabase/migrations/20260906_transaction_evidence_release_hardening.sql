-- Prompt 15: transaction-evidence module release hardening.
-- Apply after 20260905_human_review_evidence_confirmation.sql and
-- 20260904_profile_matching_draft_to_case.sql.

begin;

alter table public.evidence_files
  add column if not exists scan_attempt_count integer not null default 0 check(scan_attempt_count between 0 and 5),
  add column if not exists scan_started_at timestamptz,
  add column if not exists scan_completed_at timestamptz,
  add column if not exists scan_next_attempt_at timestamptz,
  add column if not exists scan_locked_at timestamptz,
  add column if not exists scan_locked_by text,
  add column if not exists scan_provider_version text,
  add column if not exists scan_error_code text,
  add column if not exists scan_sha256 char(64) check(scan_sha256 is null or scan_sha256~'^[0-9a-f]{64}$');

create index if not exists evidence_files_scan_queue_idx
  on public.evidence_files(scan_status,scan_next_attempt_at,uploaded_at)
  where intake_id is not null and kind='original' and is_current and soft_deleted_at is null
    and scan_status in ('pending','failed');

create or replace function public.document_evidence_claim_scan(p_worker_id text,p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_file public.evidence_files;
begin
  if nullif(trim(p_worker_id),'') is null then raise exception 'P15_INVALID_SCAN_WORKER'; end if;
  select file.* into v_file from public.evidence_files file
  join public.document_intakes intake on intake.id=file.intake_id and intake.business_id=file.business_id
  where file.kind='original' and file.is_current and file.soft_deleted_at is null
    and file.scan_status in ('pending','failed')
    and (file.scan_next_attempt_at is null or file.scan_next_attempt_at<=p_now)
    and (file.scan_locked_at is null or file.scan_locked_at<p_now-interval '2 minutes')
    and file.scan_attempt_count<5 and intake.deleted_at is null and intake.status not in ('submitted','cancelled')
  order by coalesce(file.scan_next_attempt_at,file.uploaded_at),file.uploaded_at
  for update of file skip locked limit 1;
  if not found then return null; end if;
  update public.evidence_files set scan_status='pending',scan_attempt_count=scan_attempt_count+1,
    scan_started_at=coalesce(scan_started_at,p_now),scan_completed_at=null,scan_next_attempt_at=null,
    scan_locked_at=p_now,scan_locked_by=p_worker_id,scan_error_code=null
  where id=v_file.id returning * into v_file;
  return jsonb_build_object('evidence_id',v_file.id,'intake_id',v_file.intake_id,'business_id',v_file.business_id,
    'storage_bucket',v_file.storage_bucket,'object_path',v_file.object_path,'file_size_bytes',v_file.file_size_bytes,
    'magic_mime_type',v_file.magic_mime_type,'content_sha256',v_file.content_sha256,'attempt_count',v_file.scan_attempt_count);
end; $$;

create or replace function public.document_evidence_complete_scan(
  p_business_id uuid,p_evidence_id uuid,p_worker_id text,p_provider text,p_provider_version text,
  p_verdict text,p_scanned_sha256 text
) returns public.evidence_files language plpgsql security definer set search_path=public,pg_temp as $$
declare v_file public.evidence_files; v_intake public.document_intakes; v_old_status text;
begin
  select * into v_file from public.evidence_files where id=p_evidence_id and business_id=p_business_id for update;
  if not found then raise exception 'P15_SCAN_NOT_FOUND'; end if;
  if v_file.scan_locked_by is distinct from p_worker_id or v_file.scan_locked_at is null then raise exception 'P15_SCAN_LEASE_MISMATCH'; end if;
  if nullif(trim(p_provider),'') is null or nullif(trim(p_provider_version),'') is null
    or p_verdict not in ('clean','suspected','malicious') or p_scanned_sha256!~'^[0-9a-f]{64}$'
    or p_scanned_sha256<>v_file.content_sha256 then raise exception 'P15_INVALID_SCAN_RESULT'; end if;
  select * into v_intake from public.document_intakes where id=v_file.intake_id and business_id=p_business_id for update;
  if not found then raise exception 'P15_SCAN_SCOPE_MISMATCH'; end if;
  update public.evidence_files set scan_status=case when p_verdict='clean' then 'clean' else 'quarantined' end,
    scan_provider=p_provider,scan_provider_version=p_provider_version,scan_sha256=p_scanned_sha256,
    scan_completed_at=now(),scan_next_attempt_at=null,scan_locked_at=null,scan_locked_by=null,scan_error_code=null,
    processing_status=case when p_verdict='clean' then processing_status else 'failed' end
  where id=v_file.id returning * into v_file;
  if p_verdict<>'clean' then
    v_old_status:=v_intake.status;
    update public.document_intakes set status='failed',version=version+1,updated_at=now(),last_error_code='EVIDENCE_QUARANTINED'
      where id=v_intake.id returning * into v_intake;
    insert into public.document_intake_events(intake_id,business_id,from_status,to_status,intake_version,action,error_code,metadata)
      values(v_intake.id,p_business_id,v_old_status,'failed',v_intake.version,'document_evidence.quarantined','EVIDENCE_QUARANTINED',
        jsonb_build_object('evidence_id',v_file.id,'provider',p_provider,'provider_version',p_provider_version,'verdict',p_verdict));
  else
    insert into public.document_intake_events(intake_id,business_id,from_status,to_status,intake_version,action,metadata)
      values(v_intake.id,p_business_id,v_intake.status,v_intake.status,v_intake.version,'document_evidence.scan_completed',
        jsonb_build_object('evidence_id',v_file.id,'provider',p_provider,'provider_version',p_provider_version,'verdict','clean'));
  end if;
  insert into public.audit_logs(business_id,action,actor_type,entity_type,entity_id,metadata)
    values(p_business_id,case when p_verdict='clean' then 'document_evidence.scan_completed' else 'document_evidence.quarantined' end,
      'system','evidence_file',v_file.id::text,jsonb_build_object('intake_id',v_file.intake_id,'provider',p_provider,
      'provider_version',p_provider_version,'verdict',p_verdict,'attempt',v_file.scan_attempt_count));
  return v_file;
end; $$;

create or replace function public.document_evidence_fail_scan(
  p_business_id uuid,p_evidence_id uuid,p_worker_id text,p_error_code text,p_retryable boolean,p_max_attempts integer
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_file public.evidence_files; v_intake public.document_intakes; v_retry boolean; v_next timestamptz; v_old_status text;
begin
  select * into v_file from public.evidence_files where id=p_evidence_id and business_id=p_business_id for update;
  if not found then raise exception 'P15_SCAN_NOT_FOUND'; end if;
  if v_file.scan_locked_by is distinct from p_worker_id or v_file.scan_locked_at is null then raise exception 'P15_SCAN_LEASE_MISMATCH'; end if;
  if p_error_code!~'^[A-Z0-9_]{3,64}$' or p_max_attempts not between 1 and 5 then raise exception 'P15_INVALID_SCAN_FAILURE'; end if;
  select * into v_intake from public.document_intakes where id=v_file.intake_id and business_id=p_business_id for update;
  if not found then raise exception 'P15_SCAN_SCOPE_MISMATCH'; end if;
  v_retry:=p_retryable and v_file.scan_attempt_count<p_max_attempts;
  v_next:=case when v_retry then now()+(least(60,power(2,v_file.scan_attempt_count))::text||' minutes')::interval else null end;
  update public.evidence_files set scan_status=case when v_retry then 'pending' else 'failed' end,
    scan_error_code=p_error_code,scan_next_attempt_at=v_next,scan_completed_at=case when v_retry then null else now() end,
    scan_locked_at=null,scan_locked_by=null,processing_status=case when v_retry then processing_status else 'failed' end
    where id=v_file.id returning * into v_file;
  if not v_retry then
    v_old_status:=v_intake.status;
    update public.document_intakes set status='failed',version=version+1,updated_at=now(),last_error_code=p_error_code
      where id=v_intake.id returning * into v_intake;
    insert into public.document_intake_events(intake_id,business_id,from_status,to_status,intake_version,action,error_code,metadata)
      values(v_intake.id,p_business_id,v_old_status,'failed',v_intake.version,'document_evidence.scan_failed',p_error_code,
        jsonb_build_object('evidence_id',v_file.id,'attempt',v_file.scan_attempt_count));
  end if;
  insert into public.audit_logs(business_id,action,actor_type,entity_type,entity_id,metadata)
    values(p_business_id,case when v_retry then 'document_evidence.scan_retry_scheduled' else 'document_evidence.scan_failed' end,
      'system','evidence_file',v_file.id::text,jsonb_build_object('intake_id',v_file.intake_id,'error_code',p_error_code,
      'attempt',v_file.scan_attempt_count,'retry_scheduled',v_retry,'next_attempt_at',v_next));
  return jsonb_build_object('evidence_id',v_file.id,'retry_scheduled',v_retry,'next_attempt_at',v_next);
end; $$;

create or replace function public.document_evidence_requeue_scan(
  p_business_id uuid,p_evidence_id uuid,p_actor_id uuid,p_reason_code text,p_correlation_id uuid
) returns public.evidence_files language plpgsql security definer set search_path=public,pg_temp as $$
declare v_file public.evidence_files; v_intake public.document_intakes; v_role text; v_old_status text;
begin
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id);
  if v_role is null or v_role not in ('owner','manager') then raise exception 'P8_PERMISSION_DENIED'; end if;
  if p_reason_code!~'^[A-Z0-9_]{3,64}$' then raise exception 'P15_INVALID_REQUEUE_REASON'; end if;
  select * into v_file from public.evidence_files where id=p_evidence_id and business_id=p_business_id
    and kind='original' and is_current and soft_deleted_at is null for update;
  if not found then raise exception 'P8_EVIDENCE_NOT_FOUND'; end if;
  if v_file.scan_status<>'failed' then raise exception 'P15_SCAN_NOT_REQUEUEABLE'; end if;
  select * into v_intake from public.document_intakes where id=v_file.intake_id and business_id=p_business_id for update;
  if not found or v_intake.status in ('submitted','cancelled') then raise exception 'P8_INTAKE_LOCKED'; end if;
  update public.evidence_files set scan_status='pending',scan_attempt_count=0,scan_started_at=null,scan_completed_at=null,
    scan_next_attempt_at=now(),scan_locked_at=null,scan_locked_by=null,scan_error_code=null,processing_status='queued'
    where id=v_file.id returning * into v_file;
  v_old_status:=v_intake.status;
  update public.document_intakes set status='processing',version=version+1,updated_at=now(),last_error_code=null
    where id=v_intake.id returning * into v_intake;
  insert into public.document_intake_events(intake_id,business_id,from_status,to_status,intake_version,actor_id,actor_role,action,metadata,correlation_id)
    values(v_intake.id,p_business_id,v_old_status,'processing',v_intake.version,p_actor_id,v_role,'document_evidence.scan_requeued',
      jsonb_build_object('evidence_id',v_file.id,'reason_code',p_reason_code),p_correlation_id);
  insert into public.audit_logs(business_id,action,actor_type,actor_id,actor_role,entity_type,entity_id,correlation_id,metadata)
    values(p_business_id,'document_evidence.scan_requeued','staff',p_actor_id,v_role,'evidence_file',v_file.id::text,p_correlation_id,
      jsonb_build_object('intake_id',v_file.intake_id,'reason_code',p_reason_code));
  return v_file;
end; $$;

create or replace function public.document_intake_outcome_release_guard()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_evidence public.evidence_files; v_draft public.document_intake_workflow_drafts;
  v_confirmation public.document_intake_confirmations; v_reference text; v_amount bigint; v_currency text;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.business_id::text||':document-outcome-release',0));
  if (select count(*) from public.document_intake_outcomes where business_id=new.business_id and created_at>now()-interval '1 hour')>=30
    then raise exception 'P15_FINAL_SUBMIT_RATE_LIMITED'; end if;
  select * into v_evidence from public.evidence_files where intake_id=new.intake_id and business_id=new.business_id
    and kind='original' and is_current and soft_deleted_at is null order by evidence_version desc limit 1;
  select * into v_draft from public.document_intake_workflow_drafts where intake_id=new.intake_id and business_id=new.business_id;
  select * into v_confirmation from public.document_intake_confirmations where intake_id=new.intake_id and business_id=new.business_id
    and review_status='confirmed' order by confirmation_version desc limit 1;
  if v_evidence.id is null or v_draft.intake_id is null or v_confirmation.id is null then raise exception 'P15_RELEASE_CONTEXT_MISSING'; end if;
  if exists(select 1 from public.evidence_files prior where prior.business_id=new.business_id and prior.id<>v_evidence.id
      and prior.soft_deleted_at is null and prior.content_sha256=v_evidence.content_sha256)
    then raise exception 'P15_EXACT_DUPLICATE_BLOCKED'; end if;
  v_reference:=upper(regexp_replace(coalesce(v_draft.draft_data->>'reference',''),'[^A-Za-z0-9]','','g'));
  v_amount:=nullif(v_draft.draft_data->>'amountMinor','')::bigint;
  v_currency:=upper(v_draft.draft_data->>'currency');
  if length(v_reference)>=4 and (
    exists(select 1 from public.payments p join public.cases c on c.id=p.case_id
      where c.business_id=new.business_id and upper(regexp_replace(coalesce(p.reference_no,''),'[^A-Za-z0-9]','','g'))=v_reference
        and p.amount_minor=v_amount and p.currency=v_currency)
    or (new.route in ('loan_disbursement','collection_case') and exists(select 1 from public.obligations o
      where o.business_id=new.business_id and upper(regexp_replace(coalesce(o.reference,''),'[^A-Za-z0-9]','','g'))=v_reference
        and o.original_amount_minor=v_amount and o.currency=v_currency))
  ) then raise exception 'P15_EXACT_DUPLICATE_BLOCKED'; end if;
  if v_confirmation.represents_financial_movement is distinct from true then raise exception 'P15_FINANCIAL_CONFIRMATION_MISMATCH'; end if;
  if (v_confirmation.transaction_nature in ('repayment','partial_repayment','refund') and v_confirmation.transaction_nature<>new.route)
    or (v_confirmation.transaction_nature in ('deposit','fee_adjustment','other') and new.route<>'deposit_or_other')
    or (v_confirmation.transaction_nature='loan_disbursement' and new.route not in ('loan_disbursement','collection_case'))
    then raise exception 'P15_TRANSACTION_NATURE_MISMATCH'; end if;
  return new;
end; $$;
drop trigger if exists document_intake_outcome_release_guard on public.document_intake_outcomes;
create trigger document_intake_outcome_release_guard before insert on public.document_intake_outcomes
for each row execute function public.document_intake_outcome_release_guard();

create or replace function public.document_intake_redact_review_log()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare v_decisions jsonb; v_citations jsonb; v_corrections integer:=0; v_item jsonb;
begin
  if new.action not in ('document_review.confirmed','document_review.draft_saved') then return new; end if;
  v_decisions:=coalesce(new.metadata->'field_decisions',new.metadata->'original_candidates_and_corrections','{}'::jsonb);
  v_citations:=coalesce(new.metadata->'evidence_citations','[]'::jsonb);
  if jsonb_typeof(v_decisions)='object' then
    for v_item in select value from jsonb_each(v_decisions) loop
      if v_item->>'source'='manual' or (v_item->>'source'='user' and v_item->>'original_value' is distinct from v_item->>'confirmed_value') then
        v_corrections:=v_corrections+1;
      end if;
    end loop;
  end if;
  new.metadata:=jsonb_strip_nulls(jsonb_build_object(
    'confirmation_id',new.metadata->'confirmation_id','confirmation_version',new.metadata->'confirmation_version',
    'extraction_id',new.metadata->'extraction_id','reviewed_at',new.metadata->'reviewed_at',
    'reviewed_by',new.metadata->'reviewed_by','correction_count',v_corrections,
    'citation_count',case when jsonb_typeof(v_citations)='array' then jsonb_array_length(v_citations) else 0 end
  ));
  return new;
end; $$;
drop trigger if exists document_intake_events_review_log_redaction on public.document_intake_events;
create trigger document_intake_events_review_log_redaction before insert or update on public.document_intake_events
for each row execute function public.document_intake_redact_review_log();
drop trigger if exists audit_logs_review_log_redaction on public.audit_logs;
create trigger audit_logs_review_log_redaction before insert or update on public.audit_logs
for each row execute function public.document_intake_redact_review_log();

-- Existing append-only events are deliberately not rewritten. Deploy this
-- before enabling production review traffic; historical remediation requires
-- a separately approved retention and incident-response procedure.

create or replace function public.document_intake_module_health(p_now timestamptz default now())
returns jsonb language sql security definer set search_path=public,pg_temp as $$
  select jsonb_build_object(
    'window_hours',24,
    'uploads',jsonb_build_object('succeeded',(select count(*) from public.audit_logs where action in ('document_evidence.uploaded','document_evidence.replaced') and created_at>=p_now-interval '24 hours'),
      'failed',(select count(*) from public.document_intake_events where action='document_evidence.upload_failed' and created_at>=p_now-interval '24 hours')),
    'scans',jsonb_build_object('clean',(select count(*) from public.audit_logs where action='document_evidence.scan_completed' and created_at>=p_now-interval '24 hours'),
      'failed',(select count(*) from public.audit_logs where action in ('document_evidence.scan_failed','document_evidence.quarantined') and created_at>=p_now-interval '24 hours')),
    'extractions',jsonb_build_object('succeeded',(select count(*) from public.audit_logs where action='document_extraction.completed' and created_at>=p_now-interval '24 hours'),
      'failed',(select count(*) from public.audit_logs where action='document_extraction.failed' and created_at>=p_now-interval '24 hours'),
      'average_latency_ms',(select coalesce(round(avg(extract(epoch from (completed_at-started_at))*1000)),0)::bigint
        from public.document_intake_extractions where completed_at is not null and started_at is not null and completed_at>=p_now-interval '24 hours')),
    'manual_corrections',(select coalesce(sum((metadata->>'correction_count')::integer),0) from public.audit_logs where action='document_review.confirmed' and created_at>=p_now-interval '24 hours'),
    'duplicate_warnings',(select count(*) from public.evidence_files where intake_id is not null and duplicate_match_status='exact_hash_warning' and uploaded_at>=p_now-interval '24 hours'),
    'final_submits',jsonb_build_object('succeeded',(select count(*) from public.document_intake_outcomes where created_at>=p_now-interval '24 hours'),
      'failed',(select count(*) from public.audit_logs where action='document_intake.workflow_submit_failed' and created_at>=p_now-interval '24 hours')),
    'stuck_scans',(select count(*) from public.evidence_files where intake_id is not null and is_current and scan_status='pending' and coalesce(scan_locked_at,uploaded_at)<p_now-interval '15 minutes'),
    'stuck_extractions',(select count(*) from public.document_intake_extractions where status='processing' and locked_at<p_now-interval '15 minutes'),
    'orphan_cleanup_failures',(select count(*) from public.audit_logs where action='document_evidence.cleanup_failed' and created_at>=p_now-interval '24 hours')
  );
$$;

revoke all on function public.document_evidence_claim_scan(text,timestamptz) from public,anon,authenticated;
revoke all on function public.document_evidence_complete_scan(uuid,uuid,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.document_evidence_fail_scan(uuid,uuid,text,text,boolean,integer) from public,anon,authenticated;
revoke all on function public.document_evidence_requeue_scan(uuid,uuid,uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.document_intake_module_health(timestamptz) from public,anon,authenticated;
revoke all on function public.document_intake_outcome_release_guard() from public,anon,authenticated;
revoke all on function public.document_intake_redact_review_log() from public,anon,authenticated;
grant execute on function public.document_evidence_claim_scan(text,timestamptz) to service_role;
grant execute on function public.document_evidence_complete_scan(uuid,uuid,text,text,text,text,text) to service_role;
grant execute on function public.document_evidence_fail_scan(uuid,uuid,text,text,boolean,integer) to service_role;
grant execute on function public.document_evidence_requeue_scan(uuid,uuid,uuid,text,uuid) to service_role;
grant execute on function public.document_intake_module_health(timestamptz) to service_role;

commit;

-- Rollback: disable document scan/extraction crons, drop the release-guard and
-- redaction triggers, then drop these five service RPCs. Retain scan verdict,
-- attempt, audit and outcome history. Removing retained security evidence is a
-- separate destructive operation requiring policy approval.
