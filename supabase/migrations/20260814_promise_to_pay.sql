begin;

-- R06 Promise to Pay. Legacy cases.promise_due_date remains supported by the
-- R03 detector; new promises use this first-class, tenant-scoped lifecycle.
create table if not exists public.payment_promises (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  case_id text not null references public.cases(id) on delete restrict,
  customer_id uuid references public.debtors(id) on delete restrict,
  promised_amount_minor bigint not null check (promised_amount_minor > 0),
  promise_date date not null,
  source text not null check (source in ('whatsapp','call','email','portal','in_person','manual')),
  source_activity_type text,
  source_activity_id text,
  note text,
  status text not null default 'pending'
    check (status in ('pending','partially_fulfilled','fulfilled','missed','cancelled')),
  amount_fulfilled_minor bigint not null default 0
    check (amount_fulfilled_minor >= 0 and amount_fulfilled_minor <= promised_amount_minor),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  fulfilled_at timestamptz,
  missed_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  idempotency_key uuid not null default gen_random_uuid(),
  unique (business_id, idempotency_key),
  check (
    nullif(btrim(coalesce(source_activity_type, '')), '') is not null
    or source_activity_id is null
  ),
  check ((status = 'fulfilled') = (fulfilled_at is not null)),
  check ((status = 'missed') = (missed_at is not null)),
  check ((status = 'cancelled') = (cancelled_at is not null))
);

create unique index if not exists payment_promises_one_active_per_case_uidx
  on public.payment_promises(case_id)
  where status in ('pending','partially_fulfilled');
create index if not exists payment_promises_scheduler_idx
  on public.payment_promises(business_id,promise_date)
  where status in ('pending','partially_fulfilled');
create index if not exists payment_promises_case_history_idx
  on public.payment_promises(case_id,created_at desc,id);

create table if not exists public.payment_promise_allocations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  promise_id uuid not null references public.payment_promises(id) on delete restrict,
  payment_id uuid not null references public.payments(id) on delete restrict,
  amount_minor bigint not null check (amount_minor > 0),
  matching_rule text not null check (
    matching_rule in ('explicit_same_case_payment','authorised_override')
  ),
  override_reason text,
  allocated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  reversed_at timestamptz,
  reversed_by uuid references auth.users(id) on delete set null,
  reversal_reason text,
  unique (promise_id,payment_id),
  check (
    (matching_rule = 'authorised_override' and nullif(btrim(coalesce(override_reason,'')),'') is not null)
    or (matching_rule = 'explicit_same_case_payment' and override_reason is null)
  )
);
create unique index if not exists payment_promise_allocations_payment_active_uidx
  on public.payment_promise_allocations(payment_id) where reversed_at is null;
create index if not exists payment_promise_allocations_promise_idx
  on public.payment_promise_allocations(promise_id,created_at,id);

create table if not exists public.payment_promise_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  promise_id uuid not null references public.payment_promises(id) on delete restrict,
  case_id text not null references public.cases(id) on delete restrict,
  payment_id uuid references public.payments(id) on delete set null,
  event_type text not null check (
    event_type in (
      'created','payment_matched','partially_fulfilled','fulfilled',
      'missed','cancelled','match_overridden','payment_reversed'
    )
  ),
  actor_type text not null check (actor_type in ('owner','system')),
  actor_id uuid references auth.users(id) on delete set null,
  amount_minor bigint check (amount_minor is null or amount_minor >= 0),
  note text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now()
);
create unique index if not exists payment_promise_events_missed_once_uidx
  on public.payment_promise_events(promise_id,event_type) where event_type='missed';
create index if not exists payment_promise_events_case_timeline_idx
  on public.payment_promise_events(case_id,created_at,id);

alter table public.payment_promises enable row level security;
alter table public.payment_promise_allocations enable row level security;
alter table public.payment_promise_events enable row level security;
create policy "payment_promises_owner_read" on public.payment_promises
  for select to authenticated using (
    exists (select 1 from public.businesses b where b.id=business_id and b.owner_id=auth.uid())
  );
create policy "payment_promise_allocations_owner_read" on public.payment_promise_allocations
  for select to authenticated using (
    exists (select 1 from public.businesses b where b.id=business_id and b.owner_id=auth.uid())
  );
create policy "payment_promise_events_owner_read" on public.payment_promise_events
  for select to authenticated using (
    exists (select 1 from public.businesses b where b.id=business_id and b.owner_id=auth.uid())
  );

