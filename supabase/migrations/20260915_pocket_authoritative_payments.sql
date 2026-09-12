-- Prompt 5: Pocket payments through the shared receipt/allocation/journal truth.
-- Review and apply after 20260914. No data is deleted or rewritten.

alter table public.payment_allocations alter column case_id drop not null;
alter table public.payment_allocations alter column case_financial_event_id drop not null;
alter table public.payment_allocations drop constraint if exists payment_allocations_target_scope_check;
alter table public.payment_allocations add constraint payment_allocations_target_scope_check check (
  (case_id is not null and case_financial_event_id is not null)
  or
  (case_id is null and case_financial_event_id is null and obligation_id is not null
    and payment_id is null and exchange_rate_id is null and receipt_currency=target_currency
    and receipt_amount_minor=target_amount_minor and overpayment_minor=0)
);

create unique index if not exists payment_receipts_pocket_reference_unique
  on public.payment_receipts(business_id,lower(reference))
  where source_system='collectboss_pocket' and reference is not null;
create index if not exists payment_allocations_pocket_obligation_timeline_idx
  on public.payment_allocations(business_id,obligation_id,created_at desc)
  where case_id is null and obligation_id is not null;

create or replace function public.pocket_post_payment(
  p_business_id uuid,p_actor_id uuid,p_debt_id uuid,p_amount_minor bigint,p_expected_outstanding_minor bigint,
  p_payment_date date,p_method text,p_reference text,p_note text,p_idempotency_key text,p_request_hash text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_role text; v_debt public.obligations; v_customer public.debtors; v_existing public.payment_operation_idempotency_keys;
  v_timezone text; v_today date; v_received_at timestamptz; v_receipt_response jsonb; v_receipt_id uuid;
  v_allocation_id uuid:=gen_random_uuid(); v_journal_id uuid; v_response jsonb; v_status text;
begin
  if not public.pocket_is_workspace(p_business_id) then raise exception 'POCKET_PAYMENT_NOT_AUTHORISED'; end if;
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id);
  if v_role not in('owner','admin','manager') then raise exception 'POCKET_PAYMENT_NOT_AUTHORISED'; end if;
  perform public.pocket_authorize_capability_internal(p_business_id,p_actor_id,'pocket.payment.record',p_idempotency_key,false,'{}'::jsonb);
  if nullif(btrim(coalesce(p_idempotency_key,'')),'') is null or p_request_hash!~'^[0-9a-f]{64}$' then raise exception 'POCKET_PAYMENT_INVALID_REQUEST'; end if;
  if p_method not in('cash','bank_transfer','card','cheque','other') or p_amount_minor<=0 then raise exception 'POCKET_PAYMENT_INVALID_REQUEST'; end if;

  select * into v_existing from public.payment_operation_idempotency_keys
    where business_id=p_business_id and action_scope='pocket_post_payment' and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_hash<>p_request_hash then raise exception 'P17_IDEMPOTENCY_CONFLICT'; end if;
    return v_existing.response||jsonb_build_object('idempotentReplay',true);
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':pocket-debt:'||p_debt_id::text,0));
  select * into v_debt from public.obligations where id=p_debt_id and business_id=p_business_id
    and origin_product_type='pocket' and archived_at is null for update;
  if not found then raise exception 'POCKET_DEBT_NOT_FOUND'; end if;
  if v_debt.status in('draft','void','written_off') or v_debt.outstanding_minor<=0 then raise exception 'POCKET_DEBT_NOT_PAYABLE'; end if;
  if p_expected_outstanding_minor is distinct from v_debt.outstanding_minor then raise exception 'POCKET_PAYMENT_STALE_BALANCE'; end if;
  if p_amount_minor>v_debt.outstanding_minor then raise exception 'POCKET_PAYMENT_AMOUNT_TOO_HIGH'; end if;
  if upper(v_debt.currency)<>(select upper(default_currency) from public.businesses where id=p_business_id) then raise exception 'POCKET_PAYMENT_CURRENCY_MISMATCH'; end if;

  select coalesce(timezone,'UTC') into v_timezone from public.businesses where id=p_business_id;
  v_today:=(now() at time zone coalesce(v_timezone,'UTC'))::date;
  if p_payment_date is null or p_payment_date>v_today then raise exception 'POCKET_PAYMENT_INVALID_DATE'; end if;
  v_received_at:=p_payment_date::timestamp at time zone coalesce(v_timezone,'UTC');
  if nullif(btrim(coalesce(p_reference,'')),'') is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':pocket-payment-reference:'||lower(btrim(p_reference)),0));
    if exists(select 1 from public.payment_receipts where business_id=p_business_id and source_system='collectboss_pocket'
      and lower(reference)=lower(btrim(p_reference))) then raise exception 'POCKET_PAYMENT_DUPLICATE_REFERENCE'; end if;
  end if;

  select * into v_customer from public.debtors where id=v_debt.customer_id and business_id=p_business_id;
  v_receipt_response:=public.payment_operation_record_receipt(
    p_business_id,p_actor_id,'payment',p_amount_minor,v_debt.currency,v_received_at,'manual','collectboss_pocket',
    'pocket:'||p_idempotency_key,null,nullif(btrim(p_reference),''),coalesce(v_customer.individual_name,v_customer.business_name),
    jsonb_build_object('product','pocket','debt_id',p_debt_id,'customer_id',v_debt.customer_id,'payment_date',p_payment_date,'method',p_method,'note',nullif(btrim(p_note),'')),
    'pocket-receipt:'||p_idempotency_key,p_request_hash
  );
  v_receipt_id:=(v_receipt_response->>'receipt_id')::uuid;
  v_journal_id:=public.payment_operation_create_journal(p_business_id,'allocation','payment_allocations',v_allocation_id,
    'pocket-allocation:'||p_idempotency_key,jsonb_build_array(
      jsonb_build_object('account','unallocated_funds','side','debit','amountMinor',p_amount_minor,'currency',v_debt.currency),
      jsonb_build_object('account','accounts_receivable_control','side','credit','amountMinor',p_amount_minor,'currency',v_debt.currency)
    ),p_actor_id);
  insert into public.payment_allocations(
    id,business_id,receipt_id,event_type,reverses_allocation_id,case_id,obligation_id,
    receipt_amount_minor,receipt_currency,target_amount_minor,target_currency,overpayment_minor,
    exchange_rate_id,payment_id,case_financial_event_id,journal_id,reason,approval_request_id,idempotency_key,created_by
  ) values(
    v_allocation_id,p_business_id,v_receipt_id,'allocation',null,null,p_debt_id,
    p_amount_minor,v_debt.currency,p_amount_minor,v_debt.currency,0,null,null,null,v_journal_id,
    nullif(btrim(p_note),''),null,'pocket-allocation:'||p_idempotency_key,p_actor_id
  );
  update public.obligations set paid_minor=paid_minor+p_amount_minor,updated_at=now() where id=p_debt_id;
  select case when status='paid' or outstanding_minor=0 then 'settled'
    when pocket_due_date is not null and pocket_due_date<v_today then 'overdue'
    when paid_minor>0 then 'partially_paid' else 'active' end into v_status
    from public.obligations where id=p_debt_id;
  select jsonb_build_object(
    'allocationId',v_allocation_id,'receiptId',v_receipt_id,'debtId',p_debt_id,'customerId',v_debt.customer_id,
    'amountMinor',p_amount_minor,'paidMinor',paid_minor,'remainingMinor',outstanding_minor,'currency',currency,
    'status',v_status,'paymentDate',p_payment_date,'method',p_method,'reference',nullif(btrim(p_reference),''),
    'idempotentReplay',false
  ) into v_response from public.obligations where id=p_debt_id;
  insert into public.payment_operation_idempotency_keys(business_id,action_scope,idempotency_key,request_hash,response,created_by)
    values(p_business_id,'pocket_post_payment',p_idempotency_key,p_request_hash,v_response,p_actor_id);
  insert into public.audit_logs(business_id,action,actor_type,actor_id,actor_role,entity_type,entity_id,idempotency_key,metadata)
    values(p_business_id,'pocket.payment.confirmed','staff',p_actor_id,v_role,'payment_allocation',v_allocation_id::text,p_idempotency_key,
      jsonb_build_object('receipt_id',v_receipt_id,'debt_id',p_debt_id,'customer_id',v_debt.customer_id,'amount_minor',p_amount_minor,'currency',v_debt.currency,'method',p_method));
  return v_response;
