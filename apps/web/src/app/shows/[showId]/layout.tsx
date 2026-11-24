import type { ContractDto, ShowDto, TermsDto, TicketSaleDto } from "@ledgerline/schemas";
import { notFound } from "next/navigation";
import { api, ApiError } from "../../../lib/api";
import { formatShowDate } from "../../../lib/format";
import {
  contractStep,
  inputsLocked,
  salesStep,
  settlementStep,
  termsStep,
  type StepState,
} from "../../../lib/show-steps";
import { StatusBadge } from "../../components";
import { PageHeader } from "../../page-header";
import { ShowStepper } from "./stepper";

// Shared header and stepper for every page of one show. The stepper shows the steps of
// the flow in order, each with its state, so the person sees what is done and what is
// next. Each page then opens with its own "What to do now" card (guidance-card.tsx),
// which also says when the inputs are locked: only the page knows its own data.
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
  // In step order, like SHOW_STEPS.
  const states: StepState[] = [
    salesStep(ticketSales.length, locked),
    contractStep(contracts[0]?.status ?? null, hasTerms, locked),
    termsStep(hasTerms, locked),
    settlementStep(status),
  ];

  return (
    <>
      <PageHeader
        title={show.name}
        breadcrumb={[{ label: "Shows", href: "/shows" }, { label: formatShowDate(show.showDate) }]}
        badge={status && <StatusBadge status={status} />}
        subtitle={`${show.artist.name} at ${show.venue.name}`}
      />
      <ShowStepper showId={showId} states={states} />
      {children}
    </>
  );
}
