import { describe, expect, it } from 'vitest';
import { SHAPES, makePuzzle, shapeFor, tierName, tierRank } from '../generate.js';
import { EMPTY, GENTLE, STEADY, TRICKY, countSolutions, solveGrid } from '../solver.js';

const TIERS = [GENTLE, STEADY, TRICKY];

function make(size: number, tier: number, seed: string) {
  return makePuzzle({ ...shapeFor(size), tier, seed });
}

describe('making a board', () => {
  it('gives the same board for the same spec, every time', () => {
    const a = make(6, STEADY, 'abcd');
    const b = make(6, STEADY, 'abcd');
    expect(a.start).toEqual(b.start);
    expect(a.solution).toEqual(b.solution);
    expect(a.tierUsed).toBe(b.tierUsed);
  });

  it('gives a different board for a different seed', () => {
    expect(make(6, STEADY, 'abcd').start).not.toEqual(make(6, STEADY, 'efgh').start);
  });

  it('starts from the answer, so every number shown is true', () => {
    for (const shape of SHAPES) {
      const made = make(shape.size, STEADY, 'truth');
      for (let i = 0; i < made.start.length; i++) {
        if (made.start[i] !== EMPTY) expect(made.start[i]).toBe(made.solution[i]);
      }
      expect(made.solution.every((v) => v >= 1 && v <= shape.size)).toBe(true);
    }
  });

  it('leaves enough to do', () => {
    for (const shape of SHAPES) {
      for (const tier of TIERS) {
        const made = make(shape.size, tier, `room-${tier}`);
        const holes = made.start.filter((v) => v === EMPTY).length;
        // A board with four squares to fill in is not a puzzle, whatever its rating.
        expect(holes).toBeGreaterThan(made.start.length * 0.4);
      }
    }
  });
});

/**
 * **The claim that would be easiest to get wrong and never notice.** A board with two
 * answers is consistent, looks correct, and punishes a child for reasoning properly.
 *
 * The generator never checks uniqueness — it relies on the argument that a board the
 * solver finishes by forced deductions alone can only have one answer. This test is that
 * argument being checked by exhaustive search instead of believed.
 */
describe('one answer, and only one', () => {
  it('has exactly one answer at every size and difficulty', () => {
    for (const shape of SHAPES) {
      for (const tier of TIERS) {
        for (const seed of ['u1', 'u2', 'u3']) {
          const made = make(shape.size, tier, seed);
          expect(countSolutions(shape, made.start, 3)).toBe(1);
        }
      }
    }
  });
});

/**
 * **The two-sided test.** A puzzle is Steady only if the Steady solver finishes it *and*
 * the Gentle solver cannot. Testing only the first half is how a generator ships easy
 * puzzles labelled hard — an easy puzzle is also solvable by a stronger solver, so the
 * one-sided test passes for every puzzle it ever makes.
 */
describe('difficulty that means something', () => {
  it('is only rated at a tier the tier below genuinely fails', () => {
    for (const shape of SHAPES) {
      for (const tier of [STEADY, TRICKY]) {
        for (const seed of ['t1', 't2']) {
          const made = make(shape.size, tier, seed);
          const atTier = solveGrid(shape, made.start, made.tierUsed);
          expect(atTier.solved).toBe(true);
          expect(atTier.tierUsed).toBe(made.tierUsed);
          if (made.tierUsed > GENTLE) {
            // Whatever it was *asked* for, what it claims must hold.
            expect(solveGrid(shape, made.start, made.tierUsed - 1).solved).toBe(false);
          }
        }
      }
    }
  });

  /**
   * It reports what it achieved, never what it was asked for. A 4x4 has too little room
   * for a contradiction proof to be necessary, so asking for Tricky there must come back
   * honest rather than flattering.
   */
  it('reports the difficulty it reached, not the one requested', () => {
    const made = make(4, TRICKY, 'honest');
    expect(made.tierUsed).toBeLessThanOrEqual(TRICKY);
    expect(solveGrid(shapeFor(4), made.start, made.tierUsed).solved).toBe(true);
    if (made.tierUsed < TRICKY) {
      expect(solveGrid(shapeFor(4), made.start, made.tierUsed + 1).tierUsed).toBe(made.tierUsed);
    }
  });
});

describe('tier names', () => {
  it('maps the ids the app stores to the ranks the solver uses', () => {
    expect(tierRank('gentle')).toBe(GENTLE);
    expect(tierRank('steady')).toBe(STEADY);
    expect(tierRank('tricky')).toBe(TRICKY);
    // An unknown id comes from a hand-typed code; the gentlest board is the safe guess.
    expect(tierRank('impossible')).toBe(GENTLE);
    expect(tierName(GENTLE)).toBe('Gentle');
    expect(tierName(TRICKY)).toBe('Tricky');
  });
});

/**
 * What generation costs, and how often it gets what it was asked for.
 *
 * Measured rather than assumed, because the first puzzle's equivalent numbers were a
 * surprise: a tricky 20x20 takes 775ms there, which on a tablet looks like the app has
 * died. The thresholds here are deliberately loose — they are a tripwire for an order of
 * magnitude, not a benchmark — and the printed table is the useful output.
 */
describe('what it costs', () => {
  it('measures generation time and how often the tier is reached', () => {
    const lines: string[] = [];
    let worst = 0;

    for (const shape of SHAPES) {
      for (const tier of TIERS) {
        const started = Date.now();
        let reached = 0;
        const runs = 5;
        for (let i = 0; i < runs; i++) {
          if (make(shape.size, tier, `cost-${i}`).tierUsed === tier) reached++;
        }
        const each = (Date.now() - started) / runs;
        worst = Math.max(worst, each);
        lines.push(
          `${shape.size}x${shape.size} ${tierName(tier).padEnd(6)} ` +
            `${each.toFixed(0).padStart(5)}ms  reached ${reached}/${runs}`,
        );
      }
    }
    // eslint-disable-next-line no-console
    console.log(`\nNumber Place generation\n${lines.join('\n')}\n`);

    // The main thread is blocked for this long. Above a couple of seconds the app looks
    // broken on a tablet, and the answer would be a worker rather than a faster search.
    expect(worst).toBeLessThan(4000);
  });
});
