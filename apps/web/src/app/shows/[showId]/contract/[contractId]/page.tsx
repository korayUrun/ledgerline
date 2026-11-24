import type { ContractDetailDto, ShowDto, TermsDto } from "@ledgerline/schemas";
import Link from "next/link";
import { notFound } from "next/navigation";
import { api, ApiError } from "../../../../../lib/api";
import type { SearchParams } from "../../../../../lib/flash";
import { formatDateTime } from "../../../../../lib/format";
import { inputsLocked } from "../../../../../lib/show-steps";
import { evidenceFromExtraction, termsToDraft } from "../../../../../lib/terms-form";
import { confirmContract } from "../../../../actions";
import { ErrorBanner, LockIcon, StatusBadge } from "../../../../components";
import { SubmitButton } from "../../../../submit-button";
import { TermsFields } from "../../terms-fields";
import { UsageNote } from "../usage-note";

// F3: the PDF on the left, the extracted fields on the right. Under each field is
// the quote it came from, so the reviewer can check it in seconds; a field Claude
// did not find is marked, never guessed. Confirming saves a new terms version.
export default async function ContractReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ showId: string; contractId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { showId, contractId } = await params;
  let contract: ContractDetailDto;
  try {
    contract = await api.get<ContractDetailDto>(`/contracts/${contractId}`);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 400)) {
      notFound();
    }
    throw error;
  }
  // Same fetches as the layout's (deduped within the render): the settlement status,
  // and the terms version this contract became when it was confirmed.
  const [show, terms] = await Promise.all([
    api.get<ShowDto>(`/shows/${showId}`),
    api.get<TermsDto>(`/shows/${showId}/terms`),
  ]);
  const locked = inputsLocked(show.settlementStatus);
  const canConfirm = contract.status === "needs_review" && !locked;
  const confirmedAs =
    contract.status === "confirmed"
      ? (terms.versions.find((version) => version.contractId === contract.id) ?? null)
      : null;
  // The reviewer may have corrected Claude's draft before confirming, so a confirmed
  // contract shows the terms as confirmed. The API returns the terms of the latest
  // version only; for an older version, Claude's draft is all there is to show.
  const showsConfirmedTerms = confirmedAs !== null && terms.latest?.id === confirmedAs.id;
  const draft =
    showsConfirmedTerms && terms.latest ? termsToDraft(terms.latest.terms) : contract.draft;
  const missingCount = contract.extraction
    ? Object.values(evidenceFromExtraction(contract.extraction)).filter((e) => e === "missing")
        .length
    : 0;

  return (
    <>
      <ErrorBanner searchParams={await searchParams} />
      <h2>
        Review contract <StatusBadge status={contract.status} />
      </h2>
      <p className="muted">
        {contract.fileName} · <Link href={`/shows/${showId}/contract`}>back to uploads</Link>
      </p>
      <UsageNote usage={contract.usage} />

      {!contract.extraction ? (
        <p className="muted">Nothing to review yet ({contract.status.replaceAll("_", " ")}).</p>
      ) : (
        <div className="review-layout">
          <iframe
            className="pdf-viewer"
            src={`/contracts/${contractId}/pdf`}
            title={`Contract ${contract.fileName}`}
          />
          {canConfirm ? (
            <form action={confirmContract.bind(null, showId, contractId)}>
              <div className="banner banner-info">
                <strong>Check each field against its quote from the PDF.</strong> The contract text
                is untrusted: Claude was told to ignore instructions inside it, and nothing counts
                until you confirm.
                {missingCount > 0 &&
                  ` ${missingCount} field(s) were not found; fill them in if the contract has them.`}
              </div>
              <TermsFields draft={draft} evidence={evidenceFromExtraction(contract.extraction)} />
              <SubmitButton pendingLabel="Confirming…">
                Confirm terms (creates a new version)
              </SubmitButton>
            </form>
          ) : (
            // Nothing left to decide here: the same fields, read-only, with the reason.
            <div>
              {contract.status === "confirmed" ? (
                <div className="banner banner-success">
                  <strong>
                    <span aria-hidden="true">✓ </span>
                    {confirmedAs ? `Confirmed as terms v${confirmedAs.version}` : "Confirmed"}
                  </strong>
                  {confirmedAs &&
                    ` by ${confirmedAs.confirmedByName} on ${formatDateTime(confirmedAs.confirmedAt)}`}
                  .{" "}
                  {showsConfirmedTerms
                    ? "The fields show the terms as confirmed."
                    : "The fields show what Claude extracted; the current terms are on the Deal terms tab."}
                  {!locked && " To change a term, save a new version on the Deal terms tab."}
                </div>
              ) : locked ? (
                <div className="banner banner-locked">
                  <LockIcon />
                  <span>
                    The settlement was approved before this contract was confirmed, so it can no
                    longer be confirmed.
                  </span>
                </div>
              ) : (
                <div className="banner banner-warn">
                  This contract is {contract.status.replaceAll("_", " ")} and can no longer be
                  confirmed.
                </div>
              )}
              <fieldset disabled className="fieldset-plain">
                <TermsFields draft={draft} evidence={evidenceFromExtraction(contract.extraction)} />
              </fieldset>
            </div>
          )}
        </div>
      )}
    </>
  );
}
