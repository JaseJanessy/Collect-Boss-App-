import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    include: [
      "tests/unit/**/*.test.ts",
      "tests/integration/**/*.test.ts",
      "tests/component/**/*.test.tsx",
    ],
    environment: "node",
    setupFiles: ["./tests/vitest.setup.ts"],
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: [
        "src/lib/api/request-guard.ts",
        "src/lib/billing/service.ts",
        "src/lib/financial/balance.ts",
        "src/lib/public-access/service.ts",
        "src/lib/validations/case.ts",
        "src/components/ui/status-badge.tsx",
      ],
      exclude: ["**/*.d.ts"],
    },
  },
});
