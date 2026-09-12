import { mkdirSync, writeFileSync } from 'node:fs';

// Run against the built app on loopback, never against customer accounts.
const base = process.env.QA_BASE_URL || 'http://127.0.0.1:3101';
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname)) {
  throw new Error('This smoke test accepts only a local production-build server.');
}
const cases = [
  { path: '/', status: 307, location: '/landing', streamedRedirect: '/landing' },
  { path: '/login', status: 200, text: 'Welcome Back' },
  { path: '/brand/icon.svg', status: 200, contentType: 'image/svg+xml' },
  { path: '/beta-welcome', status: 308, location: '/' },
  { path: '/dev/billing-debug', status: 404 },
  { path: '/dev/pocket-ux', status: 404 },
  { path: '/api/workspace/context', status: 401 },
  { path: '/api/pocket/customers', status: 401 },
  { path: '/api/search', status: 401 },
  { path: '/reset-password', status: 200, text: 'Reset link required' },
  { path: '/auth/callback', status: 307, location: '/login', query: { error: 'auth_callback_failed' } },
  { path: '/cases?status=overdue', status: 307, location: '/login', query: { redirect: '/cases?status=overdue' } },
];
const results = [];
for (const item of cases) {
  try {
    const response = await fetch(new URL(item.path, base), { redirect: 'manual', signal: AbortSignal.timeout(20000) });
    const body = item.text || item.streamedRedirect ? await response.text() : '';
    const location = response.headers.get('location');
    // Next 16 can emit an RSC redirect after streaming has committed HTTP 200.
    // Require the exact redirect instruction, never accept an arbitrary 200.
    const streamed = response.status === 200 && item.streamedRedirect
      && body.includes(`NEXT_REDIRECT;replace;${item.streamedRedirect};307;`);
    const redirectUrl = location ? new URL(location, base) : null;
    const passed = (response.status === item.status || streamed)
      && (!item.location || streamed || redirectUrl?.pathname === item.location)
      && (!item.query || Object.entries(item.query).every(([key, value]) => redirectUrl?.searchParams.get(key) === value))
      && (!item.text || body.includes(item.text))
      && (!item.contentType || response.headers.get('content-type')?.includes(item.contentType));
    results.push({ path: item.path, status: response.status, passed: Boolean(passed), ...(streamed ? { redirectTransport: 'streamed-rsc' } : {}) });
  } catch { results.push({ path: item.path, passed: false, error: 'Request unavailable' }); }
}
mkdirSync('output/verification', { recursive: true });
writeFileSync('output/verification/public-routing.json', JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2) + '\n');
console.log(JSON.stringify(results, null, 2));
if (results.some(result => !result.passed)) process.exitCode = 1;
