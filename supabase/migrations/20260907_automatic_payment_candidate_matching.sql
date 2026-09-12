-- Prompt 16: deterministic, explainable payment candidate matching.
-- Apply after 20260906_transaction_evidence_release_hardening.sql.
begin;

create table if not exists public.payment_matching_settings (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  high_confidence_threshold smallint not null default 75 check(high_confidence_threshold between 70 and 95),
  ambiguous_threshold smallint not null default 45 check(ambiguous_threshold between 30 and 69),
  date_window_days smallint not null default 14 check(date_window_days between 1 and 30),
  maximum_candidates smallint not null default 10 check(maximum_candidates between 3 and 20),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  check(high_confidence_threshold>=ambiguous_threshold+10)
);

create table if not exists public.normalized_payment_transactions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  source_type text not null check(source_type in ('bank_statement','accounting','manual','payment_proof')),
  source_system text not null check(char_length(btrim(source_system)) between 1 and 80),
  source_record_id text not null check(char_length(btrim(source_record_id)) between 1 and 255),
  source_batch_key text,
  import_batch_id uuid references public.import_batches(id) on delete restrict,
  document_intake_id uuid references public.document_intakes(id) on delete restrict,
  payment_submission_id uuid references public.public_payment_submissions(id) on delete restrict,
  existing_payment_id uuid references public.payments(id) on delete restrict,
  amount_minor bigint not null check(amount_minor>0),
  currency char(3) not null check(currency~'^[A-Z]{3}$'),
  occurred_at timestamptz,
  reference text,
  invoice_number text,
  party_name text,
  account_reference text,
  phone text,
  phone_match_permitted boolean not null default false,
  duplicate_of_transaction_id uuid references public.normalized_payment_transactions(id) on delete restrict,
  duplicate_signals jsonb not null default '[]'::jsonb check(jsonb_typeof(duplicate_signals)='array'),
  fingerprint_hash char(64) not null check(fingerprint_hash~'^[0-9a-f]{64}$'),
  queue_status text not null default 'ready' check(queue_status in ('ready','high_confidence_review','ambiguous','unmatched','allocated')),
  metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata)='object'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,business_id),
  unique(business_id,source_type,source_system,source_record_id)
);
create index if not exists normalized_payment_transactions_queue_idx
  on public.normalized_payment_transactions(business_id,queue_status,created_at desc);
create index if not exists normalized_payment_transactions_reference_idx
  on public.normalized_payment_transactions(business_id,reference) where reference is not null;

create table if not exists public.payment_match_jobs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  transaction_id uuid not null references public.normalized_payment_transactions(id) on delete restrict,
  algorithm_version text not null,
  thresholds jsonb not null check(jsonb_typeof(thresholds)='object'),
  queue_result text not null check(queue_result in ('high_confidence_review','ambiguous','unmatched')),
  candidate_count integer not null check(candidate_count>=0),
  idempotency_key text not null,
  request_hash char(64) not null check(request_hash~'^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(id,business_id),
  unique(business_id,idempotency_key)
);
create index if not exists payment_match_jobs_transaction_idx
  on public.payment_match_jobs(business_id,transaction_id,created_at desc);

create table if not exists public.payment_match_candidates (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  job_id uuid not null references public.payment_match_jobs(id) on delete restrict,
  transaction_id uuid not null references public.normalized_payment_transactions(id) on delete restrict,
  rank integer not null check(rank>0),
  score smallint not null check(score between 0 and 100),
  confidence_band text not null check(confidence_band in ('high','ambiguous','low')),
  customer_id uuid not null references public.debtors(id) on delete restrict,
  account_id uuid references public.customer_accounts(id) on delete restrict,
  obligation_id uuid references public.obligations(id) on delete restrict,
  case_id text not null references public.cases(id) on delete restrict,
  existing_payment_id uuid references public.payments(id) on delete restrict,
  matched_signals jsonb not null check(jsonb_typeof(matched_signals)='array'),
  conflicting_signals jsonb not null check(jsonb_typeof(conflicting_signals)='array'),
  reason text not null,
  ranking_reason text not null,
  review_status text not null default 'pending' check(review_status in ('pending','approved','rejected','deferred','superseded')),
  reviewed_by uuid references auth.users(id) on delete restrict,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  unique(id,business_id),
  unique(job_id,rank),
  unique(job_id,case_id,obligation_id)
);
create index if not exists payment_match_candidates_queue_idx
  on public.payment_match_candidates(business_id,review_status,confidence_band,score desc,created_at desc);

