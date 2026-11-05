import { describe, expect, it } from 'vitest';
import { buildScript } from '../demo.js';
import { sheetHtml } from '../sheet.js';
import { pictureLogic } from '../../puzzles/pictureLogic/index.js';
import { numberPlace } from '../../puzzles/numberPlace/index.js';

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
  const html = sheetHtml(
    pictureLogic.printable!(puzzle),
    'Heart',
    'picture-logic.d.heart.x',
    pictureLogic.blurb,
  );

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

  /**
   * The line under the title used to be the words "Fill the squares the numbers describe."
   * written into `sheet.ts`. True of the only puzzle that existed; nonsense about the
   * second one, and printed on its sheets.
   */
  it('takes the line about what to do from the puzzle, not from this file', () => {
    expect(html).toContain(pictureLogic.blurb);
    expect(html).not.toContain(numberPlace.blurb);
  });
});

/**
 * The second puzzle on paper.
 *
 * Here the dangerous sheet is not one with the picture filled in but one with the player's
 * working on it, or the whole answer. Same guarantee, same mechanism: `printable()` is
 * handed no player state, so there is nothing for it to print but the starting board.
 */
describe('the printed Number Place sheet', () => {
  const puzzle = numberPlace.generate(numberPlace.demoSpec!());
  const sixSpec = numberPlace.normalise({ size: 6, tier: 'steady', seed: 'paper' });
  const six = numberPlace.generate(sixSpec);
  const html = sheetHtml(
    numberPlace.printable!(six),
    numberPlace.title(six),
    'number-place.6.steady.n.paper',
    numberPlace.blurb,
  );
  const givens = six.givens.filter(Boolean).length;

  it('prints exactly the numbers the puzzle gave, and no others', () => {
    // Three texts belong to the page itself: the title, the line about what to do, and the
    // code along the bottom. Everything else in the SVG is a given.
    const texts = (html.match(/<text /g) ?? []).length;
    expect(texts).toBe(givens + 3);
    expect(givens).toBeLessThan(36);
  });

  /** Shaded squares, so the paper says which numbers were given, as the screen does. */
  it('tints the given squares rather than leaving the paper to guess', () => {
    expect((html.match(/<rect /g) ?? []).length).toBe(givens);
    expect(html).toContain('font-weight="700"');
  });

  /** The boxes have to be visible, and on a 6x6 they are 2 tall and 3 wide. */
  it('draws the heavier box lines in both directions', () => {
    const heavy = (html.match(/stroke-width="0.5"/g) ?? []).length;
    // Seven lines each way, of which the box boundaries and the edges are heavy: columns
    // 0, 3, 6 and rows 0, 2, 4, 6.
    expect(heavy).toBe(3 + 4);
  });

  it('carries the code, so the paper and the screen are the same puzzle', () => {
    expect(html).toContain('number-place.6.steady.n.paper');
    expect(html).toContain(numberPlace.blurb);
  });

  it('is A4, vector, and small', () => {
    expect(html).toMatch(/size: A4 portrait/);
    expect(html).toMatch(/width="210mm" height="297mm"/);
    expect(html).not.toContain('data:image');
    expect(html.length).toBeLessThan(40_000);
  });

  it('prints a shape board as shapes', () => {
    const shapes = numberPlace.generate(
      numberPlace.normalise({ size: 4, tier: 'gentle', seed: 'paper', glyphs: 'shapes' }),
    );
    const sheet = sheetHtml(numberPlace.printable!(shapes), 'Shapes', 'c', numberPlace.blurb);
    expect(sheet).toContain('●');
    expect(sheet).not.toMatch(/>[1-9]<\/text>/);
  });

  it('is the demonstration board when that is what is open', () => {
    expect(numberPlace.printable!(puzzle).labels.length).toBe(
      puzzle.givens.filter(Boolean).length,
    );
  });
});