create or replace function public.payment_promise_assert_owner(p_promise_id uuid)
returns public.payment_promises
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_promise public.payment_promises;
begin
  select pp.* into v_promise
  from public.payment_promises pp
  join public.businesses b on b.id=pp.business_id
  where pp.id=p_promise_id and b.owner_id=auth.uid()
  for update of pp;
  if not found then raise exception 'Payment promise not found'; end if;
  return v_promise;
end;
$$;

create or replace function public.payment_promise_create(
  p_case_id text,
  p_amount_minor bigint,
  p_promise_date date,
  p_source text,
  p_source_activity_type text default null,
  p_source_activity_id text default null,
  p_note text default null,
  p_idempotency_key uuid default gen_random_uuid()
) returns public.payment_promises
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_case public.cases;
  v_promise public.payment_promises;
  v_timezone text;
begin
  if p_amount_minor <= 0 then raise exception 'Promise amount must be positive'; end if;
  if p_source not in ('whatsapp','call','email','portal','in_person','manual') then
    raise exception 'Unsupported promise source';
  end if;
  select c,b.timezone into v_case,v_timezone
  from public.cases c join public.businesses b on b.id=c.business_id
  where c.id=p_case_id and b.owner_id=auth.uid()
  for update of c;
  if not found then raise exception 'Case not found'; end if;
  if p_promise_date < timezone(v_timezone,now())::date then
    raise exception 'Promise date cannot be in the past';
  end if;
  if v_case.archived_at is not null or v_case.status in ('paid','closed') or v_case.outstanding_minor <= 0 then
    raise exception 'This case cannot accept a payment promise';
  end if;
  if exists (
    select 1 from public.payment_plans pp
    where pp.case_id=v_case.id and pp.status in ('pending_acceptance','active','defaulted')
  ) then
    raise exception 'Use the authoritative payment plan schedule while a plan is open';
  end if;

  select pp.* into v_promise from public.payment_promises pp
  where pp.business_id=v_case.business_id and pp.idempotency_key=p_idempotency_key;
  if found then return v_promise; end if;

  insert into public.payment_promises (
    business_id,case_id,customer_id,promised_amount_minor,promise_date,source,
    source_activity_type,source_activity_id,note,created_by,idempotency_key
  ) values (
    v_case.business_id,v_case.id,v_case.debtor_id,p_amount_minor,p_promise_date,p_source,
    nullif(btrim(p_source_activity_type),''),nullif(btrim(p_source_activity_id),''),
    nullif(btrim(p_note),''),auth.uid(),p_idempotency_key
  ) returning * into v_promise;

  insert into public.payment_promise_events (
    business_id,promise_id,case_id,event_type,actor_type,actor_id,amount_minor,metadata
  ) values (
    v_case.business_id,v_promise.id,v_case.id,'created','owner',auth.uid(),p_amount_minor,
    jsonb_build_object('promise_date',p_promise_date,'source',p_source)
  );
  insert into public.audit_logs (business_id,case_id,action,actor_type,actor_id,metadata)
  values (
    v_case.business_id,v_case.id,'payment_promise.created','owner',auth.uid(),
    jsonb_build_object('promise_id',v_promise.id,'amount_minor',p_amount_minor,'promise_date',p_promise_date)
  );

  perform set_config('collectboss.lifecycle_transition','on',true);
  update public.cases set status='payment_promise',promise_due_date=p_promise_date,
    status_version=status_version+1,updated_at=now()
  where id=v_case.id;
  perform set_config('collectboss.lifecycle_transition','off',true);
  return v_promise;
exception when unique_violation then
  select pp.* into v_promise from public.payment_promises pp
  where pp.business_id=v_case.business_id and pp.idempotency_key=p_idempotency_key;
  if found then return v_promise; end if;
  raise exception 'This case already has an active payment promise';
end;
$$;

create or replace function public.payment_promise_apply_payment(
  p_promise_id uuid,
  p_payment_id uuid,
  p_override boolean default false,
  p_override_reason text default null
) returns public.payment_promises
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_promise public.payment_promises;
  v_payment public.payments;
  v_existing public.payment_promise_allocations;
  v_amount bigint;
  v_new_amount bigint;
  v_new_status text;
