-- Y01 proposal: secure the existing receiving_accounts table in place.
-- Preserves every row and every case/token foreign-key reference.
begin;
alter table public.receiving_accounts
 add column if not exists business_entity text,
 add column if not exists payment_method text not null default 'bank_transfer',
 add column if not exists masked_display text,
 add column if not exists qr_object_path text,
 add column if not exists is_active boolean not null default true,
 add column if not exists verification_status text not null default 'unverified',
 add column if not exists created_by uuid references auth.users(id) on delete set null,
 add column if not exists updated_by uuid references auth.users(id) on delete set null,
 add column if not exists approved_by uuid references auth.users(id) on delete set null,
 add column if not exists approved_at timestamptz;
update public.receiving_accounts ra set
 business_entity=coalesce(nullif(ra.business_entity,''),nullif(b.legal_name,''),b.business_name),
 masked_display=coalesce(nullif(ra.masked_display,''),repeat('*',greatest(4,least(8,length(regexp_replace(ra.account_number,'\s','','g'))-4)))||right(regexp_replace(ra.account_number,'\s','','g'),4))
from public.businesses b where b.id=ra.business_id and (ra.business_entity is null or ra.masked_display is null);
alter table public.receiving_accounts alter column business_entity set not null;
alter table public.receiving_accounts alter column masked_display set not null;
alter table public.receiving_accounts drop constraint if exists receiving_accounts_payment_method_check;
alter table public.receiving_accounts add constraint receiving_accounts_payment_method_check check(payment_method in ('bank_transfer','duitnow','ewallet','other'));
alter table public.receiving_accounts drop constraint if exists receiving_accounts_verification_status_check;
alter table public.receiving_accounts add constraint receiving_accounts_verification_status_check check(verification_status in ('unverified','pending','verified','rejected','disabled'));
drop policy if exists "owners can manage own accounts" on public.receiving_accounts;
drop policy if exists "receiving_accounts: owner read" on public.receiving_accounts;
drop policy if exists "receiving_accounts: owner insert" on public.receiving_accounts;
drop policy if exists "receiving_accounts: owner update" on public.receiving_accounts;
drop policy if exists "receiving_accounts: owner delete" on public.receiving_accounts;
create policy "receiving_accounts: owner read" on public.receiving_accounts for select to authenticated
 using(exists(select 1 from public.businesses b where b.id=business_id and b.owner_id=auth.uid()));

create or replace function public.receiving_account_mask(p_value text) returns text language sql immutable set search_path=public,pg_temp as $$
 select repeat('*',greatest(4,least(8,length(regexp_replace(p_value,'\s','','g'))-4)))||right(regexp_replace(p_value,'\s','','g'),4) $$;

create or replace function public.receiving_account_create_secure(
 p_actor_id uuid,p_business_id uuid,p_business_entity text,p_account_holder_name text,p_bank_name text,p_payment_method text,p_account_identifier text,p_duitnow_id text,p_include_in_reminders boolean,p_is_primary boolean
) returns setof public.receiving_accounts language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.receiving_accounts;
begin
 if not exists(select 1 from public.businesses where id=p_business_id and owner_id=p_actor_id) then raise exception 'owner authorization failed'; end if;
 if p_is_primary then update public.receiving_accounts set is_primary=false,updated_at=now(),updated_by=p_actor_id where business_id=p_business_id and is_primary; end if;
 insert into public.receiving_accounts(business_id,business_entity,account_holder_name,bank_name,payment_method,account_number,masked_display,duitnow_id,include_in_reminders,is_primary,is_active,verification_status,created_by,updated_by)
 values(p_business_id,btrim(p_business_entity),btrim(p_account_holder_name),btrim(p_bank_name),p_payment_method,btrim(p_account_identifier),public.receiving_account_mask(p_account_identifier),nullif(btrim(p_duitnow_id),''),p_include_in_reminders,p_is_primary,true,'pending',p_actor_id,p_actor_id) returning * into v;
 update public.receiving_accounts set approved_by=p_actor_id,approved_at=now() where id=v.id returning * into v;
 insert into public.audit_logs(business_id,action,actor_type,actor_id,metadata) values(p_business_id,'receiving_account.created','owner',p_actor_id,jsonb_build_object('account_id',v.id,'after',jsonb_build_object('masked_display',v.masked_display,'bank_name',v.bank_name,'status',v.verification_status)));
 return next v;
