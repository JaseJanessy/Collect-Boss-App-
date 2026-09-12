import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const vitest = resolve("node_modules/vitest/vitest.mjs");
const result = spawnSync(process.execPath, [vitest, "run", "--config", "vitest.performance.config.mts", "--pool=threads", "--maxWorkers=1", "--no-file-parallelism"], { stdio: "inherit" });
process.exit(result.status ?? 1);
