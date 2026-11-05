/**
 * Making a Number Place puzzle, by solving it.
 *
 * The first puzzle's lesson transfers exactly, from the other end. A nonogram cannot be
 * made by drawing a random bitmap; a number puzzle cannot be made by taking a full grid
 * and rubbing cells out at random. Do that and most of what you get has **more than one
 * answer** — and it looks completely fine, because the numbers left behind are perfectly
 * consistent numbers for more than one grid. A child who reasons correctly then reaches a
 * square where both answers are defensible, and the app tells them they are wrong.
 *
 * So the shape is the same as Picture Logic's: rub a square out, hand the board to the
 * solver, and **put the square back if the solver can no longer finish**. Every deduction
 * the solver makes is forced, so a board it finishes by reasoning alone has exactly one
 * answer. Uniqueness is not checked, because it cannot fail — and `countSolutions` exists
 * in the solver purely so the tests can verify that claim instead of believing it.
 *
 * ## What is not done, and why it is not missing
 *
 * No symmetry. Printed Sudoku almost always arranges its givens with half-turn symmetry,
 * which is handsome and costs difficulty: a symmetric pattern is a constraint on where
 * holes may go, so the search finds fewer hard puzzles and more easy ones. For a classroom
 * the difficulty is the product and the symmetry is decoration, so the decoration loses.
 */

import { makeRng, type Rng } from '../../core/rng.js';
import {
  EMPTY,
  GENTLE,
  STEADY,
  TRICKY,
  candidates,
  solveGrid,
  type Board,
} from './solver.js';

export interface MakeOptions extends Board {
  /** 1 gentle, 2 steady, 3 tricky. */
  readonly tier: number;
  readonly seed: string;
}

export interface MadePuzzle {
  /** The complete answer, row-major. */
  readonly solution: number[];
  /** The board as the player first sees it: `EMPTY` for a square to fill in. */
  readonly start: number[];
  /** The tier the solver actually needed, which is what the player is told. */
  readonly tierUsed: number;
  /** How many candidates were tried. Reported by the tests, not by the app. */
  readonly attempts: number;
}

/**
 * A complete, legal grid, built by filling the most constrained square first.
 *
 * Most-constrained-first rather than left-to-right: it reaches a full grid with almost no
 * backtracking, where the naive order spends its time undoing itself on a 9x9.
 */
function completeGrid(board: Board, rng: Rng): number[] | null {
  const size = board.size;
  const cells = new Array<number>(size * size).fill(EMPTY);

  const fill = (): boolean => {
    const cand = candidates(board, cells);
    let best = -1;
    let bestCount = Infinity;
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] !== EMPTY) continue;
      let n = 0;
      for (let m = cand[i]!; m; m >>= 1) if (m & 1) n++;
      if (n === 0) return false;
      if (n < bestCount) {
        bestCount = n;
        best = i;
      }
    }
    if (best === -1) return true;

    const options: number[] = [];
    for (let v = 1; v <= size; v++) if (cand[best]! & (1 << (v - 1))) options.push(v);
    rng.shuffle(options);
    for (const value of options) {
      cells[best] = value;
      if (fill()) return true;
      cells[best] = EMPTY;
    }
    return false;
  };

  return fill() ? cells : null;
}

/**
 * Rub squares out for as long as the solver can still finish, in one pass.
 *
 * One pass in a shuffled order, not a search for the smallest possible number of givens.
 * Minimal-givens search is exponential and buys nothing a player can feel: what they feel
 * is which deductions the puzzle demands, and that is what the tier test measures.
 */
function dig(board: Board, solution: readonly number[], tier: number, rng: Rng): number[] {
  const cells = [...solution];
  const order = rng.shuffle([...Array(cells.length).keys()]);
  for (const i of order) {
    const kept = cells[i]!;
    cells[i] = EMPTY;
    if (!solveGrid(board, cells, tier).solved) cells[i] = kept;
  }
  return cells;
}

/**
 * Candidates to try before settling for what was found.
 *
 * Lower than Picture Logic's 400 because each attempt costs far more: one attempt here is
 * a complete grid plus one solve per square. The acceptance-rate and timing tests measure
 * what that actually costs rather than leaving it as a guess.
 */
const BUDGET = 12;