create table if not exists public.payment_match_candidate_events (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.payment_match_candidates(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  transaction_id uuid not null references public.normalized_payment_transactions(id) on delete restrict,
  event_type text not null check(event_type in ('proposed','approved','rejected','deferred','superseded')),
  from_status text,
  to_status text not null,
  actor_id uuid references auth.users(id) on delete restrict,
  actor_role text,
  note text,
  metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now()
);

create table if not exists public.payment_match_allocations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  transaction_id uuid not null references public.normalized_payment_transactions(id) on delete restrict,
  candidate_id uuid not null references public.payment_match_candidates(id) on delete restrict,
  case_id text not null references public.cases(id) on delete restrict,
  obligation_id uuid references public.obligations(id) on delete restrict,
  payment_id uuid not null references public.payments(id) on delete restrict,
  amount_minor bigint not null check(amount_minor>0),
  currency char(3) not null check(currency~'^[A-Z]{3}$'),
  split_group_id uuid,
  approved_by uuid not null references auth.users(id) on delete restrict,
  approved_at timestamptz not null default now(),
  idempotency_key text not null,
  unique(transaction_id,candidate_id),
  unique(payment_id),
  unique(business_id,idempotency_key,candidate_id)
);
create unique index if not exists payment_match_allocations_one_unsplit_idx
  on public.payment_match_allocations(transaction_id) where split_group_id is null;

create table if not exists public.payment_matching_idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  action_scope text not null check(action_scope in ('import','review')),
  idempotency_key text not null,
  request_hash char(64) not null check(request_hash~'^[0-9a-f]{64}$'),
  response jsonb not null default '{}'::jsonb check(jsonb_typeof(response)='object'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(business_id,action_scope,idempotency_key)
);

