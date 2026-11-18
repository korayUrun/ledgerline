import type { Expense, ExpensePolicy, SettlementLine, SourceRef } from "@ledgerline/schemas";

// Allowed expenses (docs/domain.md §3, rule R3). The three steps always run in
// this order: filter → category caps → total cap. A different order gives a
// different number for the same inputs.
export interface AllowedExpenses {
  allowedCents: number;
  lines: SettlementLine[];
}

function expenseRefs(expenses: readonly Expense[]): SourceRef[] {
  return expenses.map((expense) => ({ type: "expense", id: expense.id }));
}

function sumAmounts(expenses: readonly Expense[]): number {
  let totalCents = 0;
  for (const expense of expenses) {
    totalCents += expense.amountCents;
  }
  return totalCents;
}

export function computeAllowedExpenses(
  expenses: readonly Expense[],
  policy: ExpensePolicy,
): AllowedExpenses {
  const lines: SettlementLine[] = [
    {
      kind: "expenses_submitted",
      label: "Expenses submitted",
      amountCents: sumAmounts(expenses),
      clauseRef: null,
      sourceRefs: expenseRefs(expenses),
    },
  ];

  // Step 1: filter. "pending" expenses stay in; only "disallowed" ones and
  // categories the contract does not list are dropped.
  const keptExpenses: Expense[] = [];
  for (const expense of expenses) {
    if (expense.status === "disallowed") {
      lines.push({
        kind: "expense_disallowed",
        label: `Less: ${expense.category} expense marked disallowed by a reviewer`,
        amountCents: expense.amountCents,
        clauseRef: null,
        sourceRefs: expenseRefs([expense]),
      });
    } else if (!policy.allowedCategories.includes(expense.category)) {
      lines.push({
        kind: "expense_disallowed",
        label: `Less: ${expense.category} is not an allowed category`,
        amountCents: expense.amountCents,
        clauseRef: policy.clauseRef,
        sourceRefs: expenseRefs([expense]),
      });
    } else {
      keptExpenses.push(expense);
    }
  }

  // Step 2: category caps. Each line holds the amount removed, not the cap.
  let afterCategoryCapsCents = sumAmounts(keptExpenses);
  for (const cap of policy.categoryCaps) {
    const inCategory = keptExpenses.filter((expense) => expense.category === cap.category);
    const categoryTotalCents = sumAmounts(inCategory);
    if (categoryTotalCents > cap.capCents) {
      const removedCents = categoryTotalCents - cap.capCents;
      afterCategoryCapsCents -= removedCents;
      lines.push({
        kind: "expense_category_cap",
        label: `Less: ${cap.category} above its cap`,
        amountCents: removedCents,
        clauseRef: policy.clauseRef,
        sourceRefs: expenseRefs(inCategory),
      });
    }
  }

  // Step 3: total cap, on what is left after the category caps.
  let allowedCents = afterCategoryCapsCents;
  if (policy.totalCapCents !== null && allowedCents > policy.totalCapCents) {
    lines.push({
      kind: "expense_total_cap",
      label: "Less: expenses above the total cap",
      amountCents: allowedCents - policy.totalCapCents,
      clauseRef: policy.clauseRef,
      sourceRefs: [],
    });
    allowedCents = policy.totalCapCents;
  }

  lines.push({
    kind: "allowed_expenses",
    label: "Allowed expenses",
    amountCents: allowedCents,
    clauseRef: policy.clauseRef,
    sourceRefs: expenseRefs(keptExpenses),
  });

  return { allowedCents, lines };
}
