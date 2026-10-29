/**
 * Deterministic randomness.
 *
 * `Math.random()` is banned everywhere in `src/core/` and `src/puzzles/`, for the same
 * reason it is banned in the jigsaw engine: the same spec has to produce the same puzzle
 * on every device and in every test run, forever. That property is what makes a shareable
 * game code honest, a daily puzzle possible with no server, and a failing test
 * reproducible.
 *
 * xmur3 to spread a string or number seed, then sfc32 to generate. Both are a handful of
 * lines of public-domain arithmetic, which is the right amount of code to own for this.
 */

/** Spread an arbitrary seed into four 32-bit words. */
function seedWords(seed: string | number): [number, number, number, number] {
  const text = typeof seed === 'number' ? `n${seed}` : seed;
  let h = 1779033703 ^ text.length;
  const next = (): number => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return [next(), next(), next(), next()];
}

export interface Rng {
  /** A float in [0, 1). */
  (): number;
  /** An integer in [0, n). */
  int(n: number): number;
  /** Fisher-Yates, in place, and returns the same array. */
  shuffle<T>(items: T[]): T[];
}

export function makeRng(seed: string | number): Rng {
  let [a, b, c, d] = seedWords(seed);
  const next = (): number => {
    const t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    const sum = (t + d) | 0;
    c = (c + sum) | 0;
    return (sum >>> 0) / 4294967296;
  };
  const rng = next as Rng;
  rng.int = (n: number): number => Math.floor(next() * n);
  rng.shuffle = <T>(items: T[]): T[] => {
    for (let i = items.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      const a0 = items[i]!;
      items[i] = items[j]!;
      items[j] = a0;
    }
    return items;
  };
  return rng;
}
