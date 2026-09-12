-- Prompt 18: canonical, evidence-linked Debt Truth Engine.
-- Apply after 20260908_complex_payment_operations.sql.
begin;

alter table public.cases
  add column if not exists debt_truth_version integer not null default 0,
  add column if not exists confirmed_outstanding_minor bigint not null default 0,
  add column if not exists disputed_balance_minor bigint not null default 0,
  add column if not exists unverified_balance_minor bigint not null default 0,
  add column if not exists total_displayed_exposure_minor bigint not null default 0;

alter table public.cases drop constraint if exists cases_debt_truth_projection_nonnegative;
alter table public.cases add constraint cases_debt_truth_projection_nonnegative check (
  debt_truth_version >= 0 and confirmed_outstanding_minor >= 0 and
  disputed_balance_minor >= 0 and unverified_balance_minor >= 0 and
  total_displayed_exposure_minor >= 0
);

create table if not exists public.debt_ledger_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  case_id text not null references public.cases(id) on delete restrict,
  event_kind text not null check (event_kind in (
    'original_principal','invoice','adjustment_debit','adjustment_credit',
    'fee','interest','credit_note','payment','write_off'
  )),
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  approval_status text not null check (approval_status in ('approved','pending','rejected','reversed')),
  approval_authority text check (approval_authority in (
    'system_source','source_approver','payment_approver','adjustment_approver',
    'fee_approver','settlement_approver','write_off_approver'
  )),
  requested_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  source_table text not null check (source_table ~ '^[a-z0-9_]{2,80}$'),
  source_id text not null check (nullif(btrim(source_id),'') is not null),
  source_version integer not null default 1 check (source_version > 0),
  evidence_citations jsonb not null check (
    jsonb_typeof(evidence_citations)='array' and jsonb_array_length(evidence_citations)>0
  ),
  reverses_event_id uuid references public.debt_ledger_events(id) on delete restrict,
  reason text check (reason is null or char_length(reason)<=1000),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now(),
  unique (case_id,source_table,source_id,event_kind,source_version),
  check ((approval_status='approved')=(approved_at is not null and approval_authority is not null)),
  check (reverses_event_id is null or approval_status='approved')
);
create index if not exists debt_ledger_events_case_source_idx
  on public.debt_ledger_events(case_id,source_table,source_id,event_kind,source_version desc);

create table if not exists public.debt_balance_versions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  case_id text not null references public.cases(id) on delete restrict,
  version integer not null check (version > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  original_principal_minor bigint not null check (original_principal_minor>=0),
  invoiced_amount_minor bigint not null check (invoiced_amount_minor>=0),
  approved_adjustments_minor bigint not null,
  approved_fees_minor bigint not null check (approved_fees_minor>=0),
  credit_notes_minor bigint not null check (credit_notes_minor>=0),
  confirmed_payments_minor bigint not null check (confirmed_payments_minor>=0),
  disputed_amount_minor bigint not null check (disputed_amount_minor>=0),
  unverified_amount_minor bigint not null check (unverified_amount_minor>=0),
  unverified_credit_minor bigint not null check (unverified_credit_minor>=0),
  confirmed_outstanding_minor bigint not null check (confirmed_outstanding_minor>=0),
  total_displayed_exposure_minor bigint not null check (total_displayed_exposure_minor>=0),
  overpayment_minor bigint not null check (overpayment_minor>=0),
  source_fingerprint char(64) not null check (source_fingerprint ~ '^[a-f0-9]{64}$'),
  explanation_tree jsonb not null check (jsonb_typeof(explanation_tree)='object'),
  user_explanation text not null,
  calculated_at timestamptz not null default now(),
  unique(case_id,version),
  unique(case_id,source_fingerprint)
);
create index if not exists debt_balance_versions_latest_idx on public.debt_balance_versions(case_id,version desc);

