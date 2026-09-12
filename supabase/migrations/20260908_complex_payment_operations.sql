-- Prompt 17: complex payment allocation, reversal, refund and reconciliation.
-- Apply after 20260907_automatic_payment_candidate_matching.sql.
-- All financial history introduced here is append-only. Case and obligation
-- balances remain projections of immutable case_financial_events.
begin;

create table if not exists public.payment_operation_settings (
  business_id uuid primary key references public.businesses(id) on delete restrict,
  unusual_reallocation_threshold_minor bigint not null default 1000000 check (unusual_reallocation_threshold_minor > 0),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.payment_operation_settings(business_id)
select id from public.businesses on conflict (business_id) do nothing;

create table if not exists public.payment_receipts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  receipt_kind text not null default 'payment' check (receipt_kind in ('payment','credit')),
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  received_at timestamptz not null,
  source_type text not null check (source_type in ('bank_statement','accounting','manual','payment_proof','credit_note')),
  source_system text not null check (nullif(btrim(source_system),'') is not null),
  source_record_id text not null check (nullif(btrim(source_record_id),'') is not null),
  normalized_transaction_id uuid references public.normalized_payment_transactions(id) on delete restrict,
  reference text,
  payer_name text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  idempotency_key text not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (business_id,source_type,source_system,source_record_id),
  unique (business_id,idempotency_key),
  unique nulls not distinct (business_id,normalized_transaction_id),
  unique (id,business_id)
);
create index if not exists payment_receipts_business_received_idx on public.payment_receipts(business_id,received_at desc);

create table if not exists public.payment_exchange_rates (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  source_currency char(3) not null check (source_currency ~ '^[A-Z]{3}$'),
  target_currency char(3) not null check (target_currency ~ '^[A-Z]{3}$'),
  numerator bigint not null check (numerator > 0),
  denominator bigint not null check (denominator > 0),
  effective_at timestamptz not null,
  provider text not null check (nullif(btrim(provider),'') is not null),
  provider_record_id text not null check (nullif(btrim(provider_record_id),'') is not null),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence)='object'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (source_currency <> target_currency),
  unique (business_id,provider,provider_record_id),
  unique (id,business_id)
);

create table if not exists public.payment_allocation_approval_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  receipt_id uuid not null,
  operation_type text not null check (operation_type='reallocation'),
  proposed_allocations jsonb not null check (jsonb_typeof(proposed_allocations)='array' and jsonb_array_length(proposed_allocations)>0),
  reason text not null check (char_length(btrim(reason)) between 3 and 1000),
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled','consumed')),
  requested_by uuid not null references auth.users(id) on delete restrict,
  decided_by uuid references auth.users(id) on delete restrict,
  decision_reason text,
  decided_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (receipt_id,business_id) references public.payment_receipts(id,business_id) on delete restrict,
  unique (id,business_id)
);
create index if not exists payment_allocation_approvals_queue_idx on public.payment_allocation_approval_requests(business_id,status,created_at);

create table if not exists public.payment_ledger_journals (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  operation_type text not null check (operation_type in ('receipt','allocation','allocation_reversal','refund','receipt_reversal')),
  source_table text not null,
  source_id uuid not null,
  idempotency_key text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (business_id,idempotency_key),
  unique (source_table,source_id,operation_type),
  unique (id,business_id)
);

create table if not exists public.payment_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  journal_id uuid not null,
  business_id uuid not null,
  account_code text not null check (account_code in ('cash_received','unallocated_funds','credit_contra_revenue','credit_available','accounts_receivable_control','fx_clearing','refunds_payable')),
  entry_side text not null check (entry_side in ('debit','credit')),
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  foreign key (journal_id,business_id) references public.payment_ledger_journals(id,business_id) on delete restrict
);
create index if not exists payment_ledger_entries_journal_idx on public.payment_ledger_entries(journal_id,currency);

create table if not exists public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  receipt_id uuid not null,
  event_type text not null check (event_type in ('allocation','reversal')),
  reverses_allocation_id uuid references public.payment_allocations(id) on delete restrict,
  case_id text not null,
  obligation_id uuid,
  receipt_amount_minor bigint not null check (receipt_amount_minor > 0),
  receipt_currency char(3) not null check (receipt_currency ~ '^[A-Z]{3}$'),
  target_amount_minor bigint not null check (target_amount_minor > 0),
  target_currency char(3) not null check (target_currency ~ '^[A-Z]{3}$'),
  overpayment_minor bigint not null default 0 check (overpayment_minor >= 0 and overpayment_minor <= target_amount_minor),
  exchange_rate_id uuid,
  payment_id uuid references public.payments(id) on delete restrict,
  case_financial_event_id uuid not null references public.case_financial_events(id) on delete restrict,
  journal_id uuid not null references public.payment_ledger_journals(id) on delete restrict,
  reason text,
  approval_request_id uuid references public.payment_allocation_approval_requests(id) on delete restrict,
  idempotency_key text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (receipt_id,business_id) references public.payment_receipts(id,business_id) on delete restrict,
  foreign key (case_id,business_id) references public.cases(id,business_id) on delete restrict,
  foreign key (exchange_rate_id,business_id) references public.payment_exchange_rates(id,business_id) on delete restrict,
  check ((event_type='allocation' and reverses_allocation_id is null) or (event_type='reversal' and reverses_allocation_id is not null)),
  check ((receipt_currency=target_currency and exchange_rate_id is null and receipt_amount_minor=target_amount_minor) or (receipt_currency<>target_currency and exchange_rate_id is not null)),
  unique (business_id,idempotency_key),
  unique (reverses_allocation_id),
  unique (case_financial_event_id),
  unique (journal_id),
  unique (id,business_id)
);
create index if not exists payment_allocations_receipt_idx on public.payment_allocations(receipt_id,created_at,id);
create index if not exists payment_allocations_case_idx on public.payment_allocations(business_id,case_id,created_at);
create index if not exists payment_allocations_obligation_idx on public.payment_allocations(business_id,obligation_id) where obligation_id is not null;

create table if not exists public.payment_refunds (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  receipt_id uuid not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  reason text not null check (char_length(btrim(reason)) between 3 and 1000),
  journal_id uuid not null references public.payment_ledger_journals(id) on delete restrict,
  external_reference text,
  idempotency_key text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (receipt_id,business_id) references public.payment_receipts(id,business_id) on delete restrict,
  unique (business_id,idempotency_key),
  unique (journal_id),
  unique (id,business_id)
);

create table if not exists public.payment_receipt_reversals (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  receipt_id uuid not null,
  reason text not null check (char_length(btrim(reason)) between 3 and 1000),
  journal_id uuid not null references public.payment_ledger_journals(id) on delete restrict,
  idempotency_key text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (receipt_id,business_id) references public.payment_receipts(id,business_id) on delete restrict,
  unique (receipt_id),
  unique (business_id,idempotency_key),
  unique (journal_id),
  unique (id,business_id)
);

