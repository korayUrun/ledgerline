import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

// Runs once before all integration tests: start a throwaway Postgres in Docker,
// apply the real migrations to it, and hand its URL to the tests. The same image
// as docker-compose.yml, so tests and development use the same database version.
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const container = await new PostgreSqlContainer("postgres:17").start();
  const databaseUrl = container.getConnectionUri();

  // `migrate deploy` applies the committed migration files as they are (unlike
  // `migrate dev`, it never generates new ones), exactly as a deploy would.
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    cwd: fileURLToPath(new URL("../../../packages/db", import.meta.url)),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "pipe",
  });

  project.provide("databaseUrl", databaseUrl);

  return async () => {
    await container.stop();
  };
}
