-- R09 Settlement + Write-Off + Credit Note + Adjustments.
-- Apply after 20260816_hardship_negotiation.sql.
--
-- Adjustments post to the existing financial ledger. They never create or
-- mutate payment rows, so recovered-cash reporting remains payment-only.

begin;

alter table public.cases
  add column if not exists closure_reason_code text,
  add constraint cases_closure_reason_code_check check (
    closure_reason_code is null or closure_reason_code in (
      'paid_in_full','settled','written_off','dispute_resolved','cancelled',
      'duplicate','professional_handoff','other'
    )
  );

create table if not exists public.financial_adjustments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  case_id text not null references public.cases(id) on delete restrict,
  obligation_id uuid references public.obligations(id) on delete restrict,
  adjustment_type text not null check (adjustment_type in (
    'credit_note','settlement_adjustment','write_off','manual_correction',
    'returned_goods','commercial_discount','other'
  )),
  direction text not null check (direction in ('credit','debit')),
  amount_minor bigint not null check (amount_minor > 0),
  reason text not null check (nullif(btrim(reason),'') is not null and char_length(reason)<=1000),
  reference text check (char_length(reference)<=160),
  old_amount_minor bigint,
  new_amount_minor bigint,
  approval_status text not null check (approval_status in ('pending','approved','rejected')),
  required_approver_role text not null default 'owner' check (required_approver_role in ('owner','manager')),
  requested_by uuid not null references auth.users(id) on delete restrict,
  approved_by uuid references auth.users(id) on delete restrict,
  approved_at timestamptz,
  rejected_by uuid references auth.users(id) on delete restrict,
  rejected_at timestamptz,
  rejection_reason text,
  financial_event_id uuid unique references public.case_financial_events(id) on delete restrict,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id,idempotency_key),
  check (
    adjustment_type<>'manual_correction'
    or (old_amount_minor is not null and new_amount_minor is not null and old_amount_minor<>new_amount_minor)
  ),
  check (
    (approval_status='approved' and approved_by is not null and approved_at is not null and rejected_by is null and rejected_at is null)
    or (approval_status='rejected' and rejected_by is not null and rejected_at is not null and approved_by is null and approved_at is null)
    or (approval_status='pending' and approved_by is null and approved_at is null and rejected_by is null and rejected_at is null)
  )
);
create index if not exists financial_adjustments_case_timeline_idx
  on public.financial_adjustments(case_id,created_at,id);
create index if not exists financial_adjustments_pending_idx
  on public.financial_adjustments(business_id,created_at)
  where approval_status='pending';

