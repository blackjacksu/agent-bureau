import { defineConfig } from "vitest/config";
import path from "node:path";

// Tests run against sources (no build needed); runtime resolves @agentmap/* via package exports -> dist.
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@agentmap\/(contracts|db|matching|offers)$/, replacement: path.resolve(__dirname, "packages/$1/src/index.ts") },
    ],
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts", "tools/*/test/**/*.test.ts", "test/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts", "apps/*/src/**/*.ts", "tools/*/src/**/*.ts"],
      exclude: ["**/dist/**", "**/test/**", "**/fixtures/**", "**/src/index.ts", "**/src/cli.ts", "**/playwright.d.ts", "apps/mcp-server/src/tools/**", "apps/mcp-server/src/rest/**", "apps/mcp-server/src/services/**", "apps/mcp-server/src/middleware/*.ts", "apps/indexer/src/jobs/**", "apps/verifier/src/verifier-types.ts"],
      reporter: ["text", "json-summary"],
      // Plan 17.8 gates, enforced at repo level (per-package suites also run in CI).
      thresholds: { lines: 85, branches: 70, functions: 70, statements: 85 },
    },
  },
});
