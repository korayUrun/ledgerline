import { defineConfig } from "prisma/config";

// Prisma 7 no longer reads .env by itself. Load the repo-root .env when it exists
// (local development); CI and the integration tests set DATABASE_URL directly.
try {
  process.loadEnvFile(new URL("../../.env", import.meta.url));
} catch {
  // No .env file: rely on the environment.
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Read lazily with `??` instead of prisma's env() helper, which throws when the
    // variable is missing. `prisma generate` needs no database, so it must work in
    // CI without DATABASE_URL.
    url: process.env["DATABASE_URL"] ?? "",
  },
});
