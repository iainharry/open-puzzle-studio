# Open Puzzle Studio — project constitution

Rules for any AI agent or human working in this repository. Read this before changing code.
Carried over from Open Jigsaw Studio, where most of them were learned the expensive way.

## Product principles

1. **Open source, MIT.** Every dependency's licence is recorded in `ARCHITECTURE.md`.
   Never copy GPL/AGPL source into this codebase.
2. **Local-first.** The app must work fully offline with no account and no network. Cloud
   is an optional extension, never a dependency of core functionality.
3. **Built for a classroom and for young children.** Where a decision would serve an adult
   enthusiast or a nine-year-old but not both, it serves the nine-year-old. An enthusiast's
   collection already exists and is better than ours will be.
4. **The user owns their data.** Puzzle state is always locally recoverable and exportable.

## Architectural rules

5. **Three layers, and the seam is not negotiable.** `src/core/` is the mid-end and knows
   no puzzle. `src/puzzles/<name>/` is a back-end and knows no shell. `src/shell/` is the
   front-end and knows no puzzle. If a line in the shell mentions a clue, a run or a digit,
   the seam has leaked and that is the bug.
5a. **A layering rule with one implementation has not been tested.** From M1 to M4 the
   shell carried a comment saying it knew nothing about nonograms while importing the
   nonogram module and hard-coding its sizes, its codes, its help text and its tools —
   fourteen places, none of them visible, because there was nothing to compare against.
   When the shell has to do something a puzzle has not told it, the fix is a question the
   interface cannot yet ask, **not** a cast and a special case. `puzzle as { title }` is
   the shape that mistake takes.
6. **`src/core/` and `src/puzzles/` must run in Node with no DOM**, no `canvas`, no
   `window`. If a test of either needs jsdom, the boundary has leaked. This is what makes
   the app testable at all.
7. **A puzzle talks to the world only through `PuzzleModule`.** Adding a method to that
   interface is a decision about every future puzzle, not a convenience for this one.
8. **`layout()` returns a scene; it does not draw.** Asserting that a thing was drawn is
   not asserting what it shows — the single most repeated bug in the jigsaw project. A
   scene is a value a Node test can read.
9. **Puzzles are derived, not stored.** An instance is regenerated deterministically from
   its spec. A save file holds player state only. Adding a field to a save is a schema
   change and needs a version bump plus a migration.
10. **Determinism.** Same spec, same puzzle, byte for byte, on every device and forever.
    There are tests for this; do not weaken them. **No `Math.random()` anywhere in
    `src/core/` or `src/puzzles/`.**
11. **Write the solver before the generator.** A puzzle generated without a solver is
    ambiguous, unsolvable by reasoning, or both — and looks fine. Difficulty is rated by
    *which deductions the solver needed*, never by clue count, and the test is two-sided:
    a puzzle is Hard only if the hard solver succeeds **and** the easier one fails.

## Engineering rules

12. TypeScript strict, including `noUncheckedIndexedAccess` and
    `exactOptionalPropertyTypes`. No `any`, no `@ts-ignore` without a comment saying why.
13. Every non-trivial behaviour of the core or a puzzle has a Node test. The seam between
    them and the shell has a browser smoke check.
14. **A check that asks the app whether it did the right thing is not a check.** Assert
    what a player would see, or what the stored state says.
15. Do not claim functionality works unless it has actually been run.
16. No unnecessary dependencies. Prefer 200 lines we own to a 500 kB package for three
    operations. Every new dependency needs a line in `ARCHITECTURE.md` justifying it.
17. Do not implement several major features in one uncontrolled change.
18. Preserve working functionality. If you must replace something that works, say why in
    the commit message.

## Names

19. **Generic names only.** *Picross* is Nintendo's, *Pic-a-Pix* is Conceptis's, *KenKen*
    is Nextoy's, *Rubik's* is Spin Master's, *Wordle* is the New York Times's — and the
    NYT has filed DMCA notices against clone repositories over the mechanics, not just the
    name. Mechanics are free; names are not. Follow Simon Tatham's naming and it costs
    nothing.
20. **Never bundle a word list we do not have the right to.** TWL, OWL, OSPD and
    Collins/SOWPODS are out. 12dicts, Wordnik and ENABLE are in. Any word list shipped to
    a classroom is filtered for slurs first; that is not optional.

## Known non-goals (for now)

Multiplayer, accounts, cloud sync, achievements, leaderboards, ads, a native shell. Do not
add these speculatively.
