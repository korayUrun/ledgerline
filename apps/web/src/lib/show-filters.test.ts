import type { SettlementStatus, ShowDto } from "@ledgerline/schemas";
import { SettlementStatusSchema } from "@ledgerline/schemas";
import { describe, expect, it } from "vitest";
import {
  countByFilter,
  isFiltered,
  matchesSearch,
  matchesStatus,
  nextAction,
  readShowQuery,
  showsHref,
  sortShows,
  STATUS_CHIPS,
  SUMMARY_GROUPS,
} from "./show-filters";

function show(
  id: string,
  name: string,
  showDate: string,
  settlementStatus: SettlementStatus | null,
  artist = "Some Artist",
  venue = "Some Venue",
): ShowDto {
  return {
    id,
    name,
    showDate,
    venue: { id: `venue-${id}`, name: venue },
    artist: { id: `artist-${id}`, name: artist, stripeAccountId: null },
    settlementStatus,
  };
}

const harbor = show(
  "1",
  "The Harbor Lights — Fall Tour",
  "2026-11-06",
  "computed",
  "The Harbor Lights",
  "The Velvet Room",
);
const bloom = show(
  "2",
  "Static Bloom — Album Release",
  "2026-11-14",
  null,
  "Static Bloom",
  "The Velvet Room",
);
const drill = show(
  "3",
  "Stripe Drill",
  "2026-11-21",
  "paid",
  "Stripe Test Band",
  "Riverside Ballroom",
);
const failed = show("4", "Failed Payout", "2026-10-01", "payment_failed");
const review = show("5", "In Review Show", "2026-09-01", "in_review");
const paying = show("6", "Paying Show", "2026-09-02", "paying");
const stale = show("7", "Stale Show", "2026-09-03", "stale");

const ALL_STATUSES: (SettlementStatus | null)[] = [null, ...SettlementStatusSchema.options];

describe("matchesSearch", () => {
  it("matches the show name, the artist or the venue, ignoring case", () => {
    expect(matchesSearch(harbor, "harbor")).toBe(true);
    expect(matchesSearch(bloom, "STATIC")).toBe(true);
    expect(matchesSearch(drill, "riverside")).toBe(true);
    expect(matchesSearch(drill, "velvet")).toBe(false);
  });

  it("keeps every show for an empty or blank search", () => {
    expect(matchesSearch(harbor, "")).toBe(true);
    expect(matchesSearch(harbor, "   ")).toBe(true);
  });

  it("ignores spaces around the search", () => {
    expect(matchesSearch(harbor, "  fall tour ")).toBe(true);
  });
});

describe("matchesStatus", () => {
  it("'Needs action' is no settlement, draft, computed or stale", () => {
    const kept = ALL_STATUSES.filter((status) =>
      matchesStatus(show("x", "x", "2026-01-01", status), "needs_action"),
    );
    expect(kept).toEqual([null, "draft", "computed", "stale"]);
  });

  it("'Paying' includes a failed payment, the 'Approved / paying' chip does not", () => {
    expect(matchesStatus(failed, "in_payment")).toBe(true);
    expect(matchesStatus(paying, "in_payment")).toBe(true);
    expect(matchesStatus(failed, "approved")).toBe(false);
    expect(matchesStatus(paying, "approved")).toBe(true);
  });

  it("'Not started' is a show without a settlement", () => {
    expect(matchesStatus(bloom, "not_started")).toBe(true);
    expect(matchesStatus(harbor, "not_started")).toBe(false);
  });

  it("puts every status in exactly one chip besides All", () => {
    for (const status of ALL_STATUSES) {
      const one = show("x", "x", "2026-01-01", status);
      const chips = STATUS_CHIPS.filter((chip) => chip !== "all" && matchesStatus(one, chip));
      expect(chips, String(status)).toHaveLength(1);
    }
  });

  it("puts every status in exactly one summary card", () => {
    for (const status of ALL_STATUSES) {
      const one = show("x", "x", "2026-01-01", status);
      const groups = SUMMARY_GROUPS.filter((group) => matchesStatus(one, group));
      expect(groups, String(status)).toHaveLength(1);
    }
  });
});

