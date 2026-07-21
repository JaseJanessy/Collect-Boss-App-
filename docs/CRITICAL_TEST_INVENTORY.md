# Critical Test Inventory

| Risk | Automated coverage | Boundary |
| --- | --- | --- |
| Balance loss or inflation | Partial, full, overpayment, reversal, and duplicate approval tests | Pure financial projection plus database uniqueness simulation |
| Payment-plan allocation | Partial allocation, deterministic ordering, overdue/default behavior, early payoff, reversal, duplicate delivery | Pure allocation projection |
| Case lifecycle | Invalid input and authoritative RPC contract checks | Live RPC transition rules still require ephemeral Supabase coverage |
| Public capabilities | Valid, expired, revoked, used-format, and wrong-purpose tokens | Mocked service-client boundary; no token or secret is logged |
| Tenant authorization | Two owners resolving the same case ID | Server helper verifies business ownership before returning scope |
| Storage isolation | RLS/storage migration contract checks and server-only upload paths | Actual object-policy enforcement requires Supabase staging tests |
| Stripe webhooks | Signature, event claim, concurrent duplicate, retry, completed duplicate, ordering contract checks | Mocked event-store boundary; live Stripe replay remains manual |

The covered Vitest helpers currently report 34.66% statements and 40.60% lines across the explicitly included critical modules. This is a focused baseline, not a global quality threshold.