create or replace function public.payment_matching_capture_document_outcome()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_confirmation public.document_intake_confirmations; v_obligation public.obligations; v_account public.customer_accounts; v_fingerprint text;
begin
  if new.payment_id is null or new.route not in ('repayment','partial_repayment') then return new; end if;
  select * into v_confirmation from public.document_intake_confirmations where intake_id=new.intake_id and business_id=new.business_id and review_status='confirmed' order by confirmation_version desc limit 1;
  if not found or v_confirmation.chosen_amount_minor is null or v_confirmation.currency is null then return new; end if;
  if new.obligation_id is not null then select * into v_obligation from public.obligations where id=new.obligation_id and business_id=new.business_id; end if;
  if new.account_id is not null then select * into v_account from public.customer_accounts where id=new.account_id and business_id=new.business_id; end if;
  v_fingerprint:=encode(digest(convert_to(concat_ws('|','payment_proof','document_intake',new.intake_id::text,v_confirmation.chosen_amount_minor::text,v_confirmation.currency,coalesce(v_confirmation.document_datetime::text,''),coalesce(v_confirmation.reference,'')),'UTF8'),'sha256'),'hex');
  insert into public.normalized_payment_transactions(
    business_id,source_type,source_system,source_record_id,source_batch_key,document_intake_id,existing_payment_id,
    amount_minor,currency,occurred_at,reference,invoice_number,party_name,account_reference,phone_match_permitted,
    duplicate_signals,fingerprint_hash,metadata,created_by
  ) values(
    new.business_id,'payment_proof','document_intake',new.intake_id::text,new.id::text,new.intake_id,new.payment_id,
    v_confirmation.chosen_amount_minor,v_confirmation.currency,v_confirmation.document_datetime,v_confirmation.reference,
    v_obligation.reference,v_confirmation.sender,v_account.account_number,false,
    coalesce((select jsonb_agg(jsonb_build_object('code','document_intake_duplicate_signal','detail',j.value)) from jsonb_array_elements_text(coalesce((select draft_data#>'{duplicateReview,candidateKeys}' from public.document_intake_workflow_drafts where intake_id=new.intake_id),'[]'::jsonb)) as j(value)),'[]'::jsonb),
    v_fingerprint,jsonb_build_object('document_intake_outcome_id',new.id,'evidence_id',new.result->>'evidence_id'),new.created_by
  ) on conflict(business_id,source_type,source_system,source_record_id) do nothing;
  return new;
end; $$;
drop trigger if exists payment_matching_document_outcome_capture on public.document_intake_outcomes;
create trigger payment_matching_document_outcome_capture after insert on public.document_intake_outcomes
for each row execute function public.payment_matching_capture_document_outcome();

create or replace function public.payment_matching_capture_public_proof()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_case public.cases; v_fingerprint text;
begin
  select * into v_case from public.cases where id=new.case_id and business_id=new.business_id;
  if not found then return new; end if;
  v_fingerprint:=encode(digest(convert_to(concat_ws('|','payment_proof','public_portal',new.id::text,new.amount_minor::text,new.currency,new.payment_date::text,coalesce(new.reference_no,'')),'UTF8'),'sha256'),'hex');
  insert into public.normalized_payment_transactions(
    business_id,source_type,source_system,source_record_id,source_batch_key,payment_submission_id,
    amount_minor,currency,occurred_at,reference,invoice_number,party_name,account_reference,phone_match_permitted,
    fingerprint_hash,metadata
  ) values(
    new.business_id,'payment_proof','public_portal',new.id::text,new.public_access_token_id::text,new.id,
    new.amount_minor,new.currency,new.payment_date::timestamptz,new.reference_no,new.invoice_reference,v_case.debtor_name,v_case.invoice_no,false,
    v_fingerprint,jsonb_build_object('case_hint',new.case_id,'proof_sha256',new.proof_sha256)
  ) on conflict(business_id,source_type,source_system,source_record_id) do nothing;
  return new;
end; $$;
drop trigger if exists payment_matching_public_proof_capture on public.public_payment_submissions;
create trigger payment_matching_public_proof_capture after insert on public.public_payment_submissions
for each row execute function public.payment_matching_capture_public_proof();

create or replace function public.payment_matching_import_transactions(
  p_business_id uuid,p_actor_id uuid,p_transactions jsonb,p_idempotency_key text,p_request_hash text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_existing public.payment_matching_idempotency_keys; v_item jsonb; v_row public.normalized_payment_transactions;
  v_rows jsonb:='[]'::jsonb; v_import_batch uuid; v_duplicate uuid; v_count integer:=0;
begin
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id);
  if v_role not in ('owner','admin','manager') then raise exception 'P16_PERMISSION_DENIED'; end if;
  if jsonb_typeof(p_transactions)<>'array' or jsonb_array_length(p_transactions) not between 1 and 500 then raise exception 'P16_INVALID_IMPORT'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':payment-import:'||p_idempotency_key,0));
  select * into v_existing from public.payment_matching_idempotency_keys where business_id=p_business_id and action_scope='import' and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_hash<>p_request_hash then raise exception 'P16_IDEMPOTENCY_CONFLICT'; end if;
    return v_existing.response||jsonb_build_object('idempotent_replay',true);
  end if;
  for v_item in select value from jsonb_array_elements(p_transactions) loop
    if v_item->>'sourceType' not in ('bank_statement','accounting','manual','payment_proof')
      or nullif(btrim(v_item->>'sourceSystem'),'') is null or nullif(btrim(v_item->>'sourceRecordId'),'') is null
      or coalesce((v_item->>'amountMinor')::bigint,0)<=0 or upper(v_item->>'currency')!~'^[A-Z]{3}$'
      or coalesce(v_item->>'fingerprintHash','')!~'^[0-9a-f]{64}$' then raise exception 'P16_INVALID_IMPORT'; end if;
    v_import_batch:=nullif(v_item->>'importBatchId','')::uuid;
    if v_import_batch is not null and not exists(select 1 from public.import_batches where id=v_import_batch and business_id=p_business_id) then raise exception 'P16_IMPORT_BATCH_SCOPE_MISMATCH'; end if;
    v_duplicate:=nullif(v_item->>'duplicateOfTransactionId','')::uuid;
    if v_duplicate is not null and not exists(select 1 from public.normalized_payment_transactions where id=v_duplicate and business_id=p_business_id) then raise exception 'P16_DUPLICATE_SCOPE_MISMATCH'; end if;
    insert into public.normalized_payment_transactions(
      business_id,source_type,source_system,source_record_id,source_batch_key,import_batch_id,amount_minor,currency,
      occurred_at,reference,invoice_number,party_name,account_reference,phone,phone_match_permitted,
      duplicate_of_transaction_id,duplicate_signals,fingerprint_hash,metadata,created_by
    ) values(
      p_business_id,v_item->>'sourceType',left(v_item->>'sourceSystem',80),left(v_item->>'sourceRecordId',255),left(nullif(v_item->>'sourceBatchKey',''),255),v_import_batch,
      (v_item->>'amountMinor')::bigint,upper(v_item->>'currency'),nullif(v_item->>'occurredAt','')::timestamptz,
      left(nullif(v_item->>'reference',''),255),left(nullif(v_item->>'invoiceNumber',''),255),left(nullif(v_item->>'partyName',''),255),
      left(nullif(v_item->>'accountReference',''),255),left(nullif(v_item->>'phone',''),50),coalesce((v_item->>'phoneMatchPermitted')::boolean,false),
      v_duplicate,coalesce(v_item->'duplicateSignals','[]'::jsonb),v_item->>'fingerprintHash',coalesce(v_item->'metadata','{}'::jsonb),p_actor_id
    ) on conflict(business_id,source_type,source_system,source_record_id) do update set updated_at=normalized_payment_transactions.updated_at
    returning * into v_row;
    v_rows:=v_rows||jsonb_build_array(jsonb_build_object('id',v_row.id,'sourceRecordId',v_row.source_record_id,'queueStatus',v_row.queue_status));
    v_count:=v_count+1;
  end loop;
  insert into public.audit_logs(business_id,action,actor_type,actor_id,actor_role,entity_type,entity_id,idempotency_key,metadata)
    values(p_business_id,'payment_matching.transactions_imported','staff',p_actor_id,v_role,'normalized_payment_transaction',null,p_idempotency_key,jsonb_build_object('row_count',v_count));
  insert into public.payment_matching_idempotency_keys(business_id,action_scope,idempotency_key,request_hash,response,created_by)
    values(p_business_id,'import',p_idempotency_key,p_request_hash,jsonb_build_object('transactions',v_rows,'imported_count',v_count,'idempotent_replay',false),p_actor_id);
  return jsonb_build_object('transactions',v_rows,'imported_count',v_count,'idempotent_replay',false);
end; $$;

create or replace function public.payment_matching_store_job(
  p_business_id uuid,p_transaction_id uuid,p_actor_id uuid,p_algorithm_version text,p_thresholds jsonb,
  p_queue_result text,p_candidates jsonb,p_idempotency_key text,p_request_hash text
) returns public.payment_match_jobs language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_job public.payment_match_jobs; v_item jsonb; v_transaction public.normalized_payment_transactions; v_candidate public.payment_match_candidates;
begin
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id);
  if v_role not in ('owner','admin','manager') then raise exception 'P16_PERMISSION_DENIED'; end if;
  if p_queue_result not in ('high_confidence_review','ambiguous','unmatched') or jsonb_typeof(p_candidates)<>'array' then raise exception 'P16_INVALID_MATCH_JOB'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':payment-match:'||p_transaction_id::text,0));
  select * into v_job from public.payment_match_jobs where business_id=p_business_id and idempotency_key=p_idempotency_key;
  if found then if v_job.request_hash<>p_request_hash then raise exception 'P16_IDEMPOTENCY_CONFLICT'; end if; return v_job; end if;
  select * into v_transaction from public.normalized_payment_transactions where id=p_transaction_id and business_id=p_business_id for update;
  if not found then raise exception 'P16_TRANSACTION_NOT_FOUND'; end if;
  if v_transaction.queue_status='allocated' then raise exception 'P16_TRANSACTION_ALREADY_ALLOCATED'; end if;
  insert into public.payment_match_jobs(business_id,transaction_id,algorithm_version,thresholds,queue_result,candidate_count,idempotency_key,request_hash,created_by)
    values(p_business_id,p_transaction_id,p_algorithm_version,p_thresholds,p_queue_result,jsonb_array_length(p_candidates),p_idempotency_key,p_request_hash,p_actor_id) returning * into v_job;
  for v_item in select value from jsonb_array_elements(p_candidates) loop
    if not exists(select 1 from public.cases c where c.id=v_item->>'caseId' and c.business_id=p_business_id and c.debtor_id=(v_item->>'customerId')::uuid) then raise exception 'P16_CANDIDATE_SCOPE_MISMATCH'; end if;
    if nullif(v_item->>'obligationId','') is not null and not exists(select 1 from public.recovery_case_obligations r where r.case_id=v_item->>'caseId' and r.obligation_id=(v_item->>'obligationId')::uuid and r.business_id=p_business_id) then raise exception 'P16_CANDIDATE_SCOPE_MISMATCH'; end if;
    insert into public.payment_match_candidates(business_id,job_id,transaction_id,rank,score,confidence_band,customer_id,account_id,obligation_id,case_id,existing_payment_id,matched_signals,conflicting_signals,reason,ranking_reason)
      values(p_business_id,v_job.id,p_transaction_id,(v_item->>'rank')::integer,(v_item->>'score')::smallint,v_item->>'confidenceBand',(v_item->>'customerId')::uuid,
        nullif(v_item->>'accountId','')::uuid,nullif(v_item->>'obligationId','')::uuid,v_item->>'caseId',nullif(v_item->>'existingPaymentId','')::uuid,
        v_item->'matchedSignals',v_item->'conflictingSignals',v_item->>'reason',v_item->>'rankingReason') returning * into v_candidate;
    insert into public.payment_match_candidate_events(candidate_id,business_id,transaction_id,event_type,to_status,actor_id,actor_role,metadata)
      values(v_candidate.id,p_business_id,p_transaction_id,'proposed','pending',p_actor_id,v_role,jsonb_build_object('rank',v_candidate.rank,'score',v_candidate.score,'confidence_band',v_candidate.confidence_band));
  end loop;
  update public.normalized_payment_transactions set queue_status=p_queue_result,updated_at=now() where id=p_transaction_id;
  insert into public.audit_logs(business_id,action,actor_type,actor_id,actor_role,entity_type,entity_id,idempotency_key,metadata)
    values(p_business_id,'payment_matching.candidates_generated','staff',p_actor_id,v_role,'normalized_payment_transaction',p_transaction_id::text,p_idempotency_key,jsonb_build_object('job_id',v_job.id,'queue',p_queue_result,'candidate_count',v_job.candidate_count,'algorithm_version',p_algorithm_version));
  return v_job;