end $$;

create or replace function public.receiving_account_update_secure(
 p_actor_id uuid,p_business_id uuid,p_account_id uuid,p_business_entity text default null,p_account_holder_name text default null,p_bank_name text default null,p_payment_method text default null,p_account_identifier text default null,p_duitnow_id text default null,p_include_in_reminders boolean default null,p_is_primary boolean default null
) returns setof public.receiving_accounts language plpgsql security definer set search_path=public,pg_temp as $$
declare v_old public.receiving_accounts; v_new public.receiving_accounts; sensitive boolean;
begin
 if not exists(select 1 from public.businesses where id=p_business_id and owner_id=p_actor_id) then raise exception 'owner authorization failed'; end if;
 select * into v_old from public.receiving_accounts where id=p_account_id and business_id=p_business_id for update;
 if not found then raise exception 'receiving account not found'; end if;
 sensitive:=(p_account_identifier is not null and btrim(p_account_identifier) is distinct from v_old.account_number) or (p_account_holder_name is not null and btrim(p_account_holder_name) is distinct from v_old.account_holder_name);
 if p_is_primary=true and (not v_old.is_active or v_old.verification_status in ('rejected','disabled')) then raise exception 'inactive or disabled accounts cannot be selected'; end if;
 if p_is_primary=true then update public.receiving_accounts set is_primary=false,updated_at=now(),updated_by=p_actor_id where business_id=p_business_id and id<>p_account_id and is_primary; end if;
 update public.receiving_accounts set business_entity=coalesce(nullif(btrim(p_business_entity),''),business_entity),account_holder_name=coalesce(nullif(btrim(p_account_holder_name),''),account_holder_name),bank_name=coalesce(nullif(btrim(p_bank_name),''),bank_name),payment_method=coalesce(p_payment_method,payment_method),account_number=coalesce(nullif(btrim(p_account_identifier),''),account_number),masked_display=case when p_account_identifier is null then masked_display else public.receiving_account_mask(p_account_identifier) end,duitnow_id=case when p_duitnow_id is null then duitnow_id else nullif(btrim(p_duitnow_id),'') end,include_in_reminders=coalesce(p_include_in_reminders,include_in_reminders),is_primary=coalesce(p_is_primary,is_primary),verification_status=case when sensitive then 'pending' else verification_status end,approved_by=case when sensitive then p_actor_id else approved_by end,approved_at=case when sensitive then now() else approved_at end,updated_by=p_actor_id,updated_at=now(),version=version+1 where id=p_account_id returning * into v_new;
 insert into public.audit_logs(business_id,action,actor_type,actor_id,metadata) values(p_business_id,'receiving_account.updated','owner',p_actor_id,jsonb_build_object('account_id',p_account_id,'before',jsonb_build_object('masked_display',v_old.masked_display,'bank_name',v_old.bank_name,'status',v_old.verification_status),'after',jsonb_build_object('masked_display',v_new.masked_display,'bank_name',v_new.bank_name,'status',v_new.verification_status)));
 return next v_new;
end $$;

create or replace function public.receiving_account_disable_secure(p_actor_id uuid,p_business_id uuid,p_account_id uuid) returns setof public.receiving_accounts language plpgsql security definer set search_path=public,pg_temp as $$
declare v_old public.receiving_accounts; v_new public.receiving_accounts;
begin
 if not exists(select 1 from public.businesses where id=p_business_id and owner_id=p_actor_id) then raise exception 'owner authorization failed'; end if;
 select * into v_old from public.receiving_accounts where id=p_account_id and business_id=p_business_id for update;
 if not found then raise exception 'receiving account not found'; end if;
 update public.receiving_accounts set is_active=false,is_primary=false,include_in_reminders=false,verification_status='disabled',updated_by=p_actor_id,updated_at=now(),version=version+1 where id=p_account_id returning * into v_new;
 insert into public.audit_logs(business_id,action,actor_type,actor_id,metadata) values(p_business_id,'receiving_account.disabled','owner',p_actor_id,jsonb_build_object('account_id',p_account_id,'before',jsonb_build_object('masked_display',v_old.masked_display,'status',v_old.verification_status),'after',jsonb_build_object('masked_display',v_new.masked_display,'status','disabled')));
 return next v_new;
