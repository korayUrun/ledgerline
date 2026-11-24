import type { ArtistDto, ShowDto, VenueDto } from "@ledgerline/schemas";
import Link from "next/link";
import { api } from "../../lib/api";
import type { SearchParams } from "../../lib/flash";
import { formatShowDate } from "../../lib/format";
import { createArtist, createShow, createVenue } from "../actions";
import { ErrorBanner, StatusBadge } from "../components";

// The settlement status, or "Not started" while a show has none.
function SettlementState({ show }: { show: ShowDto }) {
  return show.settlementStatus ? (
    <StatusBadge status={show.settlementStatus} />
  ) : (
    <span className="muted">Not started</span>
  );
}

export default async function ShowsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [shows, venues, artists] = await Promise.all([
    api.get<ShowDto[]>("/shows"),
    api.get<VenueDto[]>("/venues"),
    api.get<ArtistDto[]>("/artists"),
  ]);

  return (
    <>
      <h1>Shows</h1>
      <p className="muted">
        Pick a show to import sales, enter deal terms and compute its settlement.
      </p>
      <ErrorBanner searchParams={await searchParams} />

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Show</th>
              <th>Artist</th>
              <th>Venue</th>
              <th className="wide-only">Settlement</th>
            </tr>
          </thead>
          <tbody>
            {shows.map((show) => (
              <tr key={show.id}>
                <td>{formatShowDate(show.showDate)}</td>
                <td>
                  <Link href={`/shows/${show.id}`}>{show.name}</Link>
                  {/* On a phone the last column is off-screen, so the status goes
                      under the name, where it is read together with the show. */}
                  <span className="narrow-only cell-below">
                    <SettlementState show={show} />
                  </span>
                </td>
                <td>{show.artist.name}</td>
                <td>{show.venue.name}</td>
                <td className="wide-only">
                  <SettlementState show={show} />
                </td>
              </tr>
            ))}
            {shows.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No shows yet — create one below.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2>New show</h2>
      <form action={createShow} className="card form-grid">
        <label>
          Name
          <input name="name" required placeholder="Artist — Tour name" />
        </label>
        <label>
          Date
          <input name="showDate" type="date" required />
        </label>
        {/* The link sits on the label's line, so the dropdowns stay level with the other
            fields. It points at the forms further down; nothing new is sent. */}
        <div className="field">
          <div className="field-head">
            <label htmlFor="new-show-venue">Venue</label>
            <a href="#new-venue">Add venue</a>
          </div>
          <select id="new-show-venue" name="venueId" required>
            {venues.map((venue) => (
              <option key={venue.id} value={venue.id}>
                {venue.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <div className="field-head">
            <label htmlFor="new-show-artist">Artist</label>
            <a href="#new-artist">Add artist</a>
          </div>
          <select id="new-show-artist" name="artistId" required>
            {artists.map((artist) => (
              <option key={artist.id} value={artist.id}>
                {artist.name}
              </option>
            ))}
          </select>
        </div>
        <button type="submit">Create show</button>
      </form>

      <div className="form-grid">
        <form action={createVenue} id="new-venue" className="card row anchor-target">
          <label>
            New venue
            <input name="name" required />
          </label>
          <button type="submit" className="secondary">
            Add venue
          </button>
        </form>
        <form action={createArtist} id="new-artist" className="card row anchor-target">
          <label>
            New artist
            <input name="name" required />
          </label>
          <button type="submit" className="secondary">
            Add artist
          </button>
        </form>
      </div>
    </>
  );
}
