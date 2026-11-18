// Prisma client for the Ledgerline database. Only apps/api imports this package;
// web and mcp reach data over HTTP (docs/SYSTEM.md §2).
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";

// Model types (Show, Expense…), enums and the Prisma namespace (errors, Json types).
export * from "./generated/prisma/client.js";
export { DEMO_USER_EMAIL } from "./demo-user.js";

// Prisma 7 talks to Postgres through a "driver adapter": the plain `pg` driver does
// the networking and Prisma builds the queries. The caller passes the URL in, so
// this package never reads environment variables itself.
export function createPrismaClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
}
