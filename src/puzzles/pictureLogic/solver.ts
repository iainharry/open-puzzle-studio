/**
 * The solver — the keystone of the whole project.
 *
 * One file that buys three features which would otherwise be three:
 *
 * 1. **Generation.** A nonogram cannot be made by drawing a random bitmap: of random
 *    30x30 grids, 97.5% have more than one solution and only 0.4% can be solved a line at
 *    a time (Wolter's survey, https://webpbn.com/survey/). Generation has to be driven by
 *    the solver, so the solver has to exist first.
 * 2. **Honest difficulty**, rated by *which deductions were needed* rather than by clue
 *    count, with a two-sided test: Hard means the hard solver succeeds **and** the easier
 *    one fails.
 * 3. **Honest hints**, because the next deduction the solver would make from the player's
 *    own position is exactly the hint worth giving.
 *
 * ## Uniqueness comes free, and that is not an accident
 *
 * Every deduction here is *forced*: it holds in every arrangement consistent with what is
 * already known. So if the solver determines the whole grid, that grid is the only
 * solution — no separate uniqueness search is needed. The generator therefore accepts only
 * puzzles the solver fully determines, and gets "exactly one answer" as a consequence
 * rather than as an extra check that could disagree.
 *
 * ## On the names
 *
 * The technique names below describe **what can be shown to be true**, not a simulation of
 * the order a human would think in. `completeLine` is a dynamic program over every valid
 * arrangement of a line; calling its output "naked pair" or any other borrowed term would
 * be a story invented to fit the output. The jigsaw project shipped one of those and only
 * caught it because a test asserted the rationale. So the names here are deliberately
 * plain, and each carries a `why` written to be read by a ten-year-old.
 */

import type { Cell, SolveStep } from '../../core/types.js';

/** A line cell during solving. Narrower than `Mark`: crossed and empty are the same thing. */
export const UNKNOWN = 0;
export const FILLED = 1;
export const BLANK = 2;
export type LineCell = typeof UNKNOWN | typeof FILLED | typeof BLANK;

/** Tier ranks, matching `pictureLogic.tiers`. */
export const GENTLE = 1;
export const STEADY = 2;
export const TRICKY = 3;

/**
 * The smallest width a clue can occupy: the runs plus one gap between each.
 * `[3,1]` needs 3 + 1 + 1 = 5 cells.
 */
export function clueWidth(clue: readonly number[]): number {
  if (clue.length === 1 && clue[0] === 0) return 0;
  return clue.reduce((a, b) => a + b, 0) + clue.length - 1;
}

/**
 * Push every run as far left as it will go without covering a square known to be empty.
 *
 * Deliberately simple: it ignores squares already known to be *filled*, which can only
 * place a run further left than the truth. That makes the overlap it feeds strictly
 * smaller — sound, and weaker. Weaker is the point. `trivialLine` exists to be beatable
 * by `completeLine`, or the difficulty tiers mean nothing.
 */
function packLeft(line: readonly LineCell[], clue: readonly number[]): number[] | null {
  if (clue.length === 1 && clue[0] === 0) return [];
  const starts: number[] = [];
  let at = 0;
  for (const len of clue) {
    let start = at;
    for (;;) {
      if (start + len > line.length) return null;
      let blockedAt = -1;
      for (let k = 0; k < len; k++) {
        if (line[start + k] === BLANK) blockedAt = start + k;
      }
      if (blockedAt < 0) break;
      start = blockedAt + 1;
    }
    starts.push(start);
    at = start + len + 1;
  }
  return starts;
}

/**
 * Mirror of `packLeft`, by reversing the line and the clue.
 *
 * The mapping back is the fiddly part and it was wrong first time: the j-th run of the
 * *reversed* clue is run `k-1-j` of the original, so its position must be stored at that
 * index rather than appended. Appending produced a run list in reverse order, which made
 * the overlap rule compare run 0's leftmost against run k-1's rightmost and "deduce"
 * squares that are not filled at all — a confidently wrong answer rather than a missing
 * one, which is the worse failure of the two.
 */
function packRight(line: readonly LineCell[], clue: readonly number[]): number[] | null {
  const starts = packLeft([...line].reverse(), [...clue].reverse());
  if (!starts) return null;
  const n = line.length;
  const out = new Array<number>(clue.length);
  for (let j = 0; j < clue.length; j++) {
    const i = clue.length - 1 - j;
    out[i] = n - starts[j]! - clue[i]!;
  }
  return out;
}

