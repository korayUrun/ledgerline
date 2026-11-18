import type { ShowDto } from "@ledgerline/schemas";
import Link from "next/link";
import { notFound } from "next/navigation";
import { api, ApiError } from "../../../lib/api";
import { StatusBadge } from "../../components";

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
      <p className="muted">
        <Link href="/shows">Shows</Link> / {show.showDate}
      </p>
      <h1>{show.name}</h1>
      <p className="muted">
        {show.artist.name} at {show.venue.name}
        {show.settlementStatus && (
          <>
            {" · settlement "}
            <StatusBadge status={show.settlementStatus} />
          </>
        )}
      </p>
      <nav className="tabs">
        <Link href={`/shows/${showId}`}>Sales &amp; expenses</Link>
        <Link href={`/shows/${showId}/import`}>Import sales</Link>
        <Link href={`/shows/${showId}/terms`}>Deal terms</Link>
        <Link href={`/shows/${showId}/settlement`}>Settlement worksheet</Link>
      </nav>
      {children}
    </>
  );
}
