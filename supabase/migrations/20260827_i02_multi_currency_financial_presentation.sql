-- I02: Multi-currency financial integrity and presentation foundation.
-- Apply after 20260826_i01_international_locale_foundation.sql and the
-- Commercial V1 R20 release gate. No FX conversion path is introduced.

begin;

create or replace function public.currency_minor_units(p_currency text)
returns smallint language sql immutable strict set search_path = public, pg_temp as $$
  select case upper(p_currency)
    when 'BHD' then 3 when 'CLF' then 4 when 'CLP' then 0 when 'DJF' then 0
    when 'GNF' then 0 when 'IQD' then 3 when 'ISK' then 0 when 'JOD' then 3
    when 'JPY' then 0 when 'KMF' then 0 when 'KRW' then 0 when 'KWD' then 3
    when 'LYD' then 3 when 'OMR' then 3 when 'PYG' then 0 when 'RWF' then 0
    when 'TND' then 3 when 'UGX' then 0 when 'UYI' then 0 when 'UYW' then 4
    when 'VND' then 0 when 'VUV' then 0 when 'XAF' then 0 when 'XOF' then 0
    when 'XPF' then 0 else 2 end::smallint
$$;

create or replace function public.currency_minor_to_major(p_amount_minor bigint, p_currency text)
returns numeric language sql immutable strict set search_path = public, pg_temp as $$
  select p_amount_minor::numeric / power(10::numeric, public.currency_minor_units(upper(p_currency)))
$$;

create or replace function public.currency_major_to_minor(p_amount numeric, p_currency text)
returns bigint language plpgsql immutable strict set search_path = public, pg_temp as $$
declare scaled numeric;
begin
  if upper(p_currency) !~ '^[A-Z]{3}$' then raise exception 'Currency must be a three-letter ISO code'; end if;
  scaled := p_amount * power(10::numeric, public.currency_minor_units(upper(p_currency)));
  if scaled <> trunc(scaled) then raise exception 'Amount has too many decimal places for currency %', upper(p_currency); end if;
  return scaled::bigint;
end;
$$;

alter table public.cases alter column amount_owed type numeric(24,6), alter column amount_paid type numeric(24,6);
alter table public.payments alter column amount type numeric(24,6);
alter table public.public_payment_submissions alter column amount type numeric(24,6);
alter table public.payment_plans alter column total_amount type numeric(24,6), alter column installment_amount type numeric(24,6);

alter table public.cases add column if not exists currency char(3);
alter table public.case_financial_events add column if not exists currency char(3);
alter table public.payments add column if not exists amount_minor bigint, add column if not exists currency char(3);
alter table public.public_payment_submissions add column if not exists amount_minor bigint, add column if not exists currency char(3);
alter table public.payment_plans add column if not exists currency char(3);
alter table public.payment_plan_installments add column if not exists currency char(3);
alter table public.payment_plan_allocations add column if not exists currency char(3);
alter table public.payment_plan_events add column if not exists currency char(3);
alter table public.payment_promises add column if not exists currency char(3);
alter table public.payment_promise_allocations add column if not exists currency char(3);
alter table public.payment_promise_events add column if not exists currency char(3);
alter table public.payment_negotiation_revisions add column if not exists currency char(3);
alter table public.disputes add column if not exists currency char(3);
alter table public.financial_adjustments add column if not exists currency char(3);
alter table public.receiving_accounts add column if not exists currency char(3);
alter table public.action_centre_items add column if not exists currency char(3);

-- Existing financial rows were created under the Malaysia-only contract.
update public.cases set currency = 'MYR' where currency is null;
update public.case_financial_events e set currency = c.currency from public.cases c where c.id=e.case_id and e.currency is null;
update public.payments p set currency=c.currency, amount_minor=public.currency_major_to_minor(p.amount,c.currency) from public.cases c where c.id=p.case_id and (p.currency is null or p.amount_minor is null);
update public.public_payment_submissions s set currency=c.currency, amount_minor=public.currency_major_to_minor(s.amount,c.currency) from public.public_access_tokens t join public.cases c on c.id=t.case_id where t.id=s.public_access_token_id and (s.currency is null or s.amount_minor is null);
update public.payment_plans p set currency=c.currency from public.cases c where c.id=p.case_id and p.currency is null;
update public.payment_plan_installments i set currency=p.currency from public.payment_plans p where p.id=i.payment_plan_id and i.currency is null;
update public.payment_plan_allocations a set currency=p.currency from public.payment_plans p where p.id=a.payment_plan_id and a.currency is null;
update public.payment_plan_events e set currency=c.currency from public.cases c where c.id=e.case_id and e.currency is null;
update public.payment_promises p set currency=c.currency from public.cases c where c.id=p.case_id and p.currency is null;
update public.payment_promise_allocations a set currency=p.currency from public.payment_promises p where p.id=a.promise_id and a.currency is null;
update public.payment_promise_events e set currency=c.currency from public.cases c where c.id=e.case_id and e.currency is null;
update public.payment_negotiation_revisions r set currency=c.currency from public.cases c where c.id=r.case_id and r.currency is null;
update public.disputes d set currency=c.currency from public.cases c where c.id=d.case_id and d.currency is null;
update public.financial_adjustments a set currency=c.currency from public.cases c where c.id=a.case_id and a.currency is null;
update public.receiving_accounts r set currency=b.default_currency from public.businesses b where b.id=r.business_id and r.currency is null;
update public.action_centre_items a set currency=c.currency from public.cases c where c.id=a.case_id and a.currency is null;

alter table public.cases alter column currency set not null;
alter table public.case_financial_events alter column currency set not null;
alter table public.payments alter column amount_minor set not null, alter column currency set not null;
alter table public.public_payment_submissions alter column amount_minor set not null, alter column currency set not null;
alter table public.payment_plans alter column currency set not null;
alter table public.payment_plan_installments alter column currency set not null;
alter table public.payment_plan_allocations alter column currency set not null;
alter table public.payment_plan_events alter column currency set not null;
alter table public.payment_promises alter column currency set not null;
alter table public.payment_promise_allocations alter column currency set not null;
alter table public.payment_promise_events alter column currency set not null;
alter table public.payment_negotiation_revisions alter column currency set not null;
alter table public.disputes alter column currency set not null;
alter table public.financial_adjustments alter column currency set not null;
alter table public.receiving_accounts alter column currency set not null;

