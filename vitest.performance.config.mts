import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ["tests/performance/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    clearMocks: true,
    restoreMocks: true,
  },
});
