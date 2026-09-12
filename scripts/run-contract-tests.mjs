import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve("tests");

function findContractTests(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return ["component", "fixtures", "integration", "performance", "unit"].includes(entry.name)
        ? []
        : findContractTests(path);
    }
    return entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

const tests = findContractTests(root);
const result = spawnSync(process.execPath, ["--test", ...tests], { stdio: "inherit" });
process.exit(result.status ?? 1);
