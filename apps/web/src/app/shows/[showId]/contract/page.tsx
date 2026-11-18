import type { ContractDto } from "@ledgerline/schemas";
import Link from "next/link";
import { api } from "../../../../lib/api";
import type { SearchParams } from "../../../../lib/flash";
import { formatDateTime } from "../../../../lib/format";
import { uploadContract } from "../../../actions";
import { ErrorBanner, StatusBadge } from "../../../components";
import { UsageNote } from "./usage-note";

// Upload the contract PDF (F2) and follow its extraction. The worker does the
// reading in the background; while it runs, this page reloads itself every 2 s.
export default async function ContractPage({
  params,
  searchParams,
}: {
  params: Promise<{ showId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { showId } = await params;
  const contracts = await api.get<ContractDto[]>(`/shows/${showId}/contracts`);
  const latest = contracts[0];
  const inProgress = latest?.status === "uploaded" || latest?.status === "extracting";

  return (
    <>
      {/* A plain meta refresh: no client JavaScript needed to poll the status. */}
      {inProgress && <meta httpEquiv="refresh" content="2" />}
      <ErrorBanner searchParams={await searchParams} />

      <h2>Contract</h2>
      {latest && (
        <div className="card">
          <p>
            <strong>{latest.fileName}</strong> <StatusBadge status={latest.status} />{" "}
            <span className="muted">uploaded {formatDateTime(latest.createdAt)}</span>
          </p>
          {inProgress && <p className="muted">Claude is reading the contract…</p>}
          {latest.status === "needs_review" && (
            <p>
              The terms are extracted.{" "}
              <Link href={`/shows/${showId}/contract/${latest.id}`}>
                Review them against the PDF
              </Link>{" "}
              before they are used.
            </p>
          )}
          {latest.status === "confirmed" && (
            <p>
              Reviewed and confirmed. <Link href={`/shows/${showId}/terms`}>See the terms</Link>.
            </p>
          )}
          {latest.status === "failed" && (
            <div className="banner banner-error">
              Extraction failed: {latest.failureReason}. Upload the PDF again, or type the terms in
              on the <Link href={`/shows/${showId}/terms`}>Deal terms</Link> tab.
            </div>
          )}
          <UsageNote usage={latest.usage} />
        </div>
      )}

      <form action={uploadContract.bind(null, showId)} className="card">
        <p className="muted">
          {latest
            ? "Upload a new PDF to extract the terms again. Earlier uploads are kept below."
            : "Upload the artist contract (PDF, max 10 MB). Claude extracts the deal terms; you review them before anything is computed."}
        </p>
        <div className="row">
          <input type="file" name="file" accept="application/pdf" required />
          <button type="submit">Upload and extract</button>
        </div>
      </form>

      {contracts.length > 1 && (
        <>
          <h2>Earlier uploads</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>File</th>
                  <th>Status</th>
                  <th>Uploaded</th>
                </tr>
              </thead>
              <tbody>
                {contracts.slice(1).map((contract) => (
                  <tr key={contract.id}>
                    <td>
                      <Link href={`/shows/${showId}/contract/${contract.id}`}>
                        {contract.fileName}
                      </Link>
                    </td>
                    <td>
                      <StatusBadge status={contract.status} />
                    </td>
                    <td>{formatDateTime(contract.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
