-- Prompt 4: Pocket customer profiles and simple debt ledger.
-- Additive only. Pocket remains a projection over debtors and obligations.

alter table public.debtors
  add column if not exists pocket_note text,
  add column if not exists preferred_reminder_language text,
  add column if not exists normalized_phone text,
  add column if not exists normalized_email text;

create index if not exists debtors_pocket_phone_lookup_idx
  on public.debtors(business_id, normalized_phone)
  where normalized_phone is not null and merged_into_id is null;
create index if not exists debtors_pocket_email_lookup_idx
  on public.debtors(business_id, normalized_email)
  where normalized_email is not null and merged_into_id is null;

alter table public.obligations
  add column if not exists origin_product_type text,
  add column if not exists pocket_description text,
  add column if not exists pocket_debt_date date,
  add column if not exists pocket_due_date date,
  add column if not exists pocket_reminder_preference text;

alter table public.obligations drop constraint if exists obligations_origin_product_type_check;
alter table public.obligations add constraint obligations_origin_product_type_check
  check (origin_product_type is null or origin_product_type in ('main','pocket'));
alter table public.obligations drop constraint if exists obligations_pocket_dates_check;
alter table public.obligations add constraint obligations_pocket_dates_check
  check (pocket_debt_date is null or pocket_due_date is null or pocket_due_date >= pocket_debt_date);
alter table public.obligations drop constraint if exists obligations_pocket_description_check;
alter table public.obligations add constraint obligations_pocket_description_check
  check (origin_product_type <> 'pocket' or nullif(btrim(pocket_description),'') is not null);

create index if not exists obligations_pocket_list_idx
  on public.obligations(business_id, pocket_due_date, created_at desc)
  where origin_product_type='pocket';

create table if not exists public.pocket_debt_attachments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  debt_id uuid not null,
  evidence_id uuid not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key(debt_id,business_id) references public.obligations(id,business_id) on delete restrict,
  foreign key(evidence_id,business_id) references public.evidence_files(id,business_id) on delete restrict,
  unique(debt_id,evidence_id)
);
create index if not exists pocket_debt_attachments_debt_idx on public.pocket_debt_attachments(business_id,debt_id,created_at);
alter table public.pocket_debt_attachments enable row level security;
revoke all on public.pocket_debt_attachments from public,anon,authenticated;
grant select,insert on public.pocket_debt_attachments to service_role;

create or replace function public.pocket_normalize_email(p_value text)
returns text language sql immutable parallel safe as $$
  select nullif(lower(btrim(coalesce(p_value,''))),'')
$$;

create or replace function public.pocket_normalize_phone(p_value text)
returns text language sql immutable parallel safe as $$
  select nullif(regexp_replace(coalesce(p_value,''),'[^0-9]+','','g'),'')
$$;

create or replace function public.pocket_customer_normalize()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  new.normalized_email:=public.pocket_normalize_email(new.email);
  new.normalized_phone:=public.pocket_normalize_phone(new.phone);
  return new;
end $$;
drop trigger if exists pocket_customer_normalize on public.debtors;
create trigger pocket_customer_normalize before insert or update of email,phone on public.debtors
for each row execute function public.pocket_customer_normalize();

update public.debtors set
  normalized_email=public.pocket_normalize_email(email),
  normalized_phone=public.pocket_normalize_phone(phone)
where normalized_email is distinct from public.pocket_normalize_email(email)
   or normalized_phone is distinct from public.pocket_normalize_phone(phone);

-- Only live Pocket debts count: active, partially paid and overdue. Drafts do not.
create or replace function public.pocket_obligation_is_active(v public.obligations)
returns boolean language sql immutable as $$
  select v.origin_product_type='pocket'
    and v.archived_at is null
    and greatest(v.original_amount_minor+v.adjustments_minor-v.paid_minor,0)>0
    and v.status in('open','partial','overdue')
$$;

-- Allocation/reversal writers remain authoritative for paid_minor. This trigger only
-- projects that shared balance into a deterministic Pocket lifecycle state.
create or replace function public.pocket_sync_debt_status()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_timezone text; v_today date; v_status text;
begin
  if new.origin_product_type<>'pocket' or new.archived_at is not null or new.status in('draft','void','written_off') then return new; end if;
  select coalesce(timezone,'UTC') into v_timezone from public.businesses where id=new.business_id;
  v_today:=(now() at time zone coalesce(v_timezone,'UTC'))::date;
  v_status:=case
    when new.outstanding_minor=0 then 'paid'
    when new.pocket_due_date is not null and new.pocket_due_date<v_today then 'overdue'
    when new.paid_minor>0 then 'partial'
    else 'open' end;
  if new.status is distinct from v_status then
    update public.obligations set status=v_status,updated_at=now() where id=new.id;
    insert into public.audit_logs(business_id,action,actor_type,actor_id,metadata)
    values(new.business_id,'pocket.debt.status_changed','system',null,
      jsonb_build_object('entity_type','obligation','entity_id',new.id,'from_status',new.status,'to_status',v_status,'remaining_minor',new.outstanding_minor));
  end if;
  return new;
end $$;
drop trigger if exists pocket_sync_debt_status on public.obligations;
create trigger pocket_sync_debt_status after insert or update of paid_minor,adjustments_minor,original_amount_minor,pocket_due_date,archived_at
on public.obligations for each row execute function public.pocket_sync_debt_status();

-- Rebuild counters after changing the counting predicate.
insert into public.pocket_active_debt_counters(business_id,active_count,updated_at)
select w.business_id,count(o.id)::integer,now()
from public.workspace_product_states w
left join public.obligations o on o.business_id=w.business_id and public.pocket_obligation_is_active(o)
where w.product_type='pocket'
group by w.business_id
on conflict(business_id) do update set active_count=excluded.active_count,updated_at=excluded.updated_at;

-- Rollback: disable Pocket debt writes and deploy compatible readers before
-- disabling the sync trigger/functions. Preserve debtors, obligations, status
-- events and counter evidence; leave additive Pocket columns unused if needed.
-- Rebuild counters only from verified obligations, and never delete customer or
-- financial history to restore an earlier Pocket shell.
