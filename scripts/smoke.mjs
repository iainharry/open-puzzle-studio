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
    // The toolbar's per-puzzle choices are built from what the module says it offers. The
    // shell used to own this list, which is how one nonogram's sizes came to be offered to
    // every puzzle that might ever be written.
    choices: [...document.querySelectorAll('[data-choice]')].map((s) => s.dataset.choice),
    puzzles: [...document.querySelectorAll('.puzzle option')].map((o) => o.textContent),
  };
});
check('the board paints something', opening.colours > 2, `${opening.colours} colour buckets`);
check('a 5x5 grid with a clue margin is laid out', opening.rows === 5 && opening.cols === 5 && opening.marginLeft >= 1, `${opening.cols}x${opening.rows}, margin ${opening.marginLeft}`);
// A cell too small to hit is a puzzle nobody can play. 22px is a guess, labelled as one in
// render/scene.ts, and is one of the things the first playtest is for.
check('and the cells are big enough to press', opening.cell >= 22, `${opening.cell}px cells`);
check('the shell got its tools from the module, not from itself', opening.tools.join(',') === 'Fill,Cross out', opening.tools.join(', '));
check('and its choices too', opening.choices.join(',') === 'size,tier', opening.choices.join(', '));
check('and it offers both puzzle types', opening.puzzles.join(',') === 'Picture Logic,Number Place', opening.puzzles.join(', '));
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
// Reloaded explicitly: navigating to a URL that differs only in its fragment does not
// reload the page, so without this the app is still the one from the section above and the
// check reads back a field nobody changed.
await page.goto(`http://127.0.0.1:${port}${BASE}#${viaCode}`, { waitUntil: 'networkidle' });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => globalThis.__ops?.session !== null, { timeout: 10_000 });
await page.waitForTimeout(400);
const fromCode = await page.evaluate(() => ({
  title: globalThis.__ops.session.title,
  code: document.querySelector('.code').value,
  solved: globalThis.__ops.session.solved,
  marks: globalThis.__ops.session.serialise(),
}));
check('a game code opens the puzzle it names', fromCode.code === viaCode, `${viaCode} -> ${fromCode.code}`);
check('and it is a fresh board, not the finished one', /Heart|House|Tree/.test(fromCode.title) && fromCode.solved === false && !fromCode.marks.includes('#'), `${fromCode.title}: "${fromCode.marks}"`);

