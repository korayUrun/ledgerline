import type { ArtistDto, ShowDto, VenueDto } from "@ledgerline/schemas";
import Form from "next/form";
import Link from "next/link";
import { formatShowDate } from "../../lib/format";
import {
  nextAction,
  showsHref,
  SORT_LABELS,
  SORT_SHORT_LABELS,
  STATUS_CHIPS,
  STATUS_FILTER_LABELS,
  SUMMARY_GROUPS,
  type ShowQuery,
  type ShowSort,
  type StatusFilter,
} from "../../lib/show-filters";
import { SETTLEMENT_STATUS_LABELS } from "../../lib/show-steps";
import { createArtist, createShow, createVenue } from "../actions";
import { StatusBadge } from "../components";
import { SearchIcon } from "../icons";

// The pieces of the shows dashboard (page.tsx puts them together). All server
// components: the filters are links and one GET form, so the state is the URL (it can
// be bookmarked and shared, and Back undoes a filter) and the page works with
// JavaScript off. With JavaScript on, Next.js turns both into client-side
// navigations: only the page's content is fetched again, the sidebar and the scroll
// position stay. (A plain <form method="get"> would reload the whole document.)

// --- Summary cards --------------------------------------------------------------------

// One line under each count: what the group holds, in words.
const GROUP_HINTS: Record<(typeof SUMMARY_GROUPS)[number], string> = {
  needs_action: "Not started, draft, computed or stale",
  in_review: "Waiting for a person to approve",
  in_payment: "Approved, payout on its way",
  paid: "Settled and paid out",
};

