/**
 * Drawing a `Scene`, and turning a press back into a cell.
 *
 * Generic: it knows about grids, marks and labels, and nothing about nonograms. Every
 * puzzle that can describe itself as a `Scene` gets screen rendering, hit testing and
 * device-pixel handling from this one file — which is the point of the scene language.
 */

import type { Cell, Scene } from '../core/types.js';

export interface Theme {
  readonly background: string;
  readonly grid: string;
  readonly band: string;
  readonly filled: string;
  readonly crossed: string;
  readonly text: string;
  readonly dim: string;
  readonly highlight: string;
  /**
   * A square the puzzle fixed. A tint, not a fill: the number on top still has to read.
   *
   * Close to the background on purpose — it says "you cannot change this", which is a
   * quieter thing to say than anything the player has put down.
   */
  readonly shade: string;
}

export const DARK: Theme = {
  background: '#14161a',
  grid: '#333a44',
  band: '#5a6472',
  filled: '#e8edf5',
  crossed: '#5a6472',
  text: '#e8edf5',
  dim: '#5a6472',
  highlight: '#6aa9ff',
  shade: '#222831',
};

export const LIGHT: Theme = {
  background: '#f6f7f9',
  grid: '#c8ccd4',
  band: '#8a93a2',
  filled: '#1b2028',
  crossed: '#99a1ae',
  text: '#1b2028',
  dim: '#99a1ae',
  highlight: '#2563eb',
  shade: '#e3e6ec',
};

export interface Layout {
  /** Side of one cell, in CSS pixels. */
  readonly cell: number;
  /** Top-left of the *playable* grid, in CSS pixels. */
  readonly originX: number;
  readonly originY: number;
}

/**
 * Fit a scene to a canvas.
 *
 * The margin is part of what has to fit: clue numbers that run off the top of the screen
 * are not a cosmetic problem, they are the puzzle being unplayable.
 *
 * The 22px floor is a guess and is labelled as one — the jigsaw project learned the hard
 * way that a legibility number invented at a desk should not be quoted as if measured.
 * What a child can actually hit is one of the things the first playtest is for.
 */
export const MIN_CELL = 22;

export function layoutFor(scene: Scene, width: number, height: number, pad = 12): Layout {
  const across = scene.cols + scene.margin.left;
  const down = scene.rows + scene.margin.top;
  const cell = Math.max(
    8,
    Math.floor(Math.min((width - pad * 2) / across, (height - pad * 2) / down)),
  );
  const gridW = cell * across;
  const gridH = cell * down;
  return {
    cell,
    originX: Math.round((width - gridW) / 2 + scene.margin.left * cell),
    originY: Math.round((height - gridH) / 2 + scene.margin.top * cell),
  };
}

/** Which cell a point is in. May be negative, meaning the clue margin. */
export function cellAt(layout: Layout, x: number, y: number): Cell {
  return {
    col: Math.floor((x - layout.originX) / layout.cell),
    row: Math.floor((y - layout.originY) / layout.cell),
  };
}

/**
 * Paint a scene.
 *
 * Sets the backing-store size from `devicePixelRatio` itself. Letting CSS scale a canvas
 * up is the single most common reason a grid looks soft on a phone, and it is invisible on
 * the desktop where it was written.
 */
