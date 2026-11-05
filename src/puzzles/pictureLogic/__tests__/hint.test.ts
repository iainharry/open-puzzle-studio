import { describe, expect, it } from 'vitest';
import { pictureLogic, type PicturePuzzle, type PictureState } from '../index.js';
import { makePuzzle } from '../generate.js';
import { TRICKY } from '../solver.js';

function open(picture = 'heart'): { puzzle: PicturePuzzle; state: PictureState } {
  const puzzle = pictureLogic.generate({ kind: 'drawn' as const, picture });
  return { puzzle, state: pictureLogic.start(puzzle) };
}

function hintFor(puzzle: PicturePuzzle, state: PictureState) {
  return pictureLogic.hint!(puzzle, state, TRICKY);
}

/** Narrows a hint to a step, with a readable failure when it is not one. */
function step(hint: ReturnType<typeof hintFor>): {
  tier: number;
  cells: readonly unknown[];
  why: string;
  look?: readonly { col: number; row: number }[];
  where?: string;
  moves?: readonly unknown[];
} {
  if (hint.kind !== 'step') throw new Error(`expected a step, got "${hint.kind}"`);
  return hint.step;
}

function play(puzzle: PicturePuzzle, state: PictureState, moves: readonly unknown[]): PictureState {
  let next = state;
  for (const move of moves) {
    next = pictureLogic.apply(puzzle, next, move as never) ?? next;
  }
  return next;
}

