-- I04 accounting integration framework (Xero + QuickBooks Online).
-- This is a forward-only proposal. Review in staging before applying. OAuth
-- ciphertext is deliberately inaccessible to authenticated browser clients.
begin;

create extension if not exists pgcrypto;

create table if not exists public.accounting_connections (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  provider text not null check (provider in ('xero','quickbooks')),
  status text not null default 'pending' check (status in ('pending','connected','error','disconnected','revoked')),
  external_tenant_id text,
  organization_name text,
  scopes text[] not null default array[]::text[],
  access_token_ciphertext text,
  refresh_token_ciphertext text,
  token_expires_at timestamptz,
  last_successful_sync_at timestamptz,
  last_attempted_sync_at timestamptz,
  last_cursor text,
  last_error_code text,
  last_error_message text,
  disconnected_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id,provider),
  unique (id,business_id),
  constraint accounting_connections_credentials_check check (
    status not in ('connected','error') or
    (external_tenant_id is not null and access_token_ciphertext is not null and refresh_token_ciphertext is not null)
  )
);
create unique index if not exists accounting_connections_external_tenant_idx
  on public.accounting_connections(provider,external_tenant_id)
  where external_tenant_id is not null and status in ('connected','error');

create table if not exists public.accounting_oauth_states (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  provider text not null check (provider in ('xero','quickbooks')),
  state_hash text not null unique check (state_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at>created_at)
);
create index if not exists accounting_oauth_states_expiry_idx
  on public.accounting_oauth_states(expires_at) where consumed_at is null;

create table if not exists public.accounting_external_mappings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  connection_id uuid not null,
  provider text not null check (provider in ('xero','quickbooks')),
  entity_type text not null check (entity_type in ('contact','account','invoice','payment','credit_note')),
  external_entity_id text not null,
  external_parent_id text,
  collectboss_entity_type text not null check (
    collectboss_entity_type in ('debtor','customer_account','obligation','payment','financial_adjustment','unmatched_financial_event')
  ),
  collectboss_entity_id uuid,
  source_version text,
  source_updated_at timestamptz,
  payload_hash text,
  last_synced_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (connection_id,business_id) references public.accounting_connections(id,business_id) on delete restrict,
  unique (business_id,provider,entity_type,external_entity_id),
  unique (id,business_id)
);
create index if not exists accounting_external_mappings_collectboss_idx
  on public.accounting_external_mappings(business_id,collectboss_entity_type,collectboss_entity_id);
create index if not exists accounting_external_mappings_parent_idx
  on public.accounting_external_mappings(business_id,provider,external_parent_id)
  where external_parent_id is not null;

create table if not exists public.accounting_sync_runs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  connection_id uuid not null,
  provider text not null check (provider in ('xero','quickbooks')),
  mode text not null check (mode in ('full','incremental','preview')),
  status text not null check (status in ('running','preview_ready','succeeded','failed')),
  counts jsonb not null default '{}'::jsonb check (jsonb_typeof(counts)='object'),
  preview jsonb not null default '[]'::jsonb check (jsonb_typeof(preview)='array'),
  errors jsonb not null default '[]'::jsonb check (jsonb_typeof(errors)='array'),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  foreign key (connection_id,business_id) references public.accounting_connections(id,business_id) on delete restrict
);
create unique index if not exists accounting_sync_runs_one_active_idx
  on public.accounting_sync_runs(connection_id) where status='running';
create index if not exists accounting_sync_runs_tenant_idx
  on public.accounting_sync_runs(business_id,started_at desc);

create table if not exists public.accounting_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('xero','quickbooks')),
  external_tenant_id text not null,
  event_key text not null,
  payload jsonb not null check (jsonb_typeof(payload)='object'),
  status text not null default 'pending' check (status in ('pending','processed','failed')),
  attempts integer not null default 0 check (attempts>=0),
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider,event_key)
);
create index if not exists accounting_webhook_events_queue_idx
  on public.accounting_webhook_events(status,received_at) where status='pending';

