// Sum columns are BigInt in Postgres (see schema.prisma), and Prisma returns them as
// JavaScript bigint. JSON.stringify cannot serialize a bigint, and the engine and UI
// work with number, so we convert at the edge. The check makes a value too large
// for an exact number fail loudly instead of being rounded silently.
export function bigintToSafeNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError(`${value} cents is outside the safe integer range`);
  }
  return Number(value);
}
