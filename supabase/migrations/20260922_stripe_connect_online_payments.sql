-- Online debtor payments (FPX and card) through Stripe Connect.
--
-- Each business connects its own Stripe Standard account. Debtors pay with a
-- Checkout Session created as a direct charge on that account, so funds go
-- straight to the business and CollectBoss never holds them. A Stripe-confirmed
-- payment is recorded once, atomically, as a pending payment for the owner to
-- approve through the existing financial review path.
--
-- Review before applying. Safe to re-run.

begin;

create table if not exists public.business_payment_connections (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  provider text not null default 'stripe' check (provider = 'stripe'),
  stripe_account_id text not null unique check (stripe_account_id ~ '^acct_[A-Za-z0-9]+$'),
  charges_enabled boolean not null default false,
  payouts_enabled boolean not null default false,
  details_submitted boolean not null default false,
  disconnected_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.online_payment_sessions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  case_id text not null references public.cases(id) on delete cascade,
  stripe_account_id text not null,
  checkout_session_id text not null unique,
  payment_intent_id text,
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'open' check (status in ('open','paid','expired','failed')),
  payment_id uuid unique references public.payments(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists online_payment_sessions_case_idx on public.online_payment_sessions (case_id, created_at desc);

alter table public.business_payment_connections enable row level security;
alter table public.online_payment_sessions enable row level security;
drop policy if exists "business_payment_connections: tenant read" on public.business_payment_connections;
create policy "business_payment_connections: tenant read" on public.business_payment_connections
  for select to authenticated using (has_business_permission(business_id, 'case.read'));
drop policy if exists "online_payment_sessions: tenant read" on public.online_payment_sessions;
create policy "online_payment_sessions: tenant read" on public.online_payment_sessions
  for select to authenticated using (has_business_permission(business_id, 'case.read'));
revoke insert, update, delete on public.business_payment_connections, public.online_payment_sessions from anon, authenticated;
grant select on public.business_payment_connections, public.online_payment_sessions to authenticated;
grant all on public.business_payment_connections, public.online_payment_sessions to service_role;

-- Records a Stripe-confirmed payment exactly once per checkout session.
create or replace function public.online_payment_record(
  p_checkout_session_id text, p_stripe_account_id text, p_payment_intent_id text,
  p_amount_minor bigint, p_currency text, p_payment_method text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_session public.online_payment_sessions; v_payment_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'service role required'; end if;
  if p_payment_method not in ('online_fpx','online_card','online_other') then raise exception 'invalid online payment method'; end if;
  select * into v_session from public.online_payment_sessions where checkout_session_id = p_checkout_session_id for update;
  if not found then raise exception 'unknown checkout session'; end if;
  if v_session.stripe_account_id <> p_stripe_account_id then raise exception 'checkout account mismatch'; end if;
  if v_session.amount_minor <> p_amount_minor or v_session.currency <> upper(p_currency) then raise exception 'checkout amount mismatch'; end if;
  if v_session.payment_id is not null then return v_session.payment_id; end if;

  insert into public.payments(case_id, amount, amount_minor, currency, payment_method, reference_no, review_status, notes)
  values (v_session.case_id, v_session.amount_minor / 100.0, v_session.amount_minor, v_session.currency, p_payment_method,
    p_payment_intent_id, 'pending_review',
    'Paid online through Stripe and confirmed by Stripe. The money goes to your Stripe account; approve to update the balance.')
  returning id into v_payment_id;

  update public.online_payment_sessions set status = 'paid', payment_intent_id = p_payment_intent_id,
    payment_id = v_payment_id, updated_at = now() where id = v_session.id;
  return v_payment_id;
end $$;

revoke all on function public.online_payment_record(text, text, text, bigint, text, text) from public, anon, authenticated;
grant execute on function public.online_payment_record(text, text, text, bigint, text, text) to service_role;

commit;
