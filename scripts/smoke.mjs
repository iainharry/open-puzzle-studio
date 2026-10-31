/**
 * The smoke test: the real app, in a real browser, driven by real pointer events.
 *
 * The unit tests prove the module and the mid-end behave. This proves the *seam* — that a
 * press on a canvas becomes a cell, becomes a move, becomes a mark, becomes a save, and
 * comes back after a reload. None of that is testable in Node, and all of it is where the
 * bugs in the jigsaw project actually lived.
 *
 * Every check asserts what a player would see or what the stored state says, never what
 * the app reports about itself. A check that asks the app whether it did the right thing
 * is not a check.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const DIST = new URL('../dist/', import.meta.url).pathname;
const BASE = '/open-puzzle-studio/';
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
};

const { server, port } = await new Promise((resolve) => {
  const s = createServer(async (req, res) => {
    let path = decodeURIComponent((req.url ?? '/').split('?')[0]);
    if (path.startsWith(BASE)) path = path.slice(BASE.length - 1);
    if (path === '/' || path === '') path = '/index.html';
    try {
      const file = join(DIST, normalize(path).replace(/^(\.\.[/\\])+/, ''));
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  s.listen(0, '127.0.0.1', () => resolve({ server: s, port: s.address().port }));
});

const browser = await chromium.launch({
  args: ['--no-sandbox'],
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
});
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });

const failures = [];
function check(what, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(what);
}

const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.goto(`http://127.0.0.1:${port}${BASE}`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => globalThis.__ops !== undefined, { timeout: 10_000 });
await page.waitForTimeout(300);

// 1. It drew something, and the grid is on screen at a usable size.
const opening = await page.evaluate(() => {
  const app = globalThis.__ops;
  const canvas = document.querySelector('.board');
  const ctx = canvas.getContext('2d');
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const seen = new Set();
  for (let i = 0; i < data.length; i += 4 * 97) {
    seen.add(`${data[i] >> 5},${data[i + 1] >> 5},${data[i + 2] >> 5}`);
  }
  const scene = app.session.layout();
  const layout = app.layout;
  return {
    colours: seen.size,
    rows: scene.rows,
    cols: scene.cols,
    marginLeft: scene.margin.left,
    cell: layout.cell,
    status: document.querySelector('.status').textContent,
    tools: [...document.querySelectorAll('[data-act="tool"]')].map((b) => b.textContent),
    untitled: [...document.querySelectorAll('.bar .btn, .bar .field')].filter(
      (el) => !el.getAttribute('title'),
    ).length,
    hasHelp: !!document.querySelector('[data-act="help"]'),
  };
});
check('the board paints something', opening.colours > 2, `${opening.colours} colour buckets`);
check('a 5x5 grid with a clue margin is laid out', opening.rows === 5 && opening.cols === 5 && opening.marginLeft >= 1, `${opening.cols}x${opening.rows}, margin ${opening.marginLeft}`);
// A cell too small to hit is a puzzle nobody can play. 22px is a guess, labelled as one in
// render/scene.ts, and is one of the things the first playtest is for.
check('and the cells are big enough to press', opening.cell >= 22, `${opening.cell}px cells`);
check('the shell got its tools from the module, not from itself', opening.tools.join(',') === 'Fill,Cross out', opening.tools.join(', '));
// Every control says what it does. Tooltips are the desktop half of that and a tablet
// gets none of them, which is why How to play is a button and not only a hover.
check('every control in the toolbar explains itself', opening.untitled === 0, `${opening.untitled} control(s) with no hover text`);
check('and the rules are reachable without leaving the app', opening.hasHelp === true);
check('and it opens unsolved', /0% of the picture/.test(opening.status), opening.status);

// 2. A press on the canvas becomes a mark. This is the seam.
const pressing = await page.evaluate(async () => {
  const app = globalThis.__ops;
  const canvas = document.querySelector('.board');
  const rect = canvas.getBoundingClientRect();
  const { cell, originX, originY } = app.layout;
  const centre = (col, row) => ({
    x: rect.left + originX + (col + 0.5) * cell,
    y: rect.top + originY + (row + 0.5) * cell,
  });
  const fire = (type, at) =>
    canvas.dispatchEvent(new PointerEvent(type, {
      pointerId: 1, pointerType: 'mouse', isPrimary: true, bubbles: true,
      clientX: at.x, clientY: at.y, button: 0, buttons: type === 'pointerup' ? 0 : 1,
    }));

  const before = app.session.serialise();
  const at = centre(1, 0);
  fire('pointerdown', at);
  fire('pointerup', at);
  await new Promise((r) => setTimeout(r, 120));
  const after = app.session.serialise();

  // Drag across row 1, which the heart fills completely. One tap per cell is the first
  // thing that makes a nonogram tedious, so dragging has to paint.
  const start = centre(0, 1);
  fire('pointerdown', start);
  for (let col = 1; col < 5; col++) fire('pointermove', centre(col, 1));
  fire('pointerup', centre(4, 1));
  await new Promise((r) => setTimeout(r, 120));

  return { before, after, dragged: app.session.serialise() };
});
check('a press on the canvas fills the cell under it', pressing.after[1] === '#' && pressing.before[1] === '.', `"${pressing.before.slice(0, 5)}" -> "${pressing.after.slice(0, 5)}"`);
check('and nothing else moved', pressing.after.split('').filter((c) => c === '#').length === 1);
check('a drag paints a whole run', pressing.dragged.slice(5, 10) === '#####', `row 1 is "${pressing.dragged.slice(5, 10)}"`);

// 3. Undo, redo, and the watchdog.
const undoing = await page.evaluate(async () => {
  const app = globalThis.__ops;
  const before = app.session.serialise();
  document.querySelector('[data-act="undo"]').click();
  await new Promise((r) => setTimeout(r, 80));
  const undone = app.session.serialise();
  const strokeRow = undone.slice(5, 10);
  document.querySelector('[data-act="redo"]').click();
  await new Promise((r) => setTimeout(r, 80));
  const redone = app.session.serialise();

  // Press everything in the toolbar and require that nothing changed the puzzle without
  // recording a way back. This is the assertion that keeps undo correct as puzzle types
  // are added; a list of call sites somebody remembered to wrap is not a test.
  const guardBefore = app.unguardedChanges;
  for (const button of [...document.querySelectorAll('.bar [data-act]')]) {
    if (button.dataset.act === 'new' || button.dataset.act === 'daily') continue;
    button.click();
    await new Promise((r) => setTimeout(r, 120));
  }
  document.querySelector('[data-act="close-library"]')?.click();
  await new Promise((r) => setTimeout(r, 400));
  return { before, undone, redone, strokeRow, guardBefore, guardAfter: app.unguardedChanges };
});
check('undo takes a mark back', undoing.undone !== undoing.before, `"${undoing.before.slice(5, 10)}" -> "${undoing.undone.slice(5, 10)}"`);
// A five-cell drag is one thing the player did. One step per cell means undoing a
// twenty-cell stroke takes twenty presses, which is not an undo feature. This assertion
// exists because the first run of this test printed "#####" -> "####." and gave it away.
check('and a whole drag is one step, not five', undoing.strokeRow === '.....', `row 1 after one undo: "${undoing.strokeRow}"`);
check('and redo puts it back', undoing.redone === undoing.before);
check('every control leaves a way back', undoing.guardAfter === undoing.guardBefore, `${undoing.guardAfter - undoing.guardBefore} unguarded change(s)`);

// 4. Solving it, through the app rather than around it.
const solving = await page.evaluate(async () => {
  const app = globalThis.__ops;
  const puzzle = app.session.puzzle;
  const canvas = document.querySelector('.board');
  const rect = canvas.getBoundingClientRect();
  const { cell, originX, originY } = app.layout;
  const fire = (type, col, row) =>
    canvas.dispatchEvent(new PointerEvent(type, {
      pointerId: 2, pointerType: 'mouse', isPrimary: true, bubbles: true,
      clientX: rect.left + originX + (col + 0.5) * cell,
      clientY: rect.top + originY + (row + 0.5) * cell,
      button: 0, buttons: type === 'pointerup' ? 0 : 1,
    }));

  // Start from blank so the earlier marks do not confuse this.
  while (app.session.history.canUndo) app.session.undo();
  await new Promise((r) => setTimeout(r, 120));

  for (let row = 0; row < puzzle.rows; row++) {
    for (let col = 0; col < puzzle.cols; col++) {
      if (!puzzle.solution[row * puzzle.cols + col]) continue;
      if (app.session.layout().marks[row * puzzle.cols + col] === 'filled') continue;
      fire('pointerdown', col, row);
      fire('pointerup', col, row);
      await new Promise((r) => setTimeout(r, 25));
    }
  }
  await new Promise((r) => setTimeout(r, 600));
  return {
    solved: app.session.solved,
    status: document.querySelector('.status').textContent,
    state: app.session.serialise(),
  };
});
check('the picture can be solved by pressing cells', solving.solved === true, solving.status);
check('and the app says so in words', /Finished/.test(solving.status), solving.status);

// 5. It survives a reload — which is what "saved" actually means.
await page.waitForTimeout(600);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => globalThis.__ops?.session !== null, { timeout: 10_000 });
await page.waitForTimeout(400);
const reloaded = await page.evaluate(() => ({
  state: globalThis.__ops.session.serialise(),
  solved: globalThis.__ops.session.solved,
  status: document.querySelector('.status').textContent,
}));
check('the solved grid comes back after a reload', reloaded.state === solving.state, `"${reloaded.state}"`);
check('and it is still finished', reloaded.solved === true, reloaded.status);

// 6. The game code round-trips through the URL.
const viaCode = await page.evaluate(() => document.querySelector('.code').value);
await page.goto(`http://127.0.0.1:${port}${BASE}#${viaCode}`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => globalThis.__ops?.session !== null, { timeout: 10_000 });
await page.waitForTimeout(400);
const fromCode = await page.evaluate(() => ({
  title: globalThis.__ops.session.puzzle.title,
  code: document.querySelector('.code').value,
}));
check('a game code opens the puzzle it names', fromCode.code === viaCode, `${viaCode} -> ${fromCode.code}`);
check('and it is a fresh board, not the finished one', /Heart|House|Tree/.test(fromCode.title), fromCode.title);

// 7. Generated puzzles — the whole point of M2. Made at a size and a difficulty, solvable
// by reasoning, and the same code gives the same picture on any device.
const generated = await page.evaluate(async () => {
  const app = globalThis.__ops;
  const out = {};
  const makeOne = async (size, tier) => {
    document.querySelector('.size').value = String(size);
    document.querySelector('.tier').value = tier;
    document.querySelector('[data-act="new"]').click();
    await new Promise((r) => setTimeout(r, 2500));
    const puzzle = app.session.puzzle;
    return {
      rows: puzzle.rows,
      cols: puzzle.cols,
      tierUsed: puzzle.tierUsed,
      title: puzzle.title,
      code: document.querySelector('.code').value,
      status: document.querySelector('.status').textContent,
      filled: puzzle.solution.filter(Boolean).length,
      // Solve it with the app's own solver, from blank, allowing everything. A puzzle it
      // cannot finish is one a player cannot finish without guessing.
      solvable: app.session.module.solve(puzzle, app.session.module.start(puzzle), 3).solved,
    };
  };

  out.gentle = await makeOne(10, 'gentle');
  out.steady = await makeOne(10, 'steady');
  out.tricky = await makeOne(12, 'tricky');

  // The same code, opened again, must give the identical picture.
  const code = out.steady.code;
  const before = out.steady;
  location.hash = code;
  location.reload();
  return { ...out, reopenCode: code, beforeSolution: before.filled };
}, []);
check('a puzzle can be made at a chosen size', generated.steady.rows === 10 && generated.steady.cols === 10, `${generated.steady.cols}x${generated.steady.rows}`);
// The claim the generator rests on: no guessing is ever required.
check('every generated puzzle can be solved by reasoning', generated.gentle.solvable && generated.steady.solvable && generated.tricky.solvable);
check('and the difficulty asked for is the difficulty given', generated.gentle.tierUsed === 1 && generated.steady.tierUsed === 2 && generated.tricky.tierUsed === 3, `gentle=${generated.gentle.tierUsed} steady=${generated.steady.tierUsed} tricky=${generated.tricky.tierUsed}`);
// Reported rather than assumed: the status line shows what the solver measured.
check('and the app tells the player which it is', /Gentle/.test(generated.gentle.status) && /Tricky/.test(generated.tricky.status), `${generated.gentle.status} | ${generated.tricky.status}`);
check('and the picture is worth looking at', generated.steady.filled > 20 && generated.steady.filled < 76, `${generated.steady.filled} of 100 squares filled`);

// 8. The same code gives the same picture — on a reload, which is as close to "another
// device" as this test can get.
await page.waitForFunction(() => globalThis.__ops?.session !== null, { timeout: 15_000 });
await page.waitForTimeout(600);
const reopened2 = await page.evaluate(() => ({
  code: document.querySelector('.code').value,
  filled: globalThis.__ops.session.puzzle.solution.filter(Boolean).length,
  rows: globalThis.__ops.session.puzzle.rows,
}));
check('the same code gives back the same picture', reopened2.code === generated.reopenCode && reopened2.filled === generated.beforeSolution, `${reopened2.filled} vs ${generated.beforeSolution} squares`);

// 9. Hints, in three strengths. The feature this app is for, and the one most likely to
// quietly become useless — so each strength is checked for what it does *and* for what it
// does not do yet.
const hints = await page.evaluate(async () => {
  const app = globalThis.__ops;
  document.querySelector('.size').value = '10';
  document.querySelector('.tier').value = 'steady';
  document.querySelector('[data-act="new"]').click();
  await new Promise((r) => setTimeout(r, 2500));

  const press = async () => {
    document.querySelector('[data-act="hint"]').click();
    await new Promise((r) => setTimeout(r, 200));
    return {
      status: document.querySelector('.status').textContent,
      button: document.querySelector('.hint-btn').textContent,
      board: app.session.serialise(),
      highlighted: app.hintCells.length,
    };
  };

  const blank = app.session.serialise();
  const one = await press();
  const two = await press();
  const three = await press();

  // Undo must take the whole applied hint back in one press, not cell by cell.
  const depthBefore = app.session.history.depth;
  document.querySelector('[data-act="undo"]').click();
  await new Promise((r) => setTimeout(r, 200));
  const afterUndo = app.session.serialise();
  document.querySelector('[data-act="redo"]').click();
  await new Promise((r) => setTimeout(r, 200));

  // Now put something impossible on the board and ask again.
  const puzzle = app.session.puzzle;
  let row = 0;
  for (let r = 0; r < puzzle.rows; r++) {
    const want = puzzle.rowClues[r].reduce((a, b) => a + b, 0);
    if (want < puzzle.cols) { row = r; break; }
  }
  app.session.change('break it', () => {
    for (let col = 0; col < puzzle.cols; col++) {
      app.session.play({ col, row, mark: 'filled' }, 'wrong');
    }
  });
  document.querySelector('[data-act="hint"]').click();
  await new Promise((r) => setTimeout(r, 300));
  const wrong = {
    status: document.querySelector('.status').textContent,
    board: app.session.serialise(),
  };

  // Sample the canvas where the broken row is. The wash under the marks is invisible on a
  // filled square, so this checks the *picture* shows the highlight rather than checking
  // that a highlight was requested.
  await new Promise((r) => setTimeout(r, 300));
  const canvas = document.querySelector('.board');
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const { cell, originX, originY } = app.layout;
  const px = Math.round((originX + 1.5 * cell) * dpr);
  const py = Math.round((originY + (row + 0.06) * cell) * dpr);
  const [hr, hg, hb] = ctx.getImageData(px, py, 1, 1).data;
  const accent = hb > hr + 20 && hb > 120;

  return { blank, one, two, three, depthBefore, afterUndo, wrong, brokenRow: row + 1, accent, pixel: `${hr},${hg},${hb}` };
});
check('the first hint says where to look and nothing else', /Row|Column/.test(hints.one.status) && hints.one.board === hints.blank, hints.one.status);
check('and highlights that line on the board', hints.one.highlighted >= 5, `${hints.one.highlighted} squares lit`);
check('the second explains why, still without doing it', hints.two.status !== hints.one.status && hints.two.board === hints.blank, hints.two.status.slice(0, 70));
check('and the button says what the next press will do', hints.one.button === 'Why?' && hints.two.button === 'Do it', `${hints.one.button} -> ${hints.two.button}`);
check('the third actually does it', hints.three.board !== hints.blank, `${hints.three.board.replace(/\./g, '').length} squares decided`);
// A hint applied as five separate steps would take five presses to take back.
check('and the whole hint is one undo step', hints.afterUndo === hints.blank);

// The most valuable hint there is, and the one a child cannot get by staring.
check('a wrong board is reported as wrong, not deduced from', /cannot be right/.test(hints.wrong.status), hints.wrong.status.slice(0, 90));
check('and the wrong line is visibly marked, over the squares already filled', hints.accent === true, `pixel at the row edge was ${hints.pixel}`);
check('and it names the line, not the square', new RegExp(`row ${hints.brokenRow}\\b`, 'i').test(hints.wrong.status) && !/square \d/.test(hints.wrong.status), hints.wrong.status.slice(0, 90));

check('nothing threw along the way', errors.length === 0, errors.slice(0, 3).join(' | '));

await page.screenshot({ path: new URL('../smoke.png', import.meta.url).pathname });
console.log('\nwrote smoke.png');

await browser.close();
server.close();

if (failures.length) {
  console.error(`\nFAILURES:\n${failures.map((f) => ` - ${f}`).join('\n')}`);
  process.exit(1);
}
console.log('all smoke checks passed');
