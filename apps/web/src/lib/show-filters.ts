import type { SettlementStatus, ShowDto } from "@ledgerline/schemas";
import type { SearchParams } from "./flash";

// The shows dashboard: search, status filter and sort over the list GET /shows already
// returns. Everything here is pure (no fetch, no clock), so the page stays a server
// component that reads the URL (?q=&status=&sort=) and the tests need no browser.
// Only counts of shows are computed here, never money.

// --- Status filters ---------------------------------------------------------------------

// The status filter in the URL. Two kinds share one parameter:
// - groups, picked from the summary cards: what a show needs from the person;
// - single statuses (or "approved" = approved or paying), picked from the chips.
export type StatusFilter =
  | "all"
  | "needs_action"
  | "in_payment"
  | "not_started"
  | "draft"
  | "computed"
  | "stale"
  | "in_review"
  | "approved"
  | "payment_failed"
  | "paid";

// Which settlement statuses each filter keeps. null is a show with no settlement yet.
// Keyed by the filter, so a new filter fails to compile until it says what it keeps.
const FILTER_STATUSES: Record<
  Exclude<StatusFilter, "all">,
  readonly (SettlementStatus | null)[]
> = {
  // Someone has to do something before it can be reviewed: set up, compute,
  // recompute after a change, or submit.
  needs_action: [null, "draft", "computed", "stale"],
  // Approved: the money is on its way, or the last attempt failed.
  in_payment: ["approved", "paying", "payment_failed"],
  not_started: [null],
  draft: ["draft"],
  computed: ["computed"],
  stale: ["stale"],
  in_review: ["in_review"],
  // Approval starts the payout in the same transaction, so "approved" is only ever a
  // moment before "paying". One chip for both.
  approved: ["approved", "paying"],
  payment_failed: ["payment_failed"],
  paid: ["paid"],
};

export const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  all: "All",
  needs_action: "Needs action",
  in_payment: "Paying",
  not_started: "Not started",
  draft: "Draft",
  computed: "Computed",
  stale: "Stale",
  in_review: "In review",
  approved: "Approved / paying",
  payment_failed: "Payment failed",
  paid: "Paid",
};

// The chips, in the order a settlement moves through them. Each status is in exactly
// one chip (show-filters.test.ts checks it), so the chip counts add up to "All".
export const STATUS_CHIPS: readonly StatusFilter[] = [
  "all",
  "not_started",
  "draft",
  "computed",
  "stale",
  "in_review",
  "approved",
  "payment_failed",
  "paid",
];

// The summary cards, also in flow order.
export const SUMMARY_GROUPS = ["needs_action", "in_review", "in_payment", "paid"] as const;

export function matchesStatus(show: ShowDto, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  return FILTER_STATUSES[filter].includes(show.settlementStatus);
}

// How many shows each filter would keep. Feeds the cards and the chip counts.
export function countByFilter(shows: readonly ShowDto[]): Record<StatusFilter, number> {
  const counts = {} as Record<StatusFilter, number>;
  for (const filter of Object.keys(STATUS_FILTER_LABELS) as StatusFilter[]) {
    counts[filter] = shows.filter((show) => matchesStatus(show, filter)).length;
  }
  return counts;
}

// --- Search ---------------------------------------------------------------------------------

// Case-insensitive "contains" on the show name, the artist and the venue. An empty
// search keeps every show.
export function matchesSearch(show: ShowDto, search: string): boolean {
  const needle = search.trim().toLocaleLowerCase("en-US");
  if (needle === "") return true;
  return [show.name, show.artist.name, show.venue.name].some((text) =>
    text.toLocaleLowerCase("en-US").includes(needle),
  );
}

// --- Sort -----------------------------------------------------------------------------------

export type ShowSort = "newest" | "oldest" | "name";

export const SORT_LABELS: Record<ShowSort, string> = {
  newest: "Date, newest first",
  oldest: "Date, oldest first",
  name: "Show name, A–Z",
};

