import type { SettlementStatus, ShowDto } from "@ledgerline/schemas";
import { describe, expect, it } from "vitest";
import { buildDirectory, directoryHref, initials, matchesName } from "./directory";
import { readSearchText } from "./show-filters";

function show(
  id: string,
  showDate: string,
  artistId: string,
  venueId: string,
  settlementStatus: SettlementStatus | null = null,
): ShowDto {
  return {
    id,
    name: `Show ${id}`,
    showDate,
    venue: { id: venueId, name: `Venue ${venueId}` },
    artist: { id: artistId, name: `Artist ${artistId}`, stripeAccountId: null },
    settlementStatus,
  };
}

describe("buildDirectory", () => {
  const artists = [
    { id: "a2", name: "Static Bloom", stripeAccountId: null },
    { id: "a1", name: "Mara Quinn", stripeAccountId: "acct_1" },
    { id: "a3", name: "Nobody Booked", stripeAccountId: null },
  ];
  const shows = [
    show("s1", "2026-06-15", "a1", "v1", "paid"),
    show("s2", "2026-11-13", "a1", "v2"),
    show("s3", "2026-11-14", "a2", "v1", "computed"),
    show("s4", "2026-11-01", "unknown", "v1"),
  ];

  it("counts each artist's shows and finds the latest one", () => {
    const rows = buildDirectory(artists, shows, "artist");
    expect(rows.map((row) => [row.item.id, row.showCount, row.latestShow?.id ?? null])).toEqual([
      ["a1", 2, "s2"],
      ["a3", 0, null],
      ["a2", 1, "s3"],
    ]);
  });

  it("counts by venue when asked", () => {
    const venues = [
      { id: "v1", name: "Hall 9" },
      { id: "v2", name: "The Velvet Room" },
    ];
    const rows = buildDirectory(venues, shows, "venue");
    // s4's artist is unknown, but its venue is v1, so it counts here.
    expect(rows.map((row) => [row.item.id, row.showCount, row.latestShow?.id])).toEqual([
      ["v1", 3, "s3"],
      ["v2", 1, "s2"],
    ]);
  });

  it("keeps two rows with the same name apart, by id", () => {
    const twins = [
      { id: "b", name: "The Velvet Harbors" },
      { id: "a", name: "The Velvet Harbors" },
    ];
    const rows = buildDirectory(twins, [show("s1", "2026-11-07", "x", "b")], "venue");
    expect(rows.map((row) => [row.item.id, row.showCount])).toEqual([
      ["a", 0],
      ["b", 1],
    ]);
  });

  it("leaves the lists it was given untouched", () => {
    const before = artists.map((artist) => artist.id);
    buildDirectory(artists, shows, "artist");
    expect(artists.map((artist) => artist.id)).toEqual(before);
  });
});

describe("matchesName", () => {
  it("is a case-insensitive contains, and empty keeps everything", () => {
    expect(matchesName("The Harbor Lights", "harbor")).toBe(true);
    expect(matchesName("The Harbor Lights", "  HARBOR ")).toBe(true);
    expect(matchesName("Static Bloom", "harbor")).toBe(false);
    expect(matchesName("Static Bloom", "")).toBe(true);
  });
});

describe("directoryHref", () => {
  it("drops an empty search and encodes the rest", () => {
    expect(directoryHref("/artists", "")).toBe("/artists");
    expect(directoryHref("/venues", "hall 9")).toBe("/venues?q=hall+9");
  });
});

describe("readSearchText", () => {
  it("reads the first q, trimmed and capped at 100 characters", () => {
    expect(readSearchText({})).toBe("");
    expect(readSearchText({ q: "  harbor " })).toBe("harbor");
    expect(readSearchText({ q: ["one", "two"] })).toBe("one");
    expect(readSearchText({ q: "x".repeat(150) })).toHaveLength(100);
  });
});

describe("initials", () => {
  it("takes the first letters of the first two words", () => {
    expect(initials("Demo Manager")).toBe("DM");
    expect(initials("mara quinn")).toBe("MQ");
    expect(initials("Hall 9")).toBe("H9");
  });

  it("skips a leading The, unless it is the only word", () => {
    expect(initials("The Harbor Lights")).toBe("HL");
    expect(initials("The")).toBe("T");
  });

  it("copes with extra spaces and an empty name", () => {
    expect(initials("  Static   Bloom ")).toBe("SB");
    expect(initials("")).toBe("");
  });
});
