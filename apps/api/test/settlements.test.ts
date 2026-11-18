import { ConflictException } from "@nestjs/common";
import type {
  ApiErrorDto,
  AuditEntryDto,
  ExpenseDto,
  SettlementViewDto,
  ShowDto,
} from "@ledgerline/schemas";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SettlementStateMachine } from "../src/modules/settlements/settlement-state-machine.js";
import {
  resetDatabase,
  startTestApp,
  TICKET_SALES_CSV,
  VERSUS_TERMS,
  type TestApp,
} from "./test-app.js";

let t: TestApp;
let showId: string;
let expenses: ExpenseDto[];

beforeAll(async () => {
  t = await startTestApp();
});
afterAll(async () => {
  await t.close();
});

// Every test starts from the same show, built through the API like a user would:
// ticket sales from CSV, versus terms, four expenses (one still pending).
beforeEach(async () => {
  await resetDatabase(t.prisma);
  const venue = await t.request<{ id: string }>("POST", "/venues", { name: "Test Hall" });
  const artist = await t.request<{ id: string }>("POST", "/artists", { name: "Test Band" });
  const show = await t.request<ShowDto>("POST", "/shows", {
    name: "Test Night",
    showDate: "2026-11-06",
    venueId: venue.body.id,
    artistId: artist.body.id,
  });
  showId = show.body.id;
  await t.upload(`/shows/${showId}/ticket-sales/import`, "sales.csv", TICKET_SALES_CSV, "text/csv");
  await t.request("POST", `/shows/${showId}/terms`, VERSUS_TERMS);
  expenses = [];
  for (const expense of [
    { category: "production", description: "Crew", amountCents: 280_000, status: "allowed" },
    { category: "advertising", description: "Ads", amountCents: 190_000, status: "allowed" },
    { category: "catering", description: "Catering", amountCents: 85_000, status: "pending" },
    { category: "security", description: "Security", amountCents: 120_000, status: "allowed" },
  ]) {
    expenses.push((await t.request<ExpenseDto>("POST", `/shows/${showId}/expenses`, expense)).body);
  }
});

const compute = () => t.request<SettlementViewDto>("POST", `/shows/${showId}/settlement/compute`);
const getView = () => t.request<SettlementViewDto>("GET", `/shows/${showId}/settlement`);
const submit = () =>
  t.request<SettlementViewDto>("POST", `/shows/${showId}/settlement/submit-for-review`);
const history = async (settlementId: string) =>
  (await t.request<AuditEntryDto[]>("GET", `/audit?entity=settlement&entityId=${settlementId}`))
    .body;

describe("compute", () => {
  it("stores the engine result with its snapshot, hash and engine version", async () => {
    const { status, body } = await compute();

    expect(status).toBe(200);
    const settlement = body.settlement!;
    expect(settlement.status).toBe("computed");
    expect(settlement.version).toBe(1);
    expect(settlement.termsVersion).toBe(1);
    expect(settlement.engineVersion).toBe("1.0.0");
    expect(settlement.inputsHash).toMatch(/^[0-9a-f]{64}$/);
    // NBOR $15,624 − allowed expenses $6,000 (total cap) = $9,624 × 85% = $8,180.40 > $5,000 guarantee.
    expect(settlement.payoutCents).toBe(818_040);
    expect(settlement.lines.at(-1)).toMatchObject({ kind: "total_payout", amountCents: 818_040 });
    expect(settlement.inputSnapshot!.expenses).toHaveLength(4);
    expect(body.pendingExpenseCount).toBe(1);

    const actions = (await history(settlement.id)).map((entry) => entry.action);
    expect(actions).toEqual(["settlement.created", "settlement.computed"]);
  });

  it("gives every line a source that exists in the frozen snapshot", async () => {
    const settlement = (await compute()).body.settlement!;
    const snapshot = settlement.inputSnapshot!;
    const snapshotIds = new Set([
      ...snapshot.ticketSales.map((sale) => sale.id),
      ...snapshot.expenses.map((expense) => expense.id),
    ]);

    const gbor = settlement.lines.find((line) => line.kind === "gbor")!;
    expect(gbor.sourceRefs).toHaveLength(2); // the GA and VIP tiers
    for (const line of settlement.lines) {
      for (const ref of line.sourceRefs) {
        expect(snapshotIds).toContain(ref.id);
      }
    }
    const guarantee = settlement.lines.find((line) => line.kind === "guarantee")!;
    expect(guarantee.clauseRef).toBe("§4.2");
  });

  it("refuses with 422 when the show has no terms", async () => {
    await t.prisma.contractTerms.deleteMany({ where: { showId } });
    const { status, body } = await t.request<ApiErrorDto>(
      "POST",
      `/shows/${showId}/settlement/compute`,
    );
    expect(status).toBe(422);
    expect(body.message).toMatch(/no terms/);
  });

  it("turns the engine's ZodError on bad stored data into a 422 with the issues", async () => {
    // Each value fits its column, but together they break the engine's total-gross
    // bound: 1,000,000 tickets × $20 = $20M > MAX_CENTS ($10M). The CSV import
    // would refuse this, so the row is written directly to the database.
    await t.prisma.ticketSale.create({
      data: {
        showId,
        tierName: "Huge",
        qtySold: 1_000_000,
        comps: 0,
        priceCents: 2_000,
        taxCents: 0,
        feeCents: 0,
      },
    });
    const { status, body } = await t.request<ApiErrorDto>(
      "POST",
      `/shows/${showId}/settlement/compute`,
    );
    expect(status).toBe(422);
    expect(body.issues).toHaveLength(1);
    expect(body.issues![0]!.path).toBe("ticketSales");
    expect(body.issues![0]!.message).toMatch(/total gross/);
  });
});

