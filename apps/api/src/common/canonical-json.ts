// JSON.stringify keeps object keys in insertion order, so { a, b } and { b, a }
// give different strings and therefore different hashes, although the data is the
// same. Canonical JSON sorts every object's keys first. Array order is kept,
// because in an array the order is part of the data.
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}
