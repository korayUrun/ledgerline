"use client";

import Link from "next/link";

// The calm fallback for any page outside a show (show pages have their own error.tsx,
// which keeps the show header). Never shows the error itself or a stack trace.
export default function PageError({ retry }: { retry: () => void }) {
  return (
    <div className="card error-page" role="alert">
      <h2>Something went wrong loading this page.</h2>
      <p className="muted">Try again, or go back to your shows.</p>
      <div className="row">
        {/* retry() asks the server for the page again; reset() would only redraw it. */}
        <button type="button" onClick={() => retry()}>
          Try again
        </button>
        <Link href="/shows">Back to shows</Link>
      </div>
    </div>
  );
}
