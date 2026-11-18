import { ExpenseCategorySchema, type ContractTerms, type TermsDto } from "@ledgerline/schemas";
import { api } from "../../../../lib/api";
import type { SearchParams } from "../../../../lib/flash";
import { bpsToInput, centsToInput, formatDateTime, humanize } from "../../../../lib/format";
import { saveTerms } from "../../../actions";
import { ErrorBanner } from "../../../components";

const DEAL_TYPES = [
  { value: "flat", label: "Flat guarantee" },
  { value: "percentage", label: "Percentage of NBOR" },
  { value: "versus", label: "Guarantee versus percentage" },
  { value: "guarantee_plus", label: "Guarantee plus split" },
] as const;

// The form always shows every field. Which ones count depends on the deal type
// (written next to each label); the server action reads only those.
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
  const deal = terms?.deal;
  const policy = terms?.expensePolicy;
  const capOf = (category: string) =>
    policy?.categoryCaps.find((cap) => cap.category === category)?.capCents;

  return (
    <>
      <ErrorBanner searchParams={await searchParams} />
      <h2>Deal terms</h2>
      <p className="muted">
        {latest
          ? `Showing version ${latest.version}, confirmed by ${latest.confirmedByName} on ${formatDateTime(latest.confirmedAt)}. Saving creates version ${latest.version + 1}; old versions are kept.`
          : "No terms yet. In Phase 3 these come from the contract PDF; for now they are typed in by hand."}
      </p>

      <form action={saveTerms.bind(null, showId)}>
        <fieldset>
          <legend>Deal</legend>
          <div className="form-grid">
            <label>
              Deal type
              <select name="dealType" defaultValue={deal?.type ?? "versus"}>
                {DEAL_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Guarantee ($) · flat, versus, guarantee plus
              <input
                name="guarantee"
                inputMode="decimal"
                defaultValue={
                  deal && "guaranteeCents" in deal ? centsToInput(deal.guaranteeCents) : ""
                }
              />
            </label>
            <label>
              Artist share (%) · percentage, versus, guarantee plus
              <input
                name="artistShare"
                inputMode="decimal"
                defaultValue={
                  deal && "artistShareBps" in deal ? bpsToInput(deal.artistShareBps) : ""
                }
              />
            </label>
            <label>
              Promoter profit (%) · guarantee plus
              <input
                name="promoterProfit"
                inputMode="decimal"
                defaultValue={
                  deal?.type === "guarantee_plus" ? bpsToInput(deal.promoterProfitBps) : ""
                }
              />
            </label>
            <label>
              Contract clause
              <input
                name="dealClause"
                required
                placeholder="§4.2"
                defaultValue={deal?.clauseRef ?? ""}
              />
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>Expenses · used by versus and guarantee plus</legend>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Allowed</th>
                  <th>Category</th>
                  <th>Cap ($, blank = no cap)</th>
                </tr>
              </thead>
              <tbody>
                {ExpenseCategorySchema.options.map((category) => (
                  <tr key={category}>
                    <td>
                      <input
                        type="checkbox"
                        name={`allow_${category}`}
                        defaultChecked={policy?.allowedCategories.includes(category) ?? false}
                      />
                    </td>
                    <td>{humanize(category)}</td>
                    <td>
                      <input
                        name={`cap_${category}`}
                        inputMode="decimal"
                        defaultValue={centsToInput(capOf(category))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <label>
              Total expense cap ($, blank = none)
              <input
                name="totalCap"
                inputMode="decimal"
                defaultValue={centsToInput(policy?.totalCapCents)}
              />
            </label>
            <label>
              Contract clause
              <input
                name="expenseClause"
                required
                placeholder="§5"
                defaultValue={policy?.clauseRef ?? ""}
              />
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>Bonus tiers</legend>
          <div className="form-grid">
            <label>
              Bonus
              <select name="bonusMode" defaultValue={terms?.bonus?.mode ?? "none"}>
                <option value="none">No bonus clause</option>
                <option value="cumulative">Cumulative (every tier reached pays)</option>
                <option value="highest_only">Highest tier only</option>
              </select>
            </label>
            <label>
              Contract clause
              <input
                name="bonusClause"
                placeholder="§6"
                defaultValue={terms?.bonus?.clauseRef ?? ""}
              />
            </label>
          </div>
          {[0, 1, 2].map((index) => {
            const tier = terms?.bonus?.tiers[index];
            return (
              <div className="form-grid" key={index} style={{ marginTop: 8 }}>
                <label>
                  Tier {index + 1}: paid tickets ≥
                  <input
                    name={`tierTickets_${index}`}
                    inputMode="numeric"
                    defaultValue={tier?.minTicketsSold ?? ""}
                  />
                </label>
                <label>
                  Tier {index + 1}: bonus ($)
                  <input
                    name={`tierBonus_${index}`}
                    inputMode="decimal"
                    defaultValue={centsToInput(tier?.bonusCents)}
                  />
                </label>
              </div>
            );
          })}
        </fieldset>

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
                </tr>
              </thead>
              <tbody>
                {versions.map((version) => (
                  <tr key={version.id}>
                    <td>v{version.version}</td>
                    <td>{version.confirmedByName}</td>
                    <td>{formatDateTime(version.confirmedAt)}</td>
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