export interface LineResult {
  /** The line with every forced cell filled in. */
  readonly line: LineCell[];
  /** Indices that changed, for the hint. */
  readonly changed: number[];
  /** What the deduction was. */
  readonly technique: string;
  readonly why: string;
}

/**
 * The weak solver: deductions a person finds without working through arrangements.
 *
 * Deliberately incomplete. Its whole purpose is to be *strictly weaker* than
 * `completeLine`, so that "this puzzle needs the complete solver" is a meaningful
 * statement and the difficulty tiers are not decoration.
 */
export function trivialLine(
  line: readonly LineCell[],
  clue: readonly number[],
): LineResult | null | 'impossible' {
  const n = line.length;
  const out = [...line];
  const changed: number[] = [];
  let broken = false;
  /**
   * Writing over a square that is already known the other way is not a deduction, it is a
   * contradiction — and quietly overwriting it is how a solver produces a confident wrong
   * answer. Found by a two-by-two grid whose columns say "empty" and whose rows say
   * "filled": the rows ran first and the columns painted over them.
   */
  const mark = (i: number, v: LineCell): void => {
    const was = out[i]!;
    if (was === v) return;
    if (was !== UNKNOWN) {
      broken = true;
      return;
    }
    out[i] = v;
    changed.push(i);
  };

  // An empty line.
  if (clue.length === 1 && clue[0] === 0) {
    for (let i = 0; i < n; i++) mark(i, BLANK);
    if (broken) return 'impossible';
    return changed.length
      ? { line: out, changed, technique: 'line-empty', why: 'This line has a 0, so none of it is filled in.' }
      : null;
  }

  const width = clueWidth(clue);

  // The clue only fits one way.
  if (width === n) {
    let at = 0;
    for (const len of clue) {
      for (let k = 0; k < len; k++) mark(at + k, FILLED);
      at += len;
      if (at < n) mark(at, BLANK);
      at++;
    }
    if (broken) return 'impossible';
    return changed.length
      ? {
          line: out,
          changed,
          technique: 'line-forced',
          why: `These numbers only just fit in ${n}, so there is only one way to place them.`,
        }
      : null;
  }

  // Everything the clue asks for is already there, so the rest is empty.
  const filled = line.filter((c) => c === FILLED).length;
  const wanted = clue.reduce((a, b) => a + b, 0);
  if (filled > wanted) return 'impossible';
  if (filled === wanted) {
    for (let i = 0; i < n; i++) if (out[i] === UNKNOWN) mark(i, BLANK);
    if (broken) return 'impossible';
    if (changed.length) {
      return {
        line: out,
        changed,
        technique: 'line-complete',
        why: 'All the squares this line needs are already filled, so the rest must be empty.',
      };
    }
  }

  // The overlap rule: where the leftmost and rightmost placements of a run agree.
  const left = packLeft(line, clue);
  const right = packRight(line, clue);
  if (left && right) {
    for (let i = 0; i < clue.length; i++) {
      const len = clue[i]!;
      const from = Math.max(left[i]!, right[i]!);
      const to = Math.min(left[i]! + len, right[i]! + len);
      for (let k = from; k < to; k++) mark(k, FILLED);
    }
    if (broken) return 'impossible';
    if (changed.length) {
      return {
        line: out,
        changed,
        technique: 'overlap',
        why: 'Push the run as far one way as it goes, then as far the other way. Wherever it covers the same square both times, that square must be filled.',
      };
    }
  }

  return null;
}

/**
 * The complete line solver: every cell that is the same in **every** valid arrangement.
 *
 * A dynamic program rather than an enumeration. States are (position, clue index); the
 * backward pass finds which states can still be completed, the forward pass finds which
 * are reachable, and a cell is forced when every live transition over it agrees.
 *
 * Complete, so nothing a line alone can tell you is missed. Returns null for a line with
 * no valid arrangement at all, which is how probing detects a contradiction.
 */
