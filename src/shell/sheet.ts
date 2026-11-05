/**
 * A puzzle as a sheet of paper.
 *
 * SVG rather than a screenshot of the canvas, because a printed nonogram is read at
 * arm's length and a bitmap scaled to A4 is soft exactly where the clue numbers are. SVG
 * also means the sheet is a few kilobytes of text instead of a megabyte of pixels.
 *
 * Built from the same `Scene` the screen draws, so the printed grid cannot disagree with
 * the one on screen — and because `printable()` takes no player state, it cannot print the
 * answer. That is the mistake the sister project actually shipped, and it is worth closing
 * by construction rather than by remembering.
 */

import type { Scene } from '../core/index.js';

/** Millimetres. A4 less a 12mm margin all round. */
const PAGE = { w: 210, h: 297, margin: 12 } as const;

function escapeText(text: string): string {
  return text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c);
}

/**
 * @param subtitle One line saying what to do, written by the puzzle, not by this file.
 *   It used to be the words "Fill the squares the numbers describe." hard-coded here,
 *   which was true of the only puzzle that existed and nonsense about the second one.
 */
export function sheetHtml(
  scene: Scene,
  title: string,
  code: string,
  subtitle = '',
): string {
  const across = scene.cols + scene.margin.left;
  const down = scene.rows + scene.margin.top;
  // Leave room at the top for a heading and at the bottom for the code.
  const usableW = PAGE.w - PAGE.margin * 2;
  const usableH = PAGE.h - PAGE.margin * 2 - 26;
  const cell = Math.min(usableW / across, usableH / down);
  const gridW = cell * across;
  const x0 = (PAGE.w - gridW) / 2 + scene.margin.left * cell;
  const y0 = PAGE.margin + 16 + scene.margin.top * cell;

  const parts: string[] = [];

  /**
   * Squares the puzzle fixed, tinted so the printed sheet says which numbers were given.
   *
   * **Only `shaded`.** A `filled` mark is deliberately not drawn, even though the scene
   * language has one: the only board this is ever handed is the starting board, and if a
   * filled square ever appeared in one, drawing it would print part of the answer. Dropping
   * it is the safe direction to be wrong in, and the test that counts the shapes in this
   * SVG is what keeps that honest.
   */
  for (let r = 0; r < scene.rows; r++) {
    for (let c = 0; c < scene.cols; c++) {
      if (scene.marks[r * scene.cols + c] !== 'shaded') continue;
      parts.push(
        `<rect x="${(x0 + c * cell).toFixed(2)}" y="${(y0 + r * cell).toFixed(2)}" ` +
          `width="${cell.toFixed(2)}" height="${cell.toFixed(2)}" fill="#ececec" />`,
      );
    }
  }

  // Grid lines. Heavier every band, and at the edges.
  for (let c = 0; c <= scene.cols; c++) {
    const heavy = c === 0 || c === scene.cols || (scene.band.col > 0 && c % scene.band.col === 0);
    const x = x0 + c * cell;
    parts.push(
      `<line x1="${x.toFixed(2)}" y1="${y0.toFixed(2)}" x2="${x.toFixed(2)}" y2="${(y0 + scene.rows * cell).toFixed(2)}" stroke="#000" stroke-width="${heavy ? 0.5 : 0.18}" />`,
    );
  }
  for (let r = 0; r <= scene.rows; r++) {
    const heavy = r === 0 || r === scene.rows || (scene.band.row > 0 && r % scene.band.row === 0);
    const y = y0 + r * cell;
    parts.push(
      `<line x1="${x0.toFixed(2)}" y1="${y.toFixed(2)}" x2="${(x0 + scene.cols * cell).toFixed(2)}" y2="${y.toFixed(2)}" stroke="#000" stroke-width="${heavy ? 0.5 : 0.18}" />`,
    );
  }
  // Clues, and the numbers a puzzle gives you.
  for (const label of scene.labels) {
    const x = x0 + (label.col + 0.5) * cell;
    const y = y0 + (label.row + 0.5) * cell;
    const size = cell * 0.5 * (label.scale ?? 1);
    const weight = label.strong === true ? ' font-weight="700"' : '';
    parts.push(
      `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-size="${size.toFixed(2)}"${weight} text-anchor="middle" dominant-baseline="central" fill="#000">${escapeText(label.text)}</text>`,
    );
  }

  return `<!doctype html><html><head><meta charset="utf-8" />
<title>${escapeText(title)}</title>
<style>
  @page { size: A4 portrait; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body { font-family: system-ui, sans-serif; }
  svg { display: block; width: 100%; height: auto; }
  @media print { html, body { width: 210mm; } }
</style></head>
<body>
<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE.w}mm" height="${PAGE.h}mm" viewBox="0 0 ${PAGE.w} ${PAGE.h}">
  <text x="${PAGE.margin}" y="${PAGE.margin + 7}" font-size="7" fill="#000">${escapeText(title)}</text>
  <text x="${PAGE.w - PAGE.margin}" y="${PAGE.margin + 7}" font-size="4.5" text-anchor="end" fill="#444">${escapeText(subtitle)}</text>
  ${parts.join('\n  ')}
  <text x="${PAGE.margin}" y="${PAGE.h - PAGE.margin}" font-size="4" fill="#444">${escapeText(code)} &#183; Open Puzzle Studio</text>
</svg>
</body></html>`;
}
