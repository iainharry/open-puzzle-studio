/**
 * The Number Place solver.
 *
 * Written before the generator, because rule 11 of the constitution says so and because
 * the first puzzle proved why: a grid dug out at random has more than one answer most of
 * the time, and looks completely fine. The solver is what makes a generated puzzle honest,
 * what rates it, and what gives the hints — one piece of machinery, three features.
 *
 * ## The three tiers, and why they are these three
 *
 * Each tier is a *kind of looking*, not a list of patterns, and each one has to be
 * explainable to a child in one sentence. That constraint threw out more techniques than
 * it kept, and the cut is deliberate.
 *
 * - **1, Gentle.** "Only one square left in this row" and "only one number left for this
 *   square". Both are found by looking at what is already written down.
 * - **2, Steady.** "This number can only go in one square in this box." The same
 *   information read the other way round, which is the first real technique and the one
 *   worth teaching.
 * - **3, Tricky.** Suppose a number goes in a square, follow it, and find that something
 *   breaks — so it does not go there. One step deep, never more.
 *
 * ## What is deliberately not here
 *
 * No naked pairs, no pointing pairs, no X-wings. They are all *elimination* techniques:
 * they rule a number out of a square without putting anything in. A player with no way to
 * write "not a 7 here" cannot use such a hint at all, and this app has no pencil marks
 * (see `index.ts` for why not). Probing at tier 3 subsumes most of their effect anyway,
 * because it only reports a result it can act on.
 *
 * The cost of that choice is stated rather than hidden: tier 3 here is weaker than a
 * full-strength Sudoku solver, so some grids a magazine would call hard are not generated.
 * That makes the app's difficulty labels conservative, which is the right direction to be
 * wrong in.
 */

import type { Cell, SolveStep } from '../../core/types.js';

export const EMPTY = 0;

export const GENTLE = 1;
export const STEADY = 2;
export const TRICKY = 3;

/** The shape of a board. A 6x6 has 2-tall, 3-wide boxes, which is why these are separate. */
export interface Board {
  readonly size: number;
  readonly boxRows: number;
  readonly boxCols: number;
}

/** Values, row-major. `EMPTY` for a square nobody has filled in. */
export type Cells = readonly number[];

/** A row, a column or a box: a group of squares that must hold each number exactly once. */
export interface Unit {
  readonly kind: 'row' | 'col' | 'box';
  /** Mid-sentence: "only one square left in row 3". */
  readonly name: string;
  /** Sentence-initial, and for the status line: "Row 3", "The top-left box". */
  readonly cap: string;
  readonly cells: readonly number[];
}

/** How a value is said. `String` for digits; a shape puzzle passes its own glyph names. */
export type NameOf = (value: number) => string;

// --- The geometry, worked out once -----------------------------------------

interface Geometry {
  readonly units: readonly Unit[];
  /** For each cell, the indices of the three units it belongs to. */
  readonly unitsOf: readonly (readonly number[])[];
  /** For each cell, every other cell sharing a unit with it. */
  readonly peers: readonly (readonly number[])[];
  /** Every value bit set. */
  readonly all: number;
}

const GEOMETRY = new Map<string, Geometry>();

const ACROSS_WORDS: Record<number, readonly string[]> = {
  1: ['', ''],
  2: ['left', 'right'],
  3: ['left', 'middle', 'right'],
};
const DOWN_WORDS: Record<number, readonly string[]> = {
  1: ['', ''],
  2: ['top', 'bottom'],
  3: ['top', 'middle', 'bottom'],
};

/**
 * Boxes named the way a person would point at them.
 *
 * "Box 4" means nothing to a seven-year-old and is ambiguous to everybody else, because
 * nobody agrees whether boxes are numbered across or down. "The top-left box" needs no
 * convention. The one awkward case — the centre box of a 3x3 arrangement — is "the middle
 * box" rather than "the middle-middle box".
 */
function boxName(down: number, across: number, downs: number, acrosses: number): string {
  const v = DOWN_WORDS[downs]?.[down];
  const h = ACROSS_WORDS[acrosses]?.[across];
  // A board whose boxes do not come in twos or threes has no words for them, so it says
  // where instead of guessing. No offered size does this; a future one might.
  if (v === undefined || h === undefined) {
    return `the box ${down + 1} down and ${across + 1} across`;
  }
  // Only the true centre of a three-by-three arrangement collapses. "The middle-left box"
  // has to keep its "middle", or all three left-hand boxes of a 6x6 are "the left box".
  if (v === 'middle' && h === 'middle') return 'the middle box';
  const parts = [v, h].filter((w) => w !== '');
  if (parts.length === 0) return 'the box';
  return `the ${parts.join('-')} box`;
}