drop index if exists public.receiving_accounts_one_primary_per_business;
create unique index receiving_accounts_one_primary_per_business
  on public.receiving_accounts (business_id, currency) where is_primary;

do $$
declare table_name text;
begin
  foreach table_name in array array['cases','case_financial_events','payments','public_payment_submissions','payment_plans','payment_plan_installments','payment_plan_allocations','payment_plan_events','payment_promises','payment_promise_allocations','payment_promise_events','payment_negotiation_revisions','disputes','financial_adjustments','receiving_accounts','action_centre_items'] loop
    execute format('alter table public.%I drop constraint if exists %I', table_name, table_name||'_currency_check');
    execute format('alter table public.%I add constraint %I check (currency is null or currency ~ ''^[A-Z]{3}$'')', table_name, table_name||'_currency_check');
  end loop;
end;
$$;

alter table public.payments add constraint payments_amount_minor_positive_check check (amount_minor > 0);
alter table public.public_payment_submissions add constraint public_payment_submissions_amount_minor_positive_check check (amount_minor > 0);

create or replace function public.inherit_case_currency()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare expected char(3);
begin
  select currency into expected from public.cases where id=new.case_id;
  if expected is null then raise exception 'Related case currency is unavailable'; end if;
  if new.currency is null then new.currency:=expected;
  elsif new.currency<>expected then raise exception 'Currency % does not match case currency %',new.currency,expected; end if;
  return new;
end;
$$;

create or replace function public.inherit_plan_currency()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare expected char(3);
begin
  select currency into expected from public.payment_plans where id=new.payment_plan_id;
  if expected is null then raise exception 'Related payment plan currency is unavailable'; end if;
  if new.currency is null then new.currency:=expected;
  elsif new.currency<>expected then raise exception 'Currency % does not match payment plan currency %',new.currency,expected; end if;
  return new;
end;
$$;

create or replace function public.inherit_promise_currency()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare expected char(3);
begin
  select currency into expected from public.payment_promises where id=new.promise_id;
  if expected is null then raise exception 'Related payment promise currency is unavailable'; end if;
  if new.currency is null then new.currency:=expected;
  elsif new.currency<>expected then raise exception 'Currency % does not match payment promise currency %',new.currency,expected; end if;
  return new;
end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array['case_financial_events','payment_plans','payment_plan_events','payment_promises','payment_promise_events','payment_negotiation_revisions','disputes','financial_adjustments'] loop
    execute format('drop trigger if exists %I on public.%I', table_name||'_currency_guard', table_name);
    execute format('create trigger %I before insert or update of case_id,currency on public.%I for each row execute function public.inherit_case_currency()', table_name||'_currency_guard', table_name);
  end loop;
  foreach table_name in array array['payment_plan_installments','payment_plan_allocations'] loop
    execute format('drop trigger if exists %I on public.%I', table_name||'_currency_guard', table_name);
    execute format('create trigger %I before insert or update of payment_plan_id,currency on public.%I for each row execute function public.inherit_plan_currency()', table_name||'_currency_guard', table_name);
  end loop;
end;
$$;

drop trigger if exists payment_promise_allocations_currency_guard on public.payment_promise_allocations;
create trigger payment_promise_allocations_currency_guard before insert or update of promise_id,currency on public.payment_promise_allocations for each row execute function public.inherit_promise_currency();

create or replace function public.payment_currency_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare expected char(3);
begin
  select currency into expected from public.cases where id=new.case_id;
  if expected is null then raise exception 'Related case currency is unavailable'; end if;
  if new.currency is null then new.currency:=expected;
  elsif new.currency<>expected then raise exception 'Payment currency % does not match obligation currency %',new.currency,expected; end if;
  if new.amount_minor is null then new.amount_minor:=public.currency_major_to_minor(new.amount,new.currency); end if;
  if new.amount_minor<=0 then raise exception 'Payment amount must be positive'; end if;
  new.amount:=public.currency_minor_to_major(new.amount_minor,new.currency);
  return new;
end;
$$;
drop trigger if exists payments_currency_guard on public.payments;
create trigger payments_currency_guard before insert or update of case_id,amount,amount_minor,currency on public.payments for each row execute function public.payment_currency_guard();

create or replace function public.public_submission_currency_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare expected char(3);
begin
  select c.currency into expected from public.public_access_tokens t join public.cases c on c.id=t.case_id where t.id=new.public_access_token_id;
  if expected is null then raise exception 'Related case currency is unavailable'; end if;
  if new.currency is null then new.currency:=expected;
  elsif new.currency<>expected then raise exception 'Payment currency % does not match obligation currency %',new.currency,expected; end if;
  if new.amount_minor is null then new.amount_minor:=public.currency_major_to_minor(new.amount,new.currency); end if;
  new.amount:=public.currency_minor_to_major(new.amount_minor,new.currency);
  return new;
end;
$$;
drop trigger if exists public_payment_submissions_currency_guard on public.public_payment_submissions;
create trigger public_payment_submissions_currency_guard before insert or update of public_access_token_id,amount,amount_minor,currency on public.public_payment_submissions for each row execute function public.public_submission_currency_guard();

create or replace function public.obligation_account_currency_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare expected char(3);
begin
  new.currency:=upper(new.currency);
  if new.account_id is not null then
    select currency into expected from public.customer_accounts where id=new.account_id and business_id=new.business_id and customer_id=new.customer_id;
    if expected is null then raise exception 'Related account currency is unavailable'; end if;
    if new.currency<>expected then raise exception 'Obligation currency % does not match account currency %',new.currency,expected; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists obligations_account_currency_guard on public.obligations;
create trigger obligations_account_currency_guard before insert or update of account_id,currency,business_id,customer_id on public.obligations for each row execute function public.obligation_account_currency_guard();

