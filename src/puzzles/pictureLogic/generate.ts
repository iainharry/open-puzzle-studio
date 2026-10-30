/**
 * Making a puzzle, by solving it.
 *
 * The thing that cannot be shortcut: **a nonogram cannot be made by drawing a random
 * bitmap.** Of random 30x30 grids, 97.5% have more than one solution and only 0.4% can be
 * solved a line at a time (Wolter's survey, https://webpbn.com/survey/). A generator that
 * drew a picture and read off the clues would produce puzzles that are ambiguous,
 * unsolvable by reasoning, or both — and would look like it worked, because the clues
 * would be perfectly correct clues for *a* grid.
 *
 * So the shape is: draw, read the clues, hand them to the solver, and keep only what the
 * solver can fully determine. **Uniqueness falls out of that** rather than needing its own
 * search: every deduction the solver makes is forced, so a fully determined grid is the
 * only grid those clues describe.
 *
 * ## Why the pictures are blobs and not noise
 *
 * Uniform random cells give a grid that is both ugly and nearly always ambiguous. The
 * generator instead grows a few connected blobs, which is closer to what a drawn picture
 * looks like and — not coincidentally — far more often solvable, because long runs and
 * long gaps are what line logic has purchase on.
 *
 * This is a presentation decision with a measurable effect, so it is measured: see the
 * acceptance-rate test.
 */

import { makeRng, type Rng } from '../../core/rng.js';
import { cluesFor } from './index.js';
import { GENTLE, STEADY, TRICKY, UNKNOWN, solveGrid, type Grid, type LineCell } from './solver.js';

export interface MakeOptions {
  readonly rows: number;
  readonly cols: number;
  /** 1 gentle, 2 steady, 3 tricky. */
  readonly tier: number;
  readonly seed: string;
}

export interface MadePuzzle {
  readonly solution: boolean[];
  readonly rowClues: number[][];
  readonly colClues: number[][];
  /** The tier the solver actually needed, which is what the player is told. */
  readonly tierUsed: number;
  /** How many candidates were tried. Reported by the tests, not by the app. */
  readonly attempts: number;
}

/** Grow connected blobs rather than scattering cells. */
function drawBlobs(rows: number, cols: number, rng: Rng): boolean[] {
  const cells = new Array<boolean>(rows * cols).fill(false);
  // Enough blobs to look deliberate, scaled to the board.
  const blobs = Math.max(2, Math.round((rows * cols) / 18));
  const target = Math.round(rows * cols * (0.42 + rng() * 0.16));
  let filled = 0;

  for (let b = 0; b < blobs && filled < target; b++) {
    let r = rng.int(rows);
    let c = rng.int(cols);
    const steps = 3 + rng.int(Math.max(4, Math.round((rows * cols) / 8)));
    for (let s = 0; s < steps && filled < target; s++) {
      if (!cells[r * cols + c]) {
        cells[r * cols + c] = true;
        filled++;
      }
      // A drunkard's walk, biased to stay on the board.
      const dir = rng.int(4);
      if (dir === 0 && r > 0) r--;
      else if (dir === 1 && r < rows - 1) r++;
      else if (dir === 2 && c > 0) c--;
      else if (dir === 3 && c < cols - 1) c++;
    }
  }
  return cells;
}

function gridFor(solution: readonly boolean[], rows: number, cols: number): Grid {
  const rowClues: number[][] = [];
  for (let r = 0; r < rows; r++) {
    rowClues.push(cluesFor(solution.slice(r * cols, (r + 1) * cols)));
  }
  const colClues: number[][] = [];
  for (let c = 0; c < cols; c++) {
    const line: boolean[] = [];
    for (let r = 0; r < rows; r++) line.push(solution[r * cols + c]!);
    colClues.push(cluesFor(line));
  }
  return { rows, cols, rowClues, colClues };
}

