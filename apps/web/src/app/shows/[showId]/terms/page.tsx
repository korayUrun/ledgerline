import type { ContractTerms, TermsDto } from "@ledgerline/schemas";
import Link from "next/link";
import { api } from "../../../../lib/api";
import type { SearchParams } from "../../../../lib/flash";
import { formatDateTime } from "../../../../lib/format";
import { termsToDraft } from "../../../../lib/terms-form";
import { saveTerms } from "../../../actions";
import { ErrorBanner } from "../../../components";
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
  const { latest, versions } = await api.get<TermsDto>(`/shows/${showId}/terms`);
  const terms: ContractTerms | null = latest?.terms ?? null;

  return (
    <>
      <ErrorBanner searchParams={await searchParams} />
      <h2>Deal terms</h2>
      <p className="muted">
        {latest
          ? `Showing version ${latest.version}, confirmed by ${latest.confirmedByName} on ${formatDateTime(latest.confirmedAt)}. Saving creates version ${latest.version + 1}; old versions are kept.`
          : "No terms yet. Upload the contract on the Contract tab, or type the terms in here."}
      </p>

      <form action={saveTerms.bind(null, showId)}>
        <TermsFields draft={terms ? termsToDraft(terms) : null} />
        <button type="submit">Save as new version</button>
      </form>

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
    </>
  );
}