create or replace view public.debt_balance_versions_api with (security_invoker=true) as
select id,business_id,case_id,version,currency,
  original_principal_minor::text original_principal_minor,
  invoiced_amount_minor::text invoiced_amount_minor,
  approved_adjustments_minor::text approved_adjustments_minor,
  approved_fees_minor::text approved_fees_minor,credit_notes_minor::text credit_notes_minor,
  confirmed_payments_minor::text confirmed_payments_minor,disputed_amount_minor::text disputed_amount_minor,
  unverified_amount_minor::text unverified_amount_minor,unverified_credit_minor::text unverified_credit_minor,
  confirmed_outstanding_minor::text confirmed_outstanding_minor,
  total_displayed_exposure_minor::text total_displayed_exposure_minor,overpayment_minor::text overpayment_minor,
  source_fingerprint,explanation_tree,user_explanation,calculated_at
from public.debt_balance_versions;

create or replace view public.debt_ledger_events_api with (security_invoker=true) as
select id,business_id,case_id,event_kind,amount_minor::text amount_minor,currency,approval_status,
  source_table,source_id,source_version,evidence_citations,reverses_event_id,reason,created_at
from public.debt_ledger_events;

create table if not exists public.debt_ledger_reconciliation_exceptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  case_id text not null references public.cases(id) on delete restrict,
  run_id uuid not null,
  legacy_outstanding_minor bigint not null,
  canonical_exposure_minor bigint not null,
  difference_minor bigint not null,
  exception_code text not null check (exception_code in ('legacy_balance_mismatch','currency_mismatch','source_gap')),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details)='object'),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(run_id,case_id,exception_code)
);

create or replace function public.debt_truth_validate_event()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare v_case public.cases;
begin
  select * into v_case from public.cases where id=new.case_id and business_id=new.business_id;
  if not found then raise exception 'DEBT_TRUTH_CASE_NOT_FOUND'; end if;
  if new.currency<>v_case.currency then raise exception 'DEBT_TRUTH_CURRENCY_MISMATCH'; end if;
  if new.approval_status='approved' and new.event_kind in ('fee','interest')
    and new.approval_authority<>'fee_approver' and new.approval_authority<>'system_source'
    then raise exception 'DEBT_TRUTH_FEE_AUTHORITY_REQUIRED'; end if;
  if new.approval_status='approved' and new.event_kind='write_off'
    and new.approval_authority<>'write_off_approver' and new.approval_authority<>'system_source'
    then raise exception 'DEBT_TRUTH_WRITE_OFF_AUTHORITY_REQUIRED'; end if;
  if new.approval_status='approved' and new.event_kind in ('adjustment_debit','adjustment_credit')
    and new.approval_authority not in ('adjustment_approver','settlement_approver','write_off_approver','system_source')
    then raise exception 'DEBT_TRUTH_ADJUSTMENT_AUTHORITY_REQUIRED'; end if;
  if new.approval_status='approved' and new.source_table='debt_ledger_manual'
    and (new.requested_by is null or new.approved_by is null or new.requested_by=new.approved_by)
    then raise exception 'DEBT_TRUTH_INDEPENDENT_APPROVAL_REQUIRED'; end if;
  if new.reverses_event_id is not null and not exists (
    select 1 from public.debt_ledger_events prior
    where prior.id=new.reverses_event_id and prior.case_id=new.case_id and prior.currency=new.currency
  ) then raise exception 'DEBT_TRUTH_REVERSAL_TARGET_INVALID'; end if;
  return new;
end; $$;
drop trigger if exists debt_ledger_events_validate on public.debt_ledger_events;
create trigger debt_ledger_events_validate before insert on public.debt_ledger_events
for each row execute function public.debt_truth_validate_event();

create or replace function public.debt_truth_append_only()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin raise exception 'DEBT_TRUTH_APPEND_ONLY'; end; $$;
drop trigger if exists debt_ledger_events_append_only on public.debt_ledger_events;
create trigger debt_ledger_events_append_only before update or delete on public.debt_ledger_events
for each row execute function public.debt_truth_append_only();
drop trigger if exists debt_balance_versions_append_only on public.debt_balance_versions;
create trigger debt_balance_versions_append_only before update or delete on public.debt_balance_versions
for each row execute function public.debt_truth_append_only();

