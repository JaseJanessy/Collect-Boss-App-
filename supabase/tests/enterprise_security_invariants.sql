-- Run against an isolated database after all migrations. This is deliberately
-- read-only: any failed invariant aborts the test transaction.
begin;

do $$
declare missing_rls text;
begin
  select string_agg(format('%I.%I',table_schema,table_name),', ' order by table_name)
  into missing_rls
  from information_schema.columns columns
  join pg_class relation on relation.relname=columns.table_name
  join pg_namespace namespace on namespace.oid=relation.relnamespace and namespace.nspname=columns.table_schema
  where columns.table_schema='public' and columns.column_name='business_id'
    and relation.relkind='r' and not relation.relrowsecurity;
  if missing_rls is not null then raise exception 'Tenant tables missing RLS: %',missing_rls; end if;
end $$;

do $$
begin
  if exists(select 1 from storage.buckets where id in(
    'evidence-files','payment-proofs','receiving-account-qr','dispute-evidence','transaction-evidence'
  ) and public) then raise exception 'A sensitive storage bucket is public'; end if;
  if exists(select 1 from pg_policies where schemaname='storage' and tablename='objects'
    and policyname in('evidence_files_owner_read','evidence_files_owner_select','payment_proofs_owner_read'))
    then raise exception 'A legacy direct sensitive-file policy remains enabled'; end if;
end $$;

do $$
begin
  if not exists(select 1 from pg_trigger where tgname='public_access_tokens_tenant_scope' and not tgisinternal)
    then raise exception 'Public token tenant trigger is missing'; end if;
  if not exists(select 1 from pg_trigger where tgname='audit_logs_hash_chain_insert' and not tgisinternal)
    then raise exception 'Audit hash-chain trigger is missing'; end if;
  if exists(select 1 from information_schema.role_routine_grants
    where routine_schema='public' and routine_name='security_rate_limit_consume'
      and grantee in('anon','authenticated','PUBLIC'))
    then raise exception 'Rate-limit RPC is callable without service role'; end if;
end $$;

rollback;
