# Dungeon Frenzy

A real-time **healing game**: you play the party's healer, keeping a fixed,
auto-fighting party (tank + ranger + mage + you) alive by juggling timed,
mana-costed, cooldown-gated heals. Iteration 8 grew it into a **campaign**: a hub
of **5 areas**, each **3 fights** (small pack → bigger pack → boss) where HP/MP
carry across the fights of an area. Iteration 9 added **progression**: killing an
enemy grants **skill points** directly (scaled by difficulty), spent in a
node-based **skill tree** (opened from the hub) that unlocks/upgrades heals,
sustain, and auto-cast party abilities (shields, thorns, nukes, AoE, DoTs). You
start with only **Heal**; skill points and purchased skills persist across runs
and death (in-memory), so a player can always grind an area open. Enemies fight in **front/back rows** — the party focus-fires
one front-row enemy (click it; back-row enemies are shielded until the front row
dies). Everything is immobile; the hex grid is visual layout only. Built with
TypeScript + HTML5 Canvas + Vite. See `README.md` for a high-level overview of the
game and how to run it.

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
                         the 5 areas x 3 fights, per-enemy SP, and SKILL_NODES.
  types.ts               Core data model (Entity, ActionDef, GameState, SkillNode...).
  hex.ts                 Axial hex coordinates + hex->pixel layout.
  actions.ts             Static action defs + the enemy-archetype attack registry.
  combat.ts              Pure effect resolution (damage, heal, HoT/DoT ticks,
                         shields) + enemy/focus/front-row helpers.
  skills.ts              Pure skill-tree derivation: purchased skills -> effective
                         stats, the healer's dynamic bar, and party abilities.
  engine.ts              createInitialState/startArea/advanceFight + update(): the
                         simulation, the area -> fight progression, skill points
                         on kill, and spendSkillPoint.
src/ui/                  Rendering + input — all canvas/DOM lives here.
  layout.ts              Screen geometry (entity positions, bars, buttons, skill
                         tree node positions) + hit-testing.
  render.ts              Draws everything from GameState (incl. the skill tree); never mutates it.
  input.ts               Click handling: the armed-spell -> click-target model + skill tree.
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
