-- Pocket commercial policy, entitlements, billing lifecycle, and atomic usage enforcement.
-- Additive proposal only: review and apply after 20260912_workspace_product_state.sql.

create table if not exists public.commercial_offers (
  offer_key text primary key,
  product_type text not null check (product_type in ('main','pocket')),
  offer_kind text not null check (offer_kind in ('base','addon','cycle_pack')),
  amount_minor bigint not null check (amount_minor >= 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  interval_kind text not null check (interval_kind in ('month','year','cycle')),
  recurring boolean not null,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.commercial_offers(offer_key,product_type,offer_kind,amount_minor,currency,interval_kind,recurring,metadata)
values
  ('pocket_monthly','pocket','base',990,'MYR','month',true,'{"capability_set":"pocket_base"}'),
  ('pocket_annual','pocket','base',9900,'MYR','year',true,'{"capability_set":"pocket_base"}'),
  ('pocket_invoice_addon','pocket','addon',1000,'MYR','month',true,'{"invoice_units":30}'),
  ('pocket_extra_invoice_pack','pocket','cycle_pack',1000,'MYR','cycle',false,'{"invoice_units":30,"maximum_per_cycle":1}')
on conflict(offer_key) do update set
  product_type=excluded.product_type,offer_kind=excluded.offer_kind,amount_minor=excluded.amount_minor,
  currency=excluded.currency,interval_kind=excluded.interval_kind,recurring=excluded.recurring,
  metadata=excluded.metadata,updated_at=now();

create table if not exists public.workspace_commercial_states (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  product_type text not null check (product_type='pocket'),
  base_offer_key text references public.commercial_offers(offer_key) on delete restrict,
  lifecycle_state text not null check (lifecycle_state in (
    'trialing','active','past_due','payment_retry','cancelled_at_period_end','cancelled','grace_read_only','suspended'
  )),
  cycle_start timestamptz,
  cycle_end timestamptz,
  grace_until timestamptz,
  read_only_at timestamptz,
  stripe_customer_id text unique,
  last_provider_event_id text,
  last_provider_event_created_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cycle_end is null or cycle_start is not null),
  check (cycle_end is null or cycle_end > cycle_start)
);

create table if not exists public.workspace_subscription_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  offer_key text not null references public.commercial_offers(offer_key) on delete restrict,
  provider_subscription_id text not null,
  provider_item_id text not null,
  provider_price_id text not null,
  provider_status text not null,
  period_start timestamptz,
  period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  last_provider_event_id text not null,
  last_provider_event_created_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider_item_id),
  unique(business_id,offer_key,provider_subscription_id)
);
create index if not exists workspace_subscription_items_business_idx
  on public.workspace_subscription_items(business_id,offer_key,period_end desc);

create table if not exists public.workspace_cycle_purchases (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  offer_key text not null references public.commercial_offers(offer_key) on delete restrict,
  cycle_start timestamptz not null,
  cycle_end timestamptz not null,
  checkout_session_id text not null unique,
  payment_intent_id text,
  provider_event_id text not null unique,
  provider_event_created_at timestamptz not null,
  purchased_by uuid references auth.users(id) on delete set null,
  purchased_at timestamptz not null default now(),
  unique(business_id,offer_key,cycle_start)
);

create table if not exists public.workspace_usage_counters (
  business_id uuid not null references public.businesses(id) on delete cascade,
  capability_key text not null,
  cycle_start timestamptz not null,
  cycle_end timestamptz not null,
  used_units integer not null default 0 check (used_units >= 0),
  updated_at timestamptz not null default now(),
  primary key(business_id,capability_key,cycle_start)
);

create table if not exists public.workspace_usage_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  capability_key text not null,
  cycle_start timestamptz not null,
  operation_key text not null,
  units integer not null default 1 check (units > 0),
  actor_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now(),
  unique(business_id,capability_key,cycle_start,operation_key)
);

