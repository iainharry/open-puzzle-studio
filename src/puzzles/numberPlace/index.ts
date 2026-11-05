/**
 * Number Place — a Latin square with boxes.
 *
 * Every row, every column and every box holds each number once. Called **Number Place** in
 * the app, which is the name it was published under in Dell Pencil Puzzles in 1979, and is
 * generic. *Sudoku* is a trademark of Nikoli in Japan, and while the puzzle itself is
 * unprotectable, a free classroom app has nothing to gain from arguing about a word. Simon
 * Tatham calls his "Solo" for the same reason.
 *
 * ## Why this is the second puzzle
 *
 * Not because the app needed a Sudoku — Tatham's Solo exists and is better at being one.
 * Because `PuzzleModule` was a bet made against one puzzle, and the only way to find out
 * where it was wrong was to write a second one that is **unlike** the first in the ways
 * that matter to an interface:
 *
 * - Its deductions are about boxes as often as lines, and a box is neither a row nor a
 *   column. That broke `SolveStep.line`.
 * - Its boxes are not square at 6x6, so a heavier grid line every *n* cells needed a
 *   different *n* across than down. That broke `Scene.band`.
 * - Its tools are its numbers, so there are four of them on a 4x4 and nine on a 9x9. That
 *   broke `tools` being a constant.
 * - Half its squares are put there by the puzzle and cannot be rubbed out. Nothing in the
 *   first puzzle had that idea, and `Mark` had no way to say it.
 *
 * Every one of those was invisible while there was one back end, because the shell was
 * quietly doing the nonogram's work for it. See `src/core/types.ts` for the full list.
 *
 * ## Shapes instead of numbers
 *
 * A four-year-old who cannot read numbers can still do a 4x4 Number Place, because the
 * puzzle is about *sameness and difference*, not arithmetic. So the values can be drawn as
 * shapes, and nothing else changes: the solver is handed a way to say a value and does not
 * care what it says. This is the counterpart of the sister project's outline puzzles for
 * early years, and it cost about fifteen lines.
 *
 * Shapes stop at 6x6. Nine shapes a child can tell apart at a glance, in silhouette, at
 * tablet size, do not exist — and offering nine that nearly work would be worse than
 * offering numbers.
 *
 * ## What is deliberately not here: pencil marks
 *
 * No way to note "this square could be a 3 or a 7". Adults solving a 9x9 want it. It is
 * not here, and the reason is an interface one rather than a laziness one: a note needs a
 * second sticky input mode alongside the chosen number, the shell has exactly one tool at
 * a time, and inventing that second mode now would mean designing it against this puzzle
 * alone — which is the mistake this whole milestone exists to undo. The children this app
 * is for play 4x4 and 6x6, where notes are not needed; an adult who wants them on a 9x9
 * can press Print and use a pencil. Recorded as a known limitation, with the design
 * question it raises, rather than quietly skipped.
 */

import type {
  Cell,
  Choice,
  Description,
  Label,
  Mark,
  PuzzleModule,
  SolveReport,
  Tier,
} from '../../core/types.js';
import {
  EMPTY,
  firstBrokenUnit,
  nextStep,
  solveGrid,
  type Board,
  type NameOf,
} from './solver.js';
import { SHAPES, makePuzzle, shapeFor, tierName, tierRank } from './generate.js';

export type Glyphs = 'digits' | 'shapes';

/** What identifies an instance. Small enough for a game code. */
export interface PlaceSpec {
  readonly size: number;
  /** A tier id: 'gentle' | 'steady' | 'tricky'. */
  readonly tier: string;
  readonly seed: string;
  readonly glyphs: Glyphs;
}

export interface PlacePuzzle extends Board {
  readonly glyphs: Glyphs;
  /** The hardest tier the solver needed. What the player is told, not what was asked for. */
  readonly tierUsed: number;
  readonly solution: readonly number[];
  /** True where the puzzle put the number there and the player cannot take it away. */
  readonly givens: readonly boolean[];
}

/**
 * The board as it stands, givens included.
 *
 * Givens are in the state as well as in the puzzle, which is a little redundant and is
 * worth it: the solver, the broken-board check and the renderer all want one array of
 * values, and the alternative is three places that each have to remember to merge two.
 * `apply` is the single gate that stops a given being changed.
 */
export interface PlaceState {
  readonly cells: readonly number[];
}

export interface PlaceMove {
  readonly col: number;
  readonly row: number;
  /** 0 rubs the square out. */
  readonly value: number;
}

/**
 * Shapes a child can tell apart in silhouette: circle, triangle, square, star, heart,
 * cross. Six, which is why shapes stop at 6x6.
 */
