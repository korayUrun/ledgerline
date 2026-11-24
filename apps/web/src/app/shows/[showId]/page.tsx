import {
  ExpenseCategorySchema,
  ExpenseStatusSchema,
  formatCents,
  type ExpenseDto,
  type ShowDto,
  type TicketSaleDto,
} from "@ledgerline/schemas";
import Link from "next/link";
import type { SearchParams } from "../../../lib/flash";
import { api } from "../../../lib/api";
import { centsToInput, humanize } from "../../../lib/format";
import { inputsLocked } from "../../../lib/show-steps";
import { createExpense, deleteExpense, updateExpense, uploadReceipt } from "../../actions";
import { ErrorBanner, LockedNote, NextStep, StatusBadge } from "../../components";
import { SubmitButton } from "../../submit-button";

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
  // The show is the same fetch as the layout's (deduped within the render): it
  // carries the settlement status that decides whether the inputs are locked.
  const [show, ticketSales, expenses] = await Promise.all([
    api.get<ShowDto>(`/shows/${showId}`),
    api.get<TicketSaleDto[]>(`/shows/${showId}/ticket-sales`),
    api.get<ExpenseDto[]>(`/shows/${showId}/expenses`),
  ]);
  const locked = inputsLocked(show.settlementStatus);

  return (
    <>
      <ErrorBanner searchParams={await searchParams} />

      <div className="section-head">
        <h2>Ticket sales</h2>
        {/* The import replaces the sales: the main button while there are none, a quiet
            one once there are. */}
        {!locked && (
          <Link
            href={`/shows/${showId}/import`}
            className={ticketSales.length === 0 ? "button-link" : "button-link secondary"}
          >
            Import sales CSV
          </Link>
        )}
      </div>
      {ticketSales.length === 0 ? (
        <p className="muted">No ticket sales yet.</p>
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
      {locked ? (
        <LockedExpenses expenses={expenses} />
      ) : (
        <EditableExpenses showId={showId} expenses={expenses} />
      )}

      {locked ? (
        <NextStep href={`/shows/${showId}/settlement`}>See the settlement</NextStep>
      ) : (
        <NextStep href={`/shows/${showId}/contract`}>Upload the contract</NextStep>
      )}
    </>
  );
}

// Once the settlement is approved: the expenses as text, the way the payout used them.
function LockedExpenses({ expenses }: { expenses: ExpenseDto[] }) {
  return (
    <>
      <p className="muted">These are the expenses the approved settlement was computed from.</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>Description</th>
              <th className="num">Amount</th>
              <th>Status</th>
              <th>Receipt</th>
            </tr>
          </thead>
          <tbody>
            {expenses.map((expense) => (
              <tr key={expense.id}>
                <td>{humanize(expense.category)}</td>
                <td>{expense.description}</td>
                <td className="num">{formatCents(expense.amountCents)}</td>
                <td>
                  <StatusBadge status={expense.status} />
                </td>
                <td>
                  {expense.hasReceipt ? (
                    <a href={`/receipts/${expense.id}`} target="_blank" rel="noreferrer">
                      View receipt
                    </a>
                  ) : (
                    <span className="muted">None</span>
                  )}
                </td>
              </tr>
            ))}
            {expenses.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No expenses.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <LockedNote>Expenses can no longer be added, changed or removed.</LockedNote>
    </>
  );
}

// Before approval: every expense is a row of inputs, plus the form to add one.
function EditableExpenses({ showId, expenses }: { showId: string; expenses: ExpenseDto[] }) {
  return (
    <>
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
                        <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
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
        <SubmitButton pendingLabel="Adding…">Add expense</SubmitButton>
      </form>
    </>
  );
}