begin
  v_promise := public.payment_promise_assert_owner(p_promise_id);
  select p.* into v_payment from public.payments p where p.id=p_payment_id for update;
  if not found or v_payment.case_id<>v_promise.case_id then
    raise exception 'Payment must belong to the same case';
  end if;
  if v_payment.review_status<>'approved' or v_payment.reversed_at is not null then
    raise exception 'Only an approved, unreversed payment can be matched';
  end if;
  select a.* into v_existing from public.payment_promise_allocations a
  where a.payment_id=p_payment_id and a.reversed_at is null;
  if found then
    if v_existing.promise_id=p_promise_id then return v_promise; end if;
    raise exception 'Payment is already matched to another promise';
  end if;
  if p_override and nullif(btrim(coalesce(p_override_reason,'')),'') is null then
    raise exception 'An override reason is required';
  end if;
  if not p_override and (
    v_promise.status not in ('pending','partially_fulfilled')
    or v_payment.created_at < v_promise.created_at
  ) then
    raise exception 'Payment is outside the explicit same-case matching rule; use an authorised override with a reason';
  end if;
  if v_promise.status in ('fulfilled','cancelled') then
    raise exception 'A completed or cancelled promise cannot receive allocations';
  end if;

  v_amount := least(
    round(v_payment.amount*100)::bigint,
    v_promise.promised_amount_minor-v_promise.amount_fulfilled_minor
  );
  if v_amount<=0 then return v_promise; end if;
  insert into public.payment_promise_allocations (
    business_id,promise_id,payment_id,amount_minor,matching_rule,override_reason,allocated_by
  ) values (
    v_promise.business_id,v_promise.id,v_payment.id,v_amount,
    case when p_override then 'authorised_override' else 'explicit_same_case_payment' end,
    case when p_override then btrim(p_override_reason) else null end,auth.uid()
  );

  v_new_amount := v_promise.amount_fulfilled_minor+v_amount;
  v_new_status := case when v_new_amount>=v_promise.promised_amount_minor
    then 'fulfilled' else 'partially_fulfilled' end;
  update public.payment_promises set
    amount_fulfilled_minor=v_new_amount,status=v_new_status,updated_at=now(),
    fulfilled_at=case when v_new_status='fulfilled' then now() else null end,
    missed_at=null
  where id=v_promise.id returning * into v_promise;

  insert into public.payment_promise_events (
    business_id,promise_id,case_id,payment_id,event_type,actor_type,actor_id,amount_minor,note,metadata
  ) values (
    v_promise.business_id,v_promise.id,v_promise.case_id,v_payment.id,
    case when p_override then 'match_overridden' else 'payment_matched' end,
    'owner',auth.uid(),v_amount,
    case when p_override then btrim(p_override_reason) else null end,
    jsonb_build_object('matching_rule',case when p_override then 'authorised_override' else 'explicit_same_case_payment' end)
  );
  insert into public.payment_promise_events (
    business_id,promise_id,case_id,payment_id,event_type,actor_type,actor_id,amount_minor
  ) values (
    v_promise.business_id,v_promise.id,v_promise.case_id,v_payment.id,
    v_new_status,'owner',auth.uid(),v_new_amount
  );
  insert into public.audit_logs (business_id,case_id,action,actor_type,actor_id,metadata)
  values (
    v_promise.business_id,v_promise.case_id,
    case when p_override then 'payment_promise.match_overridden' else 'payment_promise.payment_matched' end,
    'owner',auth.uid(),
    jsonb_build_object('promise_id',v_promise.id,'payment_id',v_payment.id,'amount_minor',v_amount,'reason',p_override_reason)
  );

  if v_new_status='fulfilled' then
    update public.action_centre_items set status='completed',completed_at=now()
    where business_id=v_promise.business_id and entity_type='payment_promise'
      and entity_id=v_promise.id and status in ('open','in_progress','snoozed');
  end if;
  return v_promise;
end;
$$;

