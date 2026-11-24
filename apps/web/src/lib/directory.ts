import type { ShowDto } from "@ledgerline/schemas";
import { sortShows } from "./show-filters";

// The artists and venues directories: who and where, with how many shows each has and
// the most recent one. Built from the lists GET /artists, GET /venues and GET /shows
// already return; pure (no fetch, no clock), so the tests need no browser. Only shows
// are counted here, never money.

// What both directories need from a row: an id to count by (two artists can share a
// name) and a name to show and search.
export type Named = { id: string; name: string };

export type DirectoryEntry<T extends Named> = {
  item: T;
  showCount: number;
  // The show with the latest date, or null when there is none yet.
  latestShow: ShowDto | null;
};

// One entry per artist or venue, A–Z by name. `side` says which end of a show to count:
// show.artist for the artists page, show.venue for the venues page. A show whose artist
// or venue is not in `items` is ignored instead of inventing a row for it.
export function buildDirectory<T extends Named>(
  items: readonly T[],
  shows: readonly ShowDto[],
  side: "artist" | "venue",
): DirectoryEntry<T>[] {
  const counts = new Map<string, number>();
  const latest = new Map<string, ShowDto>();
  // Newest first (with the dashboard's tie-breaks), so the first show seen for an id
  // is its latest one.
  for (const show of sortShows(shows, "newest")) {
    const id = show[side].id;
    counts.set(id, (counts.get(id) ?? 0) + 1);
    if (!latest.has(id)) latest.set(id, show);
  }
  return [...items].sort(byName).map((item) => ({
    item,
    showCount: counts.get(item.id) ?? 0,
    latestShow: latest.get(item.id) ?? null,
  }));
}

// "the" equals "The", and a tie on the name falls back to the id, so two artists with
// the same name never swap places between reloads.
function byName(a: Named, b: Named): number {
  const name = a.name.localeCompare(b.name, "en-US", { numeric: true, sensitivity: "base" });
  if (name !== 0) return name;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// Case-insensitive "contains" on the name; an empty search keeps everything. The same
// rule as the shows dashboard's search (lib/show-filters.ts matchesSearch).
export function matchesName(name: string, search: string): boolean {
  const needle = search.trim().toLocaleLowerCase("en-US");
  if (needle === "") return true;
  return name.toLocaleLowerCase("en-US").includes(needle);
}

// A link to a directory page with this search; no search is the plain path.
export function directoryHref(path: "/artists" | "/venues", search: string): string {
  if (search === "") return path;
  return `${path}?${new URLSearchParams({ q: search }).toString()}`;
}

// "Demo Manager" -> "DM", "The Harbor Lights" -> "HL", for a round badge next to a name.
// A leading "The" is skipped, or half the band names would read "T…". Display only.
export function initials(name: string): string {
  const words = name.split(/\s+/).filter((word) => word.length > 0);
  const meaningful = words.length > 1 && words[0]?.toLowerCase() === "the" ? words.slice(1) : words;
  return meaningful
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}