export function completeLine(
  line: readonly LineCell[],
  clue: readonly number[],
): LineResult | null | 'impossible' {
  const n = line.length;
  const runs = clue.length === 1 && clue[0] === 0 ? [] : clue;
  const k = runs.length;

  // canFinish[pos][ci]: runs ci.. can be placed in line[pos..].
  const canFinish: boolean[][] = Array.from({ length: n + 1 }, () => new Array<boolean>(k + 1).fill(false));
  for (let pos = n; pos >= 0; pos--) {
    for (let ci = k; ci >= 0; ci--) {
      if (ci === k) {
        // Every remaining cell must be able to be blank.
        let ok = true;
        for (let i = pos; i < n; i++) if (line[i] === FILLED) ok = false;
        canFinish[pos]![ci] = ok;
        continue;
      }
      let ok = false;
      // Leave this cell blank.
      if (pos < n && line[pos] !== FILLED && canFinish[pos + 1]![ci]) ok = true;
      // Place run ci here.
      const len = runs[ci]!;
      if (!ok && pos + len <= n) {
        let fits = true;
        for (let i = pos; i < pos + len; i++) if (line[i] === BLANK) fits = false;
        if (fits) {
          const after = pos + len;
          if (after === n) {
            if (canFinish[after]![ci + 1]) ok = true;
          } else if (line[after] !== FILLED && canFinish[after + 1]![ci + 1]) {
            ok = true;
          }
        }
      }
      canFinish[pos]![ci] = ok;
    }
  }
  if (!canFinish[0]![0]) return 'impossible';

  // Forward: which states are reachable, and what each cell can be on a live path.
  const reach: boolean[][] = Array.from({ length: n + 1 }, () => new Array<boolean>(k + 1).fill(false));
  reach[0]![0] = true;
  const canBeFilled = new Array<boolean>(n).fill(false);
  const canBeBlank = new Array<boolean>(n).fill(false);

  for (let pos = 0; pos <= n; pos++) {
    for (let ci = 0; ci <= k; ci++) {
      if (!reach[pos]![ci] || !canFinish[pos]![ci]) continue;
      if (pos === n) continue;

      // Blank here.
      if (line[pos] !== FILLED && canFinish[pos + 1]![ci]) {
        canBeBlank[pos] = true;
        reach[pos + 1]![ci] = true;
      }
      // Run ci starts here.
      if (ci < k) {
        const len = runs[ci]!;
        if (pos + len <= n) {
          let fits = true;
          for (let i = pos; i < pos + len; i++) if (line[i] === BLANK) fits = false;
          if (fits) {
            const after = pos + len;
            if (after === n) {
              if (canFinish[after]![ci + 1]) {
                for (let i = pos; i < after; i++) canBeFilled[i] = true;
                reach[after]![ci + 1] = true;
              }
            } else if (line[after] !== FILLED && canFinish[after + 1]![ci + 1]) {
              for (let i = pos; i < after; i++) canBeFilled[i] = true;
              canBeBlank[after] = true;
              reach[after + 1]![ci + 1] = true;
            }
          }
        }
      }
    }
  }

  const out = [...line];
  const changed: number[] = [];
  for (let i = 0; i < n; i++) {
    if (out[i] !== UNKNOWN) continue;
    if (canBeFilled[i] && !canBeBlank[i]) {
      out[i] = FILLED;
      changed.push(i);
    } else if (canBeBlank[i] && !canBeFilled[i]) {
      out[i] = BLANK;
      changed.push(i);
    }
  }
  if (changed.length === 0) return null;
  return {
    line: out,
    changed,
    technique: 'line-deduction',
    why: 'Try every way these numbers could fit this line. Some squares come out the same every time — so those are certain.',
  };
}

export interface Grid {
  readonly rows: number;
  readonly cols: number;
  readonly rowClues: readonly (readonly number[])[];
  readonly colClues: readonly (readonly number[])[];
}

export interface GridSolveResult {
  /** Every cell determined. */
  readonly solved: boolean;
  /** Contradiction found — the clues describe no grid at all. */
  readonly impossible: boolean;
  readonly cells: LineCell[];
  readonly steps: SolveStep[];
  readonly tierUsed: number;
}

function readLine(cells: readonly LineCell[], grid: Grid, axis: 'row' | 'col', index: number): LineCell[] {
  const n = axis === 'row' ? grid.cols : grid.rows;
  const line: LineCell[] = [];
  for (let i = 0; i < n; i++) {
    line.push(cells[axis === 'row' ? index * grid.cols + i : i * grid.cols + index]!);
  }
  return line;
}

