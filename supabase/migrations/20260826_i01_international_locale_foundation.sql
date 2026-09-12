-- I01: additive international locale, country and timezone foundation.
-- Existing financial values and timestamps are not rewritten. Existing businesses
-- retain the product's prior Malaysia behavior and record that derivation.

begin;

alter table public.businesses
  add column if not exists country_code text not null default 'MY',
  add column if not exists locale text not null default 'en-MY',
  add column if not exists default_currency text not null default 'MYR',
  add column if not exists date_format text not null default 'locale',
  add column if not exists number_format text not null default 'locale',
  add column if not exists language_code text not null default 'en',
  add column if not exists address_details jsonb not null default '{}'::jsonb,
  add column if not exists phone_e164 text,
  add column if not exists registration_identifiers jsonb not null default '[]'::jsonb,
  add column if not exists region_defaults_source text not null default 'application_default',
  add column if not exists region_defaults_determined_at timestamptz not null default now();

-- Every row present before I01 used Malaysia presentation and scheduler defaults.
-- Recording that fact is safer than guessing from free-form addresses or phones.
update public.businesses
set country_code = 'MY',
    locale = 'en-MY',
    timezone = 'Asia/Kuala_Lumpur',
    default_currency = 'MYR',
    date_format = 'locale',
    number_format = 'locale',
    language_code = 'en',
    region_defaults_source = 'legacy_malaysia_v1',
    region_defaults_determined_at = now()
where region_defaults_source = 'application_default';

update public.businesses
set registration_identifiers = jsonb_build_array(jsonb_build_object(
  'type', 'business_registration',
  'value', registration_no,
  'label', 'SSM registration number',
  'issuingCountry', 'MY'
))
where nullif(btrim(registration_no), '') is not null
  and registration_identifiers = '[]'::jsonb;

alter table public.businesses drop constraint if exists businesses_country_code_check;
alter table public.businesses add constraint businesses_country_code_check
  check (country_code ~ '^[A-Z]{2}$');