create or replace function public.debt_truth_component_events(p_case_id text,p_kinds text[])
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  with latest as (
    select distinct on (source_table,source_id,event_kind) *
    from public.debt_ledger_events where case_id=p_case_id
    order by source_table,source_id,event_kind,source_version desc,created_at desc,id desc
  ), effective as (
    select e.* from latest e where e.approval_status='approved' and e.reverses_event_id is null
      and not exists(select 1 from latest r where r.approval_status='approved' and r.reverses_event_id=e.id)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'eventId',id,'kind',event_kind,'amountMinor',amount_minor::text,
    'source',jsonb_build_object('table',source_table,'id',source_id,'version',source_version),
    'citations',evidence_citations
  ) order by created_at,id),'[]'::jsonb) from effective where event_kind=any(p_kinds);
$$;

create or replace function public.debt_truth_recalculate_case(p_case_id text)
returns public.debt_balance_versions language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_case public.cases; v_existing public.debt_balance_versions; v_result public.debt_balance_versions;
  v_original bigint:=0; v_invoiced bigint:=0; v_debit bigint:=0; v_adjustment_credit bigint:=0;
  v_fees bigint:=0; v_credit_notes bigint:=0; v_payments bigint:=0; v_unverified bigint:=0; v_unverified_credit bigint:=0;
  v_contractual bigint; v_remaining bigint; v_requested_dispute bigint:=0; v_disputed bigint:=0;
  v_confirmed bigint; v_displayed bigint; v_overpayment bigint; v_version integer; v_fingerprint text;
  v_explanation jsonb; v_user text; v_event_material text; v_dispute_material text;
