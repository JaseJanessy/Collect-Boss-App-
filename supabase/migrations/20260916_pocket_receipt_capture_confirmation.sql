-- Prompt 6: Pocket receipt capture, reviewed extraction, and authoritative payment handoff.
-- Additive proposal only. Apply after 20260915_pocket_authoritative_payments.sql.
-- The shared document-intake/OCR and payment-operation tables remain authoritative.

begin;

create table if not exists public.pocket_receipt_payment_links (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  intake_id uuid not null references public.document_intakes(id) on delete restrict,
  evidence_id uuid not null references public.evidence_files(id) on delete restrict,
  confirmation_id uuid not null references public.document_intake_confirmations(id) on delete restrict,
  allocation_id uuid not null references public.payment_allocations(id) on delete restrict,
  receipt_id uuid not null references public.payment_receipts(id) on delete restrict,
  debt_id uuid not null references public.obligations(id) on delete restrict,
  customer_id uuid not null references public.debtors(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(intake_id),
  unique(allocation_id),
  unique(receipt_id)
);
create index if not exists pocket_receipt_payment_links_business_idx
  on public.pocket_receipt_payment_links(business_id,created_at desc);

drop trigger if exists pocket_receipt_payment_links_append_only_guard on public.pocket_receipt_payment_links;
create trigger pocket_receipt_payment_links_append_only_guard
before update or delete on public.pocket_receipt_payment_links
for each row execute function public.document_intake_append_only();

alter table public.pocket_receipt_payment_links enable row level security;
drop policy if exists pocket_receipt_payment_links_read on public.pocket_receipt_payment_links;
create policy pocket_receipt_payment_links_read on public.pocket_receipt_payment_links
for select to authenticated
using (
  public.has_business_permission(business_id,'document_intake.read')
  and public.has_business_permission(business_id,'case.read')
);
revoke all on public.pocket_receipt_payment_links from public,anon,authenticated;
grant select on public.pocket_receipt_payment_links to authenticated;
grant all on public.pocket_receipt_payment_links to service_role;

create or replace function public.pocket_confirm_receipt_payment(
  p_business_id uuid,p_actor_id uuid,p_intake_id uuid,p_debt_id uuid,
  p_expected_outstanding_minor bigint,p_method text,p_note text,p_duplicate_acknowledged boolean,
  p_idempotency_key text,p_request_hash text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_role text; v_intake public.document_intakes; v_evidence public.evidence_files;
  v_extraction public.document_intake_extractions; v_confirmation public.document_intake_confirmations;
  v_existing public.payment_operation_idempotency_keys; v_existing_link public.pocket_receipt_payment_links;
  v_payment jsonb; v_response jsonb; v_allocation_id uuid; v_receipt_id uuid; v_payment_date date; v_timezone text;
  v_customer_id uuid; v_duplicate boolean:=false;
begin
  if not public.pocket_is_workspace(p_business_id) then raise exception 'POCKET_RECEIPT_NOT_AUTHORISED'; end if;
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id);
  if v_role not in('owner','admin','manager') then raise exception 'POCKET_RECEIPT_NOT_AUTHORISED'; end if;
  perform public.pocket_authorize_capability_internal(p_business_id,p_actor_id,'pocket.receipt.process',p_idempotency_key,false,'{}'::jsonb);
  perform public.pocket_authorize_capability_internal(p_business_id,p_actor_id,'pocket.payment.record',p_idempotency_key,false,'{}'::jsonb);
  if char_length(btrim(coalesce(p_idempotency_key,''))) not between 8 and 96 or p_request_hash!~'^[0-9a-f]{64}$' then
    raise exception 'POCKET_PAYMENT_INVALID_REQUEST';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':pocket-receipt:'||p_intake_id::text,0));
  select * into v_existing from public.payment_operation_idempotency_keys
    where business_id=p_business_id and action_scope='pocket_confirm_receipt_payment' and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_hash<>p_request_hash then raise exception 'P17_IDEMPOTENCY_CONFLICT'; end if;
    return v_existing.response||jsonb_build_object('idempotentReplay',true);
  end if;
  select * into v_existing_link from public.pocket_receipt_payment_links
    where business_id=p_business_id and intake_id=p_intake_id;
  if found then
    raise exception 'POCKET_RECEIPT_REVIEW_STALE';
  end if;
  select * into v_intake from public.document_intakes
    where id=p_intake_id and business_id=p_business_id and intended_workflow='payment_evidence' and deleted_at is null for update;
  if not found then raise exception 'POCKET_RECEIPT_NOT_FOUND'; end if;
  if v_intake.status in('submitted','cancelled','failed') then raise exception 'POCKET_RECEIPT_REVIEW_STALE'; end if;
  select * into v_evidence from public.evidence_files
    where intake_id=p_intake_id and business_id=p_business_id and kind='original' and is_current and soft_deleted_at is null
    order by evidence_version desc limit 1 for update;
  if not found or v_evidence.scan_status<>'clean' or v_evidence.processing_status not in('completed','needs_review') then
    raise exception 'POCKET_RECEIPT_EVIDENCE_NOT_READY';
  end if;
  select * into v_extraction from public.document_intake_extractions
    where intake_id=p_intake_id and business_id=p_business_id and evidence_id=v_evidence.id
      and document_version=v_evidence.evidence_version and status in('completed','needs_review')
    order by extraction_version desc limit 1 for update;
  if not found then raise exception 'POCKET_RECEIPT_EVIDENCE_NOT_READY'; end if;
  select * into v_confirmation from public.document_intake_confirmations
    where intake_id=p_intake_id and business_id=p_business_id and extraction_id=v_extraction.id and review_status='confirmed'
    order by confirmation_version desc limit 1 for update;
  if not found or v_confirmation.chosen_amount_minor is null or v_confirmation.chosen_amount_minor<=0
    or v_confirmation.currency is null or not v_confirmation.currency_confirmed
    or not v_confirmation.date_interpretation_confirmed then raise exception 'POCKET_RECEIPT_REVIEW_REQUIRED'; end if;
  if v_confirmation.confirmed_document_kind not in(
    'online_bank_transfer_receipt','transaction_screenshot','bank_in_cash_deposit_receipt','payment_receipt'
  ) or v_confirmation.represents_financial_movement is distinct from true then raise exception 'POCKET_RECEIPT_KIND_UNSUPPORTED'; end if;
  if v_confirmation.document_datetime is null then raise exception 'POCKET_RECEIPT_DATE_REQUIRED'; end if;
  v_payment_date:=(v_confirmation.document_datetime at time zone 'UTC')::date;
  select coalesce(timezone,'UTC') into v_timezone from public.businesses where id=p_business_id;
  v_duplicate:=v_evidence.duplicate_match_status='exact_hash_warning' or exists(
    select 1 from public.evidence_files prior where prior.business_id=p_business_id and prior.id<>v_evidence.id
      and prior.kind='original' and prior.soft_deleted_at is null and prior.content_sha256=v_evidence.content_sha256
  ) or exists(
    select 1 from public.payment_receipts prior where prior.business_id=p_business_id
      and prior.amount_minor=v_confirmation.chosen_amount_minor and prior.currency=v_confirmation.currency
      and (prior.received_at at time zone v_timezone)::date=v_payment_date
  );
  if v_duplicate and not coalesce(p_duplicate_acknowledged,false) then raise exception 'POCKET_RECEIPT_DUPLICATE_REVIEW_REQUIRED'; end if;
  select customer_id into v_customer_id from public.obligations
    where id=p_debt_id and business_id=p_business_id and origin_product_type='pocket' and archived_at is null;
  if not found then raise exception 'POCKET_DEBT_NOT_FOUND'; end if;

  v_payment:=public.pocket_post_payment(
    p_business_id,p_actor_id,p_debt_id,v_confirmation.chosen_amount_minor,p_expected_outstanding_minor,
    v_payment_date,p_method,v_confirmation.reference,p_note,
    'receipt:'||p_idempotency_key,p_request_hash
  );
  v_allocation_id:=(v_payment->>'allocationId')::uuid;
  v_receipt_id:=(v_payment->>'receiptId')::uuid;
  insert into public.pocket_receipt_payment_links(
    business_id,intake_id,evidence_id,confirmation_id,allocation_id,receipt_id,debt_id,customer_id,created_by
  ) values(
    p_business_id,p_intake_id,v_evidence.id,v_confirmation.id,v_allocation_id,v_receipt_id,p_debt_id,v_customer_id,p_actor_id
  );
  update public.document_intakes set status='submitted',submitted_at=now(),version=version+1,updated_at=now()
    where id=p_intake_id;
  insert into public.document_intake_events(
    intake_id,business_id,from_status,to_status,intake_version,actor_id,actor_role,action,metadata,idempotency_key
  ) values(
    p_intake_id,p_business_id,v_intake.status,'submitted',v_intake.version+1,p_actor_id,v_role,
    'pocket.receipt.payment_confirmed',jsonb_build_object('evidence_id',v_evidence.id,'confirmation_id',v_confirmation.id,
      'allocation_id',v_allocation_id,'receipt_id',v_receipt_id,'debt_id',p_debt_id,'duplicate_acknowledged',coalesce(p_duplicate_acknowledged,false)),
    p_idempotency_key
  );
  v_response:=v_payment||jsonb_build_object(
    'intakeId',p_intake_id,'evidenceId',v_evidence.id,'confirmationId',v_confirmation.id,'idempotentReplay',false
  );
  insert into public.payment_operation_idempotency_keys(business_id,action_scope,idempotency_key,request_hash,response,created_by)
    values(p_business_id,'pocket_confirm_receipt_payment',p_idempotency_key,p_request_hash,v_response,p_actor_id);
  insert into public.audit_logs(
    business_id,action,actor_type,actor_id,actor_role,entity_type,entity_id,idempotency_key,metadata
  ) values(
    p_business_id,'pocket.receipt.payment_confirmed','staff',p_actor_id,v_role,'document_intake',p_intake_id::text,p_idempotency_key,
    jsonb_build_object('evidence_id',v_evidence.id,'confirmation_id',v_confirmation.id,'allocation_id',v_allocation_id,
      'receipt_id',v_receipt_id,'debt_id',p_debt_id,'customer_id',v_customer_id,'amount_minor',v_confirmation.chosen_amount_minor,
      'currency',v_confirmation.currency,'duplicate_acknowledged',coalesce(p_duplicate_acknowledged,false))
  );
  return v_response;
end $$;

revoke all on function public.pocket_confirm_receipt_payment(uuid,uuid,uuid,uuid,bigint,text,text,boolean,text,text)
  from public,anon,authenticated;
grant execute on function public.pocket_confirm_receipt_payment(uuid,uuid,uuid,uuid,bigint,text,text,boolean,text,text)
  to service_role;

commit;

-- Rollback: disable Pocket receipt confirmation writes first. Keep immutable
-- intake, evidence, extraction, review, payment, allocation and audit history.
-- Drop pocket_confirm_receipt_payment, then the link-table policy/trigger/table
-- only after exporting its evidence-to-payment provenance. Do not delete shared
-- originals or reverse confirmed payments merely to remove this feature.
