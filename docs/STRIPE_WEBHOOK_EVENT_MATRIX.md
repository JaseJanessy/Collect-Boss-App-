# Stripe Webhook Event Matrix

The signed Stripe event is a delivery notice, not the subscription-state authority. For every subscription-affecting event, CollectBoss retrieves the current Stripe subscription and performs deterministic upserts before marking the event processed.

| Stripe event | Current-object fetch | CollectBoss action | Retry behavior |
| --- | --- | --- | --- |
| `checkout.session.completed` | Referenced subscription | Synchronize subscription and entitlement after session, subscription, customer, and persisted mapping agree | 500 until safe sync completes |
| `customer.subscription.created`, `.updated`, `.deleted` | Current subscription | Synchronize current state; a canceled current state receives the free entitlement | 500 until safe sync completes |
| `invoice.payment_succeeded`, `.failed` | Invoice subscription | Synchronize current subscription state | 500 until safe sync completes |
| `charge.refunded` | None | Record a redacted refund outcome; entitlement is unchanged | 500 on event-store failure |
| Other signed event | None | Record `unhandled_event_type`; no state mutation | 200 |

## Idempotency proof

`billing_events.stripe_event_id` is unique. The handler first inserts an unprocessed row to claim delivery. A duplicate returns `done` only when a previous handler completed; an incomplete row is replayed with idempotent upserts from Stripe's current object. The handler never upserts an event row as unprocessed, so a duplicate cannot reset `processed` from `true` to `false`.

Only an event ID, type, timestamps, outcome, and optional resolved business ID are stored. Raw webhook bodies, signatures, payment data, and Stripe errors are never stored or logged.
