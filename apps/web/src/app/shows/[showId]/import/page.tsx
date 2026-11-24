import type { SearchParams } from "../../../../lib/flash";
import { importTicketSales } from "../../../actions";
import { ErrorBanner, NextStep } from "../../../components";
import { SubmitButton } from "../../../submit-button";

export default async function ImportPage({
  params,
  searchParams,
}: {
  params: Promise<{ showId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { showId } = await params;
  return (
    <>
      <ErrorBanner searchParams={await searchParams} />
      <h2>Import ticket sales</h2>
      <p>
        Upload the ticketing system&apos;s CSV export, one row per ticket tier. The import{" "}
        <strong>replaces</strong> this show&apos;s current ticket sales, which means the settlement
        must be recomputed.
      </p>
      <pre>{`tier,qty_sold,comps,price,tax,fees
GA,320,25,35.00,560.00,224.00
VIP,70,10,80.00,280.00,112.00`}</pre>
      <ul className="muted">
        <li>
          <code>qty_sold</code> counts paid tickets only; <code>comps</code> are free tickets.
        </li>
        <li>
          <code>price</code> is the face value of one ticket. <code>tax</code> and <code>fees</code>{" "}
          are totals for the tier, already contained in its gross.
        </li>
        <li>
          Dollar amounts may have up to two decimals. Every problem in the file is listed at once.
        </li>
      </ul>
      <form action={importTicketSales.bind(null, showId)} className="card row">
        <label>
          Ticket sales CSV
          <input type="file" name="file" accept=".csv,text/csv" required />
        </label>
        <SubmitButton pendingLabel="Importing…">Import</SubmitButton>
      </form>

      <NextStep href={`/shows/${showId}`}>Check the sales and expenses</NextStep>
    </>
  );
}