create table if not exists public.accounting_financial_applications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  mapping_id uuid not null,
  case_id text not null,
  obligation_id uuid not null,
  application_key text not null,
  application_type text not null check (application_type in ('payment','payment_reversal','credit','credit_reversal','invoice_debit','invoice_credit')),
  amount_minor bigint not null check (amount_minor>0),
  financial_event_id uuid references public.case_financial_events(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (mapping_id,business_id) references public.accounting_external_mappings(id,business_id) on delete restrict,
  foreign key (case_id,business_id) references public.cases(id,business_id) on delete restrict,
  foreign key (obligation_id,business_id) references public.obligations(id,business_id) on delete restrict,
  unique (business_id,application_key)
);

alter table public.accounting_connections enable row level security;
alter table public.accounting_oauth_states enable row level security;
alter table public.accounting_external_mappings enable row level security;
alter table public.accounting_sync_runs enable row level security;
alter table public.accounting_webhook_events enable row level security;
alter table public.accounting_financial_applications enable row level security;

-- Connections and OAuth state contain secrets or security material and have no
-- authenticated policies. Tenant-authorized server routes return only a safe projection.
drop policy if exists accounting_external_mappings_role_read on public.accounting_external_mappings;
create policy accounting_external_mappings_role_read on public.accounting_external_mappings
  for select to authenticated using (
    public.has_business_permission(business_id,'settings.sensitive.manage')
  );
drop policy if exists accounting_sync_runs_role_read on public.accounting_sync_runs;
create policy accounting_sync_runs_role_read on public.accounting_sync_runs
  for select to authenticated using (
    public.has_business_permission(business_id,'settings.sensitive.manage')
  );
drop policy if exists accounting_financial_applications_role_read on public.accounting_financial_applications;
create policy accounting_financial_applications_role_read on public.accounting_financial_applications
  for select to authenticated using (
    public.has_business_permission(business_id,'audit.read')
  );

