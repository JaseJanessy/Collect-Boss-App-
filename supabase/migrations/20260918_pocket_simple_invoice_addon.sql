-- Prompt 8: optional Pocket Simple Invoice add-on.
-- Review after 20260917. This migration is additive and must not be applied
-- until the private storage/RLS and billing configuration have been reviewed.

begin;

create table if not exists public.pocket_invoice_sequences (
  business_id uuid not null references public.businesses(id) on delete restrict,
  sequence_year integer not null check (sequence_year between 2000 and 9999),
  last_value bigint not null default 0 check (last_value >= 0),
  updated_at timestamptz not null default now(),
  primary key (business_id, sequence_year)
);

create table if not exists public.pocket_simple_invoices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  customer_id uuid not null,
  status text not null default 'draft' check (status in ('draft','issued','partially_paid','paid','cancelled')),
  invoice_number text,
  sequence_year integer,
  sequence_value bigint,
  issue_date date,
  due_date date,
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  business_name text not null check (char_length(btrim(business_name)) between 1 and 160),
  business_contact text,
  logo_object_path text,
  customer_name text not null check (char_length(btrim(customer_name)) between 1 and 160),
  customer_contact text,
  subtotal_minor bigint not null default 0 check (subtotal_minor >= 0),
  discount_minor bigint not null default 0 check (discount_minor >= 0),
  tax_label text,
  tax_minor bigint not null default 0 check (tax_minor >= 0),
  total_minor bigint not null default 0 check (total_minor >= 0),
  note text,
  payment_instructions text,
  obligation_id uuid,
  issued_snapshot jsonb,
  pdf_object_path text,
  pdf_sha256 char(64),
  pdf_generated_at timestamptz,
  version integer not null default 1 check (version > 0),
  issued_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (customer_id,business_id) references public.debtors(id,business_id) on delete restrict,
  foreign key (obligation_id,business_id) references public.obligations(id,business_id) on delete restrict,
  unique (id,business_id),
  unique (business_id,invoice_number),
  unique (business_id,sequence_year,sequence_value),
  unique (business_id,obligation_id),
  check (issue_date is null or due_date is null or due_date >= issue_date),
  check (discount_minor <= subtotal_minor),
  check (total_minor = subtotal_minor - discount_minor + tax_minor),
  check ((tax_label is null and tax_minor=0) or nullif(btrim(tax_label),'') is not null),
  check ((status='draft' and invoice_number is null and issued_at is null and issued_snapshot is null)
    or (status<>'draft' and invoice_number is not null and issue_date is not null and due_date is not null
      and issued_at is not null and issued_snapshot is not null and sequence_year is not null and sequence_value is not null)),
  check ((status='cancelled')=(cancelled_at is not null)),
  check ((pdf_object_path is null and pdf_sha256 is null and pdf_generated_at is null)
    or (pdf_object_path is not null and pdf_sha256 ~ '^[0-9a-f]{64}$' and pdf_generated_at is not null))
);

create table if not exists public.pocket_simple_invoice_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  invoice_id uuid not null,
  position integer not null check (position between 1 and 100),
  description text not null check (char_length(btrim(description)) between 1 and 300),
  quantity_milli bigint not null check (quantity_milli > 0),
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  line_total_minor bigint not null check (line_total_minor >= 0),
  created_at timestamptz not null default now(),
  foreign key (invoice_id,business_id) references public.pocket_simple_invoices(id,business_id) on delete cascade,
  unique (invoice_id,position)
);

create table if not exists public.pocket_simple_invoice_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  invoice_id uuid not null,
  event_type text not null check (event_type in ('draft_created','draft_updated','issued','pdf_generated','whatsapp_handoff','debt_linked','cancelled')),
  actor_id uuid references auth.users(id) on delete set null,
  idempotency_key text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now(),
  foreign key (invoice_id,business_id) references public.pocket_simple_invoices(id,business_id) on delete restrict,
  unique nulls not distinct (business_id,event_type,idempotency_key)
);

create index if not exists pocket_simple_invoices_list_idx
  on public.pocket_simple_invoices(business_id,created_at desc);
create index if not exists pocket_simple_invoices_due_idx
  on public.pocket_simple_invoices(business_id,due_date,status)
  where status in ('issued','partially_paid');
