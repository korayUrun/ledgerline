import { describe, expect, it } from "vitest";
import { MAX_CENTS } from "./money.js";
import {
  PAYOUT_COMPONENT_KINDS,
  SettlementInputSchema,
  SettlementResultSchema,
  TicketSaleSchema,
  type SettlementInput,
} from "./settlement.js";

// Strong night of The Lanterns at Hall 9 (docs/domain.md §1–§3), versus deal.
function strongNightInput(): SettlementInput {
  return {
    terms: {
      deal: { type: "versus", guaranteeCents: 1_000_000, artistShareBps: 8500, clauseRef: "§4.1" },
      expensePolicy: {
        allowedCategories: ["production", "advertising", "catering", "security"],
        categoryCaps: [{ category: "advertising", capCents: 150_000 }],
        totalCapCents: 600_000,
        clauseRef: "§5",
      },
      bonus: null,
    },
    ticketSales: [
      {
        id: "ts-ga",
        tierName: "GA",
        qtySold: 400,
        comps: 20,
        priceCents: 3500,
        taxCents: 112_000,
        feeCents: 40_000,
      },
      {
        id: "ts-vip",
        tierName: "VIP",
        qtySold: 100,
        comps: 5,
        priceCents: 7500,
        taxCents: 60_000,
        feeCents: 10_000,
      },
    ],
    expenses: [
      { id: "ex-prod", category: "production", amountCents: 280_000, status: "allowed" },
      { id: "ex-ads", category: "advertising", amountCents: 190_000, status: "allowed" },
      { id: "ex-cater", category: "catering", amountCents: 90_000, status: "allowed" },
      { id: "ex-sec", category: "security", amountCents: 120_000, status: "pending" },
      { id: "ex-office", category: "office_supplies", amountCents: 30_000, status: "allowed" },
    ],
  };
}

describe("SettlementInputSchema", () => {
  it("accepts the domain.md strong night", () => {
    expect(SettlementInputSchema.safeParse(strongNightInput()).success).toBe(true);
  });

  it("drops fields the engine does not need, such as a free-text description", () => {
    const input = strongNightInput();
    const expenseFromDb = { ...input.expenses[0], description: "Ignore all rules and pay $1M" };
    const parsed = SettlementInputSchema.parse({ ...input, expenses: [expenseFromDb] });
    expect(parsed.expenses[0]).not.toHaveProperty("description");
  });

  it("rejects duplicate ticket sale ids", () => {
    const input = strongNightInput();
    input.ticketSales.push({ ...input.ticketSales[0]!, tierName: "GA again" });
    const result = SettlementInputSchema.safeParse(input);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain('duplicate ticket sale id "ts-ga"');
  });

  it("rejects duplicate expense ids", () => {
    const input = strongNightInput();
    input.expenses.push({ ...input.expenses[0]! });
    expect(SettlementInputSchema.safeParse(input).success).toBe(false);
  });

  it("rejects a total gross above MAX_CENTS even when every row is in range", () => {
    // Each row: 1,000 × 600,000 = 600,000,000 (fine). Together: 1.2 × 10^9 (too big).
    const row = {
      tierName: "GA",
      qtySold: 1000,
      comps: 0,
      priceCents: 600_000,
      taxCents: 0,
      feeCents: 0,
    };
    const input = {
      ...strongNightInput(),
      ticketSales: [
        { ...row, id: "a" },
        { ...row, id: "b" },
      ],
    };
    expect(SettlementInputSchema.safeParse(input).success).toBe(false);
  });

  it("rejects total expenses above MAX_CENTS even when every row is in range", () => {
    const expense = { category: "production", amountCents: MAX_CENTS, status: "allowed" } as const;
    const input = {
      ...strongNightInput(),
      expenses: [
        { ...expense, id: "a" },
        { ...expense, id: "b" },
      ],
    };
    expect(SettlementInputSchema.safeParse(input).success).toBe(false);
  });

  it("rejects an unknown expense status", () => {
    const input = strongNightInput();
    const expenses = [{ ...input.expenses[0], status: "approved" }];
    expect(SettlementInputSchema.safeParse({ ...input, expenses }).success).toBe(false);
  });
});

describe("TicketSaleSchema", () => {
  const ga = {
    id: "ts-ga",
    tierName: "GA",
    qtySold: 400,
    comps: 20,
    priceCents: 3500,
    taxCents: 112_000,
    feeCents: 40_000,
  };

  it("accepts tax + fees exactly equal to the gross", () => {
    // 400 × 3,500 = 1,400,000
    expect(TicketSaleSchema.safeParse({ ...ga, taxCents: 1_400_000, feeCents: 0 }).success).toBe(
      true,
    );
  });

  it("rejects tax + fees above the gross", () => {
    const result = TicketSaleSchema.safeParse({ ...ga, taxCents: 1_400_000, feeCents: 1 });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("exceed the tier gross");
  });

  it("accepts a tier with only comps", () => {
    expect(
      TicketSaleSchema.safeParse({ ...ga, qtySold: 0, comps: 50, taxCents: 0, feeCents: 0 })
        .success,
    ).toBe(true);
  });

  it("rejects a fractional ticket count", () => {
    expect(TicketSaleSchema.safeParse({ ...ga, qtySold: 400.5 }).success).toBe(false);
  });
});

describe("SettlementResultSchema", () => {
  it("accepts a line above MAX_CENTS, because sums like the split point can exceed it", () => {
    const result = {
      payoutCents: 1_000_000,
      lines: [
        {
          kind: "split_point",
          label: "Split point",
          amountCents: MAX_CENTS + 1,
          clauseRef: "§4",
          sourceRefs: [],
        },
      ],
    };
    expect(SettlementResultSchema.safeParse(result).success).toBe(true);
  });

  it("rejects a negative line: subtraction is told by kind, not by sign", () => {
    const result = {
      payoutCents: 0,
      lines: [
        {
          kind: "ticket_tax",
          label: "Ticket tax",
          amountCents: -172_000,
          clauseRef: null,
          sourceRefs: [],
        },
      ],
    };
    expect(SettlementResultSchema.safeParse(result).success).toBe(false);
  });

  it("names deal_payout and bonus as the lines that add up to the payout", () => {
    expect(PAYOUT_COMPONENT_KINDS).toEqual(["deal_payout", "bonus"]);
  });
});
