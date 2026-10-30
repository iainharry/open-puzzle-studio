import { describe, expect, it } from 'vitest';
import {
  BLANK,
  FILLED,
  GENTLE,
  STEADY,
  TRICKY,
  UNKNOWN,
  clueWidth,
  completeLine,
  solveGrid,
  trivialLine,
  type Grid,
  type LineCell,
} from '../solver.js';
import { cluesFor, pictureLogic } from '../index.js';

/** "..##." -> line cells, for readable tests. */
function line(text: string): LineCell[] {
  return [...text].map((c) => (c === '#' ? FILLED : c === 'x' ? BLANK : UNKNOWN));
}

function show(cells: readonly LineCell[]): string {
  return cells.map((c) => (c === FILLED ? '#' : c === BLANK ? 'x' : '.')).join('');
}

/** Build a Grid from a picture, the way the generator will. */
function gridFrom(art: readonly string[]): { grid: Grid; solution: boolean[] } {
  const rows = art.length;
  const cols = art[0]!.length;
  const solution: boolean[] = [];
  for (const row of art) for (const ch of row) solution.push(ch === '#');
  const rowClues: number[][] = [];
  for (let r = 0; r < rows; r++) rowClues.push(cluesFor(solution.slice(r * cols, (r + 1) * cols)));
  const colClues: number[][] = [];
  for (let c = 0; c < cols; c++) {
    const col: boolean[] = [];
    for (let r = 0; r < rows; r++) col.push(solution[r * cols + c]!);
    colClues.push(cluesFor(col));
  }
  return { grid: { rows, cols, rowClues, colClues }, solution };
}

describe('clueWidth', () => {
  it('counts the runs and the gaps between them', () => {
    expect(clueWidth([3])).toBe(3);
    expect(clueWidth([3, 1])).toBe(5);
    expect(clueWidth([1, 1, 1])).toBe(5);
  });

  it('is zero for an empty line', () => {
    expect(clueWidth([0])).toBe(0);
  });
});

/** Narrows away 'impossible' so a test can read the deduced line. */
function deduced(r: ReturnType<typeof trivialLine>): { line: LineCell[]; technique: string } {
  if (r === null || r === 'impossible') throw new Error(`expected a deduction, got ${String(r)}`);
  return r;
}

describe('trivialLine', () => {
  it('empties a line whose clue is zero', () => {
    const result = deduced(trivialLine(line('.....'), [0]));
    expect(show(result.line)).toBe('xxxxx');
    expect(result.technique).toBe('line-empty');
  });

  it('fills a line the clue only just fits', () => {
    const result = deduced(trivialLine(line('.....'), [2, 2]));
    expect(show(result.line)).toBe('##x##');
    expect(result.technique).toBe('line-forced');
  });

  /** The classic: a run longer than half the line must cover the middle. */
  it('finds the overlap of a long run', () => {
    const result = deduced(trivialLine(line('.....'), [4]));
    expect(show(result.line)).toBe('.###.');
    expect(result.technique).toBe('overlap');
  });

  it('crosses out the rest once the line has all it needs', () => {
    const result = deduced(trivialLine(line('##...'), [2]));
    expect(show(result.line)).toBe('##xxx');
    expect(result.technique).toBe('line-complete');
  });

  it('says nothing when it has nothing to say', () => {
    expect(trivialLine(line('.....'), [1])).toBeNull();
  });

  /**
   * It used to paint over a square that was already known the other way, which turns a
   * contradiction into a confident wrong answer. Found by a 2x2 whose columns say "empty"
   * and whose rows say "filled".
   */
  it('reports a contradiction rather than painting over what is known', () => {
    expect(trivialLine(line('xx'), [2])).toBe('impossible');
    expect(trivialLine(line('##'), [0])).toBe('impossible');
    expect(trivialLine(line('###'), [1])).toBe('impossible');
  });
});

describe('completeLine', () => {
  /**
   * The point of the complete solver: a deduction the weak one cannot reach. If this
   * ever stops being true the difficulty tiers are decoration.
   */
  it('finds deductions the trivial solver misses', () => {
    // A 3 in a 5-line with square 1 known filled. The run must cover it, so it starts at
    // 0 or 1: squares 1 and 2 are filled either way, and square 4 is empty either way.
    // The trivial rules see only square 2, because their packing ignores filled squares.
    const l = line('.#...');
    expect(show(deduced(trivialLine(l, [3])).line)).toBe('.##..');
    const result = completeLine(l, [3]) as { line: LineCell[] };
    expect(show(result.line)).toBe('.##.x');
  });

  it('agrees with the trivial solver where both can see', () => {
    const result = completeLine(line('.....'), [4]) as { line: LineCell[] };
    expect(show(result.line)).toBe('.###.');
  });

  it('rules out squares no arrangement can reach', () => {
    // A 2 in a 5-line with square 2 known empty: the run sits at 0-1 or 3-4, so nothing
    // is certain. Saying nothing is the right answer, and saying something would be a
    // wrong one.
    expect(completeLine(line('..x..'), [2])).toBeNull();
  });

  /** How probing detects a contradiction. */
  it('reports a line that cannot be satisfied at all', () => {
    // A 2 needs two adjacent free squares; only the middle one is free.
    expect(completeLine(line('x.x'), [2])).toBe('impossible');
    // Two separate filled squares cannot be one run of 3 across a known gap.
    expect(completeLine(line('#x#'), [3])).toBe('impossible');
    // And a run longer than the line.
    expect(completeLine(line('..'), [3])).toBe('impossible');
  });

  /** `#.#` with a 3 *is* satisfiable — it fills the gap. Worth pinning, because the
   * first version of the test above assumed otherwise and blamed the solver. */
  it('fills a gap between two filled squares when the run demands it', () => {
    const result = completeLine(line('#.#'), [3]) as { line: LineCell[] };
    expect(show(result.line)).toBe('###');
  });

  it('finishes a line it can fully determine', () => {
    const result = completeLine(line('.....'), [5]) as { line: LineCell[] };
    expect(show(result.line)).toBe('#####');
  });

  it('says nothing when nothing is certain', () => {
    expect(completeLine(line('.....'), [1])).toBeNull();
  });
});