create or replace function public.payment_promise_cancel(
  p_promise_id uuid,
  p_reason text
) returns public.payment_promises
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_promise public.payment_promises;
begin
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'A cancellation reason is required'; end if;
  v_promise := public.payment_promise_assert_owner(p_promise_id);
  if v_promise.status='cancelled' then return v_promise; end if;
  if v_promise.status='fulfilled' then raise exception 'A fulfilled promise cannot be cancelled'; end if;
  update public.payment_promises set status='cancelled',cancelled_at=now(),missed_at=null,
    cancellation_reason=btrim(p_reason),updated_at=now()
  where id=v_promise.id returning * into v_promise;
  insert into public.payment_promise_events (
    business_id,promise_id,case_id,event_type,actor_type,actor_id,note
  ) values (v_promise.business_id,v_promise.id,v_promise.case_id,'cancelled','owner',auth.uid(),btrim(p_reason));
  insert into public.audit_logs (business_id,case_id,action,actor_type,actor_id,metadata)
  values (v_promise.business_id,v_promise.case_id,'payment_promise.cancelled','owner',auth.uid(),
    jsonb_build_object('promise_id',v_promise.id,'reason',btrim(p_reason)));
  update public.action_centre_items set status='completed',completed_at=now()
  where business_id=v_promise.business_id and entity_type='payment_promise'
    and entity_id=v_promise.id and status in ('open','in_progress','snoozed');
  perform set_config('collectboss.lifecycle_transition','on',true);
  update public.cases set
    status=case when due_date<current_date and outstanding_minor>0 then 'overdue' else 'action_needed' end,
    promise_due_date=null,status_version=status_version+1,updated_at=now()
  where id=v_promise.case_id and status='payment_promise';
  perform set_config('collectboss.lifecycle_transition','off',true);
  return v_promise;
end;
$$;

create or replace function public.payment_promise_recalculate_after_reversal()
returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_allocation public.payment_promise_allocations;
  v_promise public.payment_promises;
  v_total bigint;
  v_status text;
begin
  if new.review_status<>'reversed' or old.review_status='reversed' then return new; end if;
  select a.* into v_allocation
  from public.payment_promise_allocations a
  where a.payment_id=new.id and a.reversed_at is null
  for update;
  if not found then return new; end if;

  update public.payment_promise_allocations set
    reversed_at=coalesce(new.reversed_at,now()),reversed_by=new.reversed_by,
    reversal_reason=coalesce(new.reversal_reason,'Payment reversed')
  where id=v_allocation.id;
  select pp.* into v_promise from public.payment_promises pp
  where pp.id=v_allocation.promise_id for update;
  select coalesce(sum(a.amount_minor),0)::bigint into v_total
  from public.payment_promise_allocations a
  where a.promise_id=v_promise.id and a.reversed_at is null;
  v_status:=case
    when v_promise.status='cancelled' then 'cancelled'
    when v_total>=v_promise.promised_amount_minor then 'fulfilled'
    when v_total>0 then 'partially_fulfilled'
    else 'pending'
  end;
  update public.payment_promises set
    amount_fulfilled_minor=least(v_total,promised_amount_minor),status=v_status,updated_at=now(),
    fulfilled_at=case when v_status='fulfilled' then coalesce(fulfilled_at,now()) else null end,
    missed_at=case when v_status='missed' then coalesce(missed_at,now()) else null end
  where id=v_promise.id returning * into v_promise;
  insert into public.payment_promise_events (
    business_id,promise_id,case_id,payment_id,event_type,actor_type,actor_id,amount_minor,note
  ) values (
    v_promise.business_id,v_promise.id,v_promise.case_id,new.id,'payment_reversed',
    'owner',new.reversed_by,v_allocation.amount_minor,new.reversal_reason
  );
  return new;
end;
$$;

drop trigger if exists payment_promise_payment_reversal on public.payments;
create trigger payment_promise_payment_reversal
after update of review_status,reversed_at on public.payments
for each row execute function public.payment_promise_recalculate_after_reversal();

create or replace function public.payment_promises_run_scheduler(p_now timestamptz default now())
returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_row record;
  v_event_id uuid;
  v_processed integer:=0;