// 7. Generated puzzles — the whole point of M2. Made at a size and a difficulty, solvable
// by reasoning, and the same code gives the same picture on any device.
const generated = await page.evaluate(async () => {
  const app = globalThis.__ops;
  const out = {};
  const makeOne = async (size, tier) => {
    document.querySelector('[data-choice="size"]').value = String(size);
    document.querySelector('[data-choice="tier"]').value = tier;
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
  document.querySelector('[data-choice="size"]').value = '10';
  document.querySelector('[data-choice="tier"]').value = 'steady';
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
  /**
   * How much warm colour is in a row's clue margin.
   *
   * A clue whose line is finished and still does not match its numbers is drawn in a
   * warning colour and underlined. This counts the pixels a player would see, in the
   * margin where the numbers are, rather than asking the app what tone it chose.
   */
  const warmInMargin = (r) => {
    const canvas = document.querySelector('.board');
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const { cell, originX, originY } = app.layout;
    const data = ctx.getImageData(
      Math.round((originX - cell) * dpr),
      Math.round((originY + r * cell) * dpr),
      Math.round(cell * dpr),
      Math.round(cell * dpr),
    ).data;
    let warm = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > data[i + 1] + 30 && data[i] > data[i + 2] + 30) warm++;
    }
    return warm;
  };
  await new Promise((r) => setTimeout(r, 300));
  const warmBefore = warmInMargin(row);

  app.session.change('break it', () => {
    for (let col = 0; col < puzzle.cols; col++) {
      app.session.play({ col, row, mark: 'filled' }, 'wrong');
    }
  });
  await new Promise((r) => setTimeout(r, 300));
  const warmAfter = warmInMargin(row);
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

  return { blank, one, two, three, depthBefore, afterUndo, wrong, brokenRow: row + 1, accent, pixel: `${hr},${hg},${hb}`, warmBefore, warmAfter };
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
// A clue that is finished and wrong has to *look* different from one that is merely
// unfinished. Without this, the two states are drawn identically — which is how a player
// came to read the one clue that had not gone faint as a fault in the app.
check('a clue goes orange the moment its line is finished and wrong', hints.warmBefore === 0 && hints.warmAfter > 20, `warm pixels in the margin: ${hints.warmBefore} -> ${hints.warmAfter}`);

// 10. The demonstration. Asked for as "a video", built as the app playing itself — so the
// check is that a child watching it sees the board change with captions, and that it puts
// their own puzzle back afterwards.
const demo = await page.evaluate(async () => {
  const app = globalThis.__ops;
  // Start from a known puzzle so "it came back" means something.
  document.querySelector('[data-choice="size"]').value = '10';
  document.querySelector('[data-act="new"]').click();
  await new Promise((r) => setTimeout(r, 2500));
  const mine = app.session.serialise();
  const myCode = document.querySelector('.code').value;

  document.querySelector('[data-act="help"]').click();
  document.querySelector('[data-act="demo"]').click();
  await new Promise((r) => setTimeout(r, 900));
  const started = {
    barShown: !document.querySelector('.demo-bar').hidden,
    helpClosed: document.querySelector('.help').hidden,
    step: document.querySelector('.demo-step').textContent,
    caption: document.querySelector('.demo-caption').textContent,
    board: app.session.serialise(),
    lit: app.hintCells.length,
  };

  // The board is deaf while it runs.
  const canvas = document.querySelector('.board');
  const rect = canvas.getBoundingClientRect();
  canvas.dispatchEvent(new PointerEvent('pointerdown', {
    pointerId: 9, pointerType: 'mouse', isPrimary: true, bubbles: true,
    clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, button: 0, buttons: 1,
  }));
  await new Promise((r) => setTimeout(r, 120));
  const afterPoke = app.session.serialise();

  // Let it run a few beats, then check it is actually marking squares.
  await new Promise((r) => setTimeout(r, 6000));
  const running = {
    board: app.session.serialise(),
    caption: document.querySelector('.demo-caption').textContent,
    step: document.querySelector('.demo-step').textContent,
  };

  // Pause stops it.
  document.querySelector('[data-act="demo-pause"]').click();
  const pausedLabel = document.querySelector('[data-act="demo-pause"]').textContent;
  const atPause = app.session.serialise();
  await new Promise((r) => setTimeout(r, 2500));
  const stillPaused = app.session.serialise();

  document.querySelector('[data-act="demo-close"]').click();
  await new Promise((r) => setTimeout(r, 1200));
  const after = {
    barHidden: document.querySelector('.demo-bar').hidden,
    board: app.session.serialise(),
    code: document.querySelector('.code').value,
  };
  return { mine, myCode, started, afterPoke, running, pausedLabel, atPause, stillPaused, after };
});
check('the demonstration starts and says what it is doing', demo.started.barShown && /1 of \d/.test(demo.started.step) && demo.started.caption.length > 20, `${demo.started.step}: ${demo.started.caption.slice(0, 60)}`);
check('and closes How to play behind it', demo.started.helpClosed === true);
check('and lights up the line it is talking about', demo.started.lit >= 5, `${demo.started.lit} squares lit`);
// A demonstration you can interfere with ends up in a state nobody intended.
check('the board ignores presses while it runs', demo.afterPoke === demo.started.board);
check('it marks squares as it goes', demo.running.board !== demo.started.board, `${demo.running.board.replace(/\./g, '').length} squares marked by ${demo.running.step}`);
check('and the caption keeps up with it', demo.running.caption !== demo.started.caption);
check('pause actually pauses', demo.pausedLabel === 'Play' && demo.stillPaused === demo.atPause);
// The player's own puzzle must come back, or watching a demo costs you your game.
check('and stopping gives the player their own puzzle back', demo.after.barHidden && demo.after.board === demo.mine && demo.after.code === demo.myCode, `${demo.after.code}`);

// 11. Printing. The sister project shipped a sheet that printed the answer, so this
// counts what is in the sheet rather than that a sheet was produced.
const sheet = await page.evaluate(() => {
  const app = globalThis.__ops;
  const module = app.session.module;
  const html = globalThis.__opsSheet(module.printable(app.session.puzzle), 'Test', 'code-here');
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const svg = doc.querySelector('svg');
  return {
    lines: svg.querySelectorAll('line').length,
    filled: svg.querySelectorAll('rect, path, circle').length,
    numbers: [...svg.querySelectorAll('text')].map((t) => t.textContent).filter((t) => /^\d+$/.test(t)).length,
    hasCode: html.includes('code-here'),
    a4: /size: A4/.test(html),
  };
});
check('the printed sheet is an empty grid, not the answer', sheet.filled === 0, `${sheet.filled} filled shape(s)`);
check('and it has the clues on it', sheet.numbers > 10, `${sheet.numbers} numbers`);
check('and the grid lines to write in', sheet.lines > 10, `${sheet.lines} lines`);
check('and the code, so paper and screen are the same puzzle', sheet.hasCode && sheet.a4);

// 12. The second puzzle, through the same shell.
//
// This is the milestone. Every check below goes through the same toolbar, the same canvas,
// the same undo stack, the same hint button and the same save — and the shell has never
// heard of a number puzzle. Where any of it had secretly been doing nonogram work, this is
// where it shows.
const second = await page.evaluate(async () => {
  const app = globalThis.__ops;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const picker = document.querySelector('.puzzle');
  picker.value = 'number-place';
  picker.dispatchEvent(new Event('change'));
  await sleep(2000);

  const switched = {
    choices: [...document.querySelectorAll('[data-choice]')].map((s) => s.dataset.choice),
    tools: [...document.querySelectorAll('[data-act="tool"]')].map((b) => b.textContent),
    id: app.session.module.id,
  };

  document.querySelector('[data-choice="size"]').value = '4';
  document.querySelector('[data-choice="tier"]').value = 'gentle';
  document.querySelector('[data-act="new"]').click();
  await sleep(1500);

  const scene = app.session.layout();
  const puzzle = app.session.puzzle;
  const board = {
    rows: scene.rows,
    band: scene.band,
    margin: scene.margin,
    shaded: scene.marks.filter((m) => m === 'shaded').length,
    givens: puzzle.givens.filter(Boolean).length,
    strong: scene.labels.every((l) => l.strong === true),
    status: document.querySelector('.status').textContent,
    cell: app.layout.cell,
  };

  // The help panel is the puzzle's own words now, not a paragraph about runs and clues.
  document.querySelector('[data-act="help"]').click();
  await sleep(150);
  const help = document.querySelector('.help-body').textContent;
  const helpTitle = document.querySelector('.help-title').textContent;
  document.querySelector('[data-act="close-help"]').click();

  const canvas = document.querySelector('.board');
  const rect = canvas.getBoundingClientRect();
  const fire = (type, col, row, id = 31) => {
    const { cell, originX, originY } = app.layout;
    canvas.dispatchEvent(new PointerEvent(type, {
      pointerId: id, pointerType: 'mouse', isPrimary: true, bubbles: true,
      clientX: rect.left + originX + (col + 0.5) * cell,
      clientY: rect.top + originY + (row + 0.5) * cell,
      button: 0, buttons: type === 'pointerup' ? 0 : 1,
    }));
  };
  const pick = (value) => document.querySelector(`[data-tool="v${value}"]`).click();
  const press = async (col, row) => {
    fire('pointerdown', col, row);
    fire('pointerup', col, row);
    await sleep(30);
  };

  // A square the puzzle filled in cannot be changed, by any tool.
  const givenAt = puzzle.givens.findIndex(Boolean);
  const before = app.session.serialise();
  pick(1);
  await press(givenAt % 4, Math.floor(givenAt / 4));
  document.querySelector('[data-tool="rub"]').click();
  await press(givenAt % 4, Math.floor(givenAt / 4));
  const afterGiven = app.session.serialise();

  // A drag with a number must not scatter that number across the row. Started on a row
  // with at least two empty squares, or a scattering bug would have nowhere to show.
  const blanks = [...puzzle.givens.keys()].filter((i) => !puzzle.givens[i]);
  const rowOf = (i) => Math.floor(i / 4);
  const dragRow = [0, 1, 2, 3].find((r) => blanks.filter((i) => rowOf(i) === r).length >= 2);
  const dragFrom = blanks.filter((i) => rowOf(i) === dragRow)[0] % 4;
  pick(1);
  fire('pointerdown', dragFrom, dragRow, 32);
  for (let col = dragFrom + 1; col < 4; col++) fire('pointermove', col, dragRow, 32);
  fire('pointerup', 3, dragRow, 32);
  await sleep(150);
  const afterDrag = app.session.serialise();
  while (app.session.history.canUndo) app.session.undo();
  await sleep(150);

  // Now solve it, one number at a time, through the toolbar and the canvas.
  for (const i of blanks) {
    pick(puzzle.solution[i]);
    await press(i % 4, Math.floor(i / 4));
  }
  await sleep(700);
  const solved = {
    solved: app.session.solved,
    status: document.querySelector('.status').textContent,
    state: app.session.serialise(),
    banner: !document.querySelector('.finish-banner').hidden,
    code: document.querySelector('.code').value,
  };

  // Break it, and ask. A repeat in a line is the mistake a child actually makes.
  while (app.session.history.canUndo) app.session.undo();
  await sleep(150);
  const row = [0, 1, 2, 3].find(
    (r) =>
      blanks.some((i) => rowOf(i) === r) &&
      [...puzzle.givens.keys()].some((i) => rowOf(i) === r && puzzle.givens[i]),
  );
  const copyFrom = [...puzzle.givens.keys()].find((i) => rowOf(i) === row && puzzle.givens[i]);
  const spare = blanks.find((i) => rowOf(i) === row);
  app.session.play({ col: spare % 4, row, value: puzzle.solution[copyFrom] }, 'break it');
  await sleep(100);
  document.querySelector('[data-act="hint"]').click();
  await sleep(250);
  const wrong = {
    status: document.querySelector('.status').textContent,
    lit: app.hintCells.length,
    board: app.session.serialise(),
  };

  // And a real hint, in three strengths, on the same board put back right. Undone through
  // the button rather than the session, because pressing Undo has to reset the hint ladder
  // as well as the board — which is how this test found that it did not.
  while (app.session.history.canUndo) {
    document.querySelector('[data-act="undo"]').click();
    await sleep(60);
  }
  await sleep(150);
  const blank = app.session.serialise();
  document.querySelector('[data-act="hint"]').click();
  await sleep(200);
  const one = {
    status: document.querySelector('.status').textContent,
    lit: app.hintCells.length,
    board: app.session.serialise(),
  };
  document.querySelector('[data-act="hint"]').click();
  await sleep(200);
  const two = document.querySelector('.status').textContent;
  document.querySelector('[data-act="hint"]').click();
  await sleep(200);
  const three = app.session.serialise();

  // Both puzzles in one library, named by their module rather than by an id.
  document.querySelector('[data-act="library"]').click();
  await sleep(500);
  const library = [...document.querySelectorAll('.lib-sub')].map((e) => e.textContent);
  document.querySelector('[data-act="close-library"]').click();

  return { switched, board, help, helpTitle, before, afterGiven, afterDrag, solved, wrong, blank, one, two, three, library };
});

check('switching puzzle type switches the whole toolbar', second.switched.id === 'number-place' && second.switched.choices.join(',') === 'size,tier,glyphs', `${second.switched.id}: ${second.switched.choices.join(', ')}`);
check('and its tools are its numbers, not Fill and Cross out', second.switched.tools.join(',') === '1,2,3,4,5,6,Rub out', second.switched.tools.join(', '));
check('a 4x4 is laid out with no clue margin', second.board.rows === 4 && second.board.margin.left === 0, `${second.board.rows} rows, margin ${second.board.margin.left}`);
// The reason `band` stopped being a single number. A 6x6 would be {col:3,row:2} here.
check('and banded by its boxes, across and down separately', second.board.band.col === 2 && second.board.band.row === 2, JSON.stringify(second.board.band));
check('the squares the puzzle filled in are shaded and drawn heavier', second.board.shaded === second.board.givens && second.board.shaded > 0 && second.board.strong, `${second.board.shaded} shaded of ${second.board.givens} givens`);
check('and the cells are still big enough to press', second.board.cell >= 22, `${second.board.cell}px cells`);
check('the status line talks about squares, not about a picture', /of the squares filled in/.test(second.board.status), second.board.status);
// The help panel was HTML in the shell, written about runs and clues. A second puzzle made
// it read as nonsense; now the puzzle writes it.
check('How to play is written by the puzzle that is open', /every column and every box/.test(second.help) && !/picture appears/.test(second.help), second.helpTitle);
check('and it says which tools this puzzle has', /Rub out/.test(second.help) && /cannot be rubbed out/.test(second.help));
check('a number the puzzle gave you cannot be changed or rubbed out', second.afterGiven === second.before, `"${second.before}" -> "${second.afterGiven}"`);
// Dragging a 7 across a board scatters sevens nobody meant to put there, so this tool says
// it does not drag — and the shell asks the tool rather than assuming.
check('and dragging does not scatter a number across the row', second.afterDrag.replace(/\./g, '').length === second.before.replace(/\./g, '').length + 1, `${second.afterDrag}`);
check('the board can be solved through the toolbar and the canvas', second.solved.solved === true, second.solved.status);
check('and the app says so, and notices', /Finished/.test(second.solved.status) && second.solved.banner === true, second.solved.status);
check('a wrong board is reported as wrong, naming the line', /there can only ever be one/.test(second.wrong.status) && second.wrong.lit === 4, `${second.wrong.lit} squares lit: ${second.wrong.status.slice(0, 80)}`);
check('and it names the line, not the square', !/square \d/.test(second.wrong.status), second.wrong.status.slice(0, 80));
check('the first hint says where to look and nothing else', second.one.lit >= 4 && second.one.board === second.blank, second.one.status);
check('the second explains why, still without doing it', second.two !== second.one.status, second.two.slice(0, 80));
check('and the third does it', second.three !== second.blank);
check('both puzzles live in one library, named by their puzzle', second.library.some((s) => s.startsWith('Number Place')) && second.library.some((s) => s.startsWith('Picture Logic')), second.library.slice(0, 3).join(' | '));

// 13. And the second puzzle's code opens the second puzzle.
//
// Reloaded explicitly. Navigating to a URL that differs only in its fragment does not
// reload the page, so without this the app would still be the one from the section above
// and the check would be reading back a field nobody had changed — which is the definition
// of asking the app whether it did the right thing.
await page.goto(`http://127.0.0.1:${port}${BASE}#${second.solved.code}`, { waitUntil: 'networkidle' });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => globalThis.__ops?.session !== null, { timeout: 10_000 });
await page.waitForTimeout(500);
const reopenedSecond = await page.evaluate(() => ({
  id: globalThis.__ops.session.module.id,
  code: document.querySelector('.code').value,
  picker: document.querySelector('.puzzle').value,
  solved: globalThis.__ops.session.solved,
  tools: [...document.querySelectorAll('[data-act="tool"]')].map((b) => b.textContent).join(','),
}));
check('a code says which puzzle it is, and the app opens that one', reopenedSecond.id === 'number-place' && reopenedSecond.code === second.solved.code, `${second.solved.code} -> ${reopenedSecond.code}`);
check('and the toolbar follows it without being told', reopenedSecond.picker === 'number-place' && reopenedSecond.tools.endsWith('Rub out'), reopenedSecond.tools);
check('and it is a fresh board, not the finished one', reopenedSecond.solved === false);

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