describe("countByFilter", () => {
  it("counts the shows each filter keeps", () => {
    const counts = countByFilter([harbor, bloom, drill, failed, review, paying, stale]);
    expect(counts.all).toBe(7);
    expect(counts.needs_action).toBe(3); // harbor, bloom, stale
    expect(counts.in_review).toBe(1);
    expect(counts.in_payment).toBe(2); // paying, failed
    expect(counts.payment_failed).toBe(1);
    expect(counts.paid).toBe(1);
    expect(counts.draft).toBe(0);
  });

  it("counts zero everywhere for an empty list", () => {
    expect(Object.values(countByFilter([])).every((count) => count === 0)).toBe(true);
  });
});

describe("sortShows", () => {
  const list = [harbor, bloom, drill];

  it("puts the newest date first by default", () => {
    expect(sortShows(list, "newest").map((s) => s.id)).toEqual(["3", "2", "1"]);
  });

  it("can put the oldest date first", () => {
    expect(sortShows(list, "oldest").map((s) => s.id)).toEqual(["1", "2", "3"]);
  });

  it("sorts names A–Z, ignoring case, with numbers in number order", () => {
    const named = [
      show("a", "e2e c10", "2026-01-01", null),
      show("b", "E2E c08", "2026-01-01", null),
      show("c", "Alpha", "2026-01-01", null),
    ];
    expect(sortShows(named, "name").map((s) => s.id)).toEqual(["c", "b", "a"]);
  });

  it("breaks a tie on the same date by name, then id, so the order is stable", () => {
    const sameDay = [
      show("z", "Same", "2026-11-07", null),
      show("y", "Same", "2026-11-07", null),
      show("x", "Another", "2026-11-07", null),
    ];
    expect(sortShows(sameDay, "newest").map((s) => s.id)).toEqual(["x", "y", "z"]);
  });

  it("does not change the list it was given", () => {
    const original = [harbor, bloom, drill];
    sortShows(original, "name");
    expect(original.map((s) => s.id)).toEqual(["1", "2", "3"]);
  });
});

describe("readShowQuery", () => {
  it("reads search, status and sort from the URL", () => {
    expect(readShowQuery({ q: " harbor ", status: "computed", sort: "name" })).toEqual({
      q: "harbor",
      status: "computed",
      sort: "name",
    });
  });

  it("falls back to the defaults for missing or unknown values", () => {
    expect(readShowQuery({})).toEqual({ q: "", status: "all", sort: "newest" });
    expect(readShowQuery({ status: "bogus", sort: "price" })).toEqual({
      q: "",
      status: "all",
      sort: "newest",
    });
    // Not a filter, even though every object has it.
    expect(readShowQuery({ status: "toString" }).status).toBe("all");
  });

  it("takes the first value when a parameter is repeated", () => {
    expect(readShowQuery({ status: ["paid", "stale"] }).status).toBe("paid");
  });
});

describe("showsHref and isFiltered", () => {
  it("leaves the defaults out of the link", () => {
    expect(showsHref({})).toBe("/shows");
    expect(showsHref({ q: "", status: "all", sort: "newest" })).toBe("/shows");
    expect(showsHref({ status: "needs_action", sort: "name" })).toBe(
      "/shows?status=needs_action&sort=name",
    );
    expect(showsHref({ q: "rock & roll" })).toBe("/shows?q=rock+%26+roll");
  });

  it("counts a search or a status as a filter, but not the sort", () => {
    expect(isFiltered({ q: "", status: "all", sort: "name" })).toBe(false);
    expect(isFiltered({ q: "x", status: "all", sort: "newest" })).toBe(true);
    expect(isFiltered({ q: "", status: "paid", sort: "newest" })).toBe(true);
  });
});

describe("nextAction", () => {
  it("names the next step and where it is done", () => {
    expect(nextAction(bloom)).toEqual({ label: "Add sales and terms", href: "/shows/2" });
    expect(nextAction(harbor)).toEqual({
      label: "Submit for review",
      href: "/shows/1/settlement",
    });
    expect(nextAction(stale)?.label).toBe("Recompute");
    expect(nextAction(review)?.label).toBe("Review and approve");
    expect(nextAction(failed)?.label).toBe("Retry payment");
  });

  it("has nothing to click while the payout is on its way, and nothing once paid", () => {
    expect(nextAction(paying)).toEqual({ label: "Payout in progress", href: null });
    expect(nextAction(drill)).toBeNull();
  });
});