create table if not exists public.financial_adjustment_events (
  id uuid primary key default gen_random_uuid(),
  adjustment_id uuid not null references public.financial_adjustments(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  case_id text not null references public.cases(id) on delete restrict,
  event_type text not null check (event_type in ('requested','approved','rejected','posted')),
  actor_id uuid references auth.users(id) on delete set null,
  actor_role text not null check (actor_role in ('owner','manager','system')),
  note text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now()
);
create index if not exists financial_adjustment_events_timeline_idx
  on public.financial_adjustment_events(case_id,created_at,id);

alter table public.financial_adjustments enable row level security;
alter table public.financial_adjustment_events enable row level security;
create policy "financial_adjustments_owner_read" on public.financial_adjustments
  for select to authenticated using (business_id=public.my_business_id());
create policy "financial_adjustment_events_owner_read" on public.financial_adjustment_events
  for select to authenticated using (business_id=public.my_business_id());

create or replace function public.prevent_direct_closure_reason_update()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if current_setting('collectboss.lifecycle_transition',true) is distinct from 'on'
    and new.closure_reason_code is distinct from old.closure_reason_code then
    raise exception 'Use the controlled case closure service';
  end if;
  return new;
end;
$$;
create trigger cases_prevent_direct_closure_reason_update
before update of closure_reason_code on public.cases
for each row execute function public.prevent_direct_closure_reason_update();

create or replace function public.financial_adjustment_assert_owner(p_adjustment_id uuid)
returns public.financial_adjustments language plpgsql security definer set search_path=public,pg_temp as $$
declare v_adjustment public.financial_adjustments;
begin
  select a.* into v_adjustment from public.financial_adjustments a
  join public.businesses b on b.id=a.business_id
  where a.id=p_adjustment_id and b.owner_id=auth.uid()
  for update of a;
  if not found then raise exception 'Adjustment not found'; end if;
  return v_adjustment;
end;
$$;

create or replace function public.financial_adjustment_post(p_adjustment_id uuid)
returns public.financial_adjustments language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_adjustment public.financial_adjustments;
  v_case public.cases;
  v_event_id uuid;
  v_linked_count integer;
  v_obligation public.obligations;
  v_remaining bigint;
  v_apply bigint;
begin
  select * into v_adjustment from public.financial_adjustments where id=p_adjustment_id for update;
  if not found then raise exception 'Adjustment not found'; end if;
  if v_adjustment.approval_status<>'approved' then raise exception 'Only approved adjustments can post'; end if;
  if v_adjustment.financial_event_id is not null then return v_adjustment; end if;
  select * into v_case from public.cases where id=v_adjustment.case_id for update;
  if not found or v_case.archived_at is not null or v_case.status='closed' then
    raise exception 'Closed or archived cases cannot receive adjustments';
  end if;
  if v_adjustment.direction='credit' and v_adjustment.amount_minor>v_case.outstanding_minor then
    raise exception 'Credit adjustment exceeds the current outstanding balance';
  end if;

  select count(*) into v_linked_count from public.recovery_case_obligations
  where case_id=v_case.id;
  if v_adjustment.obligation_id is not null then
    select o.* into v_obligation from public.obligations o
    join public.recovery_case_obligations rco on rco.obligation_id=o.id
    where o.id=v_adjustment.obligation_id and rco.case_id=v_case.id
      and o.business_id=v_adjustment.business_id for update of o;
    if not found then raise exception 'Adjustment obligation is outside the recovery case'; end if;
    if v_adjustment.direction='credit' and v_adjustment.amount_minor>v_obligation.outstanding_minor then
      raise exception 'Credit adjustment exceeds the obligation outstanding balance';
    end if;
    perform set_config('collectboss.receivables_sync','on',true);
    update public.obligations set
      adjustments_minor=adjustments_minor+
        case when v_adjustment.direction='credit' then -v_adjustment.amount_minor else v_adjustment.amount_minor end,
      status=case when v_adjustment.adjustment_type='write_off'
        and v_adjustment.amount_minor=v_obligation.outstanding_minor then 'written_off' else status end
    where id=v_obligation.id;
  elsif v_linked_count=1 then
    select o.* into v_obligation from public.obligations o
    join public.recovery_case_obligations rco on rco.obligation_id=o.id
    where rco.case_id=v_case.id for update of o;
    perform set_config('collectboss.receivables_sync','on',true);
    update public.obligations set
      adjustments_minor=adjustments_minor+
        case when v_adjustment.direction='credit' then -v_adjustment.amount_minor else v_adjustment.amount_minor end,
      status=case when v_adjustment.adjustment_type='write_off'
        and v_adjustment.amount_minor=v_obligation.outstanding_minor then 'written_off' else status end
    where id=v_obligation.id;
  elsif v_linked_count>1 then
    if v_adjustment.direction='debit' or v_adjustment.adjustment_type='manual_correction' then
      raise exception 'Choose an obligation for a multi-obligation debit or manual correction';
    end if;
    v_remaining:=v_adjustment.amount_minor;
    perform set_config('collectboss.receivables_sync','on',true);
    for v_obligation in
      select o.* from public.obligations o
      join public.recovery_case_obligations rco on rco.obligation_id=o.id
      where rco.case_id=v_case.id and o.outstanding_minor>0
      order by o.due_date,o.created_at,o.id for update of o
    loop
      exit when v_remaining=0;
      v_apply:=least(v_remaining,v_obligation.outstanding_minor);
      update public.obligations set adjustments_minor=adjustments_minor-v_apply,
        status=case when v_adjustment.adjustment_type='write_off' and v_apply=v_obligation.outstanding_minor
          then 'written_off' else status end
      where id=v_obligation.id;
      v_remaining:=v_remaining-v_apply;
    end loop;
    if v_remaining<>0 then raise exception 'Adjustment could not be allocated across obligations'; end if;
  end if;

  insert into public.case_financial_events(
    case_id,event_type,amount_minor,source_table,source_id,idempotency_key,note,created_by
  ) values (
    v_adjustment.case_id,
    case when v_adjustment.direction='credit' then 'adjustment_credit' else 'adjustment_debit' end,
    v_adjustment.amount_minor,'financial_adjustments',v_adjustment.id,
    v_adjustment.idempotency_key,
    concat(replace(v_adjustment.adjustment_type,'_',' '),': ',v_adjustment.reason),
    v_adjustment.approved_by
  ) returning id into v_event_id;
  update public.financial_adjustments set financial_event_id=v_event_id,updated_at=now()
    where id=v_adjustment.id returning * into v_adjustment;
  perform public.financial_recalculate_case(v_adjustment.case_id);
  insert into public.financial_adjustment_events(
    adjustment_id,business_id,case_id,event_type,actor_id,actor_role,metadata
  ) values (
    v_adjustment.id,v_adjustment.business_id,v_adjustment.case_id,'posted',
    v_adjustment.approved_by,'system',jsonb_build_object('financial_event_id',v_event_id)
  );
  return v_adjustment;
end;
$$;

create or replace function public.financial_create_adjustment(
  p_case_id text,
  p_obligation_id uuid,
  p_adjustment_type text,
  p_direction text,
  p_amount_minor bigint,
  p_new_amount_minor bigint,
  p_reason text,
  p_reference text default null,
  p_idempotency_key uuid default gen_random_uuid()
) returns public.financial_adjustments language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_case public.cases;
  v_adjustment public.financial_adjustments;
  v_old_amount bigint;
  v_effective_amount bigint;
  v_effective_direction text;
begin
  v_case:=public.financial_assert_case_owner(p_case_id);
  if v_case.status='closed' then raise exception 'Closed cases cannot receive adjustments'; end if;
  if p_adjustment_type not in (
    'credit_note','settlement_adjustment','write_off','manual_correction',
    'returned_goods','commercial_discount','other'
  ) or p_direction not in ('credit','debit') then raise exception 'Unsupported adjustment type or direction'; end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null or char_length(p_reason)>1000
    or char_length(coalesce(p_reference,''))>160 then raise exception 'A valid adjustment reason is required'; end if;
  if p_adjustment_type<>'manual_correction' and p_amount_minor<=0 then
    raise exception 'Adjustment amount must be positive';
  end if;

  if p_adjustment_type='manual_correction' then
    if p_obligation_id is null then
      if exists (select 1 from public.recovery_case_obligations where case_id=p_case_id) then
        raise exception 'Choose an obligation for a linked manual correction';
      end if;
      v_old_amount:=v_case.contractual_due_minor;
    else
      select o.contractual_due_minor into v_old_amount from public.obligations o
      join public.recovery_case_obligations rco on rco.obligation_id=o.id
      where o.id=p_obligation_id and rco.case_id=p_case_id and o.business_id=v_case.business_id;
      if not found then raise exception 'Adjustment obligation is outside the recovery case'; end if;
    end if;
    if p_new_amount_minor is null or p_new_amount_minor<0 or p_new_amount_minor=v_old_amount then
      raise exception 'Manual correction requires a different non-negative new amount';
    end if;
    v_effective_amount:=abs(p_new_amount_minor-v_old_amount);
    v_effective_direction:=case when p_new_amount_minor<v_old_amount then 'credit' else 'debit' end;
  else
    v_old_amount:=null;
    v_effective_amount:=p_amount_minor;
    v_effective_direction:=p_direction;
  end if;

  select * into v_adjustment from public.financial_adjustments
  where business_id=v_case.business_id and idempotency_key=p_idempotency_key;
  if found then return v_adjustment; end if;
  insert into public.financial_adjustments(
    business_id,case_id,obligation_id,adjustment_type,direction,amount_minor,reason,
    reference,old_amount_minor,new_amount_minor,approval_status,required_approver_role,
    requested_by,approved_by,approved_at,idempotency_key
  ) values (
    v_case.business_id,v_case.id,p_obligation_id,p_adjustment_type,v_effective_direction,
    v_effective_amount,btrim(p_reason),nullif(btrim(p_reference),''),
    v_old_amount,case when p_adjustment_type='manual_correction' then p_new_amount_minor else null end,
    case when p_adjustment_type='write_off' then 'pending' else 'approved' end,
    'owner',auth.uid(),
    case when p_adjustment_type='write_off' then null else auth.uid() end,
    case when p_adjustment_type='write_off' then null else now() end,
    p_idempotency_key
  ) returning * into v_adjustment;
  insert into public.financial_adjustment_events(
    adjustment_id,business_id,case_id,event_type,actor_id,actor_role,note
  ) values (
    v_adjustment.id,v_adjustment.business_id,v_adjustment.case_id,'requested',
    auth.uid(),'owner',v_adjustment.reason
  );
  if v_adjustment.approval_status='approved' then
    insert into public.financial_adjustment_events(
      adjustment_id,business_id,case_id,event_type,actor_id,actor_role
    ) values (v_adjustment.id,v_adjustment.business_id,v_adjustment.case_id,'approved',auth.uid(),'owner');
    v_adjustment:=public.financial_adjustment_post(v_adjustment.id);
  end if;
  insert into public.audit_logs(business_id,case_id,action,actor_type,actor_id,metadata)
  values (
    v_case.business_id,v_case.id,'financial_adjustment.requested','owner',auth.uid(),
    jsonb_build_object('adjustment_id',v_adjustment.id,'adjustment_type',p_adjustment_type,
      'direction',v_effective_direction,'amount_minor',v_effective_amount,
      'approval_status',v_adjustment.approval_status,'old_amount_minor',v_old_amount,
      'new_amount_minor',p_new_amount_minor)
  );
  return v_adjustment;
end;
$$;

create or replace function public.financial_review_write_off(
  p_adjustment_id uuid,
  p_decision text,
  p_reason text default null
) returns public.financial_adjustments language plpgsql security definer set search_path=public,pg_temp as $$
declare v_adjustment public.financial_adjustments;
begin
  v_adjustment:=public.financial_adjustment_assert_owner(p_adjustment_id);
  if v_adjustment.adjustment_type<>'write_off' then raise exception 'Only write-offs use this approval workflow'; end if;
  if v_adjustment.approval_status<>'pending' then
    if v_adjustment.approval_status=p_decision then return v_adjustment; end if;
    raise exception 'Write-off has already been reviewed';
  end if;
  if p_decision not in ('approved','rejected') then raise exception 'Unsupported write-off decision'; end if;
  if p_decision='rejected' and nullif(btrim(coalesce(p_reason,'')),'') is null then
    raise exception 'A rejection reason is required';
  end if;
  update public.financial_adjustments set approval_status=p_decision,
    approved_by=case when p_decision='approved' then auth.uid() else null end,
    approved_at=case when p_decision='approved' then now() else null end,
    rejected_by=case when p_decision='rejected' then auth.uid() else null end,
    rejected_at=case when p_decision='rejected' then now() else null end,
    rejection_reason=case when p_decision='rejected' then btrim(p_reason) else null end,
    updated_at=now()
  where id=v_adjustment.id returning * into v_adjustment;
  insert into public.financial_adjustment_events(
    adjustment_id,business_id,case_id,event_type,actor_id,actor_role,note
  ) values (
    v_adjustment.id,v_adjustment.business_id,v_adjustment.case_id,p_decision,
    auth.uid(),'owner',case when p_decision='rejected' then btrim(p_reason) else null end
  );
  insert into public.audit_logs(business_id,case_id,action,actor_type,actor_id,metadata)
  values (
    v_adjustment.business_id,v_adjustment.case_id,'write_off.'||p_decision,'owner',auth.uid(),
    jsonb_build_object('adjustment_id',v_adjustment.id,'amount_minor',v_adjustment.amount_minor,
      'reason',p_reason,'required_approver_role',v_adjustment.required_approver_role)
  );
  if p_decision='approved' then v_adjustment:=public.financial_adjustment_post(v_adjustment.id); end if;
  return v_adjustment;
end;
$$;

create or replace function public.financial_settle_case(
  p_case_id text,
  p_payment_minor bigint,
  p_payment_method text,
  p_reference_no text,
  p_reason text,
  p_idempotency_key uuid default gen_random_uuid()
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_case public.cases;
  v_payment public.payments;
  v_adjustment public.financial_adjustments;
begin
  v_case:=public.financial_assert_case_owner(p_case_id);
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'A settlement reason is required'; end if;
  if p_payment_minor<0 or p_payment_minor>v_case.outstanding_minor then raise exception 'Invalid settlement payment amount'; end if;
  if p_payment_minor>0 then
    v_payment:=public.financial_create_owner_payment(
      p_case_id,p_payment_minor,p_payment_method,p_reference_no,null,
      'Settlement cash component',true
    );
  end if;
  select * into v_case from public.cases where id=p_case_id for update;
  if v_case.outstanding_minor>0 then
    v_adjustment:=public.financial_create_adjustment(
      p_case_id,null,'settlement_adjustment','credit',v_case.outstanding_minor,null,
      p_reason,p_reference_no,p_idempotency_key
    );
  end if;
  select * into v_case from public.cases where id=p_case_id;
  if v_case.outstanding_minor<>0 then raise exception 'Settlement did not resolve the final balance'; end if;
  return jsonb_build_object(
    'case_id',p_case_id,'payment_id',case when v_payment.id is null then null else v_payment.id end,
    'adjustment_id',case when v_adjustment.id is null then null else v_adjustment.id end,
    'cash_minor',p_payment_minor,'settlement_adjustment_minor',
      case when v_adjustment.id is null then 0 else v_adjustment.amount_minor end,
    'outstanding_minor',v_case.outstanding_minor
  );
end;
$$;

create or replace function public.financial_close_case(
  p_case_id text,
  p_reason_code text,
  p_note text,
  p_expected_version integer default null
) returns public.cases language plpgsql security definer set search_path=public,pg_temp as $$
declare v_case public.cases; v_previous text;
begin
  v_case:=public.financial_assert_case_owner(p_case_id);
  if p_reason_code not in (
    'paid_in_full','settled','written_off','dispute_resolved','cancelled',
    'duplicate','professional_handoff','other'
  ) then raise exception 'Unsupported closure reason'; end if;
  if p_expected_version is not null and p_expected_version<>v_case.status_version then
    raise exception 'Case changed; reload and try again';
  end if;
  if p_reason_code in ('paid_in_full','settled','written_off','dispute_resolved')
    and v_case.outstanding_minor<>0 then raise exception 'This closure reason requires a zero balance'; end if;
  if p_reason_code='paid_in_full' and v_case.approved_payment_minor<v_case.contractual_due_minor then
    raise exception 'Paid in full requires approved cash covering the contractual due';
  end if;
  if p_reason_code='settled' and not exists (
    select 1 from public.financial_adjustments where case_id=p_case_id
      and adjustment_type='settlement_adjustment' and approval_status='approved'
  ) then raise exception 'Settled closure requires an approved settlement adjustment'; end if;
  if p_reason_code='written_off' and not exists (
    select 1 from public.financial_adjustments where case_id=p_case_id
      and adjustment_type='write_off' and approval_status='approved'
  ) then raise exception 'Written-off closure requires an approved write-off'; end if;
  if exists (select 1 from public.payment_plans where case_id=p_case_id and status in ('active','defaulted')) then
    raise exception 'Resolve the active payment plan before closing the case';
  end if;
  if p_reason_code in ('cancelled','duplicate','professional_handoff','other')
    and nullif(btrim(coalesce(p_note,'')),'') is null then raise exception 'A closure note is required'; end if;
  v_previous:=v_case.status;
  perform set_config('collectboss.lifecycle_transition','on',true);
  update public.cases set status='closed',closed_at=now(),closed_by=auth.uid(),
    closure_reason_code=p_reason_code,close_reason=nullif(btrim(p_note),''),
    promise_due_date=null,status_version=status_version+1,updated_at=now()
  where id=p_case_id returning * into v_case;
  insert into public.case_status_history(
    case_id,from_status,to_status,transition_reason,actor_id,actor_type
  ) values (
    p_case_id,v_previous,'closed',
    concat(replace(p_reason_code,'_',' '),case when nullif(btrim(coalesce(p_note,'')),'') is null
      then '' else ': '||btrim(p_note) end),auth.uid(),'owner'
  );
  insert into public.audit_logs(business_id,case_id,action,actor_type,actor_id,metadata)
  values (
    v_case.business_id,p_case_id,'case.closed','owner',auth.uid(),
    jsonb_build_object('closure_reason',p_reason_code,'note',p_note,
      'outstanding_minor',v_case.outstanding_minor)
  );
  return v_case;
end;
$$;

create or replace function public.financial_adjustments_protect()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if old.financial_event_id is not null then
    raise exception 'Posted adjustments are immutable';
  end if;
  if new.business_id is distinct from old.business_id or new.case_id is distinct from old.case_id
    or new.obligation_id is distinct from old.obligation_id
    or new.adjustment_type is distinct from old.adjustment_type
    or new.direction is distinct from old.direction or new.amount_minor is distinct from old.amount_minor
    or new.reason is distinct from old.reason or new.old_amount_minor is distinct from old.old_amount_minor
    or new.new_amount_minor is distinct from old.new_amount_minor
    or new.requested_by is distinct from old.requested_by
    or new.idempotency_key is distinct from old.idempotency_key then
    raise exception 'Adjustment terms are immutable';
  end if;
  return new;
end;
$$;
create trigger financial_adjustments_protect_trigger
before update on public.financial_adjustments
for each row execute function public.financial_adjustments_protect();

revoke all on function public.financial_create_adjustment(text,uuid,text,text,bigint,bigint,text,text,uuid) from public;
grant execute on function public.financial_create_adjustment(text,uuid,text,text,bigint,bigint,text,text,uuid) to authenticated;
revoke all on function public.financial_review_write_off(uuid,text,text) from public;
grant execute on function public.financial_review_write_off(uuid,text,text) to authenticated;
revoke all on function public.financial_settle_case(text,bigint,text,text,text,uuid) from public;
grant execute on function public.financial_settle_case(text,bigint,text,text,text,uuid) to authenticated;
revoke all on function public.financial_close_case(text,text,text,integer) from public;
grant execute on function public.financial_close_case(text,text,text,integer) to authenticated;
revoke all on function public.financial_adjustment_post(uuid) from public;
revoke all on function public.financial_adjustment_assert_owner(uuid) from public;

commit;

-- Rollback: disable adjustment and closure endpoints first. Once adjustments
-- have posted, preserve adjustment/audit rows and reverse through compensating
-- ledger events; do not drop data or rewrite historical payments. Before first
-- production use only, drop RPCs/triggers/policies/tables and closure_reason_code.