end; $$;

create or replace function public.payment_matching_review_candidate(
  p_business_id uuid,p_transaction_id uuid,p_actor_id uuid,p_decision text,p_candidate_id uuid,p_allocations jsonb,
  p_split_authorization boolean,p_note text,p_idempotency_key text,p_request_hash text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_existing public.payment_matching_idempotency_keys; v_transaction public.normalized_payment_transactions;
  v_candidate public.payment_match_candidates; v_item jsonb; v_case public.cases; v_payment public.payments; v_event_id uuid;
  v_amount bigint; v_total bigint:=0; v_count integer; v_split_group uuid; v_response jsonb; v_old_status text;
begin
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id);
  if v_role not in ('owner','admin','manager') then raise exception 'P16_PERMISSION_DENIED'; end if;
  if p_decision not in ('approve','approve_split','reject','defer') then raise exception 'P16_INVALID_REVIEW'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':payment-review:'||p_transaction_id::text,0));
  select * into v_existing from public.payment_matching_idempotency_keys where business_id=p_business_id and action_scope='review' and idempotency_key=p_idempotency_key;
  if found then if v_existing.request_hash<>p_request_hash then raise exception 'P16_IDEMPOTENCY_CONFLICT'; end if; return v_existing.response||jsonb_build_object('idempotent_replay',true); end if;
  select * into v_transaction from public.normalized_payment_transactions where id=p_transaction_id and business_id=p_business_id for update;
  if not found then raise exception 'P16_TRANSACTION_NOT_FOUND'; end if;
  select * into v_candidate from public.payment_match_candidates where id=p_candidate_id and transaction_id=p_transaction_id and business_id=p_business_id for update;
  if not found then raise exception 'P16_CANDIDATE_NOT_FOUND'; end if;
  if v_candidate.job_id is distinct from (select id from public.payment_match_jobs where transaction_id=p_transaction_id and business_id=p_business_id order by created_at desc,id desc limit 1) then raise exception 'P16_CANDIDATE_STALE'; end if;
  if p_decision in ('reject','defer') then
    if v_candidate.review_status not in ('pending','deferred') then raise exception 'P16_CANDIDATE_ALREADY_REVIEWED'; end if;
    v_old_status:=v_candidate.review_status;
    update public.payment_match_candidates set review_status=case when p_decision='reject' then 'rejected' else 'deferred' end,
      reviewed_by=p_actor_id,reviewed_at=now(),review_note=btrim(p_note) where id=v_candidate.id returning * into v_candidate;
    insert into public.payment_match_candidate_events(candidate_id,business_id,transaction_id,event_type,from_status,to_status,actor_id,actor_role,note)
      values(v_candidate.id,p_business_id,p_transaction_id,case when p_decision='reject' then 'rejected' else 'deferred' end,v_old_status,v_candidate.review_status,p_actor_id,v_role,btrim(p_note));
    v_response:=jsonb_build_object('transaction_id',p_transaction_id,'candidate_id',v_candidate.id,'decision',p_decision,'queue_status',v_transaction.queue_status,'idempotent_replay',false);
  else
    if exists(select 1 from public.payment_match_allocations where transaction_id=p_transaction_id)
      or exists(select 1 from public.payment_match_allocations a join public.normalized_payment_transactions t on t.id=a.transaction_id
        where t.business_id=p_business_id and (t.id=v_transaction.duplicate_of_transaction_id or t.duplicate_of_transaction_id=p_transaction_id))
      or v_transaction.queue_status='allocated' then raise exception 'P16_TRANSACTION_ALREADY_ALLOCATED'; end if;
    if p_decision='approve_split' then
      if not p_split_authorization or jsonb_typeof(p_allocations)<>'array' or jsonb_array_length(p_allocations)<2 then raise exception 'P16_SPLIT_AUTHORIZATION_REQUIRED'; end if;
      v_split_group:=gen_random_uuid();
    else
      if p_split_authorization then raise exception 'P16_INVALID_REVIEW'; end if;
      p_allocations:=jsonb_build_array(jsonb_build_object('candidateId',p_candidate_id,'amountMinor',v_transaction.amount_minor));
    end if;
    v_count:=jsonb_array_length(p_allocations);
    select coalesce(sum((value->>'amountMinor')::bigint),0) into v_total from jsonb_array_elements(p_allocations);
    if v_total<>v_transaction.amount_minor then raise exception 'P16_ALLOCATION_TOTAL_MISMATCH'; end if;
    for v_item in select value from jsonb_array_elements(p_allocations) loop
      v_amount:=(v_item->>'amountMinor')::bigint;
      if v_amount<=0 then raise exception 'P16_INVALID_REVIEW'; end if;
      select * into v_candidate from public.payment_match_candidates where id=(v_item->>'candidateId')::uuid and transaction_id=p_transaction_id and business_id=p_business_id for update;
      if not found or v_candidate.review_status not in ('pending','deferred') then raise exception 'P16_CANDIDATE_ALREADY_REVIEWED'; end if;
      select * into v_case from public.cases where id=v_candidate.case_id and business_id=p_business_id and currency=v_transaction.currency and archived_at is null for update;
      if not found then raise exception 'P16_CASE_UNAVAILABLE'; end if;
      if v_candidate.existing_payment_id is not null and v_count=1 then
        select * into v_payment from public.payments where id=v_candidate.existing_payment_id and case_id=v_case.id for update;
        if not found or v_payment.review_status<>'pending_review' or v_payment.amount_minor<>v_amount or v_payment.currency<>v_transaction.currency then raise exception 'P16_EXISTING_PAYMENT_UNAVAILABLE'; end if;
        update public.payments set review_status='approved',reviewed_at=now(),reviewed_by=p_actor_id where id=v_payment.id returning * into v_payment;
      else
        insert into public.payments(case_id,amount,amount_minor,currency,payment_method,reference_no,review_status,reviewed_at,reviewed_by,notes)
          values(v_case.id,public.currency_minor_to_major(v_amount,v_transaction.currency),v_amount,v_transaction.currency,'bank_transfer',left(v_transaction.reference,255),'approved',now(),p_actor_id,'Approved from explainable transaction matching') returning * into v_payment;
      end if;
      insert into public.case_financial_events(case_id,event_type,amount_minor,currency,source_table,source_id,note,created_by)
        values(v_case.id,'payment_approved',v_amount,v_transaction.currency,'payments',v_payment.id,'Approved payment candidate match',p_actor_id) returning id into v_event_id;
      update public.payments set financial_event_id=v_event_id where id=v_payment.id;
      insert into public.payment_match_allocations(business_id,transaction_id,candidate_id,case_id,obligation_id,payment_id,amount_minor,currency,split_group_id,approved_by,idempotency_key)
        values(p_business_id,p_transaction_id,v_candidate.id,v_case.id,v_candidate.obligation_id,v_payment.id,v_amount,v_transaction.currency,v_split_group,p_actor_id,p_idempotency_key);
      update public.payment_match_candidates set review_status='approved',reviewed_by=p_actor_id,reviewed_at=now(),review_note=nullif(btrim(p_note),'') where id=v_candidate.id;
      insert into public.payment_match_candidate_events(candidate_id,business_id,transaction_id,event_type,from_status,to_status,actor_id,actor_role,note,metadata)
        values(v_candidate.id,p_business_id,p_transaction_id,'approved',v_candidate.review_status,'approved',p_actor_id,v_role,nullif(btrim(p_note),''),jsonb_build_object('payment_id',v_payment.id,'amount_minor',v_amount,'split',v_split_group is not null));
      perform public.financial_recalculate_case(v_case.id);
    end loop;
    insert into public.payment_match_candidate_events(candidate_id,business_id,transaction_id,event_type,from_status,to_status,actor_id,actor_role,metadata)
      select id,p_business_id,p_transaction_id,'superseded',review_status,'superseded',p_actor_id,v_role,jsonb_build_object('approved_candidate_id',p_candidate_id)
      from public.payment_match_candidates where transaction_id=p_transaction_id and review_status in ('pending','deferred');
    update public.payment_match_candidates set review_status='superseded',reviewed_at=now(),reviewed_by=p_actor_id
      where transaction_id=p_transaction_id and review_status in ('pending','deferred');
    update public.normalized_payment_transactions set queue_status='allocated',updated_at=now() where id=p_transaction_id;
    v_response:=jsonb_build_object('transaction_id',p_transaction_id,'candidate_id',p_candidate_id,'decision',p_decision,'allocation_count',v_count,'queue_status','allocated','idempotent_replay',false);
  end if;
  insert into public.payment_matching_idempotency_keys(business_id,action_scope,idempotency_key,request_hash,response,created_by)
    values(p_business_id,'review',p_idempotency_key,p_request_hash,v_response,p_actor_id);
  insert into public.audit_logs(business_id,case_id,action,actor_type,actor_id,actor_role,entity_type,entity_id,idempotency_key,metadata)
    values(p_business_id,v_candidate.case_id,'payment_matching.candidate_'||p_decision,'staff',p_actor_id,v_role,'normalized_payment_transaction',p_transaction_id::text,p_idempotency_key,
      jsonb_build_object('candidate_id',p_candidate_id,'split_authorized',p_split_authorization,'allocation_count',case when p_decision in ('approve','approve_split') then v_count else 0 end));
  return v_response;
