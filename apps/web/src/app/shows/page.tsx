import type { ArtistDto, ShowDto, VenueDto } from "@ledgerline/schemas";
import Link from "next/link";
import { api } from "../../lib/api";
import type { SearchParams } from "../../lib/flash";
import { formatShowDate } from "../../lib/format";
import { createArtist, createShow, createVenue } from "../actions";
import { ErrorBanner, StatusBadge } from "../components";

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
              <th>Settlement</th>
            </tr>
          </thead>
          <tbody>
            {shows.map((show) => (
              <tr key={show.id}>
                <td>{formatShowDate(show.showDate)}</td>
                <td>
                  <Link href={`/shows/${show.id}`}>{show.name}</Link>
                </td>
                <td>{show.artist.name}</td>
                <td>{show.venue.name}</td>
                <td>
                  {show.settlementStatus ? (
                    <StatusBadge status={show.settlementStatus} />
                  ) : (
                    <span className="muted">Not started</span>
                  )}
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
        <label>
          Venue
          <select name="venueId" required>
            {venues.map((venue) => (
              <option key={venue.id} value={venue.id}>
                {venue.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Artist
          <select name="artistId" required>
            {artists.map((artist) => (
              <option key={artist.id} value={artist.id}>
                {artist.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Create show</button>
      </form>

      <div className="form-grid">
        <form action={createVenue} className="card row">
          <label>
            New venue
            <input name="name" required />
          </label>
          <button type="submit" className="secondary">
            Add venue
          </button>
        </form>
        <form action={createArtist} className="card row">
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
