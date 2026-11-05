import { describe, expect, it } from 'vitest';
import {
  EMPTY,
  GENTLE,
  STEADY,
  TRICKY,
  candidates,
  countSolutions,
  firstBrokenUnit,
  geometryOf,
  nextStep,
  propagate,
  solveGrid,
  type Board,
} from '../solver.js';

const FOUR: Board = { size: 4, boxRows: 2, boxCols: 2 };
const SIX: Board = { size: 6, boxRows: 2, boxCols: 3 };
const NINE: Board = { size: 9, boxRows: 3, boxCols: 3 };

/**
 * A 4x4 board written the way it looks, so a test reading wrong is visible as a test
 * reading wrong. `.` is empty.
 *
 *     grid4('12.3', ...)
 */
function grid(size: number, ...rows: string[]): number[] {
  expect(rows.length).toBe(size);
  const out: number[] = [];
  for (const row of rows) {
    expect(row.length).toBe(size);
    for (const ch of row) out.push(ch === '.' ? EMPTY : Number(ch));
  }
  return out;
}

describe('the geometry of a board', () => {
  it('has a row, a column and a box for every line', () => {
    expect(geometryOf(FOUR).units.length).toBe(12);
    expect(geometryOf(SIX).units.length).toBe(18);
    expect(geometryOf(NINE).units.length).toBe(27);
  });

  /** The reason `band` had to stop being a single number: these boxes are not square. */
  it('makes a 6x6 box two tall and three wide', () => {
    const boxes = geometryOf(SIX).units.filter((u) => u.kind === 'box');
    expect(boxes.length).toBe(6);
    expect([...boxes[0]!.cells]).toEqual([0, 1, 2, 6, 7, 8]);
    expect([...boxes[1]!.cells]).toEqual([3, 4, 5, 9, 10, 11]);
  });

  /**
   * Boxes are named the way somebody would point at one. "Box 4" is ambiguous — nobody
   * agrees whether they run across or down — and means nothing to a seven-year-old.
   */
  it('names boxes so a child could be told which one', () => {
    const four = geometryOf(FOUR).units.filter((u) => u.kind === 'box').map((u) => u.name);
    expect(four).toEqual([
      'the top-left box',
      'the top-right box',
      'the bottom-left box',
      'the bottom-right box',
    ]);

    // Three rows of boxes and two columns of them, so the middles must keep their word or
    // all three left-hand boxes end up called "the left box".
    const six = geometryOf(SIX).units.filter((u) => u.kind === 'box').map((u) => u.name);
    expect(six).toContain('the middle-left box');
    expect(six).toContain('the bottom-right box');
    expect(six.filter((n) => n === 'the left box')).toEqual([]);

    // Only the true centre of a three-by-three arrangement collapses to "the middle box".
    const nine = geometryOf(NINE).units.filter((u) => u.kind === 'box').map((u) => u.name);
    expect(nine[4]).toBe('the middle box');
    expect(nine.filter((n) => n === 'the middle box').length).toBe(1);
  });

  it('gives every square its row, its column and its box, and nothing else', () => {
    const geo = geometryOf(FOUR);
    expect(geo.unitsOf[0]!.length).toBe(3);
    // Three units of four, sharing one square: 3 + 3 + 3 peers, less the overlaps.
    expect([...geo.peers[0]!].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 8, 12]);
  });
});

describe('what a square could hold', () => {
  it('rules out what its row, its column and its box already have', () => {
    //  2 1 . .      Cell 3 (row 1, column 4): its row holds 2 and 1, its column holds 3
    //  . . . 3      and 4. Nothing is left for it at all, which is what the first line
    //  . . . 4      asserts — and is the state the broken-board check is built on.
    //  . . . .
    const cells = grid(4, '21..', '...3', '...4', '....');
    const cand = candidates(FOUR, cells);
    expect(cand[3]).toBe(0);
    // Cell 2 is blocked from 1 and 2 by its row and from 3 by its box — the 3 sits in the
    // square diagonally below it, which is in the same box and is easy to miss by eye.
    // Only the 4 is left.
    expect(cand[2]).toBe(1 << 3);
    // A filled square has no candidates at all, rather than "all of them".
    expect(cand[0]).toBe(0);
    expect(cand[1]).toBe(0);
  });
});

