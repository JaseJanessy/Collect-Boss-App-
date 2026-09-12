-- Individual/business creditor profile model.
-- Apply after supabase/schema.sql and 20260714_public_access_tokens.sql.
-- This migration is local source only until an environment-specific approval
-- and a verified backup/migration target exist.

begin;

do $$
begin
  if not exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'businesses'
  ) then
    raise exception 'Expected public.businesses is missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'businesses'
      and column_name = 'owner_id'
      and data_type = 'uuid'
  ) then
    raise exception 'Expected public.businesses.owner_id uuid is missing or incompatible';
  end if;

  if exists (
    select owner_id
    from public.businesses
    group by owner_id
    having count(*) > 1
  ) then
    raise exception 'Cannot enforce one creditor account per owner: duplicate businesses.owner_id rows exist';
  end if;
end
$$;

alter table public.businesses
  add column if not exists account_type text,
  add column if not exists legal_name text,
  add column if not exists contact_name text,
  add column if not exists logo_object_path text;

alter table public.businesses
  drop constraint if exists businesses_account_type_check;

alter table public.businesses
  add constraint businesses_account_type_check
  check (account_type is null or account_type in ('individual', 'business'));

create unique index if not exists businesses_owner_id_key
  on public.businesses (owner_id);

insert into storage.buckets (id, name, public)
values ('business-assets', 'business-assets', false)
on conflict (id) do update set public = excluded.public;

drop policy if exists "business_assets_owner_select" on storage.objects;
create policy "business_assets_owner_select"
on storage.objects for select to authenticated
using (
  bucket_id = 'business-assets'
  and exists (
    select 1
    from public.businesses b
    where b.owner_id = auth.uid()
      and storage.objects.name like b.id::text || '/%'
  )
);

drop policy if exists "business_assets_owner_insert" on storage.objects;
create policy "business_assets_owner_insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'business-assets'
  and exists (
    select 1
    from public.businesses b
    where b.owner_id = auth.uid()
      and storage.objects.name like b.id::text || '/%'
  )
);

drop policy if exists "business_assets_owner_update" on storage.objects;
create policy "business_assets_owner_update"
on storage.objects for update to authenticated
using (
  bucket_id = 'business-assets'
  and exists (
    select 1
    from public.businesses b
    where b.owner_id = auth.uid()
      and storage.objects.name like b.id::text || '/%'
  )
)
with check (
  bucket_id = 'business-assets'
  and exists (
    select 1
    from public.businesses b
    where b.owner_id = auth.uid()
      and storage.objects.name like b.id::text || '/%'
  )
);

drop policy if exists "business_assets_owner_delete" on storage.objects;
create policy "business_assets_owner_delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'business-assets'
  and exists (
    select 1
    from public.businesses b
    where b.owner_id = auth.uid()
      and storage.objects.name like b.id::text || '/%'
  )
);

commit;

-- Rollback: deploy the previous profile UI/API first and stop writes to these
-- fields. Preserve creditor-profile rows and business-assets objects required
-- by audit or retention policy. Revoke the added storage policies before
-- removing only proven-unused schema objects; never delete stored assets as an
-- application rollback shortcut.