create table if not exists public.accounting_payment_operation_outbox (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  connection_id uuid not null,
  provider text not null check (provider in ('xero','quickbooks')),
  operation_type text not null check (operation_type in ('allocation','allocation_reversal','refund','receipt_reversal')),
  source_table text not null,
  source_id uuid not null,
  payload jsonb not null check (jsonb_typeof(payload)='object'),
  idempotency_key text not null,
  status text not null default 'pending' check (status in ('pending','processing','synced','failed','configuration_required')),
  attempts integer not null default 0 check (attempts>=0),
  next_attempt_at timestamptz not null default now(),
  external_record_id text,
  last_error_code text,
  last_error_message text,
  locked_at timestamptz,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (connection_id,business_id) references public.accounting_connections(id,business_id) on delete restrict,
  unique (connection_id,idempotency_key),
  unique (id,business_id)
);
create index if not exists accounting_payment_outbox_queue_idx on public.accounting_payment_operation_outbox(status,next_attempt_at,created_at) where status in ('pending','failed');

create table if not exists public.payment_operation_idempotency_keys (
  business_id uuid not null references public.businesses(id) on delete restrict,
  action_scope text not null,
  idempotency_key text not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  response jsonb not null check (jsonb_typeof(response)='object'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (business_id,action_scope,idempotency_key)
);

create or replace function public.payment_operation_append_only()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin raise exception 'P17_APPEND_ONLY'; end; $$;

do $$ declare v_table text; begin
  foreach v_table in array array['payment_receipts','payment_exchange_rates','payment_ledger_journals','payment_ledger_entries','payment_allocations','payment_refunds','payment_receipt_reversals'] loop
    execute format('drop trigger if exists %I on public.%I','p17_'||v_table||'_append_only',v_table);
    execute format('create trigger %I before update or delete on public.%I for each row execute function public.payment_operation_append_only()','p17_'||v_table||'_append_only',v_table);
  end loop;
end $$;

create or replace function public.payment_operation_create_journal(
  p_business_id uuid,p_operation_type text,p_source_table text,p_source_id uuid,p_idempotency_key text,p_entries jsonb,p_actor_id uuid
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_journal_id uuid:=gen_random_uuid(); v_entry jsonb;
begin
  if jsonb_typeof(p_entries)<>'array' or jsonb_array_length(p_entries)<2 or jsonb_array_length(p_entries)>8 then raise exception 'P17_INVALID_JOURNAL'; end if;
  if exists(
    select 1 from (
      select value->>'currency' currency,
        sum(case value->>'side' when 'debit' then (value->>'amountMinor')::bigint when 'credit' then -(value->>'amountMinor')::bigint else 1 end) balance
      from jsonb_array_elements(p_entries) group by value->>'currency'
    ) x where x.currency is null or x.currency !~ '^[A-Z]{3}$' or x.balance<>0
  ) then raise exception 'P17_UNBALANCED_JOURNAL'; end if;
  insert into public.payment_ledger_journals(id,business_id,operation_type,source_table,source_id,idempotency_key,created_by)
    values(v_journal_id,p_business_id,p_operation_type,p_source_table,p_source_id,p_idempotency_key,p_actor_id);
  for v_entry in select value from jsonb_array_elements(p_entries) loop
    if (v_entry->>'amountMinor')::bigint<=0 then raise exception 'P17_INVALID_JOURNAL'; end if;
    insert into public.payment_ledger_entries(journal_id,business_id,account_code,entry_side,amount_minor,currency)
      values(v_journal_id,p_business_id,v_entry->>'account',v_entry->>'side',(v_entry->>'amountMinor')::bigint,v_entry->>'currency');
  end loop;
  return v_journal_id;
end; $$;

create or replace view public.payment_receipt_positions with (security_invoker=true) as
with allocation_totals as (
  select a.receipt_id,
    coalesce(sum(case when a.event_type='allocation' then a.receipt_amount_minor else -a.receipt_amount_minor end),0)::bigint allocated_minor,
    coalesce(sum(case when a.event_type='allocation' then a.overpayment_minor else -a.overpayment_minor end),0)::bigint overpayment_minor
  from public.payment_allocations a group by a.receipt_id
), refund_totals as (
  select receipt_id,sum(amount_minor)::bigint refunded_minor from public.payment_refunds group by receipt_id
)
select r.id,r.business_id,r.receipt_kind,r.amount_minor,r.currency,r.received_at,r.reference,r.source_type,r.source_system,r.source_record_id,
  coalesce(a.allocated_minor,0)::bigint allocated_minor,coalesce(f.refunded_minor,0)::bigint refunded_minor,
  case when rr.id is null then greatest(r.amount_minor-coalesce(a.allocated_minor,0)-coalesce(f.refunded_minor,0),0) else 0 end::bigint unallocated_minor,
  coalesce(a.overpayment_minor,0)::bigint overpayment_minor,
  case when rr.id is not null then 'reversed'
    when coalesce(f.refunded_minor,0)=r.amount_minor then 'refunded'
    when coalesce(a.overpayment_minor,0)>0 then 'overpaid'
    when coalesce(a.allocated_minor,0)=0 then 'unallocated'
    when coalesce(a.allocated_minor,0)+coalesce(f.refunded_minor,0)<r.amount_minor then 'partially_allocated'
    else 'fully_allocated' end state
from public.payment_receipts r
left join allocation_totals a on a.receipt_id=r.id
left join refund_totals f on f.receipt_id=r.id
left join public.payment_receipt_reversals rr on rr.receipt_id=r.id;

create or replace function public.payment_operation_record_receipt(
  p_business_id uuid,p_actor_id uuid,p_receipt_kind text,p_amount_minor bigint,p_currency text,p_received_at timestamptz,
  p_source_type text,p_source_system text,p_source_record_id text,p_normalized_transaction_id uuid,p_reference text,p_payer_name text,
  p_metadata jsonb,p_idempotency_key text,p_request_hash text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_receipt public.payment_receipts; v_journal uuid; v_existing public.payment_operation_idempotency_keys;
  v_available_account text; v_debit_account text; v_response jsonb;
begin
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id);
  if v_role not in ('owner','admin','manager') then raise exception 'P17_PERMISSION_DENIED'; end if;
  select * into v_existing from public.payment_operation_idempotency_keys where business_id=p_business_id and action_scope='record_receipt' and idempotency_key=p_idempotency_key;
  if found then if v_existing.request_hash<>p_request_hash then raise exception 'P17_IDEMPOTENCY_CONFLICT'; end if; return v_existing.response||jsonb_build_object('idempotent_replay',true); end if;
  if p_amount_minor<=0 or upper(p_currency)!~'^[A-Z]{3}$' or p_receipt_kind not in ('payment','credit') then raise exception 'P17_INVALID_RECEIPT'; end if;
  insert into public.payment_receipts(business_id,receipt_kind,amount_minor,currency,received_at,source_type,source_system,source_record_id,normalized_transaction_id,reference,payer_name,metadata,idempotency_key,request_hash,created_by)
    values(p_business_id,p_receipt_kind,p_amount_minor,upper(p_currency),p_received_at,p_source_type,btrim(p_source_system),btrim(p_source_record_id),p_normalized_transaction_id,nullif(btrim(p_reference),''),nullif(btrim(p_payer_name),''),coalesce(p_metadata,'{}'),p_idempotency_key,p_request_hash,p_actor_id) returning * into v_receipt;
  v_debit_account:=case when p_receipt_kind='payment' then 'cash_received' else 'credit_contra_revenue' end;
  v_available_account:=case when p_receipt_kind='payment' then 'unallocated_funds' else 'credit_available' end;
  v_journal:=public.payment_operation_create_journal(p_business_id,'receipt','payment_receipts',v_receipt.id,'receipt:'||p_idempotency_key,
    jsonb_build_array(jsonb_build_object('account',v_debit_account,'side','debit','amountMinor',p_amount_minor,'currency',upper(p_currency)),jsonb_build_object('account',v_available_account,'side','credit','amountMinor',p_amount_minor,'currency',upper(p_currency))),p_actor_id);
  v_response:=jsonb_build_object('receipt_id',v_receipt.id,'journal_id',v_journal,'state','unallocated','idempotent_replay',false);
  insert into public.payment_operation_idempotency_keys values(p_business_id,'record_receipt',p_idempotency_key,p_request_hash,v_response,p_actor_id,now());
  insert into public.audit_logs(business_id,action,actor_type,actor_id,actor_role,entity_type,entity_id,idempotency_key,metadata)
    values(p_business_id,'payment.receipt_recorded','staff',p_actor_id,v_role,'payment_receipt',v_receipt.id::text,p_idempotency_key,jsonb_build_object('amount_minor',p_amount_minor,'currency',upper(p_currency),'receipt_kind',p_receipt_kind));
  return v_response;
end; $$;

create or replace function public.payment_operation_allocate(
  p_business_id uuid,p_receipt_id uuid,p_actor_id uuid,p_allocations jsonb,p_reason text,p_approval_request_id uuid,p_idempotency_key text,p_request_hash text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_receipt public.payment_receipts; v_position record; v_existing public.payment_operation_idempotency_keys; v_item jsonb; v_case public.cases; v_obligation public.obligations;
  v_rate public.payment_exchange_rates; v_allocation_id uuid; v_payment public.payments; v_event_id uuid; v_journal uuid; v_receipt_amount bigint; v_target_amount bigint; v_total bigint:=0; v_count integer:=0;
  v_overpayment bigint; v_available_account text; v_event_type text; v_entries jsonb; v_response jsonb; v_approval public.payment_allocation_approval_requests; v_threshold bigint; v_unusual boolean:=false;
begin
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id);
  if v_role not in ('owner','admin','manager') then raise exception 'P17_PERMISSION_DENIED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':receipt:'||p_receipt_id::text,0));
  select * into v_existing from public.payment_operation_idempotency_keys where business_id=p_business_id and action_scope='allocate' and idempotency_key=p_idempotency_key;
  if found then if v_existing.request_hash<>p_request_hash then raise exception 'P17_IDEMPOTENCY_CONFLICT'; end if; return v_existing.response||jsonb_build_object('idempotent_replay',true); end if;
  select * into v_receipt from public.payment_receipts where id=p_receipt_id and business_id=p_business_id for update;
  if not found then raise exception 'P17_RECEIPT_NOT_FOUND'; end if;
  select * into v_position from public.payment_receipt_positions where id=p_receipt_id;
  if v_position.state='reversed' then raise exception 'P17_RECEIPT_REVERSED'; end if;
  if jsonb_typeof(p_allocations)<>'array' or jsonb_array_length(p_allocations)<1 or jsonb_array_length(p_allocations)>20 then raise exception 'P17_INVALID_ALLOCATION'; end if;
  select coalesce(sum((value->>'receiptAmountMinor')::bigint),0) into v_total from jsonb_array_elements(p_allocations);
  if v_total<=0 or v_total>v_position.unallocated_minor then raise exception 'P17_AVAILABLE_AMOUNT_EXCEEDED'; end if;
  select unusual_reallocation_threshold_minor into v_threshold from public.payment_operation_settings where business_id=p_business_id;
  select exists(select 1 from jsonb_array_elements(p_allocations) proposed
    where nullif(proposed->>'exchangeRateId','') is not null or not exists(
      select 1 from public.payment_allocations original
      where original.receipt_id=p_receipt_id and original.event_type='allocation'
        and exists(select 1 from public.payment_allocations reversed where reversed.reverses_allocation_id=original.id)
        and original.case_id=proposed->>'caseId'
        and original.obligation_id is not distinct from nullif(proposed->>'obligationId','')::uuid
    )) into v_unusual;
  if exists(select 1 from public.payment_allocations where receipt_id=p_receipt_id and event_type='reversal') and (v_total>=coalesce(v_threshold,1000000) or v_unusual) then
    select * into v_approval from public.payment_allocation_approval_requests where id=p_approval_request_id and business_id=p_business_id and receipt_id=p_receipt_id and status='approved' for update;
    if not found or v_approval.proposed_allocations is distinct from p_allocations then raise exception 'P17_REALLOCATION_APPROVAL_REQUIRED'; end if;
    update public.payment_allocation_approval_requests set status='consumed',consumed_at=now() where id=v_approval.id;
  end if;
  v_available_account:=case when v_receipt.receipt_kind='payment' then 'unallocated_funds' else 'credit_available' end;
  for v_item in select value from jsonb_array_elements(p_allocations) loop
    v_receipt_amount:=(v_item->>'receiptAmountMinor')::bigint; v_target_amount:=(v_item->>'targetAmountMinor')::bigint;
    if v_receipt_amount<=0 or v_target_amount<=0 then raise exception 'P17_INVALID_ALLOCATION'; end if;
    select * into v_case from public.cases where id=v_item->>'caseId' and business_id=p_business_id and archived_at is null for update;
    if not found then raise exception 'P17_CASE_NOT_FOUND'; end if;
    if nullif(v_item->>'obligationId','') is not null then
      select o.* into v_obligation from public.obligations o join public.recovery_case_obligations r on r.obligation_id=o.id and r.case_id=v_case.id
        where o.id=(v_item->>'obligationId')::uuid and o.business_id=p_business_id and o.archived_at is null for update;
      if not found then raise exception 'P17_OBLIGATION_NOT_FOUND'; end if;
      if v_obligation.currency<>v_case.currency then raise exception 'P17_TARGET_CURRENCY_MISMATCH'; end if;
    end if;
    if v_receipt.currency=v_case.currency then
      if nullif(v_item->>'exchangeRateId','') is not null or v_receipt_amount<>v_target_amount then raise exception 'P17_SILENT_CURRENCY_CONVERSION'; end if;
      v_entries:=jsonb_build_array(jsonb_build_object('account',v_available_account,'side','debit','amountMinor',v_receipt_amount,'currency',v_receipt.currency),jsonb_build_object('account','accounts_receivable_control','side','credit','amountMinor',v_target_amount,'currency',v_case.currency));
    else
      select * into v_rate from public.payment_exchange_rates where id=nullif(v_item->>'exchangeRateId','')::uuid and business_id=p_business_id and source_currency=v_receipt.currency and target_currency=v_case.currency;
      if not found or round(v_receipt_amount::numeric*v_rate.numerator/v_rate.denominator)::bigint<>v_target_amount then raise exception 'P17_EXCHANGE_RATE_REQUIRED'; end if;
      v_entries:=jsonb_build_array(
        jsonb_build_object('account',v_available_account,'side','debit','amountMinor',v_receipt_amount,'currency',v_receipt.currency),jsonb_build_object('account','fx_clearing','side','credit','amountMinor',v_receipt_amount,'currency',v_receipt.currency),
        jsonb_build_object('account','fx_clearing','side','debit','amountMinor',v_target_amount,'currency',v_case.currency),jsonb_build_object('account','accounts_receivable_control','side','credit','amountMinor',v_target_amount,'currency',v_case.currency));
    end if;
    v_allocation_id:=gen_random_uuid(); v_overpayment:=greatest(v_target_amount-v_case.outstanding_minor,0);
    v_journal:=public.payment_operation_create_journal(p_business_id,'allocation','payment_allocations',v_allocation_id,'allocation:'||p_idempotency_key||':'||v_count,v_entries,p_actor_id);
    v_event_type:=case when v_receipt.receipt_kind='payment' then 'payment_approved' else 'adjustment_credit' end;
    if v_receipt.receipt_kind='payment' then
      insert into public.payments(case_id,amount,amount_minor,currency,payment_method,reference_no,review_status,reviewed_at,reviewed_by,notes)
        values(v_case.id,public.currency_minor_to_major(v_target_amount,v_case.currency),v_target_amount,v_case.currency,'bank_transfer',left(v_receipt.reference,255),'approved',now(),p_actor_id,'Allocated from payment receipt '||v_receipt.id) returning * into v_payment;
    else v_payment:=null; end if;
    insert into public.case_financial_events(case_id,event_type,amount_minor,currency,source_table,source_id,note,created_by)
      values(v_case.id,v_event_type,v_target_amount,v_case.currency,'payment_allocations',v_allocation_id,coalesce(nullif(btrim(p_reason),''),'Approved payment allocation'),p_actor_id) returning id into v_event_id;
    if v_payment.id is not null then update public.payments set financial_event_id=v_event_id where id=v_payment.id; end if;
    insert into public.payment_allocations(id,business_id,receipt_id,event_type,case_id,obligation_id,receipt_amount_minor,receipt_currency,target_amount_minor,target_currency,overpayment_minor,exchange_rate_id,payment_id,case_financial_event_id,journal_id,reason,approval_request_id,idempotency_key,created_by)
      values(v_allocation_id,p_business_id,p_receipt_id,'allocation',v_case.id,nullif(v_item->>'obligationId','')::uuid,v_receipt_amount,v_receipt.currency,v_target_amount,v_case.currency,v_overpayment,nullif(v_item->>'exchangeRateId','')::uuid,v_payment.id,v_event_id,v_journal,nullif(btrim(p_reason),''),p_approval_request_id,p_idempotency_key||':'||v_count,p_actor_id);
    perform public.financial_recalculate_case(v_case.id);
    insert into public.accounting_payment_operation_outbox(business_id,connection_id,provider,operation_type,source_table,source_id,payload,idempotency_key)
      select p_business_id,c.id,c.provider,'allocation','payment_allocations',v_allocation_id,jsonb_build_object('allocationId',v_allocation_id,'receiptId',p_receipt_id,'caseId',v_case.id,'obligationId',nullif(v_item->>'obligationId',''),'amountMinor',v_target_amount,'currency',v_case.currency,'receivedOn',v_receipt.received_at::date,'reference',v_receipt.reference),p_idempotency_key||':'||v_count
      from public.accounting_connections c where c.business_id=p_business_id and c.status in ('connected','error');
    v_count:=v_count+1;
  end loop;
  select * into v_position from public.payment_receipt_positions where id=p_receipt_id;
  v_response:=jsonb_build_object('receipt_id',p_receipt_id,'allocation_count',v_count,'state',v_position.state,'allocated_minor',v_position.allocated_minor,'unallocated_minor',v_position.unallocated_minor,'idempotent_replay',false);
  insert into public.payment_operation_idempotency_keys values(p_business_id,'allocate',p_idempotency_key,p_request_hash,v_response,p_actor_id,now());
  insert into public.audit_logs(business_id,action,actor_type,actor_id,actor_role,entity_type,entity_id,idempotency_key,metadata)
    values(p_business_id,'payment.allocated','staff',p_actor_id,v_role,'payment_receipt',p_receipt_id::text,p_idempotency_key,jsonb_build_object('allocation_count',v_count,'receipt_amount_minor',v_total,'reason',nullif(btrim(p_reason),'')));
  return v_response;
end; $$;

create or replace function public.payment_operation_reverse_allocation(
  p_business_id uuid,p_allocation_id uuid,p_actor_id uuid,p_reason text,p_idempotency_key text,p_request_hash text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_original public.payment_allocations; v_receipt public.payment_receipts; v_existing public.payment_operation_idempotency_keys; v_reversal_id uuid:=gen_random_uuid(); v_event_id uuid; v_journal uuid; v_entries jsonb; v_response jsonb;
begin
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id); if v_role not in ('owner','admin','manager') then raise exception 'P17_PERMISSION_DENIED'; end if;
  if char_length(btrim(coalesce(p_reason,'')))<3 then raise exception 'P17_REASON_REQUIRED'; end if;
  select * into v_existing from public.payment_operation_idempotency_keys where business_id=p_business_id and action_scope='reverse_allocation' and idempotency_key=p_idempotency_key;
  if found then if v_existing.request_hash<>p_request_hash then raise exception 'P17_IDEMPOTENCY_CONFLICT'; end if; return v_existing.response||jsonb_build_object('idempotent_replay',true); end if;
  select * into v_original from public.payment_allocations where id=p_allocation_id and business_id=p_business_id and event_type='allocation' for update;
  if not found then raise exception 'P17_ALLOCATION_NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':receipt:'||v_original.receipt_id::text,0));
  if exists(select 1 from public.payment_allocations where reverses_allocation_id=p_allocation_id) then raise exception 'P17_ALLOCATION_ALREADY_REVERSED'; end if;
  select * into v_receipt from public.payment_receipts where id=v_original.receipt_id for update;
  v_entries:=case when v_original.receipt_currency=v_original.target_currency then jsonb_build_array(
    jsonb_build_object('account','accounts_receivable_control','side','debit','amountMinor',v_original.target_amount_minor,'currency',v_original.target_currency),jsonb_build_object('account',case when v_receipt.receipt_kind='payment' then 'unallocated_funds' else 'credit_available' end,'side','credit','amountMinor',v_original.receipt_amount_minor,'currency',v_original.receipt_currency)) else jsonb_build_array(
    jsonb_build_object('account','accounts_receivable_control','side','debit','amountMinor',v_original.target_amount_minor,'currency',v_original.target_currency),jsonb_build_object('account','fx_clearing','side','credit','amountMinor',v_original.target_amount_minor,'currency',v_original.target_currency),
    jsonb_build_object('account','fx_clearing','side','debit','amountMinor',v_original.receipt_amount_minor,'currency',v_original.receipt_currency),jsonb_build_object('account',case when v_receipt.receipt_kind='payment' then 'unallocated_funds' else 'credit_available' end,'side','credit','amountMinor',v_original.receipt_amount_minor,'currency',v_original.receipt_currency)) end;
  v_journal:=public.payment_operation_create_journal(p_business_id,'allocation_reversal','payment_allocations',v_reversal_id,'allocation-reversal:'||p_idempotency_key,v_entries,p_actor_id);
  insert into public.case_financial_events(case_id,event_type,amount_minor,currency,source_table,source_id,note,created_by)
    values(v_original.case_id,case when v_receipt.receipt_kind='payment' then 'payment_reversal' else 'adjustment_debit' end,v_original.target_amount_minor,v_original.target_currency,'payment_allocations',v_reversal_id,btrim(p_reason),p_actor_id) returning id into v_event_id;
  insert into public.payment_allocations(id,business_id,receipt_id,event_type,reverses_allocation_id,case_id,obligation_id,receipt_amount_minor,receipt_currency,target_amount_minor,target_currency,overpayment_minor,exchange_rate_id,payment_id,case_financial_event_id,journal_id,reason,idempotency_key,created_by)
    values(v_reversal_id,p_business_id,v_original.receipt_id,'reversal',v_original.id,v_original.case_id,v_original.obligation_id,v_original.receipt_amount_minor,v_original.receipt_currency,v_original.target_amount_minor,v_original.target_currency,v_original.overpayment_minor,v_original.exchange_rate_id,v_original.payment_id,v_event_id,v_journal,btrim(p_reason),p_idempotency_key,p_actor_id);
  if v_original.payment_id is not null then update public.payments set review_status='reversed',reversed_at=now(),reversed_by=p_actor_id,reversal_reason=btrim(p_reason) where id=v_original.payment_id; end if;
  perform public.financial_recalculate_case(v_original.case_id);
  insert into public.accounting_payment_operation_outbox(business_id,connection_id,provider,operation_type,source_table,source_id,payload,idempotency_key)
    select p_business_id,c.id,c.provider,'allocation_reversal','payment_allocations',v_reversal_id,jsonb_build_object('reversalId',v_reversal_id,'reversesAllocationId',v_original.id,'caseId',v_original.case_id,'obligationId',v_original.obligation_id,'amountMinor',v_original.target_amount_minor,'currency',v_original.target_currency,'reason',btrim(p_reason)),p_idempotency_key
    from public.accounting_connections c where c.business_id=p_business_id and c.status in ('connected','error');
  v_response:=jsonb_build_object('reversal_id',v_reversal_id,'allocation_id',v_original.id,'receipt_id',v_original.receipt_id,'reason',btrim(p_reason),'actor_id',p_actor_id,'idempotent_replay',false);
  insert into public.payment_operation_idempotency_keys values(p_business_id,'reverse_allocation',p_idempotency_key,p_request_hash,v_response,p_actor_id,now());
  insert into public.audit_logs(business_id,case_id,action,actor_type,actor_id,actor_role,entity_type,entity_id,idempotency_key,metadata)
    values(p_business_id,v_original.case_id,'payment.allocation_reversed','staff',p_actor_id,v_role,'payment_allocation',v_original.id::text,p_idempotency_key,jsonb_build_object('reversal_id',v_reversal_id,'reason',btrim(p_reason)));
  return v_response;
end; $$;

create or replace function public.payment_operation_refund(
  p_business_id uuid,p_receipt_id uuid,p_actor_id uuid,p_amount_minor bigint,p_reason text,p_external_reference text,p_idempotency_key text,p_request_hash text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_receipt public.payment_receipts; v_position record; v_existing public.payment_operation_idempotency_keys; v_refund_id uuid:=gen_random_uuid(); v_journal uuid; v_response jsonb;
begin
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id); if v_role not in ('owner','admin','manager') then raise exception 'P17_PERMISSION_DENIED'; end if;
  if p_amount_minor<=0 or char_length(btrim(coalesce(p_reason,'')))<3 then raise exception 'P17_INVALID_REFUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':receipt:'||p_receipt_id::text,0));
  select * into v_existing from public.payment_operation_idempotency_keys where business_id=p_business_id and action_scope='refund' and idempotency_key=p_idempotency_key;
  if found then if v_existing.request_hash<>p_request_hash then raise exception 'P17_IDEMPOTENCY_CONFLICT'; end if; return v_existing.response||jsonb_build_object('idempotent_replay',true); end if;
  select * into v_receipt from public.payment_receipts where id=p_receipt_id and business_id=p_business_id and receipt_kind='payment' for update; if not found then raise exception 'P17_RECEIPT_NOT_FOUND'; end if;
  select * into v_position from public.payment_receipt_positions where id=p_receipt_id;
  if v_position.state='reversed' or p_amount_minor>v_position.unallocated_minor then raise exception 'P17_REFUND_REQUIRES_UNALLOCATED_FUNDS'; end if;
  v_journal:=public.payment_operation_create_journal(p_business_id,'refund','payment_refunds',v_refund_id,'refund:'||p_idempotency_key,jsonb_build_array(
    jsonb_build_object('account','unallocated_funds','side','debit','amountMinor',p_amount_minor,'currency',v_receipt.currency),jsonb_build_object('account','cash_received','side','credit','amountMinor',p_amount_minor,'currency',v_receipt.currency)),p_actor_id);
  insert into public.payment_refunds(id,business_id,receipt_id,amount_minor,currency,reason,journal_id,external_reference,idempotency_key,created_by)
    values(v_refund_id,p_business_id,p_receipt_id,p_amount_minor,v_receipt.currency,btrim(p_reason),v_journal,nullif(btrim(p_external_reference),''),p_idempotency_key,p_actor_id);
  insert into public.accounting_payment_operation_outbox(business_id,connection_id,provider,operation_type,source_table,source_id,payload,idempotency_key)
    select p_business_id,c.id,c.provider,'refund','payment_refunds',v_refund_id,jsonb_build_object('refundId',v_refund_id,'receiptId',p_receipt_id,'amountMinor',p_amount_minor,'currency',v_receipt.currency,'reason',btrim(p_reason),'externalReference',nullif(btrim(p_external_reference),'')),p_idempotency_key
    from public.accounting_connections c where c.business_id=p_business_id and c.status in ('connected','error');
  select * into v_position from public.payment_receipt_positions where id=p_receipt_id;
  v_response:=jsonb_build_object('refund_id',v_refund_id,'receipt_id',p_receipt_id,'state',v_position.state,'refunded_minor',v_position.refunded_minor,'unallocated_minor',v_position.unallocated_minor,'idempotent_replay',false);
  insert into public.payment_operation_idempotency_keys values(p_business_id,'refund',p_idempotency_key,p_request_hash,v_response,p_actor_id,now());
  insert into public.audit_logs(business_id,action,actor_type,actor_id,actor_role,entity_type,entity_id,idempotency_key,metadata)
    values(p_business_id,'payment.refunded','staff',p_actor_id,v_role,'payment_receipt',p_receipt_id::text,p_idempotency_key,jsonb_build_object('refund_id',v_refund_id,'amount_minor',p_amount_minor,'reason',btrim(p_reason)));
  return v_response;
end; $$;

create or replace function public.payment_operation_decide_approval(p_business_id uuid,p_request_id uuid,p_actor_id uuid,p_decision text,p_reason text)
returns public.payment_allocation_approval_requests language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_request public.payment_allocation_approval_requests;
begin
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id); if v_role not in ('owner','admin') then raise exception 'P17_APPROVAL_PERMISSION_DENIED'; end if;
  if p_decision not in ('approved','rejected') or char_length(btrim(coalesce(p_reason,'')))<3 then raise exception 'P17_INVALID_APPROVAL_DECISION'; end if;
  select * into v_request from public.payment_allocation_approval_requests where id=p_request_id and business_id=p_business_id for update;
  if not found then raise exception 'P17_APPROVAL_NOT_FOUND'; end if; if v_request.status<>'pending' then raise exception 'P17_APPROVAL_ALREADY_DECIDED'; end if;
  if v_request.requested_by=p_actor_id then raise exception 'P17_SELF_APPROVAL_FORBIDDEN'; end if;
  update public.payment_allocation_approval_requests set status=p_decision,decided_by=p_actor_id,decision_reason=btrim(p_reason),decided_at=now() where id=p_request_id returning * into v_request;
  insert into public.audit_logs(business_id,action,actor_type,actor_id,actor_role,entity_type,entity_id,metadata)
    values(p_business_id,'payment.reallocation_'||p_decision,'staff',p_actor_id,v_role,'payment_allocation_approval',p_request_id::text,jsonb_build_object('reason',btrim(p_reason),'requested_by',v_request.requested_by));
  return v_request;
end; $$;

create or replace function public.payment_operation_reverse_receipt(
  p_business_id uuid,p_receipt_id uuid,p_actor_id uuid,p_reason text,p_idempotency_key text,p_request_hash text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_receipt public.payment_receipts; v_position record; v_existing public.payment_operation_idempotency_keys; v_reversal_id uuid:=gen_random_uuid(); v_journal uuid; v_response jsonb; v_available text; v_origin text;
begin
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id); if v_role not in ('owner','admin','manager') then raise exception 'P17_PERMISSION_DENIED'; end if;
  if char_length(btrim(coalesce(p_reason,'')))<3 then raise exception 'P17_REASON_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':receipt:'||p_receipt_id::text,0));
  select * into v_existing from public.payment_operation_idempotency_keys where business_id=p_business_id and action_scope='reverse_receipt' and idempotency_key=p_idempotency_key;
  if found then if v_existing.request_hash<>p_request_hash then raise exception 'P17_IDEMPOTENCY_CONFLICT'; end if; return v_existing.response||jsonb_build_object('idempotent_replay',true); end if;
  select * into v_receipt from public.payment_receipts where id=p_receipt_id and business_id=p_business_id for update; if not found then raise exception 'P17_RECEIPT_NOT_FOUND'; end if;
  select * into v_position from public.payment_receipt_positions where id=p_receipt_id;
  if v_position.state='reversed' then raise exception 'P17_RECEIPT_ALREADY_REVERSED'; end if;
  if v_position.allocated_minor<>0 or v_position.refunded_minor<>0 then raise exception 'P17_RECEIPT_REVERSAL_REQUIRES_UNALLOCATED_FUNDS'; end if;
  v_available:=case when v_receipt.receipt_kind='payment' then 'unallocated_funds' else 'credit_available' end;
  v_origin:=case when v_receipt.receipt_kind='payment' then 'cash_received' else 'credit_contra_revenue' end;
  v_journal:=public.payment_operation_create_journal(p_business_id,'receipt_reversal','payment_receipt_reversals',v_reversal_id,'receipt-reversal:'||p_idempotency_key,jsonb_build_array(
    jsonb_build_object('account',v_available,'side','debit','amountMinor',v_receipt.amount_minor,'currency',v_receipt.currency),jsonb_build_object('account',v_origin,'side','credit','amountMinor',v_receipt.amount_minor,'currency',v_receipt.currency)),p_actor_id);
  insert into public.payment_receipt_reversals(id,business_id,receipt_id,reason,journal_id,idempotency_key,created_by)
    values(v_reversal_id,p_business_id,p_receipt_id,btrim(p_reason),v_journal,p_idempotency_key,p_actor_id);
  insert into public.accounting_payment_operation_outbox(business_id,connection_id,provider,operation_type,source_table,source_id,payload,idempotency_key)
    select p_business_id,c.id,c.provider,'receipt_reversal','payment_receipt_reversals',v_reversal_id,jsonb_build_object('reversalId',v_reversal_id,'receiptId',p_receipt_id,'amountMinor',v_receipt.amount_minor,'currency',v_receipt.currency,'reason',btrim(p_reason)),p_idempotency_key
    from public.accounting_connections c where c.business_id=p_business_id and c.status in ('connected','error');
  v_response:=jsonb_build_object('reversal_id',v_reversal_id,'receipt_id',p_receipt_id,'state','reversed','reason',btrim(p_reason),'actor_id',p_actor_id,'idempotent_replay',false);
  insert into public.payment_operation_idempotency_keys values(p_business_id,'reverse_receipt',p_idempotency_key,p_request_hash,v_response,p_actor_id,now());
  insert into public.audit_logs(business_id,action,actor_type,actor_id,actor_role,entity_type,entity_id,idempotency_key,metadata)
    values(p_business_id,'payment.receipt_reversed','staff',p_actor_id,v_role,'payment_receipt',p_receipt_id::text,p_idempotency_key,jsonb_build_object('reversal_id',v_reversal_id,'reason',btrim(p_reason)));
  return v_response;
end; $$;

create or replace function public.payment_operation_reconciliation(p_business_id uuid,p_from timestamptz,p_to timestamptz)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_result jsonb;
begin
  if not (public.has_business_permission(p_business_id,'report.read') or public.has_business_permission(p_business_id,'payment.approve')) then raise exception 'P17_PERMISSION_DENIED'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.currency),'[]'::jsonb) into v_result from (
    select p.currency,sum(p.amount_minor)::bigint imported_total,
      sum(p.allocated_minor)::bigint allocated_total,sum(p.unallocated_minor)::bigint unallocated_total,
      sum(p.refunded_minor)::bigint refunded_total,sum(case when p.state='reversed' then p.amount_minor else 0 end)::bigint reversed_total,
      coalesce((select sum(a.receipt_amount_minor)::bigint
        from public.payment_allocations a where a.business_id=p_business_id and a.receipt_currency=p.currency and a.created_at>=p_from and a.created_at<p_to
          and exists(select 1 from public.accounting_payment_operation_outbox o where o.source_id=a.id and o.status<>'synced')),0)::bigint integration_difference
    from public.payment_receipt_positions p where p.business_id=p_business_id and p.received_at>=p_from and p.received_at<p_to group by p.currency
  ) x;
  return jsonb_build_object('business_id',p_business_id,'from',p_from,'to',p_to,'currencies',v_result,'generated_at',now());