create or replace function public.recovery_link_currency_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare case_currency char(3); obligation_currency char(3);
begin
  select currency into case_currency from public.cases where id=new.case_id;
  select currency into obligation_currency from public.obligations where id=new.obligation_id;
  if case_currency is distinct from obligation_currency then raise exception 'Recovery case and obligation currencies must match'; end if;
  return new;
end;
$$;
drop trigger if exists recovery_case_obligations_currency_guard on public.recovery_case_obligations;
create trigger recovery_case_obligations_currency_guard before insert or update on public.recovery_case_obligations for each row execute function public.recovery_link_currency_guard();

create or replace function public.case_currency_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare account_currency char(3); receiving_currency char(3);
begin
  new.currency:=upper(coalesce(new.currency,'MYR'));
  if tg_op='UPDATE' and new.currency<>old.currency and (old.original_principal_minor<>0 or exists(select 1 from public.case_financial_events where case_id=old.id)) then
    raise exception 'A financial case currency is immutable';
  end if;
  if new.account_id is not null then
    select currency into account_currency from public.customer_accounts where id=new.account_id;
    if account_currency is not null and new.currency<>account_currency then raise exception 'Case currency does not match account currency'; end if;
  end if;
  if new.receiving_account_id is not null then
    select currency into receiving_currency from public.receiving_accounts where id=new.receiving_account_id and business_id=new.business_id;
    if receiving_currency is null or new.currency<>receiving_currency then raise exception 'Receiving account currency does not match case currency'; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists cases_currency_guard on public.cases;
create trigger cases_currency_guard before insert or update of currency,account_id,receiving_account_id on public.cases for each row execute function public.case_currency_guard();

create or replace function public.receiving_account_currency_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare tenant_currency char(3);
begin
  select default_currency into tenant_currency from public.businesses where id=new.business_id;
  if tenant_currency is null then raise exception 'Receiving account tenant currency is unavailable'; end if;
  new.currency:=upper(coalesce(new.currency,tenant_currency));
  if tg_op='UPDATE' and new.currency<>old.currency and exists(
    select 1 from public.cases where receiving_account_id=old.id
  ) then raise exception 'A receiving account currency cannot change while it is assigned to a case'; end if;
  return new;
end;
$$;
drop trigger if exists receiving_accounts_currency_guard on public.receiving_accounts;
create trigger receiving_accounts_currency_guard before insert or update of currency,business_id on public.receiving_accounts for each row execute function public.receiving_account_currency_guard();

create or replace function public.customer_account_currency_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.currency:=upper(new.currency);
  if tg_op='UPDATE' and new.currency<>old.currency and exists(
    select 1 from public.obligations where account_id=old.id and archived_at is null
  ) then raise exception 'An account currency cannot change while it has obligations'; end if;
  return new;
end;
$$;
drop trigger if exists customer_accounts_currency_guard on public.customer_accounts;
create trigger customer_accounts_currency_guard before insert or update of currency on public.customer_accounts for each row execute function public.customer_account_currency_guard();

create or replace function public.receiving_account_create_secure(
 p_actor_id uuid,p_business_id uuid,p_business_entity text,p_account_holder_name text,p_bank_name text,p_payment_method text,p_account_identifier text,p_duitnow_id text,p_include_in_reminders boolean,p_is_primary boolean,p_currency text default null
) returns setof public.receiving_accounts language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.receiving_accounts; selected_currency char(3);
begin
 if not exists(select 1 from public.businesses where id=p_business_id and owner_id=p_actor_id) then raise exception 'owner authorization failed'; end if;
 select upper(coalesce(p_currency,default_currency)) into selected_currency from public.businesses where id=p_business_id;
 if selected_currency !~ '^[A-Z]{3}$' then raise exception 'Currency must be a three-letter ISO code'; end if;
 if p_is_primary then update public.receiving_accounts set is_primary=false,updated_at=now(),updated_by=p_actor_id where business_id=p_business_id and currency=selected_currency and is_primary; end if;
 insert into public.receiving_accounts(business_id,business_entity,account_holder_name,bank_name,payment_method,account_number,masked_display,duitnow_id,include_in_reminders,is_primary,is_active,verification_status,created_by,updated_by,currency)
 values(p_business_id,btrim(p_business_entity),btrim(p_account_holder_name),btrim(p_bank_name),p_payment_method,btrim(p_account_identifier),public.receiving_account_mask(p_account_identifier),nullif(btrim(p_duitnow_id),''),p_include_in_reminders,p_is_primary,true,'pending',p_actor_id,p_actor_id,selected_currency) returning * into v;
 update public.receiving_accounts set approved_by=p_actor_id,approved_at=now() where id=v.id returning * into v;
 insert into public.audit_logs(business_id,action,actor_type,actor_id,metadata) values(p_business_id,'receiving_account.created','owner',p_actor_id,jsonb_build_object('account_id',v.id,'currency',v.currency,'after',jsonb_build_object('masked_display',v.masked_display,'bank_name',v.bank_name,'status',v.verification_status)));
 return next v;
end $$;