end; $$;

create or replace function public.payment_matching_candidate_events_append_only()
returns trigger language plpgsql set search_path=public,pg_temp as $$ begin raise exception 'P16_APPEND_ONLY'; end; $$;
drop trigger if exists payment_match_candidate_events_append_only on public.payment_match_candidate_events;
create trigger payment_match_candidate_events_append_only before update or delete on public.payment_match_candidate_events
for each row execute function public.payment_matching_candidate_events_append_only();

alter table public.payment_matching_settings enable row level security;
alter table public.normalized_payment_transactions enable row level security;
alter table public.payment_match_jobs enable row level security;
alter table public.payment_match_candidates enable row level security;
alter table public.payment_match_candidate_events enable row level security;
alter table public.payment_match_allocations enable row level security;
alter table public.payment_matching_idempotency_keys enable row level security;

create policy payment_matching_settings_read on public.payment_matching_settings for select to authenticated using(public.has_business_permission(business_id,'payment.approve'));
create policy normalized_payment_transactions_read on public.normalized_payment_transactions for select to authenticated using(public.has_business_permission(business_id,'payment.approve'));
create policy payment_match_jobs_read on public.payment_match_jobs for select to authenticated using(public.has_business_permission(business_id,'payment.approve'));
create policy payment_match_candidates_read on public.payment_match_candidates for select to authenticated using(public.has_business_permission(business_id,'payment.approve'));
create policy payment_match_candidate_events_read on public.payment_match_candidate_events for select to authenticated using(public.has_business_permission(business_id,'payment.approve'));
create policy payment_match_allocations_read on public.payment_match_allocations for select to authenticated using(public.has_business_permission(business_id,'payment.approve'));

