/**
 * The shell: toolbar, canvas, status.
 *
 * It knows about `PuzzleModule`, `Session` and `Scene`, and nothing about any particular
 * puzzle.
 *
 * ## That claim used to be false, and this is what it cost
 *
 * The same sentence stood at the top of this file from M1 to M4, together with "if a line
 * in this file ever mentions a clue, a run or a picture, the seam this milestone exists to
 * prove has leaked and that is the bug". By M4 the file mentioned pictures, clues and runs
 * in fourteen places and imported the nonogram module directly, and nothing could tell,
 * because the only puzzle that existed was a nonogram.
 *
 * What was actually in here, doing one puzzle's work:
 *
 * - `import { PICTURE_NAMES, normaliseSpec, pictureLogic } from '../puzzles/pictureLogic'`,
 *   and `tierName` from its generator.
 * - A hard-coded size list, `[5, 7, 8, 10, 12, 15, 20]`, offered to every puzzle.
 * - A "Starter" dropdown built from the nonogram's hand-drawn pictures.
 * - `codeFor` and `specFromCode`, which knew the shape of a nonogram spec.
 * - `chosenSpec(): PictureSpec` — the return type says it all.
 * - A help panel written in HTML about runs, clues and crossing out.
 * - "% of the picture filled in" in the status line.
 * - The demonstration's puzzle, `{ kind: 'drawn', picture: 'heart' }`, named here.
 * - Space swapping between `'fill'` and `'cross'` by name.
 * - `puzzle as { rows, cols, tierUsed, title }`, four times, because the interface had no
 *   way to ask.
 *
 * All of it is now asked of the module. The file is about the same length, which is the
 * honest outcome: the work did not vanish, it moved to where it belongs, and the same
 * controls now drive a puzzle the shell has never heard of. That is the thing the three
 * layers were for, and until a second puzzle existed there was no way to know whether it
 * was true.
 */

import {
  Session,
  dailySeed,
  decodeGameId,
  encodeGameId,
  lookCells,
  type AnyPuzzleModule,
  type Cell,
} from '../core/index.js';
import {
  deletePuzzle,
  getLastOpened,
  getPuzzle,
  listPuzzles,
  newId,
  putPuzzle,
  setLastOpened,
  type PuzzleRecord,
} from '../core/storage.js';
import {
  DARK,
  LIGHT,
  cellAt,
  drawPointer,
  drawScene,
  type Layout,
  type Theme,
} from '../render/scene.js';
import { pictureLogic } from '../puzzles/pictureLogic/index.js';
import { numberPlace } from '../puzzles/numberPlace/index.js';
import { TIMING, buildScript, type Beat } from './demo.js';
import { sheetHtml } from './sheet.js';
import {
  celebrationBuzz,
  celebrationPlan,
  playFanfare,
  runCelebration,
  type CelebrationLevel,
} from './celebrate.js';

declare const __APP_VERSION__: string;
const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'development build';

/**
 * Every puzzle type the app knows, in the order they are offered.
 *
 * The only two lines in this file that name a puzzle, and they are a registry rather than
 * a dependency: nothing below reads either name again.
 */
const MODULES: readonly AnyPuzzleModule[] = [pictureLogic, numberPlace];
const BY_ID: Record<string, AnyPuzzleModule> = Object.fromEntries(
  MODULES.map((m) => [m.id, m]),
);

/** Four base-36 characters: 1.7 million puzzles per size, and writable on a whiteboard. */
function freshSeed(): string {
  return Math.floor(Math.random() * 1_679_616)
    .toString(36)
    .padStart(4, '0');
}

export class App {
  private readonly canvas: HTMLCanvasElement;
  private readonly els: {
    status: HTMLElement;
    undo: HTMLButtonElement;
    redo: HTMLButtonElement;
    tools: HTMLElement;
    puzzle: HTMLSelectElement;
    options: HTMLElement;
    code: HTMLInputElement;
    library: HTMLElement;
    libList: HTMLElement;
    help: HTMLElement;
    helpTitle: HTMLElement;
    helpBody: HTMLElement;
    hint: HTMLButtonElement;
    celebrateCanvas: HTMLCanvasElement;
    finishBanner: HTMLElement;
    finishDetail: HTMLElement;
    demoBar: HTMLElement;
    demoStep: HTMLElement;
    demoCaption: HTMLElement;
    demoPause: HTMLButtonElement;
  };

