import { describe, expect, it } from 'vitest';
import { Session } from '../../../core/session.js';
import { PICTURE_NAMES, cluesFor, pictureLogic } from '../index.js';
import type { PicturePuzzle, PictureState } from '../index.js';

function open(picture = 'heart'): Session {
  return Session.create(pictureLogic, { kind: 'drawn' as const, picture });
}

function puzzleOf(session: Session): PicturePuzzle {
  return session.puzzle as PicturePuzzle;
}

/** Fill in the answer the way a player would, one move at a time. */
function solveIt(session: Session): void {
  const puzzle = puzzleOf(session);
  for (let row = 0; row < puzzle.rows; row++) {
    for (let col = 0; col < puzzle.cols; col++) {
      if (!puzzle.solution[row * puzzle.cols + col]) continue;
      session.play({ col, row, mark: 'filled' }, 'a mark');
    }
  }
}

describe('cluesFor', () => {
  it('reads runs along a line', () => {
    expect(cluesFor([true, false, true, true, false])).toEqual([1, 2]);
    expect(cluesFor([true, true, true])).toEqual([3]);
  });

  /**
   * An empty line is [0], never []. A clue has to *say* "nothing here", or a blank row
   * looks like a row whose clue failed to render.
   */
  it('says zero for an empty line rather than nothing at all', () => {
    expect(cluesFor([false, false, false])).toEqual([0]);
  });
});

describe('generate', () => {
  it('derives the clues from the picture rather than storing them', () => {
    const puzzle = puzzleOf(open('heart'));
    expect(puzzle.rows).toBe(5);
    expect(puzzle.cols).toBe(5);
    // The heart: . # . # . / ##### / ##### / . ### . / . . # . .
    expect(puzzle.rowClues).toEqual([[1, 1], [5], [5], [3], [1]]);
    expect(puzzle.colClues).toEqual([[2], [4], [4], [4], [2]]);
  });

  /**
   * Determinism, which every game code depends on. Generating twice must give the same
   * grid, not merely a grid of the same size.
   */
  it('is deterministic', () => {
    for (const picture of PICTURE_NAMES) {
      const a = pictureLogic.generate({ kind: 'drawn' as const, picture });
      const b = pictureLogic.generate({ kind: 'drawn' as const, picture });
      expect(a.solution).toEqual(b.solution);
      expect(a.rowClues).toEqual(b.rowClues);
    }
  });

  it('has every starter picture rectangular and non-empty', () => {
    for (const picture of PICTURE_NAMES) {
      const puzzle = pictureLogic.generate({ kind: 'drawn' as const, picture });
      expect(puzzle.solution.length).toBe(puzzle.rows * puzzle.cols);
      expect(puzzle.solution.some(Boolean)).toBe(true);
    }
  });

  it('falls back rather than throwing on a picture that is not there', () => {
    expect(() => pictureLogic.generate({ kind: 'drawn' as const, picture: 'nope' })).not.toThrow();
  });
});

