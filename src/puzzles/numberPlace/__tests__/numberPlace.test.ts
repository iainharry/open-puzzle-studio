import { describe, expect, it } from 'vitest';
import { GLYPH_SHAPES, numberPlace, type PlacePuzzle, type PlaceState } from '../index.js';
import { EMPTY } from '../solver.js';
import { buildScript } from '../../../shell/demo.js';

function open(size = 4, tier = 'gentle', glyphs: 'digits' | 'shapes' = 'digits') {
  const spec = numberPlace.normalise({ size, tier, seed: 'test', glyphs });
  const puzzle = numberPlace.generate(spec);
  return { spec, puzzle, state: numberPlace.start(puzzle) };
}

/** The first square the player is allowed to touch. */
function firstBlank(puzzle: PlacePuzzle): { col: number; row: number } {
  const i = puzzle.givens.findIndex((g) => !g);
  return { col: i % puzzle.size, row: Math.floor(i / puzzle.size) };
}

function firstGiven(puzzle: PlacePuzzle): { col: number; row: number } {
  const i = puzzle.givens.findIndex((g) => g);
  return { col: i % puzzle.size, row: Math.floor(i / puzzle.size) };
}

describe('the puzzle it generates', () => {
  it('is the same puzzle for the same spec, on every device and forever', () => {
    const a = numberPlace.generate({ size: 6, tier: 'steady', seed: 'xyz', glyphs: 'digits' });
    const b = numberPlace.generate({ size: 6, tier: 'steady', seed: 'xyz', glyphs: 'digits' });
    expect(a.solution).toEqual(b.solution);
    expect(a.givens).toEqual(b.givens);
  });

  it('never shows a number that is not the answer', () => {
    const { puzzle } = open(9, 'steady');
    const start = numberPlace.start(puzzle);
    for (let i = 0; i < puzzle.solution.length; i++) {
      if (puzzle.givens[i]) expect(start.cells[i]).toBe(puzzle.solution[i]);
      else expect(start.cells[i]).toBe(EMPTY);
    }
  });

  it('knows the box shape that goes with each size', () => {
    expect(open(4).puzzle.boxRows).toBe(2);
    expect(open(4).puzzle.boxCols).toBe(2);
    expect(open(6).puzzle.boxRows).toBe(2);
    expect(open(6).puzzle.boxCols).toBe(3);
    expect(open(9).puzzle.boxCols).toBe(3);
  });
});

describe('what a player may and may not do', () => {
  /**
   * **The one rule the rest of the module leans on.** Everything else — the renderer, the
   * solver, the hint, the broken-board check — reads one array of values and does not care
   * which numbers the puzzle put there. That is only safe because this is the single gate.
   */
  it('refuses to change a number the puzzle gave you', () => {
    const { puzzle, state } = open();
    const given = firstGiven(puzzle);
    expect(numberPlace.apply(puzzle, state, { ...given, value: 1 })).toBeNull();
    expect(numberPlace.apply(puzzle, state, { ...given, value: EMPTY })).toBeNull();
    // And a press on one does not even produce a move to refuse.
    expect(numberPlace.hit(puzzle, state, given, 'v1')).toBeNull();
    expect(numberPlace.hit(puzzle, state, given, 'rub')).toBeNull();
  });

  it('refuses a number the board does not have, and a move that changes nothing', () => {
    const { puzzle, state } = open(4);
    const blank = firstBlank(puzzle);
    expect(numberPlace.apply(puzzle, state, { ...blank, value: 5 })).toBeNull();
    expect(numberPlace.apply(puzzle, state, { ...blank, value: -1 })).toBeNull();
    expect(numberPlace.apply(puzzle, state, { ...blank, value: EMPTY })).toBeNull();
    expect(numberPlace.apply(puzzle, state, { col: 99, row: 0, value: 1 })).toBeNull();
  });

  /**
   * A press on a square that already holds this number clears it. Two taps to undo one is
   * how a pencil works, and it is the only way to empty a square without changing tool —
   * which matters on a tablet, where changing tool is a trip to the toolbar.
   */
  it('clears a square pressed twice with the same number', () => {
    const { puzzle, state } = open();
    const blank = firstBlank(puzzle);
    const first = numberPlace.hit(puzzle, state, blank, 'v3')!;
    expect(first.value).toBe(3);
    const after = numberPlace.apply(puzzle, state, first)!;
    expect(numberPlace.hit(puzzle, after, blank, 'v3')!.value).toBe(EMPTY);
    // A different number replaces it rather than clearing it.
    expect(numberPlace.hit(puzzle, after, blank, 'v2')!.value).toBe(2);
  });

  it('rubs out, and says nothing about an already empty square', () => {
    const { puzzle, state } = open();
    const blank = firstBlank(puzzle);
    expect(numberPlace.hit(puzzle, state, blank, 'rub')).toBeNull();
    const filled = numberPlace.apply(puzzle, state, { ...blank, value: 2 })!;
    expect(numberPlace.hit(puzzle, filled, blank, 'rub')!.value).toBe(EMPTY);
  });

  it('ignores a tool it does not have', () => {
    const { puzzle, state } = open(4);
    const blank = firstBlank(puzzle);
    expect(numberPlace.hit(puzzle, state, blank, 'v9')).toBeNull();
    expect(numberPlace.hit(puzzle, state, blank, 'fill')).toBeNull();
  });
});

