import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { GenericContainer, Wait } from "testcontainers";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
    redisUrl: string;
  }
}

// Runs once before all integration tests: start a throwaway Postgres and Redis in
// Docker, apply the real migrations, and hand both URLs to the tests. The same
// images as docker-compose.yml, so tests and development use the same versions.
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const [container, redis] = await Promise.all([
    new PostgreSqlContainer("postgres:17").start(),
    // A plain container: Redis needs no setup beyond "accepting connections".
    new GenericContainer("redis:7")
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage("Ready to accept connections"))
      .start(),
  ]);
  const databaseUrl = container.getConnectionUri();
  const redisUrl = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;

  // `migrate deploy` applies the committed migration files as they are (unlike
  // `migrate dev`, it never generates new ones), exactly as a deploy would.
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    cwd: fileURLToPath(new URL("../../../packages/db", import.meta.url)),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "pipe",
  });

  project.provide("databaseUrl", databaseUrl);
  project.provide("redisUrl", redisUrl);

  return async () => {
    await Promise.all([container.stop(), redis.stop()]);
  };
}
