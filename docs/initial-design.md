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

## Iteration 1 (done)

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

## Iteration 2 (done)

Iteration 1 proved the loop but had three fun problems: fighter orders were
decision-free (one action, one target), healing capacity dwarfed incoming
damage so the fight had no loss threat, and the game gave too little feedback
to read at speed. Iteration 2 fixes all three.

### Decisions

- **Fighter kit** — every re-order is now a small bet:
  - **Attack** (2.2s, 10 dmg): low commitment, for reacting and finishing.
  - **Heavy Swing** (5.0s, 27 dmg): best DPS, but locks the fighter in.
  - **Brace** (1.2s): absorb up to 15 damage from the next hit within 6s.
    Counters Roar and enraged Claws at the cost of attack uptime.
- **Healer mana** — 80 max, +1.5/s. HP-per-mana: Slow Heal 3.0 > Renew 1.9 >
  Group Heal 1.6 > Fast Heal 0.9. Regen sustains roughly the enemy's
  normal-phase output via Slow Heal; the pool is the burst budget. Fast Heal
  is the emergency button — spamming it is how you go OOM. Mana is checked at
  cast start but only spent on completion, so mis-clicks never waste it.
- **Enrage** — below 30% HP the Ogre permanently enrages: Claw 11 dmg/2.8s →
  16 dmg/2.0s, Roar cast 6s → 4.5s. The finale is a race the party should
  barely win, and it kills the "lone healer outlasts forever" stalemate
  (mana exhaustion finishes the job).

### Legibility

- **Claw telegraph**: a dashed line from the Ogre to its victim while Claw is
  casting — enables proactive pre-healing, the most fun healer play.
- **Roar warning**: pulsing red rings on the whole party during the cast, and
  pips over the Ogre counting Claws until the next Roar.
- **Floating combat text** for damage, heals, blocks, and ENRAGED!, driven by
  sim events (`GameState.events`).
- **Idle alarm**: idle party members get a pulsing ring and "IDLE!" after
  0.4s — noticing them is the core skill, so it's loud.
- **End screen stats**: kill time, damage dealt, healing (and overheal),
  damage blocked, party idle time, deaths — replay goals in one glance.

### Current actions

| Entity   | Action        | Cast | Cost | Effect                                  |
| -------- | ------------- | ---- | ---- | --------------------------------------- |
| Fighter  | Attack        | 2.2s | —    | 10 damage                                |
| Fighter  | Heavy Swing   | 5.0s | —    | 27 damage                                |
| Fighter  | Brace         | 1.2s | —    | Absorb 15 from the next hit within 6s    |
| Healer   | Fast Heal     | 1.5s | 16   | Heal 14                                  |
| Healer   | Slow Heal     | 4.0s | 14   | Heal 42                                  |
| Healer   | Renew (HoT)   | 2.0s | 16   | Heal 5/sec for 6s (30 total)             |
| Healer   | Group Heal    | 3.0s | 18   | Heal 14 to both fighters                 |
| Enemy    | Claw          | 2.8s | —    | 11 damage to a random living member      |
| Enemy    | Roar (AoE)    | 6.0s | —    | 12 damage to all (every 4th action)      |
| Enraged  | Frenzied Claw | 2.0s | —    | 16 damage                                |
| Enraged  | Roar (AoE)    | 4.5s | —    | 12 damage to all                         |

Enemy HP **500** (enrage below 150). Fighter HP 60, Healer HP 50.

### Balance evidence

`scripts/sim-playtest.ts` (run with `npx -y tsx scripts/sim-playtest.ts`)
drives the sim headlessly with scripted players: a smart triager wins ~100%
in ~55–70s with occasional deaths, a Fast-Heal-spamming basic-attacker wins
~3%, and an AFK party always dies. Strategy and attention both matter.

## Iteration 3 (done)

Iteration 2's enemy picked Claw targets at random, so the healer ate hits no
one could prevent. Iteration 3 makes protection a real, positional mechanic:
a full hex battlefield, movement for everyone, and melee that fighters can
body-block.

### Battlefield & movement

- The battlefield is a **hex disk of radius 3** (37 hexes). The party starts
  on one side (fighters in front, healer behind); the Ogre starts across the
  field and walks in, giving the player a few seconds of setup.
- **Move** is an action like any other: pick an adjacent free hex, cast
  (party 0.9s, Ogre 1.3s — the party can outmaneuver it), and the entity
  relocates on completion. Destination legality is re-checked on arrival.