/**
 * Make a puzzle at a tier, or the closest one the search could reach.
 *
 * The **two-sided test** is the point, exactly as in the first puzzle: a board counts as
 * Steady only if the Steady solver finishes it *and* the Gentle solver does not. Without
 * the second half, every puzzle is labelled with the difficulty that was asked for, because
 * an easy puzzle is also solvable by a stronger solver. That is the failure that cannot be
 * seen by playing one puzzle, which is why it is tested rather than watched for.
 *
 * Deterministic: the same options give the same puzzle, forever, which is what makes a
 * shareable code and a dateless daily puzzle mean anything.
 */
export function makePuzzle(options: MakeOptions): MadePuzzle {
  const { size, boxRows, boxCols, tier, seed } = options;
  const board: Board = { size, boxRows, boxCols };
  const rng = makeRng(`${seed}:${size}:${boxRows}x${boxCols}:${tier}`);
  const below = tier - 1;

  // Kept in case nothing hits the requested tier exactly: a solvable puzzle at the wrong
  // difficulty beats no puzzle at all, and the app tells the player which it got.
  let fallback: MadePuzzle | null = null;

  for (let attempt = 1; attempt <= BUDGET; attempt++) {
    const solution = completeGrid(board, rng);
    if (!solution) continue;

    const start = dig(board, solution, tier, rng);
    const atTier = solveGrid(board, start, tier);
    // `dig` only ever removes squares the solver can still cope with, so this holds by
    // construction. Asserted rather than assumed, because "holds by construction" is the
    // phrase that precedes most of the bugs in this project's history.
    if (!atTier.solved) continue;

    const tooEasy = below >= GENTLE ? solveGrid(board, start, below).solved : false;

    const made: MadePuzzle = {
      solution,
      start,
      tierUsed: atTier.tierUsed,
      attempts: attempt,
    };
    if (!tooEasy) return made;
    // Keep the one with the most squares to fill in: of two puzzles that both came out
    // easier than asked, the emptier one is the better consolation prize.
    if (!fallback || holes(start) > holes(fallback.start)) fallback = made;
  }

  if (fallback) return fallback;

  /**
   * Nothing in the budget worked.
   *
   * Rather than throw — which would hand the player a blank screen — make one at the
   * easiest tier with no difficulty requirement at all. If even that fails, the board shape
   * is not a puzzle, and throwing is right: silently returning something unsolvable is
   * worse than an error somebody can report.
   */
  const rescue = makeRng(`${seed}:rescue:${size}`);
  for (let attempt = 1; attempt <= BUDGET; attempt++) {
    const solution = completeGrid(board, rescue);
    if (!solution) continue;
    const start = dig(board, solution, TRICKY, rescue);
    const result = solveGrid(board, start, TRICKY);
    if (!result.solved) continue;
    return { solution, start, tierUsed: result.tierUsed, attempts: BUDGET + attempt };
  }

  throw new Error(
    `No solvable ${size}x${size} board could be made for "${seed}". ` +
      `The box shape (${boxRows} by ${boxCols}) is probably not a puzzle.`,
  );
}

function holes(cells: readonly number[]): number {
  return cells.filter((v) => v === EMPTY).length;
}

export const TIER_RANKS = { gentle: GENTLE, steady: STEADY, tricky: TRICKY } as const;
export type TierId = keyof typeof TIER_RANKS;

export function tierRank(id: string): number {
  return TIER_RANKS[id as TierId] ?? GENTLE;
}

export function tierName(rank: number): string {
  if (rank <= GENTLE) return 'Gentle';
  if (rank === STEADY) return 'Steady';
  return 'Tricky';
}

/**
 * The board shapes this puzzle offers.
 *
 * Three, and the reasons are different for each. **4x4** is a first go: four numbers, four
 * squares to a box, and a five-year-old can finish one. **6x6** is where the technique
 * starts to matter, and its boxes are 2 by 3 — the shape that forced `Scene.band` to stop
 * being a single number. **9x9** is the one adults recognise.
 */
export const SHAPES: readonly Board[] = [
  { size: 4, boxRows: 2, boxCols: 2 },
  { size: 6, boxRows: 2, boxCols: 3 },
  { size: 9, boxRows: 3, boxCols: 3 },
];

export function shapeFor(size: number): Board {
  return SHAPES.find((s) => s.size === size) ?? SHAPES[0]!;
}