begin
  perform pg_advisory_xact_lock(hashtextextended('debt-truth:'||p_case_id,0));
  select * into v_case from public.cases where id=p_case_id for update;
  if not found then raise exception 'DEBT_TRUTH_CASE_NOT_FOUND'; end if;

  with latest as (
    select distinct on (source_table,source_id,event_kind) * from public.debt_ledger_events where case_id=p_case_id
    order by source_table,source_id,event_kind,source_version desc,created_at desc,id desc
  ), effective as (
    select e.* from latest e where e.approval_status='approved' and e.reverses_event_id is null
      and not exists(select 1 from latest r where r.approval_status='approved' and r.reverses_event_id=e.id)
  ) select
    coalesce(sum(amount_minor) filter(where event_kind='original_principal'),0),
    coalesce(sum(amount_minor) filter(where event_kind='invoice'),0),
    coalesce(sum(amount_minor) filter(where event_kind='adjustment_debit'),0),
    coalesce(sum(amount_minor) filter(where event_kind in ('adjustment_credit','write_off')),0),
    coalesce(sum(amount_minor) filter(where event_kind in ('fee','interest')),0),
    coalesce(sum(amount_minor) filter(where event_kind='credit_note'),0),
    coalesce(sum(amount_minor) filter(where event_kind='payment'),0)
  into v_original,v_invoiced,v_debit,v_adjustment_credit,v_fees,v_credit_notes,v_payments from effective;

  with latest as (
    select distinct on (source_table,source_id,event_kind) * from public.debt_ledger_events where case_id=p_case_id
    order by source_table,source_id,event_kind,source_version desc,created_at desc,id desc
  ) select
    coalesce(sum(amount_minor) filter(where approval_status='pending' and event_kind in ('original_principal','invoice','adjustment_debit','fee','interest')),0),
    coalesce(sum(amount_minor) filter(where approval_status='pending' and event_kind in ('adjustment_credit','credit_note','payment','write_off')),0),
    coalesce(string_agg(concat_ws(':',id::text,event_kind,amount_minor::text,currency,approval_status,source_table,source_id,source_version::text,coalesce(reverses_event_id::text,''),evidence_citations::text),'|' order by source_table,source_id,event_kind), '')
  into v_unverified,v_unverified_credit,v_event_material from latest;

  v_contractual:=coalesce(nullif(v_invoiced,0),v_original)+v_debit-v_adjustment_credit+v_fees-v_credit_notes;
  if v_contractual<0 then raise exception 'DEBT_TRUTH_CREDITS_EXCEED_CHARGES'; end if;
  v_remaining:=greatest(v_contractual-v_payments,0); v_overpayment:=greatest(v_payments-v_contractual,0);
  select coalesce(sum(case when status='partially_accepted' then disputed_amount_minor-coalesce(resolution_amount_minor,0) else disputed_amount_minor end),0),
    coalesce(string_agg(concat_ws(':',id::text,status,disputed_amount_minor::text,coalesce(resolution_amount_minor::text,''),updated_at::text),'|' order by id),'')
  into v_requested_dispute,v_dispute_material from public.disputes
  where case_id=p_case_id and status in ('submitted','under_review','information_requested','partially_accepted');
  v_disputed:=least(v_requested_dispute,v_remaining); v_confirmed:=v_remaining-v_disputed;
  v_displayed:=v_confirmed+v_disputed+v_unverified;
  v_fingerprint:=encode(digest(convert_to(concat_ws('||',v_case.currency,v_event_material,v_dispute_material),'UTF8'),'sha256'),'hex');
  select * into v_existing from public.debt_balance_versions where case_id=p_case_id and source_fingerprint=v_fingerprint;
  if found then return v_existing; end if;

  select coalesce(max(version),0)+1 into v_version from public.debt_balance_versions where case_id=p_case_id;
  v_explanation:=jsonb_build_object(
    'key','total_displayed_exposure','label','Total displayed exposure','amountMinor',v_displayed::text,
    'operation','total','authoritative',false,'children',jsonb_build_array(
      jsonb_build_object('key','confirmed_outstanding_balance','label','Confirmed outstanding balance','amountMinor',v_confirmed::text,'operation','total','authoritative',true,'children',jsonb_build_array(
        jsonb_build_object('key','original_principal','amountMinor',v_original::text,'operation','information','events',public.debt_truth_component_events(p_case_id,array['original_principal'])),
        jsonb_build_object('key','invoiced_amount','amountMinor',v_invoiced::text,'operation',case when v_invoiced>0 then 'base' else 'information' end,'events',public.debt_truth_component_events(p_case_id,array['invoice'])),
        jsonb_build_object('key','approved_adjustments','amountMinor',(v_debit-v_adjustment_credit)::text,'operation','add','events',public.debt_truth_component_events(p_case_id,array['adjustment_debit','adjustment_credit','write_off'])),
        jsonb_build_object('key','approved_fees','amountMinor',v_fees::text,'operation','add','events',public.debt_truth_component_events(p_case_id,array['fee','interest'])),
        jsonb_build_object('key','credit_notes','amountMinor',v_credit_notes::text,'operation','subtract','events',public.debt_truth_component_events(p_case_id,array['credit_note'])),
        jsonb_build_object('key','confirmed_payments','amountMinor',v_payments::text,'operation','subtract','events',public.debt_truth_component_events(p_case_id,array['payment']))
      )),
      jsonb_build_object('key','disputed_amount','label','Open disputed amount','amountMinor',v_disputed::text,'operation','classify','authoritative',false,
        'disputeIds',coalesce((select jsonb_agg(id order by id) from public.disputes where case_id=p_case_id and status in ('submitted','under_review','information_requested','partially_accepted')),'[]'::jsonb)),
      jsonb_build_object('key','unverified_amount','label','Unverified potential charges','amountMinor',v_unverified::text,'operation','add','authoritative',false),
      jsonb_build_object('key','unverified_credit','label','Unverified credits or payment claims (not deducted)','amountMinor',v_unverified_credit::text,'operation','information','authoritative',false)
    )
  );
  v_user:='Confirmed outstanding: '||v_confirmed||' minor units. Disputed: '||v_disputed||
    ' minor units. Unverified potential charges: '||v_unverified||
    ' minor units. Unverified credits or payment claims are not deducted.';
  insert into public.debt_balance_versions(
    business_id,case_id,version,currency,original_principal_minor,invoiced_amount_minor,
    approved_adjustments_minor,approved_fees_minor,credit_notes_minor,confirmed_payments_minor,
    disputed_amount_minor,unverified_amount_minor,unverified_credit_minor,confirmed_outstanding_minor,
    total_displayed_exposure_minor,overpayment_minor,source_fingerprint,explanation_tree,user_explanation
  ) values (
    v_case.business_id,p_case_id,v_version,v_case.currency,v_original,v_invoiced,v_debit-v_adjustment_credit,
    v_fees,v_credit_notes,v_payments,v_disputed,v_unverified,v_unverified_credit,v_confirmed,
    v_displayed,v_overpayment,v_fingerprint,v_explanation,v_user
  ) returning * into v_result;
  perform set_config('collectboss.financial_write','on',true);
  update public.cases set debt_truth_version=v_version,confirmed_outstanding_minor=v_confirmed,
    disputed_balance_minor=v_disputed,unverified_balance_minor=v_unverified,
    total_displayed_exposure_minor=v_displayed,updated_at=now() where id=p_case_id;
  return v_result;