begin
  for v_row in
    select pp.*,b.timezone,b.owner_id,c.outstanding_minor
    from public.payment_promises pp
    join public.businesses b on b.id=pp.business_id
    join public.cases c on c.id=pp.case_id and c.business_id=pp.business_id
    where pp.status in ('pending','partially_fulfilled')
      and pp.promise_date<timezone(b.timezone,p_now)::date
      and c.archived_at is null
    order by pp.promise_date,pp.id
    for update of pp skip locked
  loop
    update public.payment_promises set status='missed',missed_at=p_now,updated_at=p_now
    where id=v_row.id and status in ('pending','partially_fulfilled');
    if not found then continue; end if;

    insert into public.payment_promise_events (
      business_id,promise_id,case_id,event_type,actor_type,amount_minor,metadata,created_at
    ) values (
      v_row.business_id,v_row.id,v_row.case_id,'missed','system',
      v_row.promised_amount_minor-v_row.amount_fulfilled_minor,
      jsonb_build_object('promise_date',v_row.promise_date,'amount_fulfilled_minor',v_row.amount_fulfilled_minor),p_now
    ) on conflict (promise_id,event_type) where event_type='missed' do nothing;

    insert into public.domain_events (
      business_id,case_id,customer_id,event_type,source_entity_type,source_entity_id,
      source_version,effective_date,event_timezone,occurred_at,payload,deduplication_key
    ) values (
      v_row.business_id,v_row.case_id,v_row.customer_id,'PROMISE_MISSED','payment_promise',v_row.id::text,
      v_row.promise_date::text,v_row.promise_date+1,v_row.timezone,p_now,
      jsonb_build_object(
        'promise_id',v_row.id,'promise_due_date',v_row.promise_date,
        'amount_minor',v_row.promised_amount_minor,
        'amount_fulfilled_minor',v_row.amount_fulfilled_minor
      ),
      concat_ws(':',v_row.business_id::text,'PROMISE_MISSED','payment_promise',v_row.id::text,v_row.promise_date::text)
    ) on conflict (deduplication_key) do update set deduplication_key=excluded.deduplication_key
    returning id into v_event_id;

    -- R05's legacy projection intentionally validates the old case field.
    -- First-class promises create their own action from the same domain event.
    insert into public.action_centre_items (
      business_id,case_id,customer_id,assignee_id,type,title,description,reason,href,
      entity_type,entity_id,amount_minor,priority,due_at,status,recommended_action,
      source_event_id,dedupe_key
    ) values (
      v_row.business_id,v_row.case_id,v_row.customer_id,v_row.owner_id,'promise.missed',
      'Follow up missed promise','The promised payment date passed before the explicitly matched amount was sufficient.',
      'Promise has an unpaid amount.','/cases/'||v_row.case_id,'payment_promise',v_row.id,
      v_row.promised_amount_minor-v_row.amount_fulfilled_minor,'high',
      v_row.promise_date::timestamp at time zone v_row.timezone,'open','Follow up with customer',
      v_event_id,'payment-promise-missed:'||v_row.id::text
    ) on conflict (business_id,dedupe_key) do nothing;

    insert into public.action_centre_item_events (
      action_item_id,business_id,case_id,actor_type,event_type,to_status,metadata
    )
    select aci.id,v_row.business_id,v_row.case_id,'system','created','open',
      jsonb_build_object('promise_id',v_row.id,'source_event_id',v_event_id)
    from public.action_centre_items aci
    where aci.business_id=v_row.business_id and aci.dedupe_key='payment-promise-missed:'||v_row.id::text
      and not exists (
        select 1 from public.action_centre_item_events e
        where e.action_item_id=aci.id and e.event_type='created'
      );

    perform set_config('collectboss.lifecycle_transition','on',true);
    update public.cases set status='overdue',promise_due_date=null,
      status_version=status_version+1,updated_at=p_now
    where id=v_row.case_id and status='payment_promise';
    perform set_config('collectboss.lifecycle_transition','off',true);
    v_processed:=v_processed+1;
  end loop;
  return jsonb_build_object('missed',v_processed);
end;
$$;

revoke all on function public.payment_promise_assert_owner(uuid) from public,authenticated,anon;
revoke all on function public.payment_promise_create(text,bigint,date,text,text,text,text,uuid) from public,anon;
revoke all on function public.payment_promise_apply_payment(uuid,uuid,boolean,text) from public,anon;
revoke all on function public.payment_promise_cancel(uuid,text) from public,anon;
revoke all on function public.payment_promise_recalculate_after_reversal() from public,authenticated,anon;
revoke all on function public.payment_promises_run_scheduler(timestamptz) from public,authenticated,anon;
grant execute on function public.payment_promise_create(text,bigint,date,text,text,text,text,uuid) to authenticated;
grant execute on function public.payment_promise_apply_payment(uuid,uuid,boolean,text) to authenticated;
grant execute on function public.payment_promise_cancel(uuid,text) to authenticated;
grant execute on function public.payment_promises_run_scheduler(timestamptz) to service_role;

commit;

-- Rollback: stop the promise scheduler and promise mutations, then deploy code
-- that no longer calls these RPCs. Revoke execute and leave promise rows/events
-- read-only so audit history and payment links remain intact. Drop functions or
-- tables only after an approved export and retention review; do not delete
-- promises merely to restore the legacy case field.