revoke all on public.payment_matching_settings,public.normalized_payment_transactions,public.payment_match_jobs,public.payment_match_candidates,public.payment_match_candidate_events,public.payment_match_allocations,public.payment_matching_idempotency_keys from anon;
grant select on public.payment_matching_settings,public.normalized_payment_transactions,public.payment_match_jobs,public.payment_match_candidates,public.payment_match_candidate_events,public.payment_match_allocations to authenticated;
grant all on public.payment_matching_settings,public.normalized_payment_transactions,public.payment_match_jobs,public.payment_match_candidates,public.payment_match_candidate_events,public.payment_match_allocations,public.payment_matching_idempotency_keys to service_role;
revoke all on function public.payment_matching_import_transactions(uuid,uuid,jsonb,text,text) from public,anon,authenticated;
revoke all on function public.payment_matching_store_job(uuid,uuid,uuid,text,jsonb,text,jsonb,text,text) from public,anon,authenticated;
revoke all on function public.payment_matching_review_candidate(uuid,uuid,uuid,text,uuid,jsonb,boolean,text,text,text) from public,anon,authenticated;
revoke all on function public.payment_matching_capture_document_outcome() from public,anon,authenticated;
revoke all on function public.payment_matching_capture_public_proof() from public,anon,authenticated;
grant execute on function public.payment_matching_import_transactions(uuid,uuid,jsonb,text,text) to service_role;
grant execute on function public.payment_matching_store_job(uuid,uuid,uuid,text,jsonb,text,jsonb,text,text) to service_role;
grant execute on function public.payment_matching_review_candidate(uuid,uuid,uuid,text,uuid,jsonb,boolean,text,text,text) to service_role;

commit;

-- Rollback (history-preserving): disable matching routes/workers, revoke the
-- three service RPC grants, and leave normalized transactions, candidate
-- explanations, review events, allocations, and audit records read-only.
-- After confirming no allocation references remain, a destructive rollback may
-- drop tables in reverse dependency order and then drop the three functions.