end; $$;

create or replace function public.debt_truth_after_event()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin perform public.debt_truth_recalculate_case(new.case_id); return new; end; $$;
drop trigger if exists debt_ledger_events_recalculate on public.debt_ledger_events;
create trigger debt_ledger_events_recalculate after insert on public.debt_ledger_events
for each row execute function public.debt_truth_after_event();

create or replace function public.debt_truth_seed_new_case()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.original_principal_minor>0 then
    insert into public.debt_ledger_events(
      business_id,case_id,event_kind,amount_minor,currency,approval_status,approval_authority,
      approved_at,source_table,source_id,source_version,evidence_citations,reason
    ) values(
      new.business_id,new.id,'original_principal',new.original_principal_minor,new.currency,'approved','system_source',
      now(),'cases',new.id,1,jsonb_build_array(jsonb_build_object('evidenceId',new.id,'label','Case opening principal')),
      'Opening principal captured at case creation'
    );
  end if;
  return new;
end; $$;
drop trigger if exists cases_debt_truth_seed on public.cases;
create trigger cases_debt_truth_seed after insert on public.cases
for each row execute function public.debt_truth_seed_new_case();

create or replace function public.debt_truth_sync_financial_event()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_case public.cases; v_kind text; v_authority text:='system_source';
begin
  select * into v_case from public.cases where id=new.case_id;
  if new.event_type in ('payment_approved','payment_reversal') then
    -- Live payment rows have their own versioned pending/approved/reversed fact.
    return new;
  elsif new.event_type='opening_payment_credit' then
    v_kind:='payment';
  elsif new.event_type='adjustment_debit' then v_kind:='adjustment_debit';
  elsif new.event_type='adjustment_credit' then
    v_kind:='adjustment_credit';
    if new.source_table='financial_adjustments' then
      select case when adjustment_type='credit_note' then 'credit_note'
        when adjustment_type='write_off' then 'write_off' else 'adjustment_credit' end,
        case when adjustment_type='write_off' then 'write_off_approver' else 'system_source' end
      into v_kind,v_authority from public.financial_adjustments where id=new.source_id;
      v_kind:=coalesce(v_kind,'adjustment_credit'); v_authority:=coalesce(v_authority,'system_source');
    end if;
  else return new; end if;
  insert into public.debt_ledger_events(
    business_id,case_id,event_kind,amount_minor,currency,approval_status,approval_authority,
    requested_by,approved_by,approved_at,source_table,source_id,source_version,evidence_citations,reverses_event_id,reason
  ) values (
    v_case.business_id,new.case_id,v_kind,new.amount_minor,new.currency,'approved',v_authority,
    new.created_by,new.created_by,new.created_at,'case_financial_events',new.id::text,1,
    jsonb_build_array(jsonb_build_object('evidenceId',new.id,'label','Approved financial ledger event','sourceTable',new.source_table,'sourceId',new.source_id)),
    null,new.note
  ) on conflict(case_id,source_table,source_id,event_kind,source_version) do nothing;
  return new;
end; $$;
drop trigger if exists case_financial_events_debt_truth_sync on public.case_financial_events;
create trigger case_financial_events_debt_truth_sync after insert on public.case_financial_events
for each row execute function public.debt_truth_sync_financial_event();

