/**
 * The shell: toolbar, canvas, status.
 *
 * It knows about `PuzzleModule`, `Session` and `Scene`, and nothing about nonograms. If a
 * line in this file ever mentions a clue, a run or a picture, the seam this milestone
 * exists to prove has leaked and that is the bug.
 */

import {
  Session,
  dailySeed,
  decodeGameId,
  encodeGameId,
  type AnyPuzzleModule,
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
import { DARK, LIGHT, cellAt, drawScene, type Layout, type Theme } from '../render/scene.js';
import {
  PICTURE_NAMES,
  normaliseSpec,
  pictureLogic,
  type PictureSpec,
} from '../puzzles/pictureLogic/index.js';
import { tierName } from '../puzzles/pictureLogic/generate.js';

declare const __APP_VERSION__: string;
const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'development build';

/** Every puzzle type the app knows, by id. One entry today, which is the point. */
const MODULES: Record<string, AnyPuzzleModule> = {
  [pictureLogic.id]: pictureLogic,
};

export class App {
  private readonly canvas: HTMLCanvasElement;
  private readonly els: {
    status: HTMLElement;
    undo: HTMLButtonElement;
    redo: HTMLButtonElement;
    tools: HTMLElement;
    picker: HTMLSelectElement;
    size: HTMLSelectElement;
    tier: HTMLSelectElement;
    code: HTMLInputElement;
    library: HTMLElement;
    libList: HTMLElement;
    help: HTMLElement;
    helpNote: HTMLElement;
  };

  private session: Session | null = null;
  private record: PuzzleRecord | null = null;
  private tool = 'fill';
  private theme: Theme = DARK;
  private layout: Layout | null = null;
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
          <label class="field" title="How big the picture is. Bigger takes longer and gives more to go on.">Size
            <select class="size"></select>
          </label>
          <label class="field" title="How much working out it takes. Gentle puzzles never need more than looking at one line at a time.">Difficulty
            <select class="tier"></select>
          </label>
          <button class="btn" data-act="new" title="Make a new picture at the size and difficulty chosen here">New puzzle</button>
          <button class="btn" data-act="daily" title="The same puzzle for everyone today, with no account and nothing uploaded">Today&rsquo;s</button>
          <label class="field" title="One of the small hand-drawn pictures, for a first go">Starter
            <select class="picker"></select>
          </label>
          <span class="divider"></span>
          <span class="tools"></span>
          <span class="divider"></span>
          <button class="btn" data-act="undo" title="Take back the last thing you did (Ctrl+Z)" disabled>Undo</button>
          <button class="btn" data-act="redo" title="Put it back (Ctrl+Y)" disabled>Redo</button>
          <span class="divider"></span>
          <button class="btn" data-act="help" title="How to play">How to play</button>
          <button class="btn" data-act="library" title="Every puzzle you have started is saved here">My puzzles</button>
          <label class="field" title="This puzzle, as text. Anyone who types it in gets exactly this picture.">Code
            <input class="code" type="text" readonly size="32" title="Copy this to share the puzzle" />
          </label>
          <button class="btn" data-act="theme" title="Switch between the dark and light board">Light</button>
        </header>
        <main class="stage"><canvas class="board"></canvas></main>
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
            <div class="lib-head"><strong>How to play</strong>
              <button class="btn" data-act="close-help">Close</button>
            </div>
            <div class="help-body">
              <p>The numbers tell you how many squares in a row are filled in, in order.
              A row marked <b>3 1</b> has a block of three, then at least one gap, then a
              single square. Fill in the right squares and a picture appears.</p>
              <ul>
                <li><b>Fill</b> colours a square in. Press it again to clear it.</li>
                <li><b>Cross out</b> marks a square you are sure is <em>empty</em>. This is
                not decoration &mdash; crossing out is how you work the rest out, and
                without it you are solving a harder puzzle than the one in front of you.</li>
                <li><b>Drag</b> across several squares to do a whole run at once.</li>
                <li>Press <b>space</b> to swap between Fill and Cross out.</li>
                <li>A clue goes faint when that line is finished.</li>
              </ul>
              <p>Every puzzle here can be worked out by reasoning. There is never a need to
              guess.</p>
              <p class="help-note"></p>
            </div>
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
      picker: q<HTMLSelectElement>('.picker'),
      size: q<HTMLSelectElement>('.size'),
      tier: q<HTMLSelectElement>('.tier'),
      code: q<HTMLInputElement>('.code'),
      library: q('.library'),
      libList: q('.lib-list'),
      help: q('.help'),
      helpNote: q('.help-note'),
    };
    q<HTMLElement>('.version').textContent = APP_VERSION;

    for (const name of PICTURE_NAMES) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name[0]!.toUpperCase() + name.slice(1);
      this.els.picker.append(option);
    }
    // Sizes a person would actually choose, not every number. 5x5 is a first go; 20x20 is
    // an evening. The upper end is capped by how long generation takes to find a puzzle
    // the solver can finish, which the tests measure rather than assume.
    for (const n of [5, 8, 10, 12, 15, 20]) {
      const option = document.createElement('option');
      option.value = String(n);
      option.textContent = `${n} \u00d7 ${n}`;
      this.els.size.append(option);
    }
    this.els.size.value = '10';
    for (const tier of pictureLogic.tiers) {
      const option = document.createElement('option');
      option.value = tier.id;
      option.textContent = tier.name;
      this.els.tier.append(option);
    }
    this.els.tier.value = 'steady';

    this.wire();
    void this.start();
    requestAnimationFrame(this.loop);
  }

  private wire(): void {
    this.root.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset['act'];
      if (act === 'new') void this.newPuzzle(this.chosenSpec());
      else if (act === 'daily') void this.openDaily();
      else if (act === 'undo') this.undo();
      else if (act === 'redo') this.redo();
      else if (act === 'library') void this.openLibrary();
      else if (act === 'close-library') this.els.library.hidden = true;
      else if (act === 'help') this.els.help.hidden = false;
      else if (act === 'close-help') this.els.help.hidden = true;
      else if (act === 'theme') this.toggleTheme();
      else if (act === 'tool') {
        this.tool = (e.target as HTMLElement).dataset['tool'] ?? 'fill';
        this.syncTools();
      }
    });

    this.els.picker.addEventListener('change', () => {
      void this.newPuzzle({ kind: 'drawn', picture: this.els.picker.value });
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
      // Space swaps the tool rather than needing the toolbar. On a tablet the toolbar is
      // the only way, which is one of the things the first playtest should watch.
      if (e.key === ' ') {
        this.tool = this.tool === 'fill' ? 'cross' : 'fill';
        this.syncTools();
        e.preventDefault();
      }
    });

    /**
     * One pointer path for mouse, touch and pen.
     *
     * Dragging paints: filling a run of five cells one tap at a time is the first thing
     * that makes a nonogram tedious. The mark is decided by the cell the drag *started*
     * on, so a drag across a mixed row does one consistent thing instead of toggling each
     * cell to the opposite of whatever it happened to be.
     */
    /**
     * A whole stroke is one undo step.
     *
     * Five cells painted in one drag is five `play()` calls and one thing the player did.
     * Without the bracket, undoing a twenty-cell stroke takes twenty presses — which the
     * smoke test caught on the first run, by printing what undo actually restored instead
     * of only whether it restored something.
     */
    let painting: string | null = null;
    const toCell = (e: PointerEvent): { col: number; row: number } | null => {
      if (!this.layout) return null;
      const rect = this.canvas.getBoundingClientRect();
      return cellAt(this.layout, e.clientX - rect.left, e.clientY - rect.top);
    };

    this.canvas.style.touchAction = 'none';
    this.canvas.addEventListener('pointerdown', (e) => {
      const cell = toCell(e);
      if (!cell || !this.session) return;
      e.preventDefault();
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {
        /* the pointer has already gone; painting still works without capture */
      }
      const move = this.session.moveFor(cell, this.tool) as { mark: string } | null;
      if (!move) return;
      painting = move.mark;
      this.session.beginChange(move.mark === 'empty' ? 'clearing cells' : 'filling cells');
      this.session.play(move, 'a mark');
      this.afterMove();
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (painting === null || !this.session) return;
      const cell = toCell(e);
      if (!cell) return;
      this.session.play({ ...cell, mark: painting }, 'marks');
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
    const module = this.session?.module ?? pictureLogic;
    this.els.tools.innerHTML = '';
    for (const tool of module.tools) {
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

  /** The spec the toolbar is currently describing. */
  private chosenSpec(): PictureSpec {
    const n = Number(this.els.size.value);
    return {
      kind: 'made',
      rows: n,
      cols: n,
      tier: this.els.tier.value,
      // A fresh seed each press, so "New puzzle" means a new puzzle rather than the same
      // one again. Short on purpose: the whole code has to be writable on a whiteboard,
      // and a timestamp-plus-random seed made it longer than the field it sits in. Four
      // base-36 characters is 1.7 million puzzles per size and difficulty, which is more
      // than a classroom will exhaust.
      seed: Math.floor(Math.random() * 1_679_616).toString(36).padStart(4, '0'),
    };
  }

  /** A spec as a short piece of text, and back. */
  private static codeFor(spec: PictureSpec): string {
    return spec.kind === 'drawn'
      ? encodeGameId(pictureLogic.id, ['d', spec.picture])
      : encodeGameId(pictureLogic.id, ['m', `${spec.cols}x${spec.rows}`, spec.tier, spec.seed]);
  }

  private static specFromCode(parts: readonly string[]): PictureSpec | null {
    if (parts[0] === 'd' && parts[1]) return { kind: 'drawn', picture: parts[1] };
    if (parts[0] === 'm' && parts[1] && parts[2] && parts[3]) {
      const [cols, rows] = parts[1].split('x').map(Number);
      if (!cols || !rows) return null;
      return { kind: 'made', rows, cols, tier: parts[2], seed: parts[3] };
    }
    return null;
  }

  private async start(): Promise<void> {
    const fromUrl = location.hash.replace(/^#/, '');
    if (fromUrl) {
      const decoded = decodeGameId(fromUrl);
      const spec = decoded && MODULES[decoded.puzzleId] ? App.specFromCode(decoded.parts) : null;
      if (spec) {
        await this.newPuzzle(spec);
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
    await this.newPuzzle({ kind: 'drawn', picture: 'heart' });
  }

  private async newPuzzle(spec: PictureSpec): Promise<void> {
    /**
     * Say something before the search, because the search is not instant.
     *
     * Generation is a search, and measured on a desktop it ranges from under a
     * millisecond for a gentle 10x10 to about 775ms for a tricky 20x20 — which on a
     * tablet is comfortably long enough to look like the app has died. One frame is
     * yielded so the message actually paints before the main thread is taken.
     *
     * This is a courtesy, not a fix: the thread is still blocked while it runs. The fix
     * is a worker, and it is recorded as a known limitation rather than pretended away.
     */
    this.setStatus('Making a picture\u2026');
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const module = pictureLogic;
    const session = Session.create(module, spec, undefined, { onChange: () => (this.dirty = true) });
    const record: PuzzleRecord = {
      id: newId(),
      puzzleId: module.id,
      spec,
      title: (session.puzzle as { title: string }).title,
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
   * The date *is* the seed, so every device generates the same picture from the same
   * arithmetic. No backend, no sync, nothing to go down — and it still works on a tablet
   * in a classroom with the wifi off.
   */
  private async openDaily(): Promise<void> {
    const seed = dailySeed();
    await this.newPuzzle({
      kind: 'made',
      rows: Number(this.els.size.value),
      cols: Number(this.els.size.value),
      tier: this.els.tier.value,
      seed,
    });
    this.setStatus(`Today's puzzle. Everyone who picks this size and difficulty gets the same one.`);
  }

  private openRecord(record: PuzzleRecord): void {
    const module = MODULES[record.puzzleId];
    if (!module) {
      this.setStatus(`That puzzle was made by "${record.puzzleId}", which this version does not have.`);
      return;
    }
    const session = Session.create(module, record.spec, record.state, {
      onChange: () => (this.dirty = true),
    });
    this.install(session, record);
  }

  private install(session: Session, record: PuzzleRecord): void {
    this.session = session;
    this.record = record;
    this.tool = session.module.tools[0]?.id ?? 'fill';
    setLastOpened(record.id);
    this.els.code.value = App.codeFor(normaliseSpec(record.spec));
    this.syncTools();
    this.syncHistory();
    this.updateStatus();
    const puzzle = session.puzzle as { rows: number; cols: number; tierUsed: number };
    this.els.helpNote.textContent =
      `This one is ${puzzle.cols} by ${puzzle.rows}, and rated ${tierName(puzzle.tierUsed)} — ` +
      (puzzle.tierUsed <= 1
        ? 'every step can be found by looking at one line at a time.'
        : puzzle.tierUsed === 2
          ? 'some steps need you to think about all the ways a line could fit.'
          : 'a few steps need you to suppose a square is filled and see what goes wrong.');
    this.dirty = true;
  }

  private afterMove(): void {
    this.syncHistory();
    this.updateStatus();
    this.dirty = true;
    this.scheduleSave();
  }

  private undo(): void {
    const label = this.session?.undo();
    this.setStatus(label === null || label === undefined ? 'There is nothing to undo.' : `Undid: ${label}.`);
    this.syncHistory();
    this.dirty = true;
    this.scheduleSave();
  }

  private redo(): void {
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
    if (!this.session) return;
    // The difficulty the solver actually needed, not the one asked for. A 10x10 asked for
    // at Tricky that turned out to be Steady is a Steady puzzle, and saying otherwise
    // would be the app flattering itself.
    const rated = tierName((this.session.puzzle as { tierUsed: number }).tierUsed);
    if (this.session.solved) {
      this.setStatus(`Finished — ${this.record?.title ?? 'the picture'} is complete.`);
      return;
    }
    this.setStatus(`${rated} · ${Math.round(this.session.progress * 100)}% of the picture filled in`);
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
    record.lastPlayed = Date.now();
    if (session.solved && record.completedAt === null) record.completedAt = Date.now();
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
        <div class="lib-sub">${record.puzzleId} · ${state}</div></div>
        <div class="lib-actions">
          <button class="btn lib-open">Open</button>
          <button class="btn lib-delete">Delete</button>
        </div>`;
      // Title as text, never as HTML: it comes from a puzzle module and later from a user.
      card.querySelector<HTMLElement>('.lib-title')!.textContent = record.title;
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

  private loop = (): void => {
    if (this.dirty && this.session) {
      this.layout = drawScene(this.canvas, this.session.layout(), this.theme);
      this.dirty = false;
      this.session.checkGuard();
    }
    requestAnimationFrame(this.loop);
  };
}
