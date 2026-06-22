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
- **Move** is an action like any other but has no button: selecting a unit
  highlights its adjacent free hexes, and clicking one orders the move. It
  casts (party 0.9s, Ogre 1.3s — the party can outmaneuver it) and the entity
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

## Iteration 4 (done)

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

- **Escape** clears the armed spell. Re-pressing the armed spell is a no-op:
  every cast requires an explicit target (click an ally or press 1–4), so
  pre-healing the Claw victim stays a deliberate skill play.

### Balance evidence

The queue grants slow hands near-perfect uptime: a 2.0s-reaction queue bot
kills in ~55s — matching a 0.3s-reaction non-queue player's ~58s — but
deaths stay meaningfully higher (≈0.6 vs ≈0.0) because queued orders
auto-commit through crises; reading telegraphs still matters. A degenerate
bot that queues Fast Heal forever still loses 100% (mana exhaustion), and
dropped-order counts confirm the promotion-validation path fires in real
fights. Enemy pacing deliberately unchanged this iteration; retune after
play-feel (knobs in `config.ts`).

## Iteration 5 (done): tactical pause on selecting an idle unit

Iteration 4 cut the input bookkeeping, but the game still punishes *noticing
late* more than *deciding badly*. First attempt: automatic slow-mo (0.25x)
whenever anyone idled past a 1s grace. Playtest: with three units to juggle,
someone is nearly always idle, so the game lived in slow-mo and the effect
stopped reading as a rescue. Replaced with a *player-triggered* pause:

- **Selecting an idle party member eases the sim to a full stop.** Issuing
  the order (or deselecting with Esc / clicking away) eases back to full
  speed. No grace period — selection is already a deliberate act.
- Deciding is free; **noticing is still the game.** Time only stops while
  the player is actively choosing an idle unit's action, so idle units
  nobody has selected keep bleeding uptime, and the world runs at full
  speed whenever the player's attention is elsewhere.
- Selecting a *casting* unit does not pause (there is no decision to make
  yet — queueing can happen at speed), so cruising the party stays fluid.
- Mechanically: `update()` takes real dt, eases `state.timeScale` toward
  the target (easing runs on real time so ramps feel identical at any
  speed), and the rest of the sim runs on the dilated clock. A vignette +
  "PAUSED" tag shows why the world stopped. Knobs in `config.ts` under
  `time` (paused speed 0, ramp down 0.3s / up 0.25s); `pausedScale` can be
  raised above 0 to turn the pause back into slow-mo if full stop proves
  too generous.

## Iteration 6 (done): fighters auto-attack

Re-ordering the basic Attack was busywork: it was almost always the right
default, so clicking it taught nothing. Now it *is* the default:

- **Idle fighters cast Attack automatically** whenever the enemy is in range
  and they have nothing banked. Out of range they stay idle (and the idle
  alarm still fires) — positioning is still the player's job.
- **Attack is gone from the action bar.** The fighter's buttons are Heavy
  Swing and Brace: every fighter click is now a real decision (commit to the
  big hit, defend, or move) layered over a sensible baseline.
- **Player orders override.** Issuing an order to an auto-attacking fighter
  replaces the swing immediately (no queueing behind it) — the auto cast is
  flagged on the `ActionInstance` (`auto: true`) so the engine and UI can
  tell it apart from a deliberate order. Orders issued during a *deliberate*
  cast still queue as before.
- **The tactical pause treats an auto-attacking fighter as idle**: selecting
  it stops time, because the player selected it to choose an override — the
  same decision moment as selecting a truly idle unit.

## Iteration 7 (done): cut back to a pure healing game

Iterations 1–6 grew the game into a busy party-manager (movement, fighter kits,
auto-attacks, tactical pause). To find the fun before re-expanding, Iteration 7
**cuts it all the way back to the classic MMO healer game**: you play only the
healer and keep an auto-fighting party alive. Everything is immobile — the hex
grid is now visual layout only (movement, the tactical pause, Brace/Heavy Swing,
shields, and range checks are all gone).

### Setup