create index if not exists pocket_simple_invoice_items_invoice_idx
  on public.pocket_simple_invoice_items(business_id,invoice_id,position);
create index if not exists pocket_simple_invoice_events_invoice_idx
  on public.pocket_simple_invoice_events(business_id,invoice_id,created_at desc);

-- Extend the existing Pocket reminder projection instead of creating a second
-- invoice scheduler. Invoice reminders are owner notifications only.
alter table public.pocket_reminder_schedules alter column obligation_id drop not null;
alter table public.pocket_reminder_schedules add column if not exists invoice_id uuid;
alter table public.pocket_reminder_schedules drop constraint if exists pocket_reminder_schedules_event_type_check;
alter table public.pocket_reminder_schedules add constraint pocket_reminder_schedules_event_type_check
  check (event_type in ('due_soon','due_today','overdue','still_overdue','partial_balance','invoice_due'));
alter table public.pocket_reminder_schedules drop constraint if exists pocket_reminder_schedules_source_check;
alter table public.pocket_reminder_schedules add constraint pocket_reminder_schedules_source_check
  check ((obligation_id is not null)::integer+(invoice_id is not null)::integer=1);
alter table public.pocket_reminder_schedules drop constraint if exists pocket_reminder_schedules_invoice_tenant_fk;
alter table public.pocket_reminder_schedules add constraint pocket_reminder_schedules_invoice_tenant_fk
  foreign key(invoice_id,business_id) references public.pocket_simple_invoices(id,business_id) on delete restrict;
create index if not exists pocket_reminder_schedules_invoice_idx
  on public.pocket_reminder_schedules(business_id,invoice_id,created_at desc) where invoice_id is not null;

create or replace function public.pocket_reminder_validate_scope()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare v_debt public.obligations; v_invoice public.pocket_simple_invoices;
begin
  if tg_table_name='pocket_reminder_schedules' and new.invoice_id is not null then
    select * into v_invoice from public.pocket_simple_invoices where id=new.invoice_id and business_id=new.business_id;
    if not found or v_invoice.customer_id<>new.customer_id or new.obligation_id is not null or new.event_type<>'invoice_due' then
      raise exception 'Pocket invoice reminder scope is invalid';
    end if;
    new.updated_at:=now();
    return new;
  end if;
  select * into v_debt from public.obligations where id=new.obligation_id and business_id=new.business_id;
  if not found or v_debt.origin_product_type<>'pocket' or v_debt.customer_id<>new.customer_id then
    raise exception 'Pocket reminder debt scope is invalid';
  end if;
  if tg_table_name='pocket_reminder_events' and new.schedule_id is not null and not exists(
    select 1 from public.pocket_reminder_schedules s where s.id=new.schedule_id and s.business_id=new.business_id
      and s.obligation_id=new.obligation_id and s.customer_id=new.customer_id
  ) then raise exception 'Pocket reminder schedule does not match debt'; end if;
  if tg_table_name in ('pocket_reminder_preferences','pocket_reminder_schedules') then new.updated_at:=now(); end if;
  return new;
end $$;

create or replace function public.pocket_simple_invoice_validate()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_op='UPDATE' and old.status<>'draft' then
    if new.business_id is distinct from old.business_id
      or new.customer_id is distinct from old.customer_id
      or new.invoice_number is distinct from old.invoice_number
      or new.sequence_year is distinct from old.sequence_year
      or new.sequence_value is distinct from old.sequence_value
      or new.issue_date is distinct from old.issue_date
      or new.due_date is distinct from old.due_date
      or new.currency is distinct from old.currency
      or new.business_name is distinct from old.business_name
      or new.business_contact is distinct from old.business_contact
      or new.logo_object_path is distinct from old.logo_object_path
      or new.customer_name is distinct from old.customer_name
      or new.customer_contact is distinct from old.customer_contact
      or new.subtotal_minor is distinct from old.subtotal_minor
      or new.discount_minor is distinct from old.discount_minor
      or new.tax_label is distinct from old.tax_label
      or new.tax_minor is distinct from old.tax_minor
      or new.total_minor is distinct from old.total_minor
      or new.note is distinct from old.note
      or new.payment_instructions is distinct from old.payment_instructions
      or new.issued_snapshot is distinct from old.issued_snapshot
      or new.issued_at is distinct from old.issued_at then
      raise exception 'POCKET_INVOICE_IMMUTABLE';
    end if;
    if old.status='cancelled' and new.status<>'cancelled' then raise exception 'POCKET_INVOICE_IMMUTABLE'; end if;
  end if;
  if tg_op='UPDATE' and new.version<=old.version then new.version:=old.version+1; end if;
  new.updated_at:=now();
  return new;
