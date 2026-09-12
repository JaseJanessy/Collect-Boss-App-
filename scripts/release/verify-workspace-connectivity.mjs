import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseEnv } from 'node:util';

// Read-only verification: schema metadata and authentication settings only.
// Never fetch account records, print credentials, or run migrations here.
const root = process.cwd();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const report = { checkedAt: new Date().toISOString(), checks: [], missingTables: [], missingFunctions: [] };
const check = (name, passed, detail) => report.checks.push({ name, passed, detail });
async function request(path, key, accept = 'application/json', method = 'GET') {
  const response = await fetch(`${url}${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: accept },
    signal: AbortSignal.timeout(15000),
    method,
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}
function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
  });
}
try {
  check('Supabase public configuration', Boolean(url?.startsWith('https://') && anon), 'URL and public key presence; values redacted.');
  check('Server credential configured', Boolean(service), 'Required by workspace provisioning and tenant services; value redacted.');
  const mobileEnvPath = resolve(root, 'mobile/.env');
  if (existsSync(mobileEnvPath)) {
    const mobile = parseEnv(readFileSync(mobileEnvPath, 'utf8'));
    const normalize = value => (value || '').trim().replace(/\/$/, '');
    check('Mobile uses the same Supabase project', Boolean(mobile.EXPO_PUBLIC_SUPABASE_URL) && normalize(mobile.EXPO_PUBLIC_SUPABASE_URL) === normalize(url), 'Local environment comparison; no credentials displayed.');
    check('Mobile API base URL configured', Boolean(mobile.EXPO_PUBLIC_API_BASE_URL?.trim()), 'Required for workspace provisioning, product resolution and secure uploads.');
    check('Mobile API matches canonical web origin', Boolean(mobile.EXPO_PUBLIC_API_BASE_URL) && normalize(mobile.EXPO_PUBLIC_API_BASE_URL) === normalize(process.env.NEXT_PUBLIC_APP_URL), 'Physical devices require a reachable host, not localhost.');
  }
  if (!url || !anon) throw new Error('Missing Supabase public configuration.');
  const health = await request('/auth/v1/health', anon);
  check('Authentication service reachable', health.status === 200, `HTTP ${health.status}`);
  const settings = await request('/auth/v1/settings', anon);
  check('Email authentication enabled', settings.status === 200 && settings.body?.external?.email === true, `HTTP ${settings.status}`);
  const schema = await request('/rest/v1/', service || anon, 'application/openapi+json');
  check('Database schema accessible', schema.status === 200 && Boolean(schema.body?.paths), `HTTP ${schema.status}`);
  if (schema.body?.paths) {
    const paths = schema.body.paths;
    const source = sourceFiles(resolve(root, 'src')).map(path => readFileSync(path, 'utf8')).join('\n');
    const tables = [...new Set([...source.matchAll(/\.from\(["']([a-z][a-z0-9_]+)["']\)/g)].map(match => match[1]))].sort();
    const functions = [...new Set([...source.matchAll(/\.rpc\(["']([a-z][a-z0-9_]+)["']/g)].map(match => match[1]))].sort();
    report.missingTables = tables.filter(name => !paths[`/${name}`]);
    report.missingFunctions = functions.filter(name => !paths[`/rpc/${name}`]);
    check('Referenced database tables exposed', report.missingTables.length === 0, `${tables.length - report.missingTables.length}/${tables.length} table/view names exposed. Storage bucket names may appear as false positives; inspect the list.`);
    check('Referenced database functions exposed', report.missingFunctions.length === 0, `${functions.length - report.missingFunctions.length}/${functions.length} functions exposed.`);
    for (const table of ['businesses', 'business_memberships', 'business_role_settings', 'workspace_product_states', 'workspace_commercial_states', 'subscriptions', 'entitlements', 'debtors', 'obligations', 'payment_allocations', 'payment_receipts']) {
      check(`Workspace dependency: ${table}`, Boolean(paths[`/${table}`]), 'Schema exposure only; does not verify row-level access.');
    }
    await Promise.all(['businesses', 'business_memberships', 'workspace_product_states', 'obligations', 'payment_allocations'].map(async table => {
      const result = await request(`/rest/v1/${table}?select=*&limit=0`, service || anon, 'application/json', 'HEAD');
      check(`Zero-row database probe: ${table}`, result.status === 200 || result.status === 206, `HTTP ${result.status}; HEAD request, no business records read.`);
    }));
  }
} catch (error) {
  check('Connectivity check completed', false, error instanceof Error ? error.message : 'Connection unavailable');
}
report.limitations = ['Schema exposure is role-dependent; missing OpenAPI entries require confirmation against migration history.', 'Does not test existing passwords or send emails.', 'Does not prove RLS isolation or apply SQL.', 'A staging account for each product is required for authenticated end-to-end verification.'];
mkdirSync(resolve(root, 'output/verification'), { recursive: true });
writeFileSync(resolve(root, 'output/verification/workspace-connectivity.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (report.checks.some(result => !result.passed)) process.exitCode = 1;