export function geometryOf(board: Board): Geometry {
  const key = `${board.size}:${board.boxRows}:${board.boxCols}`;
  const cached = GEOMETRY.get(key);
  if (cached) return cached;

  const { size, boxRows, boxCols } = board;
  const units: Unit[] = [];

  for (let r = 0; r < size; r++) {
    const cells: number[] = [];
    for (let c = 0; c < size; c++) cells.push(r * size + c);
    units.push({ kind: 'row', name: `row ${r + 1}`, cap: `Row ${r + 1}`, cells });
  }
  for (let c = 0; c < size; c++) {
    const cells: number[] = [];
    for (let r = 0; r < size; r++) cells.push(r * size + c);
    units.push({ kind: 'col', name: `column ${c + 1}`, cap: `Column ${c + 1}`, cells });
  }
  const downs = Math.floor(size / boxRows);
  const acrosses = Math.floor(size / boxCols);
  for (let bd = 0; bd < downs; bd++) {
    for (let ba = 0; ba < acrosses; ba++) {
      const cells: number[] = [];
      for (let r = 0; r < boxRows; r++) {
        for (let c = 0; c < boxCols; c++) {
          cells.push((bd * boxRows + r) * size + (ba * boxCols + c));
        }
      }
      const name = boxName(bd, ba, downs, acrosses);
      units.push({ kind: 'box', name, cells, cap: name[0]!.toUpperCase() + name.slice(1) });
    }
  }

  const unitsOf: number[][] = Array.from({ length: size * size }, () => []);
  units.forEach((unit, u) => {
    for (const cell of unit.cells) unitsOf[cell]!.push(u);
  });
  const peers: number[][] = [];
  for (let i = 0; i < size * size; i++) {
    const set = new Set<number>();
    for (const u of unitsOf[i]!) for (const cell of units[u]!.cells) set.add(cell);
    set.delete(i);
    peers.push([...set]);
  }

  const geometry: Geometry = {
    units,
    unitsOf,
    peers,
    all: (1 << size) - 1,
  };
  GEOMETRY.set(key, geometry);
  return geometry;
}

export function cellOf(board: Board, index: number): Cell {
  return { col: index % board.size, row: Math.floor(index / board.size) };
}

function bit(value: number): number {
  return 1 << (value - 1);
}

function valuesIn(mask: number): number[] {
  const out: number[] = [];
  for (let v = 1; mask >>> (v - 1); v++) if (mask & bit(v)) out.push(v);
  return out;
}

function count(mask: number): number {
  let n = 0;
  for (let m = mask; m; m >>= 1) if (m & 1) n++;
  return n;
}

/** What each empty square could still hold, from its peers alone. 0 for a filled square. */
export function candidates(board: Board, cells: Cells): number[] {
  const geo = geometryOf(board);
  const out = new Array<number>(cells.length).fill(0);
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] !== EMPTY) continue;
    let mask = geo.all;
    for (const p of geo.peers[i]!) {
      const v = cells[p]!;
      if (v !== EMPTY) mask &= ~bit(v);
    }
    out[i] = mask;
  }
  return out;
}