create table if not exists public.workspace_checkout_reservations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete restrict,
  offer_key text not null references public.commercial_offers(offer_key) on delete restrict,
  idempotency_key text not null,
  cycle_start timestamptz,
  cycle_end timestamptz,
  checkout_session_id text unique,
  status text not null default 'pending' check(status in('pending','completed','expired')),
  expires_at timestamptz not null default now()+interval '30 minutes',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(business_id,idempotency_key)
);
create unique index if not exists pocket_cycle_pack_live_reservation_uidx
  on public.workspace_checkout_reservations(business_id,offer_key,cycle_start)
  where offer_key='pocket_extra_invoice_pack' and status in('pending','completed');
create unique index if not exists pocket_base_live_reservation_uidx
  on public.workspace_checkout_reservations(business_id)
  where offer_key in('pocket_monthly','pocket_annual') and status='pending';

create table if not exists public.pocket_active_debt_counters (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  active_count integer not null default 0 check(active_count between 0 and 100),
  updated_at timestamptz not null default now()
);

create or replace function public.pocket_actor_belongs_to_business(p_business_id uuid,p_actor_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.businesses where id=p_business_id and owner_id=p_actor_id)
    or exists(select 1 from public.business_memberships
      where business_id=p_business_id and user_id=p_actor_id and status='active')
$$;

create or replace function public.pocket_is_workspace(p_business_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.workspace_product_states
    where business_id=p_business_id and product_type='pocket')
$$;

create or replace function public.pocket_capability_limit(
  p_business_id uuid,p_capability_key text,p_cycle_start timestamptz,p_cycle_end timestamptz
) returns integer language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_addon boolean; v_pack boolean;
begin
  if p_capability_key='pocket.receipt.process' then return 100; end if;
  if p_capability_key='pocket.invoice.create' then
    select exists(select 1 from public.workspace_subscription_items
      where business_id=p_business_id and offer_key='pocket_invoice_addon'
        and provider_status in('active','trialing') and coalesce(period_end,p_cycle_end)>=p_cycle_start)
      into v_addon;
    if not v_addon then return 0; end if;
    select exists(select 1 from public.workspace_cycle_purchases
      where business_id=p_business_id and offer_key='pocket_extra_invoice_pack' and cycle_start=p_cycle_start)
      into v_pack;
    return case when v_pack then 60 else 30 end;
  end if;
  return null;
end $$;

