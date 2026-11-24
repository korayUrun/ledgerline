import type { ShowDto } from "@ledgerline/schemas";
import Link from "next/link";
import { directoryHref } from "../lib/directory";
import { formatShowDate } from "../lib/format";
import { SETTLEMENT_STATUS_LABELS } from "../lib/show-steps";
import { StatusBadge } from "./components";
import { SearchIcon } from "./icons";
import { SubmitButton } from "./submit-button";

// The pieces the artists and venues pages share. All server components: the search is
// a GET form, so the page works with JavaScript off and a search can be bookmarked,
// like the shows dashboard.

type DirectoryPath = "/artists" | "/venues";

// "artist" / "artists": the one word that changes between the two pages.
export type Noun = { one: string; many: string };

// A search box and a Search button. Keyed by the search on the page (see the shows
// page): defaultValue only applies on mount, so "Clear search" would otherwise leave
// the old text in the box.
export function DirectorySearch({
  path,
  search,
  noun,
}: {
  path: DirectoryPath;
  search: string;
  noun: Noun;
}) {
  const id = `${noun.many}-search`;
  return (
    <form method="get" action={path} className="toolbar-row" role="search" aria-label={noun.many}>
      <div className="search-field">
        <label htmlFor={id} className="visually-hidden">
          Search {noun.many}
        </label>
        <SearchIcon size={16} />
        <input
          id={id}
          type="search"
          name="q"
          defaultValue={search}
          placeholder={`Search ${noun.many} by name`}
          maxLength={100}
        />
      </div>
      <button type="submit" className="secondary">
        Search
      </button>
    </form>
  );
}

// "7 artists", or "4 of 7 artists · Search: “harbor”" and the way back.
export function DirectoryResultLine({
  path,
  search,
  shown,
  total,
  noun,
}: {
  path: DirectoryPath;
  search: string;
  shown: number;
  total: number;
  noun: Noun;
}) {
  return (
    <div className="result-line">
      <p>
        {search !== "" ? (
          <>
            <strong>{shown}</strong> of {total} {total === 1 ? noun.one : noun.many} · Search: “
            {search}”
          </>
        ) : (
          <>
            {total} {total === 1 ? noun.one : noun.many}
          </>
        )}
      </p>
      {search !== "" && <Link href={directoryHref(path, "")}>Clear search</Link>}
    </div>
  );
}

// The name with its initials badge. The badge is decoration (the name is right next
// to it), so screen readers skip it.
export function NameCell({
  name,
  initials,
  shape,
}: {
  name: string;
  initials: string;
  shape: "round" | "square";
}) {
  return (
    <span className="directory-name">
      <span className={`avatar${shape === "square" ? " avatar-square" : ""}`} aria-hidden="true">
        {initials}
      </span>
      <span className="directory-name-text">{name}</span>
    </span>
  );
}

// "2" under a "Shows" column; on a phone the header row is hidden, so the unit is
// written out ("2 shows"). A count of shows, never money.
export function ShowCount({ count }: { count: number }) {
  return (
    <>
      {count}
      <span className="count-unit"> {count === 1 ? "show" : "shows"}</span>
    </>
  );
}

// The most recent show: a link, its date and where its settlement stands (in words,
// with the badge's dot; never an amount).
export function LatestShow({ show }: { show: ShowDto | null }) {
  if (show === null) {
    return <span className="muted">No shows yet</span>;
  }
  return (
    <span className="latest-show">
      <span className="cell-label">Latest show</span>
      <Link href={`/shows/${show.id}`} className="latest-show-name">
        {show.name}
      </Link>
      <span className="latest-show-meta">
        <time dateTime={show.showDate}>{formatShowDate(show.showDate)}</time>
        {show.settlementStatus ? (
          <StatusBadge
            status={show.settlementStatus}
            label={SETTLEMENT_STATUS_LABELS[show.settlementStatus]}
          />
        ) : (
          <StatusBadge status="not_started" label="Not started" />
        )}
      </span>
    </span>
  );
}

// "New artist" / "New venue": hidden until the header's link targets it (#new-artist),
// like the shows page's New show panel, so it opens and closes without JavaScript.
// `action` is the existing createArtist / createVenue server action, which sends the
// name only and then goes to /shows (where the new name is in the show form's list,
// and where an error is shown). The note says so, so the jump is not a surprise.
export function AddPanel({
  id,
  noun,
  action,
}: {
  id: string;
  noun: Noun;
  action: (form: FormData) => Promise<void>;
}) {
  const inputId = `${id}-name`;
  return (
    <section id={id} className="card add-panel anchor-target" aria-labelledby={`${id}-title`}>
      <div className="panel-head">
        <h2 id={`${id}-title`}>New {noun.one}</h2>
        <a href="#" className="panel-close">
          Close
        </a>
      </div>
      <form action={action} className="row add-form">
        <label htmlFor={inputId}>
          Name
          <input id={inputId} name="name" required />
        </label>
        <SubmitButton pendingLabel="Adding…">Add {noun.one}</SubmitButton>
      </form>
      <p className="panel-note">
        After adding, you go to Shows, where the new {noun.one} is ready to pick for a show.
      </p>
    </section>
  );
}
