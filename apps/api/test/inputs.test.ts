import type { ExpenseDto, ShowDto, TermsDto, TicketSaleDto } from "@ledgerline/schemas";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  resetDatabase,
  startTestApp,
  TICKET_SALES_CSV,
  VERSUS_TERMS,
  type TestApp,
} from "./test-app.js";

let t: TestApp;
let showId: string;

beforeAll(async () => {
  t = await startTestApp();
});
afterAll(async () => {
  await t.close();
});

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
});

describe("shows", () => {
  it("lists the show with its venue, artist and no settlement yet", async () => {
    const { body } = await t.request<ShowDto[]>("GET", "/shows");
    expect(body).toEqual([
      expect.objectContaining({
        name: "Test Night",
        showDate: "2026-11-06",
        settlementStatus: null,
      }),
    ]);
  });

  it("returns 404 for an unknown show and 400 for a malformed id", async () => {
    expect((await t.request("GET", "/shows/00000000-0000-4000-8000-000000000000")).status).toBe(
      404,
    );
    expect((await t.request("GET", "/shows/not-a-uuid")).status).toBe(400);
  });
});

describe("ticket sales import", () => {
  const importCsv = (csv: string) =>
    t.upload<TicketSaleDto[]>(`/shows/${showId}/ticket-sales/import`, "sales.csv", csv, "text/csv");

  it("lists tiers in a fixed order even though they share one createdAt (regression)", async () => {
    // All rows of one import get the same createdAt, so ordering by it fell back to
    // the random uuid and the order flipped between runs. Repeat to make a
    // reintroduced bug fail reliably instead of half the time.
    for (let attempt = 0; attempt < 5; attempt++) {
      const { body } = await importCsv(
        "tier,qty_sold,comps,price,tax,fees\nVIP,1,0,80,0,0\nGA,1,0,35,0,0\nBalcony,1,0,50,0,0\n",
      );
      expect(body.map((sale) => sale.tierName)).toEqual(["Balcony", "GA", "VIP"]);
    }
  });

  it("replaces the show's ticket sales and records the import", async () => {
    await importCsv(TICKET_SALES_CSV);
    const { status, body } = await importCsv(TICKET_SALES_CSV);

    expect(status).toBe(201);
    expect(body.map((sale) => sale.tierName)).toEqual(["GA", "VIP"]); // replaced, not doubled
    const audit = await t.prisma.auditLog.findMany({
      where: { action: "ticket_sales.imported" },
      orderBy: { at: "asc" },
    });
    expect(audit).toHaveLength(2);
    expect(audit[1]!.after).toEqual({ tiers: 2, paidTickets: 390, grossCents: 1_680_000 });
  });

  it("rejects a bad file with a 400 listing every problem, and keeps the old rows", async () => {
    await importCsv(TICKET_SALES_CSV);
    const { status, body } = await importCsv(
      "tier,qty_sold,comps,price,tax,fees\nGA,ten,0,35,0,0\n",
    );

    expect(status).toBe(400);
    expect(body).toMatchObject({
      issues: [{ path: "row 2", message: "qty_sold must be a whole number" }],
    });
    expect(await t.prisma.ticketSale.count({ where: { showId } })).toBe(2);
  });
});

describe("terms", () => {
  it("creates a new version on every save, never overwriting", async () => {
    await t.request("POST", `/shows/${showId}/terms`, VERSUS_TERMS);
    const changed = { ...VERSUS_TERMS, deal: { ...VERSUS_TERMS.deal, guaranteeCents: 600_000 } };
    const { body } = await t.request<TermsDto>("POST", `/shows/${showId}/terms`, changed);

    expect(body.versions.map((version) => version.version)).toEqual([2, 1]);
    expect(body.latest!.terms.deal).toMatchObject({ guaranteeCents: 600_000 });
    expect(body.latest!.confirmedByName).toBe("Demo Manager");
  });

  it("rejects terms the engine could not compute from with a 400", async () => {
    const invalid = {
      ...VERSUS_TERMS,
      deal: { type: "versus", artistShareBps: 12_000, clauseRef: "§4" },
    };
    const { status, body } = await t.request("POST", `/shows/${showId}/terms`, invalid);
    expect(status).toBe(400);
    expect(body).toMatchObject({ message: "Invalid request body" });
    expect(await t.prisma.contractTerms.count()).toBe(0);
  });
});

describe("expenses", () => {
  it("rejects a float amount: money is integer cents", async () => {
    const { status } = await t.request("POST", `/shows/${showId}/expenses`, {
      category: "catering",
      description: "Pizza",
      amountCents: 12.5,
    });
    expect(status).toBe(400);
  });

  it("defaults to pending and keeps an audit trail of every change", async () => {
    const created = await t.request<ExpenseDto>("POST", `/shows/${showId}/expenses`, {
      category: "catering",
      description: "Pizza",
      amountCents: 4_500,
    });
    expect(created.body.status).toBe("pending");

    await t.request("PATCH", `/expenses/${created.body.id}`, { status: "disallowed" });
    await t.request("DELETE", `/expenses/${created.body.id}`);

    const actions = await t.prisma.auditLog.findMany({
      where: { entity: "expense", entityId: created.body.id },
      orderBy: { at: "asc" },
    });
    expect(actions.map((entry) => entry.action)).toEqual([
      "expense.created",
      "expense.updated",
      "expense.deleted",
    ]);
    expect(actions[1]!.before).toMatchObject({ status: "pending" });
    expect(actions[1]!.after).toMatchObject({ status: "disallowed" });
  });

  it("stores a receipt and serves it back; refuses other file types", async () => {
    const expense = await t.request<ExpenseDto>("POST", `/shows/${showId}/expenses`, {
      category: "catering",
      description: "Pizza",
      amountCents: 4_500,
    });
    const receiptUrl = `/expenses/${expense.body.id}/receipt`;

    const refused = await t.upload(receiptUrl, "notes.txt", "hello", "text/plain");
    expect(refused.status).toBe(400);

    const attached = await t.upload<ExpenseDto>(
      receiptUrl,
      "receipt.pdf",
      "%PDF-1.4 fake",
      "application/pdf",
    );
    expect(attached.body.hasReceipt).toBe(true);

    const download = await fetch(`${t.baseUrl}${receiptUrl}`);
    expect(download.headers.get("content-type")).toBe("application/pdf");
    expect(await download.text()).toBe("%PDF-1.4 fake");
  });
});