create or replace function public.accounting_apply_sync_record(
  p_connection_id uuid,
  p_record jsonb
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_connection public.accounting_connections;
  v_kind text:=p_record->>'kind';
  v_external_id text:=nullif(btrim(p_record->>'externalId'),'');
  v_parent_id text;
  v_mapping public.accounting_external_mappings;
  v_parent_mapping public.accounting_external_mappings;
  v_customer_id uuid;
  v_account_id uuid;
  v_obligation public.obligations;
  v_obligation_id uuid;
  v_case_id text;
  v_payment public.payments;
  v_event_id uuid;
  v_application_id uuid;
  v_amount bigint;
  v_total bigint;
  v_paid bigint;
  v_credited bigint;
  v_contractual bigint;
  v_delta bigint;
  v_status text;
  v_key text;
  v_actor_id uuid;
  v_now timestamptz:=now();
begin
  select * into v_connection from public.accounting_connections
  where id=p_connection_id and status in ('connected','error') for update;
  if not found then raise exception 'Accounting connection is unavailable'; end if;
  select coalesce(v_connection.created_by,b.owner_id) into v_actor_id
  from public.businesses b where b.id=v_connection.business_id;
  if v_kind not in ('contact','invoice','payment','credit_note') or v_external_id is null then
    raise exception 'Normalized accounting record is invalid';
  end if;

  select * into v_mapping from public.accounting_external_mappings
  where business_id=v_connection.business_id and provider=v_connection.provider
    and entity_type=v_kind and external_entity_id=v_external_id for update;

  if v_kind='contact' then
    if not found then
      insert into public.debtors(
        business_id,debtor_type,business_name,contact_name,registration_no,phone,email,address
      ) values(
        v_connection.business_id,'business',left(p_record->>'name',250),
        left(nullif(p_record->>'contactName',''),250),left(nullif(p_record->>'registrationNumber',''),100),
        left(nullif(p_record->>'phone',''),50),left(nullif(lower(p_record->>'email'),''),320),
        left(nullif(p_record->>'address',''),1000)
      ) returning id into v_customer_id;
      insert into public.accounting_external_mappings(
        business_id,connection_id,provider,entity_type,external_entity_id,
        collectboss_entity_type,collectboss_entity_id,source_version,source_updated_at,metadata
      ) values(
        v_connection.business_id,v_connection.id,v_connection.provider,'contact',v_external_id,
        'debtor',v_customer_id,p_record->>'version',nullif(p_record->>'updatedAt','')::timestamptz,
        jsonb_build_object('account_number',p_record->>'accountNumber','currency',p_record->>'currency')
      ) returning * into v_mapping;
    else
      v_customer_id:=v_mapping.collectboss_entity_id;
      update public.debtors set
        business_name=left(p_record->>'name',250),contact_name=left(nullif(p_record->>'contactName',''),250),
        registration_no=left(nullif(p_record->>'registrationNumber',''),100),phone=left(nullif(p_record->>'phone',''),50),
        email=left(nullif(lower(p_record->>'email'),''),320),address=left(nullif(p_record->>'address',''),1000),
        archived_at=case when p_record->>'status'='archived' then coalesce(archived_at,v_now) else null end,
        updated_at=v_now
      where id=v_customer_id and business_id=v_connection.business_id;
    end if;

  elsif v_kind='invoice' then
    v_parent_id:=nullif(p_record->>'contactExternalId','');
    select * into v_parent_mapping from public.accounting_external_mappings
    where business_id=v_connection.business_id and provider=v_connection.provider
      and entity_type='contact' and external_entity_id=v_parent_id;
    if not found or v_parent_mapping.collectboss_entity_id is null then raise exception 'Invoice contact mapping is missing'; end if;
    v_customer_id:=v_parent_mapping.collectboss_entity_id;
    select id into v_account_id from public.customer_accounts
      where business_id=v_connection.business_id and customer_id=v_customer_id and archived_at is null
      order by created_at limit 1;
    if v_account_id is null then
      insert into public.customer_accounts(business_id,customer_id,account_type,account_number,display_name,currency,metadata)
      select v_connection.business_id,v_customer_id,'general',nullif(v_parent_mapping.metadata->>'account_number',''),
        coalesce(d.business_name,d.individual_name,'Accounting account'),
        coalesce(nullif(p_record->>'currency',''),nullif(v_parent_mapping.metadata->>'currency',''),'MYR'),
        jsonb_build_object('source','accounting_connector','provider',v_connection.provider)
      from public.debtors d where d.id=v_customer_id returning id into v_account_id;
    end if;
    v_total:=greatest(coalesce((p_record->>'totalMinor')::bigint,0),0);
    v_credited:=least(greatest(coalesce((p_record->>'creditedMinor')::bigint,0),0),v_total);
    v_contractual:=v_total-v_credited;
    v_paid:=least(greatest(coalesce((p_record->>'paidMinor')::bigint,0),0),v_contractual);
    v_status:=case p_record->>'status' when 'draft' then 'draft' when 'void' then 'void'
      when 'paid' then 'paid' else case when (p_record->>'dueDate')::date<current_date then 'overdue' else 'open' end end;
    if v_mapping.id is null then
      perform set_config('collectboss.receivables_sync','on',true);
      insert into public.obligations(
        business_id,customer_id,account_id,obligation_type,reference,purchase_order_reference,
        issue_date,due_date,currency,original_amount_minor,adjustments_minor,paid_minor,status,metadata
      ) values(
        v_connection.business_id,v_customer_id,v_account_id,'invoice',left(p_record->>'reference',200),
        left(nullif(p_record->>'purchaseOrderReference',''),200),nullif(p_record->>'issueDate','')::date,
        (p_record->>'dueDate')::date,p_record->>'currency',v_total,-v_credited,v_paid,v_status,
        jsonb_build_object('source','accounting_connector','provider',v_connection.provider)
      ) returning id into v_obligation_id;
      insert into public.accounting_external_mappings(
        business_id,connection_id,provider,entity_type,external_entity_id,external_parent_id,
        collectboss_entity_type,collectboss_entity_id,source_version,source_updated_at,metadata
      ) values(
        v_connection.business_id,v_connection.id,v_connection.provider,'invoice',v_external_id,v_parent_id,
        'obligation',v_obligation_id,p_record->>'version',nullif(p_record->>'updatedAt','')::timestamptz,
        jsonb_build_object('last_total_minor',v_total,'last_credited_minor',v_credited)
      ) returning * into v_mapping;
    else
      v_obligation_id:=v_mapping.collectboss_entity_id;
      select * into v_obligation from public.obligations where id=v_obligation_id and business_id=v_connection.business_id for update;
      if not found then raise exception 'Mapped obligation is missing'; end if;
      select rco.case_id into v_case_id from public.recovery_case_obligations rco
        where rco.obligation_id=v_obligation_id and rco.business_id=v_connection.business_id;
      if v_case_id is null then
        perform set_config('collectboss.receivables_sync','on',true);
        update public.obligations set reference=left(p_record->>'reference',200),
          purchase_order_reference=left(nullif(p_record->>'purchaseOrderReference',''),200),
          issue_date=nullif(p_record->>'issueDate','')::date,due_date=(p_record->>'dueDate')::date,
          currency=p_record->>'currency',original_amount_minor=v_total,adjustments_minor=-v_credited,
          paid_minor=v_paid,status=v_status,updated_at=v_now where id=v_obligation_id;
      else
        -- Linked financial values are ledger-owned. Apply only the external
        -- invoice-total delta; allocated credits/payments have their own records.
        v_delta:=v_total-coalesce((v_mapping.metadata->>'last_total_minor')::bigint,v_obligation.original_amount_minor);
        if v_delta<>0 then
          if v_delta<0 and abs(v_delta)>v_obligation.outstanding_minor then
            raise exception 'External invoice decrease exceeds the recoverable outstanding balance';
          end if;
          v_key:='invoice:'||v_external_id||':'||coalesce(p_record->>'version',v_total::text);
          insert into public.accounting_financial_applications(
            business_id,mapping_id,case_id,obligation_id,application_key,application_type,amount_minor
          ) values(
            v_connection.business_id,v_mapping.id,v_case_id,v_obligation_id,v_key,
            case when v_delta>0 then 'invoice_debit' else 'invoice_credit' end,abs(v_delta)
          ) on conflict (business_id,application_key) do nothing returning id into v_application_id;
          if v_application_id is not null then
            perform set_config('collectboss.receivables_sync','on',true);
            update public.obligations set adjustments_minor=adjustments_minor+v_delta where id=v_obligation_id;
            insert into public.case_financial_events(case_id,event_type,amount_minor,source_table,source_id,note)
            values(v_case_id,case when v_delta>0 then 'adjustment_debit' else 'adjustment_credit' end,
              abs(v_delta),'accounting_financial_applications',v_application_id,'Accounting invoice total changed')
            returning id into v_event_id;
            update public.accounting_financial_applications set financial_event_id=v_event_id where id=v_application_id;
            perform public.financial_recalculate_case(v_case_id);
          end if;
        end if;
        update public.obligations set reference=left(p_record->>'reference',200),
          purchase_order_reference=left(nullif(p_record->>'purchaseOrderReference',''),200),
          issue_date=nullif(p_record->>'issueDate','')::date,due_date=(p_record->>'dueDate')::date,
          currency=p_record->>'currency',updated_at=v_now where id=v_obligation_id;
      end if;
    end if;

  else
    v_parent_id:=nullif(p_record->>'invoiceExternalId','');
    v_amount:=greatest(coalesce((p_record->>'amountMinor')::bigint,0),0);
    if v_amount=0 then return jsonb_build_object('status','ignored_zero_amount','kind',v_kind,'external_id',v_external_id); end if;
    if v_parent_id is not null then
      select * into v_parent_mapping from public.accounting_external_mappings
      where business_id=v_connection.business_id and provider=v_connection.provider
        and entity_type='invoice' and external_entity_id=v_parent_id;
    end if;
    v_obligation_id:=v_parent_mapping.collectboss_entity_id;
    if v_obligation_id is not null then
      select rco.case_id into v_case_id from public.recovery_case_obligations rco
      where rco.obligation_id=v_obligation_id and rco.business_id=v_connection.business_id;
    end if;

    if v_mapping.id is null then
      insert into public.accounting_external_mappings(
        business_id,connection_id,provider,entity_type,external_entity_id,external_parent_id,
        collectboss_entity_type,collectboss_entity_id,source_version,source_updated_at,metadata
      ) values(
        v_connection.business_id,v_connection.id,v_connection.provider,v_kind,v_external_id,v_parent_id,
        case when v_case_id is null then 'unmatched_financial_event'
          when v_kind='payment' then 'payment' else 'financial_adjustment' end,
        v_obligation_id,p_record->>'version',nullif(p_record->>'updatedAt','')::timestamptz,
        jsonb_build_object('amount_minor',v_amount,'status',p_record->>'status','reference',p_record->>'reference')
      ) returning * into v_mapping;
      if v_case_id is not null and v_kind='payment' and p_record->>'status'<>'reversed' then
        insert into public.payments(case_id,amount,payment_method,reference_no,review_status,reviewed_at,notes)
        values(v_case_id,v_amount::numeric/100,'bank_transfer',left(nullif(p_record->>'reference',''),200),
          'approved',v_now,'Imported read-only from '||v_connection.provider)
        returning * into v_payment;
        insert into public.case_financial_events(case_id,event_type,amount_minor,source_table,source_id,note)
        values(v_case_id,'payment_approved',v_amount,'payments',v_payment.id,'Accounting-side payment') returning id into v_event_id;
        update public.payments set financial_event_id=v_event_id where id=v_payment.id;
        update public.accounting_external_mappings set collectboss_entity_id=v_payment.id where id=v_mapping.id;
        insert into public.accounting_financial_applications(
          business_id,mapping_id,case_id,obligation_id,application_key,application_type,amount_minor,financial_event_id
        ) values(v_connection.business_id,v_mapping.id,v_case_id,v_obligation_id,
          'payment:'||v_external_id,'payment',v_amount,v_event_id);
        perform public.financial_recalculate_case(v_case_id);
      elsif v_case_id is not null and v_kind='credit_note' and p_record->>'status'<>'void' then
        select * into v_obligation from public.obligations
          where id=v_obligation_id and business_id=v_connection.business_id for update;
        v_amount:=least(v_amount,v_obligation.outstanding_minor);
        if v_amount=0 then
          update public.accounting_external_mappings set
            metadata=metadata||jsonb_build_object('ignored_reason','no_outstanding_balance')
          where id=v_mapping.id;
        else
        insert into public.financial_adjustments(
          business_id,case_id,obligation_id,adjustment_type,direction,amount_minor,reason,reference,
          approval_status,requested_by,approved_by,approved_at,idempotency_key
        ) values(v_connection.business_id,v_case_id,v_obligation_id,'credit_note','credit',v_amount,
          'Accounting-side credit note',left(nullif(p_record->>'reference',''),160),
          'approved',v_actor_id,v_actor_id,v_now,v_mapping.id)
        returning id into v_application_id;
        perform set_config('collectboss.receivables_sync','on',true);
        update public.obligations set adjustments_minor=adjustments_minor-v_amount where id=v_obligation_id;
        insert into public.case_financial_events(case_id,event_type,amount_minor,source_table,source_id,note)
        values(v_case_id,'adjustment_credit',v_amount,'financial_adjustments',v_application_id,'Accounting-side credit note')
        returning id into v_event_id;
        update public.financial_adjustments set financial_event_id=v_event_id where id=v_application_id;
        update public.accounting_external_mappings set collectboss_entity_id=v_application_id where id=v_mapping.id;
        insert into public.accounting_financial_applications(
          business_id,mapping_id,case_id,obligation_id,application_key,application_type,amount_minor,financial_event_id
        ) values(v_connection.business_id,v_mapping.id,v_case_id,v_obligation_id,
          'credit:'||v_external_id,'credit',v_amount,v_event_id);
        perform public.financial_recalculate_case(v_case_id);
        end if;
      end if;
    elsif v_case_id is not null and v_kind='payment' and p_record->>'status'='reversed' then
      select * into v_payment from public.payments where id=v_mapping.collectboss_entity_id for update;
      if found and v_payment.review_status='approved' then
        insert into public.accounting_financial_applications(
          business_id,mapping_id,case_id,obligation_id,application_key,application_type,amount_minor
        ) values(v_connection.business_id,v_mapping.id,v_case_id,v_obligation_id,
          'payment-reversal:'||v_external_id,'payment_reversal',v_amount)
        on conflict (business_id,application_key) do nothing returning id into v_application_id;
        if v_application_id is not null then
          insert into public.case_financial_events(case_id,event_type,amount_minor,source_table,source_id,note)
          values(v_case_id,'payment_reversal',v_amount,'accounting_financial_applications',v_application_id,'Accounting payment reversed')
          returning id into v_event_id;
          update public.accounting_financial_applications set financial_event_id=v_event_id where id=v_application_id;
          update public.payments set review_status='reversed',reversed_at=v_now,reversal_reason='Reversed in accounting system' where id=v_payment.id;
          perform public.financial_recalculate_case(v_case_id);
        end if;
      end if;
    elsif v_case_id is not null and v_kind='credit_note' and p_record->>'status'='void' then
      select amount_minor into v_amount from public.financial_adjustments
        where id=v_mapping.collectboss_entity_id and business_id=v_connection.business_id;
      if coalesce(v_amount,0)>0 then
        insert into public.accounting_financial_applications(
          business_id,mapping_id,case_id,obligation_id,application_key,application_type,amount_minor
        ) values(v_connection.business_id,v_mapping.id,v_case_id,v_obligation_id,
          'credit-reversal:'||v_external_id,'credit_reversal',v_amount)
        on conflict (business_id,application_key) do nothing returning id into v_application_id;
        if v_application_id is not null then
          perform set_config('collectboss.receivables_sync','on',true);
          update public.obligations set adjustments_minor=adjustments_minor+v_amount where id=v_obligation_id;
          insert into public.case_financial_events(case_id,event_type,amount_minor,source_table,source_id,note)
          values(v_case_id,'adjustment_debit',v_amount,'accounting_financial_applications',v_application_id,'Accounting credit note voided')
          returning id into v_event_id;
          update public.accounting_financial_applications set financial_event_id=v_event_id where id=v_application_id;
          perform public.financial_recalculate_case(v_case_id);
        end if;
      end if;
    end if;
  end if;

  update public.accounting_external_mappings set
    source_version=p_record->>'version',source_updated_at=nullif(p_record->>'updatedAt','')::timestamptz,
    payload_hash=encode(digest(convert_to(p_record::text,'UTF8'),'sha256'),'hex'),last_synced_at=v_now,updated_at=v_now,
    metadata=metadata||jsonb_build_object('last_status',p_record->>'status')
      ||case when v_kind='invoice' then jsonb_build_object('last_total_minor',v_total,'last_credited_minor',v_credited) else '{}'::jsonb end
  where business_id=v_connection.business_id and provider=v_connection.provider
    and entity_type=v_kind and external_entity_id=v_external_id;
  return jsonb_build_object('status','applied','kind',v_kind,'external_id',v_external_id);
end;
$$;

create or replace function public.accounting_apply_sync_batch(
  p_connection_id uuid,
  p_records jsonb
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_record jsonb; v_count integer:=0;
begin
  if jsonb_typeof(p_records)<>'array' or jsonb_array_length(p_records)>1000 then
    raise exception 'Accounting sync batch must contain at most 1000 records';
  end if;
  for v_record in select value from jsonb_array_elements(p_records) loop
    perform public.accounting_apply_sync_record(p_connection_id,v_record);
    v_count:=v_count+1;
  end loop;
  return jsonb_build_object('applied',v_count);
end;
$$;

revoke all on table public.accounting_connections,public.accounting_oauth_states,
  public.accounting_external_mappings,public.accounting_sync_runs,
  public.accounting_webhook_events,public.accounting_financial_applications from anon;
revoke all on table public.accounting_connections,public.accounting_oauth_states,
  public.accounting_webhook_events from authenticated;
revoke insert,update,delete on table public.accounting_external_mappings,
  public.accounting_sync_runs,public.accounting_financial_applications from authenticated;
grant select on table public.accounting_external_mappings,public.accounting_sync_runs,
  public.accounting_financial_applications to authenticated;
grant all on table public.accounting_connections,public.accounting_oauth_states,
  public.accounting_external_mappings,public.accounting_sync_runs,
  public.accounting_webhook_events,public.accounting_financial_applications to service_role;
revoke all on function public.accounting_apply_sync_record(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.accounting_apply_sync_batch(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.accounting_apply_sync_record(uuid,jsonb) to service_role;
grant execute on function public.accounting_apply_sync_batch(uuid,jsonb) to service_role;

commit;

-- Rollback considerations:
-- 1. Disable OAuth connect, webhook and accounting-sync cron routes first.
-- 2. Revoke provider grants from both provider consoles before dropping local
--    ciphertext. Disconnecting never deletes debtors, obligations, cases,
--    mappings, payments, adjustments, promises, plans or audit history.
-- 3. Keep accounting_external_mappings and accounting_financial_applications
--    for audit/idempotency. If code rollback requires dropping functions, drop
--    accounting_apply_sync_batch before accounting_apply_sync_record.
