const baseUrl = process.env.RELEASE_BASE_URL?.trim().replace(/\/$/u, "");
if (!baseUrl) throw new Error("RELEASE_BASE_URL is required.");
const url = new URL(baseUrl);
if (url.protocol !== "https:" && !(url.hostname === "127.0.0.1" || url.hostname === "localhost")) {
  throw new Error("Release smoke tests require HTTPS except for localhost.");
}

const checks = [
  { path: "/landing", status: 200, contains: "CollectBoss" },
  { path: "/login", status: 200 },
  { path: "/terms", status: 200 },
  { path: "/privacy", status: 200 },
  { path: "/support", status: 200 },
  { path: "/pay/not-a-capability-token", status: 200, contains: "Invalid payment link" },
  { path: "/acknowledge/not-a-capability-token", status: 200, contains: "Invalid acknowledgement link" },
];

let failed = 0;
for (const check of checks) {
  const started = performance.now();
  try {
    const response = await fetch(`${baseUrl}${check.path}`, { redirect: "manual", signal: AbortSignal.timeout(15_000) });
    const body = await response.text();
    const cache = response.headers.get("cache-control") ?? "";
    const ok = response.status === check.status && (!check.contains || body.includes(check.contains));
    if (!ok) failed += 1;
    process.stdout.write(`${ok ? "PASS" : "FAIL"} ${check.path} status=${response.status} duration_ms=${Math.round(performance.now() - started)} cache=${JSON.stringify(cache)}\n`);
  } catch (error) {
    failed += 1;
    process.stderr.write(`FAIL ${check.path} ${error instanceof Error ? error.message : "request failed"}\n`);
  }
}
process.exitCode = failed ? 1 : 0;
