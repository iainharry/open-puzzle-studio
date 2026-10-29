# Open Puzzle Studio

Logic puzzles for a classroom. Free, open source, fully offline, no account, no server.

Sister project to [Open Jigsaw Studio](https://github.com/iainharry/open-jigsaw-studio),
and built on the parts of it that turned out to be about *playing a puzzle* rather than
about jigsaws.

**Status: M1.** The chassis works end to end with one puzzle type and three hand-drawn
pictures. There is no generator and no solver yet — those are M2, and nothing before them
is a real nonogram.

## Why this exists when Simon Tatham's collection already does

[Simon Tatham's Portable Puzzle Collection](https://www.chiark.greenend.org.uk/~sgtatham/puzzles/)
is forty puzzles, MIT, maintained since 2004, and better than this will be at being a
puzzle collection. It is the reference implementation and this project borrows its
architecture openly.

What it does not have, and structurally will not get: installation as an app, any
child-facing design, printing, a guide, assistance levels, classroom sharing, or
accessibility work. That list is this project's entire reason to exist. **The aim is not a
better puzzle collection. It is a puzzle collection a seven-year-old and their teacher can
both use.**

## The shape of it

```
src/core/      the mid-end. Puzzle-agnostic, headless, no DOM.
               undo/redo and its watchdog, seeded RNG, game codes,
               the session, storage.
src/puzzles/   one folder per puzzle type. Each exports one object
               satisfying PuzzleModule and knows nothing about the shell.
src/shell/     the front-end. Toolbar, canvas, library, status.
src/render/    drawing a Scene, and turning a press back into a cell.
```

Three layers, borrowed from Tatham: one front end, one shared mid-end, one back end per
puzzle. The seam was fixed before the first puzzle was written, because retrofitting it is
the most expensive thing a collection app can do.

**The whole app talks to a puzzle through one interface**, `PuzzleModule` in
`src/core/types.ts`. The keystone of it is `solve()`, which reports *which deductions it
needed* rather than only whether it won — one function that buys generation, honest
difficulty and honest hints.

## Running it

```
npm install
npm run dev        # http://localhost:5173
npm test           # the core and the puzzle modules, in Node
npm run build      # typecheck, bundle, write the service worker
npm run smoke      # the real app in a real browser (needs playwright)
```

`npm test` is headless by design: if a test of `src/core/` or `src/puzzles/` ever needs a
DOM, the boundary has leaked. The browser smoke test covers the seam — a press on a canvas
becoming a mark, a save surviving a reload — which is where the bugs actually live.

## Licence

MIT. See `CLAUDE.md` for the rules this repository is built under, including why every
puzzle gets a generic name.
