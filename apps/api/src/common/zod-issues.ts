import type { ZodError } from "zod";

export type Issue = { path: string; message: string };

// ["expenses", 2, "amountCents"] → "expenses.2.amountCents", so a client can show
// the message next to the right field.
export function formatZodIssues(error: ZodError): Issue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}
