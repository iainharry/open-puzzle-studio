import { describe, expect, it } from 'vitest';
import { buildScript } from '../demo.js';
import { sheetHtml } from '../sheet.js';
import { pictureLogic } from '../../puzzles/pictureLogic/index.js';

function heart() {
  return pictureLogic.generate({ kind: 'drawn' as const, picture: 'heart' });
}

describe('the demonstration script', () => {
  it('is built from the real solver, so it has real steps', () => {
    const { beats } = buildScript(pictureLogic, heart());
    expect(beats.length).toBeGreaterThan(2);
    for (const beat of beats) {
      expect(beat.caption.length).toBeGreaterThan(20);
      expect(beat.moves.length).toBeGreaterThan(0);
      expect(beat.cells.length).toBe(beat.moves.length);
    }
  });

  /** Every beat says which line it is about, which is what the highlight needs. */
  it('lights up the line each step is about', () => {
    const { beats } = buildScript(pictureLogic, heart());
    for (const beat of beats) {
      expect(beat.look.length).toBeGreaterThanOrEqual(beat.cells.length);
    }
  });

  /**
   * Following the script has to leave a board that is genuinely further on. A
   * demonstration whose moves do nothing is a demonstration of nothing.
   */
  it('actually advances the puzzle', () => {
    const puzzle = heart();
    const { beats } = buildScript(pictureLogic, puzzle);
    let state = pictureLogic.start(puzzle);
    const before = pictureLogic.serialise(state);
    for (const beat of beats) {
      for (const move of beat.moves) {
        state = pictureLogic.apply(puzzle, state, move as never) ?? state;
      }
    }
    expect(pictureLogic.serialise(state)).not.toBe(before);
    expect(pictureLogic.progress(puzzle, state)).toBeGreaterThan(0.3);
  });

  /**
   * Only the easiest deductions. A demonstration that reaches for a contradiction proof
   * teaches a beginner the wrong thing about how these are solved, and this is built with
   * `maxTier` 1 so that it cannot.
   */
  it('shows only the simplest kind of reasoning', () => {
    const puzzle = heart();
    const { beats } = buildScript(pictureLogic, puzzle);
    // Every caption is one of the plain-language ones, never the probing explanation.
    for (const beat of beats) {
      expect(beat.caption).not.toMatch(/Suppose this square/);
    }
  });

  /**
   * Capped. Somebody who has watched ten deductions has the idea; the eleventh is where
   * they should be taking over.
   */
  it('stops rather than solving the whole thing for you', () => {
    const { beats } = buildScript(pictureLogic, heart(), 3);
    expect(beats.length).toBe(3);
  });

  it('says nothing for a module that cannot hint', () => {
    const noHints = { ...pictureLogic, hint: undefined };
    expect(buildScript(noHints as never, heart()).beats).toEqual([]);
  });
});

describe('the printed sheet', () => {
  const puzzle = heart();
  const html = sheetHtml(pictureLogic.printable!(puzzle), 'Heart', 'picture-logic.d.heart.x');

  /**
   * **The one that matters.** The sister project shipped a printable sheet that drew the
   * answer into the frame and passed four assertions, because each checked that something
   * had been drawn rather than what it showed.
   *
   * A nonogram sheet is right when it has the numbers and an empty grid. So this counts
   * what is actually in the SVG: lines and text, and no filled squares at all.
   */
  it('prints the numbers and an empty grid, never the answer', () => {
    const filledShapes = (html.match(/<rect|<path/g) ?? []).length;
    expect(filledShapes).toBe(0);
    const lines = (html.match(/<line /g) ?? []).length;
    // Six lines each way for a 5x5, plus nothing else.
    expect(lines).toBe(12);
  });

  it('prints every clue', () => {
    const numbers = [...html.matchAll(/>(\d+)<\/text>/g)].map((m) => m[1]);
    const wanted = [...puzzle.rowClues.flat(), ...puzzle.colClues.flat()].map(String);
    expect(numbers.sort()).toEqual(wanted.sort());
  });

  /** A sheet without its code cannot be picked up again on screen. */
  it('carries the code, so the paper and the screen are the same puzzle', () => {
    expect(html).toContain('picture-logic.d.heart.x');
  });

  it('is A4 and fits on one page', () => {
    expect(html).toMatch(/size: A4 portrait/);
    expect(html).toMatch(/width="210mm" height="297mm"/);
  });

  /** It is text, not pixels: a printed clue has to be readable at arm's length. */
  it('is vector, and small', () => {
    expect(html).toContain('<svg');
    expect(html).not.toContain('data:image');
    expect(html.length).toBeLessThan(40_000);
  });

  it('escapes a title rather than letting it become markup', () => {
    const nasty = sheetHtml(pictureLogic.printable!(puzzle), '<script>x</script>', 'c');
    expect(nasty).not.toContain('<script>x');
    expect(nasty).toContain('&lt;script&gt;');
  });
});
