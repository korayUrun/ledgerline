import type { ContractDto, ShowDto, TermsDto } from "@ledgerline/schemas";
import Link from "next/link";
import { api } from "../../../../lib/api";
import type { SearchParams } from "../../../../lib/flash";
import { formatDateTime } from "../../../../lib/format";
import { contractGuidance } from "../../../../lib/show-guidance";
import { inputsLocked } from "../../../../lib/show-steps";
import { uploadContract } from "../../../actions";
import { ErrorBanner, LockedNote, NextStep, StatusBadge } from "../../../components";
import { SubmitButton } from "../../../submit-button";
import { GuidanceCard } from "../guidance-card";
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
  // All three are the same fetches as the layout's (deduped within the render). The
  // terms only tell the card whether terms were typed in without a contract.
  const [show, contracts, terms] = await Promise.all([
    api.get<ShowDto>(`/shows/${showId}`),
    api.get<ContractDto[]>(`/shows/${showId}/contracts`),
    api.get<TermsDto>(`/shows/${showId}/terms`),
  ]);
  const locked = inputsLocked(show.settlementStatus);
  const latest = contracts[0];
  const inProgress = latest?.status === "uploaded" || latest?.status === "extracting";
  const hasEarlier = contracts.length > 1;
  const guidance = contractGuidance({
    showId,
    status: show.settlementStatus,
    latestContract: latest ? { id: latest.id, status: latest.status } : null,
    hasTerms: terms.latest !== null,
  });

  return (
    <>
      {/* A plain meta refresh: no client JavaScript needed to poll the status. */}
      {inProgress && <meta httpEquiv="refresh" content="2" />}
      <ErrorBanner searchParams={await searchParams} />
      <GuidanceCard guidance={guidance} />

      <h2>Contract</h2>
      {latest && (
        <div className="card">
          <p>
            <strong>{latest.fileName}</strong> <StatusBadge status={latest.status} />{" "}
            <span className="muted">uploaded {formatDateTime(latest.createdAt)}</span>
          </p>
          {inProgress && <p className="muted">Claude is reading the contract…</p>}
          {latest.status === "needs_review" && locked && (
            <p>
              This upload was not confirmed before the settlement was approved.{" "}
              <Link href={`/shows/${showId}/contract/${latest.id}`}>See what was extracted</Link>.
            </p>
          )}
          {latest.status === "needs_review" && !locked && (
            // The filled "Review terms" button is in the card above; a plain link here.
            <p>
              The terms are extracted. Check each one against the PDF before it is used:{" "}
              <Link href={`/shows/${showId}/contract/${latest.id}`}>review the terms</Link>.
            </p>
          )}
          {latest.status === "confirmed" && (
            <p>
              Reviewed and confirmed. <Link href={`/shows/${showId}/terms`}>See the terms</Link>.
            </p>
          )}
          {latest.status === "failed" && (
            <div className="banner banner-error">
              Extraction failed: {latest.failureReason}.
              {!locked && (
                <>
                  {" "}
                  Upload the PDF again, or type the terms in on the{" "}
                  <Link href={`/shows/${showId}/terms`}>Deal terms</Link> tab.
                </>
              )}
            </div>
          )}
          <UsageNote usage={latest.usage} />
        </div>
      )}

      {locked ? (
        <LockedNote>
          Uploading a new contract is closed: the settlement was approved with the terms already
          confirmed.
        </LockedNote>
      ) : (
        <form action={uploadContract.bind(null, showId)} className="card">
          <p className="muted">
            {latest
              ? `Upload a new PDF to extract the terms again.${hasEarlier ? " Earlier uploads are kept below." : ""}`
              : "Upload the artist contract (PDF, max 10 MB). Claude extracts the deal terms; you review them before anything is computed."}
          </p>
          {/* Bottom-aligned so the button lines up with the file input, not its label. */}
          <div className="row" style={{ alignItems: "flex-end" }}>
            <label>
              Contract PDF
              <input type="file" name="file" accept="application/pdf" required />
            </label>
            {/* The first upload is the step's action; a re-upload is an option, and the
                card above holds the filled button. */}
            <SubmitButton className={latest ? "secondary" : undefined} pendingLabel="Uploading…">
              Upload and extract
            </SubmitButton>
          </div>
        </form>
      )}

      {hasEarlier && (
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

      {locked ? (
        <NextStep href={`/shows/${showId}/settlement`}>See the settlement</NextStep>
      ) : (
        <NextStep href={`/shows/${showId}/terms`}>Check the deal terms</NextStep>
      )}
    </>
  );
}