export const GLYPH_SHAPES: readonly string[] = [
  '●',
  '▲',
  '■',
  '★',
  '♥',
  '✚',
];

/** The most values that can be drawn as shapes. */
export const SHAPE_LIMIT = GLYPH_SHAPES.length;

const TIERS: readonly Tier[] = [
  { id: 'gentle', name: 'Gentle', rank: 1 },
  { id: 'steady', name: 'Steady', rank: 2 },
  { id: 'tricky', name: 'Tricky', rank: 3 },
];

/** How this puzzle says a value. Handed to the solver so its sentences read right. */
function nameOf(puzzle: PlacePuzzle): NameOf {
  if (puzzle.glyphs === 'shapes') {
    return (v) => GLYPH_SHAPES[v - 1] ?? String(v);
  }
  return String;
}

function at(size: number, col: number, row: number): number {
  return row * size + col;
}

function cellsOf(board: Board, indices: readonly number[]): Cell[] {
  return indices.map((i) => ({ col: i % board.size, row: Math.floor(i / board.size) }));
}

export const numberPlace: PuzzleModule<PlaceSpec, PlacePuzzle, PlaceMove, PlaceState> = {
  id: 'number-place',
  name: 'Number Place',
  blurb: 'Every row, column and box holds each number once.',
  tiers: TIERS,

  // --- Choosing one ----------------------------------------------------------

  options() {
    return [
      {
        id: 'size',
        label: 'Size',
        help: 'How big the board is. A 4 by 4 can be finished by a five-year-old; a 9 by 9 is the one adults know.',
        values: SHAPES.map((s) => ({
          value: String(s.size),
          label: `${s.size} × ${s.size}`,
        })),
        initial: '6',
      },
      {
        id: 'tier',
        label: 'Difficulty',
        help: 'How much working out it takes. A small board is always Gentle however hard you ask for, and the app says which it got.',
        values: TIERS.map((t) => ({ value: t.id, label: t.name })),
        initial: 'gentle',
      },
      {
        id: 'glyphs',
        label: 'Shown as',
        help: 'Shapes instead of numbers, for a child who cannot read numbers yet. Numbers only on the 9 by 9 — nine shapes nobody can tell apart is worse than nine numbers.',
        values: [
          { value: 'digits', label: 'Numbers' },
          { value: 'shapes', label: 'Shapes' },
        ],
        initial: 'digits',
      },
    ] satisfies readonly Choice[];
  },

  specFrom(chosen, seed) {
    return numberPlace.normalise({
      size: chosen['size'],
      tier: chosen['tier'],
      glyphs: chosen['glyphs'],
      seed,
    });
  },

  /**
   * Make sense of a spec from storage, a pasted link or an older version.
   *
   * The one coercion with a reason beyond tidiness: **shapes on a board bigger than six
   * become numbers**. A link asking for nine shapes is not malicious, it is somebody
   * changing the size after choosing shapes, and the honest answer is the puzzle they can
   * actually read.
   */
  normalise(raw) {
    const spec = (raw ?? {}) as Record<string, unknown>;
    const wanted = Number(spec['size']);
    const size = SHAPES.some((s) => s.size === wanted) ? wanted : 6;
    const tier = typeof spec['tier'] === 'string' && TIERS.some((t) => t.id === spec['tier'])
      ? spec['tier']
      : 'gentle';
    const asked = spec['glyphs'] === 'shapes' ? 'shapes' : 'digits';
    return {
      size,
      tier,
      seed: String(spec['seed'] ?? '1'),
      glyphs: size <= SHAPE_LIMIT ? asked : 'digits',
    };
  },

  encode(spec) {
    return [String(spec.size), spec.tier, spec.glyphs === 'shapes' ? 's' : 'n', spec.seed];
  },

  decode(parts) {
    const [size, tier, glyphs, seed] = parts;
    if (!size || !tier || !glyphs || !seed) return null;
    if (!/^\d+$/.test(size)) return null;
    return numberPlace.normalise({
      size: Number(size),
      tier,
      glyphs: glyphs === 's' ? 'shapes' : 'digits',
      seed,
    });
  },

  generate(raw) {
    const spec = numberPlace.normalise(raw);
    const shape = shapeFor(spec.size);
    const made = makePuzzle({ ...shape, tier: tierRank(spec.tier), seed: spec.seed });
    return {
      ...shape,
      glyphs: spec.glyphs,
      tierUsed: made.tierUsed,
      solution: made.solution,
      givens: made.start.map((v) => v !== EMPTY),
    };
  },

  // --- Playing it ------------------------------------------------------------

  start(puzzle) {
    return {
      cells: puzzle.solution.map((v, i) => (puzzle.givens[i] ? v : EMPTY)),
    };
  },

  /**
   * Pure, and **the one gate that protects a given**.
   *
   * Everything else — the renderer, the solver, the hint — reads one array of values and
   * does not care which numbers the puzzle put there. That is only safe because a move can
   * never change a given, so there is exactly one place to get this right rather than four.
   */
  apply(puzzle, state, move) {
    if (move.col < 0 || move.col >= puzzle.size) return null;
    if (move.row < 0 || move.row >= puzzle.size) return null;
    if (move.value < 0 || move.value > puzzle.size) return null;
    const index = at(puzzle.size, move.col, move.row);
    if (puzzle.givens[index]) return null;
    if (state.cells[index] === move.value) return null;
    const cells = [...state.cells];
    cells[index] = move.value;
    return { cells };
  },

  solve(puzzle, from, maxTier) {
    const report = solveGrid(puzzle, from.cells, maxTier, nameOf(puzzle));
    return {
      solved: report.solved,
      steps: report.steps,
      tierUsed: report.tierUsed,
    } satisfies SolveReport;
  },

  /**
   * What to tell a player who has asked for help.
   *
   * The order is the design, and it is the same order the first puzzle settled on for the
   * same reason: **a wrong board is checked first.** Offering a deduction to somebody whose
   * board already contains a mistake is deducing from a false premise and sending them
   * further wrong — and it is the failure they cannot find by staring, because the mistake
   * is usually nowhere near where they are looking.
   *
   * And it names the **line or the box**, never the square. Pointing at the square is
   * surrender dressed up as help.
   */
  hint(puzzle, state, maxTier) {
    const name = nameOf(puzzle);
    const broken = firstBrokenUnit(puzzle, state.cells, name);
    if (broken) {
      return { kind: 'wrong', look: cellsOf(puzzle, broken.unit.cells), why: broken.why };
    }

    const step = nextStep(puzzle, state.cells, maxTier, name);
    if (step) return { kind: 'step', step };

    return {
      kind: 'done',
      why: state.cells.every((v) => v !== EMPTY)
        ? 'Every square is filled in — this one is finished.'
        : 'There is nothing more that can be worked out from what is on the board right now.',
    };
  },

  isSolved(puzzle, state) {
    for (let i = 0; i < puzzle.solution.length; i++) {
      if (state.cells[i] !== puzzle.solution[i]) return false;
    }
    return true;
  },

  /**
   * Fraction of the squares the player has to fill that are right, less the wrong ones.
   *
   * The givens are excluded, which matters: counting them would start a 9x9 at 30% done
   * before anybody had touched it, which is both flattering and useless. The penalty for a
   * wrong number is the same decision the first puzzle made — progress should never go up
   * for a board going wrong.
   */
  progress(puzzle, state) {
    let wanted = 0;
    let right = 0;
    let wrong = 0;
    for (let i = 0; i < puzzle.solution.length; i++) {
      if (puzzle.givens[i]) continue;
      wanted++;
      const value = state.cells[i]!;
      if (value === EMPTY) continue;
      if (value === puzzle.solution[i]) right++;
      else wrong++;
    }
    if (wanted === 0) return 1;
    return Math.max(0, (right - wrong) / wanted);
  },

  layout(puzzle, state) {
    const name = nameOf(puzzle);
    const marks: Mark[] = [];
    const labels: Label[] = [];
    for (let row = 0; row < puzzle.size; row++) {
      for (let col = 0; col < puzzle.size; col++) {
        const index = at(puzzle.size, col, row);
        const given = puzzle.givens[index] === true;
        // A given square is tinted as well as drawn heavier. Weight alone is too subtle on
        // a tablet in a bright classroom, and knowing which numbers cannot be changed is
        // not a nicety — a child who rubs at one and nothing happens needs to see why.
        marks.push(given ? 'shaded' : 'empty');
        const value = state.cells[index] ?? EMPTY;
        if (value === EMPTY) continue;
        // Larger than a nonogram's clue, which is what the base size is set for: a clue
        // sits in a margin cell beside its neighbours, where a number here has a whole
        // square to itself and is the thing being read.
        labels.push({
          col,
          row,
          text: name(value),
          scale: 1.2,
          ...(given ? { strong: true } : {}),
        });
      }
    }

    return {
      rows: puzzle.size,
      cols: puzzle.size,
      margin: { left: 0, top: 0 },
      marks,
      labels,
      // The box, which is why this is two numbers. A 6x6's boxes are 2 tall and 3 wide.
      band: { col: puzzle.boxCols, row: puzzle.boxRows },
      highlight: [],
    };
  },

  hit(puzzle, state, cell: Cell, tool) {
    if (cell.col < 0 || cell.col >= puzzle.size) return null;
    if (cell.row < 0 || cell.row >= puzzle.size) return null;
    const index = at(puzzle.size, cell.col, cell.row);
    if (puzzle.givens[index]) return null;
    const current = state.cells[index] ?? EMPTY;

    if (tool === 'rub') {
      return current === EMPTY ? null : { col: cell.col, row: cell.row, value: EMPTY };
    }
    const value = Number(tool.replace(/^v/, ''));
    if (!Number.isInteger(value) || value < 1 || value > puzzle.size) return null;
    // Pressing a square that already holds this number clears it. Two taps to undo one is
    // how a pencil works, and it is the only way to empty a square without changing tool.
    return { col: cell.col, row: cell.row, value: current === value ? EMPTY : value };
  },

  tools(puzzle) {
    const name = nameOf(puzzle);
    const what = puzzle.glyphs === 'shapes' ? 'shape' : 'number';
    const out = [];
    // The same sentence for every number, deliberately. Nine tools with nine
    // near-identical explanations fill the How to play panel with noise and push the rest
    // of it below the fold; one explanation lets the shell gather them into a single line.
    // The button already shows which number it is, so saying so again buys nothing.
    const help =
      `Choose a ${what}, then press the square you want to put it in. ` +
      `Press that square again to clear it.`;
    for (let v = 1; v <= puzzle.size; v++) {
      out.push({ id: `v${v}`, name: name(v), help });
    }
    out.push({
      id: 'rub',
      name: 'Rub out',
      help: `Empty a square. The ${what}s the puzzle gave you cannot be rubbed out.`,
    });
    return out;
  },

  // --- Saying what it is -----------------------------------------------------

  title(puzzle) {
    const shown = puzzle.glyphs === 'shapes' ? ' shapes' : '';
    return `${puzzle.size}×${puzzle.size} ${tierName(puzzle.tierUsed)}${shown}`;
  },

  describe(puzzle): Description {
    const note =
      puzzle.tierUsed <= 1
        ? 'Every step can be found by looking: a line with one square left, or a square with one number left.'
        : puzzle.tierUsed === 2
          ? 'Some steps need reading it the other way round — where can this number go in this box?'
          : 'A few steps need you to suppose a number goes somewhere and find that it breaks.';
    return {
      rating: tierName(puzzle.tierUsed),
      note,
      progressNoun: 'the squares filled in',
    };
  },

  instructions: [
    'Every row, every column and every box has to hold each number exactly once. No row, column or box may ever repeat one.',
    'Choose a number from the toolbar, then press the square you want to put it in. Press that square again to clear it, or use Rub out.',
    'The shaded squares were put there by the puzzle. They are always right and cannot be changed.',
    'Every puzzle here can be worked out by reasoning. There is never a need to guess — and if you get stuck, Hint will show you the next step and why it works.',
    'If something has gone wrong, Hint says which line or box cannot be right, and leaves the finding to you.',
  ],

  /** Small, fixed, and the same every time, so a teacher can talk about it. */
  demoSpec() {
    return { size: 4, tier: 'gentle', seed: 'demo', glyphs: 'digits' };
  },

  /** One character per square: a digit, or `.` for empty. Readable, and repairable. */
  serialise(state) {
    return state.cells.map((v) => (v === EMPTY ? '.' : String(v))).join('');
  },

  /**
   * The givens are forced back in rather than read from the save.
   *
   * A save file that disagreed with the puzzle about which squares are fixed would be a
   * board the player could not finish and could not explain. The puzzle is regenerated
   * from the spec and is the authority; the save only says what the player did.
   */
  deserialise(puzzle, data) {
    const cells: number[] = [];
    for (let i = 0; i < puzzle.solution.length; i++) {
      if (puzzle.givens[i]) {
        cells.push(puzzle.solution[i]!);
        continue;
      }
      const ch = data[i];
      const value = ch === undefined ? NaN : Number(ch);
      cells.push(Number.isInteger(value) && value >= 1 && value <= puzzle.size ? value : EMPTY);
    }
    return { cells };
  },

  /**
   * The puzzle on paper: the givens and an empty grid, and **never the answer**.
   *
   * Takes no state, for the reason the sister project paid for: its printable sheet drew
   * the answer into the frame and passed four assertions, because each checked that
   * something had been drawn rather than what it showed. Here the only board available to
   * print is the starting one, so the bug is unavailable rather than merely untaken.
   */
  printable(puzzle) {
    return numberPlace.layout(puzzle, numberPlace.start(puzzle));
  },
};
