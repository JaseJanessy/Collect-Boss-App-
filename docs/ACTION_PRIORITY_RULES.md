# Action priority rules

The Action Centre is an operational queue, not an analytics or notification feed. Its ordering and totals are produced by `public.action_centre_dashboard`; the browser only formats the returned values.

## Deterministic ordering

1. Severity: `critical`, `high`, `medium`, then `low`.
2. Due timestamp: oldest due item first; items without a due timestamp follow dated items.
3. Creation timestamp: oldest item first.
4. Action UUID: stable final tie-breaker.

The dashboard requests five rows, so these rules define the five items users see first. The full Action Centre uses the same ordering with 25-row incremental pages.

## Default severity by source

| Queue | Source condition | Default severity |
| --- | --- | --- |
| Overdue promises | Promise date passed with outstanding balance | High |
| Payment proofs | Submitted proof awaits creditor review | Medium |
| New disputes | Structured dispute awaits review | Medium |
| Missing evidence | Active overdue case has no active evidence | Critical at 90+ days, high at 30+ days, otherwise medium |
| Approvals | Pending financial adjustment | High for write-offs, otherwise medium |
| Failed integrations | Accounting connection is in `error` state | High |
| Compliance alerts | Verification rejected/restricted or payment-link restriction active | Critical while restricted, otherwise high |
| Payment plans | Missed instalment | High; due instalment is medium |
| Follow-ups | Scheduled follow-up timestamp reached | Medium |

`action_centre_refresh_priority_gaps` materialises sources that are not domain events and closes their work when the underlying condition clears. User dismissal is preserved; a completed item reopens only if the same underlying condition recurs.

## Time and financial handling

- `due_at` is stored as `timestamptz`. “Today” and “next 7 days” are compared as civil dates in the tenant’s configured IANA timezone inside PostgreSQL.
- Dashboard financial totals use stored ledger `outstanding_minor` values and deduplicate multiple actions for the same case. No cross-currency sum or FX conversion is performed.
- Case amount categories come from the authoritative case ledger, `case_recovery_amounts`, approved payments, and unresolved proof submissions. Unverified proof value is displayed separately and is never credited to the balance.

## Permissions

- Every query is pinned to `my_business_id()`.
- Users with `case.manage` may filter across tenant assignees.
- Other roles see only their own or unassigned work. Supplying another assignee filter cannot expand that base scope.
- Direct actions continue to enforce the destination route’s permission checks.

## Rollback

Before rollback, deploy the previous UI/API so it no longer calls the new RPCs. Then run:

```sql
begin;
delete from public.action_centre_items
where type in ('missing_evidence','approval_required','integration_failed','compliance_alert');
drop function if exists public.action_centre_dashboard(text,text,text,text,text,text,integer,integer);
drop function if exists public.action_centre_refresh_priority_gaps(integer);
drop function if exists public.action_centre_queue(text);
commit;
```

The rollback deletes only queue projections created by this migration; it does not delete cases, evidence, adjustments, integration records, compliance records, payments, promises, or disputes.
