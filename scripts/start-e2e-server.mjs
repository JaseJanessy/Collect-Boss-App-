import { spawn } from "node:child_process";

const restrictedEnvironmentNames = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
];

const populatedRestrictedNames = restrictedEnvironmentNames.filter((name) => process.env[name]);
if (populatedRestrictedNames.length > 0) {
  throw new Error(
    `E2E tests refuse to start with server secrets present: ${populatedRestrictedNames.join(", ")}.`,
  );
}

if (process.env.NEXT_PUBLIC_APP_ENV && process.env.NEXT_PUBLIC_APP_ENV !== "development") {
  throw new Error("E2E tests only run against explicit local development mode.");
}

const child = spawn(
  process.execPath,
  ["./node_modules/next/dist/bin/next", "dev", "--webpack", "--hostname", "127.0.0.1", "--port", "3100"],
  {
    env: {
      ...process.env,
      NEXT_PUBLIC_APP_ENV: "development",
      NEXT_PUBLIC_ENABLE_MOCK_DATA: "true",
      ENABLE_MOCK_DATA: "true",
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3100",
    },
    stdio: "inherit",
  },
);

child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});

let stopping = false;

function stopServer(signal) {
  if (stopping) {
    return;
  }

  stopping = true;
  child.once("exit", () => process.exit(0));
  child.kill(signal);

  // Playwright terminates webServer processes after a run. On Windows, keeping
  // this signal handler alive after Next exits leaves the test command hanging.
  setTimeout(() => process.exit(0), 2_000).unref();
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => stopServer(signal));
}