describe('finishing, and getting there', () => {
  it('is solved only by the right answer', () => {
    const { puzzle } = open();
    const solved: PlaceState = { cells: [...puzzle.solution] };
    expect(numberPlace.isSolved(puzzle, solved)).toBe(true);
    expect(numberPlace.isSolved(puzzle, numberPlace.start(puzzle))).toBe(false);

    // Full, legal-looking, and one square wrong: still not solved.
    const nearly = [...puzzle.solution];
    const i = puzzle.givens.findIndex((g) => !g);
    nearly[i] = (nearly[i]! % puzzle.size) + 1;
    expect(numberPlace.isSolved(puzzle, { cells: nearly })).toBe(false);
  });

  /**
   * Progress counts the work, not the board. Counting the givens would start a 9x9 at
   * roughly a third done before anybody had touched it, which is flattering and useless.
   */
  it('starts at nothing however many numbers were given', () => {
    for (const size of [4, 6, 9]) {
      const { puzzle, state } = open(size);
      expect(numberPlace.progress(puzzle, state)).toBe(0);
      expect(numberPlace.progress(puzzle, { cells: [...puzzle.solution] })).toBe(1);
    }
  });

  it('never goes up for a board going wrong', () => {
    const { puzzle, state } = open(6);
    const blanks = puzzle.givens.flatMap((g, i) => (g ? [] : [i]));
    const wrong = [...state.cells];
    for (const i of blanks.slice(0, 3)) {
      wrong[i] = (puzzle.solution[i]! % puzzle.size) + 1;
    }
    expect(numberPlace.progress(puzzle, { cells: wrong })).toBe(0);
  });
});

describe('what it tells the shell to draw', () => {
  it('shades the squares the puzzle fixed, and draws them heavier', () => {
    const { puzzle, state } = open(6);
    const scene = numberPlace.layout(puzzle, state);
    expect(scene.marks.length).toBe(36);
    const shaded = scene.marks.filter((m) => m === 'shaded').length;
    expect(shaded).toBe(puzzle.givens.filter(Boolean).length);
    expect(scene.labels.length).toBe(shaded);
    expect(scene.labels.every((l) => l.strong === true)).toBe(true);
  });

  it('marks what the player wrote as theirs, not as the puzzle', () => {
    const { puzzle, state } = open(4);
    const blank = firstBlank(puzzle);
    const after = numberPlace.apply(puzzle, state, { ...blank, value: 1 })!;
    const scene = numberPlace.layout(puzzle, after);
    const mine = scene.labels.find((l) => l.col === blank.col && l.row === blank.row)!;
    expect(mine.text).toBe('1');
    expect(mine.strong).toBeUndefined();
  });

  /** The reason `band` stopped being a single number: a 6x6's boxes are 2 by 3. */
  it('bands the grid by the box, which is not always square', () => {
    expect(numberPlace.layout(...asArgs(open(6))).band).toEqual({ col: 3, row: 2 });
    expect(numberPlace.layout(...asArgs(open(9))).band).toEqual({ col: 3, row: 3 });
    expect(numberPlace.layout(...asArgs(open(4))).band).toEqual({ col: 2, row: 2 });
  });

  it('needs no margin, having no clues outside the grid', () => {
    const scene = numberPlace.layout(...asArgs(open(6)));
    expect(scene.margin).toEqual({ left: 0, top: 0 });
  });
});

