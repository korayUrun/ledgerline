import { formatCents, type Money } from "@ledgerline/schemas";
import type { ZodType } from "zod";

// Checks a /v1 response against its published schema before it is sent. A mismatch
// is our bug, not the client's, so it is a plain Error (500, logged) rather than a
// ZodError, which ApiExceptionFilter would turn into a 422 about stored data.
export function checkV1Response<T>(schema: ZodType<T>, value: T): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(`/v1 response does not match its schema: ${result.error.message}`);
  }
  return result.data;
}

export function toMoney(cents: number): Money {
  return { cents, formatted: formatCents(cents) };
}
