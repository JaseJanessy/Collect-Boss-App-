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

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
