import { parse } from "csv-parse/sync";
import {
  MAX_CENTS,
  parseDollarsToCents,
  TicketSaleSchema,
  type TicketSale,
} from "@ledgerline/schemas";
import { formatZodIssues, type Issue } from "../../common/zod-issues.js";

// Expected CSV (one row per ticket tier). Money columns are dollars, as a ticketing
// export would write them; they are converted to cents without floats.
//
//   tier,qty_sold,comps,price,tax,fees
//   GA,320,25,35.00,560.00,224.00
//
// price = face value per ticket; tax and fees = tier totals contained in the gross.
export const TICKET_SALES_CSV_COLUMNS = [
  "tier",
  "qty_sold",
  "comps",
  "price",
  "tax",
  "fees",
] as const;

export type TicketSaleRow = Omit<TicketSale, "id">;

export type CsvParseResult = { ok: true; rows: TicketSaleRow[] } | { ok: false; issues: Issue[] };

// Pure function: text in, rows or a list of every problem out. Collecting all issues
// (instead of stopping at the first) lets the user fix the file in one go.
export function parseTicketSalesCsv(text: string): CsvParseResult {
  let records: Record<string, string>[];
  try {
    records = parse(text, { columns: true, skip_empty_lines: true, trim: true, bom: true });
  } catch (error) {
    return {
      ok: false,
      issues: [{ path: "file", message: `Not a readable CSV: ${(error as Error).message}` }],
    };
  }

  if (records.length === 0) {
    return { ok: false, issues: [{ path: "file", message: "The file has no data rows" }] };
  }
  const header = Object.keys(records[0]!);
  const missing = TICKET_SALES_CSV_COLUMNS.filter((column) => !header.includes(column));
  if (missing.length > 0) {
    return {
      ok: false,
      issues: [
        {
          path: "header",
          message: `Missing column(s): ${missing.join(", ")}. Expected: ${TICKET_SALES_CSV_COLUMNS.join(",")}`,
        },
      ],
    };
  }

  const issues: Issue[] = [];
  const rows: TicketSaleRow[] = [];
  records.forEach((record, index) => {
    const rowLabel = `row ${index + 2}`; // +2: rows are 1-based and row 1 is the header
    const qtySold = parseWholeNumber(record["qty_sold"]!);
    const comps = parseWholeNumber(record["comps"]!);
    const priceCents = parseDollarsToCents(record["price"]!);
    const taxCents = parseDollarsToCents(record["tax"]!);
    const feeCents = parseDollarsToCents(record["fees"]!);

    const unreadable = [
      qtySold === null && "qty_sold must be a whole number",
      comps === null && "comps must be a whole number",
      priceCents === null && "price must be a dollar amount like 35.00",
      taxCents === null && "tax must be a dollar amount like 560.00",
      feeCents === null && "fees must be a dollar amount like 224.00",
    ].filter((message): message is string => message !== false);
    if (unreadable.length > 0) {
      issues.push(...unreadable.map((message) => ({ path: rowLabel, message })));
      return;
    }

    // Same schema the engine uses, so a row the engine would reject never gets stored.
    const parsed = TicketSaleSchema.safeParse({
      id: rowLabel,
      tierName: record["tier"],
      qtySold,
      comps,
      priceCents,
      taxCents,
      feeCents,
    });
    if (!parsed.success) {
      issues.push(
        ...formatZodIssues(parsed.error).map((issue) => ({
          path: `${rowLabel}.${issue.path}`,
          message: issue.message,
        })),
      );
      return;
    }
    // The id was only a label for error messages; the database assigns the real one.
    rows.push({
      tierName: parsed.data.tierName,
      qtySold: parsed.data.qtySold,
      comps: parsed.data.comps,
      priceCents: parsed.data.priceCents,
      taxCents: parsed.data.taxCents,
      feeCents: parsed.data.feeCents,
    });
  });

  // Whole-file rules, checked only once every row is readable.
  if (issues.length === 0) {
    const seenTiers = new Set<string>();
    for (const row of rows) {
      if (seenTiers.has(row.tierName)) {
        issues.push({ path: "file", message: `Tier "${row.tierName}" appears more than once` });
      }
      seenTiers.add(row.tierName);
    }
    let grossCents = 0;
    for (const row of rows) {
      grossCents += row.qtySold * row.priceCents;
    }
    if (grossCents > MAX_CENTS) {
      issues.push({ path: "file", message: `Total gross exceeds the ${MAX_CENTS}-cent limit` });
    }
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true, rows };
}

function parseWholeNumber(text: string): number | null {
  return /^\d{1,7}$/.test(text) ? Number(text) : null;
}