// "2026-11-07" strings sort correctly as text, so no Date parsing (and no time zone)
// is needed.
function byDate(a: ShowDto, b: ShowDto): number {
  return a.showDate < b.showDate ? -1 : a.showDate > b.showDate ? 1 : 0;
}

// "E2E c08" before "E2E c10", and "the" equals "The".
function byName(a: ShowDto, b: ShowDto): number {
  return a.name.localeCompare(b.name, "en-US", { numeric: true, sensitivity: "base" });
}

// A new array; the list from the API is left as it is. Ties fall back to the name and
// then the id, so two shows on one day never swap places between reloads.
export function sortShows(shows: readonly ShowDto[], sort: ShowSort): ShowDto[] {
  return [...shows].sort((a, b) => {
    const primary =
      sort === "name" ? byName(a, b) : sort === "oldest" ? byDate(a, b) : byDate(b, a);
    if (primary !== 0) return primary;
    const name = byName(a, b);
    if (name !== 0) return name;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

// --- URL ------------------------------------------------------------------------------------

export type ShowQuery = { q: string; status: StatusFilter; sort: ShowSort };

export const DEFAULT_SHOW_QUERY: ShowQuery = { q: "", status: "all", sort: "newest" };

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function isStatusFilter(value: string): value is StatusFilter {
  return Object.hasOwn(STATUS_FILTER_LABELS, value);
}

function isShowSort(value: string): value is ShowSort {
  return Object.hasOwn(SORT_LABELS, value);
}

// The search text (?q=), trimmed and capped like the search box's maxLength. Shared
// with the artists and venues directories (lib/directory.ts), so every search box
// reads the URL the same way.
export function readSearchText(searchParams: SearchParams): string {
  return first(searchParams["q"]).trim().slice(0, 100);
}

// The URL is typed by people and shared as links, so anything unknown falls back to
// the default instead of failing the page.
export function readShowQuery(searchParams: SearchParams): ShowQuery {
  const status = first(searchParams["status"]);
  const sort = first(searchParams["sort"]);
  return {
    q: readSearchText(searchParams),
    status: isStatusFilter(status) ? status : DEFAULT_SHOW_QUERY.status,
    sort: isShowSort(sort) ? sort : DEFAULT_SHOW_QUERY.sort,
  };
}

// A link to the dashboard with these settings. Defaults are left out, so the plain
// list stays plain "/shows".
export function showsHref(query: Partial<ShowQuery>): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.status && query.status !== DEFAULT_SHOW_QUERY.status)
    params.set("status", query.status);
  if (query.sort && query.sort !== DEFAULT_SHOW_QUERY.sort) params.set("sort", query.sort);
  const search = params.toString();
  return search === "" ? "/shows" : `/shows?${search}`;
}

export function isFiltered(query: ShowQuery): boolean {
  return query.q !== "" || query.status !== "all";
}

// --- Next action ----------------------------------------------------------------------------

// What the person does next for a show, read from the settlement status alone (the
// list has no sales or terms details, and the dashboard makes no extra calls). href is
// null when nobody has to act: the payout is on its way, or done.
export type NextAction = { label: string; href: string | null };

export function nextAction(show: ShowDto): NextAction | null {
  const settlement = `/shows/${show.id}/settlement`;
  switch (show.settlementStatus) {
    case null:
      // No settlement yet: sales and terms come first. The show page starts there.
      return { label: "Add sales and terms", href: `/shows/${show.id}` };
    case "draft":
      return { label: "Compute", href: settlement };
    case "computed":
      return { label: "Submit for review", href: settlement };
    case "stale":
      // The inputs changed after the last compute.
      return { label: "Recompute", href: settlement };
    case "in_review":
      return { label: "Review and approve", href: settlement };
    case "approved":
    case "paying":
      return { label: "Payout in progress", href: null };
    case "payment_failed":
      return { label: "Retry payment", href: settlement };
    case "paid":
      return null;
  }
}