function asArgs(o: { puzzle: PlacePuzzle; state: PlaceState }): [PlacePuzzle, PlaceState] {
  return [o.puzzle, o.state];
}

describe('shapes instead of numbers', () => {
  it('draws shapes and names its tools with them', () => {
    const { puzzle, state } = open(4, 'gentle', 'shapes');
    const scene = numberPlace.layout(puzzle, state);
    for (const label of scene.labels) {
      expect(GLYPH_SHAPES).toContain(label.text);
    }
    const tools = numberPlace.tools(puzzle);
    expect(tools.slice(0, 4).map((t) => t.name)).toEqual(GLYPH_SHAPES.slice(0, 4));
  });

  it('says the shape in its hints, not the number behind it', () => {
    const { puzzle, state } = open(4, 'gentle', 'shapes');
    const hint = numberPlace.hint!(puzzle, state, 3);
    if (hint.kind !== 'step') throw new Error(`expected a step, got "${hint.kind}"`);
    expect(GLYPH_SHAPES.some((g) => hint.step.why.includes(g))).toBe(true);
    expect(hint.step.why).not.toMatch(/\b[1-9]\b/);
  });

  /**
   * Nine shapes a child can tell apart at a glance do not exist, so a 9x9 is numbers
   * whatever was asked for — which is a link arriving with a size changed after the fact,
   * not somebody being difficult.
   */
  it('refuses shapes on a board too big for them', () => {
    expect(numberPlace.normalise({ size: 9, glyphs: 'shapes', seed: 'a' }).glyphs).toBe('digits');
    expect(numberPlace.normalise({ size: 6, glyphs: 'shapes', seed: 'a' }).glyphs).toBe('shapes');
  });
});

describe('the toolbar it asks for', () => {
  /** The reason `tools` stopped being a constant: there are four here and nine on a 9x9. */
  it('offers one tool per number, and a rubber', () => {
    expect(numberPlace.tools(open(4).puzzle).map((t) => t.id)).toEqual([
      'v1',
      'v2',
      'v3',
      'v4',
      'rub',
    ]);
    expect(numberPlace.tools(open(9).puzzle).length).toBe(10);
  });

  /** Dragging a 7 across a board scatters sevens nobody meant to put there. */
  it('does not drag', () => {
    expect(numberPlace.tools(open(6).puzzle).some((t) => t.drag === true)).toBe(false);
  });

  it('explains every tool, and says the givens cannot be rubbed out', () => {
    for (const tool of numberPlace.tools(open(6).puzzle)) {
      expect(tool.help.length).toBeGreaterThan(20);
    }
    const rub = numberPlace.tools(open(6).puzzle).find((t) => t.id === 'rub')!;
    expect(rub.help).toMatch(/cannot be rubbed out/);
  });
});

describe('saving and reopening', () => {
  it('round-trips what the player did', () => {
    const { puzzle, state } = open(6);
    const blank = firstBlank(puzzle);
    const after = numberPlace.apply(puzzle, state, { ...blank, value: 2 })!;
    const text = numberPlace.serialise(after);
    expect(text.length).toBe(36);
    expect(numberPlace.deserialise(puzzle, text)).toEqual(after);
  });

  /**
   * A save that disagreed with the puzzle about which squares are fixed would be a board
   * the player could not finish and could not explain, so the puzzle wins.
   */
  it('puts the givens back whatever the save file says', () => {
    const { puzzle } = open(4);
    const rubbish = '.'.repeat(16);
    const restored = numberPlace.deserialise(puzzle, rubbish);
    for (let i = 0; i < puzzle.solution.length; i++) {
      if (puzzle.givens[i]) expect(restored.cells[i]).toBe(puzzle.solution[i]);
      else expect(restored.cells[i]).toBe(EMPTY);
    }
  });

  it('survives a save that has been damaged', () => {
    const { puzzle } = open(4);
    const restored = numberPlace.deserialise(puzzle, 'zz!!');
    expect(restored.cells.length).toBe(16);
    expect(restored.cells.every((v) => v === EMPTY || (v >= 1 && v <= 4))).toBe(true);
  });
});

