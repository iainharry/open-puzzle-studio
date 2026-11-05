/**
 * The app solving a puzzle in front of you.
 *
 * Asked for as "a video or demonstration clip", and deliberately **not** built as one.
 *
 * A video would be the largest asset in the build by an order of magnitude, would have to
 * be downloaded before the app worked offline, could not follow the theme or the board
 * size, could not be paused on the step you did not understand, and would go stale the
 * first time a button moved — the same failure as a hand-written guide, which is precisely
 * why the sister project generates its guide from the live app instead of shipping one.
 *
 * This is the app playing itself with the real solver on the real board. It costs a few
 * kilobytes of code and no asset at all, it cannot go out of date because there is nothing
 * to keep in step, and it is steppable, which a video is not. It is only cheap because
 * M2 and M3 exist: a solver that already emits ordered deductions, each with a plain
 * sentence and the moves to carry it out, *is* a demonstration script.
 *
 * What a clip of a person would still show that this does not: a hand, and the hesitation
 * before a move. So the demo draws a pointer onto the square it is about to mark and
 * pauses on each caption before acting, because a demonstration that happens instantly
 * teaches nothing.
 */

import { lookCells, type AnyPuzzleModule, type Cell } from '../core/index.js';

export interface Beat {
  /** What to say while this beat is on screen. */
  readonly caption: string;
  /** Squares to light up before anything is marked. */
  readonly look: readonly Cell[];
  /** Applied one at a time, with the pointer moving to each. */
  readonly moves: readonly unknown[];
  readonly cells: readonly Cell[];
}

/**
 * Turn a puzzle into a sequence of beats, by solving it.
 *
 * Capped, because a demonstration is not a complete solution: somebody who has watched ten
 * deductions has got the idea, and the eleventh is where they should be taking over. The
 * last beat says so.
 */
export function buildScript(
  module: AnyPuzzleModule,
  puzzle: unknown,
  maxBeats = 10,
): { beats: Beat[]; finishes: boolean } {
  if (!module.hint) return { beats: [], finishes: false };

  const beats: Beat[] = [];
  let state = module.start(puzzle);
  let finishes = false;

  for (let i = 0; i < maxBeats; i++) {
    const hint = module.hint(puzzle, state, 1);
    if (hint.kind !== 'step') {
      finishes = hint.kind === 'done';
      break;
    }
    const step = hint.step;
    const moves = (step.moves ?? []) as unknown[];
    if (moves.length === 0) break;

    beats.push({
      caption: step.why,
      // The puzzle says which squares its reasoning is about. This file used to work them
      // out from an axis and an index, which meant the demonstration knew how a grid is
      // laid out — fine for one puzzle, wrong the moment a deduction was about a box.
      look: lookCells(step),
      moves,
      cells: step.cells,
    });
    for (const move of moves) {
      state = module.apply(puzzle, state, move) ?? state;
    }
  }

  if (beats.length === maxBeats && module.isSolved(puzzle, state) === false) {
    finishes = false;
  } else if (module.isSolved(puzzle, state)) {
    finishes = true;
  }
  return { beats, finishes };
}

/** How long each phase of a beat lasts. Slow enough to follow; a demo is not a speed run. */
export const TIMING = {
  /** Reading the caption and seeing which line it is about. */
  look: 1900,
  /** Between one square being marked and the next. */
  mark: 260,
  /** After the last square, before moving on. */
  settle: 700,
} as const;
