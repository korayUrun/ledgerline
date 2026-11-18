// A seeded random number generator, so the same seed always produces the same
// contract. Math.random() cannot be seeded, which would make the dataset change
// on every run and the "is the committed dataset current?" test impossible.
//
// mulberry32: a tiny, well-known 32-bit generator. Plenty for test data; never
// use it for anything security-related.
export type Rng = {
  next: () => number; // [0, 1)
  int: (min: number, max: number) => number; // inclusive on both ends
  pick: <T>(items: readonly T[]) => T;
  chance: (probability: number) => boolean;
  shuffle: <T>(items: readonly T[]) => T[];
  sample: <T>(items: readonly T[], count: number) => T[];
};

export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function int(min: number, max: number): number {
    return min + Math.floor(next() * (max - min + 1));
  }

  function pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error("pick() from an empty list");
    }
    return items[int(0, items.length - 1)]!;
  }

  // Fisher–Yates on a copy, so the caller's array is never changed.
  function shuffle<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let index = copy.length - 1; index > 0; index--) {
      const other = int(0, index);
      [copy[index], copy[other]] = [copy[other]!, copy[index]!];
    }
    return copy;
  }

  return {
    next,
    int,
    pick,
    chance: (probability) => next() < probability,
    shuffle,
    sample: (items, count) => shuffle(items).slice(0, count),
  };
}
