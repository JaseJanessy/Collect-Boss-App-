-- Public capability rotation and provenance. Apply after 20260725_debtor_portal_lifecycle_hardening.sql.
-- Local proposal only; do not apply remotely without environment-specific approval.

begin;

alter table public.public_access_tokens
  add column if not exists token_version smallint not null default 1 check (token_version between 1 and 32767),
  add column if not exists rotated_from_id uuid references public.public_access_tokens(id) on delete set null,
  add column if not exists rotated_at timestamptz,
  add column if not exists revoke_reason text;
create index if not exists public_access_tokens_rotated_from_idx on public.public_access_tokens(rotated_from_id);

create or replace function public.public_rotate_access_token(
  p_token_id uuid, p_replacement_token_hash text, p_actor_id uuid, p_expires_at timestamptz
) returns public.public_access_tokens language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old public.public_access_tokens; v_new public.public_access_tokens;
begin
  if p_replacement_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid replacement token hash'; end if;
  select t.* into v_old from public.public_access_tokens t join public.cases c on c.id = t.case_id join public.businesses b on b.id = c.business_id
  where t.id = p_token_id and b.owner_id = p_actor_id for update;
  if not found or v_old.revoked_at is not null or v_old.consumed_at is not null or v_old.expires_at <= now() then raise exception 'Public link is not active'; end if;
  if p_expires_at <= now() then raise exception 'Replacement expiry must be in the future'; end if;
  insert into public.public_access_tokens (token_hash, purpose, case_id, payment_plan_id, payment_access_request_id, receiving_account_id, created_by, expires_at, token_version, rotated_from_id)
  values (p_replacement_token_hash, v_old.purpose, v_old.case_id, v_old.payment_plan_id, v_old.payment_access_request_id, v_old.receiving_account_id, p_actor_id, p_expires_at, v_old.token_version + 1, v_old.id)
  returning * into v_new;
  update public.public_access_tokens set revoked_at = now(), rotated_at = now(), revoke_reason = 'rotated'
  where id = v_old.id and revoked_at is null and consumed_at is null;
  return v_new;
end;
$$;
revoke all on function public.public_rotate_access_token(uuid,text,uuid,timestamptz) from public;
grant execute on function public.public_rotate_access_token(uuid,text,uuid,timestamptz) to service_role;

commit;

-- Rollback: begin;
-- drop function if exists public.public_rotate_access_token(uuid,text,uuid,timestamptz);
-- drop index if exists public.public_access_tokens_rotated_from_idx;
-- alter table public.public_access_tokens drop column if exists revoke_reason, drop column if exists rotated_at, drop column if exists rotated_from_id, drop column if exists token_version;
-- commit;
