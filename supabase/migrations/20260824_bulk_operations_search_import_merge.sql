-- R16: tenant-scoped operational search, imports, bulk actions and controlled duplicate merge.
-- Review after 20260822_roles_permissions_audit.sql.

create extension if not exists pg_trgm;

alter table public.cases
  add column if not exists priority text not null default 'medium',
  add column if not exists assigned_to uuid references auth.users(id) on delete set null,
  add column if not exists next_follow_up_at timestamptz,
  add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.cases drop constraint if exists cases_priority_check;
alter table public.cases add constraint cases_priority_check
  check (priority in ('low','medium','high','urgent'));
alter table public.cases drop constraint if exists cases_metadata_object_check;
alter table public.cases add constraint cases_metadata_object_check
  check (jsonb_typeof(metadata)='object');

alter table public.debtors
  add column if not exists merged_into_id uuid references public.debtors(id) on delete restrict,
  add column if not exists merged_at timestamptz,
  add column if not exists merged_by uuid references auth.users(id) on delete set null,
  add column if not exists merge_reason text;
alter table public.debtors drop constraint if exists debtors_merge_state_check;
alter table public.debtors add constraint debtors_merge_state_check check (
  (merged_into_id is null and merged_at is null and merged_by is null)
  or (merged_into_id is not null and merged_at is not null and archived_at is not null)
);

create index if not exists cases_operational_filter_idx
  on public.cases(business_id,status,priority,due_date,next_follow_up_at)
  where archived_at is null;
create index if not exists cases_assignee_idx
  on public.cases(business_id,assigned_to,status) where archived_at is null;
create index if not exists cases_id_trgm_idx on public.cases using gin(lower(id) gin_trgm_ops);
create index if not exists cases_debtor_name_trgm_idx on public.cases using gin(lower(debtor_name) gin_trgm_ops);
create index if not exists cases_debtor_company_trgm_idx on public.cases using gin(lower(coalesce(debtor_company,'')) gin_trgm_ops);
create index if not exists cases_contact_trgm_idx
  on public.cases using gin(lower(coalesce(debtor_phone,'')||' '||coalesce(debtor_email,'')) gin_trgm_ops);
create index if not exists cases_phone_trgm_idx on public.cases using gin(lower(coalesce(debtor_phone,'')) gin_trgm_ops);
create index if not exists cases_email_trgm_idx on public.cases using gin(lower(coalesce(debtor_email,'')) gin_trgm_ops);
create index if not exists cases_invoice_trgm_idx on public.cases using gin(lower(coalesce(invoice_no,'')) gin_trgm_ops);
create index if not exists cases_metadata_gin_idx on public.cases using gin(metadata jsonb_path_ops);
create index if not exists cases_metadata_search_idx
  on public.cases using gin(to_tsvector('simple',metadata::text));
create index if not exists debtors_identity_search_trgm_idx on public.debtors using gin(
  lower(coalesce(individual_name,'')||' '||coalesce(business_name,'')||' '||
    coalesce(contact_name,'')||' '||coalesce(registration_no,'')||' '||
    coalesce(phone,'')||' '||coalesce(email,'')) gin_trgm_ops
);
create index if not exists customer_accounts_number_trgm_idx
  on public.customer_accounts using gin(lower(coalesce(account_number,'')||' '||display_name) gin_trgm_ops);
create index if not exists customer_accounts_metadata_search_idx
  on public.customer_accounts using gin(to_tsvector('simple',metadata::text||' '||custom_fields::text));
create index if not exists obligations_reference_trgm_idx
  on public.obligations using gin(lower(reference||' '||coalesce(purchase_order_reference,'')) gin_trgm_ops);
create index if not exists obligations_metadata_search_idx
  on public.obligations using gin(to_tsvector('simple',metadata::text||' '||custom_fields::text));

create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  file_name text not null,
  file_type text not null check (file_type in ('csv','xlsx')),
  status text not null check (status in ('dry_run','ready','committing','committed','failed')),
  total_rows integer not null default 0 check (total_rows>=0),
  valid_rows integer not null default 0 check (valid_rows>=0),
  invalid_rows integer not null default 0 check (invalid_rows>=0),
  duplicate_rows integer not null default 0 check (duplicate_rows>=0),
  mapping jsonb not null default '{}'::jsonb check (jsonb_typeof(mapping)='object'),
  created_by uuid not null references auth.users(id) on delete restrict,
  committed_at timestamptz,
  error_summary text,
  created_at timestamptz not null default now()
);
create index if not exists import_batches_business_created_idx
  on public.import_batches(business_id,created_at desc);

