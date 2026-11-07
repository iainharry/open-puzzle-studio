/**
 * Picture Logic — nonograms.
 *
 * Fill the cells a row's and column's numbers describe and a picture appears. Called
 * "Picture Logic" in the app and "nonogram" in the documentation: *Picross* is Nintendo's,
 * *Pic-a-Pix* and *Fill-a-Pix* are Conceptis's, and a free classroom app has nothing to
 * gain from a name somebody else owns. Simon Tatham calls his "Pattern" for the same
 * reason.
 *
 * ## Why generation is driven by the solver
 *
 * A nonogram **cannot** be made by drawing a random bitmap and reading off the clues. Of
 * random 30x30 grids, 97.5% have more than one solution and only 0.4% can be solved a line
 * at a time (Wolter's solver survey, https://webpbn.com/survey/). A generator that drew a
 * picture and read off its clues would produce puzzles that are ambiguous, unsolvable by
 * reasoning, or both — and would look like it worked, because the clues would be perfectly
 * correct clues for *a* grid. So the solver came first, in M2, and the generator is a
 * search over what the solver can finish. See `generate.ts`.
 *
 * Two kinds of instance: hand-drawn starters, recognisable at five cells across in a way
 * no generator manages, and generated boards at a chosen size and difficulty.
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
  BLANK,
  FILLED,
  LINE_NAME,
  UNKNOWN,
  firstBrokenLine,
  lineCellsOf,
  nextStep,
  solveGrid,
  type Grid,
  type LineCell,
} from './solver.js';
import { makePuzzle, tierName, tierRank } from './generate.js';

/**
 * The board sizes offered, and the starters folded in with them.
 *
 * Until this milestone the shell held this list and a second "Starter" dropdown beside it,
 * which quietly ignored the chosen size and difficulty. One list is both less code and
 * better: a starter picture *is* a size choice, and a control that silently overrides two
 * others is a control that confuses the person using it.
 */
const SIZES: readonly number[] = [5, 7, 8, 10, 12, 15, 20];

/**
 * What identifies an instance. Small enough for a game code.
 *
 * Two kinds, because they answer different needs. A **drawn** picture is one of the
 * hand-made starters — recognisable at five cells across, which no generator manages and
 * which is what a five-year-old meeting their first nonogram should get. A **made** one is
 * generated from a seed at a chosen size and difficulty, and is the puzzle the app is
 * actually for.
 */
export type PictureSpec =
  | { readonly kind: 'drawn'; readonly picture: string }
  | {
      readonly kind: 'made';
      readonly rows: number;
      readonly cols: number;
      /** A tier id: 'gentle' | 'steady' | 'tricky'. */
      readonly tier: string;
      readonly seed: string;
    };

/**
 * Make sense of a spec from storage, a URL or an older version.
 *
 * Specs genuinely arrive untrusted — out of IndexedDB, off the end of a link somebody
 * pasted — so this takes `unknown` rather than pretending otherwise. It also accepts the
 * M1 shape `{ picture }`, so a puzzle saved before generation existed still opens instead
 * of greeting its owner with an error.
 */
export function normaliseSpec(raw: unknown): PictureSpec {
  const spec = (raw ?? {}) as Record<string, unknown>;
  if (spec['kind'] === 'made' || typeof spec['seed'] === 'string') {
    const rows = Number(spec['rows']);
    const cols = Number(spec['cols']);
    return {
      kind: 'made',
      rows: Number.isFinite(rows) && rows >= 3 ? Math.min(40, Math.round(rows)) : 10,
      cols: Number.isFinite(cols) && cols >= 3 ? Math.min(40, Math.round(cols)) : 10,
      tier: typeof spec['tier'] === 'string' ? spec['tier'] : 'steady',
      seed: String(spec['seed'] ?? '1'),
    };
  }
  const picture = String(spec['picture'] ?? 'heart');
  return { kind: 'drawn', picture: picture in PICTURES ? picture : 'heart' };
}

export interface PicturePuzzle {
  readonly rows: number;
  readonly cols: number;
  readonly title: string;
  /** The hardest tier the solver needed. What the player is told, not what was asked for. */
  readonly tierUsed: number;
  /** The answer, row-major. True means filled. */
  readonly solution: readonly boolean[];
  /** Run lengths per row, top to bottom. An empty line is `[0]`, never `[]`. */
  readonly rowClues: readonly (readonly number[])[];
  readonly colClues: readonly (readonly number[])[];
}

/** The player's grid, row-major. */
export interface PictureState {
  readonly marks: readonly Mark[];
}

