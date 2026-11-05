/**
 * One puzzle being played.
 *
 * The mid-end: it owns the state, the undo stack and the change watchdog, and it talks to
 * the puzzle only through `PuzzleModule`. Headless on purpose — no DOM, no canvas — so the
 * whole of "playing a puzzle" can be tested in Node, which is what makes the shell thin
 * enough to be worth trusting.
 *
 * Persistence is deliberately **not** here. A session takes an `onChange` callback and the
 * shell decides when to write; mixing IndexedDB into this file would drag a browser API
 * across the boundary that makes it testable.
 */

import { History, fingerprint } from './history.js';
import type { AnyPuzzleModule, Cell, Description, Hint, Scene } from './types.js';

export interface SessionOptions {
  /** Called after anything changes, so the shell can redraw and schedule a save. */
  onChange?: () => void;
}

export class Session {
  readonly history = new History();
  private state: unknown;
  private mark: number;
  private depth = 0;
  /**
   * How many times the state changed with no undo step recorded.
   *
   * Zero in a correct build. A counter rather than an exception, because a missed undo
   * step is a degraded feature and not a reason to stop mid-puzzle — but it is read by the
   * smoke test, which exercises every control and fails if it moves. That assertion is the
   * only thing that will keep undo correct as puzzle types are added, and a list of call
   * sites somebody remembered to wrap is not a test.
   */
  unguardedChanges = 0;
  private lastGuardAt = 0;

  constructor(
    readonly module: AnyPuzzleModule,
    readonly spec: unknown,
    readonly puzzle: unknown,
    initial?: string,
    private readonly options: SessionOptions = {},
  ) {
    this.state =
      initial === undefined
        ? module.start(puzzle)
        : module.deserialise(puzzle, initial);
    this.mark = fingerprint(this.serialise());
  }

  /** Build a session for a spec, generating the puzzle from it. */
  static create(
    module: AnyPuzzleModule,
    spec: unknown,
    initial?: string,
    options: SessionOptions = {},
  ): Session {
    return new Session(module, spec, module.generate(spec), initial, options);
  }

  serialise(): string {
    return this.module.serialise(this.state);
  }

  get solved(): boolean {
    return this.module.isSolved(this.puzzle, this.state);
  }

  get progress(): number {
    return this.module.progress(this.puzzle, this.state);
  }

  layout(): Scene {
    return this.module.layout(this.puzzle, this.state);
  }

  /** What a press on a cell would mean, without doing it. */
  moveFor(at: Cell, tool: string): unknown {
    return this.module.hit(this.puzzle, this.state, at, tool);
  }

  /**
   * The rest of `PuzzleModule`, with the puzzle and the state already supplied.
   *
   * These exist so the shell never has to reach for `session.state`, which it was doing
   * through a cast — `(session as unknown as { state: unknown }).state` — to ask for a
   * hint. A cast through `unknown` is the compiler being told to stop helping, and it was
   * the only place in the app that knew the session had a private field at all.
   */
  hint(maxTier: number): Hint | null {
    return this.module.hint ? this.module.hint(this.puzzle, this.state, maxTier) : null;
  }

  get tools(): ReturnType<AnyPuzzleModule['tools']> {
    return this.module.tools(this.puzzle);
  }

  get title(): string {
    return this.module.title(this.puzzle);
  }

  describe(): Description {
    return this.module.describe(this.puzzle);
  }

  /** The board as paper wants it: no player state, so it cannot be the answer. */
  printable(): Scene | null {
    return this.module.printable ? this.module.printable(this.puzzle) : null;
  }

  /**
   * Make a move. Returns true if anything actually changed.
   *
   * The undo entry is pushed *before* the move and thrown away if the move turned out to
   * be a no-op, so the stack never fills with steps that appear to do nothing.
   */
  play(move: unknown, label = 'a move'): boolean {
    if (move === null || move === undefined) return false;
    return this.change(label, () => {
      const next = this.module.apply(this.puzzle, this.state, move);
      if (next === null) return;
      this.state = next;
    });
  }

  /**
   * Open an undo step that spans more than one call.
   *
   * A drag across five cells is five `play()` calls and **one** thing the player did. One
   * step per cell means undoing a twenty-cell stroke takes twenty presses, which is not
   * an undo feature so much as a way to lose patience. The shell brackets a whole pointer
   * stroke in `beginChange`/`endChange`; everything inside collapses into one entry.
   *
   * Always paired. `endChange()` in a `finally`, or the stack is left open and the next
   * move joins a step it has nothing to do with.
   */
  beginChange(label: string): void {
    if (this.depth++ === 0) this.history.push(this.serialise(), label);
  }

  /** Closes the step, and throws it away if nothing actually changed. */
  endChange(): boolean {
    if (--this.depth > 0) return false;
    this.depth = 0;
    const now = fingerprint(this.serialise());
    if (now === this.mark) {
      this.history.discard();
      return false;
    }
    this.mark = now;
    this.options.onChange?.();
    return true;
  }

  /**
   * Run something that may change the state, with one undo step around it.
   *
   * Nested calls collapse into one step: an action that internally does two things is one
   * thing to the person who did it.
   */
  change(label: string, run: () => void): boolean {
    this.beginChange(label);
    let changed = false;
    try {
      run();
    } finally {
      // Closed in a finally so a throwing move cannot leave the step open -- and assigned
      // rather than returned from here, because a `return` inside `finally` would swallow
      // the exception it was meant to survive.
      changed = this.endChange();
    }
    return changed;
  }

  undo(): string | null {
    const step = this.history.undo(this.serialise());
    if (!step) return null;
    this.state = this.module.deserialise(this.puzzle, step.state);
    this.mark = fingerprint(step.state);
    this.options.onChange?.();
    return step.label;
  }

  redo(): string | null {
    const step = this.history.redo(this.serialise());
    if (!step) return null;
    this.state = this.module.deserialise(this.puzzle, step.state);
    this.mark = fingerprint(step.state);
    this.options.onChange?.();
    return step.label;
  }

  /**
   * The watchdog. Call it from the frame loop; it throttles itself.
   *
   * `now` is injectable so a test can drive it without waiting a quarter of a second.
   */
  checkGuard(now: number = Date.now()): void {
    if (this.depth > 0) return;
    if (now - this.lastGuardAt < 250) return;
    this.lastGuardAt = now;
    const current = fingerprint(this.serialise());
    if (current === this.mark) return;
    this.unguardedChanges++;
    // Resynced, so one unwrapped action is reported once rather than on every frame for
    // the rest of the session.
    this.mark = current;
  }
}