  private session: Session | null = null;
  private record: PuzzleRecord | null = null;
  /** Which puzzle type the toolbar is currently offering choices for. */
  private chooser: AnyPuzzleModule = MODULES[0]!;
  private tool = '';
  private theme: Theme = DARK;
  private layout: Layout | null = null;
  /**
   * How far the current hint has been pushed: 0 none, 1 where to look, 2 why, 3 done.
   *
   * Three strengths rather than one button that fills a square in, because the point of a
   * hint in a classroom is to teach the technique. "Look at row 4" is often all somebody
   * needs, and giving them the answer instead takes the puzzle away from them.
   */
  private hintLevel = 0;
  private hintCells: readonly Cell[] = [];
  /** Counted, so a finish that leaned on help is recorded as one. */
  private hintsUsed = 0;
  /** Non-null while the demonstration is running. */
  private demo: {
    beats: Beat[];
    at: number;
    paused: boolean;
    cancelled: boolean;
    pointer: Cell | null;
    returnTo: PuzzleRecord | null;
  } | null = null;
  /**
   * The finishing control, built once and moved into the help panel whenever that panel is
   * rebuilt for a different puzzle. One element rather than one per rebuild, so the
   * listener is attached once and the chosen value survives switching puzzle.
   */
  private readonly celebrateSelect: HTMLSelectElement;
  private celebration: CelebrationLevel = 'full';
  private stopCelebration: (() => void) | null = null;
  private celebrateTimer = 0;
  private dirty = true;
  private saveTimer: number | null = null;
  /** Read by the smoke test. See `Session.unguardedChanges`. */
  get unguardedChanges(): number {
    return this.session?.unguardedChanges ?? 0;
  }

  constructor(private readonly root: HTMLElement) {
    root.innerHTML = `
      <div class="ops">
        <header class="bar">
          <strong class="brand">Open Puzzle Studio</strong>
          <label class="field" title="Which kind of puzzle to play">Puzzle
            <select class="puzzle"></select>
          </label>
          <span class="options"></span>
          <button class="btn" data-act="new" title="Make a new puzzle with the choices made here">New puzzle</button>
          <button class="btn" data-act="daily" title="The same puzzle for everyone today, with no account and nothing uploaded">Today&rsquo;s</button>
          <span class="divider"></span>
          <span class="tools"></span>
          <span class="divider"></span>
          <button class="btn" data-act="undo" title="Take back the last thing you did (Ctrl+Z)" disabled>Undo</button>
          <button class="btn" data-act="redo" title="Put it back (Ctrl+Y)" disabled>Redo</button>
          <span class="divider"></span>
          <button class="btn hint-btn" data-act="hint" title="Ask for help. Press once for where to look, again for why, again to have it done.">Hint</button>
          <button class="btn" data-act="help" title="How to play, and a demonstration to watch">How to play</button>
          <button class="btn" data-act="print" title="Print this puzzle on paper, with the clues and an empty grid">Print</button>
          <button class="btn" data-act="library" title="Every puzzle you have started is saved here">My puzzles</button>
          <label class="field" title="This puzzle, as text. Anyone who types it in gets exactly this puzzle.">Code
            <input class="code" type="text" readonly size="32" title="Copy this to share the puzzle" />
          </label>
          <button class="btn" data-act="theme" title="Switch between the dark and light board">Light</button>
        </header>
        <main class="stage">
          <canvas class="board"></canvas>
          <canvas class="celebrate" aria-hidden="true" hidden></canvas>
          <div class="finish-banner" role="status" hidden>
            <strong class="finish-head">Finished!</strong>
            <span class="finish-detail"></span>
            <button class="btn finish-close" type="button" aria-label="Close">Close</button>
          </div>
          <div class="demo-bar" hidden>
            <span class="demo-step"></span>
            <span class="demo-caption"></span>
            <button class="btn" data-act="demo-pause">Pause</button>
            <button class="btn" data-act="demo-close">Stop</button>
          </div>
        </main>
        <footer class="foot"><span class="status">Loading&hellip;</span><span class="version"></span></footer>
        <div class="library" hidden>
          <div class="lib-panel">
            <div class="lib-head"><strong>My puzzles</strong>
              <button class="btn" data-act="close-library">Close</button>
            </div>
            <div class="lib-list"></div>
          </div>
        </div>
        <div class="help" hidden>
          <div class="lib-panel">
            <div class="lib-head"><strong class="help-title">How to play</strong>
              <button class="btn" data-act="close-help">Close</button>
            </div>
            <div class="help-body"></div>
          </div>
        </div>
      </div>`;

    const q = <T extends Element>(sel: string): T => root.querySelector<T>(sel)!;
    this.canvas = q<HTMLCanvasElement>('.board');
    this.els = {
      status: q('.status'),
      undo: q<HTMLButtonElement>('[data-act="undo"]'),
      redo: q<HTMLButtonElement>('[data-act="redo"]'),
      tools: q('.tools'),
      puzzle: q<HTMLSelectElement>('.puzzle'),
      options: q('.options'),
      code: q<HTMLInputElement>('.code'),
      library: q('.library'),
      libList: q('.lib-list'),
      help: q('.help'),
      helpTitle: q('.help-title'),
      helpBody: q('.help-body'),
      hint: q<HTMLButtonElement>('.hint-btn'),
      celebrateCanvas: q<HTMLCanvasElement>('.celebrate'),
      finishBanner: q('.finish-banner'),
      finishDetail: q('.finish-detail'),
      demoBar: q('.demo-bar'),
      demoStep: q('.demo-step'),
      demoCaption: q('.demo-caption'),
      demoPause: q<HTMLButtonElement>('[data-act="demo-pause"]'),
    };
    q<HTMLElement>('.version').textContent = APP_VERSION;
    this.celebrateSelect = this.buildCelebrateSetting();

    for (const module of MODULES) {
      const option = document.createElement('option');
      option.value = module.id;
      option.textContent = module.name;
      option.title = module.blurb;
      this.els.puzzle.append(option);
    }
    this.els.puzzle.value = this.chooser.id;
    this.syncOptions();

    this.wire();
    void this.start();
    requestAnimationFrame(this.loop);
  }

