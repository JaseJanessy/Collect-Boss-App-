# Production Migration Recovery Plan

Status: proposed only — not applied.

The signed-in Supabase migration dashboard for project `hqjlbaqzrbutxankfwhs` was inspected on 8 September 2026. Its latest recorded migration is `20260804_function_privilege_and_billing_hardening.sql`, not the previously assumed `20260805` head. There are **50 local migration files** after that recorded head. Manual SQL changes outside migration history still require reconciliation. The proposed SQL set starts at:

- `supabase/migrations/20260805_receiving_account_security.sql`
- through `supabase/migrations/20260919_pocket_to_solo_upgrade_release_gate.sql`

Do not replace this ordered history by applying `supabase/schema.sql` wholesale to an existing production database. Duplicate date/version prefixes occur on `20260826`, `20260904` and `20260910`; reconcile unique migration identifiers and dependency order before using a CLI migration runner. No files have been renamed or marked applied.

The dashboard reports that this Free-plan project has no scheduled backups. No backup or restore rehearsal has been completed. A verified manual PostgreSQL backup is an alternative to a paid backup plan; it requires database connection access and a separate empty restore target. Neither connection is configured locally. Do not upgrade a paid plan without the owner's approval.

## Required approval and preconditions

1. A database owner confirms the actual remote migration head and records it in release evidence.
2. Take a verified production backup and complete a restore rehearsal into an isolated database.
3. Reconcile the 50-file set against actual schema and migration identifiers, then apply the reviewed dependency order to staging with stop-on-error enabled.
4. Run `supabase/tests/enterprise_security_invariants.sql` and `supabase/tests/production_integration_invariants.sql` against staging.
5. Complete the authenticated case-to-payment staging checklist using isolated QA accounts and Stripe test mode.
6. Review each migration's rollback note and identify migrations whose rollback is restore-only before approving production execution.

## Production execution proposal

After the preconditions pass, apply each reviewed migration from `20260805` through `20260919` exactly once using the organisation's approved Supabase migration runner and reconciled identifiers/order. Stop on the first SQL error. Do not mark later files as applied manually, and do not continue after a partial failure until the database owner has reconciled schema state.

## Deployment preparation status

- Created and verified the empty Vercel project `collectboss` in `stylexjaser-5845s-projects`: https://vercel.com/stylexjaser-5845s-projects/collectboss
- Vercel project ID: `prj_dDW8fpeaa5MqK0Kgcar07gyxIYEt`. No application deployment has been performed.
- Requested real-account email: `stylexjaser@gmail.com`. No account/password has been created or reset.
- The current workspace contains substantial uncommitted work. Importing the existing GitHub revision alone would not publish the current fixes.
- Production malware-scanner endpoint, key and version are absent locally. The production configuration guard must remain enabled; development mode is not a deployment workaround.
- Pocket's mobile API base URL must use the verified deployed application origin once deployment succeeds, not an unverified default domain.

## Acceptance evidence

- Remote migration history ends at `20260919_pocket_to_solo_upgrade_release_gate.sql`.
- Both SQL invariant suites pass.
- Authentication, product selection, profile onboarding, case creation, public token access, proof review, payment allocation, receipt creation, and reporting pass in staging without mock data.
- RLS cross-tenant denial checks pass for both QA businesses.
- The production release remains blocked until this evidence is attached to the release record.
