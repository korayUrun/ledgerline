import type { ShowDto, VenueDto } from "@ledgerline/schemas";
import Link from "next/link";
import { api } from "../../lib/api";
import { buildDirectory, directoryHref, initials, matchesName } from "../../lib/directory";
import type { SearchParams } from "../../lib/flash";
import { readSearchText } from "../../lib/show-filters";
import { createVenue } from "../actions";
import { EmptyState } from "../components";
import {
  AddPanel,
  DirectoryResultLine,
  DirectorySearch,
  LatestShow,
  NameCell,
  ShowCount,
  type Noun,
} from "../directory";
import { PlusIcon } from "../icons";
import { PageHeader } from "../page-header";

const NOUN: Noun = { one: "venue", many: "venues" };

// Read-only: where your shows happen, how many each has, and the most recent one. The
// same pattern as the artists page, from GET /venues and GET /shows.
export default async function VenuesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const search = readSearchText(await searchParams);
  const [venues, shows] = await Promise.all([
    api.get<VenueDto[]>("/venues"),
    api.get<ShowDto[]>("/shows"),
  ]);
  const rows = buildDirectory(venues, shows, "venue");
  const visible = rows.filter((row) => matchesName(row.item.name, search));

  return (
    <>
      <PageHeader
        title="Venues"
        subtitle="Where your shows happen, with each room's most recent show."
        actions={
          <a href="#new-venue" className="button-link">
            <PlusIcon size={16} />
            New venue
          </a>
        }
      />
      <AddPanel id="new-venue" noun={NOUN} action={createVenue} />

      {venues.length === 0 ? (
        <EmptyState title="No venues yet">
          <a href="#new-venue">Add a venue</a>, then book a show there on{" "}
          <Link href="/shows">Shows</Link>.
        </EmptyState>
      ) : (
        <>
          <DirectorySearch key={search} path="/venues" search={search} noun={NOUN} />
          <DirectoryResultLine
            path="/venues"
            search={search}
            shown={visible.length}
            total={venues.length}
            noun={NOUN}
          />
          {visible.length === 0 ? (
            <EmptyState title="No venues match">
              Try another name, or <Link href={directoryHref("/venues", "")}>clear the search</Link>
              .
            </EmptyState>
          ) : (
            <div className="table-wrap directory-table">
              <table>
                <thead>
                  <tr>
                    <th>Venue</th>
                    <th className="num">Shows</th>
                    <th>Latest show</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(({ item: venue, showCount, latestShow }) => (
                    <tr key={venue.id}>
                      <td className="name-cell">
                        {/* Square for places, round for people (artists, the user). */}
                        <NameCell
                          name={venue.name}
                          initials={initials(venue.name)}
                          shape="square"
                        />
                      </td>
                      <td className="num count-cell">
                        <ShowCount count={showCount} />
                      </td>
                      <td className="latest-cell">
                        <LatestShow show={latestShow} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