alter table public.businesses drop constraint if exists businesses_locale_check;
alter table public.businesses add constraint businesses_locale_check
  check (locale ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$');
alter table public.businesses drop constraint if exists businesses_default_currency_check;
alter table public.businesses add constraint businesses_default_currency_check
  check (default_currency ~ '^[A-Z]{3}$');
alter table public.businesses drop constraint if exists businesses_date_format_check;
alter table public.businesses add constraint businesses_date_format_check
  check (date_format in ('locale','day-month-year','month-day-year','year-month-day'));
alter table public.businesses drop constraint if exists businesses_number_format_check;
alter table public.businesses add constraint businesses_number_format_check
  check (number_format in ('locale','comma-decimal','dot-decimal'));
alter table public.businesses drop constraint if exists businesses_language_code_check;
alter table public.businesses add constraint businesses_language_code_check
  check (language_code ~ '^[a-z]{2,3}(-[A-Z]{2})?$');
alter table public.businesses drop constraint if exists businesses_timezone_check;
alter table public.businesses add constraint businesses_timezone_check
  check (timezone = 'UTC' or (char_length(timezone) between 3 and 64 and timezone like '%/%'));
alter table public.businesses drop constraint if exists businesses_address_details_check;
alter table public.businesses add constraint businesses_address_details_check
  check (jsonb_typeof(address_details) = 'object');
alter table public.businesses drop constraint if exists businesses_registration_identifiers_check;
alter table public.businesses add constraint businesses_registration_identifiers_check
  check (jsonb_typeof(registration_identifiers) = 'array');
alter table public.businesses drop constraint if exists businesses_phone_e164_check;
alter table public.businesses add constraint businesses_phone_e164_check
  check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$');

-- Historical plans keep their recorded timezone. New plans may use the owning
-- tenant's supported IANA timezone instead of being restricted to Kuala Lumpur.
alter table public.payment_plans drop constraint if exists payment_plans_timezone_check;
alter table public.payment_plans add constraint payment_plans_timezone_check
  check (timezone = 'UTC' or (char_length(timezone) between 3 and 64 and timezone like '%/%'));

-- Keep every plan-creation path aligned with its owning tenant. The trigger is
-- deliberately configuration-driven so later country adapters do not require a
-- payment-plan fork.
create or replace function public.payment_plan_apply_region_defaults()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_timezone text;
  v_currency text;
begin
  select b.timezone, coalesce(to_jsonb(c) ->> 'currency', b.default_currency) into v_timezone, v_currency
  from public.cases c
  join public.businesses b on b.id = c.business_id
  where c.id = new.case_id;
  if not found then raise exception 'Payment plan case was not found'; end if;
  new.timezone := v_timezone;
  if jsonb_typeof(new.terms_snapshot) = 'object' then
    new.terms_snapshot := new.terms_snapshot || jsonb_build_object(
      'timezone', v_timezone,
      'currency', v_currency
    );
  end if;
  return new;
end;
$$;

drop trigger if exists payment_plan_apply_region on public.payment_plans;
create trigger payment_plan_apply_region
before insert or update of case_id, timezone, terms_snapshot on public.payment_plans
for each row execute function public.payment_plan_apply_region_defaults();

-- Replace the legacy Malaysia-clock proposal implementation for already
-- deployed databases. The API remains backward compatible; only tenant-derived
-- timezone/currency defaults and local-date validation change.
create or replace function public.payment_plan_create_proposal(
  p_case_id text,
  p_frequency text,
  p_first_due_date date,
  p_installment_count integer,
  p_custom_due_dates jsonb default '[]'::jsonb,
  p_notes text default null
) returns public.payment_plans language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_case public.cases;
  v_plan public.payment_plans;
  v_timezone text;
  v_currency text;
  v_total_minor bigint;
  v_base_minor bigint;
  v_remainder_minor bigint;
  v_due_date date;
  v_previous_due_date date;
  v_due_dates jsonb := '[]'::jsonb;
  v_schedule jsonb := '[]'::jsonb;
  v_custom_value text;
  i integer;
begin
  if p_frequency not in ('weekly', 'monthly', 'custom') then raise exception 'Unsupported payment-plan frequency'; end if;
  if p_installment_count < 1 or p_installment_count > 24 then raise exception 'Installment count must be between 1 and 24'; end if;
  if char_length(coalesce(p_notes, '')) > 1000 then raise exception 'Plan notes are too long'; end if;

  select c.* into v_case
  from public.cases c join public.businesses b on b.id = c.business_id
  where c.id = p_case_id and b.owner_id = auth.uid()
  for update;
  if not found then raise exception 'Case not found'; end if;
  select b.timezone, coalesce(to_jsonb(c) ->> 'currency', b.default_currency) into v_timezone, v_currency
  from public.businesses b
  join public.cases c on c.business_id = b.id
  where c.id = v_case.id;
  if p_first_due_date < timezone(v_timezone, now())::date then raise exception 'First due date cannot be in the past'; end if;
  if v_case.archived_at is not null or v_case.status = 'closed' then raise exception 'Closed or archived cases cannot receive payment plans'; end if;
  v_total_minor := v_case.outstanding_minor;
  if v_total_minor <= 0 then raise exception 'A payment plan requires an outstanding case balance'; end if;
  if exists (select 1 from public.payment_plans p where p.case_id = p_case_id and p.status in ('pending_acceptance', 'active', 'defaulted')) then
    raise exception 'An open payment plan already exists for this case';
  end if;

  if p_frequency = 'custom' then
    if jsonb_typeof(p_custom_due_dates) <> 'array' or jsonb_array_length(p_custom_due_dates) <> p_installment_count then
      raise exception 'Custom plans require one due date for every installment';
    end if;
  elsif coalesce(jsonb_array_length(p_custom_due_dates), 0) <> 0 then
    raise exception 'Only custom plans may provide custom due dates';
  end if;

  v_base_minor := v_total_minor / p_installment_count;
  v_remainder_minor := v_total_minor % p_installment_count;
  insert into public.payment_plans (
    case_id, total_amount, installment_count, installment_amount, start_date,
    due_dates, status, debtor_confirmed, debtor_name, debtor_phone, signature_url,
    confirmed_at, notes, frequency, timezone, terms_version, terms_snapshot
  ) values (
    p_case_id, v_total_minor::numeric / 100, p_installment_count,
    v_base_minor::numeric / 100, p_first_due_date, '[]'::jsonb,
    'pending_acceptance', false, null, null, null, null, nullif(btrim(p_notes), ''),
    p_frequency, v_timezone, 1, jsonb_build_object('currency', v_currency, 'timezone', v_timezone)
  ) returning * into v_plan;

  for i in 1..p_installment_count loop
    if p_frequency = 'weekly' then
      v_due_date := p_first_due_date + ((i - 1) * 7);
    elsif p_frequency = 'monthly' then
      v_due_date := (p_first_due_date + make_interval(months => i - 1))::date;
    else
      v_custom_value := p_custom_due_dates ->> (i - 1);
      if v_custom_value !~ '^\\d{4}-\\d{2}-\\d{2}$' then raise exception 'Custom due dates must be ISO calendar dates'; end if;
      v_due_date := v_custom_value::date;
      if to_char(v_due_date, 'YYYY-MM-DD') <> v_custom_value then raise exception 'Custom due dates must be valid calendar dates'; end if;
      if i = 1 and v_due_date <> p_first_due_date then raise exception 'The first custom due date must match the first due date'; end if;
      if v_previous_due_date is not null and v_due_date <= v_previous_due_date then raise exception 'Custom due dates must be strictly increasing'; end if;
    end if;
    v_previous_due_date := v_due_date;
    insert into public.payment_plan_installments (payment_plan_id, sequence_no, due_date, amount_minor)
    values (v_plan.id, i, v_due_date, v_base_minor + case when i = p_installment_count then v_remainder_minor else 0 end);
    v_due_dates := v_due_dates || to_jsonb(to_char(v_due_date, 'YYYY-MM-DD'));
    v_schedule := v_schedule || jsonb_build_array(jsonb_build_object(
      'sequence', i,
      'due_date', to_char(v_due_date, 'YYYY-MM-DD'),
      'amount_minor', v_base_minor + case when i = p_installment_count then v_remainder_minor else 0 end
    ));
  end loop;

  update public.payment_plans set
    due_dates = v_due_dates,
    terms_snapshot = jsonb_build_object(
      'version', 1, 'currency', v_currency, 'timezone', v_timezone,
      'frequency', p_frequency, 'first_due_date', to_char(p_first_due_date, 'YYYY-MM-DD'),
      'total_minor', v_total_minor, 'schedule', v_schedule, 'notes', nullif(btrim(p_notes), '')
    )
  where id = v_plan.id returning * into v_plan;

  insert into public.audit_logs (business_id, case_id, action, actor_type, actor_id, metadata)
  values (v_case.business_id, v_case.id, 'payment_plan.proposed', 'owner', auth.uid(),
    jsonb_build_object('payment_plan_id', v_plan.id, 'terms_version', v_plan.terms_version));
  return v_plan;
end;
$$;

revoke all on function public.payment_plan_create_proposal(text,text,date,integer,jsonb,text) from public;
grant execute on function public.payment_plan_create_proposal(text,text,date,integer,jsonb,text) to authenticated, service_role;

-- The legacy compatibility scheduler remains callable, but an omitted as-of
-- date is now resolved independently for each tenant instead of once in MYT.
create or replace function public.payment_plan_run_scheduler(
  p_as_of_date date default null,
  p_due_soon_days integer default 3
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row record;
  v_business_date date;
  v_inserted uuid;
  v_due_soon integer := 0;
  v_due_today integer := 0;
  v_missed integer := 0;
  v_previous_status text;
  v_plan_defaulted integer := 0;
begin
  if p_due_soon_days < 1 or p_due_soon_days > 31 then
    raise exception 'Due-soon window must be between 1 and 31 days';
  end if;

  for v_row in
    select p.id as plan_id, p.case_id, c.business_id, c.status as case_status,
      p.status as plan_status, p.grace_days, i.id as installment_id,
      i.sequence_no, i.due_date, i.amount_minor, i.paid_minor, b.timezone
    from public.payment_plans p
    join public.cases c on c.id = p.case_id
    join public.businesses b on b.id = c.business_id
    join public.payment_plan_installments i on i.payment_plan_id = p.id
    where p.status in ('active', 'defaulted') and c.archived_at is null
      and c.status <> 'closed' and i.paid_minor < i.amount_minor
    order by i.due_date, i.sequence_no
    for update of p, c, i
  loop
    v_business_date := coalesce(p_as_of_date, timezone(v_row.timezone, now())::date);
    v_inserted := null;
    if v_row.due_date > v_business_date and v_row.due_date <= v_business_date + p_due_soon_days then
      insert into public.payment_plan_events(
        business_id, case_id, payment_plan_id, payment_plan_installment_id,
        event_type, event_date, amount_minor, paid_minor
      ) values (
        v_row.business_id, v_row.case_id, v_row.plan_id, v_row.installment_id,
        'due_soon', v_business_date, v_row.amount_minor, v_row.paid_minor
      ) on conflict do nothing returning id into v_inserted;
      if v_inserted is not null then v_due_soon := v_due_soon + 1; end if;
    elsif v_row.due_date = v_business_date then
      insert into public.payment_plan_events(
        business_id, case_id, payment_plan_id, payment_plan_installment_id,
        event_type, event_date, amount_minor, paid_minor
      ) values (
        v_row.business_id, v_row.case_id, v_row.plan_id, v_row.installment_id,
        'due_today', v_business_date, v_row.amount_minor, v_row.paid_minor
      ) on conflict do nothing returning id into v_inserted;
      if v_inserted is not null then v_due_today := v_due_today + 1; end if;
    elsif v_row.due_date + v_row.grace_days < v_business_date then
      insert into public.payment_plan_events(
        business_id, case_id, payment_plan_id, payment_plan_installment_id,
        event_type, event_date, amount_minor, paid_minor, metadata
      ) values (
        v_row.business_id, v_row.case_id, v_row.plan_id, v_row.installment_id,
        'missed', v_business_date, v_row.amount_minor, v_row.paid_minor,
        jsonb_build_object('due_date', v_row.due_date, 'sequence_no', v_row.sequence_no,
          'timezone', v_row.timezone)
      ) on conflict do nothing returning id into v_inserted;

      if v_inserted is not null then
        v_missed := v_missed + 1;
        update public.payment_plan_installments
          set status = case when paid_minor > 0 then 'partial' else 'overdue' end
          where id = v_row.installment_id;
        insert into public.notifications(
          business_id, case_id, type, title, message, entity_type, entity_id
        ) values (
          v_row.business_id, v_row.case_id, 'payment_plan.missed', 'Payment-plan installment missed',
          format('Installment %s is overdue.', v_row.sequence_no),
          'payment_plan_installment', v_row.installment_id
        );
        insert into public.action_centre_items(
          business_id, case_id, type, title, description, href, entity_type, entity_id
        ) values (
          v_row.business_id, v_row.case_id, 'payment_plan.missed', 'Follow up missed installment',
          format('Installment %s is overdue. Open the plan for localized amount and date details.', v_row.sequence_no),
          '/cases/' || v_row.case_id, 'payment_plan_installment', v_row.installment_id
        ) on conflict (type, entity_id) do nothing;
        insert into public.audit_logs(business_id, case_id, action, actor_type, metadata)
        values (v_row.business_id, v_row.case_id, 'payment_plan.installment_missed', 'system',
          jsonb_build_object('payment_plan_id', v_row.plan_id, 'installment_id', v_row.installment_id,
            'due_date', v_row.due_date, 'as_of_date', v_business_date, 'timezone', v_row.timezone));
      end if;

      if v_row.plan_status = 'active' then
        update public.payment_plans set status = 'defaulted' where id = v_row.plan_id and status = 'active';
        get diagnostics v_plan_defaulted = row_count;
        if v_plan_defaulted = 1 then
          select status into v_previous_status from public.cases where id = v_row.case_id;
          perform set_config('collectboss.lifecycle_transition', 'on', true);
          update public.cases set status = 'overdue', promise_due_date = null,
            status_version = status_version + 1, updated_at = now()
          where id = v_row.case_id and status <> 'overdue';
          if v_previous_status <> 'overdue' then
            insert into public.case_status_history(case_id, from_status, to_status, transition_reason, actor_type)
            values (v_row.case_id, v_previous_status, 'overdue', 'payment plan installment missed', 'system');
          end if;
        end if;
      end if;
    end if;
  end loop;

  return jsonb_build_object('due_soon', v_due_soon, 'due_today', v_due_today, 'missed', v_missed);
end;
$$;

create or replace function public.payment_plan_detect_missed(
  p_as_of_date date default null
) returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_result jsonb;
begin
  v_result := public.payment_plan_run_scheduler(p_as_of_date, 3);
  return coalesce((v_result ->> 'missed')::integer, 0);
end;
$$;

revoke all on function public.payment_plan_run_scheduler(date, integer) from public;
grant execute on function public.payment_plan_run_scheduler(date, integer) to service_role;
revoke all on function public.payment_plan_detect_missed(date) from public;
grant execute on function public.payment_plan_detect_missed(date) to service_role;

-- No RLS policy is broadened: these fields live on businesses and inherit the
-- existing owner/member read policy. Browser writes remain absent for members;
-- the application mutation requires settings.sensitive.manage.

commit;

-- Rollback: disable non-Malaysia/non-MYR writes and restore legacy presentation
-- adapters while retaining every stored country, locale, timezone and currency
-- value. Additive columns may remain unused. Never coerce existing monetary
-- records to MYR or reinterpret timestamps to make an old application run.
