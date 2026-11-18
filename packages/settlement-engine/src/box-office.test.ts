import { describe, expect, it } from "vitest";
import { computeBoxOffice } from "./box-office.js";
import { STRONG_NIGHT_SALES, WEAK_NIGHT_SALES } from "./test-helpers/domain-examples.js";

describe("computeBoxOffice (docs/domain.md §2)", () => {
  it("strong night: GBOR 2,150,000, NBOR 1,928,000, 500 paid tickets", () => {
    const boxOffice = computeBoxOffice(STRONG_NIGHT_SALES);
    expect(boxOffice.grossCents).toBe(2_150_000);
    expect(boxOffice.netCents).toBe(1_928_000);
    expect(boxOffice.paidTickets).toBe(500);
  });

  it("weak night: GBOR 1,325,000, NBOR 1,188,000, 310 paid tickets", () => {
    const boxOffice = computeBoxOffice(WEAK_NIGHT_SALES);
    expect(boxOffice.grossCents).toBe(1_325_000);
    expect(boxOffice.netCents).toBe(1_188_000);
    expect(boxOffice.paidTickets).toBe(310);
  });

  it("comps change nothing", () => {
    const manyComps = STRONG_NIGHT_SALES.map((sale) => ({ ...sale, comps: 1000 }));
    expect(computeBoxOffice(manyComps)).toEqual(computeBoxOffice(STRONG_NIGHT_SALES));
  });

  it("emits GBOR, tax, fees and NBOR lines that point at every ticket sale", () => {
    const { lines } = computeBoxOffice(STRONG_NIGHT_SALES);
    expect(lines.map((line) => [line.kind, line.amountCents])).toEqual([
      ["gbor", 2_150_000],
      ["ticket_tax", 172_000],
      ["ticket_fees", 50_000],
      ["nbor", 1_928_000],
    ]);
    for (const line of lines) {
      expect(line.sourceRefs).toEqual([
        { type: "ticket_sale", id: "ts-ga" },
        { type: "ticket_sale", id: "ts-vip" },
      ]);
    }
  });

  it("no ticket sales: everything is 0", () => {
    const boxOffice = computeBoxOffice([]);
    expect([boxOffice.grossCents, boxOffice.netCents, boxOffice.paidTickets]).toEqual([0, 0, 0]);
  });
});