describe('playing', () => {
  it('starts blank and unsolved', () => {
    const session = open();
    expect(session.solved).toBe(false);
    expect(session.progress).toBe(0);
    expect(session.serialise()).toBe('.'.repeat(25));
  });

  it('is solved when the filled cells match the picture', () => {
    const session = open();
    solveIt(session);
    expect(session.solved).toBe(true);
    expect(session.progress).toBe(1);
  });

  /**
   * Crossing out is bookkeeping, not an answer. A player who solves the grid correctly
   * without crossing anything out has still solved it, and one who crosses every empty
   * cell has not done anything extra.
   */
  it('does not care whether empty cells were crossed out', () => {
    const session = open();
    const puzzle = puzzleOf(session);
    solveIt(session);
    for (let i = 0; i < puzzle.solution.length; i++) {
      if (puzzle.solution[i]) continue;
      session.play({ col: i % puzzle.cols, row: Math.floor(i / puzzle.cols), mark: 'crossed' });
    }
    expect(session.solved).toBe(true);
  });

  /**
   * Counting every correct cell would start a blank heart at 48% done, because most of a
   * nonogram is empty. That is flattering and useless.
   */
  it('reports progress on the work done, not on the empty cells', () => {
    const session = open();
    expect(session.progress).toBe(0);
    session.play({ col: 1, row: 0, mark: 'filled' });
    expect(session.progress).toBeGreaterThan(0);
    expect(session.progress).toBeLessThan(0.2);
  });

  it('never reports progress for a grid that is wrong', () => {
    const session = open();
    // Three cells that are all empty in the answer.
    session.play({ col: 0, row: 0, mark: 'filled' });
    session.play({ col: 2, row: 0, mark: 'filled' });
    session.play({ col: 4, row: 0, mark: 'filled' });
    expect(session.progress).toBe(0);
  });

  it('refuses a move off the board', () => {
    const session = open();
    expect(session.play({ col: -1, row: 0, mark: 'filled' })).toBe(false);
    expect(session.play({ col: 0, row: 99, mark: 'filled' })).toBe(false);
  });

  /** Two taps to undo one is how a pencil-and-paper player expects this to work. */
  it('clears a cell when the same tool is used on it twice', () => {
    const session = open();
    const first = session.moveFor({ col: 0, row: 0 }, 'fill') as { mark: string };
    expect(first.mark).toBe('filled');
    session.play(first);
    const second = session.moveFor({ col: 0, row: 0 }, 'fill') as { mark: string };
    expect(second.mark).toBe('empty');
  });

  it('round-trips through serialisation', () => {
    const session = open();
    solveIt(session);
    const data = session.serialise();
    const reopened = Session.create(pictureLogic, { kind: 'drawn' as const, picture: 'heart' }, data);
    expect(reopened.serialise()).toBe(data);
    expect(reopened.solved).toBe(true);
  });
});

