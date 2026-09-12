-- Prompt 22 read-only staging checks. Expected result: no exception.
do $$
begin
  if to_regclass('public.integration_jobs') is null or to_regclass('public.integration_health') is null
     or to_regclass('public.email_suppressions') is null then
    raise exception 'Prompt 22 integration tables are missing';
  end if;
  if not exists(select 1 from pg_proc where proname='integration_claim_jobs')
     or not exists(select 1 from pg_proc where proname='integration_finish_job')
     or not exists(select 1 from pg_proc where proname='integration_replay_job')
     or not exists(select 1 from pg_proc where proname='billing_claim_event')
     or not exists(select 1 from pg_proc where proname='billing_apply_subscription_state') then
    raise exception 'Prompt 22 service functions are missing';
  end if;
  if has_table_privilege('anon','public.integration_jobs','select')
     or has_table_privilege('authenticated','public.integration_jobs','insert')
     or has_function_privilege('authenticated','public.integration_claim_jobs(integer)','execute') then
    raise exception 'Prompt 22 queue privilege boundary is too broad';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='integration_jobs' and policyname='integration_jobs_tenant_read')
     or not exists(select 1 from pg_policies where schemaname='public' and tablename='integration_health' and policyname='integration_health_tenant_read') then
    raise exception 'Prompt 22 tenant-read policies are missing';
  end if;
end $$;