export interface PictureMove {
  readonly col: number;
  readonly row: number;
  readonly mark: Mark;
}

/**
 * The starter pictures.
 *
 * Drawn rather than generated, and chosen to be recognisable at five cells across to a
 * child who has never seen a nonogram. `#` is filled, anything else is not.
 */
const PICTURES: Record<string, { title: string; art: readonly string[] }> = {
  heart: {
    title: 'Heart',
    art: [
      '.#.#.',
      '#####',
      '#####',
      '.###.',
      '..#..',
    ],
  },
  house: {
    title: 'House',
    art: [
      '..#..',
      '.###.',
      '#####',
      '#...#',
      '#.#.#',
    ],
  },
  tree: {
    title: 'Tree',
    art: [
      '..#..',
      '.###.',
      '#####',
      '..#..',
      '..#..',
    ],
  },
};

export const PICTURE_NAMES: readonly string[] = Object.keys(PICTURES);

/**
 * Run lengths along a line.
 *
 * An empty line is `[0]` rather than `[]` on purpose: a clue has to *say* "nothing here",
 * or a blank row looks like a row whose clue failed to render.
 */
export function cluesFor(line: readonly boolean[]): number[] {
  const runs: number[] = [];
  let run = 0;
  for (const filled of line) {
    if (filled) run++;
    else if (run > 0) {
      runs.push(run);
      run = 0;
    }
  }
  if (run > 0) runs.push(run);
  return runs.length > 0 ? runs : [0];
}

const TIERS: readonly Tier[] = [
  { id: 'gentle', name: 'Gentle', rank: 1 },
  { id: 'steady', name: 'Steady', rank: 2 },
  { id: 'tricky', name: 'Tricky', rank: 3 },
];

function at(cols: number, col: number, row: number): number {
  return row * cols + col;
}

export const pictureLogic: PuzzleModule<
  PictureSpec,
  PicturePuzzle,
  PictureMove,
  PictureState
