import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("release workflow gates web, mobile, security, performance, build, and browser checks", () => {
  const workflow = read(".github/workflows/release-candidate.yml");
  for (const command of [
    "npm run release:check", "npm run typecheck", "npm run lint", "npm run test:secrets",
    "npm run test:contracts", "npm run test:unit", "npm run test:integration", "npm run test:performance",
    "npm run build", "npm run test:e2e", "npm run export",
  ]) assert.match(workflow, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")));
  assert.match(workflow, /fetch-depth: 0/u);
  assert.match(workflow, /permissions:\s*\n\s*contents: read/u);
});

test("critical scenario and negative release paths are explicit and evidence-backed", () => {
  const validation = read("docs/COMMERCIAL_V1_RELEASE_VALIDATION.md");
  for (const value of [
    "Sign up Owner A", "Upload a synthetic PDF", "malware scan", "human review", "cited amount",
    "regenerate debt truth", "partial dispute", "promise or payment plan", "payment proof",
    "candidate matching", "Approve the correct match once", "zero outstanding", "statement/report/evidence",
    "audit chain", "Owner B",
  ]) assert.match(validation, new RegExp(value, "iu"));
  for (const value of [
    "Cross-tenant", "Unauthorized approval", "Duplicate payment transaction", "Stripe webhook",
    "Accounting sync timeout", "Expired, revoked", "Malware scanner unavailable", "Application rollback",
  ]) assert.match(validation, new RegExp(value, "iu"));
});

test("backup restore tooling refuses destructive or production-like targets by default", () => {
  const script = read("scripts/release/backup-restore.ps1");
  assert.match(script, /RESTORE_TO_EMPTY_NON_PRODUCTION_DATABASE/u);
  assert.match(script, /Source and restore database URLs must differ/u);
  assert.match(script, /PRODUCTION_DATABASE_HOST/u);
  assert.match(script, /Restore target is not empty; refusing destructive restore/u);
  assert.match(script, /pg_dump/u);
  assert.match(script, /pg_restore/u);
  assert.match(script, /dump_sha256/u);
});

test("release checklist cannot be mistaken for approval or a signed release", () => {
  const checklist = read("release/v1.0.0-rc.1/RELEASE_CHECKLIST.md");
  assert.match(checklist, /Release decision: BLOCKED/u);
  assert.match(checklist, /Tag: withheld/u);
  assert.match(checklist, /Critical\/High gate is PASS/u);
  assert.doesNotMatch(checklist, /Release decision: APPROVED/u);
});

test("the static security gate distinguishes source remediation from staging approval", () => {
  const gate = read("scripts/release/verify-release-static.mjs");
  const findings = read("docs/SECURITY_FINDINGS.md");
  const checklist = read("release/v1.0.0-rc.1/RELEASE_CHECKLIST.md");
  assert.match(gate, /highFindingsWithoutSourceRemediation/u);
  assert.match(findings, /\| Severity \| Status \| Finding \|/u);
  assert.match(findings, /\| High \| Source remediated; staging verification pending \|/u);
  assert.doesNotMatch(findings, /^\| High \| (?:Open|Unresolved) \|/mu);
  assert.match(checklist, /Release decision: BLOCKED/u);
  assert.match(checklist, /High findings still require staging verification/u);
});

test("scope freeze clearly labels unsupported commercial claims", () => {
  const scope = read("release/v1.0.0-rc.1/SCOPE_FREEZE.md");
  for (const claim of ["lawyer marketplace", "legal-advice claim", "custody", "production mock data", "unreviewed AI decision"]) {
    assert.match(scope, new RegExp(claim, "iu"));
  }
});

test("monitoring requires named owners, alert drills, and redacted payloads", () => {
  const monitoring = read("docs/MONITORING_AND_INCIDENT_OWNERSHIP.md");
  for (const signal of ["Public availability", "API 5xx", "Database availability", "Tenant/RLS canary", "Malware scanning", "Stripe webhooks", "Audit integrity"]) {
    assert.match(monitoring, new RegExp(signal.replace("/", "\\/"), "u"));
  }
  assert.match(monitoring, /replace every `Unassigned` value/u);
  assert.match(monitoring, /must not contain credentials/u);
});
