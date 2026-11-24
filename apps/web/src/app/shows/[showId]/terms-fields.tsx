import { ExpenseCategorySchema, type TermsDraft } from "@ledgerline/schemas";
import { bpsToInput, centsToInput, humanize } from "../../../lib/format";
import type { EvidenceMap, FieldEvidence } from "../../../lib/terms-form";

const DEAL_TYPES = [
  { value: "flat", label: "Flat guarantee" },
  { value: "percentage", label: "Percentage of NBOR" },
  { value: "versus", label: "Guarantee versus percentage" },
  { value: "guarantee_plus", label: "Guarantee plus split" },
] as const;

// Under a field: the contract's own words for it, or a warning that Claude did
// not find it. Shown only on the review page (where `evidence` is given).
function EvidenceNote({ evidence }: { evidence: FieldEvidence | undefined }) {
  if (evidence === undefined) return null;
  if (evidence === "missing") {
    return <span className="evidence evidence-missing">Not found in the contract</span>;
  }
  return (
    <span className="evidence">
      “{evidence.quote}” <span className="muted">p. {evidence.page}</span>
    </span>
  );
}

// The deal-terms inputs, without the <form> and submit button around them. The
// field names are what termsFromForm (lib/terms-form.ts) reads back. Every field is
// always shown; the label says which deal types use it.
export function TermsFields({
  draft,
  evidence,
}: {
  draft: TermsDraft | null;
  evidence?: EvidenceMap;
}) {
  const capOf = (category: string) =>
    draft?.categoryCaps.find((cap) => cap.category === category)?.capCents;
  const tiers = draft?.bonus?.tiers ?? [];
  const tierRows = Math.max(3, tiers.length);
  const note = (name: string) => <EvidenceNote evidence={evidence?.[name]} />;

  return (
    <>
      <fieldset>
        <legend>Deal</legend>
        <div className="form-grid">
          <label>
            Deal type
            <select name="dealType" defaultValue={draft?.dealType ?? ""}>
              <option value="">Choose…</option>
              {DEAL_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
            {note("dealType")}
          </label>
          <label>
            Guarantee ($) · flat, versus, guarantee plus
            <input
              name="guarantee"
              inputMode="decimal"
              defaultValue={centsToInput(draft?.guaranteeCents)}
            />
            {note("guarantee")}
          </label>
          <label>
            Artist share (%) · percentage, versus, guarantee plus
            <input
              name="artistShare"
              inputMode="decimal"
              defaultValue={bpsToInput(draft?.artistShareBps)}
            />
            {note("artistShare")}
          </label>
          <label>
            Promoter profit (%) · guarantee plus
            <input
              name="promoterProfit"
              inputMode="decimal"
              defaultValue={bpsToInput(draft?.promoterProfitBps)}
            />
            {note("promoterProfit")}
          </label>
          <label>
            Contract clause
            <input
              name="dealClause"
              required
              placeholder="§4.2"
              defaultValue={draft?.dealClauseRef ?? ""}
            />
            {note("dealClause")}
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend>Expenses · used by versus and guarantee plus</legend>
        {note("allowedCategories")}
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
              {ExpenseCategorySchema.options.map((category) => {
                // The column headers do not name an input for a screen reader, so each
                // input gets its own: "Allow production", "Production cap ($)".
                const name = humanize(category);
                const capitalized = name.charAt(0).toUpperCase() + name.slice(1);
                return (
                  <tr key={category}>
                    <td>
                      <input
                        type="checkbox"
                        name={`allow_${category}`}
                        defaultChecked={draft?.allowedCategories?.includes(category) ?? false}
                        aria-label={`Allow ${name}`}
                      />
                    </td>
                    <td>{name}</td>
                    <td>
                      <input
                        name={`cap_${category}`}
                        inputMode="decimal"
                        defaultValue={centsToInput(capOf(category))}
                        className="amount"
                        aria-label={`${capitalized} cap ($)`}
                      />
                      {evidence?.[`cap_${category}`] && note(`cap_${category}`)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="form-grid" style={{ marginTop: 12 }}>
          <label>
            Total expense cap ($, blank = none)
            <input
              name="totalCap"
              inputMode="decimal"
              defaultValue={centsToInput(draft?.totalCapCents)}
            />
            {note("totalCap")}
          </label>
          <label>
            Contract clause
            <input
              name="expenseClause"
              required
              placeholder="§5"
              defaultValue={draft?.expenseClauseRef ?? ""}
            />
            {note("expenseClause")}
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend>Bonus tiers</legend>
        <div className="form-grid">
          <label>
            Bonus
            {/* Short option labels: the select is one grid column wide, and a longer
                label was cut off. The values are what termsFromForm reads. */}
            <select name="bonusMode" defaultValue={draft?.bonus?.mode ?? "none"}>
              <option value="none">No bonus clause</option>
              <option value="cumulative">Cumulative: all tiers reached</option>
              <option value="highest_only">Highest tier only</option>
            </select>
            {note("bonusMode")}
          </label>
          <label>
            Contract clause
            <input
              name="bonusClause"
              placeholder="§6"
              defaultValue={draft?.bonus?.clauseRef ?? ""}
            />
            {note("bonusClause")}
          </label>
        </div>
        <input type="hidden" name="tierCount" value={tierRows} />
        {Array.from({ length: tierRows }, (_, index) => index).map((index) => {
          const tier = tiers[index];
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
                {evidence?.[`tier_${index}`] && note(`tier_${index}`)}
              </label>
            </div>
          );
        })}
      </fieldset>
    </>
  );
}