create or replace function public.receiving_account_update_secure(
 p_actor_id uuid,p_business_id uuid,p_account_id uuid,p_business_entity text default null,p_account_holder_name text default null,p_bank_name text default null,p_payment_method text default null,p_account_identifier text default null,p_duitnow_id text default null,p_include_in_reminders boolean default null,p_is_primary boolean default null,p_currency text default null
) returns setof public.receiving_accounts language plpgsql security definer set search_path=public,pg_temp as $$
declare v_old public.receiving_accounts; v_new public.receiving_accounts; sensitive boolean; selected_currency char(3);
begin
 if not exists(select 1 from public.businesses where id=p_business_id and owner_id=p_actor_id) then raise exception 'owner authorization failed'; end if;
 select * into v_old from public.receiving_accounts where id=p_account_id and business_id=p_business_id for update;
 if not found then raise exception 'receiving account not found'; end if;
 selected_currency:=upper(coalesce(p_currency,v_old.currency));
 if selected_currency !~ '^[A-Z]{3}$' then raise exception 'Currency must be a three-letter ISO code'; end if;
 sensitive:=(p_account_identifier is not null and btrim(p_account_identifier) is distinct from v_old.account_number) or (p_account_holder_name is not null and btrim(p_account_holder_name) is distinct from v_old.account_holder_name) or selected_currency is distinct from v_old.currency;
 if p_is_primary=true and (not v_old.is_active or v_old.verification_status in ('rejected','disabled')) then raise exception 'inactive or disabled accounts cannot be selected'; end if;
 if coalesce(p_is_primary,v_old.is_primary) then update public.receiving_accounts set is_primary=false,updated_at=now(),updated_by=p_actor_id where business_id=p_business_id and currency=selected_currency and id<>p_account_id and is_primary; end if;
 update public.receiving_accounts set currency=selected_currency,business_entity=coalesce(nullif(btrim(p_business_entity),''),business_entity),account_holder_name=coalesce(nullif(btrim(p_account_holder_name),''),account_holder_name),bank_name=coalesce(nullif(btrim(p_bank_name),''),bank_name),payment_method=coalesce(p_payment_method,payment_method),account_number=coalesce(nullif(btrim(p_account_identifier),''),account_number),masked_display=case when p_account_identifier is null then masked_display else public.receiving_account_mask(p_account_identifier) end,duitnow_id=case when p_duitnow_id is null then duitnow_id else nullif(btrim(p_duitnow_id),'') end,include_in_reminders=coalesce(p_include_in_reminders,include_in_reminders),is_primary=coalesce(p_is_primary,is_primary),verification_status=case when sensitive then 'pending' else verification_status end,approved_by=case when sensitive then p_actor_id else approved_by end,approved_at=case when sensitive then now() else approved_at end,updated_by=p_actor_id,updated_at=now(),version=version+1 where id=p_account_id returning * into v_new;
 insert into public.audit_logs(business_id,action,actor_type,actor_id,metadata) values(p_business_id,'receiving_account.updated','owner',p_actor_id,jsonb_build_object('account_id',p_account_id,'currency',v_new.currency,'before',jsonb_build_object('masked_display',v_old.masked_display,'bank_name',v_old.bank_name,'status',v_old.verification_status),'after',jsonb_build_object('masked_display',v_new.masked_display,'bank_name',v_new.bank_name,'status',v_new.verification_status)));
 return next v_new;
end $$;

revoke all on function public.receiving_account_create_secure(uuid,uuid,text,text,text,text,text,text,boolean,boolean,text) from public,anon,authenticated;
revoke all on function public.receiving_account_update_secure(uuid,uuid,uuid,text,text,text,text,text,text,boolean,boolean,text) from public,anon,authenticated;
grant execute on function public.receiving_account_create_secure(uuid,uuid,text,text,text,text,text,text,boolean,boolean,text) to service_role;
grant execute on function public.receiving_account_update_secure(uuid,uuid,uuid,text,text,text,text,text,text,boolean,boolean,text) to service_role;

create or replace function public.initialize_case_financial_fields()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare principal_minor bigint;
begin
  if new.amount_owed<=0 then raise exception 'Original principal must be positive'; end if;
  if new.amount_paid<>0 then raise exception 'New cases must not set amount_paid directly'; end if;
  new.currency:=upper(coalesce(new.currency,'MYR'));
  principal_minor:=public.currency_major_to_minor(new.amount_owed,new.currency);
  new.original_principal_minor:=principal_minor; new.contractual_due_minor:=principal_minor;
  new.approved_payment_minor:=0; new.outstanding_minor:=principal_minor; new.overpayment_minor:=0; new.financial_version:=0;
  return new;
end;
$$;

create or replace function public.financial_recalculate_case(p_case_id text)
returns public.cases language plpgsql security definer set search_path = public, pg_temp as $$
declare current_case public.cases; debit_minor bigint:=0; credit_minor bigint:=0; payment_minor bigint:=0; contractual_minor bigint; outstanding_value bigint; overpayment_value bigint; next_status text;
begin
  select * into current_case from public.cases where id=p_case_id for update;
  if not found then raise exception 'Case not found'; end if;
  if exists(select 1 from public.case_financial_events where case_id=p_case_id and currency<>current_case.currency) then raise exception 'Cross-currency financial event detected'; end if;
  select coalesce(sum(case when event_type='adjustment_debit' then amount_minor else 0 end),0), coalesce(sum(case when event_type='adjustment_credit' then amount_minor else 0 end),0), coalesce(sum(case when event_type in ('opening_payment_credit','payment_approved') then amount_minor when event_type='payment_reversal' then -amount_minor else 0 end),0)
    into debit_minor,credit_minor,payment_minor from public.case_financial_events where case_id=p_case_id;
  contractual_minor:=current_case.original_principal_minor+debit_minor-credit_minor;
  if contractual_minor<0 then raise exception 'Adjustment would reduce contractual due below zero'; end if;
  if payment_minor<0 then raise exception 'Payment reversals exceed approved payment credits'; end if;
  outstanding_value:=greatest(contractual_minor-payment_minor,0); overpayment_value:=greatest(payment_minor-contractual_minor,0);
  next_status:=case when contractual_minor>0 and outstanding_value=0 then 'paid' when payment_minor>0 and outstanding_value>0 then 'partial_paid' when current_case.status='paid' then 'action_needed' else current_case.status end;
  perform set_config('collectboss.financial_write','on',true); perform set_config('collectboss.lifecycle_transition','on',true);
  update public.cases set contractual_due_minor=contractual_minor,approved_payment_minor=payment_minor,outstanding_minor=outstanding_value,overpayment_minor=overpayment_value,
    amount_owed=public.currency_minor_to_major(contractual_minor,currency),amount_paid=public.currency_minor_to_major(least(payment_minor,contractual_minor),currency),status=next_status,
    status_version=case when next_status is distinct from current_case.status then status_version+1 else status_version end,financial_version=financial_version+1,updated_at=now()
    where id=p_case_id returning * into current_case;
  return current_case;
end;
$$;

