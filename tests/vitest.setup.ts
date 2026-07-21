import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

const deploymentSecrets = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
];

if (process.env.NEXT_PUBLIC_APP_ENV && process.env.NEXT_PUBLIC_APP_ENV !== "development") {
  throw new Error("Vitest refuses staging or production application configuration.");
}

for (const name of deploymentSecrets) {
  if (process.env[name]) {
    throw new Error(`Vitest refuses to run while ${name} is present.`);
  }
}

// Keep tests offline. No inherited public URL or key can create a remote client.
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
delete process.env.NEXT_PUBLIC_APP_URL;
process.env.NEXT_PUBLIC_APP_ENV = "development";
process.env.NEXT_PUBLIC_ENABLE_MOCK_DATA = "true";
process.env.ENABLE_MOCK_DATA = "true";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