describe('hint', () => {
  it('offers a next step on a blank board', () => {
    const { puzzle, state } = open();
    const hint = hintFor(puzzle, state);
    expect(hint.kind).toBe('step');
  });

  /**
   * The hint has to be about the player's own board. A hint computed from blank would
   * keep telling somebody halfway through a puzzle to do something they did ten minutes
   * ago, which is the single most obvious way a hint system becomes useless.
   */
  it('is about where the player actually is', () => {
    const { puzzle, state } = open();
    const first = hintFor(puzzle, state);
    expect(first.kind).toBe('step');
    const after = play(puzzle, state, step(first).moves ?? []);
    const second = hintFor(puzzle, after);
    expect(second.kind).toBe('step');
    expect(step(first).where).not.toBe(step(second).where);
  });

  /**
   * Easiest first. A hint that reaches for a contradiction proof while an obvious overlap
   * sits two rows down teaches the wrong lesson about how these are solved.
   */
  it('reaches for the easiest deduction available, not the first one found', () => {
    const { puzzle, state } = open();
    expect(step(hintFor(puzzle, state)).tier).toBe(1);
  });

  it('says which line to look at, as data and not only as prose', () => {
    const { puzzle, state } = open();
    const found = step(hintFor(puzzle, state));
    // As cells rather than as an axis and an index: the shell and the demonstration both
    // used to reconstruct the cells themselves, which meant they knew how a grid is laid
    // out. See `src/core/types.ts`.
    expect(found.look!.length).toBe(5);
    expect(found.where).toMatch(/^(Row|Column) \d+$/);
    expect(found.why).toMatch(/Look at (row|column) \d+/);
  });

  /** Every hint has to be followable, or the strongest strength does nothing. */
  it('carries the moves that would carry it out', () => {
    const { puzzle, state } = open();
    const found = step(hintFor(puzzle, state));
    expect(found.moves).toBeDefined();
    expect(found.moves!.length).toBe(found.cells.length);
  });

  /**
   * Following every hint must finish the puzzle. If it stalls, there is a position the
   * app can lead somebody into and then abandon.
   */
  it('always leads to a finished puzzle if followed', () => {
    for (const picture of ['heart', 'house', 'tree']) {
      const { puzzle } = open(picture);
      let state = pictureLogic.start(puzzle);
      for (let guard = 0; guard < 400; guard++) {
        const hint = hintFor(puzzle, state);
        if (hint.kind === 'done') break;
        const moves = step(hint).moves ?? [];
        expect(moves.length).toBeGreaterThan(0);
        state = play(puzzle, state, moves);
      }
      expect(pictureLogic.isSolved(puzzle, state)).toBe(true);
    }
  });

  it('does the same on a generated puzzle at every difficulty', () => {
    for (const tier of [1, 2, 3]) {
      const made = makePuzzle({ rows: 10, cols: 10, tier, seed: `hint${tier}` });
      const puzzle: PicturePuzzle = {
        rows: 10,
        cols: 10,
        title: 'test',
        tierUsed: made.tierUsed,
        solution: made.solution,
        rowClues: made.rowClues,
        colClues: made.colClues,
      };
      let state = pictureLogic.start(puzzle);
      for (let guard = 0; guard < 2000; guard++) {
        const hint = hintFor(puzzle, state);
        if (hint.kind === 'done') break;
        state = play(puzzle, state, step(hint).moves ?? []);
      }
      expect(pictureLogic.isSolved(puzzle, state)).toBe(true);
    }
  });

  describe('when the board has gone wrong', () => {
    /**
     * The most valuable hint there is, and the one a child cannot get by staring: the
     * mistake is usually nowhere near where they are looking.
     *
     * It must also come *first*. Offering a deduction to somebody whose board already
     * contradicts the clues is deducing from a false premise and sending them further
     * wrong.
     */
    it('says so rather than deducing from a false premise', () => {
      const { puzzle, state } = open();
      // Row 0 of the heart is [1,1] — filling all five cannot be right.
      let wrong = state;
      for (let col = 0; col < 5; col++) {
        wrong = pictureLogic.apply(puzzle, wrong, { col, row: 0, mark: 'filled' })!;
      }
      const hint = hintFor(puzzle, wrong);
      expect(hint.kind).toBe('wrong');
      if (hint.kind !== 'wrong') throw new Error('expected a contradiction');
      // The whole of row 1, named as the cells it is: five of them, all on row 0.
      expect(hint.look.length).toBe(5);
      expect(hint.look.every((c) => c.row === 0)).toBe(true);
    });

    /** A square crossed in error is as contradictory as one filled in error, and harder
     * to spot — so it has to be caught too. */
    it('catches a wrongly crossed square as well as a wrongly filled one', () => {
      const { puzzle, state } = open();
      // Row 1 is a run of 5, so crossing any of it out is impossible.
      const wrong = pictureLogic.apply(puzzle, state, { col: 2, row: 1, mark: 'crossed' })!;
      const hint = hintFor(puzzle, wrong);
      expect(hint.kind).toBe('wrong');
    });

    /**
     * It names the line, never the square. Pointing at the square is surrender dressed up
     * as help; naming the line hands back a problem small enough to re-check.
     */
    it('names the line and not the square', () => {
      const { puzzle, state } = open();
      let wrong = state;
      for (let col = 0; col < 5; col++) {
        wrong = pictureLogic.apply(puzzle, wrong, { col, row: 0, mark: 'filled' })!;
      }
      const hint = hintFor(puzzle, wrong);
      if (hint.kind !== 'wrong') throw new Error(`expected "wrong", got "${hint.kind}"`);
      expect(hint.look.length).toBe(5);
      expect(hint).not.toHaveProperty('cells');
      expect(hint.why).toMatch(/row 1/);
      // And it does not quietly tell them the answer in the prose.
      expect(hint.why).not.toMatch(/square \d+|column \d+ and/);
    });

    /** The check never looks at the answer, so it cannot leak it. */
    it('works without reference to the solution', () => {
      const { puzzle, state } = open();
      // A puzzle whose stored solution has been replaced by rubbish still gets the same
      // verdict, because the check is against the clues and not against the answer.
      const noSolution: PicturePuzzle = { ...puzzle, solution: puzzle.solution.map(() => false) };
      let wrong = state;
      for (let col = 0; col < 5; col++) {
        wrong = pictureLogic.apply(puzzle, wrong, { col, row: 0, mark: 'filled' })!;
      }
      expect(hintFor(noSolution, wrong).kind).toBe('wrong');
    });
  });

  it('says it is finished when it is', () => {
    const { puzzle } = open();
    let state = pictureLogic.start(puzzle);
    for (let i = 0; i < puzzle.solution.length; i++) {
      if (!puzzle.solution[i]) continue;
      state = pictureLogic.apply(puzzle, state, {
        col: i % puzzle.cols,
        row: Math.floor(i / puzzle.cols),
        mark: 'filled',
      })!;
    }
    expect(pictureLogic.isSolved(puzzle, state)).toBe(true);
    const hint = hintFor(puzzle, state);
    expect(hint.kind === 'done' || hint.kind === 'step').toBe(true);
  });
});
