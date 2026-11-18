import { describe, expect, it } from "vitest";
import { parseTicketSalesCsv } from "./ticket-sales-csv.js";

const HEADER = "tier,qty_sold,comps,price,tax,fees";

describe("parseTicketSalesCsv", () => {
  it("reads dollar columns as integer cents", () => {
    const result = parseTicketSalesCsv(
      `${HEADER}\nGA,320,25,35.00,560.00,224.00\nVIP,70,10,80,280,112.5\n`,
    );
    expect(result).toEqual({
      ok: true,
      rows: [
        {
          tierName: "GA",
          qtySold: 320,
          comps: 25,
          priceCents: 3_500,
          taxCents: 56_000,
          feeCents: 22_400,
        },
        {
          tierName: "VIP",
          qtySold: 70,
          comps: 10,
          priceCents: 8_000,
          taxCents: 28_000,
          feeCents: 11_250,
        },
      ],
    });
  });

  it("keeps a quoted tier name that contains a comma", () => {
    const result = parseTicketSalesCsv(`${HEADER}\n"VIP, Balcony",10,0,50.00,0,0\n`);
    expect(result.ok && result.rows[0]!.tierName).toBe("VIP, Balcony");
  });

  it("reports every bad cell with its row number", () => {
    const result = parseTicketSalesCsv(`${HEADER}\nGA,ten,0,35.00,0,0\nVIP,5,0,12.345,0,0\n`);
    expect(result).toEqual({
      ok: false,
      issues: [
        { path: "row 2", message: "qty_sold must be a whole number" },
        { path: "row 3", message: "price must be a dollar amount like 35.00" },
      ],
    });
  });

  it("applies the engine's row rule: tax + fees cannot exceed the gross", () => {
    const result = parseTicketSalesCsv(`${HEADER}\nGA,1,0,10.00,8.00,5.00\n`);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues[0]!.path).toBe("row 2.taxCents");
  });

  it("rejects a missing column", () => {
    const result = parseTicketSalesCsv("tier,qty_sold,price\nGA,1,10\n");
    expect(!result.ok && result.issues[0]!.message).toMatch(
      /Missing column\(s\): comps, tax, fees/,
    );
  });

  it("rejects duplicate tiers", () => {
    const result = parseTicketSalesCsv(`${HEADER}\nGA,1,0,10,0,0\nGA,2,0,10,0,0\n`);
    expect(!result.ok && result.issues).toEqual([
      { path: "file", message: 'Tier "GA" appears more than once' },
    ]);
  });

  it("rejects a total gross above MAX_CENTS", () => {
    // 1,000,000 tickets × $20 = $20M, above the $10M limit.
    const result = parseTicketSalesCsv(`${HEADER}\nGA,1000000,0,20.00,0,0\n`);
    expect(!result.ok && result.issues[0]!.message).toMatch(/Total gross exceeds/);
  });

  it("rejects an empty file and broken CSV", () => {
    expect(parseTicketSalesCsv(`${HEADER}\n`).ok).toBe(false);
    expect(parseTicketSalesCsv(`${HEADER}\n"GA,1,0,10,0,0\n`).ok).toBe(false);
  });
});