end; $$;

alter table public.payment_match_allocations
  add column if not exists payment_operation_allocation_id uuid references public.payment_allocations(id) on delete restrict;
create unique index if not exists payment_match_allocations_operation_unique
  on public.payment_match_allocations(payment_operation_allocation_id) where payment_operation_allocation_id is not null;

create or replace function public.payment_operation_capture_matched_allocation()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_transaction public.normalized_payment_transactions; v_receipt public.payment_receipts; v_case public.cases; v_payment public.payments;
  v_receipt_journal uuid; v_allocation_id uuid:=gen_random_uuid(); v_allocation_journal uuid; v_request_hash text; v_overpayment bigint;
begin
  select * into v_transaction from public.normalized_payment_transactions where id=new.transaction_id and business_id=new.business_id;
  select * into v_case from public.cases where id=new.case_id and business_id=new.business_id for update;
  select * into v_payment from public.payments where id=new.payment_id and case_id=new.case_id;
  if v_transaction is null or v_case is null or v_payment is null or v_payment.financial_event_id is null then raise exception 'P17_MATCHED_ALLOCATION_INCOMPLETE'; end if;
  v_request_hash:=encode(digest(v_transaction.id::text,'sha256'),'hex');
  select * into v_receipt from public.payment_receipts where business_id=new.business_id and normalized_transaction_id=new.transaction_id;
  if not found then
    insert into public.payment_receipts(business_id,receipt_kind,amount_minor,currency,received_at,source_type,source_system,source_record_id,normalized_transaction_id,reference,payer_name,metadata,idempotency_key,request_hash,created_by)
      values(new.business_id,'payment',v_transaction.amount_minor,v_transaction.currency,coalesce(v_transaction.occurred_at,v_transaction.created_at),v_transaction.source_type,v_transaction.source_system,v_transaction.source_record_id,v_transaction.id,v_transaction.reference,v_transaction.party_name,jsonb_build_object('payment_matching_transaction_id',v_transaction.id),'p16:'||v_transaction.id,v_request_hash,new.approved_by) returning * into v_receipt;
    v_receipt_journal:=public.payment_operation_create_journal(new.business_id,'receipt','payment_receipts',v_receipt.id,'receipt:p16:'||v_transaction.id,jsonb_build_array(
      jsonb_build_object('account','cash_received','side','debit','amountMinor',v_receipt.amount_minor,'currency',v_receipt.currency),
      jsonb_build_object('account','unallocated_funds','side','credit','amountMinor',v_receipt.amount_minor,'currency',v_receipt.currency)),new.approved_by);
  end if;
  if new.currency<>v_receipt.currency or new.currency<>v_case.currency then raise exception 'P17_MATCHED_ALLOCATION_CURRENCY_MISMATCH'; end if;
  v_overpayment:=greatest(new.amount_minor-v_case.outstanding_minor,0);
  v_allocation_journal:=public.payment_operation_create_journal(new.business_id,'allocation','payment_allocations',v_allocation_id,'allocation:p16:'||new.id,jsonb_build_array(
    jsonb_build_object('account','unallocated_funds','side','debit','amountMinor',new.amount_minor,'currency',new.currency),
    jsonb_build_object('account','accounts_receivable_control','side','credit','amountMinor',new.amount_minor,'currency',new.currency)),new.approved_by);
  insert into public.payment_allocations(id,business_id,receipt_id,event_type,case_id,obligation_id,receipt_amount_minor,receipt_currency,target_amount_minor,target_currency,overpayment_minor,payment_id,case_financial_event_id,journal_id,reason,idempotency_key,created_by)
    values(v_allocation_id,new.business_id,v_receipt.id,'allocation',new.case_id,new.obligation_id,new.amount_minor,new.currency,new.amount_minor,new.currency,v_overpayment,new.payment_id,v_payment.financial_event_id,v_allocation_journal,'Approved from explainable transaction matching','p16:'||new.id,new.approved_by);
  update public.payment_match_allocations set payment_operation_allocation_id=v_allocation_id where id=new.id;
  insert into public.accounting_payment_operation_outbox(business_id,connection_id,provider,operation_type,source_table,source_id,payload,idempotency_key)
    select new.business_id,c.id,c.provider,'allocation','payment_allocations',v_allocation_id,jsonb_build_object('allocationId',v_allocation_id,'receiptId',v_receipt.id,'caseId',new.case_id,'obligationId',new.obligation_id,'amountMinor',new.amount_minor,'currency',new.currency,'receivedOn',v_receipt.received_at::date,'reference',v_receipt.reference),'p16:'||new.id
    from public.accounting_connections c where c.business_id=new.business_id and c.status in ('connected','error');
  return new;
