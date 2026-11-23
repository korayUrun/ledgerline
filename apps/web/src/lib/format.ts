import { formatBps, formatCents } from "@ledgerline/schemas";

// Values for <input> fields: "2800.00" rather than "$2,800.00", so that what the
// form shows is exactly what parseDollarsToCents reads back.
export function centsToInput(cents: number | null | undefined): string {
  return cents === null || cents === undefined ? "" : formatCents(cents).replace(/[$,]/g, "");
}

export function bpsToInput(bps: number | null | undefined): string {
  return bps === null || bps === undefined ? "" : formatBps(bps).replace("%", "");
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

export function humanize(value: string): string {
  return value.replaceAll("_", " ");
}

// Rounded half up to $0.0001 (100,000 nano-dollars), with integer remainders
// like formatCents. The API has the same helper; web cannot import api code.
export function formatNanoUsd(nano: number): string {
  const remainder = nano % 100_000;
  const units = (nano - remainder) / 100_000 + (remainder >= 50_000 ? 1 : 0);
  const fraction = units % 10_000;
  return `$${(units - fraction) / 10_000}.${String(fraction).padStart(4, "0")}`;
}