describe('the code that shares it', () => {
  it('goes to text and back unchanged', () => {
    for (const size of [4, 6, 9]) {
      for (const glyphs of ['digits', 'shapes'] as const) {
        const spec = numberPlace.normalise({ size, tier: 'steady', seed: 'q7z', glyphs });
        expect(numberPlace.decode(numberPlace.encode(spec))).toEqual(spec);
      }
    }
  });

  it('says no to parts that are not ours', () => {
    expect(numberPlace.decode([])).toBeNull();
    expect(numberPlace.decode(['d', 'heart'])).toBeNull();
    expect(numberPlace.decode(['6', 'steady', 'n'])).toBeNull();
  });

  it('falls back rather than throwing on a nonsense spec', () => {
    const spec = numberPlace.normalise({ size: 77, tier: 'impossible', seed: 5 });
    expect(spec.size).toBe(6);
    expect(spec.tier).toBe('gentle');
    expect(spec.seed).toBe('5');
  });
});

describe('what it says about itself', () => {
  it('names the instance by what it turned out to be', () => {
    const { puzzle } = open(6, 'tricky');
    expect(numberPlace.title(puzzle)).toMatch(/^6×6 (Gentle|Steady|Tricky)$/);
    expect(numberPlace.title(open(4, 'gentle', 'shapes').puzzle)).toMatch(/shapes$/);
  });

  it('describes the difficulty it got, not the one asked for', () => {
    const { puzzle } = open(4, 'tricky');
    const described = numberPlace.describe(puzzle);
    expect(described.rating).toBe(numberPlace.title(puzzle).split(' ')[1]);
    expect(described.note.length).toBeGreaterThan(30);
    expect(described.progressNoun).toBe('the squares filled in');
  });

  /** Plain text, because the shell sets it as text and a module cannot inject markup. */
  it('explains itself in sentences and not in markup', () => {
    expect(numberPlace.instructions.length).toBeGreaterThan(2);
    for (const line of numberPlace.instructions) {
      expect(line.length).toBeGreaterThan(40);
      expect(line).not.toMatch(/[<>]/);
    }
  });

  it('offers choices the shell can render without knowing what they mean', () => {
    const ids = numberPlace.options().map((o) => o.id);
    expect(ids).toEqual(['size', 'tier', 'glyphs']);
    for (const choice of numberPlace.options()) {
      expect(choice.values.length).toBeGreaterThan(1);
      expect(choice.values.some((v) => v.value === choice.initial)).toBe(true);
      expect(choice.help.length).toBeGreaterThan(20);
    }
  });

  it('builds a spec from the choices as the shell would hand them back', () => {
    const spec = numberPlace.specFrom({ size: '9', tier: 'tricky', glyphs: 'shapes' }, 'abcd');
    expect(spec).toEqual({ size: 9, tier: 'tricky', seed: 'abcd', glyphs: 'digits' });
  });
});

describe('hints', () => {
  it('offers a step on a fresh board, with the moves to carry it out', () => {
    const { puzzle, state } = open(6, 'steady');
    const hint = numberPlace.hint!(puzzle, state, 3);
    if (hint.kind !== 'step') throw new Error(`expected a step, got "${hint.kind}"`);
    expect(hint.step.moves!.length).toBe(1);
    expect(hint.step.look!.length).toBeGreaterThan(1);
    expect(hint.step.where!.length).toBeGreaterThan(2);
    // And the move it suggests is the right answer, which is the only version of this
    // feature worth having.
    const move = hint.step.moves![0] as { col: number; row: number; value: number };
    expect(move.value).toBe(puzzle.solution[move.row * puzzle.size + move.col]);
  });

  /**
   * A wrong board is reported as wrong, and reported **first**. Offering a deduction to
   * somebody whose board already contradicts itself is deducing from a false premise.
   */
  it('reports a board that cannot be right rather than deducing from it', () => {
    const { puzzle, state } = open(6);
    // Copy a given into another square of the same row: a repeat, and unmissable once
    // somebody is told which row to look at.
    const row = Array.from({ length: puzzle.size }, (_, c) => c);
    let found: { col: number; row: number; value: number } | null = null;
    for (let r = 0; r < puzzle.size && !found; r++) {
      const given = row.find((c) => puzzle.givens[r * puzzle.size + c]);
      const blank = row.find((c) => !puzzle.givens[r * puzzle.size + c]);
      if (given === undefined || blank === undefined) continue;
      found = { col: blank, row: r, value: puzzle.solution[r * puzzle.size + given]! };
    }
    const wrong = numberPlace.apply(puzzle, state, found!)!;
    const hint = numberPlace.hint!(puzzle, wrong, 3);
    expect(hint.kind).toBe('wrong');
    if (hint.kind !== 'wrong') throw new Error('expected a contradiction');
    expect(hint.look.length).toBe(puzzle.size);
    expect(hint.why).toMatch(/there can only ever be one/);
    // It names the line, never the square.
    expect(hint).not.toHaveProperty('cells');
  });

  it('says so when there is nothing left to do', () => {
    const { puzzle } = open(4);
    const hint = numberPlace.hint!(puzzle, { cells: [...puzzle.solution] }, 3);
    expect(hint.kind).toBe('done');
  });
});

