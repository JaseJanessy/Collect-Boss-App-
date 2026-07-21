-- Approved Prompt 41 remediation: all sensitive object buckets are private.
-- Evidence and payment-proof uploads are performed only by validated server routes
-- using the service role; browser clients have no write policies for either bucket.
begin;

insert into storage.buckets (id, name, public)
values
  ('payment-proofs', 'payment-proofs', false),
  ('business-assets', 'business-assets', false),
  ('evidence-files', 'evidence-files', false)
on conflict (id) do update set public = false;

-- Business assets remain private and are scoped to the first path component.
drop policy if exists "business_assets_owner_read" on storage.objects;
drop policy if exists "business_assets_owner_select" on storage.objects;
drop policy if exists "business_assets_owner_insert" on storage.objects;
drop policy if exists "business_assets_owner_update" on storage.objects;
drop policy if exists "business_assets_owner_delete" on storage.objects;
create policy "business_assets_owner_read" on storage.objects
  for select to authenticated using (
    bucket_id = 'business-assets'
    and (storage.foldername(name))[1] in (select id::text from public.businesses where owner_id = auth.uid())
  );
create policy "business_assets_owner_insert" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'business-assets'
    and (storage.foldername(name))[1] in (select id::text from public.businesses where owner_id = auth.uid())
  );
create policy "business_assets_owner_update" on storage.objects
  for update to authenticated using (
    bucket_id = 'business-assets'
    and (storage.foldername(name))[1] in (select id::text from public.businesses where owner_id = auth.uid())
  ) with check (
    bucket_id = 'business-assets'
    and (storage.foldername(name))[1] in (select id::text from public.businesses where owner_id = auth.uid())
  );
create policy "business_assets_owner_delete" on storage.objects
  for delete to authenticated using (
    bucket_id = 'business-assets'
    and (storage.foldername(name))[1] in (select id::text from public.businesses where owner_id = auth.uid())
  );

-- Evidence object reads require ownership of both the case and path prefix.
drop policy if exists "evidence_files_owner_read" on storage.objects;
drop policy if exists "evidence_files_owner_select" on storage.objects;
create policy "evidence_files_owner_read" on storage.objects
  for select to authenticated using (
    bucket_id = 'evidence-files'
    and (storage.foldername(name))[3] is not null
    and exists (
      select 1
      from public.cases c
      where c.business_id::text = (storage.foldername(name))[1]
        and c.id::text = (storage.foldername(name))[2]
        and exists (select 1 from public.businesses b where b.id = c.business_id and b.owner_id = auth.uid())
    )
  );

-- Payment proof object reads require ownership of the case path prefix.
drop policy if exists "payment_proofs_owner_read" on storage.objects;
create policy "payment_proofs_owner_read" on storage.objects
  for select to authenticated using (
    bucket_id = 'payment-proofs'
    and (storage.foldername(name))[3] is not null
    and exists (
      select 1
      from public.cases c
      where c.id::text = (storage.foldername(name))[1]
        and exists (select 1 from public.businesses b where b.id = c.business_id and b.owner_id = auth.uid())
    )
  );

commit;

-- Rollback: set the buckets private and recreate the previous, less strict read
-- policies only after confirming the target project's policy catalog. Do not make
-- any sensitive bucket public as part of a rollback.