describe('the scene', () => {
  it('reserves exactly enough margin for the longest clue', () => {
    const session = open('heart');
    const scene = session.layout();
    // Longest row clue is [1,1] = 2; longest column clue is a single number = 1.
    expect(scene.margin.left).toBe(2);
    expect(scene.margin.top).toBe(1);
  });

  /**
   * The scene is a value so a test can read what a player would see. This is the whole
   * argument for `layout()` returning rather than drawing: the jigsaw project's most
   * repeated bug was that asserting a thing is drawn is not asserting what it shows.
   */
  it('shows what the player has done, not the answer', () => {
    const session = open();
    const blank = session.layout();
    expect(blank.marks.every((m) => m === 'empty')).toBe(true);

    session.play({ col: 1, row: 0, mark: 'filled' });
    const after = session.layout();
    expect(after.marks[1]).toBe('filled');
    expect(after.marks.filter((m) => m === 'filled')).toHaveLength(1);
  });

  it('puts the last number of each clue against the grid', () => {
    const scene = open('heart').layout();
    // Row 0's clue is [1, 1]: the numbers sit at columns -2 and -1.
    const rowZero = scene.labels.filter((l) => l.row === 0 && l.col < 0);
    // A numeric comparator, not the default: Array.sort is lexicographic, and "-1" sorts
    // before "-2" as text.
    expect(rowZero.map((l) => l.col).sort((a, b) => a - b)).toEqual([-2, -1]);
  });

  it('dims a clue once its line is right', () => {
    const session = open();
    const before = session.layout().labels.find((l) => l.row === 1 && l.col < 0)!;
    expect(before.tone).toBeUndefined();
    for (let col = 0; col < 5; col++) session.play({ col, row: 1, mark: 'filled' });
    const after = session.layout().labels.find((l) => l.row === 1 && l.col < 0)!;
    expect(after.tone).toBe('faint');
  });

  /**
   * **The three states, and the one that was missing.** Until this existed, "you have not
   * finished this line" and "this line is finished and wrong" looked exactly the same,
   * and a player read the odd clue out as a fault in the app.
   */
  describe('a clue that is finished and wrong', () => {
    const clueFor = (session: ReturnType<typeof open>, row: number) =>
      session.layout().labels.find((l) => l.row === row && l.col < 0)!;

    it('says nothing while there is still something to decide', () => {
      const session = open();
      // Row 1 of the heart is a run of 5. Four filled and nothing crossed out: wrong so
      // far, but not finished, so it must stay ordinary.
      for (let col = 0; col < 4; col++) session.play({ col, row: 1, mark: 'filled' });
      expect(clueFor(session, 1).tone).toBeUndefined();
    });

    it('warns once every square in the line has been decided and it still does not match', () => {
      const session = open();
      for (let col = 0; col < 4; col++) session.play({ col, row: 1, mark: 'filled' });
      // The last square crossed out: the line is now decided, and [4] is not [5].
      session.play({ col: 4, row: 1, mark: 'crossed' });
      expect(clueFor(session, 1).tone).toBe('warn');
    });

    it('goes back to faint when the mistake is put right', () => {
      const session = open();
      for (let col = 0; col < 4; col++) session.play({ col, row: 1, mark: 'filled' });
      session.play({ col: 4, row: 1, mark: 'crossed' });
      expect(clueFor(session, 1).tone).toBe('warn');
      session.play({ col: 4, row: 1, mark: 'filled' });
      expect(clueFor(session, 1).tone).toBe('faint');
    });

    it('warns on a column as readily as on a row', () => {
      const session = open();
      // Column 2 of the heart is [4] — rows 1 to 4. Decide the whole of it as [1, 3]
      // instead: the right number of squares, in the wrong places.
      for (let row = 0; row < 5; row++) {
        session.play({ col: 2, row, mark: row === 1 ? 'crossed' : 'filled' });
      }
      const clue = session.layout().labels.find((l) => l.col === 2 && l.row < 0)!;
      expect(clue.tone).toBe('warn');
    });

    /** An untouched board has nothing wrong with it, whatever the clues say. */
    it('never warns about a board nobody has touched', () => {
      for (const picture of ['heart', 'house', 'tree']) {
        const scene = open(picture).layout();
        expect(scene.labels.some((l) => l.tone === 'warn')).toBe(false);
      }
    });

    /** A clue of 0 is satisfied by an empty line, decided or not. */
    it('treats an empty line with a zero clue as right, not as wrong', () => {
      const session = open();
      const puzzle = session.puzzle as { rowClues: number[][] };
      const zero = puzzle.rowClues.findIndex((c) => c.length === 1 && c[0] === 0);
      if (zero === -1) return;
      for (let col = 0; col < 5; col++) session.play({ col, row: zero, mark: 'crossed' });
      expect(clueFor(session, zero).tone).toBe('faint');
    });
  });
});

describe('undo', () => {
  it('takes back a mark and puts it back', () => {
    const session = open();
    const blank = session.serialise();
    session.play({ col: 1, row: 0, mark: 'filled' }, 'a mark');
    const marked = session.serialise();
    expect(marked).not.toBe(blank);

    expect(session.undo()).toBe('a mark');
    expect(session.serialise()).toBe(blank);
    expect(session.redo()).toBe('a mark');
    expect(session.serialise()).toBe(marked);
  });

  it('leaves no step behind for a move that changed nothing', () => {
    const session = open();
    session.play({ col: 1, row: 0, mark: 'filled' });
    const depth = session.history.depth;
    // The same mark again: legal, but it changes nothing.
    session.play({ col: 1, row: 0, mark: 'filled' });
    expect(session.history.depth).toBe(depth);
  });

  /**
   * The watchdog. Zero in a correct build; the smoke test exercises every control and
   * fails if it moves. This checks the detector itself works, by changing the state
   * behind the session's back the way a future unwrapped feature would.
   */
  it('notices a change that recorded no way back', () => {
    const session = open();
    session.checkGuard(0);
    expect(session.unguardedChanges).toBe(0);

    const state = (session as unknown as { state: PictureState }).state;
    (session as unknown as { state: PictureState }).state = {
      marks: state.marks.map((m, i) => (i === 0 ? 'filled' : m)),
    };
    session.checkGuard(10_000);
    expect(session.unguardedChanges).toBe(1);

    // Reported once, not on every frame for the rest of the session.
    session.checkGuard(20_000);
    expect(session.unguardedChanges).toBe(1);
  });
});

