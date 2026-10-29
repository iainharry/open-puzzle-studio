import { describe, expect, it } from 'vitest';
import { History, fingerprint } from '../history.js';

describe('History', () => {
  it('walks back and forward over several steps', () => {
    const history = new History();
    const states = ['a', 'ab', 'abc'];
    history.push(states[0]!, 'one');
    history.push(states[1]!, 'two');

    expect(history.undo(states[2]!)!.state).toBe(states[1]);
    expect(history.undo(states[1]!)!.state).toBe(states[0]);
    expect(history.canUndo).toBe(false);

    expect(history.redo(states[0]!)!.state).toBe(states[1]);
    expect(history.redo(states[1]!)!.state).toBe(states[2]);
    expect(history.canRedo).toBe(false);
  });

  /** Every editor behaves this way; the alternative is a tree nobody asked for. */
  it('drops the redo stack as soon as something new happens', () => {
    const history = new History();
    history.push('a', 'one');
    history.undo('ab');
    expect(history.canRedo).toBe(true);
    history.push('ab', 'two');
    expect(history.canRedo).toBe(false);
  });

  it('keeps the labels the right way round', () => {
    const history = new History();
    history.push('a', 'a mark');
    expect(history.undoLabel).toBe('a mark');
    history.undo('ab');
    expect(history.undoLabel).toBe(null);
    expect(history.redoLabel).toBe('a mark');
  });

  /**
   * An entry for an action that changed nothing reads as a broken undo rather than an
   * empty one, because pressing undo appears to do nothing.
   */
  it('discards an entry for an action that changed nothing', () => {
    const history = new History();
    history.push('a', 'a move that did nothing');
    history.discard();
    expect(history.canUndo).toBe(false);
  });

  it('forgets the oldest step rather than growing without limit', () => {
    const history = new History(3);
    for (let i = 0; i < 10; i++) history.push(`s${i}`, `step ${i}`);
    expect(history.depth).toBe(3);
    expect(history.undoLabel).toBe('step 9');
  });

  it('is emptied when a different puzzle is opened', () => {
    const history = new History();
    history.push('a', 'one');
    history.undo('ab');
    history.clear();
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });
});

describe('fingerprint', () => {
  it('is stable for the same state and different for a changed one', () => {
    expect(fingerprint('..#..')).toBe(fingerprint('..#..'));
    expect(fingerprint('..#..')).not.toBe(fingerprint('..#.#'));
  });

  /** A grid and the same grid with two cells swapped are different puzzles. */
  it('notices a transposition', () => {
    expect(fingerprint('#x...')).not.toBe(fingerprint('x#...'));
  });
});
