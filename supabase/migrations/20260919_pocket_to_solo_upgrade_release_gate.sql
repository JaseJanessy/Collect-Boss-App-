-- Prompt 10: staged, idempotent Pocket-to-Solo upgrade.
-- Additive proposal only. Review and apply to a backed-up staging database
-- after migrations 20260912 through 20260918. This file is not evidence that
-- any remote migration, backup, billing checkout, or rollback rehearsal ran.

begin;

create table if not exists public.pocket_solo_upgrade_runs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  initiated_by uuid not null references auth.users(id) on delete restrict,
  status text not null default 'prepared' check (status in (
    'prepared','review_required','checkout_pending','processing','completed','failed'
  )),
  target_plan_slug text not null default 'starter' check (target_plan_slug='starter'),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 120),
  request_hash char(64) not null check (request_hash ~ '^[0-9a-f]{64}$'),
  checkout_session_id text unique,
  provider_event_id text unique,
  source_counts jsonb not null default '{}'::jsonb check (jsonb_typeof(source_counts)='object'),
  reconciliation jsonb not null default '{}'::jsonb check (jsonb_typeof(reconciliation)='object'),
  pocket_subscription_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(pocket_subscription_ids)='array'),
  pocket_subscription_cleanup_status text not null default 'not_started'
    check (pocket_subscription_cleanup_status in ('not_started','pending','completed','failed')),
  last_error_code text,
  started_at timestamptz not null default now(),
  checkout_attached_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (business_id,idempotency_key)
);

create unique index if not exists pocket_solo_upgrade_one_completed_business_idx
  on public.pocket_solo_upgrade_runs(business_id) where status='completed';
create unique index if not exists pocket_solo_upgrade_one_active_business_idx
  on public.pocket_solo_upgrade_runs(business_id) where status in('prepared','checkout_pending','processing');
create index if not exists pocket_solo_upgrade_runs_business_created_idx
  on public.pocket_solo_upgrade_runs(business_id,started_at desc);

create table if not exists public.pocket_solo_upgrade_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.pocket_solo_upgrade_runs(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  obligation_id uuid not null,
  disposition text not null check (disposition in (
    'migrate_active','migrate_settled','preserve_cancelled',
    'review_disputed','review_ambiguous','review_malformed'
  )),
  status text not null check (status in ('ready','preserve_only','review_required','migrated')),
  review_reason text,
  target_case_id text,
  source_snapshot jsonb not null check (jsonb_typeof(source_snapshot)='object'),
  reconciliation jsonb not null default '{}'::jsonb check (jsonb_typeof(reconciliation)='object'),
  created_at timestamptz not null default now(),
  migrated_at timestamptz,
  foreign key(obligation_id,business_id) references public.obligations(id,business_id) on delete restrict,
  foreign key(target_case_id,business_id) references public.cases(id,business_id) on delete restrict,
  unique(run_id,obligation_id)
);

create index if not exists pocket_solo_upgrade_items_review_idx
  on public.pocket_solo_upgrade_items(business_id,run_id,status,created_at);

alter table public.pocket_solo_upgrade_runs enable row level security;
alter table public.pocket_solo_upgrade_items enable row level security;

drop policy if exists pocket_solo_upgrade_runs_owner_read on public.pocket_solo_upgrade_runs;
create policy pocket_solo_upgrade_runs_owner_read on public.pocket_solo_upgrade_runs
for select to authenticated using (public.has_business_permission(business_id,'billing.manage'));
drop policy if exists pocket_solo_upgrade_items_owner_read on public.pocket_solo_upgrade_items;
create policy pocket_solo_upgrade_items_owner_read on public.pocket_solo_upgrade_items
for select to authenticated using (public.has_business_permission(business_id,'billing.manage'));

revoke all on public.pocket_solo_upgrade_runs,public.pocket_solo_upgrade_items from public,anon,authenticated;
grant select on public.pocket_solo_upgrade_runs,public.pocket_solo_upgrade_items to authenticated;
grant all on public.pocket_solo_upgrade_runs,public.pocket_solo_upgrade_items to service_role;

