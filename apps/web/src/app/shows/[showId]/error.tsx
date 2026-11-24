"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

// Shown instead of a raw runtime error when one page of a show fails to load (an API
// error the page does not handle). The show header and tabs above still render, so
// the person keeps their place. Never shows the error itself: in production Next.js
// hides server error details anyway, and a stack trace means nothing to a venue manager.
export default function ShowPageError({ retry }: { retry: () => void }) {
  // error.tsx gets no params prop; the show id comes from the URL.
  const { showId } = useParams<{ showId: string }>();
  return (
    <div className="card error-page" role="alert">
      <h2>Something went wrong loading this page.</h2>
      <p className="muted">Try again, or go back to the show and return to this step.</p>
      <div className="row">
        {/* retry(), not reset(): reset only redraws what already failed, retry asks the
            server for the page again, which is what fixes a failed API call. */}
        <button type="button" onClick={() => retry()}>
          Try again
        </button>
        <Link href={`/shows/${showId}`}>Back to the show</Link>
      </div>
    </div>
  );
}
