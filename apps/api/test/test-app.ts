import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { INestApplication } from "@nestjs/common";
import {
  createPrismaClient,
  DEMO_USER_EMAIL,
  DEMO_USER_PASSWORD,
  hashPassword,
  type PrismaClient,
} from "@ledgerline/db";
import type Anthropic from "@anthropic-ai/sdk";
import type { ContractTerms } from "@ledgerline/schemas";
import { inject } from "vitest";
import { createApp } from "../src/app.js";
import { userActor, type Actor } from "../src/common/actor.js";
import type { ApiConfig } from "../src/config.js";
import { hashSessionToken } from "../src/modules/auth/session-token.js";
import { FakeLlmClient } from "../src/modules/llm/fake-llm-client.js";

export type Result<T> = { status: number; body: T };

// Every test request is made as the demo user, through a session that
// resetDatabase creates with this token. Tests of the login itself send their own
// headers (or none).
export const TEST_SESSION_TOKEN = "test-session-token";
const AUTH_HEADERS = { authorization: `Bearer ${TEST_SESSION_TOKEN}` };

export type TestApp = {
  nest: INestApplication; // to reach services directly (e.g. the state machine)
  config: ApiConfig; // the worker in a test must share the same database, Redis and storage
  baseUrl: string;
  // Direct database access, for arranging data and for "break it" steps that
  // change rows behind the API's back.
  prisma: PrismaClient;
  // T is the response type the test expects; it is not checked at runtime.
  // Logged in as the demo user unless `headers` says otherwise.
  request: <T = unknown>(
    method: string,
    urlPath: string,
    body?: unknown,
    headers?: Record<string, string>,
  ) => Promise<Result<T>>;
  // A raw fetch against the app, logged in as the demo user (for streams and files).
  fetch: (urlPath: string, init?: RequestInit) => Promise<Response>;
  upload: <T = unknown>(
    urlPath: string,
    fileName: string,
    content: string | Buffer,
    type: string,
  ) => Promise<Result<T>>;
  // Scripts what "Claude" answers the API's agent from now on: model call 1 gets
  // replies[0], call 2 replies[1]… Returns the requests sent, for assertions.
  scriptLlm: (...replies: Anthropic.Message[]) => Anthropic.MessageCreateParamsNonStreaming[];
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
    llm: {
      client: "fake",
      apiKey: null,
      extractionModel: "claude-opus-5-5",
      agentModel: "claude-sonnet-5-5",
      timeoutMs: 1_000,
      maxRetries: 0,
    },
  };
  // One fake for the whole app; each test scripts its own replies.
  let replies: Anthropic.Message[] = [];
  let sent: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const llm = new FakeLlmClient((params) => {
    // A copy: the agent loop keeps appending to the same messages array.
    sent.push(JSON.parse(JSON.stringify(params)) as typeof params);
    const reply = replies[sent.length - 1];
    if (!reply) throw new Error(`no scripted LLM reply for call ${sent.length}`);
    return reply;
  });
  const app: INestApplication = await createApp(config, ["error"], { llmClient: llm });
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
    request: async <T>(
      method: string,
      urlPath: string,
      body?: unknown,
      headers: Record<string, string> = AUTH_HEADERS,
    ) =>
      toResult<T>(
        await fetch(`${baseUrl}${urlPath}`, {
          method,
          headers:
            body === undefined ? headers : { ...headers, "content-type": "application/json" },
          body: body === undefined ? null : JSON.stringify(body),
        }),
      ),
    fetch: (urlPath: string, init: RequestInit = {}) =>
      fetch(`${baseUrl}${urlPath}`, {
        ...init,
        headers: { ...AUTH_HEADERS, ...(init.headers as Record<string, string> | undefined) },
      }),
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
      return toResult<T>(
        await fetch(`${baseUrl}${urlPath}`, { method: "POST", body: form, headers: AUTH_HEADERS }),
      );
    },
    scriptLlm: (...scripted) => {
      replies = scripted;
      sent = [];
      return sent;
    },
    close: async () => {
      await prisma.$disconnect();
      await app.close();
      await rm(storageDir, { recursive: true, force: true });
    },
  };
}

// scrypt is slow on purpose, so the demo password is hashed once per test file.
let demoPasswordHash: Promise<string> | null = null;

// Empties every table and recreates the demo user, logged in with
// TEST_SESSION_TOKEN, so each test starts clean. TRUNCATE … CASCADE is the fastest
// way and ignores foreign-key order. Returns the demo user as an actor.
export async function resetDatabase(prisma: PrismaClient): Promise<Actor> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE "Session", "ExpenseFlag", "AgentStep", "AgentRun", "SettlementLine", "Settlement", "ContractTerms", "Contract", "Expense",
              "TicketSale", "Show", "Artist", "Venue", "AuditLog", "User" CASCADE`,
  );
  demoPasswordHash ??= hashPassword(DEMO_USER_PASSWORD);
  const user = await prisma.user.create({
    data: {
      email: DEMO_USER_EMAIL,
      name: "Demo Manager",
      passwordHash: await demoPasswordHash,
      sessions: {
        create: {
          tokenHash: hashSessionToken(TEST_SESSION_TOKEN),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      },
    },
  });
  return userActor(user.id);
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