create or replace function public.pocket_prepare_solo_upgrade(
  p_business_id uuid,p_actor_id uuid,p_idempotency_key text,p_request_hash text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_run public.pocket_solo_upgrade_runs;
  v_review_count integer;
begin
  if char_length(btrim(coalesce(p_idempotency_key,''))) not between 8 and 120
    or p_request_hash !~ '^[0-9a-f]{64}$' then raise exception 'POCKET_UPGRADE_INVALID_REQUEST'; end if;
  if not exists(select 1 from public.businesses where id=p_business_id and owner_id=p_actor_id) then
    raise exception 'POCKET_UPGRADE_OWNER_REQUIRED';
  end if;
  if exists(select 1 from public.business_memberships where business_id=p_business_id and status='active') then
    raise exception 'POCKET_UPGRADE_SINGLE_USER_REQUIRED';
  end if;
  if not exists(select 1 from public.workspace_product_states where business_id=p_business_id and product_type='pocket') then
    raise exception 'POCKET_UPGRADE_SOURCE_NOT_POCKET';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':pocket-solo-upgrade',0));
  select * into v_run from public.pocket_solo_upgrade_runs
    where business_id=p_business_id and idempotency_key=btrim(p_idempotency_key) for update;
  if found then
    if v_run.request_hash<>p_request_hash then raise exception 'POCKET_UPGRADE_IDEMPOTENCY_CONFLICT'; end if;
    return jsonb_build_object('runId',v_run.id,'status',v_run.status,'counts',v_run.source_counts,'idempotentReplay',true);
  end if;
  if exists(select 1 from public.pocket_solo_upgrade_runs where business_id=p_business_id and status='completed') then
    raise exception 'POCKET_UPGRADE_ALREADY_COMPLETED';
  end if;

  select * into v_run from public.pocket_solo_upgrade_runs
    where business_id=p_business_id and status in('prepared','checkout_pending','processing')
    order by started_at desc limit 1 for update;
  if found then
    return jsonb_build_object('runId',v_run.id,'status',v_run.status,'counts',v_run.source_counts,'idempotentReplay',true);
  end if;
  -- A new preparation is the explicit refresh path after the owner corrects
  -- review-queue source records. Historical review snapshots remain auditable.
  update public.pocket_solo_upgrade_runs set status='failed',last_error_code='REVIEW_REFRESHED',updated_at=now()
    where business_id=p_business_id and status='review_required';

  insert into public.pocket_solo_upgrade_runs(
    business_id,initiated_by,idempotency_key,request_hash
  ) values(p_business_id,p_actor_id,btrim(p_idempotency_key),p_request_hash)
  returning * into v_run;

  insert into public.pocket_solo_upgrade_items(
    run_id,business_id,obligation_id,disposition,status,review_reason,target_case_id,source_snapshot
  )
  select
    v_run.id,o.business_id,o.id,
    case
      when rco.obligation_id is not null then 'review_ambiguous'
      when o.status='disputed' then 'review_disputed'
      when d.id is null or o.due_date is null or o.currency !~ '^[A-Z]{3}$'
        or nullif(btrim(o.reference),'') is null
        or o.original_amount_minor+o.adjustments_minor<o.paid_minor then 'review_malformed'
      when o.archived_at is not null or o.status in('draft','void','written_off') then 'preserve_cancelled'
      when o.status='paid' or o.outstanding_minor=0 then 'migrate_settled'
      else 'migrate_active'
    end,
    case
      when rco.obligation_id is not null or o.status='disputed' or d.id is null or o.due_date is null
        or o.currency !~ '^[A-Z]{3}$' or nullif(btrim(o.reference),'') is null
        or o.original_amount_minor+o.adjustments_minor<o.paid_minor then 'review_required'
      when o.archived_at is not null or o.status in('draft','void','written_off') then 'preserve_only'
      else 'ready'
    end,
    case
      when rco.obligation_id is not null then 'Debt is already linked to a recovery case.'
      when o.status='disputed' then 'Disputed debt requires an authorised mapping decision.'
      when d.id is null then 'Customer ownership could not be verified.'
      when o.due_date is null or o.currency !~ '^[A-Z]{3}$' or nullif(btrim(o.reference),'') is null
        or o.original_amount_minor+o.adjustments_minor<o.paid_minor then 'Debt financial or identifying fields require review.'
      when o.archived_at is not null or o.status in('draft','void','written_off')
        then 'Cancelled, draft, written-off, or archived debt is preserved without an active Solo case.'
      else null
    end,
    case when rco.obligation_id is null and o.status<>'disputed' and o.archived_at is null
      and o.status not in('draft','void','written_off')
      then 'CB-SOLO-'||substr(replace(o.id::text,'-',''),1,20) end,
    jsonb_build_object(
      'customerId',o.customer_id,'reference',o.reference,'currency',o.currency,'status',o.status,
      'originalAmountMinor',o.original_amount_minor,'adjustmentsMinor',o.adjustments_minor,
      'contractualDueMinor',o.contractual_due_minor,'paidMinor',o.paid_minor,
      'outstandingMinor',o.outstanding_minor,'dueDate',o.due_date,'archivedAt',o.archived_at,
      'allocationCount',(select count(*) from public.payment_allocations pa where pa.business_id=o.business_id and pa.obligation_id=o.id),
      'receiptLinkCount',(select count(*) from public.pocket_receipt_payment_links pr where pr.business_id=o.business_id and pr.debt_id=o.id),
      'reminderEventCount',(select count(*) from public.pocket_reminder_events pe where pe.business_id=o.business_id and pe.obligation_id=o.id),
      'invoiceCount',(select count(*) from public.pocket_simple_invoices pi where pi.business_id=o.business_id and pi.obligation_id=o.id)
    )
  from public.obligations o
  left join public.debtors d on d.id=o.customer_id and d.business_id=o.business_id
  left join public.recovery_case_obligations rco on rco.obligation_id=o.id
  where o.business_id=p_business_id and o.origin_product_type='pocket';

  select count(*) into v_review_count from public.pocket_solo_upgrade_items
    where run_id=v_run.id and status='review_required';
  update public.pocket_solo_upgrade_runs set
    status=case when v_review_count>0 then 'review_required' else 'prepared' end,
    source_counts=jsonb_build_object(
      'customers',(select count(*) from public.debtors where business_id=p_business_id),
      'debts',(select count(*) from public.obligations where business_id=p_business_id and origin_product_type='pocket'),
      'migrate',(select count(*) from public.pocket_solo_upgrade_items where run_id=v_run.id and status='ready'),
      'preserveOnly',(select count(*) from public.pocket_solo_upgrade_items where run_id=v_run.id and status='preserve_only'),
      'reviewRequired',v_review_count,
      'paymentEvents',(select count(*) from public.payment_allocations where business_id=p_business_id and obligation_id is not null),
      'receipts',(select count(*) from public.pocket_receipt_payment_links where business_id=p_business_id),
      'reminderEvents',(select count(*) from public.pocket_reminder_events where business_id=p_business_id),
      'simpleInvoices',(select count(*) from public.pocket_simple_invoices where business_id=p_business_id)
    ),updated_at=now()
  where id=v_run.id returning * into v_run;
  insert into public.audit_logs(business_id,action,actor_type,actor_id,entity_type,entity_id,idempotency_key,metadata)
  values(p_business_id,'pocket.solo_upgrade.prepared','owner',p_actor_id,'pocket_solo_upgrade',v_run.id::text,
    p_idempotency_key,jsonb_build_object('status',v_run.status,'counts',v_run.source_counts));
  return jsonb_build_object('runId',v_run.id,'status',v_run.status,'counts',v_run.source_counts,'idempotentReplay',false);
