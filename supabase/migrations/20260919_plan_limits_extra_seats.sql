-- Plan limits and paid extra team seats.
--
-- 1. Free plan: 3 -> 10 active cases so new businesses can trial with real data.
-- 2. Paid plans can buy extra team seats (Stripe add-on price
--    STRIPE_PRICE_EXTRA_SEAT, RM10 per user per month). The Stripe webhook
--    passes the seat quantity; seats only apply while a paid subscription is
--    active or trialing and are added on top of the plan's team limit.
--
-- Review before applying. Safe to re-run.

begin;

update public.plans set case_limit = 10 where slug = 'free' and case_limit < 10;
update public.entitlements set case_limit = 10, updated_at = now()
where plan_slug = 'free' and case_limit between 0 and 9;
alter table public.plans alter column case_limit set default 10;
alter table public.entitlements alter column case_limit set default 10;

alter table public.subscriptions add column if not exists extra_seats integer not null default 0;
alter table public.entitlements add column if not exists extra_seats integer not null default 0;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'subscriptions_extra_seats_range') then
    alter table public.subscriptions add constraint subscriptions_extra_seats_range check (extra_seats between 0 and 100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'entitlements_extra_seats_range') then
    alter table public.entitlements add constraint entitlements_extra_seats_range check (extra_seats between 0 and 100);
  end if;
end $$;

drop function if exists public.billing_apply_subscription_state(uuid,text,text,text,text,text,timestamptz,timestamptz,boolean);

create or replace function public.billing_apply_subscription_state(
  p_business_id uuid,p_customer_id text,p_subscription_id text,p_price_id text,p_plan_slug text,p_status text,
  p_period_start timestamptz,p_period_end timestamptz,p_cancel_at_period_end boolean,p_extra_seats integer default 0) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_effective_slug text;v_plan record;v_seats integer;v_team_limit integer;begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'service role required';end if;
  if not exists(select 1 from public.businesses where id=p_business_id) then raise exception 'billing business not found';end if;
  if p_status not in('active','trialing','past_due','canceled','incomplete','incomplete_expired','unpaid','paused') then raise exception 'invalid subscription status';end if;
  if coalesce(p_extra_seats,0) not between 0 and 100 then raise exception 'invalid extra seat quantity';end if;
  v_effective_slug:=case when p_status in('active','trialing') then p_plan_slug else 'free' end;
  select * into v_plan from public.plans where slug=v_effective_slug;if not found then raise exception 'billing plan not found';end if;
  v_seats:=case when v_effective_slug<>'free' then coalesce(p_extra_seats,0) else 0 end;
  v_team_limit:=case when v_plan.team_member_limit=-1 then -1 else v_plan.team_member_limit+v_seats end;
  insert into public.subscriptions(business_id,stripe_customer_id,stripe_subscription_id,stripe_price_id,plan_slug,status,current_period_start,current_period_end,cancel_at_period_end,extra_seats)
  values(p_business_id,p_customer_id,p_subscription_id,p_price_id,p_plan_slug,p_status,p_period_start,p_period_end,p_cancel_at_period_end,coalesce(p_extra_seats,0))
  on conflict(business_id) do update set stripe_customer_id=excluded.stripe_customer_id,stripe_subscription_id=excluded.stripe_subscription_id,stripe_price_id=excluded.stripe_price_id,
    plan_slug=excluded.plan_slug,status=excluded.status,current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end,
    cancel_at_period_end=excluded.cancel_at_period_end,extra_seats=excluded.extra_seats,updated_at=now();
  insert into public.entitlements(business_id,plan_slug,case_limit,evidence_pack_limit,team_member_limit,extra_seats,payment_lock_enabled,formal_demand_enabled,lawyer_referral_enabled,reports_enabled)
  values(p_business_id,v_effective_slug,v_plan.case_limit,v_plan.evidence_pack_limit,v_team_limit,v_seats,v_plan.payment_lock_enabled,v_plan.formal_demand_enabled,v_plan.lawyer_referral_enabled,v_plan.reports_enabled)
  on conflict(business_id) do update set plan_slug=excluded.plan_slug,case_limit=excluded.case_limit,evidence_pack_limit=excluded.evidence_pack_limit,
    team_member_limit=excluded.team_member_limit,extra_seats=excluded.extra_seats,payment_lock_enabled=excluded.payment_lock_enabled,formal_demand_enabled=excluded.formal_demand_enabled,
    lawyer_referral_enabled=excluded.lawyer_referral_enabled,reports_enabled=excluded.reports_enabled,updated_at=now();
end $$;

revoke all on function public.billing_apply_subscription_state(uuid,text,text,text,text,text,timestamptz,timestamptz,boolean,integer) from public,anon,authenticated;
grant execute on function public.billing_apply_subscription_state(uuid,text,text,text,text,text,timestamptz,timestamptz,boolean,integer) to service_role;

commit;