end; $$;
drop trigger if exists payment_operation_capture_matched_allocation on public.payment_match_allocations;
create trigger payment_operation_capture_matched_allocation after insert or update of payment_operation_allocation_id on public.payment_match_allocations
for each row when (new.payment_operation_allocation_id is null) execute function public.payment_operation_capture_matched_allocation();
-- Backfill Prompt 16 approvals into the receipt/allocation journal without
-- changing their existing case_financial_events or payment history.
update public.payment_match_allocations set payment_operation_allocation_id=null
where payment_operation_allocation_id is null;
revoke all on function public.payment_operation_capture_matched_allocation() from public,anon,authenticated;

alter table public.obligations
  add column if not exists payment_operation_base_adjustments_minor bigint;
update public.obligations set payment_operation_base_adjustments_minor=adjustments_minor
where payment_operation_base_adjustments_minor is null;
alter table public.obligations alter column payment_operation_base_adjustments_minor set not null;

create or replace function public.payment_operation_initialize_obligation_base()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if new.payment_operation_base_adjustments_minor is null then new.payment_operation_base_adjustments_minor:=new.adjustments_minor; end if;
  return new;
end; $$;
drop trigger if exists payment_operation_initialize_obligation_base on public.obligations;
create trigger payment_operation_initialize_obligation_base before insert on public.obligations
for each row execute function public.payment_operation_initialize_obligation_base();