end $$;

create or replace function public.pocket_attach_solo_upgrade_checkout(
  p_business_id uuid,p_actor_id uuid,p_run_id uuid,p_checkout_session_id text
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not exists(select 1 from public.businesses where id=p_business_id and owner_id=p_actor_id) then
    raise exception 'POCKET_UPGRADE_OWNER_REQUIRED';
  end if;
  update public.pocket_solo_upgrade_runs set status='checkout_pending',
    checkout_session_id=p_checkout_session_id,checkout_attached_at=coalesce(checkout_attached_at,now()),updated_at=now()
  where id=p_run_id and business_id=p_business_id and status in('prepared','checkout_pending')
    and (checkout_session_id is null or checkout_session_id=p_checkout_session_id);
  if not found then raise exception 'POCKET_UPGRADE_CHECKOUT_CONFLICT'; end if;
end $$;

create or replace function public.pocket_commit_solo_upgrade(
  p_business_id uuid,p_run_id uuid,p_actor_id uuid,p_provider_event_id text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_run public.pocket_solo_upgrade_runs;
  v_item public.pocket_solo_upgrade_items;
  v_obligation public.obligations;
  v_customer public.debtors;
  v_case_status text;
  v_subscription_ids jsonb;
  v_migrated integer:=0;
  v_due bigint:=0;
  v_paid bigint:=0;
  v_outstanding bigint:=0;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':pocket-solo-upgrade',0));
  select * into v_run from public.pocket_solo_upgrade_runs
    where id=p_run_id and business_id=p_business_id for update;
  if not found then raise exception 'POCKET_UPGRADE_RUN_NOT_FOUND'; end if;
  if v_run.status='completed' then
    return jsonb_build_object('runId',v_run.id,'status','completed','reconciliation',v_run.reconciliation,
      'pocketSubscriptionIds',v_run.pocket_subscription_ids,'idempotentReplay',true);
  end if;
  if v_run.status<>'checkout_pending' or v_run.initiated_by<>p_actor_id then
    raise exception 'POCKET_UPGRADE_NOT_READY';
  end if;
  if exists(select 1 from public.pocket_solo_upgrade_items where run_id=p_run_id and status='review_required') then
    raise exception 'POCKET_UPGRADE_REVIEW_REQUIRED';
  end if;
  if not exists(select 1 from public.subscriptions where business_id=p_business_id
    and plan_slug='starter' and status in('active','trialing')) then
    raise exception 'POCKET_UPGRADE_SOLO_SUBSCRIPTION_REQUIRED';
  end if;
  if not exists(select 1 from public.workspace_product_states where business_id=p_business_id and product_type='pocket') then
    raise exception 'POCKET_UPGRADE_SOURCE_NOT_POCKET';
  end if;

  -- Validate every source snapshot before the first financial projection write.
  for v_item in select * from public.pocket_solo_upgrade_items where run_id=p_run_id and status='ready' order by obligation_id loop
    select * into v_obligation from public.obligations
      where id=v_item.obligation_id and business_id=p_business_id and origin_product_type='pocket' for update;
    if not found or v_obligation.customer_id::text<>v_item.source_snapshot->>'customerId'
      or v_obligation.status<>v_item.source_snapshot->>'status'
      or v_obligation.contractual_due_minor<>(v_item.source_snapshot->>'contractualDueMinor')::bigint
      or v_obligation.paid_minor<>(v_item.source_snapshot->>'paidMinor')::bigint
      or v_obligation.outstanding_minor<>(v_item.source_snapshot->>'outstandingMinor')::bigint then
      raise exception 'POCKET_UPGRADE_SOURCE_CHANGED';
    end if;
  end loop;

  update public.pocket_solo_upgrade_runs set status='processing',provider_event_id=p_provider_event_id,updated_at=now()
    where id=p_run_id;

  for v_item in select * from public.pocket_solo_upgrade_items where run_id=p_run_id and status='ready' order by obligation_id loop
    select * into v_obligation from public.obligations where id=v_item.obligation_id and business_id=p_business_id;
    select * into v_customer from public.debtors where id=v_obligation.customer_id and business_id=p_business_id;
    v_case_status:=case when v_obligation.status='paid' or v_obligation.outstanding_minor=0 then 'paid'
      when v_obligation.status='overdue' then 'overdue'
      when v_obligation.paid_minor>0 then 'partial_paid' else 'action_needed' end;
    insert into public.cases(
      id,business_id,debtor_id,account_id,case_scope,debtor_type,debtor_name,debtor_phone,debtor_email,
      debtor_company,debtor_reg_no,debtor_location,currency,amount_owed,amount_paid,
      original_principal_minor,contractual_due_minor,approved_payment_minor,outstanding_minor,overpayment_minor,
      due_date,invoice_no,status,payment_lock_mode,notes,metadata
    ) values(
      v_item.target_case_id,p_business_id,v_customer.id,v_obligation.account_id,'single_obligation',v_customer.debtor_type,
      coalesce(v_customer.business_name,v_customer.individual_name,''),v_customer.phone,v_customer.email,
      case when v_customer.debtor_type='business' then v_customer.business_name end,v_customer.registration_no,v_customer.address,
      v_obligation.currency,public.currency_minor_to_major(v_obligation.contractual_due_minor,v_obligation.currency),
      public.currency_minor_to_major(v_obligation.paid_minor,v_obligation.currency),v_obligation.original_amount_minor,
      v_obligation.contractual_due_minor,v_obligation.paid_minor,v_obligation.outstanding_minor,0,v_obligation.due_date,
      coalesce((select invoice_number from public.pocket_simple_invoices where business_id=p_business_id
        and obligation_id=v_obligation.id limit 1),v_obligation.reference),v_case_status,'approval',
      'Upgraded from CollectBoss Pocket without copying the authoritative debt or payment ledger.',
      jsonb_build_object('source_product','pocket','source_obligation_id',v_obligation.id,'upgrade_run_id',p_run_id)
    ) on conflict(id) do nothing;
    if not exists(select 1 from public.cases where id=v_item.target_case_id and business_id=p_business_id
      and debtor_id=v_obligation.customer_id and contractual_due_minor=v_obligation.contractual_due_minor
      and approved_payment_minor=v_obligation.paid_minor and outstanding_minor=v_obligation.outstanding_minor) then
      raise exception 'POCKET_UPGRADE_CASE_CONFLICT';
    end if;
    insert into public.recovery_case_obligations(case_id,obligation_id,business_id,linked_by)
      values(v_item.target_case_id,v_obligation.id,p_business_id,p_actor_id)
      on conflict(obligation_id) do nothing;
    if not exists(select 1 from public.recovery_case_obligations where obligation_id=v_obligation.id
      and case_id=v_item.target_case_id and business_id=p_business_id) then
      raise exception 'POCKET_UPGRADE_LINK_CONFLICT';
    end if;
    perform public.receivables_sync_case_obligations(v_item.target_case_id);
    update public.pocket_solo_upgrade_items set status='migrated',migrated_at=now(),
      reconciliation=jsonb_build_object('caseId',v_item.target_case_id,
        'contractualDueMinor',v_obligation.contractual_due_minor,'paidMinor',v_obligation.paid_minor,
        'outstandingMinor',v_obligation.outstanding_minor,'reconciled',true)
      where id=v_item.id;
    v_migrated:=v_migrated+1;
    v_due:=v_due+v_obligation.contractual_due_minor;
    v_paid:=v_paid+v_obligation.paid_minor;
    v_outstanding:=v_outstanding+v_obligation.outstanding_minor;
  end loop;

  update public.pocket_reminder_schedules set status='cancelled',snoozed_until=null,
    cancellation_reason='workspace_upgraded_to_solo',updated_at=now()
  where business_id=p_business_id and status in('pending','snoozed');

  select coalesce(jsonb_agg(distinct provider_subscription_id),'[]'::jsonb) into v_subscription_ids
  from public.workspace_subscription_items where business_id=p_business_id
    and offer_key in('pocket_monthly','pocket_annual','pocket_invoice_addon')
    and provider_status<>'canceled';

  update public.workspace_product_states set product_type='main',lifecycle_state='active',updated_by=p_actor_id
    where business_id=p_business_id and product_type='pocket';
  if not found then raise exception 'POCKET_UPGRADE_PRODUCT_SWITCH_CONFLICT'; end if;

  update public.pocket_solo_upgrade_runs set status='completed',completed_at=now(),updated_at=now(),
    pocket_subscription_ids=v_subscription_ids,
    pocket_subscription_cleanup_status=case when jsonb_array_length(v_subscription_ids)>0 then 'pending' else 'completed' end,
    reconciliation=jsonb_build_object('migratedCases',v_migrated,'contractualDueMinor',v_due,
      'paidMinor',v_paid,'outstandingMinor',v_outstanding,
      'sourceDebts',(source_counts->>'debts')::integer,
      'preserveOnly',(source_counts->>'preserveOnly')::integer,'reviewRequired',0,'reconciled',v_due-v_paid=v_outstanding)
  where id=p_run_id returning * into v_run;
  if (v_run.reconciliation->>'reconciled')::boolean is distinct from true then
    raise exception 'POCKET_UPGRADE_FINANCIAL_MISMATCH';
  end if;
  insert into public.audit_logs(business_id,action,actor_type,actor_id,entity_type,entity_id,metadata)
  values(p_business_id,'pocket.solo_upgrade.completed','system',p_actor_id,'pocket_solo_upgrade',p_run_id::text,
    jsonb_build_object('provider_event_id',p_provider_event_id,'reconciliation',v_run.reconciliation));
  return jsonb_build_object('runId',v_run.id,'status',v_run.status,'reconciliation',v_run.reconciliation,
    'pocketSubscriptionIds',v_subscription_ids,'idempotentReplay',false);
