import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { INestApplication } from "@nestjs/common";
import { createPrismaClient, DEMO_USER_EMAIL, type PrismaClient } from "@ledgerline/db";
import type { ContractTerms } from "@ledgerline/schemas";
import { inject } from "vitest";
import { createApp } from "../src/app.js";
import type { ApiConfig } from "../src/config.js";

export type Result<T> = { status: number; body: T };

export type TestApp = {
  nest: INestApplication; // to reach services directly (e.g. the state machine)
  config: ApiConfig; // the worker in a test must share the same database, Redis and storage
  baseUrl: string;
  // Direct database access, for arranging data and for "break it" steps that
  // change rows behind the API's back.
  prisma: PrismaClient;
  // T is the response type the test expects; it is not checked at runtime.
  request: <T = unknown>(method: string, urlPath: string, body?: unknown) => Promise<Result<T>>;
  upload: <T = unknown>(
    urlPath: string,
    fileName: string,
    content: string | Buffer,
    type: string,
  ) => Promise<Result<T>>;
  close: () => Promise<void>;
};

// Starts the real app (same createApp as main.ts) on a random free port.
export async function startTestApp(): Promise<TestApp> {
  const storageDir = await mkdtemp(path.join(tmpdir(), "ledgerline-test-"));
  const config: ApiConfig = {
    databaseUrl: inject("databaseUrl"),
    redisUrl: inject("redisUrl"),
    port: 0,
    storageDir,
  };
  const app: INestApplication = await createApp(config, ["error"]);
  await app.listen(0);
  const baseUrl = await app.getUrl();
  const prisma = createPrismaClient(config.databaseUrl);

  async function toResult<T>(response: Response): Promise<Result<T>> {
    const text = await response.text();
    return { status: response.status, body: (text ? JSON.parse(text) : null) as T };
  }

  return {
    nest: app,
    config,
    baseUrl,
    prisma,
    request: async <T>(method: string, urlPath: string, body?: unknown) =>
      toResult<T>(
        await fetch(`${baseUrl}${urlPath}`, {
          method,
          headers: body === undefined ? {} : { "content-type": "application/json" },
          body: body === undefined ? null : JSON.stringify(body),
        }),
      ),
    upload: async <T>(
      urlPath: string,
      fileName: string,
      content: string | Buffer,
      type: string,
    ) => {
      const form = new FormData();
      // A Buffer is copied into a Uint8Array, which Blob accepts on every Node version.
      const part = typeof content === "string" ? content : new Uint8Array(content);
      form.append("file", new Blob([part], { type }), fileName);
      return toResult<T>(await fetch(`${baseUrl}${urlPath}`, { method: "POST", body: form }));
    },
    close: async () => {
      await prisma.$disconnect();
      await app.close();
      await rm(storageDir, { recursive: true, force: true });
    },
  };
}

// Empties every table and recreates the demo user, so each test starts clean.
// TRUNCATE … CASCADE is the fastest way and ignores foreign-key order.
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE "SettlementLine", "Settlement", "ContractTerms", "Contract", "Expense",
              "TicketSale", "Show", "Artist", "Venue", "AuditLog", "User" CASCADE`,
  );
  await prisma.user.create({ data: { email: DEMO_USER_EMAIL, name: "Demo Manager" } });
}

// A versus deal: $5,000 guarantee vs 85% of net after expenses, total expense cap $6,000.
export const VERSUS_TERMS: ContractTerms = {
  deal: { type: "versus", guaranteeCents: 500_000, artistShareBps: 8_500, clauseRef: "§4.2" },
  expensePolicy: {
    allowedCategories: ["production", "advertising", "catering", "security"],
    categoryCaps: [{ category: "advertising", capCents: 150_000 }],
    totalCapCents: 600_000,
    clauseRef: "§5",
  },
  bonus: null,
};

// GBOR $16,800, tax $840, fees $336 → NBOR $15,624.
export const TICKET_SALES_CSV = `tier,qty_sold,comps,price,tax,fees
GA,320,25,35.00,560.00,224.00
VIP,70,10,80.00,280.00,112.00
`;