create or replace function public.receivables_sync_case_obligations(p_case_id text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare current_case public.cases; linked_count integer; projected_due bigint; explicit_payment bigint; residual_payment bigint;
begin
  select * into current_case from public.cases where id=p_case_id for update;
  if not found then return; end if;
  select count(*) into linked_count from public.recovery_case_obligations where case_id=p_case_id;
  if linked_count=0 then return; end if;
  perform set_config('collectboss.receivables_sync','on',true);
  with credit_totals as (
    select a.obligation_id,
      coalesce(sum(case when a.event_type='allocation' then a.target_amount_minor else -a.target_amount_minor end),0)::bigint credit_minor
    from public.payment_allocations a join public.payment_receipts r on r.id=a.receipt_id
    where a.case_id=p_case_id and a.obligation_id is not null and r.receipt_kind='credit'
    group by a.obligation_id
  )
  update public.obligations o set adjustments_minor=o.payment_operation_base_adjustments_minor-coalesce(c.credit_minor,0)
  from public.recovery_case_obligations r left join credit_totals c on c.obligation_id=r.obligation_id
  where r.case_id=p_case_id and o.id=r.obligation_id
    and o.adjustments_minor is distinct from o.payment_operation_base_adjustments_minor-coalesce(c.credit_minor,0);
  if exists(select 1 from public.obligations o join public.recovery_case_obligations r on r.obligation_id=o.id where r.case_id=p_case_id and o.contractual_due_minor<0) then
    raise exception 'P17_CREDIT_EXCEEDS_OBLIGATION';
  end if;
  select coalesce(sum(o.contractual_due_minor),0) into projected_due
  from public.recovery_case_obligations r join public.obligations o on o.id=r.obligation_id
  where r.case_id=p_case_id and o.archived_at is null;
  if projected_due<>current_case.contractual_due_minor then raise exception 'Linked obligation total does not reconcile with the case ledger'; end if;
  select coalesce(sum(case when a.event_type='allocation' then a.target_amount_minor else -a.target_amount_minor end),0)::bigint
    into explicit_payment
  from public.payment_allocations a join public.payment_receipts r on r.id=a.receipt_id
  where a.case_id=p_case_id and a.obligation_id is not null and r.receipt_kind='payment';
  residual_payment:=greatest(current_case.approved_payment_minor-explicit_payment,0);
  with explicit as (
    select a.obligation_id,
      coalesce(sum(case when a.event_type='allocation' then a.target_amount_minor else -a.target_amount_minor end),0)::bigint amount_minor
    from public.payment_allocations a join public.payment_receipts pr on pr.id=a.receipt_id
    where a.case_id=p_case_id and a.obligation_id is not null and pr.receipt_kind='payment'
    group by a.obligation_id
  ), ordered as (
    select o.id,o.contractual_due_minor,least(coalesce(e.amount_minor,0),o.contractual_due_minor)::bigint explicit_minor,
      coalesce(sum(greatest(o.contractual_due_minor-least(coalesce(e.amount_minor,0),o.contractual_due_minor),0)) over (
        order by o.due_date,o.created_at,o.id rows between unbounded preceding and 1 preceding),0)::bigint prior_remaining
    from public.recovery_case_obligations r join public.obligations o on o.id=r.obligation_id
    left join explicit e on e.obligation_id=o.id where r.case_id=p_case_id and o.archived_at is null
  ), projected as (
    select id,(explicit_minor+greatest(least(residual_payment-prior_remaining,contractual_due_minor-explicit_minor),0))::bigint paid_minor from ordered
  )
  update public.obligations o set paid_minor=p.paid_minor from projected p where o.id=p.id and o.paid_minor is distinct from p.paid_minor;
end; $$;

alter table public.payment_operation_settings enable row level security;
alter table public.payment_receipts enable row level security;
alter table public.payment_exchange_rates enable row level security;
alter table public.payment_allocation_approval_requests enable row level security;
alter table public.payment_ledger_journals enable row level security;
alter table public.payment_ledger_entries enable row level security;
alter table public.payment_allocations enable row level security;
alter table public.payment_refunds enable row level security;
alter table public.payment_receipt_reversals enable row level security;
alter table public.accounting_payment_operation_outbox enable row level security;
alter table public.payment_operation_idempotency_keys enable row level security;

create policy payment_operation_settings_read on public.payment_operation_settings for select to authenticated using(public.has_business_permission(business_id,'payment.approve'));
create policy payment_receipts_read on public.payment_receipts for select to authenticated using(public.has_business_permission(business_id,'payment.approve') or public.has_business_permission(business_id,'report.read'));
create policy payment_exchange_rates_read on public.payment_exchange_rates for select to authenticated using(public.has_business_permission(business_id,'payment.approve'));
create policy payment_allocation_approvals_read on public.payment_allocation_approval_requests for select to authenticated using(public.has_business_permission(business_id,'payment.approve'));
create policy payment_ledger_journals_read on public.payment_ledger_journals for select to authenticated using(public.has_business_permission(business_id,'payment.approve') or public.has_business_permission(business_id,'report.read'));
create policy payment_ledger_entries_read on public.payment_ledger_entries for select to authenticated using(public.has_business_permission(business_id,'payment.approve') or public.has_business_permission(business_id,'report.read'));
create policy payment_allocations_read on public.payment_allocations for select to authenticated using(public.has_business_permission(business_id,'payment.approve') or public.has_business_permission(business_id,'report.read'));
create policy payment_refunds_read on public.payment_refunds for select to authenticated using(public.has_business_permission(business_id,'payment.approve') or public.has_business_permission(business_id,'report.read'));
create policy payment_receipt_reversals_read on public.payment_receipt_reversals for select to authenticated using(public.has_business_permission(business_id,'payment.approve') or public.has_business_permission(business_id,'report.read'));
create policy accounting_payment_outbox_read on public.accounting_payment_operation_outbox for select to authenticated using(public.has_business_permission(business_id,'payment.approve') or public.has_business_permission(business_id,'report.read'));

revoke all on public.payment_operation_settings,public.payment_receipts,public.payment_exchange_rates,public.payment_allocation_approval_requests,public.payment_ledger_journals,public.payment_ledger_entries,public.payment_allocations,public.payment_refunds,public.payment_receipt_reversals,public.accounting_payment_operation_outbox,public.payment_operation_idempotency_keys from anon;
grant select on public.payment_operation_settings,public.payment_receipts,public.payment_exchange_rates,public.payment_allocation_approval_requests,public.payment_ledger_journals,public.payment_ledger_entries,public.payment_allocations,public.payment_refunds,public.payment_receipt_reversals,public.accounting_payment_operation_outbox to authenticated;
grant all on public.payment_operation_settings,public.payment_receipts,public.payment_exchange_rates,public.payment_allocation_approval_requests,public.payment_ledger_journals,public.payment_ledger_entries,public.payment_allocations,public.payment_refunds,public.payment_receipt_reversals,public.accounting_payment_operation_outbox,public.payment_operation_idempotency_keys to service_role;
grant select on public.payment_receipt_positions to authenticated,service_role;

revoke all on function public.payment_operation_create_journal(uuid,text,text,uuid,text,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.payment_operation_record_receipt(uuid,uuid,text,bigint,text,timestamptz,text,text,text,uuid,text,text,jsonb,text,text) from public,anon,authenticated;
revoke all on function public.payment_operation_allocate(uuid,uuid,uuid,jsonb,text,uuid,text,text) from public,anon,authenticated;
revoke all on function public.payment_operation_reverse_allocation(uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.payment_operation_refund(uuid,uuid,uuid,bigint,text,text,text,text) from public,anon,authenticated;
revoke all on function public.payment_operation_reverse_receipt(uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.payment_operation_decide_approval(uuid,uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.payment_operation_reconciliation(uuid,timestamptz,timestamptz) from public,anon;
grant execute on function public.payment_operation_create_journal(uuid,text,text,uuid,text,jsonb,uuid) to service_role;
grant execute on function public.payment_operation_record_receipt(uuid,uuid,text,bigint,text,timestamptz,text,text,text,uuid,text,text,jsonb,text,text) to service_role;
grant execute on function public.payment_operation_allocate(uuid,uuid,uuid,jsonb,text,uuid,text,text) to service_role;
grant execute on function public.payment_operation_reverse_allocation(uuid,uuid,uuid,text,text,text) to service_role;
grant execute on function public.payment_operation_refund(uuid,uuid,uuid,bigint,text,text,text,text) to service_role;
grant execute on function public.payment_operation_reverse_receipt(uuid,uuid,uuid,text,text,text) to service_role;
grant execute on function public.payment_operation_decide_approval(uuid,uuid,uuid,text,text) to service_role;
grant execute on function public.payment_operation_reconciliation(uuid,timestamptz,timestamptz) to authenticated,service_role;

commit;

-- Rollback (history preserving): disable the payment-operation routes and
-- outbox worker, revoke the RPC grants, and leave receipts, journals, entries,
-- allocations, refunds, reversals and integration attempts read-only. Never
-- drop posted rows merely to restore old totals. A destructive rollback is
-- safe only on an empty non-production install and must drop dependants in
-- reverse order, ending with payment_receipts and payment_operation_settings.
