import type {
  ContractDto,
  SettlementStatus,
  ShowDto,
  TermsDto,
  TicketSaleDto,
} from "@ledgerline/schemas";
import { notFound } from "next/navigation";
import { api, ApiError } from "../../../lib/api";
import { formatShowDate } from "../../../lib/format";
import {
  contractStep,
  inputsLocked,
  salesStep,
  SETTLEMENT_STATUS_LABELS,
  settlementStep,
  termsStep,
  type StepState,
} from "../../../lib/show-steps";
import { LockIcon, StatusBadge } from "../../components";
import { NavLink } from "../../nav-link";
import { PageHeader } from "../../page-header";

// The second sentence of the "inputs are locked" banner: what happens to the money now.
const LOCKED_DETAIL: Partial<Record<SettlementStatus, string>> = {
  approved: "The payout is on its way.",
  paying: "The payout is on its way.",
  paid: "This settlement is final.",
  payment_failed: "The payout failed; it can be retried on the Settlement tab.",
};

// Shared header and tabs for every page of one show. The tabs are the steps of the
// flow, in order, each with its state, so the person sees what is done and what is next.
export default async function ShowLayout({
  params,
  children,
}: {
  params: Promise<{ showId: string }>;
  children: React.ReactNode;
}) {
  const { showId } = await params;
  let show: ShowDto;
  try {
    show = await api.get<ShowDto>(`/shows/${showId}`);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 400)) {
      notFound();
    }
    throw error;
  }
  // The pages under this layout load the same URLs (sales, contracts, terms). Next.js
  // dedupes identical GET fetches within one render, so on those pages these cost
  // no extra API call.
  const [ticketSales, contracts, terms] = await Promise.all([
    api.get<TicketSaleDto[]>(`/shows/${showId}/ticket-sales`),
    api.get<ContractDto[]>(`/shows/${showId}/contracts`),
    api.get<TermsDto>(`/shows/${showId}/terms`),
  ]);
  const status = show.settlementStatus;
  const locked = inputsLocked(status);
  const hasTerms = terms.latest !== null;

  return (
    <>
      <PageHeader
        title={show.name}
        breadcrumb={[{ label: "Shows", href: "/shows" }, { label: formatShowDate(show.showDate) }]}
        badge={status && <StatusBadge status={status} />}
        subtitle={`${show.artist.name} at ${show.venue.name}`}
      />
      <nav className="tabs" aria-label="Show steps">
        {/* The CSV import has no tab: it is an action of the sales step, reached from
            that page, and keeps this tab lit while it is open. */}
        <NavLink href={`/shows/${showId}`} exact alsoActiveOn={`/shows/${showId}/import`}>
          <StepTab
            number={1}
            name="Sales & expenses"
            state={salesStep(ticketSales.length, locked)}
          />
        </NavLink>
        <NavLink href={`/shows/${showId}/contract`}>
          <StepTab
            number={2}
            name="Contract"
            state={contractStep(contracts[0]?.status ?? null, hasTerms, locked)}
          />
        </NavLink>
        <NavLink href={`/shows/${showId}/terms`}>
          <StepTab number={3} name="Deal terms" state={termsStep(hasTerms, locked)} />
        </NavLink>
        <NavLink href={`/shows/${showId}/settlement`}>
          <StepTab number={4} name="Settlement" state={settlementStep(status)} />
        </NavLink>
      </nav>
      {locked && status && (
        <div className="banner banner-locked">
          <LockIcon />
          <span>
            <strong>{SETTLEMENT_STATUS_LABELS[status]}</strong> — the inputs are locked.{" "}
            {LOCKED_DETAIL[status]} Sales, expenses, the contract and the deal terms can be read but
            no longer changed.
          </span>
        </div>
      )}
      {children}
    </>
  );
}

// Symbols for the step tones. Decoration: the label next to it says the same in words.
const STEP_SYMBOLS: Record<Exclude<StepState["tone"], "locked">, string> = {
  done: "✓",
  attention: "!",
  progress: "•",
  todo: "○",
};

// The hidden texts give the link a name that reads as a sentence to a screen reader,
// "Step 1: Sales & expenses, Done", instead of the spans run together.
function StepTab({ number, name, state }: { number: number; name: string; state: StepState }) {
  return (
    <>
      <span className="step-name">
        <span className="step-number" aria-hidden="true">
          {number}
        </span>
        <span className="visually-hidden">Step {number}: </span>
        {name}
        <span className="visually-hidden">, </span>
      </span>
      <span className={`step-state step-${state.tone}`}>
        {state.tone === "locked" ? (
          <LockIcon />
        ) : (
          <span aria-hidden="true">{STEP_SYMBOLS[state.tone]}</span>
        )}
        {state.label}
      </span>
    </>
  );
}
