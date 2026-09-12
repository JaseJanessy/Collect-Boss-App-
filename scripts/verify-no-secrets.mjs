import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const roots = ["src", "scripts", "tests", "supabase", ".github", "next.config.ts", "package.json", "playwright.config.ts", "vitest.config.mts"];
const excludedDirectories = new Set(["node_modules", ".next", ".git", "coverage", "playwright-report", "test-results"]);
const patterns = [
  /sk_(?:live|test)_[A-Za-z0-9_]{12,}/,
  /whsec_[A-Za-z0-9_]{12,}/,
  /eyJ[A-Za-z0-9_-]{40,}/,
  /NEXT_PUBLIC_(?:SUPABASE_SERVICE_ROLE_KEY|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET)/,
];

function collectFiles(path, files) {
  if (!existsSync(path)) return;
  const stat = statSync(path);
  if (stat.isFile()) {
    files.push(path);
    return;
  }
  if (!stat.isDirectory() || excludedDirectories.has(path.split(/[\\/]/).at(-1))) return;
  for (const entry of readdirSync(path)) collectFiles(join(path, entry), files);
}

const files = [];
for (const root of roots) collectFiles(root, files);

const findings = files.filter((file) => {
  const content = readFileSync(file, "utf8");
  return patterns.some((pattern) => pattern.test(content));
});

if (findings.length > 0) {
  throw new Error(`Secret-like material found in source files: ${findings.join(", ")}`);
}

const historyPatterns = [
  "sk_live_[A-Za-z0-9_]{20,}",
  "whsec_[A-Za-z0-9_]{20,}",
  "eyJ[A-Za-z0-9_-]{40,}\\.[A-Za-z0-9_-]{20,}\\.[A-Za-z0-9_-]{20,}",
];
const historyFindings = [];
for (const pattern of historyPatterns) {
  try {
    const matched = execFileSync("git", [
      "log", "--all", "--format=%H", "--name-only", `-G${pattern}`, "--",
      ".", ":(exclude)scripts/verify-no-secrets.mjs", ":(exclude)**/.env.example", ":(exclude).env.local.example",
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    if (matched) historyFindings.push(matched.split(/\r?\n/).filter(Boolean).slice(0, 20).join(", "));
  } catch (error) {
    throw new Error(`Unable to complete the repository-history secret scan: ${error instanceof Error ? error.message : "git failed"}`);
  }
}
if (historyFindings.length > 0) {
  throw new Error(`Secret-like material found in repository history (commit/path only): ${historyFindings.join("; ")}`);
}

console.log(`Secret scan passed for ${files.length} source files and repository history.`);
