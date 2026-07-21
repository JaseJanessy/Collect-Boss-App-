-- Prompt 32: reminder lifecycle and communication-history metadata.
-- Local proposal only. Apply after 20260726_public_token_rotation.sql.

begin;

create or replace function public.owns_case(p_case_id text)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.cases c
    join public.businesses b on b.id = c.business_id
    where c.id = p_case_id
      and b.owner_id = auth.uid()
  );
$$;

revoke all on function public.owns_case(text) from public;
grant execute on function public.owns_case(text) to authenticated;

alter table public.reminders
  add column if not exists template_version smallint not null default 1 check (template_version > 0),
  add column if not exists recipient text,
  add column if not exists generated_at timestamptz,
  add column if not exists composer_opened_at timestamptz,
  add column if not exists manually_confirmed_at timestamptz,
  add column if not exists next_action_at timestamptz,
  add column if not exists request_key uuid;

update public.reminders
  set generated_at = coalesce(generated_at, sent_at)
  where generated_at is null;

update public.reminders
  set request_key = gen_random_uuid()
  where request_key is null;

alter table public.reminders
  alter column generated_at set not null,
  alter column request_key set not null;

create index if not exists reminders_case_generated_at_idx
  on public.reminders(case_id, generated_at desc);

create unique index if not exists reminders_case_request_key_uidx
  on public.reminders(case_id, request_key);

drop policy if exists "reminders: owner update" on public.reminders;
create policy "reminders: owner update"
  on public.reminders for update
  using (public.owns_case(case_id))
  with check (public.owns_case(case_id));

commit;

-- Rollback (only after deciding how to preserve newly-recorded history):
-- begin;
-- drop policy if exists "reminders: owner update" on public.reminders;
-- drop index if exists public.reminders_case_request_key_uidx;
-- drop index if exists public.reminders_case_generated_at_idx;
-- alter table public.reminders
--   drop column if exists request_key,
--   drop column if exists next_action_at,
--   drop column if exists manually_confirmed_at,
--   drop column if exists composer_opened_at,
--   drop column if exists generated_at,
--   drop column if exists recipient,
--   drop column if exists template_version;
-- commit;