/** An entirely empty or entirely full grid is a correct puzzle and a miserable one. */
function worthPlaying(solution: readonly boolean[]): boolean {
  const filled = solution.filter(Boolean).length;
  const n = solution.length;
  return filled >= n * 0.2 && filled <= n * 0.75;
}

/**
 * Candidates to try before giving up.
 *
 * Generation is a search, not a construction, so a budget is not a failure case — it is
 * how the search terminates. On the boards this app cuts, acceptance is high enough that
 * the budget is rarely approached; the test that measures it exists so that stops being a
 * belief the moment it stops being true.
 */
const BUDGET = 400;

/**
 * Make a puzzle at a tier, or the closest one the search could reach.
 *
 * The **two-sided test** is the whole point: a puzzle counts as Steady only if the steady
 * solver finishes it *and* the gentle solver does not. Without the second half the
 * generator happily labels easy puzzles hard, because an easy puzzle is also solvable by a
 * stronger solver.
 *
 * Deterministic: the same options give the same puzzle, forever, which is what makes a
 * shareable code and a daily puzzle mean anything.
 */
export function makePuzzle(options: MakeOptions): MadePuzzle {
  const { rows, cols, tier, seed } = options;
  const rng = makeRng(`${seed}:${rows}x${cols}:${tier}`);
  const below = tier - 1;

  // Kept in case nothing hits the requested tier exactly: a solvable puzzle at the wrong
  // difficulty beats no puzzle at all, and the app tells the player which it got.
  let fallback: MadePuzzle | null = null;

  for (let attempt = 1; attempt <= BUDGET; attempt++) {
    const solution = drawBlobs(rows, cols, rng);
    if (!worthPlaying(solution)) continue;

    const grid = gridFor(solution, rows, cols);
    const blank = new Array<LineCell>(rows * cols).fill(UNKNOWN);

    const atTier = solveGrid(grid, blank, tier);
    if (!atTier.solved) continue;

    // Solvable. Is it solvable *too easily*?
    const tooEasy =
      below >= GENTLE ? solveGrid(grid, blank, below).solved : false;

    const made: MadePuzzle = {
      solution,
      rowClues: grid.rowClues as number[][],
      colClues: grid.colClues as number[][],
      tierUsed: atTier.tierUsed,
      attempts: attempt,
    };

    if (!tooEasy) return made;
    fallback ??= made;
  }

  if (fallback) return fallback;

  /**
   * Nothing in the budget worked.
   *
   * Rather than throw — which would hand the player a blank screen — fall back to a grid
   * the solver *can* finish at the easiest tier, searching again with no difficulty
   * requirement. If even that fails the options are unreasonable (a 2x2 at Tricky), and
   * then throwing is right, because silently returning an unsolvable puzzle is worse.
   */
  const rescue = makeRng(`${seed}:rescue:${rows}x${cols}`);
  for (let attempt = 1; attempt <= BUDGET; attempt++) {
    const solution = drawBlobs(rows, cols, rescue);
    if (!worthPlaying(solution)) continue;
    const grid = gridFor(solution, rows, cols);
    const result = solveGrid(grid, new Array<LineCell>(rows * cols).fill(UNKNOWN), TRICKY);
    if (!result.solved) continue;
    return {
      solution,
      rowClues: grid.rowClues as number[][],
      colClues: grid.colClues as number[][],
      tierUsed: result.tierUsed,
      attempts: BUDGET + attempt,
    };
  }

  throw new Error(
    `No solvable ${cols}x${rows} picture could be made for "${seed}". The board is probably too small for a puzzle.`,
  );
}

export const TIER_RANKS = { gentle: GENTLE, steady: STEADY, tricky: TRICKY } as const;
export type TierId = keyof typeof TIER_RANKS;

export function tierRank(id: string): number {
  return TIER_RANKS[id as TierId] ?? STEADY;
}

export function tierName(rank: number): string {
  if (rank <= GENTLE) return 'Gentle';
  if (rank === STEADY) return 'Steady';
  return 'Tricky';
}
