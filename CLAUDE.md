# Dungeon Frenzy

A real-time **healing game**: you play the party's healer, keeping a fixed,
auto-fighting party (tank + ranger + mage + you) alive by juggling four timed,
mana-costed, cooldown-gated heals. Iteration 8 grew it into a **campaign**: a hub
of **5 areas**, each **3 fights** (small pack → bigger pack → boss) where HP/MP
carry across the fights of an area. Enemies fight in **front/back rows** — the
party focus-fires one front-row enemy (click it; back-row enemies are shielded
until the front row dies). Everything is immobile; the hex grid is visual layout
only. Built with TypeScript + HTML5 Canvas + Vite. See `README.md` for a
high-level overview of the game and how to run it.

## Running

- `just` — start the Vite dev server (auto-opens the game in the browser).
- `npm run dev` — same, directly.
- `npm run build` — type-check (`tsc`) and produce a production build in `dist/`.
- `npm run preview` — serve the production build.

## Repo layout

```
README.md                High-level overview of the game + how to run it.
index.html               Entry HTML; hosts the <canvas> and loads src/main.ts.
src/main.ts              Wires up the canvas and runs the requestAnimationFrame loop.
src/style.css            Page styling.
src/game/                Pure simulation — NO canvas/DOM imports here.
  config.ts              ALL tunable balance: party/healer stats, enemy archetypes,
                         and the 5 areas x 3 fights of enemy placements.
  types.ts               Core data model (Entity, ActionDef, GameState, ...).
  hex.ts                 Axial hex coordinates + hex->pixel layout.
  actions.ts             Static action defs + the enemy-archetype attack registry.
  combat.ts              Pure effect resolution (damage, heal, HoT/DoT ticks) +
                         enemy/focus/front-row helpers.
  engine.ts              createInitialState/startArea/advanceFight + update(): the
                         simulation, including the area -> fight progression.
src/ui/                  Rendering + input — all canvas/DOM lives here.
  layout.ts              Screen geometry (entity positions, bars, buttons) + hit-testing.
  render.ts              Draws everything from GameState; never mutates it.
  input.ts               Click handling: the armed-spell -> click-target model.
```

## Conventions

- **Keep the sim pure.** `src/game/` must not import from `src/ui/` or touch the
  canvas/DOM. The UI reads `GameState` and routes clicks back into the engine.
  This separation keeps the core testable and ready for later iterations.
- **Tune balance in one place.** Adjust HP, damage, cast times, and enemy AI
  cadence in `src/game/config.ts` — not scattered across files.
- **The code is the source of truth.** There's no design-doc roadmap; `README.md`
  is a high-level overview for newcomers — keep it (and this file) current when
  scope changes.

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