> = {
  id: 'picture-logic',
  name: 'Picture Logic',
  blurb: 'The numbers say how many squares in a row are filled in.',
  tiers: TIERS,

  tools() {
    return [
      {
        id: 'fill',
        name: 'Fill',
        help: 'Colour a square in. Press it again to clear it, or drag to do a whole run.',
        drag: true,
      },
      // Marking a cell as definitely empty is not decoration: it is how the deductions are
      // actually made, and a player with no way to record "not this one" is solving a
      // harder puzzle than the one in front of them.
      {
        id: 'cross',
        name: 'Cross out',
        help: 'Mark a square you are sure is empty. This is how you work the rest out, not decoration.',
        drag: true,
      },
    ];
  },

  options() {
    return [
      {
        id: 'size',
        label: 'Size',
        help: 'How big the picture is. Bigger takes longer and gives more to go on. The starters are hand-drawn and recognisable at five squares across, which no generator manages.',
        values: [
          ...PICTURE_NAMES.map((name) => ({
            value: name,
            label: `${name[0]!.toUpperCase()}${name.slice(1)} (a first go)`,
          })),
          ...SIZES.map((n) => ({ value: String(n), label: `${n} × ${n}` })),
        ],
        initial: '10',
      },
      {
        id: 'tier',
        label: 'Difficulty',
        help: 'How much working out it takes. Gentle puzzles never need more than looking at one line at a time. Ignored for a starter, which is whatever difficulty it turns out to be.',
        values: TIERS.map((t) => ({ value: t.id, label: t.name })),
        initial: 'steady',
      },
    ] satisfies readonly Choice[];
  },

  specFrom(chosen, seed) {
    const size = chosen['size'] ?? '10';
    if (size in PICTURES) return { kind: 'drawn', picture: size };
    const n = Number(size);
    return {
      kind: 'made',
      rows: n,
      cols: n,
      tier: chosen['tier'] ?? 'steady',
      seed,
    };
  },

  normalise(raw) {
    return normaliseSpec(raw);
  },

  encode(spec) {
    return spec.kind === 'drawn'
      ? ['d', spec.picture]
      : ['m', `${spec.cols}x${spec.rows}`, spec.tier, spec.seed];
  },

  decode(parts) {
    if (parts[0] === 'd' && parts[1]) return { kind: 'drawn', picture: parts[1] };
    if (parts[0] === 'm' && parts[1] && parts[2] && parts[3]) {
      const [cols, rows] = parts[1].split('x').map(Number);
      if (!cols || !rows) return null;
      return { kind: 'made', rows, cols, tier: parts[2], seed: parts[3] };
    }
    return null;
  },

  title(puzzle) {
    return puzzle.title;
  },

  describe(puzzle): Description {
    return {
      rating: tierName(puzzle.tierUsed),
      note:
        puzzle.tierUsed <= 1
          ? 'Every step can be found by looking at one line at a time.'
          : puzzle.tierUsed === 2
            ? 'Some steps need you to think about all the ways a line could fit.'
            : 'A few steps need you to suppose a square is filled and see what goes wrong.',
      progressNoun: 'the picture filled in',
    };
  },

  instructions: [
    'The numbers tell you how many squares in a row are filled in, in order. A row marked 3 1 has a block of three, then at least one gap, then a single square. Fill in the right squares and a picture appears.',
    'Fill colours a square in. Press it again to clear it, and drag across several squares to do a whole run at once.',
    'Cross out marks a square you are sure is empty. This is not decoration — crossing out is how you work the rest out, and without it you are solving a harder puzzle than the one in front of you.',
    'Press space to swap between Fill and Cross out.',
    'A clue goes faint when its line is right. If you finish a line and it still does not match its numbers, the clue turns orange and is underlined — that line needs looking at again. An ordinary clue just means there is still something to decide there.',
    'Every puzzle here can be worked out by reasoning. There is never a need to guess — and if you get stuck, Hint will show you the next step and why it works.',
  ],

  /** Small, drawn, and the same every time, so a teacher can talk about it. */
  demoSpec() {
    return { kind: 'drawn', picture: 'heart' };
  },

  generate(raw) {
    const spec = normaliseSpec(raw);
    if (spec.kind === 'made') {
      const made = makePuzzle({
        rows: spec.rows,
        cols: spec.cols,
        tier: tierRank(spec.tier),
        seed: spec.seed,
      });
      return {
        rows: spec.rows,
        cols: spec.cols,
        title: `${spec.cols}\u00d7${spec.rows} ${tierName(made.tierUsed)}`,
        tierUsed: made.tierUsed,
        solution: made.solution,
        rowClues: made.rowClues,
        colClues: made.colClues,
      };
    }

    const picture = PICTURES[spec.picture] ?? PICTURES['heart']!;
    const art = picture.art;
    const rows = art.length;
    const cols = art[0]!.length;
    if (art.some((line) => line.length !== cols)) {
      throw new Error(`picture "${spec.picture}" is not rectangular`);
    }

    const solution: boolean[] = [];
    for (const line of art) {
      for (const ch of line) solution.push(ch === '#');
    }

    const rowClues: number[][] = [];
    for (let r = 0; r < rows; r++) {
      rowClues.push(cluesFor(solution.slice(r * cols, (r + 1) * cols)));
    }
    const colClues: number[][] = [];
    for (let c = 0; c < cols; c++) {
      const line: boolean[] = [];
      for (let r = 0; r < rows; r++) line.push(solution[at(cols, c, r)]!);
      colClues.push(cluesFor(line));
    }

    // Rated rather than assumed: a hand-drawn picture is whatever difficulty it turns out
    // to be, and saying "Gentle" because it is small would be a guess.
    const rated = solveGrid({ rows, cols, rowClues, colClues }, new Array(rows * cols).fill(UNKNOWN), 3);

    return {
      rows,
      cols,
      title: picture.title,
      tierUsed: rated.solved ? rated.tierUsed : 3,
      solution,
      rowClues,
      colClues,
    };
  },

  start(puzzle) {
    return { marks: new Array<Mark>(puzzle.rows * puzzle.cols).fill('empty') };
  },

  apply(puzzle, state, move) {
    if (move.col < 0 || move.col >= puzzle.cols) return null;
    if (move.row < 0 || move.row >= puzzle.rows) return null;
    const index = at(puzzle.cols, move.col, move.row);
    if (state.marks[index] === move.mark) return null;
    const marks = [...state.marks];
    marks[index] = move.mark;
    return { marks };
  },

  /**
   * Solve from wherever the player is, not from blank.
   *
   * That is what makes the same function serve a hint: the first step of a solve begun at
   * the player's own board is the next deduction available *to them*. A solver that only
   * worked from an empty grid could rate difficulty and nothing else.
   *
   * A player's crossed-out square is treated as known-empty. That is a small act of faith
   * — a child who crosses the wrong square gets a hint derived from their mistake — but
   * the alternative, ignoring their marks, would give hints about squares they had already
   * ruled out and read as the app not watching.
   */
  solve(puzzle, from, maxTier) {
    const report = solveGrid(gridOf(puzzle), toLineCells(from), maxTier);
    return {
      solved: report.solved,
      steps: report.steps,
      tierUsed: report.tierUsed,
    } satisfies SolveReport;
  },

  /**
   * What to tell a player who has asked for help.
   *
   * The order matters and is the whole design. **A contradiction is checked first**,
   * because offering a deduction to somebody whose board is already wrong is deducing
   * from a false premise and sending them further wrong — and it is the failure they
   * cannot find by staring, because the mistake is usually nowhere near where they are
   * looking.
   *
   * And when it reports one, it names the **line**, never the square. Pointing at the
   * square is surrender dressed up as help; naming the line hands back a puzzle small
   * enough to re-check and leaves the finding to them.
   */
  hint(puzzle, state, maxTier) {
    const grid = gridOf(puzzle);
    const cells = toLineCells(state);

    const broken = firstBrokenLine(grid, cells);
    if (broken) {
      return {
        kind: 'wrong',
        look: lineCellsOf(grid, broken.axis, broken.index),
        why:
          `Something in ${LINE_NAME[broken.axis]} ${broken.index + 1} cannot be right — ` +
          `what is marked there does not fit its numbers. Check that line again before going on.`,
      };
    }

    const step = nextStep(grid, cells, maxTier);
    if (step) return { kind: 'step', step };

    return {
      kind: 'done',
      why: cells.every((c) => c !== UNKNOWN)
        ? 'Every square is decided — this one is finished.'
        : 'There is nothing more to work out from the numbers alone right now.',
    };
  },

  isSolved(puzzle, state) {
    // Crossed and empty are both "not filled" as far as the answer is concerned: a player
    // who solves it correctly without crossing anything out has still solved it.
    for (let i = 0; i < puzzle.solution.length; i++) {
      if (puzzle.solution[i] !== (state.marks[i] === 'filled')) return false;
    }
    return true;
  },

  /**
   * Fraction of the *filled* cells that are correctly filled, minus a penalty for cells
   * filled in wrongly.
   *
   * Counting every correct cell would start a blank 5x5 heart at 48% complete, because
   * most of a nonogram is empty — which is both flattering and useless. This counts the
   * work actually done, and never reports progress for a grid that is wrong.
   */
  progress(puzzle, state) {
    let wanted = 0;
    let right = 0;
    let wrong = 0;
    for (let i = 0; i < puzzle.solution.length; i++) {
      const filled = state.marks[i] === 'filled';
      if (puzzle.solution[i]) {
        wanted++;
        if (filled) right++;
      } else if (filled) {
        wrong++;
      }
    }
    if (wanted === 0) return 1;
    return Math.max(0, (right - wrong) / wanted);
  },

  layout(puzzle, state) {
    const left = Math.max(...puzzle.rowClues.map((c) => c.length));
    const top = Math.max(...puzzle.colClues.map((c) => c.length));

    const labels: Label[] = [];
    for (let r = 0; r < puzzle.rows; r++) {
      const clue = puzzle.rowClues[r]!;
      const tone = lineTone(puzzle, state, 'row', r);
      clue.forEach((n, i) => {
        labels.push({
          // Right-aligned against the grid: the last number of a clue always sits in the
          // column next to the board, whatever length the clue is.
          col: i - clue.length,
          row: r,
          text: String(n),
          ...(tone ? { tone } : {}),
        });
      });
    }
    for (let c = 0; c < puzzle.cols; c++) {
      const clue = puzzle.colClues[c]!;
      const tone = lineTone(puzzle, state, 'col', c);
      clue.forEach((n, i) => {
        labels.push({
          col: c,
          // Bottom-aligned against the grid, for the same reason.
          row: i - clue.length,
          text: String(n),
          ...(tone ? { tone } : {}),
        });
      });
    }

    return {
      rows: puzzle.rows,
      cols: puzzle.cols,
      margin: { left, top },
      marks: state.marks,
      labels,
      // Every five cells, which is how a person counts a long run by eye. The same both
      // ways here; the second puzzle is the one that needed them to differ.
      band: { col: 5, row: 5 },
      highlight: [],
    };
  },

  hit(puzzle, state, cell: Cell, tool) {
    if (cell.col < 0 || cell.col >= puzzle.cols) return null;
    if (cell.row < 0 || cell.row >= puzzle.rows) return null;
    const current = state.marks[at(puzzle.cols, cell.col, cell.row)]!;
    const wanted: Mark = tool === 'cross' ? 'crossed' : 'filled';
    // A press on a cell already carrying this tool's mark clears it. Two taps to undo one
    // is how every pencil-and-paper player expects this to work.
    return { col: cell.col, row: cell.row, mark: current === wanted ? 'empty' : wanted };
  },

  /**
   * One character per cell: `.` empty, `#` filled, `x` crossed.
   *
   * Readable on purpose. A save file somebody can open and understand is a save file they
   * can repair, and at a few hundred cells there is nothing to gain from packing it.
   */
  serialise(state) {
    return state.marks.map((m) => (m === 'filled' ? '#' : m === 'crossed' ? 'x' : '.')).join('');
  },

  /**
   * The puzzle on paper: the clues and an empty grid, and **never the answer**.
   *
   * The sister project shipped a printable sheet that drew every piece into the frame and
   * passed four assertions, because each one checked that something had been drawn rather
   * than what it showed. The equivalent mistake here is passing `state` instead of a blank
   * board, so this takes no state at all — the function signature makes the bug
   * unavailable rather than merely untaken.
   *
   * Printing matters more here than it did there: a nonogram on paper is how most
   * children will meet one in a classroom, and a grid with clues is the whole artefact.
   */
  printable(puzzle) {
    return pictureLogic.layout(puzzle, pictureLogic.start(puzzle));
  },

  deserialise(puzzle, data) {
    const size = puzzle.rows * puzzle.cols;
    const marks: Mark[] = [];
    for (let i = 0; i < size; i++) {
      const ch = data[i];
      marks.push(ch === '#' ? 'filled' : ch === 'x' ? 'crossed' : 'empty');
    }
    return { marks };
  },
};

