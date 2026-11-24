import {
  ExpenseCategorySchema,
  ExpenseStatusSchema,
  formatCents,
  type ExpenseDto,
  type TicketSaleDto,
} from "@ledgerline/schemas";
import Link from "next/link";
import type { SearchParams } from "../../../lib/flash";
import { api } from "../../../lib/api";
import { centsToInput, humanize } from "../../../lib/format";
import { createExpense, deleteExpense, updateExpense, uploadReceipt } from "../../actions";
import { ErrorBanner, StatusBadge } from "../../components";

// Option texts for the expense status. The option values stay the API's enum values;
// only what a person reads changes. Keyed by the enum, so a new status fails to compile
// until it has a label.
const EXPENSE_STATUS_LABELS: Record<(typeof ExpenseStatusSchema.options)[number], string> = {
  pending: "Pending (not decided)",
  allowed: "Allowed",
  disallowed: "Disallowed",
};

export default async function ShowDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ showId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { showId } = await params;
  const [ticketSales, expenses] = await Promise.all([
    api.get<TicketSaleDto[]>(`/shows/${showId}/ticket-sales`),
    api.get<ExpenseDto[]>(`/shows/${showId}/expenses`),
  ]);

  return (
    <>
      <ErrorBanner searchParams={await searchParams} />

      <h2>Ticket sales</h2>
      {ticketSales.length === 0 ? (
        <p className="muted">
          No ticket sales yet. <Link href={`/shows/${showId}/import`}>Import a CSV</Link>.
        </p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tier</th>
                <th className="num">Paid</th>
                <th className="num">Comps</th>
                <th className="num">Price</th>
                <th className="num">Tax</th>
                <th className="num">Fees</th>
              </tr>
            </thead>
            <tbody>
              {ticketSales.map((sale) => (
                <tr key={sale.id}>
                  <td>{sale.tierName}</td>
                  <td className="num">{sale.qtySold}</td>
                  <td className="num">{sale.comps}</td>
                  <td className="num">{formatCents(sale.priceCents)}</td>
                  <td className="num">{formatCents(sale.taxCents)}</td>
                  <td className="num">{formatCents(sale.feeCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Expenses</h2>
      <p className="muted">
        Changing an expense means the settlement must be recomputed. Pending expenses count in the
        math but block review until someone allows or disallows them.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>Description</th>
              <th className="num">Amount ($)</th>
              <th>Status</th>
              <th>Receipt</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {expenses.map((expense) => {
              // A table row cannot contain a <form>, so the inputs point to a form
              // elsewhere in the row through the HTML `form` attribute.
              const formId = `expense-${expense.id}`;
              // The column headers do not name an input for a screen reader, so each
              // input gets a name that also says which row it is in.
              const rowName = expense.description;
              return (
                <tr key={expense.id}>
                  <td>{humanize(expense.category)}</td>
                  <td>
                    <input
                      form={formId}
                      name="description"
                      defaultValue={expense.description}
                      aria-label={`Description for ${rowName}`}
                    />
                  </td>
                  <td className="num">
                    <input
                      form={formId}
                      name="amount"
                      defaultValue={centsToInput(expense.amountCents)}
                      size={10}
                      inputMode="decimal"
                      className="amount"
                      aria-label={`Amount for ${rowName}`}
                    />
                  </td>
                  <td>
                    <select
                      form={formId}
                      name="status"
                      defaultValue={expense.status}
                      aria-label={`Status for ${rowName}`}
                    >
                      {ExpenseStatusSchema.options.map((status) => (
                        <option key={status} value={status}>
                          {EXPENSE_STATUS_LABELS[status]}
                        </option>
                      ))}
                    </select>{" "}
                    <StatusBadge status={expense.status} />
                  </td>
                  <td>
                    {expense.hasReceipt && (
                      <a href={`/receipts/${expense.id}`} target="_blank" rel="noreferrer">
                        view
                      </a>
                    )}
                    <form action={uploadReceipt.bind(null, showId, expense.id)} className="row">
                      <input
                        type="file"
                        name="file"
                        accept="application/pdf,image/png,image/jpeg"
                        aria-label={`Receipt for ${rowName}`}
                      />
                      <button type="submit" className="secondary">
                        Upload
                      </button>
                    </form>
                  </td>
                  <td>
                    <div className="row">
                      <form id={formId} action={updateExpense.bind(null, showId, expense.id)}>
                        <button type="submit">Save</button>
                      </form>
                      <form action={deleteExpense.bind(null, showId, expense.id)}>
                        <button type="submit" className="danger">
                          Delete
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              );
            })}
            {expenses.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No expenses yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2>Add an expense</h2>
      <form action={createExpense.bind(null, showId)} className="card form-grid">
        <label>
          Category
          <select name="category">
            {ExpenseCategorySchema.options.map((category) => (
              <option key={category} value={category}>
                {humanize(category)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Description
          <input name="description" required />
        </label>
        <label>
          Amount ($)
          <input name="amount" required placeholder="1250.00" inputMode="decimal" />
        </label>
        <label>
          Status
          <select name="status" defaultValue="pending">
            {ExpenseStatusSchema.options.map((status) => (
              <option key={status} value={status}>
                {EXPENSE_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Add expense</button>
      </form>
    </>
  );
}
