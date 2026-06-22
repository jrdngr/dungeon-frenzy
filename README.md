# Dungeon Frenzy

A real-time **healing game**. You play the party's **healer** — a fixed,
auto-fighting party (tank + ranger + mage + you) does the killing, and your only
job is to keep them alive by juggling timed, mana-costed, cooldown-gated heals.
The tension is a **mana-starvation race**: your heals out-spend mana regen, so the
pool drains and you have to win before it runs dry.

You start with a single heal. Killing enemies grants **skill points** directly
(more for tougher enemies) that you spend in a node-based **skill tree** to unlock
more heals, raise your sustain, and give the party auto-cast abilities (shields,
thorns, nukes, AoE, DoTs) — enough to push past walls the base kit can't.

Built with **TypeScript + HTML5 Canvas + Vite**. Everything is immobile — the hex
grid is visual layout only.

## Running

- `just` — start the Vite dev server (auto-opens the game).
- `npm run dev` — same, directly.
- `npm run build` — type-check (`tsc`) and produce a production build in `dist/`.
- `npm run preview` — serve the production build.

Balance is checked headlessly with `npx -y tsx scripts/sim-playtest.ts`, which
drives the healer through whole areas with scripted bots of varying skill (add
`debug <area>` for an annotated timeline).

## The campaign

Played from an **area-select hub**: **5 areas** of rising difficulty, unlocked
sequentially (clear one to open the next). A **defeat** sends you back to the hub
to retry; cleared progress is in-memory only.

- **Each area is 3 fights:** a small pack → a bigger pack → a **boss**.
- **HP and MP carry across an area's 3 fights.** Between fights everyone restores
  a little HP/MP and dead members revive at low HP.
- **Front/back rows.** Enemies fight in rows; the party **focus-fires one enemy**
  (click a front-row enemy to pick it). Only the frontmost living row is
  targetable — back-row enemies (e.g. a shielded boss) can't be hit until the
  front row is cleared, but they keep attacking.
- **Enemy attacks** escalate across areas: single-target Claw/Heavy Smash pile on
  the tank; Cleave/Wide Cleave hit a primary plus random others; Roar hits the
  whole party; Curse is a hostile damage-over-time on the backline. Late bosses
  **enrage** below 15% HP.

## Progression: the skill tree

Every enemy killed grants **skill points** directly — **1** for trash, **4–14**
for a boss (scaling by area). Points (and everything you've bought) **persist
across runs and deaths** (in-memory — a page reload resets everything, like
cleared progress), so you can always grind an area open. A first-try campaign is
worth ~84 SP, about a quarter of the ~337-SP tree.

Open the **Skill Tree** from the hub and spend points across five independent
roots: the free center **Heal** (Healing), **Mana Pool** (Sustain), and **Tank
Training / Deadeye / Arcane Power** (the three Party sub-trees). Later ranks of a
node cost progressively more, but you only need **one rank** of a node to unlock
the next.

- **Healing** — unlock Quick Heal, Regen, Group Heal, and Resurrect, plus per-spell
  potency / efficiency / cast-time upgrades.
- **Sustain** — more max mana and regen, better between-fight recovery, crit heals,
  and an Overheal Shield (overhealing becomes a temporary absorb).
- **Party** — a sub-branch per member: more HP/damage plus auto-cast abilities the
  tank/ranger/mage fire on cooldown (tank shields & thorns; ranger Aimed Shot /
  Volley / Serpent Sting; mage Fireball / Firestorm / Arcane Conduit).

Spell unlocks and capstones cost more than small upgrades, and the tree is far
bigger than one campaign's points — so each run is a build, not a checklist.

## The healer's kit

You begin with just **Heal**; the rest are skill-tree unlocks that join the bar in
unlock order (hotkeys **Q W E R T**). Cast time is the cast; cooldown is a
post-cast lockout (recast = cast + cooldown). Base mana pool is 100, regenerating
1.5/s — both raised by the Sustain branch.

| Spell | Heal | Mana | Cast | Cooldown | Role |
|-------|-----:|-----:|-----:|---------:|------|
| Heal       | 30 | 15 | 3.0s | 2.0s | Starting spell; efficient workhorse, too slow for spikes |
| Quick Heal | 15 | 10 | 1.0s | 0.5s | Fast, inefficient panic button (drains mana) |
| Regen      | 50 over 10s (5/s) | 20 | 1.0s | 5.0s | Cheap rolling anchor (heal-over-time) |
| Group Heal | 15 to all (60 total) | 25 | 3.0s | 7.0s | Expensive "everyone's hurt" AoE |
| Resurrect  | 10% max HP | 30 | 5.0s | — | Revive a dead ally mid-fight |

Efficiency (HP per mana) runs **Regen 2.5 > Group 2.4 > Heal 2.0 > Quick 1.5** —
spamming the inefficient Quick Heal is how you go dry. Per-spell tree nodes raise
the heal amount, cut mana cost, and shave cast time.

## Controls

The healer is always the implicit caster — there's no unit-selection step.
**Arm** a spell with its hotkey (Q/W/E/R/T, one per unlocked spell) or by clicking
its button, then **cast** it by clicking an ally (or pressing its number); the
spell stays armed. Group Heal still needs a target click even though it hits
everyone; Resurrect targets a *dead* ally. There is **no queue** — an order issued
mid-cast *replaces* the cast in progress (mana/cooldown only commit on completion,
so interrupting wastes nothing). `X` stops the current cast, `Esc` clears the armed
spell (or closes the skill tree), `M` mutes. The **Skill Tree** button on the hub
opens the node tree to spend skill points.

## Repo layout

```
index.html               Entry HTML; hosts the <canvas> and loads src/main.ts.
src/main.ts              Wires up the canvas and runs the requestAnimationFrame loop.
src/style.css            Page styling.
src/game/                Pure simulation — NO canvas/DOM imports here.
  config.ts              ALL tunable balance: party/healer stats, enemy archetypes,
                         and the 5 areas x 3 fights of enemy placements.
  types.ts               Core data model (Entity, ActionDef, GameState, ...).
  hex.ts                 Axial hex coordinates + hex->pixel layout.
  actions.ts             Static action defs + the enemy-archetype attack registry.
  combat.ts              Pure effect resolution (damage, heal, HoT/DoT ticks,
                         shields) + enemy/focus/front-row helpers.
  skills.ts              Pure skill-tree derivation: turns purchased skills into
                         effective stats, the healer's bar, and party abilities.
  engine.ts              createInitialState/startArea/advanceFight + update(): the
                         simulation, the area -> fight progression, skill points
                         on kill, and spendSkillPoint.
src/ui/                  Rendering + input — all canvas/DOM lives here.
  layout.ts              Screen geometry (entity positions, bars, buttons) + hit-testing.
  render.ts              Draws everything from GameState; never mutates it.
  input.ts               Click handling: the armed-spell -> click-target model.
scripts/sim-playtest.ts  Headless balance harness (scripted healer bots).
```

The **simulation is kept pure**: `src/game/` never imports from `src/ui/` or
touches the canvas/DOM. The UI reads `GameState` and routes clicks back into the
engine. Tune all balance in `src/game/config.ts`.