end $$;

drop trigger if exists pocket_simple_invoice_validate on public.pocket_simple_invoices;
create trigger pocket_simple_invoice_validate before insert or update on public.pocket_simple_invoices
for each row execute function public.pocket_simple_invoice_validate();

create or replace function public.pocket_simple_invoice_item_validate()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare v_status text;
begin
  select status into v_status from public.pocket_simple_invoices
    where id=coalesce(new.invoice_id,old.invoice_id) and business_id=coalesce(new.business_id,old.business_id);
  if v_status is distinct from 'draft' then raise exception 'POCKET_INVOICE_IMMUTABLE'; end if;
  if tg_op<>'DELETE' then
    new.line_total_minor:=((new.quantity_milli*new.unit_price_minor)+500)/1000;
    return new;
  end if;
  return old;
end $$;

drop trigger if exists pocket_simple_invoice_item_validate on public.pocket_simple_invoice_items;
create trigger pocket_simple_invoice_item_validate before insert or update or delete on public.pocket_simple_invoice_items
for each row execute function public.pocket_simple_invoice_item_validate();

create or replace function public.pocket_save_simple_invoice_draft(
  p_business_id uuid,p_actor_id uuid,p_invoice_id uuid,p_expected_version integer,
  p_payload jsonb,p_items jsonb,p_operation_key text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_invoice public.pocket_simple_invoices; v_invoice_id uuid:=coalesce(p_invoice_id,gen_random_uuid());
  v_item jsonb; v_position integer:=0; v_subtotal bigint;
begin
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id);
  if not public.pocket_is_workspace(p_business_id) or v_role not in('owner','admin','manager') then raise exception 'POCKET_INVOICE_NOT_AUTHORISED'; end if;
  perform public.pocket_authorize_capability_internal(p_business_id,p_actor_id,'pocket.invoice.create',p_operation_key,false,'{}'::jsonb);
  if jsonb_typeof(p_payload)<>'object' or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 100 then raise exception 'POCKET_INVOICE_INVALID'; end if;
  if not exists(select 1 from public.debtors where id=(p_payload->>'customerId')::uuid and business_id=p_business_id and archived_at is null and merged_into_id is null) then raise exception 'POCKET_INVOICE_CUSTOMER_NOT_FOUND'; end if;
  if p_invoice_id is null then
    insert into public.pocket_simple_invoices(id,business_id,customer_id,status,issue_date,due_date,currency,business_name,business_contact,
      logo_object_path,customer_name,customer_contact,subtotal_minor,discount_minor,tax_label,tax_minor,total_minor,note,payment_instructions,created_by,updated_by)
    values(v_invoice_id,p_business_id,(p_payload->>'customerId')::uuid,'draft',(p_payload->>'issueDate')::date,(p_payload->>'dueDate')::date,
      upper(p_payload->>'currency'),p_payload->>'businessName',nullif(p_payload->>'businessContact',''),nullif(p_payload->>'logoObjectPath',''),p_payload->>'customerName',nullif(p_payload->>'customerContact',''),
      (p_payload->>'subtotalMinor')::bigint,(p_payload->>'discountMinor')::bigint,nullif(p_payload->>'taxLabel',''),(p_payload->>'taxMinor')::bigint,
      (p_payload->>'totalMinor')::bigint,nullif(p_payload->>'note',''),nullif(p_payload->>'paymentInstructions',''),p_actor_id,p_actor_id)
    returning * into v_invoice;
  else
    select * into v_invoice from public.pocket_simple_invoices where id=p_invoice_id and business_id=p_business_id for update;
    if not found then raise exception 'POCKET_INVOICE_NOT_FOUND'; end if;
    if v_invoice.status<>'draft' then raise exception 'POCKET_INVOICE_IMMUTABLE'; end if;
    if p_expected_version is null or v_invoice.version<>p_expected_version then raise exception 'POCKET_INVOICE_STALE'; end if;
    update public.pocket_simple_invoices set customer_id=(p_payload->>'customerId')::uuid,issue_date=(p_payload->>'issueDate')::date,
      due_date=(p_payload->>'dueDate')::date,currency=upper(p_payload->>'currency'),business_name=p_payload->>'businessName',
      business_contact=nullif(p_payload->>'businessContact',''),logo_object_path=nullif(p_payload->>'logoObjectPath',''),customer_name=p_payload->>'customerName',customer_contact=nullif(p_payload->>'customerContact',''),
      subtotal_minor=(p_payload->>'subtotalMinor')::bigint,discount_minor=(p_payload->>'discountMinor')::bigint,tax_label=nullif(p_payload->>'taxLabel',''),
      tax_minor=(p_payload->>'taxMinor')::bigint,total_minor=(p_payload->>'totalMinor')::bigint,note=nullif(p_payload->>'note',''),
      payment_instructions=nullif(p_payload->>'paymentInstructions',''),updated_by=p_actor_id
    where id=v_invoice_id returning * into v_invoice;
    delete from public.pocket_simple_invoice_items where invoice_id=v_invoice_id and business_id=p_business_id;
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_position:=v_position+1;
    insert into public.pocket_simple_invoice_items(business_id,invoice_id,position,description,quantity_milli,unit_price_minor,line_total_minor)
    values(p_business_id,v_invoice_id,v_position,v_item->>'description',(v_item->>'quantityMilli')::bigint,(v_item->>'unitPriceMinor')::bigint,(v_item->>'lineTotalMinor')::bigint);
  end loop;
  select coalesce(sum(line_total_minor),0) into v_subtotal from public.pocket_simple_invoice_items where invoice_id=v_invoice_id and business_id=p_business_id;
  if v_subtotal<>v_invoice.subtotal_minor then raise exception 'POCKET_INVOICE_TOTAL_MISMATCH'; end if;
  insert into public.pocket_simple_invoice_events(business_id,invoice_id,event_type,actor_id,idempotency_key,metadata)
  values(p_business_id,v_invoice_id,case when p_invoice_id is null then 'draft_created' else 'draft_updated' end,p_actor_id,p_operation_key,
    jsonb_build_object('version',v_invoice.version,'total_minor',v_invoice.total_minor)) on conflict do nothing;
  return jsonb_build_object('invoiceId',v_invoice_id,'version',v_invoice.version,'status','draft');