describe('the demonstration', () => {
  /**
   * The demonstration runs at tier 1 only and is capped at ten steps, so the board it is
   * given has to be *reachable* that way — a demo that gets stuck has a child watching the
   * app give up.
   *
   * This board has eleven squares to fill and the demo does ten of them, which leaves
   * exactly one for whoever is watching. That is the best possible ending for a
   * demonstration and it is deterministic — the seed is fixed — so it is asserted rather
   * than admired: a change to generation that spoils it fails here.
   */
  it('works a small fixed board down to its last square', () => {
    const spec = numberPlace.demoSpec!();
    expect(spec.size).toBe(4);
    const puzzle = numberPlace.generate(spec);
    expect(puzzle.givens.filter((g) => !g).length).toBe(11);

    const { beats } = buildScript(numberPlace, puzzle);
    expect(beats.length).toBe(10);
    let state = numberPlace.start(puzzle);
    for (const beat of beats) {
      expect(beat.caption.length).toBeGreaterThan(30);
      expect(beat.moves.length).toBe(1);
      for (const move of beat.moves) {
        state = numberPlace.apply(puzzle, state, move as never) ?? state;
      }
    }
    expect(state.cells.filter((v) => v === EMPTY).length).toBe(1);
    // Every square it filled in is right: a demonstration of a wrong move is worse than
    // no demonstration.
    for (let i = 0; i < state.cells.length; i++) {
      if (state.cells[i] !== EMPTY) expect(state.cells[i]).toBe(puzzle.solution[i]);
    }
  });

  it('is the same board every time, so a teacher can talk about it', () => {
    const a = numberPlace.generate(numberPlace.demoSpec!());
    const b = numberPlace.generate(numberPlace.demoSpec!());
    expect(a.givens).toEqual(b.givens);
    expect(a.solution).toEqual(b.solution);
  });
});

describe('the printed sheet', () => {
  /**
   * **The one that matters.** The sister project shipped a printable sheet that drew the
   * answer into the frame and passed four assertions, because each checked that something
   * had been drawn rather than what it showed.
   *
   * Here the dangerous version is a sheet that prints the player's working, or the answer.
   * `printable()` takes no state, so this counts what is in the scene: exactly as many
   * numbers as there are givens, and not one more.
   */
  it('shows the givens and nothing else, whatever the player has done', () => {
    const { puzzle, state } = open(9, 'steady');
    const blanks = puzzle.givens.flatMap((g, i) => (g ? [] : [i]));
    let played: PlaceState = state;
    for (const i of blanks.slice(0, 20)) {
      played =
        numberPlace.apply(puzzle, played, {
          col: i % puzzle.size,
          row: Math.floor(i / puzzle.size),
          value: puzzle.solution[i]!,
        }) ?? played;
    }
    expect(numberPlace.serialise(played)).not.toBe(numberPlace.serialise(state));

    const sheet = numberPlace.printable!(puzzle);
    expect(sheet.labels.length).toBe(puzzle.givens.filter(Boolean).length);
    expect(sheet.labels.every((l) => l.strong === true)).toBe(true);
  });
});