end $$;
create or replace function public.receiving_account_set_qr_secure(p_actor_id uuid,p_business_id uuid,p_account_id uuid,p_qr_object_path text) returns setof public.receiving_accounts language plpgsql security definer set search_path=public,pg_temp as $$
declare v_old public.receiving_accounts; v_new public.receiving_accounts;
begin
 if not exists(select 1 from public.businesses where id=p_business_id and owner_id=p_actor_id) then raise exception 'owner authorization failed'; end if;
 select * into v_old from public.receiving_accounts where id=p_account_id and business_id=p_business_id for update;
 if not found then raise exception 'receiving account not found'; end if;
 if p_qr_object_path not like p_business_id::text||'/'||p_account_id::text||'/%' then raise exception 'invalid QR object scope'; end if;
 update public.receiving_accounts set qr_object_path=p_qr_object_path,duitnow_qr_url=null,verification_status='pending',approved_by=p_actor_id,approved_at=now(),updated_by=p_actor_id,updated_at=now(),version=version+1 where id=p_account_id returning * into v_new;
 insert into public.audit_logs(business_id,action,actor_type,actor_id,metadata) values(p_business_id,'receiving_account.qr_updated','owner',p_actor_id,jsonb_build_object('account_id',p_account_id,'before',jsonb_build_object('has_qr',v_old.qr_object_path is not null),'after',jsonb_build_object('has_qr',true,'status','pending')));
 return next v_new;
end $$;
revoke execute on function public.receiving_account_mask(text) from public,anon,authenticated;
revoke execute on function public.receiving_account_create_secure(uuid,uuid,text,text,text,text,text,text,boolean,boolean) from public,anon,authenticated;
revoke execute on function public.receiving_account_update_secure(uuid,uuid,uuid,text,text,text,text,text,text,boolean,boolean) from public,anon,authenticated;
revoke execute on function public.receiving_account_disable_secure(uuid,uuid,uuid) from public,anon,authenticated;
revoke execute on function public.receiving_account_set_qr_secure(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.receiving_account_create_secure(uuid,uuid,text,text,text,text,text,text,boolean,boolean) to service_role;
grant execute on function public.receiving_account_update_secure(uuid,uuid,uuid,text,text,text,text,text,text,boolean,boolean) to service_role;
grant execute on function public.receiving_account_disable_secure(uuid,uuid,uuid) to service_role;
grant execute on function public.receiving_account_set_qr_secure(uuid,uuid,uuid,text) to service_role;
insert into storage.buckets(id,name,public) values('receiving-account-qr','receiving-account-qr',false) on conflict(id) do update set public=false;
create or replace function public.validate_case_receiving_account() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.receiving_account_id is not null and not exists(
   select 1 from public.receiving_accounts ra where ra.id=new.receiving_account_id and ra.business_id=new.business_id
     and ra.is_active and ra.verification_status not in ('rejected','disabled')
 ) then raise exception 'receiving account must be active and belong to the case business'; end if;
 return new;
end $$;
drop trigger if exists cases_receiving_account_guard on public.cases;
create trigger cases_receiving_account_guard before insert or update of business_id,receiving_account_id on public.cases for each row execute function public.validate_case_receiving_account();
revoke execute on function public.validate_case_receiving_account() from public,anon,authenticated;
commit;
-- Rollback keeps the new columns to avoid destroying security metadata. Restore
-- only the previous owner SELECT policy; never restore browser mutation policies.
