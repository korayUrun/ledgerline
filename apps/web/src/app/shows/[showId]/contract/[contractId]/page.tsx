import type { ContractDetailDto } from "@ledgerline/schemas";
import Link from "next/link";
import { notFound } from "next/navigation";
import { api, ApiError } from "../../../../../lib/api";
import type { SearchParams } from "../../../../../lib/flash";
import { evidenceFromExtraction } from "../../../../../lib/terms-form";
import { confirmContract } from "../../../../actions";
import { ErrorBanner, StatusBadge } from "../../../../components";
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
  const canConfirm = contract.status === "needs_review";
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
          <form action={confirmContract.bind(null, showId, contractId)}>
            {canConfirm ? (
              <div className="banner banner-info">
                <strong>Check each field against its quote from the PDF.</strong> The contract text
                is untrusted: Claude was told to ignore instructions inside it, and nothing counts
                until you confirm.
                {missingCount > 0 &&
                  ` ${missingCount} field(s) were not found; fill them in if the contract has them.`}
              </div>
            ) : (
              <div className="banner banner-warn">
                This contract is {contract.status.replaceAll("_", " ")} and can no longer be
                confirmed.
              </div>
            )}
            <TermsFields
              draft={contract.draft}
              evidence={evidenceFromExtraction(contract.extraction)}
            />
            <SubmitButton disabled={!canConfirm} pendingLabel="Confirming…">
              Confirm terms (creates a new version)
            </SubmitButton>
          </form>
        </div>
      )}
    </>
  );
}