describe("stale detection", () => {
  it("layer 1: an expense edit through the API marks the settlement stale in the same transaction", async () => {
    const settlementId = (await compute()).body.settlement!.id;

    const edit = await t.request("PATCH", `/expenses/${expenses[0]!.id}`, { amountCents: 300_000 });
    expect(edit.status).toBe(200);

    expect((await getView()).body.settlement!.status).toBe("stale");
    const staleEntry = (await history(settlementId)).at(-1)!;
    expect(staleEntry.actor).toMatch(/^user:/);
    expect(staleEntry).toMatchObject({
      action: "settlement.marked_stale",
      after: { status: "stale", reason: "expense changed" },
    });
  });

  it("layer 2 (Phase 2 'Break it'): a change made directly in the database is caught by the hash", async () => {
    const settlementId = (await compute()).body.settlement!.id;

    // Bypasses the API, so layer 1 never runs.
    await t.prisma.expense.update({ where: { id: expenses[0]!.id }, data: { amountCents: 1 } });

    expect((await getView()).body.settlement!.status).toBe("stale");
    expect((await history(settlementId)).at(-1)).toMatchObject({
      action: "settlement.marked_stale",
      actor: "system",
      after: { reason: "live inputs no longer match the stored inputsHash" },
    });
  });

  it("does not go stale when nothing the engine reads has changed", async () => {
    await compute();
    // The description is not part of the snapshot, so the hash is unchanged...
    await t.prisma.expense.update({
      where: { id: expenses[0]!.id },
      data: { description: "Renamed" },
    });
    expect((await getView()).body.settlement!.status).toBe("computed");
  });
});

describe("review", () => {
  it("is blocked while an expense is pending, and needs a recompute after it is decided", async () => {
    await compute();

    const blocked = await t.request<ApiErrorDto>(
      "POST",
      `/shows/${showId}/settlement/submit-for-review`,
    );
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toMatch(/1 expense\(s\) are still pending/);

    // Deciding the expense changes an input → stale → a recompute is required.
    await t.request("PATCH", `/expenses/${expenses[2]!.id}`, { status: "allowed" });
    expect((await submit()).status).toBe(409);

    expect((await compute()).body.settlement!.version).toBe(2);
    const submitted = await submit();
    expect(submitted.status).toBe(200);
    expect(submitted.body.settlement!.status).toBe("in_review");

    // in_review is not frozen yet (that is Phase 5's "approved"): an input change still makes it stale.
    await t.request("PATCH", `/expenses/${expenses[0]!.id}`, { amountCents: 1_000 });
    expect((await getView()).body.settlement!.status).toBe("stale");
  });
});

describe("concurrency", () => {
  it("never loses a compute: every success bumps the version by exactly one", async () => {
    await compute(); // create the settlement first, so the race is only about computing

    const results = await Promise.all(Array.from({ length: 5 }, () => compute()));
    const statuses = results.map((result) => result.status);
    for (const status of statuses) {
      expect([200, 409]).toContain(status);
    }
    const successes = statuses.filter((status) => status === 200).length;
    expect(successes).toBeGreaterThanOrEqual(1);

    const finalVersion = (await getView()).body.settlement!.version;
    expect(finalVersion).toBe(1 + successes);
  });

  it("refuses a transition based on an outdated read, and writes no audit row for it", async () => {
    const settlementId = (await compute()).body.settlement!.id;
    const outdatedRow = await t.prisma.settlement.findUniqueOrThrow({
      where: { id: settlementId },
    });
    await compute(); // version 1 → 2 behind the outdated row's back
    const auditCountBefore = (await history(settlementId)).length;

    const stateMachine = t.nest.get(SettlementStateMachine);
    await expect(
      t.prisma.$transaction((tx) =>
        stateMachine.transition(tx, {
          settlement: outdatedRow,
          to: "in_review",
          actor: "test",
          action: "settlement.submitted_for_review",
        }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect((await history(settlementId)).length).toBe(auditCountBefore);
    expect((await getView()).body.settlement!.status).toBe("computed");
  });
});