create or replace function public.financial_create_owner_payment(p_case_id text,p_amount_minor bigint,p_payment_method text,p_reference_no text default null,p_proof_url text default null,p_notes text default null,p_approve boolean default false)
returns public.payments language plpgsql security definer set search_path = public, pg_temp as $$
declare current_case public.cases; payment_row public.payments; event_id uuid;
begin
  if p_amount_minor<=0 then raise exception 'Payment amount must be positive'; end if;
  if p_payment_method not in ('duitnow_qr','bank_transfer','cash','cheque','tng_ewallet') then raise exception 'Unsupported payment method'; end if;
  current_case:=public.financial_assert_case_owner(p_case_id);
  if current_case.status='closed' then raise exception 'Closed cases cannot receive payments'; end if;
  insert into public.payments(case_id,amount,amount_minor,currency,payment_method,reference_no,proof_url,review_status,reviewed_at,reviewed_by,notes)
  values(p_case_id,public.currency_minor_to_major(p_amount_minor,current_case.currency),p_amount_minor,current_case.currency,p_payment_method,nullif(btrim(p_reference_no),''),p_proof_url,case when p_approve then 'approved' else 'pending_review' end,case when p_approve then now() end,case when p_approve then auth.uid() end,nullif(btrim(p_notes),'')) returning * into payment_row;
  if p_approve then
    insert into public.case_financial_events(case_id,event_type,amount_minor,currency,source_table,source_id,note,created_by) values(p_case_id,'payment_approved',p_amount_minor,current_case.currency,'payments',payment_row.id,'Owner-recorded approved payment',auth.uid()) returning id into event_id;
    update public.payments set financial_event_id=event_id where id=payment_row.id returning * into payment_row; perform public.financial_recalculate_case(p_case_id);
  end if;
  insert into public.audit_logs(business_id,case_id,action,actor_type,actor_id,metadata) values(current_case.business_id,p_case_id,case when p_approve then 'payment.approved' else 'payment.recorded' end,'owner',auth.uid(),jsonb_build_object('payment_id',payment_row.id,'amount_minor',p_amount_minor,'currency',current_case.currency));
  return payment_row;
end;
$$;

create or replace function public.financial_review_payment(p_payment_id uuid,p_decision text)
returns public.payments language plpgsql security definer set search_path = public, pg_temp as $$
declare payment_row public.payments; current_case public.cases; event_id uuid;
begin
  if p_decision not in ('approved','rejected','unmatched') then raise exception 'Unsupported payment review decision'; end if;
  select * into payment_row from public.payments where id=p_payment_id for update;
  if not found then raise exception 'Payment not found'; end if;
  current_case:=public.financial_assert_case_owner(payment_row.case_id);
  if payment_row.currency<>current_case.currency then raise exception 'Payment currency does not match case currency'; end if;
  if payment_row.review_status<>'pending_review' then
    if payment_row.review_status=p_decision then return payment_row; end if;
    raise exception 'Payment has already been reviewed';
  end if;
  update public.payments set review_status=p_decision,reviewed_at=now(),reviewed_by=auth.uid() where id=p_payment_id returning * into payment_row;
  if p_decision='approved' then
    insert into public.case_financial_events(case_id,event_type,amount_minor,currency,source_table,source_id,note,created_by)
    values(payment_row.case_id,'payment_approved',payment_row.amount_minor,payment_row.currency,'payments',payment_row.id,'Approved payment review',auth.uid()) returning id into event_id;
    update public.payments set financial_event_id=event_id where id=payment_row.id returning * into payment_row;
    perform public.financial_recalculate_case(payment_row.case_id);
  end if;
  insert into public.audit_logs(business_id,case_id,action,actor_type,actor_id,metadata) values(current_case.business_id,payment_row.case_id,concat('payment.',p_decision),'owner',auth.uid(),jsonb_build_object('payment_id',payment_row.id,'amount_minor',payment_row.amount_minor,'currency',payment_row.currency));
  return payment_row;
end;
$$;

create or replace function public.financial_review_public_payment_submission(p_submission_id uuid,p_decision text)
returns public.public_payment_submissions language plpgsql security definer set search_path = public, pg_temp as $$
declare submission public.public_payment_submissions; current_case public.cases; event_id uuid;
begin
  if p_decision not in ('approved','rejected') then raise exception 'Unsupported submission review decision'; end if;
  select * into submission from public.public_payment_submissions where id=p_submission_id for update;
  if not found then raise exception 'Submission not found'; end if;
  select c.* into current_case from public.public_access_tokens t join public.cases c on c.id=t.case_id join public.businesses b on b.id=c.business_id where t.id=submission.public_access_token_id and b.owner_id=auth.uid() for update;
  if not found then raise exception 'Submission not found'; end if;
  if submission.currency<>current_case.currency then raise exception 'Payment currency does not match case currency'; end if;
  if submission.status<>'pending_review' then
    if submission.status::text=p_decision then return submission; end if;
    raise exception 'Submission has already been reviewed';
  end if;
  if p_decision='approved' then
    insert into public.case_financial_events(case_id,event_type,amount_minor,currency,source_table,source_id,note,created_by)
    values(current_case.id,'payment_approved',submission.amount_minor,submission.currency,'public_payment_submissions',submission.id,'Approved public payment proof',auth.uid()) returning id into event_id;
    insert into public.payments(case_id,amount,amount_minor,currency,payment_method,reference_no,proof_url,review_status,reviewed_at,reviewed_by,notes,financial_event_id,source_submission_id)
    values(current_case.id,submission.amount,submission.amount_minor,submission.currency,submission.payment_method,submission.reference_no,submission.proof_object_path,'approved',now(),auth.uid(),submission.review_notes,event_id,submission.id);
    perform public.financial_recalculate_case(current_case.id);
  end if;
  update public.public_payment_submissions set status=p_decision::public_submission_status,reviewed_at=now(),reviewed_by=auth.uid() where id=submission.id returning * into submission;
  insert into public.audit_logs(business_id,case_id,action,actor_type,actor_id,metadata) values(current_case.business_id,current_case.id,concat('payment_proof.',p_decision),'owner',auth.uid(),jsonb_build_object('submission_id',submission.id,'amount_minor',submission.amount_minor,'currency',submission.currency));
  return submission;
end;
$$;

