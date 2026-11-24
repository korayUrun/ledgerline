import Link from "next/link";
import { readError, type SearchParams } from "../lib/flash";
import { humanize } from "../lib/format";

export function ErrorBanner({ searchParams }: { searchParams: SearchParams }) {
  const error = readError(searchParams);
  if (!error) {
    return null;
  }
  return (
    <div className="banner banner-error" role="alert">
      <strong>{error.message}</strong>
      {error.issues.length > 0 && (
        <ul>
          {error.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// One look for every status (settlement and expense), so colors mean the same everywhere.
// `label` replaces the raw enum text where a page has a proper word for it ("In review"
// rather than "in review"); the color still comes from the status.
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <span className={`badge badge-${status}`}>{label ?? humanize(status)}</span>;
}

// What a list says when it has nothing in it yet: what is missing, then what to do
// about it. One look everywhere, inside a table cell or on its own.
export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="empty-state">
      <p className="empty-state-title">{title}</p>
      {children && <p className="empty-state-text">{children}</p>}
    </div>
  );
}

// The one link that ends a step of the flow (sales, contract, terms, settlement), so
// the person always knows where to go next without reading the tabs.
export function NextStep({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <p className="next-step">
      Next:{" "}
      <Link href={href}>
        {children} <span aria-hidden="true">→</span>
      </Link>
    </p>
  );
}

// A padlock drawn in the text color. Decoration only: it always sits next to words
// that say "locked", so screen readers skip it.
export function LockIcon() {
  return (
    <svg
      className="icon"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <rect
        x="3"
        y="7"
        width="10"
        height="7"
        rx="1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

// Why a form is missing on a page whose settlement is approved: said where the form
// used to be, so nobody hunts for it.
export function LockedNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="locked-note">
      <LockIcon />
      <span>{children}</span>
    </p>
  );
}