describe('one deduction at a time', () => {
  /**
   * The easiest technique must win. Both of the tier-1 techniques fire on this board, and
   * "there is one square left in this row" is the one a beginner can see.
   */
  it('prefers the last square in a line to the last number for a square', () => {
    const cells = grid(4, '123.', '....', '....', '....');
    const step = nextStep(FOUR, cells, TRICKY)!;
    expect(step.technique).toBe('last-in-unit');
    expect(step.tier).toBe(GENTLE);
    expect(step.cells).toEqual([{ col: 3, row: 0 }]);
    expect(step.moves).toEqual([{ col: 3, row: 0, value: 4 }]);
    expect(step.where).toBe('Row 1');
    expect(step.look!.length).toBe(4);
  });

  /**
   * A square with one option left, where no line is down to its last square — so the
   * easier technique genuinely is not available and this one is not shadowing it.
   */
  it('finds the only number a square can take', () => {
    //  . 1 . .     cell 0 is blocked from 1 by its row and its box, from 2 by its
    //  2 . . .     column and its box, and from 3 by its column. Only 4 is left.
    //  3 . . .
    //  . . . .
    const cells = grid(4, '.1..', '2...', '3...', '....');
    for (const unit of geometryOf(FOUR).units) {
      expect(unit.cells.filter((i) => cells[i] === EMPTY).length).not.toBe(1);
    }

    const step = nextStep(FOUR, cells, TRICKY)!;
    expect(step.technique).toBe('only-choice');
    expect(step.tier).toBe(GENTLE);
    expect(step.moves).toEqual([{ col: 0, row: 0, value: 4 }]);
    expect(step.why).toContain('1, 2 and 3');
    expect(step.why).toContain('4');
    // Where to look is the box, not the square: the first strength of a hint should narrow
    // the search down, not end it.
    expect(step.where).toBe('The top-left box');
    expect(step.look!.length).toBe(4);
  });

  /**
   * **The two-sided assertion.** Tier 2 is only a real tier if tier 1 cannot do the same
   * job, so this board is checked against both.
   */
  it('reads it the other way round when nothing easier is left', () => {
    //  . . . .     The 1 in row 2 blocks the left two squares of the top-left box, and
    //  . . 1 .     the 1 in row 4 blocks the one above it. So in row 1 the 1 can only go
    //  . . . .     in the first square — but that square still has three options, so no
    //  . 1 . .     tier-1 technique finds it.
    const cells = grid(4, '....', '..1.', '....', '.1..');
    expect(nextStep(FOUR, cells, GENTLE)).toBeNull();

    const step = nextStep(FOUR, cells, STEADY)!;
    expect(step.technique).toBe('only-place');
    expect(step.tier).toBe(STEADY);
    expect(step.moves).toEqual([{ col: 0, row: 0, value: 1 }]);
    expect(step.where).toBe('Row 1');
    expect(step.why).toContain('can only go in one square');
  });

  /** Shapes instead of digits, for a child who cannot read numbers yet. */
  it('says the value however the puzzle says it', () => {
    const shapes = ['●', '▲', '■', '★'];
    const cells = grid(4, '123.', '....', '....', '....');
    const step = nextStep(FOUR, cells, GENTLE, (v) => shapes[v - 1] ?? '?')!;
    expect(step.why).toContain('★');
    expect(step.why).not.toContain('4');
  });
});

describe('a board that cannot be right', () => {
  it('names the line with the repeat, and says which number it is', () => {
    const cells = grid(4, '2.2.', '....', '....', '....');
    const broken = firstBrokenUnit(FOUR, cells)!;
    expect(broken.unit.cap).toBe('Row 1');
    expect(broken.why).toContain('two 2s');
  });

  /**
   * The harder kind: no repeat anywhere, but a line has a number with nowhere left to go.
   * Column 1 holds 2, 3 and 4, so its last square must be the 1 — and the 1 in row 4
   * blocks it.
   */
  it('names a line that has run out of room for a number', () => {
    const cells = grid(4, '2...', '3...', '4...', '.1..');
    expect(firstBrokenUnit(FOUR, cells)!.unit.cap).toBe('Column 1');
    expect(firstBrokenUnit(FOUR, cells)!.why).toContain('nowhere left');
  });

  /**
   * **The one that would do the damage.** A half-finished board that is entirely correct
   * must never be called wrong — a hint system that cries wolf on a child doing fine is
   * worse than no hint system.
   */
  it('says nothing about a half-finished board that is correct so far', () => {
    expect(firstBrokenUnit(NINE, PUZZLE)).toBeNull();
    const half = [...ANSWER];
    for (let i = 0; i < half.length; i += 2) half[i] = EMPTY;
    expect(firstBrokenUnit(NINE, half)).toBeNull();
    expect(firstBrokenUnit(NINE, ANSWER)).toBeNull();
  });

  /** And a solve begun from a wrong board refuses rather than deducing from the mistake. */
  it('will not solve from a board that is already wrong', () => {
    const cells = grid(4, '2.2.', '....', '....', '....');
    const report = solveGrid(FOUR, cells, TRICKY);
    expect(report.solved).toBe(false);
    expect(report.steps).toEqual([]);
  });
});

/**
 * A 9x9 that tier 2 cannot finish and tier 3 can, kept as data.
 *
 * Found by search rather than written by hand, so the test does not take its properties on
 * trust: every claim about it below is asserted, including that it has exactly one answer
 * and that the answer the solver reaches is that one.
 */