drop function if exists public.financial_review_public_payment_submission(uuid,text);
create or replace function public.financial_review_public_payment_submission(p_submission_id uuid,p_decision text,p_reason text default null)
returns public.public_payment_submissions language plpgsql security definer set search_path = public, pg_temp as $$
declare submission public.public_payment_submissions; current_case public.cases; payment_row public.payments; old_status text;
begin
  if p_decision not in ('under_review','confirmed','rejected','more_information_required') then raise exception 'Unsupported submission review decision'; end if;
  if p_decision in ('rejected','more_information_required') and char_length(btrim(coalesce(p_reason,'')))<3 then raise exception 'A reason is required'; end if;
  select * into submission from public.public_payment_submissions where id=p_submission_id for update;
  if not found then raise exception 'Submission not found'; end if;
  current_case:=public.financial_assert_case_owner(submission.case_id);
  if submission.currency<>current_case.currency then raise exception 'Payment currency does not match case currency'; end if;
  old_status:=submission.status::text;
  if old_status in ('confirmed','approved') then if p_decision='confirmed' then return submission; end if; raise exception 'Submission has already been confirmed'; end if;
  if old_status='rejected' then if p_decision='rejected' then return submission; end if; raise exception 'Submission has already been rejected'; end if;
  if p_decision='confirmed' then
    select * into payment_row from public.financial_create_owner_payment(submission.case_id,submission.amount_minor,submission.payment_method,submission.reference_no,submission.proof_object_path,submission.debtor_note,true);
    update public.payments set source_submission_id=submission.id where id=payment_row.id;
  end if;
  update public.public_payment_submissions set status=p_decision::public.public_submission_status,reviewed_at=case when p_decision in ('confirmed','rejected') then now() else reviewed_at end,reviewed_by=auth.uid(),review_notes=nullif(btrim(p_reason),''),rejection_reason=case when p_decision in ('rejected','more_information_required') then btrim(p_reason) end where id=submission.id returning * into submission;
  insert into public.payment_proof_events(submission_id,business_id,case_id,from_status,to_status,actor_type,actor_id,reason) values(submission.id,submission.business_id,submission.case_id,old_status,p_decision,'owner',auth.uid(),nullif(btrim(p_reason),''));
  insert into public.audit_logs(business_id,case_id,action,actor_type,actor_id,metadata) values(submission.business_id,submission.case_id,concat('payment_proof.',p_decision),'owner',auth.uid(),jsonb_build_object('submission_id',submission.id,'amount_minor',submission.amount_minor,'currency',submission.currency));
  if p_decision in ('confirmed','rejected') then update public.action_centre_items set status='completed',completed_at=now() where type='review_payment_proof' and entity_id=submission.id and business_id=submission.business_id; end if;
  return submission;
end;
$$;

create or replace function public.financial_reverse_payment(p_payment_id uuid,p_idempotency_key uuid,p_reason text default null)
returns public.cases language plpgsql security definer set search_path = public, pg_temp as $$
declare payment_row public.payments; current_case public.cases;
begin
  select * into payment_row from public.payments where id=p_payment_id for update;
  if not found then raise exception 'Payment not found'; end if;
  current_case:=public.financial_assert_case_owner(payment_row.case_id);
  if payment_row.currency<>current_case.currency then raise exception 'Payment currency does not match case currency'; end if;
  if payment_row.review_status='reversed' then return current_case; end if;
  if payment_row.review_status<>'approved' then raise exception 'Only approved payments can be reversed'; end if;
  insert into public.case_financial_events(case_id,event_type,amount_minor,currency,source_table,source_id,idempotency_key,note,created_by)
  values(payment_row.case_id,'payment_reversal',payment_row.amount_minor,payment_row.currency,'payment_reversal',p_idempotency_key,p_idempotency_key,nullif(btrim(p_reason),''),auth.uid()) on conflict(idempotency_key) do nothing;
  update public.payments set review_status='reversed',reversed_at=now(),reversed_by=auth.uid(),reversal_reason=nullif(btrim(p_reason),'') where id=payment_row.id;
  current_case:=public.financial_recalculate_case(payment_row.case_id);
  insert into public.audit_logs(business_id,case_id,action,actor_type,actor_id,metadata) values(current_case.business_id,current_case.id,'payment.reversed','owner',auth.uid(),jsonb_build_object('payment_id',payment_row.id,'amount_minor',payment_row.amount_minor,'currency',payment_row.currency));
  return current_case;
end;
$$;

drop view if exists public.customer_receivable_totals;
create view public.customer_receivable_totals with (security_invoker=true) as
with currency_balances as (
  select business_id,customer_id,currency,contractual_due_minor,paid_minor,outstanding_minor
  from public.obligations where archived_at is null and status not in ('void','written_off')
  union all
  select c.business_id,c.debtor_id,c.currency,c.contractual_due_minor,c.approved_payment_minor,c.outstanding_minor
  from public.cases c where c.archived_at is null and c.debtor_id is not null
    and c.case_scope in ('standalone','account_balance')
    and not exists(select 1 from public.recovery_case_obligations rco where rco.case_id=c.id)
    and (c.case_scope='standalone' or not exists(
      select 1 from public.obligations o where o.account_id=c.account_id and o.archived_at is null and o.status not in ('void','written_off')
    ))
)
select business_id,customer_id,currency,sum(contractual_due_minor)::bigint contractual_due_minor,
  sum(paid_minor)::bigint paid_minor,sum(outstanding_minor)::bigint outstanding_minor
from currency_balances group by business_id,customer_id,currency;

comment on view public.customer_receivable_totals is 'One row per customer and currency. Values must not be summed across currencies without explicit traceable FX data.';