end $$;

create or replace function public.pocket_issue_simple_invoice(
  p_business_id uuid,p_actor_id uuid,p_invoice_id uuid,p_expected_version integer,p_operation_key text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_invoice public.pocket_simple_invoices; v_year integer; v_sequence bigint; v_number text;
  v_subtotal bigint; v_items jsonb; v_authorization jsonb;
begin
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id);
  if not public.pocket_is_workspace(p_business_id) or v_role not in('owner','admin','manager') then raise exception 'POCKET_INVOICE_NOT_AUTHORISED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':pocket-invoice:'||p_invoice_id::text,0));
  select * into v_invoice from public.pocket_simple_invoices where id=p_invoice_id and business_id=p_business_id for update;
  if not found then raise exception 'POCKET_INVOICE_NOT_FOUND'; end if;
  if v_invoice.status<>'draft' then
    if v_invoice.invoice_number is not null then return jsonb_build_object('invoiceId',v_invoice.id,'invoiceNumber',v_invoice.invoice_number,'status',v_invoice.status,'idempotentReplay',true); end if;
    raise exception 'POCKET_INVOICE_INVALID_STATE';
  end if;
  if v_invoice.version<>p_expected_version then raise exception 'POCKET_INVOICE_STALE'; end if;
  select coalesce(sum(line_total_minor),0),jsonb_agg(jsonb_build_object(
    'description',description,'quantityMilli',quantity_milli,'unitPriceMinor',unit_price_minor,'lineTotalMinor',line_total_minor
  ) order by position) into v_subtotal,v_items from public.pocket_simple_invoice_items where invoice_id=p_invoice_id and business_id=p_business_id;
  if v_subtotal<=0 or v_items is null then raise exception 'POCKET_INVOICE_EMPTY'; end if;
  if v_subtotal<>v_invoice.subtotal_minor or v_invoice.total_minor<=0 then raise exception 'POCKET_INVOICE_TOTAL_MISMATCH'; end if;
  v_year:=extract(year from v_invoice.issue_date)::integer;
  insert into public.pocket_invoice_sequences(business_id,sequence_year,last_value) values(p_business_id,v_year,0) on conflict do nothing;
  select last_value+1 into v_sequence from public.pocket_invoice_sequences where business_id=p_business_id and sequence_year=v_year for update;
  v_number:='CBP-'||v_year::text||'-'||lpad(v_sequence::text,6,'0');
  v_authorization:=public.pocket_commit_invoice_usage(p_business_id,p_actor_id,p_invoice_id,v_number,p_operation_key);
  update public.pocket_invoice_sequences set last_value=v_sequence,updated_at=now() where business_id=p_business_id and sequence_year=v_year;
  update public.pocket_simple_invoices set
    status='issued',invoice_number=v_number,sequence_year=v_year,sequence_value=v_sequence,issued_at=now(),
    issued_snapshot=jsonb_build_object(
      'formatVersion',1,'invoiceNumber',v_number,'businessName',business_name,'businessContact',business_contact,
      'customerId',customer_id,'customerName',customer_name,'customerContact',customer_contact,
      'issueDate',issue_date,'dueDate',due_date,'currency',currency,'logoObjectPath',logo_object_path,'items',v_items,
      'subtotalMinor',subtotal_minor,'discountMinor',discount_minor,'taxLabel',tax_label,'taxMinor',tax_minor,
      'totalMinor',total_minor,'note',note,'paymentInstructions',payment_instructions,
      'disclaimer','NOT AN OFFICIAL E-INVOICE SERVICE'
    ),updated_by=p_actor_id
  where id=p_invoice_id;
  insert into public.pocket_simple_invoice_events(business_id,invoice_id,event_type,actor_id,idempotency_key,metadata)
    values(p_business_id,p_invoice_id,'issued',p_actor_id,p_operation_key,jsonb_build_object('invoice_number',v_number,'usage',v_authorization))
    on conflict do nothing;
  return jsonb_build_object('invoiceId',p_invoice_id,'invoiceNumber',v_number,'status','issued','idempotentReplay',false,'authorization',v_authorization);
