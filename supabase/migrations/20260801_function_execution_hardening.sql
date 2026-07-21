-- Prompt 39 approved remediation: remove default PUBLIC access from
-- security-definer/internal helpers and reserve scheduled overdue processing
-- for the trusted service role. This migration does not alter business data.
begin;

revoke all on function public.advance_overdue_cases() from public;
grant execute on function public.advance_overdue_cases() to service_role;

revoke all on function public.financial_assert_case_owner(text) from public;
revoke all on function public.financial_recalculate_case(text) from public;
revoke all on function public.payment_plan_reconcile_case(text) from public;

do $$
begin
  if to_regprocedure('public.provision_free_tier()') is not null then
    execute 'alter function public.provision_free_tier() set search_path = public, pg_temp';
  end if;
end;
$$;

commit;

-- Rollback is intentionally not recommended: restoring PUBLIC EXECUTE would
-- recreate the cross-tenant mutation surface. If an emergency rollback is
-- approved, restore only the minimum named role grants required by the job.
