# Commercial V1 scope freeze

Candidate: `v1.0.0-rc.1`  
Freeze state: proposed, not active until the candidate commit exists and release owner signs.  
Allowed changes after freeze: Critical/High security fixes, data-integrity fixes, failed release-gate fixes, deployment/rollback corrections, and test-only evidence corrections.  
Forbidden changes: new product workflows, new provider capabilities, visual redesigns, speculative refactors, new pricing, and unsupported marketing claims.

## Supported in this candidate

- Tenant-scoped web case, debtor, receivable, communication, promise, dispute, payment, evidence, reporting, audit, and controlled legal-handoff workflows.
- Public debtor capabilities only through scoped, expiring, revocable tokens.
- Stripe for CollectBoss subscription billing only; CollectBoss does not custody debtor funds.
- Resend email and Xero/QuickBooks integrations only when their production configuration and release drills pass.
- Mobile companion evidence capture/review against the released backend schema; it is not a complete replacement for the web application.

## Deferred or unsupported

- No lawyer marketplace, guaranteed recovery, legal representation, or legal-advice claim.
- No custody, transfer, or settlement of debtor funds by CollectBoss or Stripe.
- No production mock data or provider fallback.
- No unreviewed AI decision may alter a balance, approve a payment, contact a debtor, or trigger escalation.
- Gallery, booking, general event-domain services, and offline caching of private data are unsupported.
- Provider integrations are unsupported until their environment-specific staging and production gates are signed.
