import { formatCents, type Expense, type TicketSale } from "@ledgerline/schemas";
import type { AuditExpense } from "./audit-context.js";

// How the tools show input rows to the model. Money is always dollar text: the code
// keeps the cents, the model only reads and quotes. Shared, so list_ticket_sales and
// explain_line show the same row the same way.

export function ticketSaleAsText(sale: TicketSale) {
  return {
    id: sale.id,
    tierName: sale.tierName,
    qtySold: sale.qtySold,
    comps: sale.comps,
    price: formatCents(sale.priceCents),
    tax: formatCents(sale.taxCents),
    fees: formatCents(sale.feeCents),
  };
}

// `description` is null when the expense row no longer exists (it was deleted after
// the compute). The amount and status always come from the row the engine saw.
export function expenseAsText(expense: Expense, details: AuditExpense | undefined) {
  return {
    id: expense.id,
    category: expense.category,
    description: details?.description ?? null,
    amount: formatCents(expense.amountCents),
    status: expense.status,
    hasReceipt: details?.hasReceipt ?? false,
  };
}