const PUZZLE: readonly number[] = [
  6, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 5, 0, 0, 0, 0, 3, 0, 3, 0, 0, 0, 8, 0, 0, 7, 0,
  4, 3, 9, 6, 0, 0, 8, 0, 0, 2, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 8, 0, 0, 1, 0, 0,
  0, 0, 6, 2, 0, 0, 0, 0, 0, 0, 0, 1, 9, 5, 0, 2, 0, 0, 7, 0, 0, 0, 0, 0, 0, 0, 5,
];
const ANSWER: readonly number[] = [
  6, 7, 4, 3, 9, 2, 5, 1, 8, 1, 8, 5, 4, 7, 6, 9, 3, 2, 3, 9, 2, 5, 8, 1, 6, 7, 4,
  4, 3, 9, 6, 1, 5, 8, 2, 7, 2, 1, 8, 7, 4, 9, 3, 5, 6, 5, 6, 7, 8, 2, 3, 1, 4, 9,
  9, 5, 6, 2, 3, 4, 7, 8, 1, 8, 4, 1, 9, 5, 7, 2, 6, 3, 7, 2, 3, 1, 6, 8, 4, 9, 5,
];

describe('supposing, and finding that it breaks', () => {
  it('is a puzzle with exactly one answer, and that answer', () => {
    expect(countSolutions(NINE, PUZZLE, 3)).toBe(1);
    const check = [...PUZZLE];
    for (let i = 0; i < check.length; i++) {
      if (PUZZLE[i] !== EMPTY) expect(PUZZLE[i]).toBe(ANSWER[i]);
    }
    expect(check.length).toBe(81);
  });

  it('cannot be finished by looking alone', () => {
    const work = [...PUZZLE];
    expect(propagate(NINE, work, STEADY)).toBe('stuck');
    expect(solveGrid(NINE, PUZZLE, STEADY).solved).toBe(false);
  });

  it('can be finished by supposing, and reaches the right answer', () => {
    const report = solveGrid(NINE, PUZZLE, TRICKY);
    expect(report.solved).toBe(true);
    expect(report.cells).toEqual([...ANSWER]);
    expect(report.tierUsed).toBe(TRICKY);
    expect(report.steps.some((s) => s.technique === 'probe')).toBe(true);
  });

  /** Every step has to be a sentence a child could be read. */
  it('explains each step it took, with the move it implies', () => {
    const report = solveGrid(NINE, PUZZLE, TRICKY);
    for (const step of report.steps) {
      expect(step.why.length).toBeGreaterThan(30);
      expect(step.moves!.length).toBe(1);
      expect(step.cells.length).toBe(1);
      expect(step.look!.length).toBeGreaterThanOrEqual(1);
      expect(step.where!.length).toBeGreaterThan(2);
    }
  });

  /** A probe's sentence has to say what was supposed, or it teaches nothing. */
  it('says what it supposed and what went wrong', () => {
    const probe = solveGrid(NINE, PUZZLE, TRICKY).steps.find((s) => s.technique === 'probe')!;
    expect(probe.why).toContain('Suppose');
    expect(probe.why).toContain('no number it can take');
  });
});

describe('filling in what follows', () => {
  it('finishes a board that only needs looking', () => {
    const work = [...ANSWER];
    for (const i of [0, 1, 2, 40, 41, 80, 79]) work[i] = EMPTY;
    expect(propagate(NINE, work, GENTLE)).toBe('solved');
    expect(work).toEqual([...ANSWER]);
  });

  it('reports a board that has been made impossible', () => {
    const work = [...ANSWER];
    work[0] = EMPTY;
    work[1] = EMPTY;
    // Two 7s in row 1 now: 7 was already at index 1, and index 0 is given a second one.
    work[0] = 7;
    expect(propagate(NINE, work, STEADY)).toBe('broken');
  });

  it('stops rather than guessing', () => {
    const work = new Array<number>(81).fill(EMPTY);
    expect(propagate(NINE, work, STEADY)).toBe('stuck');
  });
});

describe('counting answers', () => {
  it('finds the one answer of a real puzzle', () => {
    expect(countSolutions(NINE, PUZZLE, 2)).toBe(1);
  });

  it('stops counting at the cap rather than enumerating the universe', () => {
    expect(countSolutions(FOUR, new Array<number>(16).fill(EMPTY), 2)).toBe(2);
    expect(countSolutions(NINE, new Array<number>(81).fill(EMPTY), 2)).toBe(2);
  });

  it('finds none for a board that cannot be completed', () => {
    const cells = grid(4, '2...', '3...', '4...', '.1..');
    expect(countSolutions(FOUR, cells, 2)).toBe(0);
  });
});