  // --- Choosing a puzzle -----------------------------------------------------

  /**
   * Build the toolbar's choices from whatever the chosen puzzle says it offers.
   *
   * This replaced two hard-coded dropdowns. The nonogram's sizes are 5 to 20 and a few
   * hand-drawn starters; the number puzzle's are 4, 6 and 9, plus whether to show numbers
   * or shapes. One of those lists used to be in this file, and was silently offered to
   * everything.
   */
  private syncOptions(): void {
    this.els.options.innerHTML = '';
    for (const choice of this.chooser.options()) {
      const label = document.createElement('label');
      label.className = 'field';
      label.title = choice.help;
      label.append(document.createTextNode(choice.label));
      const select = document.createElement('select');
      select.dataset['choice'] = choice.id;
      for (const value of choice.values) {
        const option = document.createElement('option');
        option.value = value.value;
        option.textContent = value.label;
        select.append(option);
      }
      select.value = choice.initial;
      label.append(select);
      this.els.options.append(label);
    }
  }

  /** The spec the toolbar is currently describing. */
  private chosenSpec(seed = freshSeed()): unknown {
    const chosen: Record<string, string> = {};
    for (const select of this.els.options.querySelectorAll<HTMLSelectElement>('select')) {
      const id = select.dataset['choice'];
      if (id) chosen[id] = select.value;
    }
    return this.chooser.specFrom(chosen, seed);
  }

  private static codeFor(module: AnyPuzzleModule, spec: unknown): string {
    return encodeGameId(module.id, module.encode(module.normalise(spec)));
  }