create or replace function public.receivables_create_recovery_case(
  p_customer_id uuid,p_target text,p_account_id uuid,p_obligation_id uuid default null,p_payment_lock_mode text default 'approval'
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  selected_account public.customer_accounts; selected_customer public.debtors;
  selected_ids uuid[]; selected_count integer; selected_due bigint; selected_paid bigint;
  selected_outstanding bigint; selected_due_date date; selected_reference text;
  selected_scope text; created_case_id text; selected_currency char(3);
begin
  if p_target not in ('invoice','account') then raise exception 'Unsupported chase target'; end if;
  if p_payment_lock_mode not in ('immediate','approval','manual') then raise exception 'Unsupported payment lock mode'; end if;
  if p_target='invoice' and p_obligation_id is null then raise exception 'Select an invoice to chase'; end if;
  if p_target='account' and p_obligation_id is not null then raise exception 'Account chasing selects all open invoices'; end if;
  select a.* into selected_account from public.customer_accounts a where a.id=p_account_id and a.customer_id=p_customer_id and a.archived_at is null;
  if not found or not public.has_business_permission(selected_account.business_id,'case.manage') then raise exception 'Account is unavailable'; end if;
  selected_currency:=selected_account.currency;
  select d.* into selected_customer from public.debtors d where d.id=p_customer_id and d.business_id=selected_account.business_id and d.archived_at is null;
  if not found then raise exception 'Customer is unavailable'; end if;
  select array_agg(o.id order by o.due_date,o.created_at,o.id),count(*)::integer,
    coalesce(sum(o.contractual_due_minor),0)::bigint,coalesce(sum(o.paid_minor),0)::bigint,
    coalesce(sum(o.outstanding_minor),0)::bigint,min(o.due_date),
    case when count(*)=1 then min(o.reference) else null end
  into selected_ids,selected_count,selected_due,selected_paid,selected_outstanding,selected_due_date,selected_reference
  from public.obligations o where o.business_id=selected_account.business_id and o.customer_id=p_customer_id
    and o.account_id=p_account_id and o.currency=selected_currency and o.archived_at is null
    and o.status not in ('void','written_off','paid') and o.outstanding_minor>0
    and (p_target='account' or o.id=p_obligation_id);
  if selected_count=0 then raise exception 'No open invoice is available to chase'; end if;
  if p_target='invoice' and selected_count<>1 then raise exception 'Invoice is unavailable'; end if;
  if exists(select 1 from public.recovery_case_obligations where obligation_id=any(selected_ids)) then raise exception 'One or more invoices are already assigned to a recovery case'; end if;
  selected_scope:=case when selected_count=1 then 'single_obligation' else 'multiple_obligations' end;
  created_case_id:='CB-'||extract(year from current_date)::integer::text||'-'||substr(replace(gen_random_uuid()::text,'-',''),1,12);
  insert into public.cases(id,business_id,debtor_id,debtor_type,debtor_name,debtor_phone,debtor_email,debtor_company,debtor_reg_no,debtor_location,currency,amount_owed,amount_paid,due_date,invoice_no,status,payment_lock_mode,notes)
  values(created_case_id,selected_account.business_id,selected_customer.id,selected_customer.debtor_type,
    case when selected_customer.debtor_type='business' then selected_customer.business_name else selected_customer.individual_name end,
    selected_customer.phone,selected_customer.email,case when selected_customer.debtor_type='business' then selected_customer.business_name end,
    selected_customer.registration_no,selected_customer.address,selected_currency,public.currency_minor_to_major(selected_due,selected_currency),0,
    selected_due_date,selected_reference,'action_needed',p_payment_lock_mode,
    case when p_target='account' then 'Recovery case for current account balance ('||selected_count||' open invoices).'
      else 'Recovery case for invoice '||selected_reference||'.' end);
  if selected_paid>0 then
    insert into public.case_financial_events(case_id,event_type,amount_minor,currency,source_table,source_id,note,created_by)
    values(created_case_id,'opening_payment_credit',selected_paid,selected_currency,'receivables_chase',gen_random_uuid(),'Opening credit copied from selected invoice ledger balances.',auth.uid());
    perform public.financial_recalculate_case(created_case_id);
  end if;
  insert into public.recovery_case_obligations(case_id,obligation_id,business_id,linked_by)
    select created_case_id,obligation_id,selected_account.business_id,auth.uid() from unnest(selected_ids) obligation_id;
  update public.cases set account_id=p_account_id,case_scope=selected_scope,updated_at=now() where id=created_case_id;
  perform public.receivables_sync_case_obligations(created_case_id);
  return jsonb_build_object('case_id',created_case_id,'scope',selected_scope,'currency',selected_currency,'linked_obligation_count',selected_count,'contractual_due_minor',selected_due,'approved_payment_minor',selected_paid,'outstanding_minor',selected_outstanding);
end;
$$;

create or replace function public.commit_operational_import(p_business_id uuid,p_batch_id uuid,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_actor uuid:=auth.uid(); v_row jsonb; v_customer uuid; v_account uuid; v_obligation uuid;
  v_case_id text; v_amount bigint; v_count integer:=0; v_existing public.debtors;
  v_account_number text; v_currency char(3); v_account_currency char(3);
begin
  if not public.has_business_permission(p_business_id,'case.manage') then raise exception 'Tenant case-manage permission required'; end if;
  if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)<1 or jsonb_array_length(p_rows)>5000 then raise exception 'Import must contain 1 to 5000 rows'; end if;
  if not exists(select 1 from public.import_batches where id=p_batch_id and business_id=p_business_id) then raise exception 'Import batch is outside this tenant'; end if;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_currency:=upper(v_row->>'currency');
    if v_currency is null or v_currency !~ '^[A-Z]{3}$' then raise exception 'Every import row requires a valid ISO currency code'; end if;
    v_amount:=(v_row->>'opening_outstanding_minor')::bigint;
    if v_amount<=0 then raise exception 'Outstanding amount must be positive'; end if;
    v_customer:=nullif(v_row->>'matched_customer_id','')::uuid;
    if v_customer is not null then
      select * into v_existing from public.debtors where id=v_customer and business_id=p_business_id and archived_at is null;
      if not found then raise exception 'Confirmed customer match is unavailable'; end if;
    elsif coalesce((v_row->>'reuse_confirmed')::boolean,false) then
      select d.id into v_customer from public.debtors d where d.business_id=p_business_id and d.archived_at is null and (
        (nullif(regexp_replace(coalesce(v_row->>'registration_no',''),'[^a-zA-Z0-9]','','g'),'') is not null and upper(regexp_replace(coalesce(d.registration_no,''),'[^a-zA-Z0-9]','','g'))=upper(regexp_replace(v_row->>'registration_no','[^a-zA-Z0-9]','','g')))
        or (nullif(lower(btrim(coalesce(v_row->>'email',''))),'') is not null and lower(btrim(coalesce(d.email,'')))=lower(btrim(v_row->>'email')))
        or (char_length(regexp_replace(coalesce(v_row->>'phone',''),'\D','','g'))>=7 and regexp_replace(coalesce(d.phone,''),'\D','','g')=regexp_replace(v_row->>'phone','\D','','g'))
        or exists(select 1 from public.customer_accounts a where a.business_id=p_business_id and a.customer_id=d.id and a.archived_at is null and nullif(lower(btrim(coalesce(v_row->>'account_number',''))),'') is not null and lower(btrim(coalesce(a.account_number,'')))=lower(btrim(v_row->>'account_number')))
      ) limit 1;
    end if;
    if v_customer is null then
      insert into public.debtors(business_id,debtor_type,individual_name,business_name,contact_name,registration_no,phone,email,address)
      values(p_business_id,v_row->>'debtor_type',case when v_row->>'debtor_type'='individual' then v_row->>'customer_name' end,case when v_row->>'debtor_type'='business' then v_row->>'customer_name' end,nullif(v_row->>'contact_name',''),nullif(v_row->>'registration_no',''),nullif(v_row->>'phone',''),nullif(v_row->>'email',''),nullif(v_row->>'address','')) returning id into v_customer;
    end if;
    v_account_number:=nullif(v_row->>'account_number','');
    select id,currency into v_account,v_account_currency from public.customer_accounts where business_id=p_business_id and customer_id=v_customer and account_number is not distinct from v_account_number and archived_at is null;
    if found and v_account_currency<>v_currency then raise exception 'Import account currency % does not match row currency %',v_account_currency,v_currency; end if;
    if not found then
      insert into public.customer_accounts(business_id,customer_id,account_type,account_number,display_name,currency,metadata,custom_fields)
      values(p_business_id,v_customer,coalesce(nullif(v_row->>'account_type',''),'general'),v_account_number,coalesce(nullif(v_row->>'account_name',''),v_row->>'customer_name'),v_currency,coalesce(v_row->'account_metadata','{}'::jsonb),'{}'::jsonb) returning id into v_account;
    end if;
    insert into public.obligations(business_id,customer_id,account_id,obligation_type,reference,purchase_order_reference,issue_date,due_date,currency,original_amount_minor,adjustments_minor,paid_minor,status,metadata,custom_fields)
    values(p_business_id,v_customer,v_account,coalesce(nullif(v_row->>'obligation_type',''),'invoice'),v_row->>'reference',nullif(v_row->>'purchase_order_reference',''),nullif(v_row->>'issue_date','')::date,(v_row->>'due_date')::date,v_currency,v_amount,0,0,case when (v_row->>'due_date')::date<current_date then 'overdue' else 'open' end,coalesce(v_row->'obligation_metadata','{}'::jsonb)||jsonb_build_object('import_batch_id',p_batch_id,'opening_balance',true),'{}'::jsonb) returning id into v_obligation;
    v_case_id:='CB-'||extract(year from current_date)::text||'-'||substr(replace(gen_random_uuid()::text,'-',''),1,12);
    insert into public.cases(id,business_id,debtor_id,account_id,case_scope,debtor_type,debtor_name,debtor_phone,debtor_email,debtor_company,debtor_reg_no,debtor_location,currency,amount_owed,amount_paid,original_principal_minor,contractual_due_minor,approved_payment_minor,outstanding_minor,due_date,invoice_no,status,payment_lock_mode,priority,metadata)
    select v_case_id,p_business_id,d.id,v_account,'single_obligation',d.debtor_type,coalesce(d.business_name,d.individual_name,''),d.phone,d.email,d.business_name,d.registration_no,d.address,v_currency,public.currency_minor_to_major(v_amount,v_currency),0,v_amount,v_amount,0,v_amount,(v_row->>'due_date')::date,v_row->>'reference',case when (v_row->>'due_date')::date<current_date then 'overdue' else 'action_needed' end,'approval',coalesce(nullif(v_row->>'priority',''),'medium'),jsonb_build_object('import_batch_id',p_batch_id) from public.debtors d where d.id=v_customer;
    insert into public.recovery_case_obligations(case_id,obligation_id,business_id,linked_by) values(v_case_id,v_obligation,p_business_id,v_actor);
    v_count:=v_count+1;
  end loop;
  update public.import_batches set status='committed',committed_at=now(),valid_rows=v_count where id=p_batch_id and business_id=p_business_id;
  insert into public.audit_logs(business_id,action,actor_type,actor_id,entity_type,entity_id,metadata) values(p_business_id,'import.committed','staff',v_actor,'import_batch',p_batch_id::text,jsonb_build_object('row_count',v_count,'currency_preserved',true));
  return jsonb_build_object('batch_id',p_batch_id,'imported',v_count);
end;
$$;

revoke all on function public.currency_minor_units(text) from public;
revoke all on function public.currency_minor_to_major(bigint,text) from public;
revoke all on function public.currency_major_to_minor(numeric,text) from public;
grant execute on function public.currency_minor_units(text) to authenticated,service_role;
grant execute on function public.currency_minor_to_major(bigint,text) to authenticated,service_role;
grant execute on function public.currency_major_to_minor(numeric,text) to authenticated,service_role;
revoke all on function public.inherit_case_currency() from public;
revoke all on function public.inherit_plan_currency() from public;
revoke all on function public.inherit_promise_currency() from public;
revoke all on function public.payment_currency_guard() from public;
revoke all on function public.public_submission_currency_guard() from public;
revoke all on function public.obligation_account_currency_guard() from public;
revoke all on function public.recovery_link_currency_guard() from public;
revoke all on function public.case_currency_guard() from public;
revoke all on function public.receiving_account_currency_guard() from public;
revoke all on function public.customer_account_currency_guard() from public;

commit;

-- Rollback considerations:
-- Keep all currency columns and historical values once any non-MYR record exists.
-- A safe rollback disables non-MYR writes and restores compatibility views only;
-- it must not coerce foreign amounts to MYR or divide every minor amount by 100.
-- Before first production use only, the additive columns/triggers/functions may
-- be dropped after restoring the prior views and numeric column definitions.
