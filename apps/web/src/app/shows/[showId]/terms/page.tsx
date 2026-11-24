import type { ContractTerms, ShowDto, TermsDto } from "@ledgerline/schemas";
import Link from "next/link";
import { api } from "../../../../lib/api";
import type { SearchParams } from "../../../../lib/flash";
import { formatDateTime } from "../../../../lib/format";
import { termsGuidance } from "../../../../lib/show-guidance";
import { inputsLocked } from "../../../../lib/show-steps";
import { termsToDraft } from "../../../../lib/terms-form";
import { saveTerms } from "../../../actions";
import { ErrorBanner, LockedNote, NextStep } from "../../../components";
import { SubmitButton } from "../../../submit-button";
import { GuidanceCard } from "../guidance-card";
import { TermsFields } from "../terms-fields";

// Typing terms in by hand. Usually they come from the contract PDF instead
// (Contract tab); this page shows the latest version either way.
export default async function TermsPage({
  params,
  searchParams,
}: {
  params: Promise<{ showId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { showId } = await params;
  // Both are the same fetches as the layout's (deduped within the render).
  const [show, { latest, versions }] = await Promise.all([
    api.get<ShowDto>(`/shows/${showId}`),
    api.get<TermsDto>(`/shows/${showId}/terms`),
  ]);
  const terms: ContractTerms | null = latest?.terms ?? null;
  const locked = inputsLocked(show.settlementStatus);
  const guidance = termsGuidance({
    showId,
    status: show.settlementStatus,
    latestVersion: latest?.version ?? null,
  });

  return (
    <>
      <ErrorBanner searchParams={await searchParams} />
      <GuidanceCard guidance={guidance} />
      <h2>Deal terms</h2>
      {locked ? (
        <>
          {latest && (
            <p className="muted">
              Version {latest.version}, confirmed by {latest.confirmedByName} on{" "}
              {formatDateTime(latest.confirmedAt)}.
            </p>
          )}
          <LockedNote>
            These terms can no longer be changed: the settlement was approved with them.
          </LockedNote>
          {/* A disabled fieldset disables every field inside it: the same layout as the
              form, readable, but nothing to type into and nothing to submit. */}
          <fieldset disabled className="fieldset-plain">
            <TermsFields draft={terms ? termsToDraft(terms) : null} />
          </fieldset>
        </>
      ) : (
        <>
          <p className="muted">
            {latest
              ? `Showing version ${latest.version}, confirmed by ${latest.confirmedByName} on ${formatDateTime(latest.confirmedAt)}. Saving creates version ${latest.version + 1}; old versions are kept.`
              : "No terms yet. Upload the contract on the Contract tab, or type the terms in here."}
          </p>
          <form action={saveTerms.bind(null, showId)}>
            <TermsFields draft={terms ? termsToDraft(terms) : null} />
            {/* Saving the first terms is the step's action; once a version exists, editing
                is an option, and the card's "Next: Settlement" is the filled button. */}
            <SubmitButton className={latest ? "secondary" : undefined} pendingLabel="Saving…">
              Save as new version
            </SubmitButton>
          </form>
        </>
      )}

      {versions.length > 0 && (
        <>
          <h2>Version history</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Confirmed by</th>
                  <th>Confirmed at</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((version) => (
                  <tr key={version.id}>
                    <td>v{version.version}</td>
                    <td>{version.confirmedByName}</td>
                    <td>{formatDateTime(version.confirmedAt)}</td>
                    <td>
                      {version.contractId ? (
                        <Link href={`/shows/${showId}/contract/${version.contractId}`}>
                          Reviewed contract
                        </Link>
                      ) : (
                        "Typed in"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <NextStep href={`/shows/${showId}/settlement`}>Go to the settlement</NextStep>
    </>
  );
}
