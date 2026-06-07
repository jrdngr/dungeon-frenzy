# Dungeon Frenzy

A real-time party-management game: keep a party of adventurers alive and busy
while they fight an enemy, juggling each member's timed actions. Built with
TypeScript + HTML5 Canvas + Vite. See `docs/initial-design.md` for the vision,
core loop, and per-iteration scope.

## Running

- `just` — start the Vite dev server (auto-opens the game in the browser).
- `npm run dev` — same, directly.
- `npm run build` — type-check (`tsc`) and produce a production build in `dist/`.
- `npm run preview` — serve the production build.

## Repo layout

```
docs/initial-design.md   High-level design + current iteration's spec/balance.
index.html               Entry HTML; hosts the <canvas> and loads src/main.ts.
src/main.ts              Wires up the canvas and runs the requestAnimationFrame loop.
src/style.css            Page styling.
src/game/                Pure simulation — NO canvas/DOM imports here.
  config.ts              ALL tunable balance constants (HP, damage, cast times, AI).
  types.ts               Core data model (Entity, ActionDef, GameState, ...).
  hex.ts                 Axial hex coordinates + hex->pixel layout.
  actions.ts             Static action definitions, built from config.ts.
  combat.ts              Pure effect resolution (damage, heal, HoT ticks).
  engine.ts              createInitialState() + update(state, dt): the simulation.
src/ui/                  Rendering + input — all canvas/DOM lives here.
  layout.ts              Screen geometry (entity positions, bars, buttons) + hit-testing.
  render.ts              Draws everything from GameState; never mutates it.
  input.ts              Click handling: the select -> action -> target state machine.
```

## Conventions

- **Keep the sim pure.** `src/game/` must not import from `src/ui/` or touch the
  canvas/DOM. The UI reads `GameState` and routes clicks back into the engine.
  This separation keeps the core testable and ready for later iterations.
- **Tune balance in one place.** Adjust HP, damage, cast times, and enemy AI
  cadence in `src/game/config.ts` — not scattered across files.
- **Build iteratively.** `docs/initial-design.md` tracks the roadmap; update its
  iteration section when scope changes.

## Tooling

- **Do not use the Chrome DevTools plugin** (browser automation / screenshots /
  navigation) unless explicitly asked to in the current request. To check a
  change, prefer `npm run build` and reasoning about the code; only drive the
  browser when the user specifically requests it.

## Source control

This repo uses **`jj` (Jujutsu)**, not git. Do **not** run git commands.

- After each logical unit of work, create a commit:

  ```
  jj commit -m "<message>"
  ```

- Do **not** use any other `jj` commands that modify the commit graph
  (e.g. no `jj rebase`, `jj squash`, `jj abandon`, `jj edit`, `jj new`,
  `jj describe`, `jj split`). Read-only commands like `jj status` and `jj log`
  are fine.
