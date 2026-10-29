/**
 * Undo and redo, generic over the puzzle.
 *
 * Carried over from Open Jigsaw Studio M22 and generalised. The reasoning that made it
 * snapshot-based there applies more strongly here: a command log needs an inverse written
 * per move type, and a collection app grows new move types every time a puzzle is added.
 * A snapshot is correct by construction and stays correct when somebody adds a puzzle in
 * 2027 without reading this file.
 *
 * Snapshots are the module's **serialised** state — a string. That keeps the mid-end
 * genuinely puzzle-agnostic, makes the fingerprint trivial, and costs nothing while
 * puzzle states are grids of a few thousand cells. If a puzzle ever appears whose state is
 * megabytes, this is the file to revisit.
 *
 * ## The watchdog is the part worth keeping
 *
 * An undo feature does not rot by being wrong on the day it ships. It rots because somebody
 * adds a feature later and does not record a step, and undo quietly skips that one action.
 * So the session keeps a fingerprint of the state as of the last recorded step and compares
 * it; a mismatch with no change in flight means something moved without leaving a way back.
 * In the jigsaw app the smoke test presses every control and fails if that counter moves,
 * and that assertion is the only thing that kept undo correct across three milestones.
 */

/** How many steps back you can go. */
export const CAP = 40;

export interface Step {
  readonly label: string;
  readonly state: string;
}

export class History {
  private readonly past: Step[] = [];
  private readonly future: Step[] = [];

  constructor(private readonly cap: number = CAP) {}

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get undoLabel(): string | null {
    return this.past[this.past.length - 1]?.label ?? null;
  }

  get redoLabel(): string | null {
    return this.future[this.future.length - 1]?.label ?? null;
  }

  get depth(): number {
    return this.past.length;
  }

  /** Record where the puzzle was, before `label` happens. */
  push(state: string, label: string): void {
    this.past.push({ state, label });
    // Doing something new makes the future unreachable. Every editor behaves this way and
    // the alternative is a tree, which is a user interface problem nobody asked for.
    this.future.length = 0;
    if (this.past.length > this.cap) this.past.shift();
  }

  /**
   * Throw away the entry just pushed, for an action that turned out to change nothing.
   * Without this the stack fills with steps that appear to do nothing when undone, which
   * reads as a broken undo rather than as an empty one.
   */
  discard(): void {
    this.past.pop();
  }

  undo(now: string): Step | null {
    const step = this.past.pop();
    if (!step) return null;
    this.future.push({ state: now, label: step.label });
    return step;
  }

  redo(now: string): Step | null {
    const step = this.future.pop();
    if (!step) return null;
    this.past.push({ state: now, label: step.label });
    return step;
  }

  /** After starting a different puzzle: the old states describe a board that is gone. */
  clear(): void {
    this.past.length = 0;
    this.future.length = 0;
  }
}

/**
 * A number that changes whenever the serialised state does.
 *
 * Not a cryptographic hash and not trying to be. It exists so the session can ask "did
 * that actually change anything?" twice: once to throw away an undo entry for a no-op, and
 * once as the watchdog above.
 */
export function fingerprint(serialised: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < serialised.length; i++) {
    h ^= serialised.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
