import { describe, expect, it } from 'vitest';
import { makePuzzle, tierName, tierRank } from '../generate.js';
import { GENTLE, STEADY, TRICKY, UNKNOWN, solveGrid, type Grid, type LineCell } from '../solver.js';
import { cluesFor } from '../index.js';

function gridOf(made: { rowClues: number[][]; colClues: number[][] }, rows: number, cols: number): Grid {
  return { rows, cols, rowClues: made.rowClues, colClues: made.colClues };
}

describe('makePuzzle', () => {
  /**
   * Determinism, which every game code and the daily puzzle depend on. If this fails,
   * two children typing the same code get different pictures.
   */
  it('gives the same puzzle for the same seed, every time', () => {
    for (const seed of ['20261030', 'abc', '7']) {
      const a = makePuzzle({ rows: 10, cols: 10, tier: STEADY, seed });
      const b = makePuzzle({ rows: 10, cols: 10, tier: STEADY, seed });
      expect(a.solution).toEqual(b.solution);
      expect(a.rowClues).toEqual(b.rowClues);
    }
  });

  it('gives different puzzles for different seeds', () => {
    const a = makePuzzle({ rows: 10, cols: 10, tier: STEADY, seed: 'one' });
    const b = makePuzzle({ rows: 10, cols: 10, tier: STEADY, seed: 'two' });
    expect(a.solution).not.toEqual(b.solution);
  });

  /**
   * The clues must describe the picture. Obvious, and exactly the kind of thing that
   * silently stops being true when the generator is changed.
   */
  it('publishes clues that match the picture it drew', () => {
    const rows = 12;
    const cols = 12;
    const made = makePuzzle({ rows, cols, tier: STEADY, seed: 'clues' });
    for (let r = 0; r < rows; r++) {
      expect(made.rowClues[r]).toEqual(cluesFor(made.solution.slice(r * cols, (r + 1) * cols)));
    }
    for (let c = 0; c < cols; c++) {
      const line: boolean[] = [];
      for (let r = 0; r < rows; r++) line.push(made.solution[r * cols + c]!);
      expect(made.colClues[c]).toEqual(cluesFor(line));
    }
  });

  /**
   * **The claim the whole generator rests on.** Every puzzle it hands out can be reasoned
   * to the end — no guessing, no "try it and see". And because every deduction the solver
   * makes is forced, solving it completely also proves the answer is the only one, which
   * is why there is no separate uniqueness search to disagree with this.
   */
  it('only ever produces puzzles that can be solved by reasoning', () => {
    for (const [rows, cols, tier] of [
      [8, 8, GENTLE],
      [10, 10, STEADY],
      [12, 12, STEADY],
      [10, 10, TRICKY],
    ] as const) {
      for (const seed of ['a', 'b', 'c']) {
        const made = makePuzzle({ rows, cols, tier, seed });
        const result = solveGrid(
          gridOf(made, rows, cols),
          new Array<LineCell>(rows * cols).fill(UNKNOWN),
          TRICKY,
        );
        expect(result.solved).toBe(true);
        // And what it solves to is the picture that was drawn.
        expect(result.cells.map((c) => c === 1)).toEqual(made.solution);
      }
    }
  });

  /**
   * The two-sided test. A puzzle is only Steady if the steady solver finishes it **and**
   * the gentle one does not — otherwise the generator cheerfully labels easy puzzles hard,
   * because an easy puzzle is solvable by a stronger solver too.
   */
  it('does not hand out an easy puzzle with a hard label', () => {
    let checked = 0;
    for (const seed of ['s1', 's2', 's3', 's4', 's5']) {
      const made = makePuzzle({ rows: 12, cols: 12, tier: STEADY, seed });
      if (made.tierUsed < STEADY) continue; // a fallback, which the app reports honestly
      const grid = gridOf(made, 12, 12);
      const blank = new Array<LineCell>(144).fill(UNKNOWN);
      expect(solveGrid(grid, blank, GENTLE).solved).toBe(false);
      expect(solveGrid(grid, blank, STEADY).solved).toBe(true);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('reports the difficulty it achieved, not the one it was asked for', () => {
    const made = makePuzzle({ rows: 6, cols: 6, tier: TRICKY, seed: 'small' });
    // A six-by-six may well not be hard enough to need probing. Whatever it is, the
    // number reported is the number measured.
    const grid = gridOf(made, 6, 6);
    const blank = new Array<LineCell>(36).fill(UNKNOWN);
    const at = solveGrid(grid, blank, made.tierUsed);
    expect(at.solved).toBe(true);
    if (made.tierUsed > GENTLE) {
      expect(solveGrid(grid, blank, made.tierUsed - 1).solved).toBe(false);
    }
  });

  /** An empty or nearly full grid is a correct puzzle and a miserable one. */
  it('draws a picture worth looking at', () => {
    for (const seed of ['p1', 'p2', 'p3']) {
      const made = makePuzzle({ rows: 10, cols: 10, tier: STEADY, seed });
      const filled = made.solution.filter(Boolean).length;
      expect(filled).toBeGreaterThan(19);
      expect(filled).toBeLessThan(76);
    }
  });

  /**
   * The acceptance rate, measured rather than believed.
   *
   * The generator is a search, so "it usually finds one quickly" is a claim about the
   * world and not about the code. This records the real number so that if a change makes
   * generation twenty times slower, that shows up as a failure rather than as a tablet
   * that seems to hang.
   */
  it('finds a puzzle without an unreasonable search', () => {
    const attempts: number[] = [];
    for (const seed of ['r1', 'r2', 'r3', 'r4', 'r5', 'r6']) {
      attempts.push(makePuzzle({ rows: 10, cols: 10, tier: STEADY, seed }).attempts);
    }
    const worst = Math.max(...attempts);
    const mean = attempts.reduce((a, b) => a + b, 0) / attempts.length;
    expect(worst).toBeLessThan(200);
    expect(mean).toBeLessThan(60);
  });

  /**
   * A five-by-five has very little room for the solver to work in, and the app offers it
   * as the first size. It has to produce *something* rather than throwing a blank screen
   * at a five-year-old.
   */
  it('still produces something at the smallest size offered', () => {
    for (const seed of ['t1', 't2', 't3']) {
      const made = makePuzzle({ rows: 5, cols: 5, tier: GENTLE, seed });
      const result = solveGrid(gridOf(made, 5, 5), new Array<LineCell>(25).fill(UNKNOWN), TRICKY);
      expect(result.solved).toBe(true);
    }
  });

  it('refuses a board too small to hold a puzzle rather than returning nonsense', () => {
    expect(() => makePuzzle({ rows: 1, cols: 1, tier: TRICKY, seed: 'x' })).toThrow();
  });
});

describe('tier naming', () => {
  it('round-trips between id and rank', () => {
    expect(tierRank('gentle')).toBe(GENTLE);
    expect(tierRank('steady')).toBe(STEADY);
    expect(tierRank('tricky')).toBe(TRICKY);
    expect(tierName(GENTLE)).toBe('Gentle');
    expect(tierName(TRICKY)).toBe('Tricky');
  });

  it('falls back rather than throwing on something it does not know', () => {
    expect(tierRank('nonsense')).toBe(STEADY);
  });
});
