/**
 * The contract between a puzzle and everything else.
 *
 * This file is the bet the whole project rests on. The shell, the storage, the undo stack
 * and the renderer all talk to a puzzle only through `PuzzleModule`, and a puzzle knows
 * nothing about any of them. Borrowed from Simon Tatham's three-layer split — front end,
 * one shared mid-end, one back end per puzzle — which is the single most transferable idea
 * in twenty-two years of that collection.
 *
 * ## What the second puzzle did to this file
 *
 * It was drafted against two puzzles on paper — nonograms built, Sudoku held in mind — and
 * it was still wrong in seven places, every one of them invisible while there was only one
 * back end. The shell was quietly doing nonogram work on the puzzle's behalf, and nothing
 * could tell, because the only puzzle that existed was a nonogram.
 *
 * What was missing, and why each one is a need rather than a convenience:
 *
 * 1. `tools` was a constant. A number puzzle's tools are its digits, so they depend on the
 *    size of the grid: 1–4 on a 4x4 and 1–9 on a 9x9. It is now `tools(puzzle)`.
 * 2. There was no way for a puzzle to say what choices it offers, so the shell hard-coded
 *    `[5, 7, 8, 10, 12, 15, 20]` square boards — meaningless for a puzzle whose only sizes
 *    are 4, 6 and 9. That is `options()` and `specFrom()`.
 * 3. Game codes were encoded by the shell, which had to know the shape of a nonogram spec.
 *    That is `encode()` and `decode()`.
 * 4. `title()` and `describe()` existed only as casts in the shell: `puzzle as { title }`.
 * 5. The help panel's prose was HTML in the shell, written about runs and clues. That is
 *    `instructions`.
 * 6. `SolveStep.line` assumed every deduction is about a row or a column. A number puzzle's
 *    deductions are as often about a **box**, which is neither. It is now `look` — the
 *    cells themselves — plus `where`, the puzzle's own name for them. This deletes code
 *    from both the shell and the demonstration, because each was reconstructing a line's
 *    cells from an axis and an index, which is grid knowledge they had no business having.
 * 7. `Scene.band` was one number, "a heavier line every n cells". A 6x6 number puzzle has
 *    2x3 boxes, so it needs a different interval across than down.
 *
 * The honest summary: the interface was sufficient for one puzzle and wrong for two, and
 * the only way to find that out was to write the second one. It is now 24 members instead
 * of 15. Adding the third puzzle should cost fewer, and if it does not, the shape is still
 * wrong.
 */

/** A square in the playable grid. Negative coordinates are in the clue margin. */
export interface Cell {
  readonly col: number;
  readonly row: number;
}

/**
 * What a player has put in a cell. Shared vocabulary; not every puzzle uses all of it.
 *
 * `shaded` is a cell the puzzle itself fixed — a given digit, a wall, a fixed tile. It is
 * presentational and carries no meaning beyond "the player did not put this here and
 * cannot take it away"; what it *means* is the puzzle's business.
 */
export type Mark = 'empty' | 'filled' | 'crossed' | 'shaded';

/** Text drawn in grid coordinates, which may be negative to sit in the margin. */
export interface Label {
  readonly col: number;
  readonly row: number;
  readonly text: string;
  /** Satisfied clues, completed rows: drawn faint rather than removed. */
  readonly dim?: boolean;
  /** Fraction of the normal size. Under 1 for a note pencilled into a corner. */
  readonly scale?: number;
  /** Drawn heavier. A number the puzzle gave you, against one you worked out. */
  readonly strong?: boolean;
}

/**
 * What to draw, in cells rather than pixels.
 *
 * **Returned, not drawn.** The most repeated bug in the jigsaw project was that *asserting
 * a thing is drawn is not asserting what it shows* — a printable sheet that printed the
 * answer passed four assertions, and a board that painted its bounding box instead of its
 * outline passed all of them. A scene is a value, so a test in Node can read what the
 * player would see without a browser anywhere near it.
 *
 * It also means screen, paper and any future renderer all work from one description
 * instead of three that drift apart.
 */
export interface Scene {
  readonly rows: number;
  readonly cols: number;
  /** Cells of space reserved outside the grid for clues. */
  readonly margin: { readonly left: number; readonly top: number };
  /** One per playable cell, row-major, `rows * cols` long. */
  readonly marks: readonly Mark[];
  readonly labels: readonly Label[];
  /**
   * Heavier grid line every n cells, across and down separately. 0 for none.
   *
   * Separately because a 6x6 number puzzle's boxes are 2 tall and 3 wide, and one number
   * cannot say that. A nonogram uses the same value for both.
   */
  readonly band: { readonly col: number; readonly row: number };
  /** Cells to draw attention to — a hint, or the move just made. */
  readonly highlight: readonly Cell[];
}

/** One named difficulty a puzzle type offers. */
export interface Tier {
  readonly id: string;
  readonly name: string;
  /** Ordering only. Higher is harder. */
  readonly rank: number;
}