- Dead bodies don't block movement.

### Protection (the point of this iteration)

- **Claw is melee (range 1)** and the Ogre only Claws what is *adjacent* —
  if anything is in its face it attacks it and does not move. Fighters
  standing between the Ogre and the healer therefore take every
  single-target hit: body-blocking works because adjacency pins the enemy.
- If nothing is adjacent, the Ogre lumbers one hex toward the **nearest**
  living party member (sidestepping along equal distance when blocked).
- **Roar is the only way to damage a protected healer**: global, every 4th
  combat action (moves don't count), telegraphed by a long cast, warning
  rings, and countdown pips — and at 12 damage it can never one-shot the
  50 HP healer.
- Fighter attacks are melee too, and **heals have range 3**, so the healer
  positions meaningfully instead of hiding at the map edge.

### Balance evidence

Same harness, now with positional bots: smart play keeps healer Claw damage
at **zero** (all healer damage arrives via Roar) and wins ~100% in ~58–73s;
a sloppy walker leaks ~25 Claw damage onto the healer and wins ~1%; AFK
always dies. No stalemates — enrage plus mana exhaustion still close out
every fight.

## Iteration 4 (current scope)

Playtest feedback: "a lot to manage." The fix is NOT slower timers — pressure
and excitement stay; the load moves off input bookkeeping and onto decisions.
Three loads, three tools:

### Input/deadline load → one-slot action queue

- While a unit is casting, any order issued is **queued** (one slot, replaces
  the previous queued order) and auto-starts when the cast ends. Units still
  never act without an explicit player order — no auto-repeat.
- **Lenient at enqueue, strict at start**: you may queue a heal you can't
  afford yet (regen may cover it); legality (mana, range, target alive, hex
  free) is re-checked at promotion, and an illegal order is dropped *loudly*
  ("ORDER LOST" floating text, audio chirp, end-screen "Orders lost" stat).
- Re-pressing a queued ability un-queues it. Queued orders are shown as a
  "▸ next" chip on cast bars, in the party frames, and as a QUEUED tag on
  the action button.
- **X stops the current cast** (free — mana is only spent on completion) and
  promotes the queue immediately. This preserves the clutch play the queue
  would otherwise bury: mid-Heavy-Swing, Roar telegraphs → X, Brace.

### Monitoring load → party frames + audio

- **Party frames**: a fixed column of three unit panels (hotkey, name, HP,
  mana, cast progress, queued order, IDLE/DEAD) on the left edge. Clicking a
  frame is identical to clicking the token, so heal targeting never requires
  finding a moving token.
- **Audio cues** (`src/ui/audio.ts`, synthesized, no assets): a "ready" ping
  when a unit finishes its cast — pitch identifies who (F1 low, F2 mid,
  healer high) and fires once per transition (idling to bank mana is correct
  play, so it never nags); a rising two-tone when Roar starts casting; an
  enrage sting; a down-chirp when a queued order is dropped; win/lose
  stingers. `M` mutes.

### Execution load → fewer inputs per order

- **Smart-cast**: re-pressing a pending single-target heal key casts it on
  the lowest-HP-fraction wounded ally in range (explicit click-targeting
  unchanged — pre-healing the Claw victim stays a skill play).
- **Escape** cancels pending targeting / selection (replacing the old
  re-press-to-cancel, which smart-cast now uses).

### Balance evidence

The queue grants slow hands near-perfect uptime: a 2.0s-reaction queue bot
kills in ~55s — matching a 0.3s-reaction non-queue player's ~58s — but
deaths stay meaningfully higher (≈0.6 vs ≈0.0) because queued orders
auto-commit through crises; reading telegraphs still matters. A degenerate
bot that queues Fast Heal forever still loses 100% (mana exhaustion), and
dropped-order counts confirm the promotion-validation path fires in real
fights. Enemy pacing deliberately unchanged this iteration; retune after
play-feel (knobs in `config.ts`).

## Tech

- **TypeScript + HTML5 Canvas + Vite.** Runs locally (`npm run dev`); no save
  data, leveling persistence, or deployment yet.
- Code is split so the **simulation is pure** (`src/game/*` — no canvas/DOM) and
  all rendering/input lives in `src/ui/*`. This keeps the core testable and ready
  for later iterations (movement, patterns, classes).