end $$;

create or replace function public.pocket_mark_solo_upgrade_cleanup(
  p_business_id uuid,p_run_id uuid,p_status text,p_error_code text default null
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if p_status not in('completed','failed') then raise exception 'POCKET_UPGRADE_INVALID_CLEANUP_STATUS'; end if;
  update public.pocket_solo_upgrade_runs set pocket_subscription_cleanup_status=p_status,
    last_error_code=case when p_status='failed' then left(coalesce(p_error_code,'BILLING_CLEANUP_FAILED'),100) else null end,
    updated_at=now() where id=p_run_id and business_id=p_business_id and status='completed';
  if not found then raise exception 'POCKET_UPGRADE_RUN_NOT_FOUND'; end if;
end $$;

revoke all on function public.pocket_prepare_solo_upgrade(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.pocket_attach_solo_upgrade_checkout(uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.pocket_commit_solo_upgrade(uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.pocket_mark_solo_upgrade_cleanup(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.pocket_prepare_solo_upgrade(uuid,uuid,text,text) to service_role;
grant execute on function public.pocket_attach_solo_upgrade_checkout(uuid,uuid,uuid,text) to service_role;
grant execute on function public.pocket_commit_solo_upgrade(uuid,uuid,uuid,text) to service_role;
grant execute on function public.pocket_mark_solo_upgrade_cleanup(uuid,uuid,text,text) to service_role;

commit;

-- Rollback: disable the upgrade checkout and webhook commit path first. Keep
-- completed run/item rows and recovery links as financial provenance. Before
-- first successful use only, the four functions, two policies, two tables and
-- indexes may be dropped in reverse dependency order. Solo-to-Pocket downgrade
-- is intentionally unsupported in V1; never delete cases or unlink obligations
-- to simulate a downgrade. Use the verified backup/restore procedure for a
-- financial incident.