/**
 * One thing a player can choose before a puzzle is made, as the puzzle describes it.
 *
 * The shell renders these and hands the answers back to `specFrom()`. It exists because
 * the alternative — which is what M1 to M4 actually did — is a shell that knows one
 * puzzle's sizes and difficulties and silently offers them to every other puzzle.
 */
export interface Choice {
  readonly id: string;
  readonly label: string;
  readonly help: string;
  readonly values: readonly { readonly value: string; readonly label: string }[];
  readonly initial: string;
}

/** What to tell the player about the instance in front of them. Written by the puzzle. */
export interface Description {
  /** The difficulty it turned out to be, named. Not the one that was asked for. */
  readonly rating: string;
  /** A sentence or two for the help panel: what this one will take. */
  readonly note: string;
  /** Completes "37% of ___". "the picture filled in"; "the squares filled in". */
  readonly progressNoun: string;
}

/**
 * What a solver did, not merely whether it won.
 *
 * This is the keystone of the project, and it is worth being explicit about why one
 * function is carrying three features:
 *
 * 1. **Generation.** Nonograms cannot be generated by drawing a random bitmap — 97.5% of
 *    random 30x30 grids have more than one solution. Generation has to be solve-driven.
 *    The same argument holds for number puzzles from the other end: a grid dug out at
 *    random is usually ambiguous, and looks fine.
 * 2. **Honest difficulty.** Rate by which deductions were needed, never by clue count. The
 *    test is two-sided: a puzzle is Hard only if the hard solver succeeds *and* the medium
 *    solver fails. Without the second half you ship easy puzzles labelled hard.
 * 3. **Honest hints.** `steps[0]` from the player's own position is "here is the next
 *    deduction available to you, and this is why it works" — which teaches the technique
 *    instead of giving the answer, and is the reason this app is worth building for a
 *    classroom at all.
 *
 * It also buys **uniqueness for free**, in both puzzles and for the same reason: every
 * deduction the solver makes is forced, so a puzzle the solver finishes by reasoning alone
 * has exactly one solution. No separate uniqueness check is needed, or wanted.
 */
export interface SolveReport {
  readonly solved: boolean;
  readonly steps: readonly SolveStep[];
  /** Rank of the hardest tier any step needed. */
  readonly tierUsed: number;
}

export interface SolveStep {
  /** Stable identifier, for tests and for counting. */
  readonly technique: string;
  readonly tier: number;
  /** The cells the deduction decides. */
  readonly cells: readonly Cell[];
  /** Plain English, shown to a player as a hint. Written for a ten-year-old. */
  readonly why: string;
  /**
   * The cells the deduction is *about* — the row, the column, the box, the pair.
   *
   * Carried as cells rather than as an axis and an index, because the second puzzle's
   * deductions are as often about a box as a line, and a box is neither a row nor a
   * column. Carried as data rather than left in the prose, because a hint whose first
   * strength is "look here" has to be able to highlight *here*, and working that out by
   * parsing the sentence breaks the day somebody rewords it.
   *
   * Defaults to `cells` when absent.
   */
  readonly look?: readonly Cell[];
  /** The puzzle's own name for `look`: "Row 4", "the middle box". For the status line. */
  readonly where?: string;
  /** What the step would do, for the strongest hint. Applying it is the shell's choice. */
  readonly moves?: readonly unknown[];
}

/**
 * What to tell a player who has asked for help.
 *
 * Three kinds, because there are three situations and conflating the first two is how a
 * hint system becomes useless. Either there is a next deduction available, or **what they
 * have already put down cannot be right** — and in the second case offering a deduction
 * would be deducing from a false premise and sending them further wrong.
 */
export type Hint =
  | { readonly kind: 'step'; readonly step: SolveStep }
  | {
      readonly kind: 'wrong';
      /**
       * The region that cannot be satisfied. **Never the square that is wrong.**
       *
       * Pointing at the square is surrender dressed up as help. Naming the region hands
       * back a puzzle small enough to re-check and leaves the finding to them.
       */
      readonly look: readonly Cell[];
      readonly why: string;
    }
  | { readonly kind: 'done'; readonly why: string };

/**
 * A puzzle type.
 *
 * `Spec` is what identifies an instance (size, seed, difficulty) and is small enough to
 * put in a URL. `Puzzle` is the generated instance. `State` is what the player has done.
 *
 * **`State` must be JSON-serialisable**, because the undo stack clones it and the
 * fingerprint hashes it. That is a real constraint on implementations and it is deliberate:
 * it keeps the mid-end able to do undo, save and the change watchdog generically, which is
 * the whole reason the mid-end exists.
 */
export interface PuzzleModule<Spec, Puzzle, Move, State> {
  readonly id: string;
  readonly name: string;
  /** One line, for the puzzle picker. What this puzzle is, to somebody who has not met it. */
  readonly blurb: string;
  readonly tiers: readonly Tier[];

  // --- Choosing an instance --------------------------------------------------

