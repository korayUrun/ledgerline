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
export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-${status}`}>{humanize(status)}</span>;
}