/**
 * How a line's clue should look: faint when it is right, warned when it is finished and
 * wrong, and ordinary while there is still something to decide.
 *
 * ## Why the third state exists
 *
 * Until it did, "you have not finished this line" and "this line is finished and wrong"
 * looked identical. A player sent in a board where all eight column clues and seven of
 * the eight row clues had gone faint, and asked whether the one remaining clue was a bug.
 * It was not — that row held two separate squares where the clue said one block of two —
 * but nothing on the screen distinguished a line still being worked on from a line that
 * had been got wrong, so "the app is broken" was a reasonable reading.
 *
 * ## Why "finished and wrong" and not "already impossible"
 *
 * The solver can tell, from `completeLine`, whether a half-finished line has *already*
 * gone wrong — one square crossed out in error is enough. Warning on that would be a
 * better error detector and a worse puzzle: it turns the board into an oracle you can
 * probe one square at a time, which is an assistance level, and those were deliberately
 * deferred until a teacher asks for one.
 *
 * This warns only once every square in the line has been decided — at which point the
 * player could have counted the runs themselves and compared. **It adds no information;
 * it removes an ambiguity.** That is the whole of the change, and it is also why it is
 * cheap: counting runs is one pass, where asking whether a line is still satisfiable is a
 * dynamic program over every line on every frame.
 */