export function drawScene(
  canvas: HTMLCanvasElement,
  scene: Scene,
  theme: Theme,
): Layout {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const wantW = Math.max(1, Math.round(width * dpr));
  const wantH = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== wantW || canvas.height !== wantH) {
    canvas.width = wantW;
    canvas.height = wantH;
  }

  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, width, height);

  const layout = layoutFor(scene, width, height);
  const { cell, originX, originY } = layout;
  const x0 = originX;
  const y0 = originY;
  const x1 = originX + scene.cols * cell;
  const y1 = originY + scene.rows * cell;

  // Highlights first, under everything: a hint should sit behind the marks rather than
  // over the top of them.
  ctx.fillStyle = theme.highlight;
  ctx.globalAlpha = 0.25;
  for (const h of scene.highlight) {
    ctx.fillRect(x0 + h.col * cell, y0 + h.row * cell, cell, cell);
  }
  ctx.globalAlpha = 1;

  // Marks.
  for (let r = 0; r < scene.rows; r++) {
    for (let c = 0; c < scene.cols; c++) {
      const mark = scene.marks[r * scene.cols + c];
      const x = x0 + c * cell;
      const y = y0 + r * cell;
      if (mark === 'filled') {
        ctx.fillStyle = theme.filled;
        // Inset by a pixel so neighbouring filled cells still read as separate squares
        // rather than as one slab.
        ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
      } else if (mark === 'shaded') {
        ctx.fillStyle = theme.shade;
        ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
      } else if (mark === 'crossed') {
        ctx.strokeStyle = theme.crossed;
        ctx.lineWidth = Math.max(1.5, cell * 0.08);
        const inset = cell * 0.3;
        ctx.beginPath();
        ctx.moveTo(x + inset, y + inset);
        ctx.lineTo(x + cell - inset, y + cell - inset);
        ctx.moveTo(x + cell - inset, y + inset);
        ctx.lineTo(x + inset, y + cell - inset);
        ctx.stroke();
      }
    }
  }

  // Grid lines, over the marks so a filled cell still shows its boundaries.
  ctx.lineWidth = 1;
  for (let c = 0; c <= scene.cols; c++) {
    const heavy = scene.band.col > 0 && c % scene.band.col === 0;
    ctx.strokeStyle = heavy || c === 0 || c === scene.cols ? theme.band : theme.grid;
    ctx.lineWidth = heavy || c === 0 || c === scene.cols ? 2 : 1;
    const x = Math.round(x0 + c * cell) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.lineTo(x, y1);
    ctx.stroke();
  }
  for (let r = 0; r <= scene.rows; r++) {
    const heavy = scene.band.row > 0 && r % scene.band.row === 0;
    ctx.strokeStyle = heavy || r === 0 || r === scene.rows ? theme.band : theme.grid;
    ctx.lineWidth = heavy || r === 0 || r === scene.rows ? 2 : 1;
    const y = Math.round(y0 + r * cell) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
  }

  /**
   * Highlights again, this time as an outline over the top.
   *
   * The wash underneath reads beautifully on empty squares and is completely invisible on
   * filled ones — which is exactly where the most important highlight is needed, because
   * "something in this row cannot be right" is a hint about a row the player has already
   * filled in. Found by looking at the picture the smoke test produced, not by any
   * assertion, which is the argument for looking at it.
   */
  if (scene.highlight.length > 0) {
    ctx.strokeStyle = theme.highlight;
    ctx.lineWidth = Math.max(2, cell * 0.1);
    for (const h of scene.highlight) {
      const inset = ctx.lineWidth / 2;
      ctx.strokeRect(
        x0 + h.col * cell + inset,
        y0 + h.row * cell + inset,
        cell - ctx.lineWidth,
        cell - ctx.lineWidth,
      );
    }
  }

  // Labels last.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const label of scene.labels) {
    // Per label rather than once, because a number puzzle draws its givens heavier than
    // what the player wrote, and a pencilled note smaller than either. There are a few
    // dozen labels on the largest board, so the cost of setting the font each time is not
    // worth a word of cleverness.
    const size = Math.round(cell * 0.52 * (label.scale ?? 1));
    ctx.font = `${label.strong === true ? '700 ' : ''}${size}px system-ui, sans-serif`;
    ctx.fillStyle = label.dim === true ? theme.dim : theme.text;
    ctx.fillText(
      label.text,
      x0 + label.col * cell + cell / 2,
      y0 + label.row * cell + cell / 2,
    );
  }

  return layout;
}


/**
 * A pointer on a square, drawn after the scene.
 *
 * The one thing a clip of a person shows that an app playing itself does not: a hand. It
 * is drawn here rather than put in the `Scene` because it belongs to the demonstration
 * and not to the puzzle — a `Scene` describes a board, and no puzzle module should have
 * to know that a demo exists.
 */
export function drawPointer(
  canvas: HTMLCanvasElement,
  layout: Layout,
  at: Cell,
  theme: Theme,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { cell, originX, originY } = layout;
  const x = originX + (at.col + 0.5) * cell;
  const y = originY + (at.row + 0.5) * cell;
  const r = Math.max(7, cell * 0.3);

  ctx.save();
  // A ring rather than a filled blob, so the square underneath stays readable — the point
  // is to show what is being marked, not to cover it up.
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = theme.highlight;
  ctx.globalAlpha = 0.28;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineWidth = Math.max(2, cell * 0.07);
  ctx.strokeStyle = theme.highlight;
  ctx.stroke();
  ctx.restore();
}
