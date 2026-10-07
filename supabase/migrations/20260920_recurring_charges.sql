-- Recurring charges: "rent of RM1,500 due on the 1st of every month".
--
-- A schedule belongs to an ongoing customer account. The hourly domain-event
-- job calls recurring_charges_generate(), which creates one obligation per
-- period with a deterministic reference (e.g. RENT-2026-10). The obligations
-- unique key (business, customer, account, reference) makes generation
-- idempotent, so retries and catch-up runs never duplicate a charge.
-- Generated obligations then flow through the existing overdue detection,
-- Action Centre and reminder pipeline.
--
-- Review before applying. Safe to re-run.

begin;

create table if not exists public.recurring_charges (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_id uuid not null references public.debtors(id) on delete restrict,
  account_id uuid not null,
  label text not null,
  reference_prefix text not null,
  obligation_type text not null default 'invoice'
    check (obligation_type in ('invoice','general_obligation','rent','vehicle','property','project','supplier','catering_event','other')),
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  day_of_month smallint not null check (day_of_month between 1 and 28),
  due_days smallint not null default 0 check (due_days between 0 and 60),
  start_date date not null,
  end_date date,
  next_run_date date not null,
  last_generated_period text,
  status text not null default 'active' check (status in ('active','paused','ended')),
  last_error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recurring_charges_label_check check (nullif(btrim(label), '') is not null),
  constraint recurring_charges_prefix_check check (reference_prefix ~ '^[A-Z0-9][A-Z0-9-]{0,23}$'),
  constraint recurring_charges_dates_check check (end_date is null or end_date >= start_date),
  constraint recurring_charges_account_fk foreign key (account_id, business_id, customer_id)
    references public.customer_accounts(id, business_id, customer_id) on delete restrict
);

create index if not exists recurring_charges_due_idx
  on public.recurring_charges (next_run_date) where status = 'active';
create index if not exists recurring_charges_account_idx
  on public.recurring_charges (business_id, account_id);

alter table public.recurring_charges enable row level security;
drop policy if exists "recurring_charges: tenant read" on public.recurring_charges;
create policy "recurring_charges: tenant read" on public.recurring_charges
  for select to authenticated using (has_business_permission(business_id, 'case.read'));
-- Writes go through the reviewed API route with the service role.
revoke insert, update, delete on public.recurring_charges from anon, authenticated;
grant select on public.recurring_charges to authenticated;
grant all on public.recurring_charges to service_role;

create or replace function public.recurring_charges_generate(p_today date default null, p_limit integer default 500)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_today date := coalesce(p_today, (now() at time zone 'Asia/Kuala_Lumpur')::date);
  v_charge public.recurring_charges;
  v_period date;
  v_reference text;
  v_created integer := 0;
  v_failed integer := 0;
  v_iterations integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'service role required'; end if;
  for v_charge in
    select * from public.recurring_charges
    where status = 'active' and next_run_date <= v_today
    order by next_run_date
    limit greatest(1, least(coalesce(p_limit, 500), 2000))
    for update skip locked
  loop
    begin
      v_period := v_charge.next_run_date;
      v_iterations := 0;
      -- Catch up at most 12 missed periods per run.
      while v_period <= v_today and v_iterations < 12
        and (v_charge.end_date is null or v_period <= v_charge.end_date) loop
        v_reference := v_charge.reference_prefix || '-' || to_char(v_period, 'YYYY-MM');
        insert into public.obligations(
          business_id, customer_id, account_id, obligation_type, reference, issue_date, due_date,
          currency, original_amount_minor, status, metadata)
        values (
          v_charge.business_id, v_charge.customer_id, v_charge.account_id, v_charge.obligation_type,
          v_reference, v_period, v_period + v_charge.due_days, v_charge.currency, v_charge.amount_minor, 'open',
          jsonb_build_object('recurring_charge_id', v_charge.id, 'period', to_char(v_period, 'YYYY-MM'), 'label', v_charge.label))
        on conflict (business_id, customer_id, account_id, reference) do nothing;
        if found then v_created := v_created + 1; end if;
        v_charge.last_generated_period := to_char(v_period, 'YYYY-MM');
        v_period := (date_trunc('month', v_period) + interval '1 month')::date + (v_charge.day_of_month - 1);
        v_iterations := v_iterations + 1;
      end loop;
      update public.recurring_charges set
        next_run_date = v_period,
        last_generated_period = v_charge.last_generated_period,
        status = case when end_date is not null and v_period > end_date then 'ended' else status end,
        last_error = null,
        updated_at = now()
      where id = v_charge.id;
    exception when others then
      v_failed := v_failed + 1;
      update public.recurring_charges set last_error = left(sqlerrm, 500), updated_at = now() where id = v_charge.id;
    end;
  end loop;
  return jsonb_build_object('created', v_created, 'failed', v_failed);
end $$;

revoke all on function public.recurring_charges_generate(date, integer) from public, anon, authenticated;
grant execute on function public.recurring_charges_generate(date, integer) to service_role;

commit;