create table if not exists public.import_errors (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.import_batches(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete restrict,
  row_number integer not null check (row_number>=1),
  error_code text not null,
  message text not null,
  raw_row jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists import_errors_batch_row_idx
  on public.import_errors(batch_id,row_number);

alter table public.import_batches enable row level security;
alter table public.import_errors enable row level security;
drop policy if exists "import_batches_role_read" on public.import_batches;
create policy "import_batches_role_read" on public.import_batches for select to authenticated
  using(public.has_business_permission(business_id,'case.read'));
drop policy if exists "import_errors_role_read" on public.import_errors;
create policy "import_errors_role_read" on public.import_errors for select to authenticated
  using(public.has_business_permission(business_id,'case.read'));
-- Batch/error writes are server-only so dry runs and failed commits can be
-- reported without granting browser mutation rights.

create or replace function public.operational_case_search(
  p_business_id uuid,
  p_query text default null,
  p_statuses text[] default null,
  p_priorities text[] default null,
  p_owner_id uuid default null,
  p_aging_min integer default null,
  p_aging_max integer default null,
  p_promise_missed boolean default false,
  p_has_plan boolean default false,
  p_has_dispute boolean default false,
  p_due_today boolean default false,
  p_high_value_minor bigint default null,
  p_closed boolean default false,
  p_limit integer default 50,
  p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_query text:=lower(nullif(btrim(p_query),'')); v_result jsonb;
begin
  if not public.has_business_permission(p_business_id,'case.read') then
    raise exception 'Tenant case-read permission required';
  end if;
  if p_limit<1 or p_limit>100 or p_offset<0 then raise exception 'Invalid pagination'; end if;
  with filtered as (
    select c.*
    from public.cases c
    where c.business_id=p_business_id
      and c.archived_at is null
      and (p_closed or c.status<>'closed')
      and (p_statuses is null or c.status=any(p_statuses))
      and (p_priorities is null or c.priority=any(p_priorities))
      and (p_owner_id is null or c.assigned_to=p_owner_id)
      and (p_aging_min is null or greatest(current_date-c.due_date,0)>=p_aging_min)
      and (p_aging_max is null or greatest(current_date-c.due_date,0)<=p_aging_max)
      and (not p_due_today or c.due_date=current_date or c.next_follow_up_at::date=current_date)
      and (p_high_value_minor is null or c.outstanding_minor>=p_high_value_minor)
      and (not p_promise_missed or exists(
        select 1 from public.payment_promises pp where pp.case_id=c.id and pp.business_id=c.business_id
          and pp.status='missed'
      ))
      and (not p_has_plan or exists(
        select 1 from public.payment_plans plan where plan.case_id=c.id and plan.status='active'
      ))
      and (not p_has_dispute or exists(
        select 1 from public.disputes d where d.case_id=c.id and d.business_id=c.business_id
          and d.status in ('submitted','under_review','information_requested','partially_accepted')
      ))
      and (v_query is null
        or lower(c.id) like '%'||v_query||'%'
        or lower(c.debtor_name) like '%'||v_query||'%'
        or lower(coalesce(c.debtor_company,'')) like '%'||v_query||'%'
        or lower(coalesce(c.debtor_phone,'')) like '%'||v_query||'%'
        or lower(coalesce(c.debtor_email,'')) like '%'||v_query||'%'
        or lower(coalesce(c.invoice_no,'')) like '%'||v_query||'%'
        or to_tsvector('simple',c.metadata::text)@@plainto_tsquery('simple',v_query)
        or exists(select 1 from public.debtors d where d.id=c.debtor_id and
          lower(coalesce(d.individual_name,'')||' '||coalesce(d.business_name,'')||' '||
            coalesce(d.contact_name,'')||' '||coalesce(d.registration_no,'')||' '||
            coalesce(d.phone,'')||' '||coalesce(d.email,'')) like '%'||v_query||'%'
        )
        or exists(select 1 from public.customer_accounts a where a.id=c.account_id and (
          lower(coalesce(a.account_number,'')||' '||a.display_name) like '%'||v_query||'%'
          or to_tsvector('simple',a.metadata::text||' '||a.custom_fields::text)@@plainto_tsquery('simple',v_query)
        ))
        or exists(
          select 1 from public.recovery_case_obligations rco
          join public.obligations o on o.id=rco.obligation_id
          where rco.case_id=c.id and (
            lower(o.reference||' '||coalesce(o.purchase_order_reference,'')) like '%'||v_query||'%'
            or to_tsvector('simple',o.metadata::text||' '||o.custom_fields::text)@@plainto_tsquery('simple',v_query)
          )
        )
      )
  ), paged as (
    select * from filtered order by created_at desc limit p_limit offset p_offset
  )
  select jsonb_build_object(
    'cases',coalesce((select jsonb_agg(to_jsonb(paged)) from paged),'[]'::jsonb),
    'total',(select count(*) from filtered)
  ) into v_result;
  return v_result;
end $$;

create or replace function public.global_operational_search(
  p_business_id uuid,p_query text,p_limit integer default 20
) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_query text:=lower(nullif(btrim(p_query),'')); v_result jsonb;
begin
  if not public.has_business_permission(p_business_id,'case.read') then
    raise exception 'Tenant case-read permission required';
  end if;
  if v_query is null or char_length(v_query)<2 then return '[]'::jsonb; end if;
  if p_limit<1 or p_limit>50 then raise exception 'Invalid limit'; end if;
  with results as (
    select 'case'::text result_type,c.id result_id,c.debtor_name label,
      concat_ws(' · ',c.id,c.invoice_no,case when c.outstanding_minor>0 then
        'RM '||to_char(c.outstanding_minor/100.0,'FM9999999990.00') end) subtitle,
      '/cases/'||c.id href,c.updated_at sort_at
    from public.cases c where c.business_id=p_business_id and c.archived_at is null and (
      lower(c.id) like '%'||v_query||'%' or lower(c.debtor_name) like '%'||v_query||'%'
      or lower(coalesce(c.debtor_company,'')) like '%'||v_query||'%'
      or lower(coalesce(c.debtor_phone,'')) like '%'||v_query||'%'
      or lower(coalesce(c.debtor_email,'')) like '%'||v_query||'%'
      or lower(coalesce(c.invoice_no,'')) like '%'||v_query||'%'
      or to_tsvector('simple',c.metadata::text)@@plainto_tsquery('simple',v_query))
    union all
    select 'customer',d.id,coalesce(d.business_name,d.individual_name,'Customer'),
      concat_ws(' · ',d.registration_no,d.phone,d.email),'/debtors?customer='||d.id,d.updated_at
    from public.debtors d where d.business_id=p_business_id and d.archived_at is null and
      lower(coalesce(d.individual_name,'')||' '||coalesce(d.business_name,'')||' '||
        coalesce(d.contact_name,'')||' '||coalesce(d.registration_no,'')||' '||
        coalesce(d.phone,'')||' '||coalesce(d.email,'')) like '%'||v_query||'%'
    union all
    select 'account',a.id::text,a.display_name,
      concat_ws(' · ',a.account_number,a.account_type),'/debtors?customer='||a.customer_id,a.updated_at
    from public.customer_accounts a where a.business_id=p_business_id and a.archived_at is null and (
      lower(coalesce(a.account_number,'')||' '||a.display_name) like '%'||v_query||'%'
      or to_tsvector('simple',a.metadata::text||' '||a.custom_fields::text)@@plainto_tsquery('simple',v_query))
    union all
    select 'obligation',o.id::text,o.reference,
      concat_ws(' · ',o.purchase_order_reference,o.obligation_type),'/debtors?customer='||o.customer_id,o.updated_at
    from public.obligations o where o.business_id=p_business_id and o.archived_at is null and (
      lower(o.reference||' '||coalesce(o.purchase_order_reference,'')) like '%'||v_query||'%'
      or to_tsvector('simple',o.metadata::text||' '||o.custom_fields::text)@@plainto_tsquery('simple',v_query))
  )
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into v_result
  from (select result_type,result_id,label,subtitle,href from results order by sort_at desc limit p_limit) x;
  return v_result;
end $$;

create or replace function public.bulk_update_cases(
  p_business_id uuid,p_case_ids text[],p_action text,p_value text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_count integer; v_actor uuid:=auth.uid(); v_assignee uuid; v_follow_up timestamptz;
begin
  if not public.has_business_permission(p_business_id,'case.manage') then
    raise exception 'Tenant case-manage permission required';
  end if;
  if coalesce(array_length(p_case_ids,1),0)<1 or array_length(p_case_ids,1)>250 then
    raise exception 'Select 1 to 250 cases';
  end if;
  if (select count(*) from public.cases where business_id=p_business_id and id=any(p_case_ids))
      <> (select count(distinct x) from unnest(p_case_ids) x) then
    raise exception 'One or more cases are outside this tenant';
  end if;
  if p_action='assign_owner' then
    v_assignee:=nullif(p_value,'')::uuid;
    if v_assignee is not null and not exists(
      select 1 from public.businesses b left join public.business_memberships m
        on m.business_id=b.id and m.user_id=v_assignee and m.status='active'
      where b.id=p_business_id and (b.owner_id=v_assignee or m.id is not null)
    ) then raise exception 'Assignee is not an active tenant member'; end if;
    update public.cases set assigned_to=v_assignee,updated_at=now()
      where business_id=p_business_id and id=any(p_case_ids);
  elsif p_action='follow_up' then
    v_follow_up:=p_value::timestamptz;
    if v_follow_up<now()-interval '1 day' or v_follow_up>now()+interval '2 years' then
      raise exception 'Follow-up date is outside the allowed range';
    end if;
    update public.cases set next_follow_up_at=v_follow_up,updated_at=now()
      where business_id=p_business_id and id=any(p_case_ids);
  else raise exception 'Unsupported bulk action';
  end if;
  get diagnostics v_count=row_count;
  insert into public.audit_logs(
    business_id,action,actor_type,actor_id,actor_role,entity_type,metadata
  ) values(
    p_business_id,'cases.bulk_'||p_action,'staff',v_actor,
    (select coalesce(m.role,case when b.owner_id=v_actor then 'owner' end)
      from public.businesses b left join public.business_memberships m
        on m.business_id=b.id and m.user_id=v_actor and m.status='active'
      where b.id=p_business_id limit 1),
    'case_batch',jsonb_build_object('case_ids',p_case_ids,'value',p_value,'affected',v_count)
  );
  return jsonb_build_object('affected',v_count);
end $$;

create or replace function public.commit_operational_import(
  p_business_id uuid,p_batch_id uuid,p_rows jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_actor uuid:=auth.uid(); v_row jsonb; v_customer uuid; v_account uuid;
  v_obligation uuid; v_case_id text; v_amount bigint; v_count integer:=0;
  v_existing public.debtors; v_account_number text;
begin
  if not public.has_business_permission(p_business_id,'case.manage') then
    raise exception 'Tenant case-manage permission required';
  end if;
  if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)<1
    or jsonb_array_length(p_rows)>5000 then raise exception 'Import must contain 1 to 5000 rows'; end if;
  if not exists(select 1 from public.import_batches where id=p_batch_id and business_id=p_business_id) then
    raise exception 'Import batch is outside this tenant';
  end if;
  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_amount:=(v_row->>'opening_outstanding_minor')::bigint;
    if v_amount<=0 then raise exception 'Outstanding amount must be positive'; end if;
    v_customer:=nullif(v_row->>'matched_customer_id','')::uuid;
    if v_customer is not null then
      select * into v_existing from public.debtors
        where id=v_customer and business_id=p_business_id and archived_at is null;
      if not found then raise exception 'Confirmed customer match is unavailable'; end if;
    elsif coalesce((v_row->>'reuse_confirmed')::boolean,false) then
      select d.id into v_customer from public.debtors d
      where d.business_id=p_business_id and d.archived_at is null and (
        (nullif(regexp_replace(coalesce(v_row->>'registration_no',''),'[^a-zA-Z0-9]','','g'),'') is not null
          and upper(regexp_replace(coalesce(d.registration_no,''),'[^a-zA-Z0-9]','','g'))
            =upper(regexp_replace(v_row->>'registration_no','[^a-zA-Z0-9]','','g')))
        or (nullif(lower(btrim(coalesce(v_row->>'email',''))),'') is not null
          and lower(btrim(coalesce(d.email,'')))=lower(btrim(v_row->>'email')))
        or (char_length(regexp_replace(coalesce(v_row->>'phone',''),'\D','','g'))>=7
          and regexp_replace(coalesce(d.phone,''),'\D','','g')=regexp_replace(v_row->>'phone','\D','','g'))
        or exists(select 1 from public.customer_accounts a
          where a.business_id=p_business_id and a.customer_id=d.id and a.archived_at is null
            and nullif(lower(btrim(coalesce(v_row->>'account_number',''))),'') is not null
            and lower(btrim(coalesce(a.account_number,'')))=lower(btrim(v_row->>'account_number')))
      ) limit 1;
    end if;
    if v_customer is null then
      insert into public.debtors(
        business_id,debtor_type,individual_name,business_name,contact_name,
        registration_no,phone,email,address
      ) values(
        p_business_id,v_row->>'debtor_type',
        case when v_row->>'debtor_type'='individual' then v_row->>'customer_name' end,
        case when v_row->>'debtor_type'='business' then v_row->>'customer_name' end,
        nullif(v_row->>'contact_name',''),nullif(v_row->>'registration_no',''),
        nullif(v_row->>'phone',''),nullif(v_row->>'email',''),nullif(v_row->>'address','')
      ) returning id into v_customer;
    end if;
    v_account_number:=nullif(v_row->>'account_number','');
    select id into v_account from public.customer_accounts
      where business_id=p_business_id and customer_id=v_customer
        and account_number is not distinct from v_account_number and archived_at is null;
    if not found then
      insert into public.customer_accounts(
        business_id,customer_id,account_type,account_number,display_name,currency,metadata,custom_fields
      ) values(
        p_business_id,v_customer,coalesce(nullif(v_row->>'account_type',''),'general'),
        v_account_number,coalesce(nullif(v_row->>'account_name',''),v_row->>'customer_name'),
        'MYR',coalesce(v_row->'account_metadata','{}'::jsonb),'{}'::jsonb
      ) returning id into v_account;
    end if;
    insert into public.obligations(
      business_id,customer_id,account_id,obligation_type,reference,purchase_order_reference,
      issue_date,due_date,currency,original_amount_minor,adjustments_minor,paid_minor,status,metadata,custom_fields
    ) values(
      p_business_id,v_customer,v_account,coalesce(nullif(v_row->>'obligation_type',''),'invoice'),
      v_row->>'reference',nullif(v_row->>'purchase_order_reference',''),
      nullif(v_row->>'issue_date','')::date,(v_row->>'due_date')::date,'MYR',
      v_amount,0,0,case when (v_row->>'due_date')::date<current_date then 'overdue' else 'open' end,
      coalesce(v_row->'obligation_metadata','{}'::jsonb)||jsonb_build_object(
        'import_batch_id',p_batch_id,'opening_balance',true
      ),'{}'::jsonb
    ) returning id into v_obligation;
    v_case_id:='CB-'||extract(year from current_date)::text||'-'||substr(replace(gen_random_uuid()::text,'-',''),1,12);
    insert into public.cases(
      id,business_id,debtor_id,account_id,case_scope,debtor_type,debtor_name,debtor_phone,
      debtor_email,debtor_company,debtor_reg_no,debtor_location,amount_owed,amount_paid,
      original_principal_minor,contractual_due_minor,approved_payment_minor,outstanding_minor,
      due_date,invoice_no,status,payment_lock_mode,priority,metadata
    ) select
      v_case_id,p_business_id,d.id,v_account,'single_obligation',d.debtor_type,
      coalesce(d.business_name,d.individual_name,''),d.phone,d.email,d.business_name,
      d.registration_no,d.address,v_amount/100.0,0,v_amount,v_amount,0,v_amount,
      (v_row->>'due_date')::date,v_row->>'reference',
      case when (v_row->>'due_date')::date<current_date then 'overdue' else 'action_needed' end,
      'approval',coalesce(nullif(v_row->>'priority',''),'medium'),
      jsonb_build_object('import_batch_id',p_batch_id)
    from public.debtors d where d.id=v_customer;
    insert into public.recovery_case_obligations(case_id,obligation_id,business_id,linked_by)
      values(v_case_id,v_obligation,p_business_id,v_actor);
    v_count:=v_count+1;
  end loop;
  update public.import_batches set status='committed',committed_at=now(),valid_rows=v_count
    where id=p_batch_id and business_id=p_business_id;
  insert into public.audit_logs(
    business_id,action,actor_type,actor_id,entity_type,entity_id,metadata
  ) values(
    p_business_id,'import.committed','staff',v_actor,'import_batch',p_batch_id::text,
    jsonb_build_object('row_count',v_count)
  );
  return jsonb_build_object('batch_id',p_batch_id,'imported',v_count);
end $$;

create or replace function public.merge_duplicate_debtors(
  p_business_id uuid,p_source_id uuid,p_target_id uuid,p_reason text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_actor uuid:=auth.uid(); v_source public.debtors; v_target public.debtors;
  v_account public.customer_accounts; v_target_account uuid; v_case_count integer;
  v_obligation_count integer;
begin
  if not public.has_business_permission(p_business_id,'case.manage') then
    raise exception 'Tenant case-manage permission required';
  end if;
  if p_source_id=p_target_id or char_length(btrim(coalesce(p_reason,'')))<3 then
    raise exception 'A distinct source, target and merge reason are required';
  end if;
  select * into v_source from public.debtors
    where id=p_source_id and business_id=p_business_id and archived_at is null for update;
  select * into v_target from public.debtors
    where id=p_target_id and business_id=p_business_id and archived_at is null for update;
  if v_source.id is null or v_target.id is null then raise exception 'Merge customers are unavailable'; end if;
  if not (
    (nullif(regexp_replace(coalesce(v_source.registration_no,''),'[^a-zA-Z0-9]','','g'),'') is not null
      and upper(regexp_replace(v_source.registration_no,'[^a-zA-Z0-9]','','g'))
        =upper(regexp_replace(coalesce(v_target.registration_no,''),'[^a-zA-Z0-9]','','g')))
    or (nullif(lower(btrim(coalesce(v_source.email,''))),'') is not null
      and lower(btrim(v_source.email))=lower(btrim(coalesce(v_target.email,''))))
    or (char_length(regexp_replace(coalesce(v_source.phone,''),'\D','','g'))>=7
      and regexp_replace(v_source.phone,'\D','','g')=regexp_replace(coalesce(v_target.phone,''),'\D','','g'))
  ) then raise exception 'Customers do not share a reliable merge identifier'; end if;
  select count(*) into v_case_count from public.cases
    where business_id=p_business_id and debtor_id=p_source_id;
  select count(*) into v_obligation_count from public.obligations
    where business_id=p_business_id and customer_id=p_source_id;

  for v_account in select * from public.customer_accounts
    where business_id=p_business_id and customer_id=p_source_id and archived_at is null
  loop
    select id into v_target_account from public.customer_accounts
      where business_id=p_business_id and customer_id=p_target_id
        and account_number is not distinct from v_account.account_number
      limit 1;
    if v_target_account is null then
      insert into public.customer_accounts(
        business_id,customer_id,account_type,account_number,display_name,currency,metadata,custom_fields
      ) values(
        p_business_id,p_target_id,v_account.account_type,v_account.account_number,
        v_account.display_name,v_account.currency,
        v_account.metadata||jsonb_build_object('merged_from_account_id',v_account.id),
        v_account.custom_fields
      ) returning id into v_target_account;
    else
      update public.customer_accounts set archived_at=null,updated_at=now()
        where id=v_target_account and business_id=p_business_id;
    end if;
    update public.obligations set customer_id=p_target_id,account_id=v_target_account,updated_at=now()
      where business_id=p_business_id and customer_id=p_source_id and account_id=v_account.id;
    update public.cases set debtor_id=p_target_id,account_id=v_target_account,updated_at=now()
      where business_id=p_business_id and debtor_id=p_source_id and account_id=v_account.id;
    update public.customer_accounts set archived_at=now(),updated_at=now()
      where id=v_account.id and business_id=p_business_id;
    v_target_account:=null;
  end loop;
  update public.obligations set customer_id=p_target_id,updated_at=now()
    where business_id=p_business_id and customer_id=p_source_id;
  update public.cases set debtor_id=p_target_id,
      debtor_type=v_target.debtor_type,
      debtor_name=coalesce(v_target.business_name,v_target.individual_name,debtor_name),
      debtor_phone=coalesce(v_target.phone,debtor_phone),
      debtor_email=coalesce(v_target.email,debtor_email),
      debtor_company=case when v_target.debtor_type='business' then v_target.business_name else null end,
      debtor_reg_no=coalesce(v_target.registration_no,debtor_reg_no),
      debtor_location=coalesce(v_target.address,debtor_location),updated_at=now()
    where business_id=p_business_id and debtor_id=p_source_id;
  update public.domain_events set customer_id=p_target_id where business_id=p_business_id and customer_id=p_source_id;
  update public.notifications set customer_id=p_target_id where business_id=p_business_id and customer_id=p_source_id;
  update public.action_centre_items set customer_id=p_target_id where business_id=p_business_id and customer_id=p_source_id;
  update public.payment_promises set customer_id=p_target_id where business_id=p_business_id and customer_id=p_source_id;
  update public.disputes set customer_id=p_target_id where business_id=p_business_id and customer_id=p_source_id;
  update public.payment_negotiations set customer_id=p_target_id where business_id=p_business_id and customer_id=p_source_id;
  update public.communication_activities set customer_id=p_target_id where business_id=p_business_id and customer_id=p_source_id;
  update public.contact_guard_overrides set customer_id=p_target_id where business_id=p_business_id and customer_id=p_source_id;
  if not exists(select 1 from public.contact_preferences where business_id=p_business_id and customer_id=p_target_id) then
    update public.contact_preferences set customer_id=p_target_id,updated_at=now()
      where business_id=p_business_id and customer_id=p_source_id;
  end if;
  update public.debtors set archived_at=now(),merged_into_id=p_target_id,merged_at=now(),
      merged_by=v_actor,merge_reason=btrim(p_reason),updated_at=now()
    where id=p_source_id and business_id=p_business_id;
  insert into public.audit_logs(
    business_id,action,actor_type,actor_id,entity_type,entity_id,before_summary,after_summary,metadata
  ) values(
    p_business_id,'customer.merged','staff',v_actor,'debtor',p_source_id::text,
    jsonb_build_object('source',to_jsonb(v_source),'target',to_jsonb(v_target)),
    jsonb_build_object('merged_into_id',p_target_id,'archived',true),
    jsonb_build_object('reason',btrim(p_reason),'cases_preserved',v_case_count,'obligations_preserved',v_obligation_count)
  );
  return jsonb_build_object(
    'source_id',p_source_id,'target_id',p_target_id,
    'cases_preserved',v_case_count,'obligations_preserved',v_obligation_count
  );
end $$;

revoke all on function public.operational_case_search(uuid,text,text[],text[],uuid,integer,integer,boolean,boolean,boolean,boolean,bigint,boolean,integer,integer) from public;
revoke all on function public.global_operational_search(uuid,text,integer) from public;
revoke all on function public.bulk_update_cases(uuid,text[],text,text) from public;
revoke all on function public.commit_operational_import(uuid,uuid,jsonb) from public;
revoke all on function public.merge_duplicate_debtors(uuid,uuid,uuid,text) from public;
grant execute on function public.operational_case_search(uuid,text,text[],text[],uuid,integer,integer,boolean,boolean,boolean,boolean,bigint,boolean,integer,integer) to authenticated;
grant execute on function public.global_operational_search(uuid,text,integer) to authenticated;
grant execute on function public.bulk_update_cases(uuid,text[],text,text) to authenticated;
grant execute on function public.commit_operational_import(uuid,uuid,jsonb) to authenticated;
grant execute on function public.merge_duplicate_debtors(uuid,uuid,uuid,text) to authenticated;
grant all on public.import_batches,public.import_errors to service_role;

-- Rollback: disable import, bulk update, global search and duplicate merge in
-- the application, then revoke their RPC grants. Preserve import batches,
-- errors, debtor merge references and audit metadata. Additive indexes/columns
-- may remain unused; never split merged records or delete import evidence
-- without a separately reviewed data-repair plan.