function lineTone(
  puzzle: PicturePuzzle,
  state: PictureState,
  axis: 'row' | 'col',
  index: number,
): 'faint' | 'warn' | undefined {
  const n = axis === 'row' ? puzzle.cols : puzzle.rows;
  const line: boolean[] = [];
  let decided = true;
  for (let i = 0; i < n; i++) {
    const idx =
      axis === 'row' ? at(puzzle.cols, i, index) : at(puzzle.cols, index, i);
    const mark = state.marks[idx];
    line.push(mark === 'filled');
    if (mark === 'empty') decided = false;
  }
  const want = axis === 'row' ? puzzle.rowClues[index]! : puzzle.colClues[index]!;
  const have = cluesFor(line);
  if (have.length === want.length && have.every((v, i) => v === want[i])) return 'faint';
  // Decided and still not matching: there is nothing left to add here, so it is wrong.
  return decided ? 'warn' : undefined;
}


/** The clue grid the solver works on. Derived, never stored. */
export function gridOf(puzzle: PicturePuzzle): Grid {
  return {
    rows: puzzle.rows,
    cols: puzzle.cols,
    rowClues: puzzle.rowClues,
    colClues: puzzle.colClues,
  };
}

/** A player's marks as the solver sees them: crossed and never-touched are different. */
function toLineCells(state: PictureState): LineCell[] {
  return state.marks.map((m) => (m === 'filled' ? FILLED : m === 'crossed' ? BLANK : UNKNOWN));
}