- **Party (4, fixed formation):** a **tank** in front (adjacent to the enemy),
  **ranger** + **mage** on the middle row, the player's **healer** in the back.
  Tank/ranger/mage are AI auto-attackers the player can't control — they are
  heal targets and the damage clock. **Enemy:** 1 ("Ogre").
- **Win:** enemy to 0 HP. **Lose:** the party is wiped *or* no tank/damage dealer
  remains (a lone healer can't deal damage, so the fight is unwinnable → loss).

### Enemy attacks (fixed rotation `[Claw, Claw, Line, Claw, Claw, AoE]`)

| Attack | Cast | Effect                                                       |
| ------ | ---- | ------------------------------------------------------------ |
| Claw   | 2.6s | 30 to the tank (then a random DPS, then the healer, as they die) |
| Line   | 3.0s | 14 to the tank **+ 14 to one random other** (the only regular way to hit the healer) |
| AoE    | 3.5s | 11 to all living party                                       |

Below **15% HP** the enemy **enrages** (Claw 40/2.0s, Line 19/2.4s, AoE 15/3.0s),
a late finale that lands ~62s in — *after* mana starvation has already begun.

### Healer spells (the whole kit) — real cooldowns are the new mechanic

Cooldown is a post-cast lockout (recast = cast + cooldown). Each costs mana;
mana regenerates slowly (2.7/s, 100 pool).

| Spell      | Cast | Cooldown | Mana | Effect                       | HP/mana |
| ---------- | ---- | -------- | ---- | ---------------------------- | ------- |
| Fast Heal  | 1.5s | —        | 20   | Heal 22 (spammable emergency)| 1.10    |
| Slow Heal  | 3.0s | 3.0s     | 24   | Heal 55                      | 2.29    |
| Renew (HoT)| 1.5s | 6.5s     | 18   | 8/s for 8s (64 total)        | 3.56    |
| Group Heal | 2.5s | 7.5s     | 34   | Heal 20 to **all** party     | ≤2.35   |

### Controls (active-spell model)

The healer is always the implicit caster — there is no unit-selection step.
Hotkeys (Q W E R) or clicking a spell button **arm** a spell; clicking an ally
(or pressing 1–4) **casts** it and the spell **stays armed** (re-pressing the
armed spell is a no-op). Group Heal still needs a target click even though it
hits everyone. **There is no queue:** an order
issued mid-cast **replaces** the cast in progress (mana/cooldown only commit on
completion, so interrupting wastes nothing); an unaffordable or cooling spell
greys out and is ignored. `X` stops the cast, `Esc` clears the armed spell,
`M` mutes.

### Board + spell UI

- **Only occupied hexes are drawn** — no empty filler. The five tiles are sized
  large (`HEX_SIZE` in `layout.ts`) to fill the battle area, with the party
  column centered.
- **No overlapping bars.** Each party tile's HP/mana strip and cast bar are kept
  narrow so neighbouring tiles' bars never collide; the enemy (no neighbors)
  keeps a wider bar for its four-digit HP.
- **Spell buttons show the heal amount** (`+22`, `+64`, `+20 all`) and mana cost.
  Cast time and cooldown moved to a **hover tooltip** that lists all four stats
  (heal, cast time, cooldown, mana).

### The point: a mana-starvation race

Renew (8 HPS) doesn't quite cover the tank's ~8.6 DPS, so you supplement with
Slow/Fast heals; total spend outruns regen and the pool drains until — by ~35s —
you often can't even afford Fast Heal and must wait on regen. From there HP
slips and you must finish the enemy before your mana collapses. Cooldowns stop
you from spamming the efficient heals; Fast Heal has no cooldown but is the
inefficient panic button (spamming it goes dry by ~14s).

### Balance evidence

`scripts/sim-playtest.ts` (run with `npx -y tsx scripts/sim-playtest.ts`, add
`debug` for an annotated single-game timeline) drives the healer with scripted
bots. A mana-conscious triager wins ~100% in ~72s but still loses ~0.5 party
members; a Fast-Heal spammer and an AFK party lose 100%. Starvation (~35s)
reliably precedes enrage (~62s). Knobs in `config.ts`: `manaRegen` and spell
mana costs (difficulty), enemy `claw` damage (tank pressure), `enrage.hpFraction`
(finale timing).

## Iteration 8 (current scope): a campaign of areas, multiple enemies

Iteration 7 found the fun in a single fight. Iteration 8 re-expands it into a
**campaign** without losing the mana-starvation core — the resource economy now
spans a whole area instead of one fight. (This also lays the groundwork for a
later **XP + skill-tree** system; the area-select screen becomes the hub.)

### Structure

- **5 areas** of fixed, rising difficulty, played from an **area-select hub**.
  Areas unlock **sequentially** (clear one to open the next); a **defeat returns
  you to the hub** to retry. Cleared progress is in-memory only. A **Quit Area**
  button (bottom panel, beside the spells) abandons the current run mid-fight and
  returns to the hub **with no progress recorded** (room for rewards-on-clear later).
- **Each area is 3 fights:** fight 1 = a small pack, fight 2 = a bigger pack,
  fight 3 = a **boss**. **HP and MP carry across the 3 fights.** Between fights
  everyone restores **+10% max HP/MP** and **dead members revive at 10% max HP**
  (`CONFIG.recovery`); time is frozen during the "fight cleared" interstitial.

### Multiple enemies & front/back rows

- Enemies fight in **rows**. The party **focus-fires one enemy** at a time; the
  player picks it by **clicking a front-row enemy** (sticky until it dies, then it
  auto-advances). **Only the frontmost living row is targetable** — back-row
  enemies (e.g. a shielded boss) can't be hit until the front row is cleared, but
  they keep attacking. Each enemy runs its own rotation/timers.
- **Enemy targeting:** single-target Claw/Heavy Smash pile on the **tank**;
  Line/Cleave hit a primary + random others; AoE hits all; **Curse** is a hostile
  DoT thrown at the squishy backline. With several enemies the tank is the heavy
  heal sink.

### Bosses & new mechanics

- **B1** claw-only (tank); **B2** claw + Cleave; **B3 = the old Ogre** (claw +
  Cleave + AoE), area 3's finale. **B4 & B5** add new, telegraphed mechanics:
  **Curse** (hostile DoT — out-heal a ticking debuff; reuses the HoT machinery,
  inverted), **Heavy Smash** (a big slow nuke on the tank to pre-heal), and **Wide
  Cleave** (a 3-target line). B4 = Curse + Wide Cleave; B5 = all three. Bosses 4–5
  fight from the **back row** behind front-row adds you must clear first.
- **Enrage** (<15% HP frenzy: damage ×~1.35, cast ×~0.8) is a boss signature on
  **B3–B5 only**; small enemies never enrage.

### Balance evidence

`scripts/sim-playtest.ts` now drives the healer (and its focus target) through
**whole areas** (carry-over + recovery). A mana-conscious triager wins areas 1–4
~100% with rising pressure (OOM creeps from "never" in area 1 to ~60s in area 4)
and area 5 ~50% — a beatable climax with headroom for sharper play; Fast-Heal
spam and AFK lose 100% everywhere (no infinite sustain). Knobs in `config.ts`:
per-archetype `maxHp`/damage, per-fight enemy counts (`areas`), `manaRegen` and
spell costs (campaign economy), `recovery` (between-fight slack).

Recent tuning: `manaRegen` was **halved** (3.0 → 1.5/s) to make mana genuinely
scarce across an area, and area 1's opener was sharpened — the **Imp** (the basic
enemy of fights 1–2) now hits for **12** (doubled from 6) so the first two fights
demand real healing instead of an idle warm-up.

## Tech

- **TypeScript + HTML5 Canvas + Vite.** Runs locally (`npm run dev`); no save
  data, leveling persistence, or deployment yet.
- Code is split so the **simulation is pure** (`src/game/*` — no canvas/DOM) and
  all rendering/input lives in `src/ui/*`. This keeps the core testable and ready
  for later iterations (movement, patterns, classes).
