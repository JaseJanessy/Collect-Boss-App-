# Billing refund authority

CollectBoss does not expose a customer-facing refund API. Subscription refunds
are handled by authorised billing staff in the Stripe Dashboard after verifying
the business owner, invoice, and applicable Malaysian consumer-law obligation.

Staff must record the support reference and Stripe refund ID in the internal
billing/audit process. A refund alone does not directly change entitlements;
Stripe lifecycle events remain the source of truth for subscription state.

Partial-period refunds are not offered by default. Exceptions require an
authorised support decision and must follow the published Terms of Service.
