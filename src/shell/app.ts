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
import { PICTURE_NAMES, pictureLogic, type PictureSpec } from '../puzzles/pictureLogic/index.js';

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
    code: HTMLInputElement;
    library: HTMLElement;
    libList: HTMLElement;
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
          <label class="field">Picture
            <select class="picker"></select>
          </label>
          <button class="btn" data-act="new">New puzzle</button>
          <button class="btn" data-act="daily" title="The same puzzle for everyone today">Today's</button>
          <span class="divider"></span>
          <span class="tools"></span>
          <span class="divider"></span>
          <button class="btn" data-act="undo" disabled>Undo</button>
          <button class="btn" data-act="redo" disabled>Redo</button>
          <span class="divider"></span>
          <button class="btn" data-act="library">My puzzles</button>
          <label class="field">Code
            <input class="code" type="text" readonly size="24" />
          </label>
          <button class="btn" data-act="theme">Light</button>
        </header>
        <main class="stage"><canvas class="board"></canvas></main>
        <footer class="foot"><span class="status">Loading…</span><span class="version"></span></footer>
        <div class="library" hidden>
          <div class="lib-panel">
            <div class="lib-head"><strong>My puzzles</strong>
              <button class="btn" data-act="close-library">Close</button>
            </div>
            <div class="lib-list"></div>
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
      code: q<HTMLInputElement>('.code'),
      library: q('.library'),
      libList: q('.lib-list'),
    };
    q<HTMLElement>('.version').textContent = APP_VERSION;

    for (const name of PICTURE_NAMES) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name[0]!.toUpperCase() + name.slice(1);
      this.els.picker.append(option);
    }

    this.wire();
    void this.start();
    requestAnimationFrame(this.loop);
  }

  private wire(): void {
    this.root.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset['act'];
      if (act === 'new') void this.newPuzzle({ picture: this.els.picker.value });
      else if (act === 'daily') void this.openDaily();
      else if (act === 'undo') this.undo();
      else if (act === 'redo') this.redo();
      else if (act === 'library') void this.openLibrary();
      else if (act === 'close-library') this.els.library.hidden = true;
      else if (act === 'theme') this.toggleTheme();
      else if (act === 'tool') {
        this.tool = (e.target as HTMLElement).dataset['tool'] ?? 'fill';
        this.syncTools();
      }
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
      button.setAttribute('aria-pressed', String(this.tool === tool.id));
      this.els.tools.append(button);
    }
  }

  private async start(): Promise<void> {
    const fromUrl = location.hash.replace(/^#/, '');
    if (fromUrl) {
      const decoded = decodeGameId(fromUrl);
      if (decoded && MODULES[decoded.puzzleId] && decoded.parts[0]) {
        await this.newPuzzle({ picture: decoded.parts[0] });
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
    await this.newPuzzle({ picture: 'heart' });
  }

  private async newPuzzle(spec: PictureSpec): Promise<void> {
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

  private async openDaily(): Promise<void> {
    // With three hand-drawn pictures a "daily" is a rotation, not a generated puzzle. It
    // exists now so the game-code and date-seeding path is exercised from M1 rather than
    // bolted on once there is a real generator.
    const seed = dailySeed();
    const picture = PICTURE_NAMES[Number(seed) % PICTURE_NAMES.length]!;
    await this.newPuzzle({ picture });
    this.setStatus(`Today's puzzle (${seed}). Everyone gets the same one.`);
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
    this.els.code.value = encodeGameId(session.module.id, [
      (record.spec as PictureSpec).picture,
    ]);
    this.syncTools();
    this.syncHistory();
    this.updateStatus();
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
    if (this.session.solved) {
      this.setStatus(`Finished — ${this.record?.title ?? 'the picture'} is complete.`);
      return;
    }
    this.setStatus(`${Math.round(this.session.progress * 100)}% of the picture filled in`);
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