describe('solveGrid', () => {
  const heart = gridFrom(['.#.#.', '#####', '#####', '.###.', '..#..']);

  it('solves the heart, and gets the right picture', () => {
    const blank: LineCell[] = new Array(25).fill(UNKNOWN);
    const result = solveGrid(heart.grid, blank, TRICKY);
    expect(result.solved).toBe(true);
    expect(result.cells.map((c) => c === FILLED)).toEqual(heart.solution);
  });

  /**
   * Every deduction the solver makes is forced, so a fully solved grid is the *only*
   * grid matching those clues. Uniqueness falls out of the solver rather than needing a
   * separate search that could disagree with it.
   */
  it('never contradicts the picture it came from', () => {
    for (const art of [
      ['.#.#.', '#####', '#####', '.###.', '..#..'],
      ['..#..', '.###.', '#####', '#...#', '#.#.#'],
      ['#####', '#...#', '#...#', '#...#', '#####'],
    ]) {
      const { grid, solution } = gridFrom(art);
      const result = solveGrid(grid, new Array(solution.length).fill(UNKNOWN), TRICKY);
      for (let i = 0; i < solution.length; i++) {
        if (result.cells[i] === UNKNOWN) continue;
        expect(result.cells[i] === FILLED).toBe(solution[i]);
      }
    }
  });

  it('explains every step in words a child could read', () => {
    const result = solveGrid(heart.grid, new Array(25).fill(UNKNOWN), TRICKY);
    expect(result.steps.length).toBeGreaterThan(0);
    for (const step of result.steps) {
      expect(step.why.length).toBeGreaterThan(20);
      expect(step.cells.length).toBeGreaterThan(0);
      // Each step says which line to look at, which is the actual help.
      expect(step.why).toMatch(/Look at (row|column) \d+/);
    }
  });

  it('reports the hardest tier it needed, not the tier it was allowed', () => {
    const result = solveGrid(heart.grid, new Array(25).fill(UNKNOWN), TRICKY);
    expect(result.tierUsed).toBeGreaterThanOrEqual(GENTLE);
    expect(result.tierUsed).toBeLessThanOrEqual(TRICKY);
  });

  /**
   * The two-sided test in miniature: a weaker solver must actually be weaker, or
   * "this puzzle is Hard" means nothing.
   */
  it('gets further with a higher tier than a lower one', () => {
    // A grid chosen because the trivial rules stall on it.
    const { grid, solution } = gridFrom(['#.#', '.#.', '#.#']);
    const blank: LineCell[] = new Array(9).fill(UNKNOWN);
    const gentle = solveGrid(grid, blank, GENTLE);
    const steady = solveGrid(grid, blank, STEADY);
    const known = (r: { cells: LineCell[] }): number => r.cells.filter((c) => c !== UNKNOWN).length;
    expect(known(steady)).toBeGreaterThanOrEqual(known(gentle));
    expect(steady.solved || known(steady) > known(gentle)).toBe(true);
    expect(solution.length).toBe(9);
  });

  it('notices clues that describe no grid at all', () => {
    const grid: Grid = {
      rows: 2,
      cols: 2,
      // Rows want three filled squares between them; columns want none.
      rowClues: [[2], [1]],
      colClues: [[0], [0]],
    };
    const result = solveGrid(grid, new Array(4).fill(UNKNOWN), TRICKY);
    expect(result.impossible).toBe(true);
    expect(result.solved).toBe(false);
  });

  it('carries on from a partly filled grid, which is what a hint needs', () => {
    const blank: LineCell[] = new Array(25).fill(UNKNOWN);
    const full = solveGrid(heart.grid, blank, TRICKY);
    // Start from halfway through and it should still finish.
    const halfway = full.cells.map((c, i) => (i < 12 ? c : UNKNOWN));
    const rest = solveGrid(heart.grid, halfway, TRICKY);
    expect(rest.solved).toBe(true);
  });
});

describe('the module solve()', () => {
  it('no longer throws, and reports steps', () => {
    const puzzle = pictureLogic.generate({ kind: 'drawn' as const, picture: 'heart' });
    const state = pictureLogic.start(puzzle);
    const report = pictureLogic.solve(puzzle, state, TRICKY);
    expect(report.solved).toBe(true);
    expect(report.steps.length).toBeGreaterThan(0);
    expect(report.tierUsed).toBeGreaterThan(0);
  });

  /** A hint is the next step from where the player actually is. */
  it('gives the next step from a part-finished board', () => {
    const puzzle = pictureLogic.generate({ kind: 'drawn' as const, picture: 'heart' });
    let state = pictureLogic.start(puzzle);
    state = pictureLogic.apply(puzzle, state, { col: 0, row: 1, mark: 'filled' })!;
    const report = pictureLogic.solve(puzzle, state, TRICKY);
    expect(report.steps[0]).toBeDefined();
    expect(report.steps[0]!.cells.length).toBeGreaterThan(0);
  });
});