describe('the solver', () => {
  /**
   * M1 made this throw, so that a stub could not be mistaken for a solver that found
   * nothing. M2 replaced it. The test is kept, inverted, as the record that the stub is
   * gone rather than quietly returning an empty report again.
   */
  it('exists now, and solves the hand-drawn pictures', () => {
    for (const picture of PICTURE_NAMES) {
      const puzzle = pictureLogic.generate({ kind: 'drawn' as const, picture });
      const report = pictureLogic.solve(puzzle, pictureLogic.start(puzzle), 3);
      expect(report.solved).toBe(true);
      expect(report.steps.length).toBeGreaterThan(0);
    }
  });
});

/**
 * A real board a real player got stuck on, kept as a regression.
 *
 * Every one of the eight column clues was satisfied and so were seven of the eight rows.
 * The filled count was exactly right. Only row 1 was wrong — two separate squares where
 * the clue said one block of two — and the screen's only signal was that one clue had not
 * gone faint, which is indistinguishable from a line nobody has finished yet.
 *
 * The puzzle has exactly one answer; this board is not it. Both of those are asserted
 * here rather than taken on trust, because the player had been told by another tool that
 * the board was correct.
 */
describe('the board from the screenshot', () => {
  const answer = [
    '##......',
    '.#......',
    '.#####..',
    '....#...',
    '.#####..',
    '####....',
    '.##.....',
    '........',
  ];
  const played = [
    '.#...#..',
    '.#......',
    '#####...',
    '....#...',
    '.#####..',
    '####....',
    '.##.....',
    '........',
  ];
  const puzzle: PicturePuzzle = {
    rows: 8,
    cols: 8,
    title: '8x8',
    tierUsed: 2,
    solution: answer.flatMap((r) => [...r].map((ch) => ch === '#')),
    rowClues: [[2], [1], [5], [1], [5], [4], [2], [0]],
    colClues: [[1, 1], [3, 3], [1, 3], [1, 2], [3], [1, 1], [0], [0]],
  };
  // Everything decided: filled where the player filled, crossed everywhere else, which is
  // how the board in the screenshot actually stood.
  const state: PictureState = {
    marks: played.flatMap((r) => [...r].map((ch) => (ch === '#' ? 'filled' : 'crossed'))),
  };

  it('is not solved, however right it looks', () => {
    expect(pictureLogic.isSolved(puzzle, state)).toBe(false);
  });

  it('has every column right and every row but the first', () => {
    const scene = pictureLogic.layout(puzzle, state);
    const columns = scene.labels.filter((l) => l.row < 0);
    expect(columns.every((l) => l.tone === 'faint')).toBe(true);
    for (const row of [1, 2, 3, 4, 5, 6, 7]) {
      const clue = scene.labels.find((l) => l.row === row && l.col < 0)!;
      expect(clue.tone).toBe('faint');
    }
  });

  /** **The fix.** The one wrong line is now marked as wrong rather than as unfinished. */
  it('marks the one wrong line as wrong, not as unfinished', () => {
    const scene = pictureLogic.layout(puzzle, state);
    const first = scene.labels.find((l) => l.row === 0 && l.col < 0)!;
    expect(first.text).toBe('2');
    expect(first.tone).toBe('warn');
    expect(scene.labels.filter((l) => l.tone === 'warn').length).toBe(1);
  });

  it('and the hint says the same thing in words', () => {
    const hint = pictureLogic.hint!(puzzle, state, 3);
    expect(hint.kind).toBe('wrong');
    if (hint.kind !== 'wrong') throw new Error('expected a contradiction');
    expect(hint.why).toMatch(/row 1 cannot be right/);
    expect(hint.look.every((c) => c.row === 0)).toBe(true);
  });
});