// Counts of shows, one card per thing they need. Each card is a link that applies its
// filter (keeping the sort, dropping the search, since the counts are of all shows).
export function SummaryCards({
  counts,
  query,
}: {
  counts: Record<StatusFilter, number>;
  query: ShowQuery;
}) {
  return (
    <ul className="stat-cards" aria-label="Shows by what they need">
      {SUMMARY_GROUPS.map((group) => {
        const active = query.status === group;
        // A failed payment is the one state that needs a person again, so the card
        // says so in words and in the danger tone, instead of hiding it in the count.
        const failed = group === "in_payment" ? counts.payment_failed : 0;
        return (
          <li key={group}>
            <Link
              href={showsHref({ status: group, sort: query.sort })}
              className={`stat-card stat-${group}`}
              aria-current={active ? "true" : undefined}
            >
              <span className="stat-label">{STATUS_FILTER_LABELS[group]}</span>
              <span className="stat-count">{counts[group]}</span>
              {failed > 0 ? (
                <span className="stat-hint stat-alert">
                  {failed} payment{failed === 1 ? "" : "s"} failed
                </span>
              ) : (
                <span className="stat-hint">{GROUP_HINTS[group]}</span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

// --- Toolbar ---------------------------------------------------------------------------

// Search, sort and the status chips in one GET form, so every control sends the other
// two along with it. The status travels on the submit buttons themselves (name="status"):
// a chip sends its own value, and "Apply" (the first submit button, so also the one
// Enter in the search box presses) sends the current one, which keeps the filter while
// you search or re-sort. A hidden status field would be sent twice next to a chip.
//
// Sorting waits for "Apply" on purpose: submitting on change would reload the page on
// every arrow key in some browsers (WCAG 3.2.2, On Input).
export function ShowsToolbar({
  query,
  chipCounts,
}: {
  query: ShowQuery;
  chipCounts: Record<StatusFilter, number>;
}) {
  // Chips with no shows are left out, except All and the one that is active (so the
  // pressed state never vanishes, e.g. after a search empties it).
  const chips = STATUS_CHIPS.filter(
    (chip) => chip === "all" || chip === query.status || chipCounts[chip] > 0,
  );
  const sorts = Object.keys(SORT_LABELS) as ShowSort[];
  return (
    <div className="toolbar">
      <div className="toolbar-row">
        {/* next/form: a GET form that navigates on the client. The hidden fields keep
            the status and sort, so a new search does not drop them. */}
        <Form action="/shows" scroll={false} className="search-form" role="search" aria-label="Shows">
          <div className="search-field">
            <label htmlFor="show-search" className="visually-hidden">
              Search shows
            </label>
            <SearchIcon size={16} />
            <input
              id="show-search"
              type="search"
              name="q"
              defaultValue={query.q}
              placeholder="Search show, artist or venue"
              maxLength={100}
            />
          </div>
          <input type="hidden" name="status" value={query.status} />
          <input type="hidden" name="sort" value={query.sort} />
          <button type="submit" className="secondary">
            Search
          </button>
        </Form>

        {/* A segmented control of links: one click applies the sort, no Apply button. */}
        <nav className="segmented" aria-label="Sort shows">
          <span className="segmented-label" aria-hidden="true">
            Sort
          </span>
          {sorts.map((sort) => (
            <Link
              key={sort}
              href={showsHref({ ...query, sort })}
              scroll={false}
              className="segment"
              aria-current={query.sort === sort ? "true" : undefined}
              aria-label={`Sort by ${SORT_LABELS[sort]}`}
            >
              {SORT_SHORT_LABELS[sort]}
            </Link>
          ))}
        </nav>
      </div>

      <nav className="chips" aria-label="Filter by settlement status">
        {chips.map((chip) => (
          <Link
            key={chip}
            href={showsHref({ ...query, status: chip })}
            scroll={false}
            className="chip"
            aria-current={query.status === chip ? "true" : undefined}
          >
            {STATUS_FILTER_LABELS[chip]}
            <span className="chip-count">{chipCounts[chip]}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}

// "3 of 8 shows", what is applied, in words (a card filter has no pressed chip), and the
// way back to everything.
export function ResultLine({
  query,
  shown,
  total,
  filtered,
}: {
  query: ShowQuery;
  shown: number;
  total: number;
  filtered: boolean;
}) {
  return (
    <div className="result-line">
      <p>
        {filtered ? (
          <>
            <strong>{shown}</strong> of {total} shows
            {query.status !== "all" && <> · Status: {STATUS_FILTER_LABELS[query.status]}</>}
            {query.q !== "" && <> · Search: “{query.q}”</>}
          </>
        ) : (
          <>
            {total} show{total === 1 ? "" : "s"}
          </>
        )}
      </p>
      {filtered && <Link href={showsHref({ sort: query.sort })}>Clear filters</Link>}
    </div>
  );
}

// --- Table -------------------------------------------------------------------------------

function SettlementBadge({ show }: { show: ShowDto }) {
  return show.settlementStatus ? (
    <StatusBadge
      status={show.settlementStatus}
      label={SETTLEMENT_STATUS_LABELS[show.settlementStatus]}
    />
  ) : (
    // Neutral badge (no tone class matches), so "Not started" lines up with the others.
    <StatusBadge status="not_started" label="Not started" />
  );
}

function NextActionCell({ show }: { show: ShowDto }) {
  const action = nextAction(show);
  if (action === null) {
    return (
      <span className="next-none">
        <span aria-hidden="true">—</span>
        <span className="visually-hidden">Nothing to do</span>
      </span>
    );
  }
  if (action.href === null) {
    return <span className="next-wait">{action.label}</span>;
  }
  return (
    <Link href={action.href} className="next-link">
      {action.label} <span aria-hidden="true">→</span>
    </Link>
  );
}

// Four columns instead of five: artist and venue sit under the show name, which is
// what you scan for. On a phone each row becomes a small card (CSS, .show-table).
export function ShowsTable({ shows }: { shows: ShowDto[] }) {
  return (
    <div className="table-wrap show-table">
      <table>
        <thead>
          <tr>
            <th>Show</th>
            <th>Date</th>
            <th>Settlement</th>
            <th>Next step</th>
          </tr>
        </thead>
        <tbody>
          {shows.map((show) => (
            <tr key={show.id}>
              <td className="show-cell">
                <Link href={`/shows/${show.id}`} className="show-name">
                  {show.name}
                </Link>
                <span className="show-meta">
                  {show.artist.name} · {show.venue.name}
                </span>
              </td>
              <td className="date-cell">
                <time dateTime={show.showDate}>{formatShowDate(show.showDate)}</time>
              </td>
              <td className="status-cell">
                <SettlementBadge show={show} />
              </td>
              <td className="next-cell">
                <NextActionCell show={show} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- New show panel ----------------------------------------------------------------------

// The create forms, out of the way until "New show" (a link to #new-show) asks for them.
// CSS shows the panel when it is the URL's target, or when one of its forms is (Add
// venue / Add artist), so it opens and closes without JavaScript. `open` keeps it open
// after a form came back with an error (?error=…), so the person sees the form the
// message is about. The forms and what they send are unchanged.
export function NewShowPanel({
  venues,
  artists,
  open,
}: {
  venues: VenueDto[];
  artists: ArtistDto[];
  open: boolean;
}) {
  return (
    <section
      id="new-show"
      className={`card new-show-panel anchor-target${open ? " is-open" : ""}`}
      aria-labelledby="new-show-title"
    >
      <div className="panel-head">
        <h2 id="new-show-title">New show</h2>
        {/* "#" clears the target, which closes the panel. When the error keeps it
            open, going back to the plain list is what closes it. */}
        <a href={open ? "/shows" : "#"} className="panel-close">
          Close
        </a>
      </div>
      <form action={createShow} className="form-grid">
        <label>
          Name
          <input name="name" required placeholder="Artist — Tour name" />
        </label>
        <label>
          Date
          <input name="showDate" type="date" required />
        </label>
        {/* The link sits on the label's line, so the dropdowns stay level with the other
            fields. It points at the forms below; nothing new is sent. */}
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

      <div className="panel-sub">
        <p className="panel-sub-title">Venue or artist not in the list?</p>
        <div className="form-grid">
          <form action={createVenue} id="new-venue" className="row add-form anchor-target">
            <label>
              New venue
              <input name="name" required />
            </label>
            <button type="submit" className="secondary">
              Add venue
            </button>
          </form>
          <form action={createArtist} id="new-artist" className="row add-form anchor-target">
            <label>
              New artist
              <input name="name" required />
            </label>
            <button type="submit" className="secondary">
              Add artist
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