end $$;

create or replace function public.pocket_reverse_payment(
  p_business_id uuid,p_actor_id uuid,p_allocation_id uuid,p_reason text,p_idempotency_key text,p_request_hash text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_role text; v_original public.payment_allocations; v_debt public.obligations; v_receipt public.payment_receipts;
  v_existing public.payment_operation_idempotency_keys; v_reversal_id uuid:=gen_random_uuid(); v_journal_id uuid; v_response jsonb; v_today date; v_timezone text; v_status text;
begin
  if not public.pocket_is_workspace(p_business_id) then raise exception 'POCKET_PAYMENT_NOT_AUTHORISED'; end if;
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id);
  if v_role not in('owner','admin') then raise exception 'POCKET_PAYMENT_REVERSE_NOT_AUTHORISED'; end if;
  perform public.pocket_authorize_capability_internal(p_business_id,p_actor_id,'pocket.payment.record',p_idempotency_key,false,'{}'::jsonb);
  if char_length(btrim(coalesce(p_reason,'')))<3 then raise exception 'P17_REASON_REQUIRED'; end if;
  select * into v_existing from public.payment_operation_idempotency_keys
    where business_id=p_business_id and action_scope='pocket_reverse_payment' and idempotency_key=p_idempotency_key;
  if found then if v_existing.request_hash<>p_request_hash then raise exception 'P17_IDEMPOTENCY_CONFLICT'; end if; return v_existing.response||jsonb_build_object('idempotentReplay',true); end if;

  select * into v_original from public.payment_allocations where id=p_allocation_id and business_id=p_business_id
    and event_type='allocation' and case_id is null and obligation_id is not null for update;
  if not found then raise exception 'P17_ALLOCATION_NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':pocket-debt:'||v_original.obligation_id::text,0));
  if exists(select 1 from public.payment_allocations where reverses_allocation_id=p_allocation_id) then raise exception 'P17_ALLOCATION_ALREADY_REVERSED'; end if;
  select * into v_debt from public.obligations where id=v_original.obligation_id and business_id=p_business_id and origin_product_type='pocket' for update;
  if not found or v_debt.paid_minor<v_original.target_amount_minor then raise exception 'POCKET_PAYMENT_REVERSAL_CONFLICT'; end if;
  select * into v_receipt from public.payment_receipts where id=v_original.receipt_id and business_id=p_business_id for update;
  perform set_config('collectboss.pocket_financial_correction','on',true);
  v_journal_id:=public.payment_operation_create_journal(p_business_id,'allocation_reversal','payment_allocations',v_reversal_id,
    'pocket-reversal:'||p_idempotency_key,jsonb_build_array(
      jsonb_build_object('account','accounts_receivable_control','side','debit','amountMinor',v_original.target_amount_minor,'currency',v_original.target_currency),
      jsonb_build_object('account','unallocated_funds','side','credit','amountMinor',v_original.receipt_amount_minor,'currency',v_original.receipt_currency)
    ),p_actor_id);
  insert into public.payment_allocations(
    id,business_id,receipt_id,event_type,reverses_allocation_id,case_id,obligation_id,
    receipt_amount_minor,receipt_currency,target_amount_minor,target_currency,overpayment_minor,
    exchange_rate_id,payment_id,case_financial_event_id,journal_id,reason,approval_request_id,idempotency_key,created_by
  ) values(
    v_reversal_id,p_business_id,v_original.receipt_id,'reversal',v_original.id,null,v_original.obligation_id,
    v_original.receipt_amount_minor,v_original.receipt_currency,v_original.target_amount_minor,v_original.target_currency,0,
    null,null,null,v_journal_id,btrim(p_reason),null,'pocket-reversal:'||p_idempotency_key,p_actor_id
  );
  update public.obligations set paid_minor=paid_minor-v_original.target_amount_minor,updated_at=now() where id=v_debt.id;
  select coalesce(timezone,'UTC') into v_timezone from public.businesses where id=p_business_id;
  v_today:=(now() at time zone coalesce(v_timezone,'UTC'))::date;
  select case when pocket_due_date is not null and pocket_due_date<v_today then 'overdue' when paid_minor>0 then 'partially_paid' else 'active' end into v_status from public.obligations where id=v_debt.id;
  select jsonb_build_object(
    'reversalId',v_reversal_id,'allocationId',p_allocation_id,'receiptId',v_original.receipt_id,'debtId',v_debt.id,
    'amountMinor',v_original.target_amount_minor,'paidMinor',paid_minor,'remainingMinor',outstanding_minor,'currency',currency,
    'status',v_status,'reason',btrim(p_reason),'idempotentReplay',false
  ) into v_response from public.obligations where id=v_debt.id;
  insert into public.payment_operation_idempotency_keys(business_id,action_scope,idempotency_key,request_hash,response,created_by)
    values(p_business_id,'pocket_reverse_payment',p_idempotency_key,p_request_hash,v_response,p_actor_id);
  insert into public.audit_logs(business_id,action,actor_type,actor_id,actor_role,entity_type,entity_id,idempotency_key,metadata)
    values(p_business_id,'pocket.payment.reversed','staff',p_actor_id,v_role,'payment_allocation',p_allocation_id::text,p_idempotency_key,
      jsonb_build_object('reversal_id',v_reversal_id,'debt_id',v_debt.id,'receipt_id',v_original.receipt_id,'amount_minor',v_original.target_amount_minor,'currency',v_original.target_currency,'reason',btrim(p_reason)));
  return v_response;
