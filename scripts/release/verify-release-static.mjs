import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const read = (path) => readFileSync(resolve(root, path), "utf8");
const json = (path) => JSON.parse(read(path));
const failures = [];
const passes = [];
const check = (condition, success, failure) => {
  if (condition) passes.push(success);
  else failures.push(failure);
};

const webPackage = json("package.json");
const mobilePackage = json("mobile/package.json");
const mobileApp = json("mobile/app.json");
const releaseVersion = "1.0.0-rc.1";

check(webPackage.version === releaseVersion, `web version is ${releaseVersion}`, `web version must be ${releaseVersion}`);
check(mobilePackage.version === mobileApp.expo.version, "mobile package and Expo versions agree", "mobile package and Expo versions disagree");
check(webPackage.scripts?.typecheck && webPackage.scripts?.lint && webPackage.scripts?.build, "web quality commands exist", "web quality commands are incomplete");
check(mobilePackage.scripts?.typecheck && mobilePackage.scripts?.lint && mobilePackage.scripts?.export, "mobile quality commands exist", "mobile quality commands are incomplete");

for (const required of [
  ".github/workflows/release-candidate.yml",
  "docs/COMMERCIAL_V1_RELEASE_VALIDATION.md",
  "docs/MONITORING_AND_INCIDENT_OWNERSHIP.md",
  "docs/POCKET_TO_SOLO_MIGRATION.md",
  "docs/POCKET_V1_RELEASE_GATE.md",
  "release/v1.0.0-rc.1/RELEASE_CHECKLIST.md",
  "release/v1.0.0-rc.1/RELEASE_NOTES.md",
  "release/v1.0.0-rc.1/SCOPE_FREEZE.md",
  "release/v1.0.0-rc.1/EVIDENCE_INDEX.md",
  "supabase/tests/enterprise_security_invariants.sql",
  "supabase/tests/production_integration_invariants.sql",
]) check(existsSync(resolve(root, required)), `${required} exists`, `${required} is missing`);

const migrations = readdirSync(resolve(root, "supabase/migrations"))
  .filter((name) => name.endsWith(".sql"))
  .sort((left, right) => left.localeCompare(right));
check(migrations.length > 0, `${migrations.length} ordered migrations found`, "no migrations found");
check(new Set(migrations).size === migrations.length, "migration filenames are unique", "duplicate migration filenames found");
check(migrations.at(-1) === "20260919_pocket_to_solo_upgrade_release_gate.sql", "expected release migration head found", `unexpected migration head: ${migrations.at(-1)}`);

const migrationsWithoutRollback = migrations.filter((name) => !/rollback/iu.test(read(`supabase/migrations/${name}`)));
check(
  migrationsWithoutRollback.length === 0,
  "every migration documents rollback",
  `migrations without rollback instructions: ${migrationsWithoutRollback.join(", ")}`,
);

const securityFindings = read("docs/SECURITY_FINDINGS.md");
const highFindingRows = securityFindings
  .split(/\r?\n/u)
  .filter((line) => /^\|\s*High\s*\|/u.test(line));
const acceptedHighStatuses = new Set([
  "Source remediated; staging verification pending",
  "Verified in staging",
]);
const highFindingsWithoutSourceRemediation = highFindingRows.filter((line) => {
  const columns = line.split("|").map((value) => value.trim());
  return !acceptedHighStatuses.has(columns[2]);
});
check(
  highFindingsWithoutSourceRemediation.length === 0,
  "every High finding records implemented source remediation and an explicit verification state",
  `${highFindingsWithoutSourceRemediation.length} High security findings still have unresolved source remediation`,
);

const checklist = read("release/v1.0.0-rc.1/RELEASE_CHECKLIST.md");
check(/Release decision:\s*BLOCKED/iu.test(checklist), "unsigned candidate remains blocked", "candidate checklist must remain BLOCKED until evidence is signed");
check(!/Release decision:\s*APPROVED/iu.test(checklist), "release is not prematurely approved", "release checklist is prematurely approved");

for (const message of passes) process.stdout.write(`PASS ${message}\n`);
for (const message of failures) process.stderr.write(`FAIL ${message}\n`);
process.stdout.write(`Release static gate: ${passes.length} passed, ${failures.length} failed.\n`);
process.exitCode = failures.length ? 1 : 0;
