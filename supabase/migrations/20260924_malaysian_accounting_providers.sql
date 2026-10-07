-- Malaysian accounting software: Bukku and AutoCount Cloud Accounting.
--
-- Both connect with API keys the business creates in its own accounting
-- software (no OAuth), so the encrypted key is stored in the existing
-- credential columns and never expires. This migration only adds 'bukku' and
-- 'autocount' to every provider allow-list that already contains 'quickbooks'
-- (accounting tables and the shared integration job/health tables), keeping
-- every value the list already had.
--
-- Review before applying. Safe to re-run.

begin;

do $$
declare
  r record;
  v_def text;
begin
  for r in
    select c.conrelid::regclass as table_name, c.conname, pg_get_constraintdef(c.oid) as def
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%''quickbooks''::text%'
      and pg_get_constraintdef(c.oid) not like '%''bukku''%'
  loop
    v_def := replace(r.def, '''quickbooks''::text', '''quickbooks''::text, ''bukku''::text, ''autocount''::text');
    execute format('alter table %s drop constraint %I', r.table_name, r.conname);
    execute format('alter table %s add constraint %I %s', r.table_name, r.conname, v_def);
  end loop;
end $$;

commit;