  private wire(): void {
    this.root.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset['act'];
      if (act === 'new') void this.newPuzzle(this.chooser, this.chosenSpec());
      else if (act === 'daily') void this.openDaily();
      else if (act === 'undo') this.undo();
      else if (act === 'redo') this.redo();
      else if (act === 'library') void this.openLibrary();
      else if (act === 'close-library') this.els.library.hidden = true;
      else if (act === 'hint') this.askHint();
      else if (act === 'print') this.printSheet();
      else if (act === 'demo') void this.startDemo();
      else if (act === 'demo-pause') this.toggleDemoPause();
      else if (act === 'demo-close') this.stopDemo();
      else if (act === 'help') this.els.help.hidden = false;
      else if (act === 'close-help') this.els.help.hidden = true;
      else if (act === 'theme') this.toggleTheme();
      else if (act === 'tool') {
        const id = (e.target as HTMLElement).dataset['tool'];
        if (id) {
          this.tool = id;
          this.syncTools();
        }
      }
    });

    this.els.puzzle.addEventListener('change', () => {
      const module = BY_ID[this.els.puzzle.value];
      if (!module) return;
      this.chooser = module;
      this.syncOptions();
      void this.newPuzzle(module, this.chosenSpec());
    });

    this.els.options.addEventListener('change', () => {
      // Say what pressing New would now give, without taking the player's board away:
      // changing a dropdown should never destroy a half-finished puzzle.
      this.setStatus('Press New puzzle for one of those.');
    });

    window.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT')) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const key = e.key.toLowerCase();
        if (key === 'z' && !e.shiftKey) this.undo();
        else if (key === 'y' || (key === 'z' && e.shiftKey)) this.redo();
        else return;
        e.preventDefault();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const tools = this.session?.tools ?? [];
      /**
       * A key that matches a tool's name picks that tool.
       *
       * Generic by construction rather than by a list: the number puzzle's tools are
       * called "1" to "9", so the digit keys work and nothing in this file had to be told
       * about digits. The nonogram's are called "Fill" and "Cross out", so no single key
       * matches and nothing happens. This replaced a line that swapped between the strings
       * `'fill'` and `'cross'`.
       */
      const named = tools.find((t) => t.name.toLowerCase() === e.key.toLowerCase());
      if (named) {
        this.tool = named.id;
        this.syncTools();
        e.preventDefault();
        return;
      }
      // Space steps through the tools, which is the only way round a toolbar on a tablet.
      if (e.key === ' ' && tools.length > 1) {
        const at = tools.findIndex((t) => t.id === this.tool);
        this.tool = tools[(at + 1) % tools.length]!.id;
        this.syncTools();
        e.preventDefault();
      }
    });

    /**
     * One pointer path for mouse, touch and pen.
     *
     * Dragging paints, for tools that say they should — see `drag` on a tool. The mark is
     * decided by the cell the drag *started* on, so a drag across a mixed row does one
     * consistent thing instead of toggling each cell to the opposite of whatever it
     * happened to be.
     *
     * A whole stroke is one undo step. Five cells painted in one drag is five `play()`
     * calls and one thing the player did; without the bracket, undoing a twenty-cell
     * stroke takes twenty presses — which the smoke test caught on the first run of M1, by
     * printing what undo actually restored instead of only whether it restored something.
     */
    let painting: unknown = null;
    const toCell = (e: PointerEvent): Cell | null => {
      if (!this.layout) return null;
      const rect = this.canvas.getBoundingClientRect();
      return cellAt(this.layout, e.clientX - rect.left, e.clientY - rect.top);
    };

    this.canvas.style.touchAction = 'none';
    this.canvas.addEventListener('pointerdown', (e) => {
      // A demonstration you can interfere with ends up in a state nobody intended.
      if (this.demo) return;
      const cell = toCell(e);
      if (!cell || !this.session) return;
      e.preventDefault();
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {
        /* the pointer has already gone; painting still works without capture */
      }
      const move = this.session.moveFor(cell, this.tool);
      if (!move) return;
      const draggable = this.session.tools.find((t) => t.id === this.tool)?.drag === true;
      painting = draggable ? move : null;
      this.session.beginChange('your last move');
      this.session.play(move, 'a mark');
      this.afterMove();
      if (!draggable) {
        this.session.endChange();
        this.afterMove();
      }
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (painting === null || !this.session) return;
      const cell = toCell(e);
      if (!cell) return;
      // The move from the first cell, carried to this one. What "the same move" means is
      // the puzzle's business; all this knows is that it has a cell and a thing to repeat.
      this.session.play({ ...(painting as object), ...cell }, 'marks');
      this.afterMove();
    });
    const stop = (): void => {
      if (painting === null) return;
      painting = null;
      this.session?.endChange();
      this.afterMove();
    };
    this.canvas.addEventListener('pointerup', stop);
    this.canvas.addEventListener('pointercancel', stop);
  }

  private syncTools(): void {
    const tools = this.session?.tools ?? [];
    this.els.tools.innerHTML = '';
    for (const tool of tools) {
      const button = document.createElement('button');
      button.className = 'btn';
      button.dataset['act'] = 'tool';
      button.dataset['tool'] = tool.id;
      button.textContent = tool.name;
      button.title = tool.help;
      button.setAttribute('aria-pressed', String(this.tool === tool.id));
      this.els.tools.append(button);
    }
  }

  /**
   * The help panel, written by the puzzle.
   *
   * Set as text and never as HTML. A puzzle module is trusted code today and may one day
   * be a plug-in; either way there is nothing to gain from letting it put markup in the
   * page, and the tool list is built from the same `help` strings the buttons already
   * carry, so an explanation cannot drift from the control it describes.
   */
  private syncHelp(): void {
    const session = this.session;
    const body = this.els.helpBody;
    body.innerHTML = '';
    if (!session) return;
    const module = session.module;
    this.els.helpTitle.textContent = `How to play — ${module.name}`;

    for (const paragraph of module.instructions) {
      const p = document.createElement('p');
      p.textContent = paragraph;
      body.append(p);
    }

    /**
     * Tools that share an explanation share a line.
     *
     * A number puzzle has nine tools and one thing to say about them, and listing it nine
     * times filled the panel with noise and pushed the demonstration button off the
     * bottom. Found by looking at a screenshot of the panel, not by any assertion — which
     * is the argument for looking.
     */
    const grouped = new Map<string, string[]>();
    for (const tool of session.tools) {
      const names = grouped.get(tool.help);
      if (names) names.push(tool.name);
      else grouped.set(tool.help, [tool.name]);
    }
    const list = document.createElement('ul');
    for (const [help, names] of grouped) {
      const li = document.createElement('li');
      const name = document.createElement('b');
      name.textContent = names.join(', ');
      li.append(name, document.createTextNode(` — ${help}`));
      list.append(li);
    }
    if (grouped.size > 0) body.append(list);

    const described = session.describe();
    const note = document.createElement('p');
    note.className = 'help-note';
    note.textContent = `This one is rated ${described.rating}. ${described.note}`;
    body.append(note);

    if (module.demoSpec) {
      const actions = document.createElement('div');
      actions.className = 'ch-actions';
      const button = document.createElement('button');
      button.className = 'btn on';
      button.dataset['act'] = 'demo';
      button.title = 'Watch the app solve a small one, a step at a time';
      button.textContent = 'Show me — watch a puzzle being solved';
      actions.append(button);
      body.append(actions);
    }

    const row = document.createElement('label');
    row.className = 'set-row';
    row.title = 'What happens when a puzzle is finished';
    row.append(document.createTextNode('Finishing'));
    row.append(this.celebrateSelect);
    body.append(row);
  }

  private async start(): Promise<void> {
    const fromUrl = location.hash.replace(/^#/, '');
    if (fromUrl) {
      const decoded = decodeGameId(fromUrl);
      const module = decoded ? BY_ID[decoded.puzzleId] : undefined;
      const spec = module && decoded ? module.decode(decoded.parts) : null;
      if (module && spec) {
        this.chooser = module;
        this.els.puzzle.value = module.id;
        this.syncOptions();
        await this.newPuzzle(module, spec);
        return;
      }
      this.setStatus('That code is not one this app recognises, so a new puzzle was opened instead.');
    }
    const last = getLastOpened();
    if (last) {
      const record = await getPuzzle(last).catch(() => undefined);
      if (record) {
        this.openRecord(record);
        return;
      }
    }
    /**
     * A first launch opens the puzzle's small fixed board, not one from the dropdowns.
     *
     * Deliberately the same board the demonstration uses. The first thing somebody meets
     * should be finishable in a few minutes — a hand-drawn heart, or a 4x4 — rather than
     * whatever the difficulty dropdown happened to be left on, and making it the *same*
     * board means pressing "Show me" demonstrates the puzzle already in front of them.
     */
    await this.newPuzzle(this.chooser, this.chooser.demoSpec?.() ?? this.chosenSpec());
  }

  private async newPuzzle(module: AnyPuzzleModule, spec: unknown): Promise<void> {
    /**
     * Say something before the search, because the search is not instant.
     *
     * Generation is a search. Measured on a desktop it ranges from under a millisecond to
     * about 775ms for a tricky 20x20 nonogram and about 360ms for a tricky 9x9 number
     * board — which on a tablet is comfortably long enough to look like the app has died.
     * One frame is yielded so the message actually paints before the main thread is taken.
     *
     * This is a courtesy, not a fix: the thread is still blocked while it runs. The fix is
     * a worker, and it is recorded as a known limitation rather than pretended away. Both
     * puzzles have the same problem, which makes the worker a mid-end job rather than a
     * per-puzzle one — worth knowing before it is built.
     */
    this.setStatus('Making a puzzle…');
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const normalised = module.normalise(spec);
    const session = Session.create(module, normalised, undefined, {
      onChange: () => (this.dirty = true),
    });
    const record: PuzzleRecord = {
      id: newId(),
      puzzleId: module.id,
      spec: normalised,
      title: session.title,
      state: session.serialise(),
      createdAt: Date.now(),
      lastPlayed: Date.now(),
      completedAt: null,
      progress: 0,
      elapsedMs: 0,
    };
    this.install(session, record);
    await this.save();
  }

  /**
   * Today's puzzle, with no server behind it.
   *
   * The date *is* the seed, so every device generates the same puzzle from the same
   * arithmetic. No backend, no sync, nothing to go down — and it still works on a tablet
   * in a classroom with the wifi off.
   */
  private async openDaily(): Promise<void> {
    await this.newPuzzle(this.chooser, this.chosenSpec(dailySeed()));
    this.setStatus(
      `Today's puzzle. Everyone who picks these choices gets the same one — unless the ` +
        `choice made ignores the seed, such as a hand-drawn starter, which is the same every day.`,
    );
  }

  private openRecord(record: PuzzleRecord): void {
    const module = BY_ID[record.puzzleId];
    if (!module) {
      this.setStatus(`That puzzle was made by "${record.puzzleId}", which this version does not have.`);
      return;
    }
    const session = Session.create(module, module.normalise(record.spec), record.state, {
      onChange: () => (this.dirty = true),
    });
    this.install(session, record);
  }

  private install(session: Session, record: PuzzleRecord): void {
    this.session = session;
    this.record = record;
    this.clearHint();
    this.hideCelebration();
    this.hintsUsed = record.hintsUsed ?? 0;
    this.tool = session.tools[0]?.id ?? '';
    setLastOpened(record.id);
    this.els.code.value = App.codeFor(session.module, record.spec);
    // The type picker follows the open puzzle; the per-puzzle choices do not, because a
    // spec cannot be read back into them. Known limitation, recorded in ARCHITECTURE.md.
    if (this.chooser.id !== session.module.id) {
      this.chooser = session.module;
      this.els.puzzle.value = session.module.id;
      this.syncOptions();
    }
    this.syncTools();
    this.syncHelp();
    this.syncHistory();
    this.updateStatus();
    this.dirty = true;
  }

  private afterMove(): void {
    // Any move makes the open hint stale: it was about a board that no longer exists.
    this.clearHint();
    this.syncHistory();
    this.updateStatus();
    this.dirty = true;
    this.scheduleSave();
  }

  private clearHint(): void {
    this.hintLevel = 0;
    this.hintCells = [];
    this.els.hint.textContent = 'Hint';
  }

  /**
   * Help, in three strengths.
   *
   * Press once and the part of the board to look at is highlighted and nothing more. Press
   * again and it says why. Press a third time and it does it. Each press is a decision to
   * be told more, and a child who only ever needs the first one never sees the answer.
   *
   * A wrong board short-circuits all of it: a deduction offered to somebody whose board is
   * already wrong is a deduction from a false premise.
   */
  private askHint(): void {
    const session = this.session;
    if (!session) return;
    const hint = session.hint(3);
    if (!hint) {
      this.setStatus('This puzzle cannot give hints.');
      return;
    }

    if (hint.kind === 'wrong') {
      this.hintsUsed++;
      this.hintCells = hint.look;
      this.hintLevel = 2;
      this.els.hint.textContent = 'Hint';
      this.setStatus(hint.why);
      this.dirty = true;
      return;
    }
    if (hint.kind === 'done') {
      this.clearHint();
      this.setStatus(hint.why);
      return;
    }

    const step = hint.step;
    this.hintLevel++;
    if (this.hintLevel === 1) {
      this.hintsUsed++;
      this.hintCells = lookCells(step);
      this.els.hint.textContent = 'Why?';
      const where = step.where ?? 'This part of the board';
      this.setStatus(`${where} has something you can work out. Have a look before pressing again.`);
    } else if (this.hintLevel === 2) {
      this.hintCells = step.cells;
      this.els.hint.textContent = 'Do it';
      this.setStatus(step.why);
    } else {
      const moves = (step.moves ?? []) as unknown[];
      session.change('a hint', () => {
        for (const move of moves) session.play(move, 'a hint');
      });
      this.clearHint();
      this.syncHistory();
      this.updateStatus();
      this.scheduleSave();
    }
    this.dirty = true;
  }

  /**
   * Undo clears the open hint as well as the move.
   *
   * Found by the smoke test for the second puzzle, which asked for a hint, undid a move,
   * and got "Do it" where it expected "where to look". The step itself is always recomputed
   * from the current board, so nothing wrong was ever done — but the *ladder* was two
   * presses in, so one press gave away the answer to somebody who had asked for a nudge.
   * An undo changes the board, which is exactly the reason `afterMove` clears it too.
   */
  private undo(): void {
    this.clearHint();
    const label = this.session?.undo();
    this.setStatus(label === null || label === undefined ? 'There is nothing to undo.' : `Undid: ${label}.`);
    this.syncHistory();
    this.dirty = true;
    this.scheduleSave();
  }

  private redo(): void {
    this.clearHint();
    const label = this.session?.redo();
    this.setStatus(label === null || label === undefined ? 'There is nothing to redo.' : `Redid: ${label}.`);
    this.syncHistory();
    this.dirty = true;
    this.scheduleSave();
  }

  private syncHistory(): void {
    const history = this.session?.history;
    this.els.undo.disabled = !history?.canUndo;
    this.els.redo.disabled = !history?.canRedo;
  }

  private toggleTheme(): void {
    this.theme = this.theme === DARK ? LIGHT : DARK;
    document.documentElement.dataset['theme'] = this.theme === DARK ? 'dark' : 'light';
    this.root.querySelector<HTMLElement>('[data-act="theme"]')!.textContent =
      this.theme === DARK ? 'Light' : 'Dark';
    this.dirty = true;
  }

  private updateStatus(): void {
    const session = this.session;
    if (!session) return;
    // The difficulty the solver actually needed, not the one asked for. A puzzle asked for
    // at Tricky that turned out to be Steady is a Steady puzzle, and saying otherwise
    // would be the app flattering itself.
    const described = session.describe();
    if (session.solved) {
      // What it took is part of what happened. A finish that leaned on help is still a
      // finish, and quietly not mentioning it would make the record flattering rather
      // than true.
      const helped =
        this.hintsUsed === 0
          ? ' No hints.'
          : ` With ${this.hintsUsed} hint${this.hintsUsed === 1 ? '' : 's'}.`;
      this.setStatus(`Finished — ${session.title} is complete.${helped}`);
      return;
    }
    this.setStatus(
      `${described.rating} · ${Math.round(session.progress * 100)}% of ${described.progressNoun}`,
    );
  }

  private setStatus(text: string): void {
    this.els.status.textContent = text;
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) return;
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.save();
    }, 400);
  }

  private async save(): Promise<void> {
    const session = this.session;
    const record = this.record;
    if (!session || !record) return;
    record.state = session.serialise();
    record.progress = session.progress;
    record.hintsUsed = this.hintsUsed;
    record.lastPlayed = Date.now();
    if (session.solved && record.completedAt === null) {
      record.completedAt = Date.now();
      // Here rather than in `updateStatus`, because this is the one place that knows the
      // puzzle has *just* become complete. `updateStatus` runs on every change and would
      // throw the squares into the air every time a finished board was touched.
      // The title already carries the difficulty, so the rating is not repeated here. It
      // read "4x4 Gentle, Gentle, with no hints." until somebody looked at the screenshot,
      // which no assertion was ever going to catch.
      this.celebrate(
        session.title +
          (this.hintsUsed === 0
            ? ', with no hints.'
            : `, with ${this.hintsUsed} hint${this.hintsUsed === 1 ? '' : 's'}.`),
      );
    }
    try {
      await putPuzzle(record);
    } catch (err) {
      this.setStatus(`Your progress is NOT being saved: ${(err as Error).message}`);
    }
  }

  private async openLibrary(): Promise<void> {
    await this.save();
    const records = await listPuzzles().catch(() => [] as PuzzleRecord[]);
    const list = this.els.libList;
    list.innerHTML = records.length === 0 ? '<p class="lib-empty">No saved puzzles yet.</p>' : '';
    for (const record of records) {
      const card = document.createElement('div');
      card.className = 'lib-card';
      const state = record.completedAt
        ? 'Finished'
        : `${Math.round(record.progress * 100)}% done`;
      card.innerHTML = `<div class="lib-meta"><div class="lib-title"></div>
        <div class="lib-sub"></div></div>
        <div class="lib-actions">
          <button class="btn lib-open">Open</button>
          <button class="btn lib-delete">Delete</button>
        </div>`;
      // Title as text, never as HTML: it comes from a puzzle module and later from a user.
      card.querySelector<HTMLElement>('.lib-title')!.textContent = record.title;
      card.querySelector<HTMLElement>('.lib-sub')!.textContent =
        `${BY_ID[record.puzzleId]?.name ?? record.puzzleId} · ${state}`;
      card.querySelector('.lib-open')!.addEventListener('click', () => {
        this.openRecord(record);
        this.els.library.hidden = true;
      });
      card.querySelector('.lib-delete')!.addEventListener('click', () => {
        void deletePuzzle(record.id).then(() => void this.openLibrary());
      });
      list.append(card);
    }
    this.els.library.hidden = false;
  }

  // --- Finishing -------------------------------------------------------------

  /** Built once and moved into the help panel each time it is rebuilt. */
  private buildCelebrateSetting(): HTMLSelectElement {
    const select = document.createElement('select');
    select.className = 'set-celebrate';
    for (const choice of [
      { value: 'full', label: 'Squares and a sound' },
      { value: 'quiet', label: 'Squares, no sound' },
      { value: 'off', label: 'Nothing' },
    ]) {
      const option = document.createElement('option');
      option.value = choice.value;
      option.textContent = choice.label;
      select.append(option);
    }
    try {
      const saved = localStorage.getItem('ops:celebrate');
      if (saved === 'off' || saved === 'quiet' || saved === 'full') this.celebration = saved;
    } catch {
      /* storage disabled; it simply starts at full next time */
    }
    select.value = this.celebration;
    select.addEventListener('change', () => {
      this.celebration = select.value as CelebrationLevel;
      try {
        localStorage.setItem('ops:celebrate', this.celebration);
      } catch {
        /* storage disabled */
      }
      // Shown rather than described: nobody can picture "squares and a sound" from a
      // dropdown, and the alternative is finishing a puzzle to find out.
      if (this.celebration !== 'off') this.celebrate('A taste of it.');
    });
    this.els.finishBanner.querySelector('.finish-close')?.addEventListener('click', () => {
      this.hideCelebration();
    });
    return select;
  }

  /** See `celebrate.ts`. The flash-safety and reduced-motion rules came with it. */
  private celebrate(detail: string | null): void {
    // From the scene, which every puzzle has, rather than from the puzzle, which the shell
    // would have to cast to read.
    const scene = this.session?.layout();
    const squares = scene ? scene.rows * scene.cols : 100;
    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const plan = celebrationPlan(squares, this.celebration, reduced);
    if (!plan) return;

    this.stopCelebration?.();
    this.els.finishDetail.textContent = detail ?? 'That is what finishing looks like.';
    this.els.finishBanner.hidden = false;
    if (plan.animate) {
      this.els.celebrateCanvas.hidden = false;
      this.stopCelebration = runCelebration(this.els.celebrateCanvas, plan);
    }
    if (plan.sound) playFanfare();
    celebrationBuzz();
    window.clearTimeout(this.celebrateTimer);
    this.celebrateTimer = window.setTimeout(() => this.hideCelebration(), 8000);
  }

  private hideCelebration(): void {
    window.clearTimeout(this.celebrateTimer);
    this.stopCelebration?.();
    this.stopCelebration = null;
    this.els.celebrateCanvas.hidden = true;
    this.els.finishBanner.hidden = true;
  }

  // --- Paper -----------------------------------------------------------------

  /**
   * The puzzle on A4, with the clues and an empty grid.
   *
   * Printed from an iframe rather than a popup, for the reason the sister project
   * recorded: a window is blocked often enough to be unreliable, and when it is blocked
   * it fails silently.
   */
  private printSheet(): void {
    const session = this.session;
    if (!session) return;
    const scene = session.printable();
    if (!scene) {
      this.setStatus('This puzzle cannot be printed.');
      return;
    }
    const html = sheetHtml(scene, session.title, this.els.code.value, session.module.blurb);
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    if (!doc || !frame.contentWindow) {
      frame.remove();
      this.setStatus('This browser would not open a print view.');
      return;
    }
    doc.open();
    doc.write(html);
    doc.close();
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(() => frame.remove(), 60_000);
    this.setStatus('Sheet sent to your printer — the puzzle and an empty grid, not the answer.');
  }

  // --- The demonstration -----------------------------------------------------

  /**
   * Show somebody what to do, by doing it.
   *
   * Runs on the puzzle's own small fixed instance — `demoSpec()`, so a teacher can talk
   * about the same board every time — and puts the player's own puzzle back when it
   * finishes. The board is deaf to the pointer while it runs: a demonstration you can
   * interfere with is a demonstration that ends up in a state nobody intended.
   */
  private async startDemo(): Promise<void> {
    this.els.help.hidden = true;
    const module = this.session?.module ?? this.chooser;
    const spec = module.demoSpec?.();
    if (spec === undefined) {
      this.setStatus('This puzzle has nothing to demonstrate.');
      return;
    }
    const previous = this.record;
    const session = Session.create(module, spec, undefined, {
      onChange: () => (this.dirty = true),
    });
    const { beats } = buildScript(module, session.puzzle);
    if (beats.length === 0) {
      this.setStatus('There is nothing to demonstrate on this puzzle.');
      return;
    }

    this.demo = { beats, at: 0, paused: false, cancelled: false, pointer: null, returnTo: previous };
    this.session = session;
    this.record = null;
    this.els.demoBar.hidden = false;
    this.clearHint();
    this.dirty = true;

    for (let i = 0; i < beats.length; i++) {
      const beat = beats[i]!;
      if (!this.demo || this.demo.cancelled) break;
      this.demo.at = i;
      this.els.demoStep.textContent = `${i + 1} of ${beats.length}`;
      this.els.demoCaption.textContent = beat.caption;
      this.hintCells = beat.look;
      this.demo.pointer = beat.cells[0] ?? null;
      this.dirty = true;
      if (!(await this.demoWait(TIMING.look))) break;

      for (let m = 0; m < beat.moves.length; m++) {
        if (!this.demo || this.demo.cancelled) break;
        this.demo.pointer = beat.cells[m] ?? null;
        session.play(beat.moves[m], 'the demonstration');
        this.dirty = true;
        if (!(await this.demoWait(TIMING.mark))) break;
      }
      this.hintCells = [];
      if (!(await this.demoWait(TIMING.settle))) break;
    }

    if (this.demo && !this.demo.cancelled) {
      this.els.demoStep.textContent = 'Done';
      this.els.demoCaption.textContent =
        'That is how it goes. Press Stop and try one yourself — and press Hint any time you get stuck.';
      this.demo.pointer = null;
      this.hintCells = [];
      this.dirty = true;
    }
  }

  /**
   * Sleep, unless the demo is paused or has been stopped. Returns false if stopped.
   *
   * The demo is re-read **after** every await, not before. Pressing Stop sets it to null
   * from another turn of the event loop, so a check made before the await says nothing
   * about the world after it — which threw a TypeError on the first run of the smoke
   * test's "nothing threw along the way" line. That assertion exists for faults with no
   * visible symptom, and this was one: the demo had already stopped and looked fine.
   */
  private async demoWait(ms: number): Promise<boolean> {
    const step = 60;
    for (let waited = 0; waited < ms; ) {
      await new Promise((resolve) => setTimeout(resolve, step));
      const demo = this.demo;
      if (!demo || demo.cancelled) return false;
      if (!demo.paused) waited += step;
    }
    return true;
  }

  private toggleDemoPause(): void {
    if (!this.demo) return;
    this.demo.paused = !this.demo.paused;
    this.els.demoPause.textContent = this.demo.paused ? 'Play' : 'Pause';
  }

  private stopDemo(): void {
    const returnTo = this.demo?.returnTo ?? null;
    if (this.demo) this.demo.cancelled = true;
    this.demo = null;
    this.els.demoBar.hidden = true;
    this.els.demoPause.textContent = 'Pause';
    this.hintCells = [];
    if (returnTo) this.openRecord(returnTo);
    else void this.newPuzzle(this.chooser, this.chosenSpec());
  }

  private loop = (): void => {
    if (this.dirty && this.session) {
      // The highlight is composed here rather than passed into `layout()`.
      // A Scene is a plain value, so the shell can add to one without the puzzle module
      // needing to know that hints exist at all — which is the seam working.
      const scene = this.session.layout();
      this.layout = drawScene(
        this.canvas,
        this.hintCells.length > 0 ? { ...scene, highlight: this.hintCells } : scene,
        this.theme,
      );
      if (this.demo?.pointer) {
        drawPointer(this.canvas, this.layout, this.demo.pointer, this.theme);
      }
      this.dirty = false;
      this.session.checkGuard();
    }
    requestAnimationFrame(this.loop);
  };
}
