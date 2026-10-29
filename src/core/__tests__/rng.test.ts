import { describe, expect, it } from 'vitest';
import { makeRng } from '../rng.js';
import { dailySeed, decodeGameId, encodeGameId } from '../gameId.js';

describe('makeRng', () => {
  /**
   * The property the whole project rests on: the same spec has to produce the same puzzle
   * on every device and in every test run, forever. If this test is ever weakened, game
   * codes stop meaning anything.
   */
  it('is deterministic for a given seed', () => {
    const a = makeRng('heart');
    const b = makeRng('heart');
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it('differs between seeds', () => {
    const a = makeRng('heart');
    const b = makeRng('house');
    const first = [a(), a(), a()];
    const second = [b(), b(), b()];
    expect(first).not.toEqual(second);
  });

  it('stays inside [0, 1)', () => {
    const rng = makeRng(42);
    for (let i = 0; i < 5000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('gives integers below n, and reaches both ends', () => {
    const rng = makeRng('ints');
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = rng.int(5);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(5);
      seen.add(v);
    }
    expect(seen.size).toBe(5);
  });

  it('shuffles deterministically and keeps every element', () => {
    const a = makeRng('shuffle').shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
    const b = makeRng('shuffle').shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(a).toEqual(b);
    expect([...a].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe('game codes', () => {
  it('round-trips', () => {
    const code = encodeGameId('picture-logic', ['heart']);
    expect(decodeGameId(code)).toEqual({ puzzleId: 'picture-logic', parts: ['heart'] });
  });

  /**
   * The point of the checksum. Without it a mistyped code quietly opens a *different*
   * puzzle, and two children comparing times are comparing nothing.
   */
  it('refuses a mistyped code rather than opening a different puzzle', () => {
    const code = encodeGameId('picture-logic', ['heart']);
    const typo = `${code.slice(0, -2)}${code.slice(-1)}x`;
    expect(decodeGameId(typo)).toBeNull();
  });

  /** A plain sum would not catch this, and it is the commonest copying mistake. */
  it('catches two characters swapped round', () => {
    const code = encodeGameId('picture-logic', ['abcd']);
    const chars = [...code];
    const i = code.indexOf('abcd');
    [chars[i], chars[i + 1]] = [chars[i + 1]!, chars[i]!];
    expect(decodeGameId(chars.join(''))).toBeNull();
  });

  it('shrugs at rubbish', () => {
    expect(decodeGameId('')).toBeNull();
    expect(decodeGameId('nonsense')).toBeNull();
    expect(decodeGameId('.')).toBeNull();
  });

  it('ignores case and surrounding space, because people paste', () => {
    const code = encodeGameId('picture-logic', ['heart']);
    expect(decodeGameId(`  ${code.toUpperCase()}  `)).not.toBeNull();
  });
});

describe('dailySeed', () => {
  /**
   * Local date, not UTC. "Today's puzzle" means the day the player is having, and a child
   * in Melbourne being handed yesterday's puzzle until mid-morning is a bug report.
   */
  it('is the local calendar date', () => {
    const when = new Date(2026, 9, 29, 7, 30);
    expect(dailySeed(when)).toBe('20261029');
  });

  it('pads single digits so it sorts and compares', () => {
    expect(dailySeed(new Date(2026, 0, 5))).toBe('20260105');
  });
});
