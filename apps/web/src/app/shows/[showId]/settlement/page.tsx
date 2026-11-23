import {
  formatCents,
  type AgentRunDto,
  type AuditEntryDto,
  type ExpenseFlagDto,
  type PayoutDto,
  type SettlementInput,
  type SettlementViewDto,
  type ShowDto,
  type SourceRef,
} from "@ledgerline/schemas";
import Link from "next/link";
import { api } from "../../../../lib/api";
import type { SearchParams } from "../../../../lib/flash";
import { formatDateTime, humanize } from "../../../../lib/format";
import {
  approveSettlement,
  computeSettlement,
  connectStripeAccount,
  resolveFlag,
  retryPayment,
  submitForReview,
} from "../../../actions";
import { ErrorBanner, StatusBadge } from "../../../components";
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
  const locked =
    settlement !== null &&
    ["approved", "paying", "paid", "payment_failed"].includes(settlement.status);

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
      {settlement?.status === "in_review" && (
        <div className="banner banner-info">
          In review. Approving starts the payout to the artist; after that the inputs are locked.
        </div>
      )}
      {settlement?.status === "paying" && (
        <div className="banner banner-info">
          Approved. The payout is on its way; the inputs are locked.
        </div>
      )}
      {settlement?.status === "paid" && (
        <div className="banner banner-info">Paid. This settlement is final.</div>
      )}
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

      <div className="row" style={{ margin: "16px 0" }}>
        {!locked && (
          <>
            <form action={computeSettlement.bind(null, showId)}>
              <button type="submit">
                {settlement && settlement.status !== "draft" ? "Recompute" : "Compute settlement"}
              </button>
            </form>
            <form action={submitForReview.bind(null, showId)}>
              <button type="submit" className="secondary" disabled={!canSubmit}>
                Submit for review
              </button>
            </form>
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
          <form action={approveSettlement.bind(null, showId)}>
            <button type="submit" disabled={needsAccount}>
              Approve and pay{" "}
              {settlement.payoutCents === null ? "" : formatCents(settlement.payoutCents)}
            </button>
          </form>
        )}
        {settlement?.status === "payment_failed" && (
          <form action={retryPayment.bind(null, showId)}>
            <button type="submit">Retry payment</button>
          </form>
        )}
      </div>

      {artistAccount !== null && locked && (
        <p className="muted">
          Paid to {show.artist.name}&apos;s Stripe account <code>{artistAccount}</code> (test mode).
        </p>
      )}
      {view.payouts.length > 0 && <PayoutsTable payouts={view.payouts} />}

      {!settlement || settlement.status === "draft" ? (
        <p className="muted">
          Not computed yet. Make sure the show has ticket sales and deal terms, then compute.
        </p>
      ) : (
        <>
          <div className="card summary">
            <div>
              <span className="muted">Artist payout</span>
              <strong>
                {settlement.payoutCents === null ? "—" : formatCents(settlement.payoutCents)}
              </strong>
            </div>
            <div>
              <span className="muted">Status</span>
              <span>
                <StatusBadge status={settlement.status} />
              </span>
            </div>
            <div>
              <span className="muted">Version · terms</span>
              <span>
                v{settlement.version} · terms v{settlement.termsVersion}
              </span>
            </div>
            <div>
              <span className="muted">Computed</span>
              <span>{settlement.computedAt ? formatDateTime(settlement.computedAt) : "—"}</span>
            </div>
            <div>
              <span className="muted">Engine · inputs hash</span>
              <span>
                {settlement.engineVersion} ·{" "}
                <code title={settlement.inputsHash ?? ""}>
                  {settlement.inputsHash?.slice(0, 12)}
                </code>
              </span>
            </div>
          </div>

          <h2>Worksheet</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Step</th>
                  <th className="num">Amount</th>
                  <th>Clause</th>
                  <th>Computed from</th>
                </tr>
              </thead>
              <tbody>
                {settlement.lines.map((line, index) => (
                  <tr key={index} className={lineClass(line.kind)}>
                    <td>{line.label}</td>
                    <td className="num">{formatCents(line.amountCents)}</td>
                    <td>{line.clauseRef ?? <span className="muted">data</span>}</td>
                    <td>
                      {line.sourceRefs.length === 0 && <span className="muted">lines above</span>}
                      {line.sourceRefs.map((ref) => (
                        <div key={`${ref.type}-${ref.id}`}>
                          <a href={`#src-${ref.id}`}>
                            {describeSource(ref, settlement.inputSnapshot)}
                          </a>
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2>Assistant</h2>
          {canAsk ? (
            <AssistantPanel settlementId={settlement.id} />
          ) : (
            <p className="muted">Recompute the settlement to use the assistant.</p>
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

function lineClass(kind: string): string {
  if (kind === "total_payout") return "total";
  if (kind === "nbor" || kind === "allowed_expenses" || kind === "deal_payout") return "subtotal";
  return "";
}

function describeSource(ref: SourceRef, snapshot: SettlementInput | null): string {
  if (ref.type === "ticket_sale") {
    const sale = snapshot?.ticketSales.find((row) => row.id === ref.id);
    return sale
      ? `${sale.tierName}: ${sale.qtySold} × ${formatCents(sale.priceCents)}`
      : `ticket sale ${ref.id}`;
  }
  const expense = snapshot?.expenses.find((row) => row.id === ref.id);
  return expense
    ? `${humanize(expense.category)} ${formatCents(expense.amountCents)} (${expense.status})`
    : `expense ${ref.id}`;
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
    parts.push(`${before?.status ?? "—"} → ${after?.status ?? "—"}`);
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

// Every attempt to send the money, newest first. The idempotency key is shown so a
// person can find the same attempt in the Stripe dashboard.
function PayoutsTable({ payouts }: { payouts: PayoutDto[] }) {
  return (
    <>
      <h2>Payout</h2>
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
    </>
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
      <div className="table-wrap" style={{ marginTop: 12 }}>
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
          </tbody>
        </table>
      </div>
    </>
  );
}
