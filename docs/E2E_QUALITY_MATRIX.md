# Prompt 48 quality matrix

## Automated local browser coverage

`npm run test:e2e` starts the app only in explicit local development mode with mock data enabled. It refuses to start when server secrets are present and never contacts Supabase or Stripe.

| Journey or quality gate | Automated coverage | Boundary requiring a configured staging environment |
| --- | --- | --- |
| Landing navigation, keyboard menu, skip link, landmarks | `critical-journeys.spec.ts` | VoiceOver/NVDA screen-reader walkthrough |
| Signup labels and validation feedback | `critical-journeys.spec.ts` | Real email confirmation and password-policy behavior |
| Public payment and acknowledgement token rejection | `critical-journeys.spec.ts` | Valid token, payment-proof upload, and acknowledgement against isolated test data |
| Portrait/landscape phone, tablet, desktop overflow | `critical-journeys.spec.ts` | Visual review of dense dashboard tables with representative tenant data |
| Manifest and install icons | `pwa-cache-policy.spec.ts` | HTTPS install/update prompt on Android Chrome and iOS Safari |
| Private API cache safety | `pwa-cache-policy.spec.ts` | CDN/proxy header verification after deployment |

## PWA cache policy

The application is manifest-enabled but intentionally does not register a service worker. Private pages, API responses, payment evidence, public capability pages, and signed URLs therefore have no application-managed offline cache. All `/api/*` responses send `Cache-Control: no-store, max-age=0` and vary by `Cookie, Authorization`.

This is deliberate until a future service worker has a reviewed allowlist limited to immutable, public build assets. Offline private-route support is out of scope because serving stale debtor or financial data would be unsafe.

## Performance evidence and next measurement

The browser suite keeps a local responsive smoke test focused on overflow and interactive navigation, rather than asserting timing against a development server. Development compilation and local hardware make timing thresholds unreliable. Before release, run Lighthouse or WebPageTest on the configured staging URL for `/landing`, `/login`, and an authenticated dashboard route, and record LCP, INP, CLS, JavaScript transfer size, and image optimization results.