/** Spoken list: "1, 2 and 4". For the only-choice explanation. */
function listOf(values: readonly number[], name: NameOf): string {
  const words = values.map(name);
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]!}`;
}

// --- Is what the player has written down possible at all? -------------------

/**
 * The first unit that cannot be completed, or null.
 *
 * **Checked before any hint is offered**, for the reason the first puzzle established: a
 * deduction made from a wrong board is a deduction from a false premise, and it sends the
 * player further wrong. It is also the failure they cannot find by staring, because the
 * mistake is usually nowhere near where they are looking.
 *
 * Two kinds, in order of how clearly they can be explained:
 *
 * 1. **A repeat.** The same number twice in one unit. Unmissable once pointed at.
 * 2. **Nowhere left.** A unit missing a number with no empty square able to take it.
 *
 * What this does *not* catch: a single wrong entry that happens to break nothing yet. The
 * answer key would catch it instantly, and is deliberately not consulted — a hint in this
 * app is a piece of reasoning the player could have done, never a look at the back of the
 * book. Picture Logic has exactly the same limitation for the same reason.
 */
export function firstBrokenUnit(
  board: Board,
  cells: Cells,
  name: NameOf = String,
): { unit: Unit; why: string } | null {
  const geo = geometryOf(board);

  for (const unit of geo.units) {
    let seen = 0;
    for (const i of unit.cells) {
      const v = cells[i]!;
      if (v === EMPTY) continue;
      if (seen & bit(v)) {
        return {
          unit,
          why:
            `There are two ${name(v)}s in ${unit.name}, and there can only ever be one. ` +
            `Check that one again before going on.`,
        };
      }
      seen |= bit(v);
    }
  }

  const cand = candidates(board, cells);
  for (const unit of geo.units) {
    let present = 0;
    for (const i of unit.cells) {
      const v = cells[i]!;
      if (v !== EMPTY) present |= bit(v);
    }
    for (const v of valuesIn(geo.all & ~present)) {
      const room = unit.cells.some((i) => cells[i] === EMPTY && cand[i]! & bit(v));
      if (!room) {
        return {
          unit,
          why:
            `There is nowhere left for the ${name(v)} in ${unit.name} — every empty square ` +
            `there is blocked by a ${name(v)} somewhere else. Something already written in ` +
            `or around that line must be wrong.`,
        };
      }
    }
  }

  return null;
}

// --- One deduction ----------------------------------------------------------

function step(
  board: Board,
  index: number,
  value: number,
  technique: string,
  tier: number,
  why: string,
  look: readonly number[],
  where: string,
): SolveStep {
  const cell = cellOf(board, index);
  return {
    technique,
    tier,
    cells: [cell],
    why,
    look: look.map((i) => cellOf(board, i)),
    where,
    moves: [{ col: cell.col, row: cell.row, value }],
  };
}

/** The box a square is in. Used for "where to look" when the deduction is about one square. */
function boxOf(board: Board, index: number): Unit {
  const geo = geometryOf(board);
  for (const u of geo.unitsOf[index]!) {
    const unit = geo.units[u]!;
    if (unit.kind === 'box') return unit;
  }
  return geo.units[0]!;
}

/**
 * The easiest deduction available from here, or null.
 *
 * **Easiest, not first.** A hint that reaches for a contradiction proof while an obvious
 * "only one square left" was sitting two rows up teaches the wrong lesson about how these
 * are solved. So the tiers are tried in order, and within tier 1 the more visible technique
 * goes first.
 */
export function nextStep(
  board: Board,
  cells: Cells,
  maxTier: number,
  name: NameOf = String,
): SolveStep | null {
  const geo = geometryOf(board);
  const cand = candidates(board, cells);

  // --- Tier 1: only one square left in a unit.
  for (const unit of geo.units) {
    const empties = unit.cells.filter((i) => cells[i] === EMPTY);
    if (empties.length !== 1) continue;
    let present = 0;
    for (const i of unit.cells) {
      const v = cells[i]!;
      if (v !== EMPTY) present |= bit(v);
    }
    const missing = valuesIn(geo.all & ~present);
    if (missing.length !== 1) continue;
    const index = empties[0]!;
    const value = missing[0]!;
    return step(
      board,
      index,
      value,
      'last-in-unit',
      GENTLE,
      `There is only one empty square left in ${unit.name}, and the only number missing ` +
        `from it is ${name(value)}. So that is what goes there.`,
      unit.cells,
      unit.cap,
    );
  }

  // --- Tier 1: only one number left for a square.
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] !== EMPTY) continue;
    const mask = cand[i]!;
    if (count(mask) !== 1) continue;
    const value = valuesIn(mask)[0]!;
    const blocked = valuesIn(geo.all & ~mask);
    const box = boxOf(board, i);
    return step(
      board,
      i,
      value,
      'only-choice',
      GENTLE,
      `This square already has ${listOf(blocked, name)} somewhere in its row, its column ` +
        `or its box, so the only number left for it is ${name(value)}.`,
      box.cells,
      box.cap,
    );
  }

  if (maxTier < STEADY) return null;

  // --- Tier 2: a number that fits in only one square of a unit.
  for (const unit of geo.units) {
    let present = 0;
    for (const i of unit.cells) {
      const v = cells[i]!;
      if (v !== EMPTY) present |= bit(v);
    }
    for (const value of valuesIn(geo.all & ~present)) {
      const places = unit.cells.filter((i) => cells[i] === EMPTY && cand[i]! & bit(value));
      if (places.length !== 1) continue;
      const index = places[0]!;
      return step(
        board,
        index,
        value,
        'only-place',
        STEADY,
        `In ${unit.name}, the ${name(value)} can only go in one square: every other empty ` +
          `square there is already blocked by a ${name(value)} in its row, its column or ` +
          `its box. So the ${name(value)} goes here.`,
        unit.cells,
        unit.cap,
      );
    }
  }

  if (maxTier < TRICKY) return null;

  // --- Tier 3: suppose, and find that it breaks.
  //
  // Squares with the fewest options first. Two options is where this reads best — "it is
  // not the 7, so it is the 2" is a sentence a child can follow — and it is also the
  // cheapest place to look, so the ordering serves legibility and speed at once.
  const order = [];
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] === EMPTY && count(cand[i]!) >= 2) order.push(i);
  }
  order.sort((a, b) => count(cand[a]!) - count(cand[b]!));

  for (const index of order) {
    const options = valuesIn(cand[index]!);
    const survivors: number[] = [];
    let failed = 0;
    for (const value of options) {
      const trial = [...cells];
      trial[index] = value;
      if (propagate(board, trial, STEADY) === 'broken') failed = value;
      else survivors.push(value);
      // No point proving a third option impossible once two have survived.
      if (survivors.length > 1) break;
    }
    if (survivors.length !== 1 || failed === 0) continue;
    const value = survivors[0]!;
    const box = boxOf(board, index);
    return step(
      board,
      index,
      value,
      'probe',
      TRICKY,
      `Suppose this square were ${name(failed)}. Work that through and another square is ` +
        `left with no number it can take at all — so it cannot be ${name(failed)}. ` +
        `The only number left for it is ${name(value)}.`,
      box.cells,
      box.cap,
    );
  }

  return null;
}

/**
 * Fill in everything the tiers up to `maxTier` can reach, in place.
 *
 * Used inside probing, so it has to be cheap and must never guess. `broken` means the grid
 * cannot be completed — which, inside a probe, is the result being looked for.
 */
export function propagate(
  board: Board,
  cells: number[],
  maxTier: number,
): 'solved' | 'stuck' | 'broken' {
  const geo = geometryOf(board);
  for (;;) {
    const cand = candidates(board, cells);
    let progress = false;
    let empties = 0;

    for (let i = 0; i < cells.length; i++) {
      if (cells[i] !== EMPTY) continue;
      empties++;
      const mask = cand[i]!;
      if (mask === 0) return 'broken';
      if (count(mask) === 1) {
        cells[i] = valuesIn(mask)[0]!;
        progress = true;
      }
    }
    if (empties === 0) return 'solved';
    if (progress) continue;

    if (maxTier >= STEADY) {
      // One placement, then straight back to recomputing candidates. Placing a second from
      // the same stale candidate table is how a propagator quietly writes a wrong number
      // into a square it had already filled.
      outer: for (const unit of geo.units) {
        let present = 0;
        for (const i of unit.cells) {
          const v = cells[i]!;
          if (v !== EMPTY) present |= bit(v);
        }
        for (const value of valuesIn(geo.all & ~present)) {
          const places = unit.cells.filter((i) => cells[i] === EMPTY && cand[i]! & bit(value));
          if (places.length === 0) return 'broken';
          if (places.length === 1) {
            cells[places[0]!] = value;
            progress = true;
            break outer;
          }
        }
      }
    }
    if (!progress) return 'stuck';
  }
}

/**
 * Solve from wherever the board is, reporting every deduction in order.
 *
 * `maxSteps` is a guard rather than a feature: a solver that cannot finish should stop
 * rather than spin, and generation calls this thousands of times.
 */
export function solveGrid(
  board: Board,
  from: Cells,
  maxTier: number,
  name: NameOf = String,
  maxSteps = board.size * board.size + 4,
): { solved: boolean; steps: SolveStep[]; tierUsed: number; cells: number[] } {
  const cells = [...from];
  const steps: SolveStep[] = [];
  let tierUsed = 0;

  if (firstBrokenUnit(board, cells, name)) {
    return { solved: false, steps, tierUsed, cells };
  }

  for (let n = 0; n < maxSteps; n++) {
    if (cells.every((v) => v !== EMPTY)) break;
    const found = nextStep(board, cells, maxTier, name);
    if (!found) break;
    steps.push(found);
    tierUsed = Math.max(tierUsed, found.tier);
    for (const move of found.moves ?? []) {
      const m = move as { col: number; row: number; value: number };
      cells[m.row * board.size + m.col] = m.value;
    }
  }

  return { solved: cells.every((v) => v !== EMPTY), steps, tierUsed, cells };
}

/**
 * How many answers a grid has, counted up to a cap by exhaustive search.
 *
 * Not used by the generator — a puzzle the solver finishes by reasoning alone is unique by
 * construction, because every deduction it makes is forced. This exists so the **tests**
 * can check that claim independently rather than take it on trust, which is the sort of
 * assumption the sister project learned to stop making.
 */
export function countSolutions(board: Board, cells: Cells, cap = 2): number {
  const work = [...cells];
  let found = 0;

  const search = (): void => {
    if (found >= cap) return;
    const cand = candidates(board, work);
    let best = -1;
    let bestCount = Infinity;
    for (let i = 0; i < work.length; i++) {
      if (work[i] !== EMPTY) continue;
      const n = count(cand[i]!);
      if (n === 0) return;
      if (n < bestCount) {
        bestCount = n;
        best = i;
      }
    }
    if (best === -1) {
      found++;
      return;
    }
    for (const value of valuesIn(cand[best]!)) {
      work[best] = value;
      search();
      work[best] = EMPTY;
      if (found >= cap) return;
    }
  };

  search();
  return found;
}
