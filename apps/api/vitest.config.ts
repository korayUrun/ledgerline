import { defineConfig } from "vitest/config";

// Two projects:
//   unit        — src/**/*.test.ts, pure functions, no Docker needed
//   integration — test/**/*.test.ts, the real app against a real Postgres started by
//                 Testcontainers (needs Docker; GitHub's ubuntu runners have it)
// `pnpm test` runs both; `pnpm test:unit` runs only the fast ones.
export default defineConfig({
  test: {
    projects: [
      {
        test: { name: "unit", include: ["src/**/*.test.ts"] },
      },
      {
        test: {
          name: "integration",
          include: ["test/**/*.test.ts"],
          globalSetup: ["test/global-setup.ts"],
          // The test files share one database, so they run one after another.
          fileParallelism: false,
          hookTimeout: 120_000, // first run pulls the postgres image
          testTimeout: 30_000,
        },
      },
    ],
  },
});