  /** What the player gets to choose, in the order to show it. See `Choice`. */
  options(): readonly Choice[];

  /**
   * Build a spec from the chosen options and a fresh seed.
   *
   * The seed is supplied rather than taken, because a spec has to be reproducible and a
   * puzzle module may not use `Math.random()` — the determinism rule is not negotiable and
   * this is where it would most easily be broken.
   */
  specFrom(chosen: Readonly<Record<string, string>>, seed: string): Spec;

  /**
   * Make sense of a spec that arrived from outside: storage, a pasted link, an older
   * version of the app. Takes `unknown` because that is what it genuinely is.
   */
  normalise(raw: unknown): Spec;

  /** A spec as the parts of a shareable code, and back. Null when the parts are not ours. */
  encode(spec: Spec): readonly string[];
  decode(parts: readonly string[]): Spec | null;

  /**
   * Deterministic. The same spec must produce a byte-identical puzzle on every device,
   * forever — that is what makes a shareable game code and a dateless daily puzzle
   * possible with no server behind them.
   */
  generate(spec: Spec): Puzzle;

  // --- Playing it ------------------------------------------------------------

  /** The blank board a player starts from. */
  start(puzzle: Puzzle): State;

  /** Pure. Returns the new state, or null when the move is not legal. */
  apply(puzzle: Puzzle, state: State, move: Move): State | null;

  /** Human-imitating. See `SolveReport`. */
  solve(puzzle: Puzzle, from: State, maxTier: number): SolveReport;

  /**
   * The next thing to do from here — cheaply.
   *
   * Separate from `solve()` because a hint needs *one* deduction and `solve()` works the
   * whole puzzle out. On a 20x20 that is the difference between a button press and a
   * noticeable pause, and the pause would happen on every press.
   *
   * It must also return the **easiest** available deduction rather than the first one a
   * full-strength solver stumbles on. A hint that reaches for a contradiction proof when
   * an obvious overlap was sitting there teaches the wrong lesson.
   */
  hint?(puzzle: Puzzle, state: State, maxTier: number): Hint;

  isSolved(puzzle: Puzzle, state: State): boolean;
  /** 0..1, for the status line and the library card. */
  progress(puzzle: Puzzle, state: State): number;

  layout(puzzle: Puzzle, state: State): Scene;

  /** What a press on this cell means, given the tool in hand. Null for "nothing". */
  hit(puzzle: Puzzle, state: State, at: Cell, tool: string): Move | null;

  /**
   * The tools this puzzle offers, in toolbar order. The first is the default.
   *
   * A function of the puzzle, not a constant, because a number puzzle's tools are its
   * digits and a 4x4 has four of them where a 9x9 has nine. Offering nine buttons to a
   * child playing a 4x4 is not a cosmetic problem.
   *
   * `help` is written by the puzzle, not by the shell. The shell has no business knowing
   * what crossing a square out means, and a control whose explanation lives somewhere
   * else is a control whose explanation goes stale.
   */
  tools(puzzle: Puzzle): readonly {
    readonly id: string;
    readonly name: string;
    readonly help: string;
    /**
     * True if dragging across squares should repeat this tool.
     *
     * A property of the tool rather than of the puzzle, because that is where it actually
     * varies: filling a run of five squares one tap at a time is the first thing that
     * makes a nonogram tedious, and dragging a 7 across a number puzzle scatters sevens
     * nobody meant to put there. Absent means a press at a time.
     */
    readonly drag?: boolean;
  }[];

  // --- Saying what it is -----------------------------------------------------

  title(puzzle: Puzzle): string;
  describe(puzzle: Puzzle): Description;

  /**
   * How to play, in paragraphs. Plain text, never markup: the shell sets it as text, so a
   * puzzle module cannot inject anything into the page even if it wanted to.
   *
   * Here rather than in the shell's HTML because the shell's copy of it was written about
   * runs and clues, and read as nonsense the moment a second puzzle opened behind it.
   */
  readonly instructions: readonly string[];

  /**
   * The instance the demonstration should run on: small, fixed, and the same every time so
   * a teacher can talk about it. Absent means this puzzle cannot be demonstrated.
   */
  demoSpec?(): Spec;

  /**
   * State only. The puzzle itself is regenerated from the spec, so a save file is a few
   * bytes rather than a grid — the same decision that keeps a 2,000-piece jigsaw save
   * under a kilobyte.
   */
  serialise(state: State): string;
  deserialise(puzzle: Puzzle, data: string): State;

  /** The same scene language, sized for paper. Optional: not every puzzle prints. */
  printable?(puzzle: Puzzle): Scene;
}

/** Convenience: a module with its type parameters erased, for storing in a registry. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyPuzzleModule = PuzzleModule<any, any, any, any>;

/** The cells a step or a hint wants lit up, with the fallback applied in one place. */
export function lookCells(step: SolveStep): readonly Cell[] {
  return step.look ?? step.cells;
}
