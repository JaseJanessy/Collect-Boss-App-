# Automated Test Foundation

## Commands

- `npm run test:contracts` runs the existing Node contract tests.
- `npm run test:unit` runs isolated Vitest unit, integration-helper, and component tests.
- `npm run test:coverage` emits terminal and `coverage/coverage-summary.json` coverage output.
- `npm run test:ci` runs contract tests and the covered Vitest suite.

Vitest uses Node by default and JSDOM only for component tests. Its setup rejects a staging or production app environment and any service-role or Stripe secret, then clears public Supabase values and enables development-only mock mode. It therefore cannot connect to a real Supabase or Stripe account.

The included factories provide fixed identifiers and a fixed clock. Database tests remain a separate staging/ephemeral-Supabase concern: do not point the local suite at production. Async Server Components are intentionally excluded from unit tests; Next.js recommends E2E coverage for those flows.

Critical-module coverage is intentionally a focused baseline rather than a global threshold; see `docs/CRITICAL_TEST_INVENTORY.md` for the current inventory and measured result. `StatusBadge` has DOM behavior coverage; expand measured coverage alongside feature work.
