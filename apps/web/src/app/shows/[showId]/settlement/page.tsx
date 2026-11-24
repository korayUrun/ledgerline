import {
  formatCents,
  type AgentRunDto,
  type AuditEntryDto,
  type ExpenseFlagDto,
  type PayoutDto,
  type SettlementDto,
  type SettlementInput,
  type SettlementLine,
  type SettlementViewDto,
  type ShowDto,
  type SourceRef,
} from "@ledgerline/schemas";
import Link from "next/link";
import { api } from "../../../../lib/api";
import type { SearchParams } from "../../../../lib/flash";
import { formatDateTime, humanize } from "../../../../lib/format";
import { inputsLocked } from "../../../../lib/show-steps";
import {
  approveSettlement,
  computeSettlement,
  connectStripeAccount,
  resolveFlag,
  retryPayment,
  submitForReview,
} from "../../../actions";
import { ErrorBanner, StatusBadge } from "../../../components";
import { SubmitButton } from "../../../submit-button";
import { AssistantPanel } from "./assistant-panel";

// F5: the worksheet. Every line shows the contract clause it applies and the
// input rows it was computed from. Those rows come from the settlement's frozen
// inputSnapshot, not the live tables, so the worksheet always explains exactly
// the numbers that were computed, even after the inputs change.
export default async function SettlementPage({
  params,
  searchParams,
}: {
  params: Promise<{ showId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { showId } = await params;
  const view = await api.get<SettlementViewDto>(`/shows/${showId}/settlement`);
  const settlement = view.settlement;
  const show = await api.get<ShowDto>(`/shows/${showId}`);
  const artistAccount = show.artist.stripeAccountId;
  // Approval and retry need somewhere to send the money (the API checks too).
  const needsAccount =
    artistAccount === null &&
    (settlement?.status === "in_review" || settlement?.status === "payment_failed");
  const history = settlement
    ? await api.get<AuditEntryDto[]>(`/audit?entity=settlement&entityId=${settlement.id}`)
    : [];
  const flags = settlement
    ? await api.get<ExpenseFlagDto[]>(`/settlements/${settlement.id}/flags`)
    : [];
  const runs = settlement
    ? await api.get<AgentRunDto[]>(`/settlements/${settlement.id}/agent-runs`)
    : [];
  const openFlagCount = flags.filter((flag) => flag.status === "open").length;
  const canSubmit =
    settlement?.status === "computed" && view.pendingExpenseCount === 0 && openFlagCount === 0;
  // The assistant audits a result that matches the data (the API checks it too).
  const canAsk = settlement?.status === "computed" || settlement?.status === "in_review";
  // From approval on, nothing can be recomputed or resubmitted (the API refuses too).
  const locked = inputsLocked(settlement?.status ?? null);
  // One filled button per state, the step that moves the settlement forward: compute
  // while there is no current result, submit once there is one. In review, the filled
  // button is "Approve and pay", so Recompute steps back too.
  const needsCompute =
    !settlement || settlement.status === "draft" || settlement.status === "stale";
  const submitPrimary = settlement?.status === "computed";
  const submitBlockedReason = submitBlocked(settlement, view.pendingExpenseCount, openFlagCount);

  return (
    <>
      <ErrorBanner searchParams={await searchParams} />

      {settlement?.status === "stale" && (
        <div className="banner banner-warn">
          <strong>Stale:</strong> the inputs changed after this was computed. The numbers below are
          the old result. Recompute to update them.
        </div>
      )}
      {view.pendingExpenseCount > 0 && (
        <div className="banner banner-warn">
          {view.pendingExpenseCount} expense(s) are still pending. They are included in the math as
          a preview, but the settlement cannot go to review until each one is allowed or disallowed
          on the <Link href={`/shows/${showId}`}>expenses tab</Link>.
        </div>
      )}
      {openFlagCount > 0 && (
        <div className="banner banner-warn">
          The assistant flagged {openFlagCount} expense(s). Accept or dismiss each flag below before
          submitting for review.
        </div>
      )}
      {canSubmit && (
        <div className="banner banner-info">
          Computed. Check the worksheet below, then submit it for review.
        </div>
      )}
      {settlement?.status === "in_review" && (
        <div className="banner banner-info">
          In review. Approving starts the payout to the artist; after that the inputs are locked.
        </div>
      )}
      {/* Approved, paying and paid need no banner here: the show layout's "inputs are
          locked" banner above already says it, with what happens to the money. */}
      {settlement?.status === "payment_failed" && (
        <div className="banner banner-error">
          The payout failed ({view.payouts[0]?.failureReason ?? "no reason given"}). Fix the cause,
          then retry: the retry is a new attempt with its own key.
        </div>
      )}

      {needsAccount && (
        <div className="banner banner-warn">
          {show.artist.name} has no Stripe account to receive the payout yet. Connect one (Stripe
          test mode: fill in the onboarding page with test data), then approve.
        </div>
      )}

      <div className="row actions">
        {!locked && (
          <>
            <form action={computeSettlement.bind(null, showId)}>
              <SubmitButton
                className={needsCompute ? undefined : "secondary"}
                pendingLabel="Computing…"
              >
                {settlement && settlement.status !== "draft" ? "Recompute" : "Compute settlement"}
              </SubmitButton>
            </form>
            <div className="action-group">
              <form action={submitForReview.bind(null, showId)}>
                <SubmitButton
                  className={submitPrimary ? undefined : "secondary"}
                  disabled={!canSubmit}
                  describedBy={submitBlockedReason ? "submit-blocked-reason" : undefined}
                  pendingLabel="Submitting…"
                >
                  Submit for review
                </SubmitButton>
              </form>
              {/* Why the button is greyed out, in words, next to it. */}
              {submitBlockedReason && (
                <p id="submit-blocked-reason" className="action-reason">
                  {submitBlockedReason}
                </p>
              )}
            </div>
          </>
        )}
        {(needsAccount || (artistAccount !== null && settlement?.status === "in_review")) && (
          <form action={connectStripeAccount.bind(null, showId, show.artist.id)}>
            <button type="submit" className="secondary">
              {artistAccount === null ? "Connect Stripe account" : "Finish Stripe onboarding"}
            </button>
          </form>
        )}
        {settlement?.status === "in_review" && (
          <form action={approveSettlement.bind(null, showId)} className="approve-form">
            {/* Approving moves (test) money and cannot be undone, so the person confirms
                the amount and the payee first. The checkbox has no name, so the form
                sends exactly what it did before; `required` makes the browser block the
                submit until it is ticked. */}
            <label className="inline">
              <input type="checkbox" required />I have checked the worksheet. Pay{" "}
              {settlement.payoutCents === null ? "the payout" : formatCents(settlement.payoutCents)}{" "}
              to {show.artist.name}.
            </label>
            <SubmitButton
              disabled={needsAccount}
              describedBy={needsAccount ? "approve-blocked-reason" : undefined}
              pendingLabel="Approving…"
            >
              Approve and pay{" "}
              {settlement.payoutCents === null ? "" : formatCents(settlement.payoutCents)}
            </SubmitButton>
            {needsAccount && (
              <p id="approve-blocked-reason" className="action-reason">
                Connect a Stripe account for {show.artist.name} first.
              </p>
            )}
          </form>
        )}
        {settlement?.status === "payment_failed" && (
          <form action={retryPayment.bind(null, showId)}>
            <SubmitButton pendingLabel="Retrying…">Retry payment</SubmitButton>
          </form>
        )}
      </div>

      {!settlement || settlement.status === "draft" ? (
        <p className="muted">
          Not computed yet. Make sure the show has ticket sales and deal terms, then compute.
        </p>
      ) : (
        <>
          <PayoutSummary settlement={settlement} />

          <h2>Worksheet</h2>
          <div className="table-wrap worksheet">
            <table>
              <thead>
                <tr>
                  <th>Step</th>
                  <th className="num">Amount</th>
                  <th className="wide-only">Clause</th>
                  <th className="wide-only">Computed from</th>
                </tr>
              </thead>
              <tbody>
                {settlement.lines.map((line, index) => (
                  <tr key={index} className={lineClass(line.kind)}>
                    <td>
                      {line.label}
                      {/* On a phone the two right columns are hidden, so the clause and
                          sources move under the label instead of off-screen. */}
                      <div className="line-meta narrow-only">
                        {/* The total has neither a clause nor sources: no lone "—" here. */}
                        {(line.clauseRef !== null || line.sourceRefs.length > 0) && (
                          <div>
                            <LineClause line={line} />
                          </div>
                        )}
                        <LineSources line={line} snapshot={settlement.inputSnapshot} />
                      </div>
                    </td>
                    <td className="num">{formatCents(line.amountCents)}</td>
                    <td className="wide-only">
                      <LineClause line={line} />
                    </td>
                    <td className="wide-only">
                      <LineSources line={line} snapshot={settlement.inputSnapshot} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {view.payouts.length > 0 && (
            <PaymentDetails
              payouts={view.payouts}
              artistName={show.artist.name}
              artistAccount={artistAccount}
              // Open only when the payout failed: then the person must read why and act.
              open={settlement.status === "payment_failed"}
            />
          )}

          <h2>Assistant</h2>
          {canAsk ? (
            <AssistantPanel settlementId={settlement.id} />
          ) : (
            <p className="muted">
              {locked
                ? "The assistant is available before approval."
                : "Recompute the settlement to use the assistant."}
            </p>
          )}
          {flags.length > 0 && <FlagsTable showId={showId} flags={flags} />}
          {runs.length > 0 && <RunsList showId={showId} runs={runs} />}

          {settlement.inputSnapshot && <SnapshotTables snapshot={settlement.inputSnapshot} />}
        </>
      )}

      {history.length > 0 && (
        <>
          <h2>History</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>What</th>
                  <th>Change</th>
                </tr>
              </thead>
              <tbody>
                {history.map((entry) => (
                  <tr key={entry.id}>
                    <td>{formatDateTime(entry.at)}</td>
                    <td>
                      <code>{entry.actor.startsWith("user:") ? "user" : entry.actor}</code>
                    </td>
                    <td>{humanize(entry.action.replace("settlement.", ""))}</td>
                    <td>{describeChange(entry)}</td>
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

// Why "Submit for review" is disabled, in words (the API refuses in these cases too).
// null when it is enabled, or when a later step owns the page (review, payment).
function submitBlocked(
  settlement: SettlementDto | null,
  pendingExpenseCount: number,
  openFlagCount: number,
): string | null {
  if (!settlement || settlement.status === "draft") return "Compute the settlement first.";
  if (settlement.status === "stale") return "The inputs changed. Recompute first.";
  if (settlement.status !== "computed") return null;
  const reasons: string[] = [];
  if (pendingExpenseCount > 0) {
    reasons.push(`${pendingExpenseCount} expense(s) still pending on the expenses tab.`);
  }
  if (openFlagCount > 0) {
    reasons.push(`${openFlagCount} assistant flag(s) to accept or dismiss below.`);
  }
  return reasons.length > 0 ? reasons.join(" ") : null;
}

function lineClass(kind: string): string {
  if (kind === "total_payout") return "total";
  if (kind === "nbor" || kind === "allowed_expenses" || kind === "deal_payout") return "subtotal";
  return "";
}

// A line with no contract clause comes straight from the input rows (sales or
// expenses), or it adds up the lines above (the total), which has no source of its own.
function noClauseLabel(sourceRefs: SourceRef[]): string {
  const firstRef = sourceRefs[0];
  if (firstRef === undefined) return "—";
  return firstRef.type === "ticket_sale" ? "Sales data" : "Expense data";
}

// What a source row contributes to *this* line. The tax and fee lines are explained by
// each tier's stored tax or fee total, not by qty × price (that explains the gross).
// Only stored cents are formatted here; nothing is added up in the browser.
function describeSource(
  ref: SourceRef,
  snapshot: SettlementInput | null,
  lineKind: SettlementLine["kind"],
): string {
  if (ref.type === "ticket_sale") {
    const sale = snapshot?.ticketSales.find((row) => row.id === ref.id);
    if (!sale) return `ticket sale ${ref.id}`;
    if (lineKind === "ticket_tax") return `${sale.tierName}: tax ${formatCents(sale.taxCents)}`;
    if (lineKind === "ticket_fees") return `${sale.tierName}: fees ${formatCents(sale.feeCents)}`;
    return `${sale.tierName}: ${sale.qtySold} × ${formatCents(sale.priceCents)}`;
  }
  const expense = snapshot?.expenses.find((row) => row.id === ref.id);
  return expense
    ? `${humanize(expense.category)} ${formatCents(expense.amountCents)} (${expenseDecision(expense.status)})`
    : `expense ${ref.id}`;
}

// The expense status is a person's decision on the expenses tab, not the contract's
// rule. Plain "allowed" next to a line saying the contract does not allow the
// category read as a contradiction, so say who decided.
function expenseDecision(status: SettlementInput["expenses"][number]["status"]): string {
  if (status === "allowed") return "approved by you";
  if (status === "disallowed") return "disallowed by you";
  return "pending";
}

function describeChange(entry: AuditEntryDto): string {
  const before = entry.before as { status?: string; payoutCents?: number | null } | null;
  const after = entry.after as {
    status?: string;
    payoutCents?: number | null;
    reason?: string;
  } | null;
  const parts: string[] = [];
  if (before?.status !== after?.status)
    parts.push(`${humanize(before?.status ?? "—")} → ${humanize(after?.status ?? "—")}`);
  if (
    after?.payoutCents !== undefined &&
    after.payoutCents !== null &&
    before?.payoutCents !== after.payoutCents
  ) {
    parts.push(`payout ${formatCents(after.payoutCents)}`);
  }
  if (after?.reason) parts.push(after.reason);
  return parts.join(" · ");
}

// The payout comes first and is the biggest thing on the page. The status is not
// repeated here (the header badge and the banner say it). On a stale settlement the
// old figure is greyed and labelled, so it never reads as the current amount.
function PayoutSummary({ settlement }: { settlement: SettlementDto }) {
  const outdated = settlement.status === "stale";
  return (
    <div className="card summary">
      <span className="muted">Artist payout</span>
      <div className="summary-figure">
        <strong className={outdated ? "payout-amount payout-outdated" : "payout-amount"}>
          {settlement.payoutCents === null ? "—" : formatCents(settlement.payoutCents)}
        </strong>
        {outdated && (
          <span className="outdated-label">
            <span aria-hidden="true">{"\u26A0\uFE0E"}</span> Outdated
          </span>
        )}
      </div>
      {/* Audit details: useful to trace a result, not to read the payout. */}
      <p className="summary-meta muted">
        v{settlement.version} · terms v{settlement.termsVersion} · computed{" "}
        {settlement.computedAt ? formatDateTime(settlement.computedAt) : "—"} · engine{" "}
        {settlement.engineVersion} · inputs{" "}
        <code title={settlement.inputsHash ?? ""}>{settlement.inputsHash?.slice(0, 12)}</code>
      </p>
    </div>
  );
}

function LineClause({ line }: { line: SettlementLine }) {
  return <>{line.clauseRef ?? <span className="muted">{noClauseLabel(line.sourceRefs)}</span>}</>;
}

function LineSources({
  line,
  snapshot,
}: {
  line: SettlementLine;
  snapshot: SettlementInput | null;
}) {
  if (line.sourceRefs.length === 0) return <span className="muted">lines above</span>;
  return (
    <>
      {line.sourceRefs.map((ref) => (
        <div key={`${ref.type}-${ref.id}`}>
          <a href={`#src-${ref.id}`} className="source-ref">
            {describeSource(ref, snapshot, line.kind)}
          </a>
        </div>
      ))}
    </>
  );
}

// Every attempt to send the money, newest first. The idempotency key is shown so a
// person can find the same attempt in the Stripe dashboard. Tucked away once paid:
// it is for tracing a payment, not for reading the settlement.
function PaymentDetails({
  payouts,
  artistName,
  artistAccount,
  open,
}: {
  payouts: PayoutDto[];
  artistName: string;
  artistAccount: string | null;
  open: boolean;
}) {
  return (
    <details className="payment-details" open={open}>
      <summary>Payment details</summary>
      {artistAccount !== null && (
        <p className="muted">
          Paid to {artistName}&apos;s Stripe account <code>{artistAccount}</code> (test mode).
        </p>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Attempt</th>
              <th className="num">Amount</th>
              <th>Status</th>
              <th>Stripe transfer</th>
              <th>Idempotency key</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {payouts.map((payout) => (
              <tr key={payout.id}>
                <td>{payout.attempt}</td>
                <td className="num">{formatCents(payout.amountCents)}</td>
                <td>
                  <span className={`badge badge-payout_${payout.status}`}>{payout.status}</span>
                  {payout.failureReason && <div className="muted">{payout.failureReason}</div>}
                </td>
                <td>{payout.stripeTransferId ? <code>{payout.stripeTransferId}</code> : "—"}</td>
                <td>
                  <code>{payout.idempotencyKey}</code>
                </td>
                <td>{formatDateTime(payout.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

// Flags the assistant opened. Only a person resolves them; accepting is agreement,
// and the expense itself is changed on the expenses tab.
function FlagsTable({ showId, flags }: { showId: string; flags: ExpenseFlagDto[] }) {
  return (
    <>
      <h2>Assistant flags</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Expense</th>
              <th className="num">Amount</th>
              <th>Problem</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {flags.map((flag) => (
              <tr key={flag.id}>
                <td>
                  {humanize(flag.expense.category)}
                  <div className="muted">{flag.expense.description}</div>
                </td>
                <td className="num">{formatCents(flag.expense.amountCents)}</td>
                <td>
                  <strong>{humanize(flag.kind)}</strong>
                  <div>{flag.reason}</div>
                </td>
                <td>
                  <span className={`badge badge-flag_${flag.status}`}>{flag.status}</span>
                </td>
                <td>
                  {flag.status === "open" && (
                    <div className="row">
                      <form action={resolveFlag.bind(null, showId, flag.id, "accepted")}>
                        <button type="submit">Accept</button>
                      </form>
                      <form action={resolveFlag.bind(null, showId, flag.id, "dismissed")}>
                        <button type="submit" className="secondary">
                          Dismiss
                        </button>
                      </form>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">
        Accepting records that you agree. To take the expense out of the payout, mark it disallowed
        on the <Link href={`/shows/${showId}`}>expenses tab</Link> and recompute.
      </p>
    </>
  );
}

// Every assistant run on this settlement, newest first, each with its replay.
function RunsList({ showId, runs }: { showId: string; runs: AgentRunDto[] }) {
  return (
    <>
      <h2>Assistant history</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Run</th>
              <th>Result</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id}>
                <td>{formatDateTime(run.startedAt)}</td>
                <td>{run.kind === "audit" ? "Audit" : run.question}</td>
                <td>{run.status === "completed" ? humanize(run.outcome ?? "") : run.status}</td>
                <td>
                  <Link href={`/shows/${showId}/settlement/runs/${run.id}`}>Replay</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// The frozen inputs. Worksheet links jump here (#src-<id>), so a reader can check
// each number against the exact row the engine saw.
function SnapshotTables({ snapshot }: { snapshot: SettlementInput }) {
  return (
    <>
      <h2>Inputs used (frozen snapshot)</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Ticket tier</th>
              <th className="num">Paid</th>
              <th className="num">Price</th>
              <th className="num">Tax</th>
              <th className="num">Fees</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.ticketSales.map((sale) => (
              <tr key={sale.id} id={`src-${sale.id}`} className="target">
                <td>{sale.tierName}</td>
                <td className="num">{sale.qtySold}</td>
                <td className="num">{formatCents(sale.priceCents)}</td>
                <td className="num">{formatCents(sale.taxCents)}</td>
                <td className="num">{formatCents(sale.feeCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Expense</th>
              <th className="num">Amount</th>
              <th>Status</th>
              <th>Id</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.expenses.map((expense) => (
              <tr key={expense.id} id={`src-${expense.id}`} className="target">
                <td>{humanize(expense.category)}</td>
                <td className="num">{formatCents(expense.amountCents)}</td>
                <td>
                  <StatusBadge status={expense.status} />
                </td>
                <td>
                  <code>{expense.id.slice(0, 8)}</code>
                </td>
              </tr>
            ))}
            {snapshot.expenses.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  No expenses in this snapshot.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
