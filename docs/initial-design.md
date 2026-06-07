# Dungeon Frenzy — Initial Design

> Working title. This is a living sketch — we design iteratively, so this captures
> the high-level vision plus the concrete scope of the current iteration, not a
> final spec.

## Vision

Dungeon Frenzy mashes up two old genres:

- **The MMO healer game** — you keep a party of adventurers alive while a monster
  pounds on them. The classic version is a pure healer; we expand it to the
  **whole party**.
- **Time-management games** (think Airport Mania) — you're constantly running
  around making sure everyone is doing *something*, and ideally the *most useful*
  thing, before the situation slides out of control.

The fantasy: you are the overworked party leader/conductor, juggling every
adventurer's actions in real time so the whole group fights efficiently and
nobody dies.

## Core loop

- A party of adventurers fights one or more enemies on a **hex grid**.
- Every entity (party member and enemy) takes **actions that take time**. An
  action has a cast time; a progress bar counts down until it triggers.
- Party members **go idle after each action** — the player must keep giving them
  new orders. The pressure is keeping everyone busy and well-targeted while
  reacting to incoming damage.
- Enemies act on their own timers and target patterns.
- Lose if the whole party dies; win by defeating the enemy.

## Long-term features (not yet built)

These are the directions we expect to grow into, noted so today's structure
doesn't paint us into a corner:

- **Movement as an action** — moving between hexes costs time like anything else.
  (The grid already uses real hex coordinates for this reason.)
- **Target patterns** — actions hit specific hex patterns around the caster or a
  target hex (cones, lines, blasts).
- **Multiple classes**, each with their own action set (fighter, healer, mage,
  rogue, …).
- **Leveling and skill trees** per party member.
- **Multiple enemies** and richer enemy AI.

## Iteration 1 (current scope)

A minimal but playable slice that proves the core juggling loop.

### Setup

- **Party:** 2 fighters + 1 healer. **Enemy:** 1 ("Ogre").
- **No movement.** Fixed positions on the hex grid: enemy in the hex in front,
  the two fighters in two adjacent hexes, the healer in the hex behind them.
- **Controls:** click a party member to select it, then click an action; if the
  action needs a target, click a party member.
- **Permadeath:** a dead party member stays dead. All three dead → **Game Over**.
- **Win:** reduce the enemy to 0 HP → **Victory**.

### Actions

| Entity   | Action      | Cast | Effect                                            |
| -------- | ----------- | ---- | ------------------------------------------------- |
| Fighter  | Attack      | 2.5s | 10 damage to the enemy                            |
| Healer   | Fast Heal   | 1.5s | Heal 14 to one ally                               |
| Healer   | Slow Heal   | 4.0s | Heal 42 to one ally                               |
| Healer   | Renew (HoT) | 2.0s | Heal 5/sec for 6s (30 total) to one ally          |
| Healer   | Group Heal  | 3.0s | Heal 12 to both fighters                          |
| Enemy    | Claw        | 3.0s | 9 damage to a random living party member          |
| Enemy    | Roar (AoE)  | 6.0s | 7 damage to all party members (every 4th action)  |

### Starting balance

- Fighter HP **60**, Healer HP **50** (party total ~170).
- Enemy HP **600**.
- Enemy damage is tuned so a **fully inactive party dies in ~1 minute**; the enemy
  AoE is the rarer, scarier "uh-oh" beat. Killing the enemy with two fighters
  attacking is a ~60–90s race, so the player must both deal damage *and* keep
  everyone alive.

All of these numbers live in a single file (`src/game/config.ts`) so balancing is
a one-file edit, and will be refined by playtesting.

## Tech

- **TypeScript + HTML5 Canvas + Vite.** Runs locally (`npm run dev`); no save
  data, leveling persistence, or deployment yet.
- Code is split so the **simulation is pure** (`src/game/*` — no canvas/DOM) and
  all rendering/input lives in `src/ui/*`. This keeps the core testable and ready
  for later iterations (movement, patterns, classes).