end $$;

create or replace function public.pocket_convert_invoice_to_debt(
  p_business_id uuid,p_actor_id uuid,p_invoice_id uuid,p_operation_key text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_invoice public.pocket_simple_invoices; v_debt_id uuid; v_status text;
begin
  v_role:=public.document_intake_actor_role(p_business_id,p_actor_id);
  if not public.pocket_is_workspace(p_business_id) or v_role not in('owner','admin','manager') then raise exception 'POCKET_INVOICE_NOT_AUTHORISED'; end if;
  perform public.pocket_authorize_capability_internal(p_business_id,p_actor_id,'pocket.debt.manage',p_operation_key,false,'{}'::jsonb);
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||':pocket-invoice-debt:'||p_invoice_id::text,0));
  select * into v_invoice from public.pocket_simple_invoices where id=p_invoice_id and business_id=p_business_id for update;
  if not found then raise exception 'POCKET_INVOICE_NOT_FOUND'; end if;
  if v_invoice.status not in('issued','partially_paid','paid') then raise exception 'POCKET_INVOICE_INVALID_STATE'; end if;
  if v_invoice.obligation_id is not null then
    return jsonb_build_object('invoiceId',p_invoice_id,'debtId',v_invoice.obligation_id,'idempotentReplay',true);
  end if;
  v_debt_id:=gen_random_uuid();
  v_status:=case when v_invoice.due_date<(now() at time zone coalesce((select timezone from public.businesses where id=p_business_id),'UTC'))::date then 'overdue' else 'open' end;
  insert into public.obligations(id,business_id,customer_id,account_id,obligation_type,reference,issue_date,due_date,currency,
    original_amount_minor,adjustments_minor,paid_minor,status,metadata,custom_fields,origin_product_type,pocket_description,pocket_debt_date,pocket_due_date)
  values(v_debt_id,p_business_id,v_invoice.customer_id,null,'invoice',v_invoice.invoice_number,v_invoice.issue_date,v_invoice.due_date,v_invoice.currency,
    v_invoice.total_minor,0,0,v_status,jsonb_build_object('pocket',jsonb_build_object('version',1,'simple_invoice_id',p_invoice_id)),
    '{}'::jsonb,'pocket','Invoice '||v_invoice.invoice_number,v_invoice.issue_date,v_invoice.due_date);
  update public.pocket_simple_invoices set obligation_id=v_debt_id,updated_by=p_actor_id where id=p_invoice_id;
  insert into public.pocket_simple_invoice_events(business_id,invoice_id,event_type,actor_id,idempotency_key,metadata)
    values(p_business_id,p_invoice_id,'debt_linked',p_actor_id,p_operation_key,jsonb_build_object('obligation_id',v_debt_id))
    on conflict do nothing;
  return jsonb_build_object('invoiceId',p_invoice_id,'debtId',v_debt_id,'idempotentReplay',false);
