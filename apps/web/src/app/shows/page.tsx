import type { ArtistDto, ShowDto, VenueDto } from "@ledgerline/schemas";
import Link from "next/link";
import { api } from "../../lib/api";
import { readError, type SearchParams } from "../../lib/flash";
import {
  countByFilter,
  isFiltered,
  matchesSearch,
  matchesStatus,
  readShowQuery,
  showsHref,
  sortShows,
} from "../../lib/show-filters";
import { EmptyState, ErrorBanner } from "../components";
import { PlusIcon } from "../icons";
import { PageHeader } from "../page-header";
import { NewShowPanel, ResultLine, ShowsTable, ShowsToolbar, SummaryCards } from "./dashboard";

export default async function ShowsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const [shows, venues, artists] = await Promise.all([
    api.get<ShowDto[]>("/shows"),
    api.get<VenueDto[]>("/venues"),
    api.get<ArtistDto[]>("/artists"),
  ]);

  // Everything below works on the list just loaded; no extra API calls. The cards count
  // all shows; the chips count within the search, so each chip says what clicking it
  // would show; the table is the search, then the status, then the sort.
  const query = readShowQuery(params);
  const summaryCounts = countByFilter(shows);
  const searched = shows.filter((show) => matchesSearch(show, query.q));
  const chipCounts = countByFilter(searched);
  const visible = sortShows(
    searched.filter((show) => matchesStatus(show, query.status)),
    query.sort,
  );
  const filtered = isFiltered(query);

  return (
    <>
      <PageHeader
        title="Shows"
        subtitle="What each show needs next. Pick one to import sales, enter deal terms and settle it."
        actions={
          // Opens the panel below (CSS :target); nothing new is sent.
          <a href="#new-show" className="button-link">
            <PlusIcon size={16} />
            New show
          </a>
        }
      />
      <ErrorBanner searchParams={params} />
      <NewShowPanel venues={venues} artists={artists} open={readError(params) !== null} />

      {shows.length === 0 ? (
        <EmptyState title="No shows yet">
          <a href="#new-show">Create a show</a>, then import its ticket sales. New here?{" "}
          <Link href="/guide">Learn how it works</Link>.
        </EmptyState>
      ) : (
        <>
          <SummaryCards counts={summaryCounts} query={query} />
          {/* Keyed by the query: the inputs use defaultValue, which React only applies
              when they mount, so a card or "Clear filters" link (a client-side
              navigation) would otherwise leave the old search text in the box. */}
          <ShowsToolbar key={JSON.stringify(query)} query={query} chipCounts={chipCounts} />
          <ResultLine
            query={query}
            shown={visible.length}
            total={shows.length}
            filtered={filtered}
          />
          {visible.length > 0 ? (
            <ShowsTable shows={visible} />
          ) : (
            <EmptyState title="No shows match">
              Try another name, artist or venue, a different status, or{" "}
              <Link href={showsHref({ sort: query.sort })}>clear the filters</Link>.
            </EmptyState>
          )}
        </>
      )}
    </>
  );
}