end $$;

-- Financial reversals must restore truth even when they put the workspace over its plan limit.
create or replace function public.pocket_active_debt_guard()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_business uuid:=coalesce(new.business_id,old.business_id); v_old boolean:=false; v_new boolean:=false; v_count integer;
begin
  if not public.pocket_is_workspace(v_business) then if tg_op='DELETE' then return old; else return new; end if; end if;
  if tg_op<>'INSERT' then v_old:=public.pocket_obligation_is_active(old); end if;
  if tg_op<>'DELETE' then v_new:=public.pocket_obligation_is_active(new); end if;
  if v_old=v_new then if tg_op='DELETE' then return old; else return new; end if; end if;
  insert into public.pocket_active_debt_counters(business_id,active_count) values(v_business,0) on conflict do nothing;
  select active_count into v_count from public.pocket_active_debt_counters where business_id=v_business for update;
  if v_new and not v_old and v_count>=100 and coalesce(current_setting('collectboss.pocket_financial_correction',true),'off')<>'on' then raise exception 'LIMIT_REACHED'; end if;
  update public.pocket_active_debt_counters set active_count=greatest(0,active_count+case when v_new then 1 else -1 end),updated_at=now() where business_id=v_business;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;

revoke all on function public.pocket_post_payment(uuid,uuid,uuid,bigint,bigint,date,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.pocket_reverse_payment(uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.pocket_post_payment(uuid,uuid,uuid,bigint,bigint,date,text,text,text,text,text) to service_role;
grant execute on function public.pocket_reverse_payment(uuid,uuid,uuid,text,text,text) to service_role;

-- Rollback: disable Pocket payment writes, reverse or export any Pocket allocations,
-- then drop the two RPCs and indexes. Restore NOT NULL only after confirming no
-- case-free allocation rows remain. Existing Main allocations are never modified.