end $$;

create or replace function public.pocket_sync_invoice_payment_status()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update public.pocket_simple_invoices set status=case when new.outstanding_minor=0 then 'paid' when new.paid_minor>0 then 'partially_paid' else 'issued' end
  where business_id=new.business_id and obligation_id=new.id and status<>'cancelled';
  return new;
end $$;
drop trigger if exists pocket_sync_invoice_payment_status on public.obligations;
create trigger pocket_sync_invoice_payment_status after update of paid_minor,status on public.obligations
for each row execute function public.pocket_sync_invoice_payment_status();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('pocket-invoices','pocket-invoices',false,10485760,array['application/pdf','image/jpeg','image/png']::text[])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

alter table public.pocket_invoice_sequences enable row level security;
alter table public.pocket_simple_invoices enable row level security;
alter table public.pocket_simple_invoice_items enable row level security;
alter table public.pocket_simple_invoice_events enable row level security;
drop policy if exists pocket_simple_invoices_tenant_read on public.pocket_simple_invoices;
create policy pocket_simple_invoices_tenant_read on public.pocket_simple_invoices for select to authenticated using(business_id=public.my_business_id());
drop policy if exists pocket_simple_invoice_items_tenant_read on public.pocket_simple_invoice_items;
create policy pocket_simple_invoice_items_tenant_read on public.pocket_simple_invoice_items for select to authenticated using(business_id=public.my_business_id());
drop policy if exists pocket_simple_invoice_events_tenant_read on public.pocket_simple_invoice_events;
create policy pocket_simple_invoice_events_tenant_read on public.pocket_simple_invoice_events for select to authenticated using(business_id=public.my_business_id());
revoke all on public.pocket_invoice_sequences,public.pocket_simple_invoices,public.pocket_simple_invoice_items,public.pocket_simple_invoice_events from public,anon,authenticated;
grant select on public.pocket_simple_invoices,public.pocket_simple_invoice_items,public.pocket_simple_invoice_events to authenticated;
grant select,insert,update on public.pocket_invoice_sequences,public.pocket_simple_invoices,public.pocket_simple_invoice_items to service_role;
grant select,insert on public.pocket_simple_invoice_events to service_role;
revoke all on function public.pocket_issue_simple_invoice(uuid,uuid,uuid,integer,text) from public,anon,authenticated;
revoke all on function public.pocket_convert_invoice_to_debt(uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.pocket_save_simple_invoice_draft(uuid,uuid,uuid,integer,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.pocket_issue_simple_invoice(uuid,uuid,uuid,integer,text) to service_role;
grant execute on function public.pocket_convert_invoice_to_debt(uuid,uuid,uuid,text) to service_role;
grant execute on function public.pocket_save_simple_invoice_draft(uuid,uuid,uuid,integer,jsonb,jsonb,text) to service_role;

commit;

-- Rollback: first export retained invoice PDFs and invoice/event rows. Then remove
-- the private bucket objects, drop the sync/item/validation triggers and functions,
-- drop invoice events/items/invoices/sequences in that order, and finally remove
-- the pocket-invoices bucket. Do not delete linked obligations or payment history.