create or replace function public.pocket_authorize_capability_internal(
  p_business_id uuid,p_actor_id uuid,p_capability_key text,p_operation_key text default null,
  p_consume boolean default false,p_metadata jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_state public.workspace_commercial_states; v_limit integer; v_used integer:=0; v_inserted uuid;
begin
  if not public.pocket_is_workspace(p_business_id) then raise exception 'PLAN_NOT_AUTHORISED'; end if;
  select * into v_state from public.workspace_commercial_states where business_id=p_business_id for update;
  if not found or v_state.base_offer_key not in('pocket_monthly','pocket_annual') then raise exception 'PLAN_NOT_AUTHORISED'; end if;
  if p_capability_key in('pocket.data.read','pocket.data.export') then
    return jsonb_build_object('allowed',true,'limit',null,'used',null,'remaining',null,'readOnly',v_state.lifecycle_state not in('trialing','active','cancelled_at_period_end','payment_retry'));
  end if;
  if p_capability_key not in('pocket.customer.manage','pocket.debt.manage','pocket.payment.record','pocket.receipt.process',
    'pocket.invoice.create','pocket.reminder.manage','pocket.report.basic','pocket.workspace.user') then
    raise exception 'PLAN_NOT_AUTHORISED';
  end if;
  if v_state.lifecycle_state='past_due' then raise exception 'SUBSCRIPTION_PAST_DUE'; end if;
  if v_state.lifecycle_state='payment_retry' and v_state.grace_until is not null and now()>v_state.grace_until then raise exception 'READ_ONLY_MODE'; end if;
  if v_state.lifecycle_state in('cancelled','grace_read_only','suspended') then raise exception 'READ_ONLY_MODE'; end if;
  if v_state.cycle_start is null or v_state.cycle_end is null then raise exception 'PLAN_NOT_AUTHORISED'; end if;
  v_limit:=public.pocket_capability_limit(p_business_id,p_capability_key,v_state.cycle_start,v_state.cycle_end);
  if p_capability_key='pocket.invoice.create' and coalesce(v_limit,0)=0 then raise exception 'ADD_ON_REQUIRED'; end if;
  if v_limit is null then return jsonb_build_object('allowed',true,'limit',null,'used',null,'remaining',null,'readOnly',false); end if;
  insert into public.workspace_usage_counters(business_id,capability_key,cycle_start,cycle_end)
    values(p_business_id,p_capability_key,v_state.cycle_start,v_state.cycle_end) on conflict do nothing;
  select used_units into v_used from public.workspace_usage_counters
    where business_id=p_business_id and capability_key=p_capability_key and cycle_start=v_state.cycle_start for update;
  if p_consume then
    if nullif(btrim(p_operation_key),'') is null then raise exception 'PLAN_NOT_AUTHORISED'; end if;
    if exists(select 1 from public.workspace_usage_events where business_id=p_business_id
      and capability_key=p_capability_key and cycle_start=v_state.cycle_start and operation_key=p_operation_key) then
      return jsonb_build_object('allowed',true,'limit',v_limit,'used',v_used,'remaining',greatest(v_limit-v_used,0),'readOnly',false,'duplicate',true);
    end if;
    if v_used>=v_limit then raise exception 'LIMIT_REACHED'; end if;
    insert into public.workspace_usage_events(business_id,capability_key,cycle_start,operation_key,actor_id,metadata)
      values(p_business_id,p_capability_key,v_state.cycle_start,p_operation_key,p_actor_id,coalesce(p_metadata,'{}'::jsonb)) returning id into v_inserted;
    update public.workspace_usage_counters set used_units=used_units+1,updated_at=now()
      where business_id=p_business_id and capability_key=p_capability_key and cycle_start=v_state.cycle_start
      returning used_units into v_used;
  end if;
  return jsonb_build_object('allowed',true,'limit',v_limit,'used',v_used,'remaining',greatest(v_limit-v_used,0),'readOnly',false,'duplicate',false);
end $$;

create or replace function public.pocket_authorize_capability(
  p_business_id uuid,p_actor_id uuid,p_capability_key text,p_operation_key text default null,p_consume boolean default false
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.pocket_actor_belongs_to_business(p_business_id,p_actor_id) then raise exception 'PLAN_NOT_AUTHORISED'; end if;
  return public.pocket_authorize_capability_internal(p_business_id,p_actor_id,p_capability_key,p_operation_key,p_consume,'{}'::jsonb);
end $$;

create or replace function public.pocket_get_entitlements(p_business_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v public.workspace_commercial_states; v_debt integer:=0; v_ocr integer:=0; v_invoice integer:=0; v_invoice_limit integer:=0; v_addon boolean; v_pack boolean;
begin
  select * into v from public.workspace_commercial_states where business_id=p_business_id;
  if not found or not public.pocket_is_workspace(p_business_id) then raise exception 'PLAN_NOT_AUTHORISED'; end if;
  select coalesce((select active_count from public.pocket_active_debt_counters where business_id=p_business_id),0) into v_debt;
  select coalesce(max(used_units),0) into v_ocr from public.workspace_usage_counters where business_id=p_business_id and capability_key='pocket.receipt.process' and cycle_start=v.cycle_start;
  select coalesce(max(used_units),0) into v_invoice from public.workspace_usage_counters where business_id=p_business_id and capability_key='pocket.invoice.create' and cycle_start=v.cycle_start;
  v_invoice_limit:=coalesce(public.pocket_capability_limit(p_business_id,'pocket.invoice.create',v.cycle_start,v.cycle_end),0);
  v_addon:=v_invoice_limit>0; v_pack:=v_invoice_limit=60;
  return jsonb_build_object(
    'productType','pocket','baseOffer',v.base_offer_key,'lifecycleState',v.lifecycle_state,
    'readOnly',v.lifecycle_state in('past_due','cancelled','grace_read_only','suspended') or (v.lifecycle_state='payment_retry' and now()>coalesce(v.grace_until,now())),
    'billingCycle',jsonb_build_object('startsAt',v.cycle_start,'endsAt',v.cycle_end),
    'addOns',jsonb_build_object('simpleInvoice',v_addon,'extraInvoicePack',v_pack),
    'capabilities',jsonb_build_object(
      'pocket.data.read',jsonb_build_object('enabled',true),'pocket.data.export',jsonb_build_object('enabled',true),
      'pocket.customer.manage',jsonb_build_object('enabled',v.lifecycle_state in('trialing','active','cancelled_at_period_end','payment_retry')),
      'pocket.debt.manage',jsonb_build_object('enabled',v.lifecycle_state in('trialing','active','cancelled_at_period_end','payment_retry'),'limit',100,'used',v_debt,'remaining',greatest(100-v_debt,0)),
      'pocket.payment.record',jsonb_build_object('enabled',v.lifecycle_state in('trialing','active','cancelled_at_period_end','payment_retry')),
      'pocket.receipt.process',jsonb_build_object('enabled',v.lifecycle_state in('trialing','active','cancelled_at_period_end','payment_retry'),'limit',100,'used',v_ocr,'remaining',greatest(100-v_ocr,0)),
      'pocket.invoice.create',jsonb_build_object('enabled',v_addon and v.lifecycle_state in('trialing','active','cancelled_at_period_end','payment_retry'),'limit',v_invoice_limit,'used',v_invoice,'remaining',greatest(v_invoice_limit-v_invoice,0)),
      'pocket.reminder.manage',jsonb_build_object('enabled',v.lifecycle_state in('trialing','active','cancelled_at_period_end','payment_retry')),
      'pocket.report.basic',jsonb_build_object('enabled',true),
      'pocket.workspace.user',jsonb_build_object('enabled',v.lifecycle_state in('trialing','active','cancelled_at_period_end','payment_retry'),'limit',1,'used',1,'remaining',0)
    )
  );
end $$;

create or replace function public.pocket_apply_subscription_state(
  p_business_id uuid,p_customer_id text,p_provider_event_id text,p_provider_event_created_at timestamptz,p_items jsonb
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare r jsonb; v_base public.workspace_subscription_items; v_state text:='suspended'; v_grace timestamptz; v_shell_state text;
begin
  if not public.pocket_is_workspace(p_business_id) or jsonb_typeof(p_items)<>'array' then raise exception 'PLAN_NOT_AUTHORISED'; end if;
  for r in select * from jsonb_array_elements(p_items) loop
    if r->>'offer_key' not in('pocket_monthly','pocket_annual','pocket_invoice_addon') then raise exception 'PLAN_NOT_AUTHORISED'; end if;
    insert into public.workspace_subscription_items(business_id,offer_key,provider_subscription_id,provider_item_id,provider_price_id,
      provider_status,period_start,period_end,cancel_at_period_end,last_provider_event_id,last_provider_event_created_at)
    values(p_business_id,r->>'offer_key',r->>'provider_subscription_id',r->>'provider_item_id',r->>'provider_price_id',r->>'provider_status',
      nullif(r->>'period_start','')::timestamptz,nullif(r->>'period_end','')::timestamptz,coalesce((r->>'cancel_at_period_end')::boolean,false),
      p_provider_event_id,p_provider_event_created_at)
    on conflict(provider_item_id) do update set
      provider_status=excluded.provider_status,period_start=excluded.period_start,period_end=excluded.period_end,
      cancel_at_period_end=excluded.cancel_at_period_end,provider_price_id=excluded.provider_price_id,
      last_provider_event_id=excluded.last_provider_event_id,last_provider_event_created_at=excluded.last_provider_event_created_at,updated_at=now()
    where excluded.last_provider_event_created_at>=workspace_subscription_items.last_provider_event_created_at;
  end loop;
  select * into v_base from public.workspace_subscription_items where business_id=p_business_id
    and offer_key in('pocket_monthly','pocket_annual') order by last_provider_event_created_at desc limit 1;
  if not found then return; end if;
  if v_base.provider_status='trialing' then v_state:='trialing';
  elsif v_base.provider_status='active' and v_base.cancel_at_period_end then v_state:='cancelled_at_period_end';
  elsif v_base.provider_status='active' then v_state:='active';
  elsif v_base.provider_status='past_due' then v_state:='payment_retry'; v_grace:=now()+interval '7 days';
  elsif v_base.provider_status='canceled' then v_state:=case when coalesce(v_base.period_end,now())>now() then 'cancelled' else 'grace_read_only' end;
  else v_state:='suspended'; end if;
  v_shell_state:=case when v_state in('trialing','active','payment_retry','cancelled_at_period_end') then 'active' when v_state='suspended' then 'suspended' else 'grace_read_only' end;
  insert into public.workspace_commercial_states(business_id,product_type,base_offer_key,lifecycle_state,cycle_start,cycle_end,grace_until,read_only_at,
    stripe_customer_id,last_provider_event_id,last_provider_event_created_at)
  values(p_business_id,'pocket',v_base.offer_key,v_state,v_base.period_start,v_base.period_end,v_grace,
    case when v_shell_state='grace_read_only' then now() else null end,p_customer_id,p_provider_event_id,p_provider_event_created_at)
  on conflict(business_id) do update set base_offer_key=excluded.base_offer_key,lifecycle_state=excluded.lifecycle_state,
    cycle_start=excluded.cycle_start,cycle_end=excluded.cycle_end,grace_until=excluded.grace_until,
    read_only_at=excluded.read_only_at,stripe_customer_id=excluded.stripe_customer_id,
    last_provider_event_id=case when excluded.last_provider_event_created_at>=coalesce(workspace_commercial_states.last_provider_event_created_at,'-infinity'::timestamptz)
      then excluded.last_provider_event_id else workspace_commercial_states.last_provider_event_id end,
    last_provider_event_created_at=greatest(workspace_commercial_states.last_provider_event_created_at,excluded.last_provider_event_created_at),updated_at=now();
  update public.workspace_product_states set lifecycle_state=v_shell_state,updated_at=now() where business_id=p_business_id and product_type='pocket';
end $$;

create or replace function public.pocket_refresh_lifecycle_states(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare v_count integer;
begin
  update public.workspace_commercial_states set lifecycle_state='grace_read_only',read_only_at=coalesce(read_only_at,p_now),updated_at=p_now
    where (lifecycle_state='payment_retry' and grace_until is not null and grace_until<=p_now)
       or (lifecycle_state='cancelled' and cycle_end is not null and cycle_end<=p_now);
  get diagnostics v_count=row_count;
  update public.workspace_product_states w set lifecycle_state='grace_read_only',updated_at=p_now
    where product_type='pocket' and exists(select 1 from public.workspace_commercial_states c where c.business_id=w.business_id and c.lifecycle_state='grace_read_only');
  return v_count;
end $$;

create or replace function public.pocket_reserve_checkout(
  p_business_id uuid,p_actor_id uuid,p_offer_key text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.workspace_commercial_states; x public.workspace_checkout_reservations;
begin
  if not public.pocket_is_workspace(p_business_id) or not public.pocket_actor_belongs_to_business(p_business_id,p_actor_id) then raise exception 'PLAN_NOT_AUTHORISED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text,913));
  if p_offer_key not in('pocket_monthly','pocket_annual','pocket_invoice_addon','pocket_extra_invoice_pack') then raise exception 'PLAN_NOT_AUTHORISED'; end if;
  select * into x from public.workspace_checkout_reservations where business_id=p_business_id and idempotency_key=p_idempotency_key;
  if found then return jsonb_build_object('reservation_id',x.id,'cycle_start',x.cycle_start,'cycle_end',x.cycle_end); end if;
  select * into v from public.workspace_commercial_states where business_id=p_business_id for update;
  update public.workspace_checkout_reservations set status='expired',updated_at=now()
    where business_id=p_business_id and status='pending' and expires_at<=now();
  if p_offer_key in('pocket_monthly','pocket_annual') and exists(select 1 from public.workspace_checkout_reservations
    where business_id=p_business_id and offer_key in('pocket_monthly','pocket_annual') and status='pending') then raise exception 'PLAN_NOT_AUTHORISED'; end if;
  if p_offer_key in('pocket_monthly','pocket_annual') and found
    and v.lifecycle_state in('trialing','active','payment_retry','cancelled_at_period_end') then
    raise exception 'PLAN_NOT_AUTHORISED';
  end if;
  if p_offer_key in('pocket_invoice_addon','pocket_extra_invoice_pack') and (not found or v.lifecycle_state not in('trialing','active','cancelled_at_period_end','payment_retry')) then raise exception 'PLAN_NOT_AUTHORISED'; end if;
  if p_offer_key='pocket_invoice_addon' and exists(select 1 from public.workspace_subscription_items
    where business_id=p_business_id and offer_key=p_offer_key and provider_status in('active','trialing')) then raise exception 'PLAN_NOT_AUTHORISED'; end if;
  if p_offer_key='pocket_extra_invoice_pack' then
    if public.pocket_capability_limit(p_business_id,'pocket.invoice.create',v.cycle_start,v.cycle_end)=0 then raise exception 'ADD_ON_REQUIRED'; end if;
    update public.workspace_checkout_reservations set status='expired',updated_at=now() where business_id=p_business_id and offer_key=p_offer_key and status='pending' and expires_at<=now();
    if exists(select 1 from public.workspace_cycle_purchases where business_id=p_business_id and offer_key=p_offer_key and cycle_start=v.cycle_start) then raise exception 'LIMIT_REACHED'; end if;
  end if;
  insert into public.workspace_checkout_reservations(business_id,actor_id,offer_key,idempotency_key,cycle_start,cycle_end)
    values(p_business_id,p_actor_id,p_offer_key,p_idempotency_key,case when p_offer_key='pocket_extra_invoice_pack' then v.cycle_start end,
      case when p_offer_key='pocket_extra_invoice_pack' then v.cycle_end end) returning * into x;
  return jsonb_build_object('reservation_id',x.id,'cycle_start',x.cycle_start,'cycle_end',x.cycle_end);
end $$;

create or replace function public.pocket_attach_checkout_session(p_reservation_id uuid,p_checkout_session_id text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update public.workspace_checkout_reservations set checkout_session_id=p_checkout_session_id,updated_at=now()
    where id=p_reservation_id and status='pending';
  if not found then raise exception 'PLAN_NOT_AUTHORISED'; end if;
end $$;

create or replace function public.pocket_record_cycle_pack(
  p_business_id uuid,p_actor_id uuid,p_checkout_session_id text,p_payment_intent_id text,
  p_provider_event_id text,p_provider_event_created_at timestamptz
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare x public.workspace_checkout_reservations;
begin
  select * into x from public.workspace_checkout_reservations where business_id=p_business_id and checkout_session_id=p_checkout_session_id for update;
  if not found or x.offer_key<>'pocket_extra_invoice_pack' then raise exception 'PLAN_NOT_AUTHORISED'; end if;
  if not public.pocket_actor_belongs_to_business(p_business_id,p_actor_id)
    or not exists(select 1 from public.workspace_commercial_states where business_id=p_business_id and cycle_start=x.cycle_start and cycle_end=x.cycle_end)
    or now()>=x.cycle_end then raise exception 'PLAN_NOT_AUTHORISED'; end if;
  insert into public.workspace_cycle_purchases(business_id,offer_key,cycle_start,cycle_end,checkout_session_id,payment_intent_id,
    provider_event_id,provider_event_created_at,purchased_by)
  values(p_business_id,x.offer_key,x.cycle_start,x.cycle_end,p_checkout_session_id,p_payment_intent_id,p_provider_event_id,p_provider_event_created_at,p_actor_id)
  on conflict do nothing;
  update public.workspace_checkout_reservations set status='completed',updated_at=now() where id=x.id;
end $$;

create or replace function public.pocket_commit_invoice_usage(
  p_business_id uuid,p_actor_id uuid,p_invoice_id uuid,p_invoice_number text,p_operation_key text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if nullif(btrim(p_invoice_number),'') is null then raise exception 'PLAN_NOT_AUTHORISED'; end if;
  if not public.pocket_actor_belongs_to_business(p_business_id,p_actor_id) then raise exception 'PLAN_NOT_AUTHORISED'; end if;
  return public.pocket_authorize_capability_internal(p_business_id,p_actor_id,'pocket.invoice.create',p_operation_key,true,
    jsonb_build_object('invoice_id',p_invoice_id,'invoice_number',p_invoice_number,'usage_rule','committed_numbers_are_not_restored_on_cancellation'));
end $$;

create or replace function public.pocket_extraction_usage_guard()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_hash text;
begin
  if public.pocket_is_workspace(new.business_id) then
    select content_sha256 into v_hash from public.evidence_files where id=new.evidence_id and business_id=new.business_id;
    perform public.pocket_authorize_capability_internal(new.business_id,null,'pocket.receipt.process','ocr:'||coalesce(v_hash,new.evidence_id::text),true,
      jsonb_build_object('evidence_id',new.evidence_id));
  end if;
  return new;
end $$;
drop trigger if exists pocket_extraction_usage_guard on public.document_intake_extractions;
create trigger pocket_extraction_usage_guard before insert on public.document_intake_extractions
for each row execute function public.pocket_extraction_usage_guard();

create or replace function public.pocket_obligation_is_active(v public.obligations)
returns boolean language sql immutable as $$
  select v.archived_at is null and greatest(v.original_amount_minor+v.adjustments_minor-v.paid_minor,0)>0
    and v.status not in('paid','void','written_off')
$$;
create or replace function public.pocket_active_debt_guard()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_business uuid:=coalesce(new.business_id,old.business_id); v_old boolean:=false; v_new boolean:=false; v_count integer;
begin
  if not public.pocket_is_workspace(v_business) then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  if tg_op<>'INSERT' then v_old:=public.pocket_obligation_is_active(old); end if;
  if tg_op<>'DELETE' then v_new:=public.pocket_obligation_is_active(new); end if;
  if v_old=v_new then if tg_op='DELETE' then return old; else return new; end if; end if;
  insert into public.pocket_active_debt_counters(business_id,active_count) values(v_business,0) on conflict do nothing;
  select active_count into v_count from public.pocket_active_debt_counters where business_id=v_business for update;
  if v_new and not v_old and v_count>=100 then raise exception 'LIMIT_REACHED'; end if;
  update public.pocket_active_debt_counters set active_count=greatest(0,active_count+case when v_new then 1 else -1 end),updated_at=now() where business_id=v_business;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;
drop trigger if exists pocket_active_debt_guard on public.obligations;
create trigger pocket_active_debt_guard before insert or update or delete on public.obligations
for each row execute function public.pocket_active_debt_guard();

create or replace function public.pocket_active_user_guard()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_count integer;
begin
  if new.status='active' and (tg_op='INSERT' or old.status is distinct from 'active') and public.pocket_is_workspace(new.business_id) then
    perform pg_advisory_xact_lock(hashtextextended(new.business_id::text,913));
    select 1+count(*) into v_count from public.business_memberships
      where business_id=new.business_id and status='active' and (tg_op='INSERT' or id<>new.id);
    if v_count>=1 then raise exception 'LIMIT_REACHED'; end if;
  end if;
  return new;
end $$;
drop trigger if exists pocket_active_user_guard on public.business_memberships;
create trigger pocket_active_user_guard before insert or update of status on public.business_memberships
for each row execute function public.pocket_active_user_guard();

insert into public.pocket_active_debt_counters(business_id,active_count)
select w.business_id,count(o.id)::integer from public.workspace_product_states w
left join public.obligations o on o.business_id=w.business_id and public.pocket_obligation_is_active(o)
where w.product_type='pocket' group by w.business_id
on conflict(business_id) do update set active_count=excluded.active_count,updated_at=now();

alter table public.commercial_offers enable row level security;
alter table public.workspace_commercial_states enable row level security;
alter table public.workspace_subscription_items enable row level security;
alter table public.workspace_cycle_purchases enable row level security;
alter table public.workspace_usage_counters enable row level security;
alter table public.workspace_usage_events enable row level security;
alter table public.workspace_checkout_reservations enable row level security;
alter table public.pocket_active_debt_counters enable row level security;
revoke all on public.commercial_offers,public.workspace_commercial_states,public.workspace_subscription_items,
  public.workspace_cycle_purchases,public.workspace_usage_counters,public.workspace_usage_events,
  public.workspace_checkout_reservations,public.pocket_active_debt_counters from public,anon,authenticated;
grant all on public.commercial_offers,public.workspace_commercial_states,public.workspace_subscription_items,
  public.workspace_cycle_purchases,public.workspace_usage_counters,public.workspace_usage_events,
  public.workspace_checkout_reservations,public.pocket_active_debt_counters to service_role;
revoke all on function public.pocket_authorize_capability(uuid,uuid,text,text,boolean) from public,anon,authenticated;
revoke all on function public.pocket_get_entitlements(uuid) from public,anon,authenticated;
revoke all on function public.pocket_apply_subscription_state(uuid,text,text,timestamptz,jsonb) from public,anon,authenticated;
revoke all on function public.pocket_refresh_lifecycle_states(timestamptz) from public,anon,authenticated;
revoke all on function public.pocket_reserve_checkout(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.pocket_attach_checkout_session(uuid,text) from public,anon,authenticated;
revoke all on function public.pocket_record_cycle_pack(uuid,uuid,text,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.pocket_commit_invoice_usage(uuid,uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.pocket_actor_belongs_to_business(uuid,uuid) from public,anon,authenticated;
revoke all on function public.pocket_is_workspace(uuid) from public,anon,authenticated;
revoke all on function public.pocket_capability_limit(uuid,text,timestamptz,timestamptz) from public,anon,authenticated;
revoke all on function public.pocket_authorize_capability_internal(uuid,uuid,text,text,boolean,jsonb) from public,anon,authenticated;
revoke all on function public.pocket_extraction_usage_guard() from public,anon,authenticated;
revoke all on function public.pocket_obligation_is_active(public.obligations) from public,anon,authenticated;
revoke all on function public.pocket_active_debt_guard() from public,anon,authenticated;
revoke all on function public.pocket_active_user_guard() from public,anon,authenticated;
grant execute on function public.pocket_authorize_capability(uuid,uuid,text,text,boolean) to service_role;
grant execute on function public.pocket_get_entitlements(uuid) to service_role;
grant execute on function public.pocket_apply_subscription_state(uuid,text,text,timestamptz,jsonb) to service_role;
grant execute on function public.pocket_refresh_lifecycle_states(timestamptz) to service_role;
grant execute on function public.pocket_reserve_checkout(uuid,uuid,text,text) to service_role;
grant execute on function public.pocket_attach_checkout_session(uuid,text) to service_role;
grant execute on function public.pocket_record_cycle_pack(uuid,uuid,text,text,text,timestamptz) to service_role;
grant execute on function public.pocket_commit_invoice_usage(uuid,uuid,uuid,text,text) to service_role;

-- Rollback only after Pocket writes and billing webhooks are disabled. Preserve
-- usage/event rows for audit export before dropping tables. Drop the three
-- enforcement triggers first, then the functions and tables in reverse order.
