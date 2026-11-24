import type { ShowDto } from "@ledgerline/schemas";
import Link from "next/link";
import { notFound } from "next/navigation";
import { api, ApiError } from "../../../lib/api";
import { formatShowDate } from "../../../lib/format";
import { StatusBadge } from "../../components";
import { NavLink } from "../../nav-link";

// Shared header and tabs for every page of one show.
export default async function ShowLayout({
  params,
  children,
}: {
  params: Promise<{ showId: string }>;
  children: React.ReactNode;
}) {
  const { showId } = await params;
  let show: ShowDto;
  try {
    show = await api.get<ShowDto>(`/shows/${showId}`);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 400)) {
      notFound();
    }
    throw error;
  }

  return (
    <>
      <header className="show-header">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <Link href="/shows">Shows</Link>
          <span aria-hidden="true">/</span>
          <span>{formatShowDate(show.showDate)}</span>
        </nav>
        <div className="show-title">
          <h1>{show.name}</h1>
          {show.settlementStatus && <StatusBadge status={show.settlementStatus} />}
        </div>
        <p className="muted">
          {show.artist.name} at {show.venue.name}
        </p>
      </header>
      <nav className="tabs" aria-label="Show">
        <NavLink href={`/shows/${showId}`} exact>
          Sales &amp; expenses
        </NavLink>
        <NavLink href={`/shows/${showId}/import`}>Import sales</NavLink>
        <NavLink href={`/shows/${showId}/contract`}>Contract</NavLink>
        <NavLink href={`/shows/${showId}/terms`}>Deal terms</NavLink>
        <NavLink href={`/shows/${showId}/settlement`}>Settlement</NavLink>
      </nav>
      {children}
    </>
  );
}