function writeLine(cells: LineCell[], grid: Grid, axis: 'row' | 'col', index: number, line: readonly LineCell[]): void {
  for (let i = 0; i < line.length; i++) {
    cells[axis === 'row' ? index * grid.cols + i : i * grid.cols + index] = line[i]!;
  }
}

function cellOf(axis: 'row' | 'col', index: number, i: number): Cell {
  return axis === 'row' ? { col: i, row: index } : { col: index, row: i };
}

const LINE_NAME = { row: 'row', col: 'column' } as const;

/**
 * Every cell of a line, as cells.
 *
 * A step used to carry `{ axis, index }` and leave the shell and the demonstration to work
 * the cells out from it. Both of them did, identically, and both of them therefore knew
 * how a grid is laid out — which is puzzle knowledge in the front end. The second puzzle
 * made the leak impossible to keep, because its deductions are about boxes and a box is
 * neither a row nor a column. So the puzzle hands over the cells it means.
 */
export function lineCellsOf(grid: Grid, axis: 'row' | 'col', index: number): Cell[] {
  const n = axis === 'row' ? grid.cols : grid.rows;
  const out: Cell[] = [];
  for (let i = 0; i < n; i++) out.push(cellOf(axis, index, i));
  return out;
}

/** "Row 4", "Column 11". For the status line, so it needs its capital. */
export function lineCap(axis: 'row' | 'col', index: number): string {
  return `${axis === 'row' ? 'Row' : 'Column'} ${index + 1}`;
}

/**
 * Solve as far as the given tier allows.
 *
 * Passes over every row and column until nothing changes. `maxSteps` is a safety rail for
 * the generator, which calls this thousands of times.
 */
export function solveGrid(
  grid: Grid,
  start: readonly LineCell[],
  maxTier: number,
  maxSteps = 100_000,
): GridSolveResult {
  const cells = [...start];
  const steps: SolveStep[] = [];
  let tierUsed = 0;

  const sweep = (tier: number): boolean => {
    let any = false;
    for (const axis of ['row', 'col'] as const) {
      const count = axis === 'row' ? grid.rows : grid.cols;
      for (let index = 0; index < count; index++) {
        const line = readLine(cells, grid, axis, index);
        if (line.every((c) => c !== UNKNOWN)) continue;
        const clue = axis === 'row' ? grid.rowClues[index]! : grid.colClues[index]!;
        const result =
          tier <= GENTLE ? trivialLine(line, clue) : completeLine(line, clue);
        if (result === 'impossible') throw new Contradiction();
        if (!result) continue;
        writeLine(cells, grid, axis, index, result.line);
        steps.push({
          technique: result.technique,
          tier,
          cells: result.changed.map((i) => cellOf(axis, index, i)),
          why: `Look at ${LINE_NAME[axis]} ${index + 1}. ${result.why}`,
          look: lineCellsOf(grid, axis, index),
          where: lineCap(axis, index),
          moves: result.changed.map((i) => ({
            ...cellOf(axis, index, i),
            mark: result.line[i] === FILLED ? 'filled' : 'crossed',
          })),
        });
        tierUsed = Math.max(tierUsed, tier);
        any = true;
        if (steps.length > maxSteps) return any;
      }
    }
    return any;
  };

  try {
    for (;;) {
      if (sweep(GENTLE)) continue;
      if (maxTier >= STEADY && sweep(STEADY)) continue;
      if (maxTier >= TRICKY && probe(grid, cells, steps)) {
        tierUsed = Math.max(tierUsed, TRICKY);
        continue;
      }
      break;
    }
  } catch (err) {
    if (err instanceof Contradiction) {
      return { solved: false, impossible: true, cells, steps, tierUsed };
    }
    throw err;
  }

  return {
    solved: cells.every((c) => c !== UNKNOWN),
    impossible: false,
    cells,
    steps,
    tierUsed,
  };
}

class Contradiction extends Error {}

/**
 * Probing: assume a cell is filled, line-solve, and if that is impossible the cell must be
 * blank (and the other way round).
 *
 * The standard escape when pure line logic stalls, and whether it was needed at all is
 * itself the hardest tier. Expensive — a whole line-solve per hypothesis — so it runs only
 * after the cheap sweeps have given up, and stops at the first cell it settles.
 */
