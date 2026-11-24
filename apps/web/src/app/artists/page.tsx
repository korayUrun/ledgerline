import type { ArtistDto, ShowDto } from "@ledgerline/schemas";
import Link from "next/link";
import { api } from "../../lib/api";
import { buildDirectory, directoryHref, initials, matchesName } from "../../lib/directory";
import type { SearchParams } from "../../lib/flash";
import { readSearchText } from "../../lib/show-filters";
import { createArtist } from "../actions";
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

const NOUN: Noun = { one: "artist", many: "artists" };

// Read-only: who you book, how many shows each has, and whether their payouts can be
// sent. Two existing GET calls; the counts are worked out here (lib/directory.ts).
export default async function ArtistsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const search = readSearchText(await searchParams);
  const [artists, shows] = await Promise.all([
    api.get<ArtistDto[]>("/artists"),
    api.get<ShowDto[]>("/shows"),
  ]);
  const rows = buildDirectory(artists, shows, "artist");
  const visible = rows.filter((row) => matchesName(row.item.name, search));

  return (
    <>
      <PageHeader
        title="Artists"
        subtitle="Everyone you book, with their shows and whether payouts can reach them."
        actions={
          <a href="#new-artist" className="button-link">
            <PlusIcon size={16} />
            New artist
          </a>
        }
      />
      <AddPanel id="new-artist" noun={NOUN} action={createArtist} />

      {artists.length === 0 ? (
        <EmptyState title="No artists yet">
          <a href="#new-artist">Add an artist</a>, then book their first show on{" "}
          <Link href="/shows">Shows</Link>.
        </EmptyState>
      ) : (
        <>
          <DirectorySearch key={search} path="/artists" search={search} noun={NOUN} />
          <DirectoryResultLine
            path="/artists"
            search={search}
            shown={visible.length}
            total={artists.length}
            noun={NOUN}
          />
          {visible.length === 0 ? (
            <EmptyState title="No artists match">
              Try another name, or{" "}
              <Link href={directoryHref("/artists", "")}>clear the search</Link>.
            </EmptyState>
          ) : (
            <div className="table-wrap directory-table">
              <table>
                <thead>
                  <tr>
                    <th>Artist</th>
                    <th className="num">Shows</th>
                    <th>Latest show</th>
                    <th>Payouts</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(({ item: artist, showCount, latestShow }) => (
                    <tr key={artist.id}>
                      <td className="name-cell">
                        <NameCell
                          name={artist.name}
                          initials={initials(artist.name)}
                          shape="round"
                        />
                      </td>
                      <td className="num count-cell">
                        <ShowCount count={showCount} />
                      </td>
                      <td className="latest-cell">
                        <LatestShow show={latestShow} />
                      </td>
                      <td className="payout-cell">
                        <PayoutAccount
                          connected={artist.stripeAccountId !== null}
                          latestShow={latestShow}
                        />
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

// Whether the artist has a Stripe account to be paid into, in words and a symbol (the
// tone is only a third cue). Connecting happens on a show's Settlement page, so the
// hint links to the latest one; this page only reads.
function PayoutAccount({
  connected,
  latestShow,
}: {
  connected: boolean;
  latestShow: ShowDto | null;
}) {
  if (connected) {
    return (
      <span className="payout-state is-connected">
        {/* "Linked", not "connected": the id is set as soon as the account is created,
            before Stripe onboarding is finished, so payouts may not work yet. */}
        <span aria-hidden="true">✓</span> Stripe account linked
      </span>
    );
  }
  return (
    <>
      <span className="payout-state">
        <span aria-hidden="true">○</span> Not connected
      </span>
      <span className="payout-hint">
        {latestShow ? (
          <>
            Connect it from a show&apos;s{" "}
            <Link href={`/shows/${latestShow.id}/settlement`}>
              Settlement page
              <span className="visually-hidden"> ({latestShow.name})</span>
            </Link>
          </>
        ) : (
          <>Connect it from a show&apos;s Settlement page</>
        )}
      </span>
    </>
  );
}
