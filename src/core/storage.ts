/**
 * Saved puzzles, in IndexedDB.
 *
 * A record carries the **spec**, not the puzzle: the puzzle is regenerated from the spec
 * on open. That is the same decision that keeps a 2,000-piece jigsaw save under a
 * kilobyte, and it is what makes a save file portable between devices and versions.
 *
 * IndexedDB rather than localStorage because localStorage is synchronous, string-only and
 * capped at a few megabytes — fine for preferences, wrong for a library.
 */

export interface PuzzleRecord {
  readonly id: string;
  /** Which `PuzzleModule` made this. */
  readonly puzzleId: string;
  /** Everything needed to regenerate the instance. JSON, small enough for a URL. */
  readonly spec: unknown;
  title: string;
  /** The module's serialised state. */
  state: string;
  readonly createdAt: number;
  lastPlayed: number;
  completedAt: number | null;
  /** 0..1. Stored so the library can draw a card without regenerating the puzzle. */
  progress: number;
  elapsedMs: number;
}

const DB_NAME = 'open-puzzle-studio';
const DB_VERSION = 1;
const STORE = 'puzzles';

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB would not open'));
  });
  return dbPromise;
}

/**
 * Resolve on the *transaction*, not on the request.
 *
 * A request that succeeds inside a transaction that then aborts has not written anything.
 * Resolving on the request is the bug that makes a save look like it worked and leaves the
 * data gone after a reload — it cost the jigsaw project a milestone to find.
 */
async function write<T>(run: (store: IDBObjectStore) => IDBRequest<T>): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    run(tx.objectStore(STORE));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('the write failed'));
    tx.onabort = () => reject(tx.error ?? new Error('the write was aborted'));
  });
}

async function read<T>(run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = run(tx.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('the read failed'));
  });
}

export async function putPuzzle(record: PuzzleRecord): Promise<void> {
  await write((store) => store.put(record));
}

export async function getPuzzle(id: string): Promise<PuzzleRecord | undefined> {
  return read<PuzzleRecord | undefined>((store) => store.get(id));
}

export async function listPuzzles(): Promise<PuzzleRecord[]> {
  const all = await read<PuzzleRecord[]>((store) => store.getAll());
  return all.sort((a, b) => b.lastPlayed - a.lastPlayed);
}

export async function deletePuzzle(id: string): Promise<void> {
  await write((store) => store.delete(id));
}

/** Short, sortable, and unique enough without a dependency. */
export function newId(): string {
  return `p_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

const LAST_OPENED = 'ops:last-opened';

export function setLastOpened(id: string | null): void {
  try {
    if (id === null) localStorage.removeItem(LAST_OPENED);
    else localStorage.setItem(LAST_OPENED, id);
  } catch {
    /* storage disabled; the app simply opens a fresh puzzle next time */
  }
}

export function getLastOpened(): string | null {
  try {
    return localStorage.getItem(LAST_OPENED);
  } catch {
    return null;
  }
}