function probe(grid: Grid, cells: LineCell[], steps: SolveStep[]): boolean {
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] !== UNKNOWN) continue;
    for (const guess of [FILLED, BLANK] as const) {
      const trial = [...cells];
      trial[i] = guess;
      const result = solveGrid(grid, trial, STEADY, 5_000);
      if (!result.impossible) continue;
      const forced: LineCell = guess === FILLED ? BLANK : FILLED;
      cells[i] = forced;
      steps.push({
        technique: 'probe',
        tier: TRICKY,
        cells: [{ col: i % grid.cols, row: Math.floor(i / grid.cols) }],
        why:
          guess === FILLED
            ? 'Suppose this square were filled. Follow it through and a line becomes impossible — so it must be empty.'
            : 'Suppose this square were empty. Follow it through and a line becomes impossible — so it must be filled.',
      });
      return true;
    }
  }
  return false;
}


/**
 * The next single deduction from here, and nothing more.
 *
 * A hint needs one step; `solveGrid` works the whole puzzle out. On a 20x20 that is the
 * difference between a button press and a noticeable pause, on every press.
 *
 * It sweeps the tiers from easiest upwards and stops at the first thing it finds, which is
 * not only cheaper but **better teaching**: a hint that reaches for a contradiction proof
 * while an obvious overlap sits two rows down shows a child the wrong lesson about how
 * these puzzles are solved.
 */
export function nextStep(
  grid: Grid,
  cells: readonly LineCell[],
  maxTier: number,
): SolveStep | null {
  for (const tier of [GENTLE, STEADY]) {
    if (tier > maxTier) break;
    for (const axis of ['row', 'col'] as const) {
      const count = axis === 'row' ? grid.rows : grid.cols;
      for (let index = 0; index < count; index++) {
        const current = readLine(cells, grid, axis, index);
        if (current.every((c) => c !== UNKNOWN)) continue;
        const clue = axis === 'row' ? grid.rowClues[index]! : grid.colClues[index]!;
        const result = tier === GENTLE ? trivialLine(current, clue) : completeLine(current, clue);
        if (result === 'impossible' || !result) continue;
        return {
          technique: result.technique,
          tier,
          cells: result.changed.map((i) => cellOf(axis, index, i)),
          why: `Look at ${LINE_NAME[axis]} ${index + 1}. ${result.why}`,
          look: lineCellsOf(grid, axis, index),
          where: lineCap(axis, index),
          moves: result.changed.map((i) => ({
            ...cellOf(axis, index, i),
            mark: result.line[i] === FILLED ? 'filled' : 'crossed',
          })),
        };
      }
    }
  }

  if (maxTier >= TRICKY) {
    const trial = [...cells];
    const steps: SolveStep[] = [];
    if (probe(grid, trial, steps) && steps[0]) {
      const step = steps[0];
      const at = step.cells[0]!;
      return {
        ...step,
        look: lineCellsOf(grid, 'row', at.row),
        where: lineCap('row', at.row),
        moves: [{ ...at, mark: trial[at.row * grid.cols + at.col] === FILLED ? 'filled' : 'crossed' }],
      };
    }
  }
  return null;
}

/**
 * The first line whose marks cannot be made to fit its clue.
 *
 * This is the "check my work" that matters, and it is answer-free by construction: it
 * never looks at the solution, only at whether what the player has written down is
 * *consistent with the clues*. So it can say "row 4 has gone wrong" without saying which
 * square — which is the difference between help and surrender.
 *
 * A player's crossed-out squares count. A square crossed in error is exactly as
 * contradictory as a square filled in error, and is the mistake that is hardest to find
 * by eye.
 */
export function firstBrokenLine(
  grid: Grid,
  cells: readonly LineCell[],
): { axis: 'row' | 'col'; index: number } | null {
  for (const axis of ['row', 'col'] as const) {
    const count = axis === 'row' ? grid.rows : grid.cols;
    for (let index = 0; index < count; index++) {
      const clue = axis === 'row' ? grid.rowClues[index]! : grid.colClues[index]!;
      if (completeLine(readLine(cells, grid, axis, index), clue) === 'impossible') {
        return { axis, index };
      }
    }
  }
  return null;
}

export { LINE_NAME };