create or replace function public.debt_truth_sync_obligation(p_case_id text,p_obligation_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_case public.cases; v_obligation public.obligations; v_version integer;
begin
  select * into v_case from public.cases where id=p_case_id;
  select * into v_obligation from public.obligations where id=p_obligation_id and business_id=v_case.business_id;
  if not found then raise exception 'DEBT_TRUTH_OBLIGATION_NOT_FOUND'; end if;
  if v_obligation.original_amount_minor=0 then return; end if;
  select coalesce(max(source_version),0)+1 into v_version from public.debt_ledger_events
    where case_id=p_case_id and source_table='obligations' and source_id=p_obligation_id::text and event_kind='invoice';
  insert into public.debt_ledger_events(
    business_id,case_id,event_kind,amount_minor,currency,approval_status,approval_authority,
    approved_at,source_table,source_id,source_version,evidence_citations,reason
  ) values (
    v_case.business_id,p_case_id,'invoice',v_obligation.original_amount_minor,v_obligation.currency,
    case when v_obligation.status in ('draft','void') or v_obligation.archived_at is not null then 'rejected' else 'approved' end,
    case when v_obligation.status in ('draft','void') or v_obligation.archived_at is not null then null else 'system_source' end,
    case when v_obligation.status in ('draft','void') or v_obligation.archived_at is not null then null else now() end,
    'obligations',p_obligation_id::text,v_version,
    jsonb_build_array(jsonb_build_object('evidenceId',p_obligation_id,'label','Approved receivable obligation','reference',v_obligation.reference)),
    'Receivable obligation version'
  );
end; $$;

create or replace function public.debt_truth_after_obligation_link()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin perform public.debt_truth_sync_obligation(new.case_id,new.obligation_id); return new; end; $$;
drop trigger if exists recovery_case_obligations_debt_truth_sync on public.recovery_case_obligations;
create trigger recovery_case_obligations_debt_truth_sync after insert on public.recovery_case_obligations
for each row execute function public.debt_truth_after_obligation_link();

create or replace function public.debt_truth_after_obligation_change()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_link record;
begin
  if row(new.original_amount_minor,new.currency,new.status,new.archived_at) is not distinct from
     row(old.original_amount_minor,old.currency,old.status,old.archived_at) then return new; end if;
  for v_link in select case_id from public.recovery_case_obligations where obligation_id=new.id loop
    perform public.debt_truth_sync_obligation(v_link.case_id,new.id);
  end loop;
  return new;
end; $$;
drop trigger if exists obligations_debt_truth_sync on public.obligations;
create trigger obligations_debt_truth_sync after update on public.obligations
for each row execute function public.debt_truth_after_obligation_change();

create or replace function public.debt_truth_after_dispute_change()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin perform public.debt_truth_recalculate_case(new.case_id); return new; end; $$;
drop trigger if exists disputes_debt_truth_recalculate on public.disputes;
create trigger disputes_debt_truth_recalculate after insert or update on public.disputes
for each row execute function public.debt_truth_after_dispute_change();

create or replace function public.debt_truth_sync_payment()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_case public.cases; v_version integer; v_status text; v_authority text; v_approved_at timestamptz;
begin
  if tg_op='UPDATE' and row(new.amount_minor,new.currency,new.review_status,new.reversed_at) is not distinct from
    row(old.amount_minor,old.currency,old.review_status,old.reversed_at) then return new; end if;
  select * into v_case from public.cases where id=new.case_id;
  v_status:=case when new.review_status='approved' then 'approved'
    when new.review_status='reversed' then 'reversed'
    when new.review_status='rejected' then 'rejected' else 'pending' end;
  v_authority:=case when v_status='approved' then 'payment_approver' else null end;
  v_approved_at:=case when v_status='approved' then coalesce(new.reviewed_at,now()) else null end;
  select coalesce(max(source_version),0)+1 into v_version from public.debt_ledger_events
    where case_id=new.case_id and source_table='payments' and source_id=new.id::text and event_kind='payment';
  insert into public.debt_ledger_events(
    business_id,case_id,event_kind,amount_minor,currency,approval_status,approval_authority,
    requested_by,approved_by,approved_at,source_table,source_id,source_version,evidence_citations,reason
  ) values(
    v_case.business_id,new.case_id,'payment',new.amount_minor,new.currency,v_status,v_authority,
    coalesce(new.reviewed_by,new.reversed_by),new.reviewed_by,v_approved_at,'payments',new.id::text,v_version,
    jsonb_build_array(jsonb_build_object('evidenceId',new.id,'label','Payment review record','reference',new.reference_no)),
    case when v_status='reversed' then new.reversal_reason else new.notes end
  );
  return new;
end; $$;
drop trigger if exists payments_debt_truth_sync on public.payments;
create trigger payments_debt_truth_sync after insert or update of amount_minor,currency,review_status,reversed_at on public.payments
for each row execute function public.debt_truth_sync_payment();

-- Backward-compatible seed: every legacy monetary value becomes a cited event.
alter table public.debt_ledger_events disable trigger debt_ledger_events_recalculate;
insert into public.debt_ledger_events(
  business_id,case_id,event_kind,amount_minor,currency,approval_status,approval_authority,
  approved_at,source_table,source_id,source_version,evidence_citations,reason
)
select business_id,id,'original_principal',original_principal_minor,currency,'approved','system_source',
  now(),'cases',id,1,jsonb_build_array(jsonb_build_object('evidenceId',id,'label','Legacy case opening principal')),
  'Opening principal migrated without rewriting legacy history'
from public.cases where original_principal_minor>0
on conflict(case_id,source_table,source_id,event_kind,source_version) do nothing;

insert into public.debt_ledger_events(
  business_id,case_id,event_kind,amount_minor,currency,approval_status,source_table,source_id,source_version,evidence_citations,reason
)
select c.business_id,p.case_id,'payment',p.amount_minor,p.currency,
  case when p.review_status='rejected' then 'rejected' else 'pending' end,
  'payments',p.id::text,1,
  jsonb_build_array(jsonb_build_object('evidenceId',p.id,'label','Unverified payment review record','reference',p.reference_no)),p.notes
from public.payments p join public.cases c on c.id=p.case_id
where p.review_status in ('pending_review','unmatched','rejected')
  and not exists(select 1 from public.debt_ledger_events d where d.case_id=p.case_id and d.source_table='payments' and d.source_id=p.id::text)
on conflict(case_id,source_table,source_id,event_kind,source_version) do nothing;

insert into public.debt_ledger_events(
  business_id,case_id,event_kind,amount_minor,currency,approval_status,approval_authority,
  requested_by,approved_by,approved_at,source_table,source_id,source_version,evidence_citations,reason
)
select c.business_id,e.case_id,
  case when e.event_type in ('opening_payment_credit','payment_approved','payment_reversal') then 'payment'
    when e.event_type='adjustment_debit' then 'adjustment_debit' else 'adjustment_credit' end,
  e.amount_minor,e.currency,'approved','system_source',e.created_by,e.created_by,e.created_at,
  'case_financial_events',e.id::text,1,
  jsonb_build_array(jsonb_build_object('evidenceId',e.id,'label','Approved financial ledger event','sourceTable',e.source_table,'sourceId',e.source_id)),e.note
from public.case_financial_events e join public.cases c on c.id=e.case_id
where e.event_type<>'payment_reversal'
on conflict(case_id,source_table,source_id,event_kind,source_version) do nothing;

insert into public.debt_ledger_events(
  business_id,case_id,event_kind,amount_minor,currency,approval_status,approval_authority,
  requested_by,approved_by,approved_at,source_table,source_id,source_version,evidence_citations,reverses_event_id,reason
)
select c.business_id,reversal.case_id,'payment',reversal.amount_minor,reversal.currency,'approved','system_source',
  reversal.created_by,reversal.created_by,reversal.created_at,'case_financial_events',reversal.id::text,1,
  jsonb_build_array(jsonb_build_object('evidenceId',reversal.id,'label','Approved payment reversal','sourceTable',reversal.source_table,'sourceId',reversal.source_id)),
  target.id,reversal.note
from public.case_financial_events reversal join public.cases c on c.id=reversal.case_id
join lateral (
  select d.id from public.debt_ledger_events d join public.case_financial_events original
    on d.source_table='case_financial_events' and d.source_id=original.id::text
  where original.case_id=reversal.case_id and original.event_type in ('opening_payment_credit','payment_approved')
    and original.source_table=reversal.source_table and original.source_id=reversal.source_id
    and d.event_kind='payment' and d.approval_status='approved'
  order by original.created_at desc limit 1
) target on true
where reversal.event_type='payment_reversal'
on conflict(case_id,source_table,source_id,event_kind,source_version) do nothing;

do $$ declare v_link record; begin
  for v_link in select case_id,obligation_id from public.recovery_case_obligations loop
    if not exists(select 1 from public.debt_ledger_events where case_id=v_link.case_id and source_table='obligations' and source_id=v_link.obligation_id::text) then
      perform public.debt_truth_sync_obligation(v_link.case_id,v_link.obligation_id);
    end if;
  end loop;
end $$;

alter table public.debt_ledger_events enable trigger debt_ledger_events_recalculate;

do $$ declare v_case public.cases; v_balance public.debt_balance_versions; v_run uuid:=gen_random_uuid(); begin
  for v_case in select * from public.cases loop
    begin
      v_balance:=public.debt_truth_recalculate_case(v_case.id);
      if v_balance.confirmed_outstanding_minor+v_balance.disputed_amount_minor<>v_case.outstanding_minor then
        insert into public.debt_ledger_reconciliation_exceptions(
          business_id,case_id,run_id,legacy_outstanding_minor,canonical_exposure_minor,difference_minor,exception_code,details
        ) values(v_case.business_id,v_case.id,v_run,v_case.outstanding_minor,
          v_balance.confirmed_outstanding_minor+v_balance.disputed_amount_minor,
          (v_balance.confirmed_outstanding_minor+v_balance.disputed_amount_minor)-v_case.outstanding_minor,
          'legacy_balance_mismatch',jsonb_build_object('balanceVersion',v_balance.version));
      end if;
    exception when others then
      insert into public.debt_ledger_reconciliation_exceptions(
        business_id,case_id,run_id,legacy_outstanding_minor,canonical_exposure_minor,difference_minor,exception_code,details
      ) values(v_case.business_id,v_case.id,v_run,v_case.outstanding_minor,0,-v_case.outstanding_minor,
        case when sqlerrm like '%CURRENCY%' then 'currency_mismatch' else 'source_gap' end,
        jsonb_build_object('error',sqlerrm));
    end;
  end loop;
end $$;

alter table public.debt_ledger_events enable row level security;
alter table public.debt_balance_versions enable row level security;
alter table public.debt_ledger_reconciliation_exceptions enable row level security;
create policy debt_ledger_events_tenant_read on public.debt_ledger_events for select to authenticated
  using(public.has_business_permission(business_id,'case.read'));
create policy debt_balance_versions_tenant_read on public.debt_balance_versions for select to authenticated
  using(public.has_business_permission(business_id,'case.read'));
create policy debt_reconciliation_exceptions_audit_read on public.debt_ledger_reconciliation_exceptions for select to authenticated
  using(public.has_business_permission(business_id,'audit.read'));
revoke all on public.debt_ledger_events,public.debt_balance_versions,public.debt_ledger_reconciliation_exceptions from anon;
revoke all on public.debt_balance_versions_api,public.debt_ledger_events_api from anon;
grant select on public.debt_ledger_events,public.debt_balance_versions to authenticated;
grant select on public.debt_balance_versions_api,public.debt_ledger_events_api to authenticated;
grant select on public.debt_ledger_reconciliation_exceptions to authenticated;
grant all on public.debt_ledger_events,public.debt_balance_versions,public.debt_ledger_reconciliation_exceptions to service_role;
grant select on public.debt_balance_versions_api,public.debt_ledger_events_api to service_role;
revoke all on function public.debt_truth_recalculate_case(text) from public,anon,authenticated;
revoke all on function public.debt_truth_sync_obligation(text,uuid) from public,anon,authenticated;
revoke all on function public.debt_truth_component_events(text,text[]) from public,anon,authenticated;
grant execute on function public.debt_truth_recalculate_case(text) to service_role;
grant execute on function public.debt_truth_sync_obligation(text,uuid) to service_role;
grant execute on function public.debt_truth_component_events(text,text[]) to service_role;

commit;

-- Rollback (history-preserving): disable the four debt-truth sync/recalculate
-- triggers, revoke service RPC execution, and keep ledger events, versions and
-- reconciliation exceptions read-only. The additive case projection columns
-- can remain unused. Destructive table/column removal is permitted only after
-- exports and downstream references are cleared and retained audit history is
-- handled under the data-retention policy.
