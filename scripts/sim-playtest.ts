// Headless balance check: scripted "players" of varying skill drive the sim.
// Run: npx -y tsx scripts/sim-playtest.ts

import { createInitialState, startAction, update } from "../src/game/engine.ts";
import {
  AOE_HEAL,
  FAST_HEAL,
  FIGHTER_ATTACK,
  FIGHTER_BRACE,
  FIGHTER_HEAVY,
  HEAL_OVER_TIME,
  MOVE_PARTY,
  SLOW_HEAL,
} from "../src/game/actions.ts";
import { canMoveTo, enemy, inRange, livingParty } from "../src/game/combat.ts";
import { hexDistance, hexNeighbors } from "../src/game/hex.ts";
import type { Entity, GameState, Hex } from "../src/game/types.ts";

type Bot = (state: GameState) => void;

/** Order a one-hex move that gets `e` closer to `goal` (if possible). */
function moveToward(state: GameState, e: Entity, goal: Hex): void {
  const options = hexNeighbors(e.hex).filter((h) => canMoveTo(state, e, h));
  if (options.length === 0) return;
  let best = options[0];
  for (const h of options) {
    if (hexDistance(h, goal) < hexDistance(best, goal)) best = h;
  }
  if (hexDistance(best, goal) < hexDistance(e.hex, goal)) {
    startAction(state, e.id, MOVE_PARTY, undefined, best);
  }
}

/** Order a one-hex move that gets `e` farther from `threat` (if possible). */
function moveAway(state: GameState, e: Entity, threat: Hex): void {
  const options = hexNeighbors(e.hex).filter((h) => canMoveTo(state, e, h));
  let best: Hex | undefined;
  for (const h of options) {
    if (hexDistance(h, threat) > hexDistance(e.hex, threat)) {
      if (!best || hexDistance(h, threat) > hexDistance(best, threat)) best = h;
    }
  }
  if (best) startAction(state, e.id, MOVE_PARTY, undefined, best);
}

/** Reasonable player: fighters close to melee and wall the enemy (Brace when
 * a Roar is casting), healer stays in range, flees adjacency, and triages
 * with Slow Heal / Renew / Fast Heal. */
const smartBot: Bot = (state) => {
  const en = enemy(state);
  if (!en || !en.alive) return;
  const roarIncoming = en.current?.def.effect.kind === "aoe-damage";

  for (const e of state.entities) {
    if (e.kind !== "fighter" || !e.alive || e.current) continue;
    if (hexDistance(e.hex, en.hex) > 1) {
      moveToward(state, e, en.hex);
    } else if (roarIncoming && !e.shield) {
      startAction(state, e.id, FIGHTER_BRACE);
    } else {
      startAction(state, e.id, FIGHTER_HEAVY);
    }
  }

  const healer = state.entities.find((e) => e.kind === "healer");
  if (healer && healer.alive && !healer.current) {
    // Never stand next to the ogre.
    if (hexDistance(healer.hex, en.hex) <= 1) {
      moveAway(state, healer, en.hex);
      return;
    }
    const hurt = livingParty(state)
      .map((p) => ({ p, missing: p.maxHp - p.hp }))
      .sort((a, b) => b.missing - a.missing);
    const worst = hurt[0];
    if (!worst || worst.missing === 0) return;
    if (!inRange(healer, FAST_HEAL, worst.p)) {
      moveToward(state, healer, worst.p.hex);
      return;
    }
    const pct = worst.p.hp / worst.p.maxHp;
    if (pct < 0.3 && healer.mana >= (FAST_HEAL.manaCost ?? 0)) {
      startAction(state, healer.id, FAST_HEAL, worst.p.id);
    } else if (worst.missing >= 35 && healer.mana >= (SLOW_HEAL.manaCost ?? 0)) {
      startAction(state, healer.id, SLOW_HEAL, worst.p.id);
    } else if (
      worst.missing >= 20 &&
      worst.p.hots.length === 0 &&
      healer.mana >= (HEAL_OVER_TIME.manaCost ?? 0)
    ) {
      startAction(state, healer.id, HEAL_OVER_TIME, worst.p.id);
    } else if (worst.missing >= 14 && healer.mana >= (SLOW_HEAL.manaCost ?? 0)) {
      startAction(state, healer.id, SLOW_HEAL, worst.p.id);
    }
    // Otherwise: sit on mana (small deficits aren't worth casts).
  }
};

/** Sloppy player: fighters walk in and spam basic Attack, healer spams Fast
 * Heal on the most hurt target, never braces, never repositions sensibly. */
const sloppyBot: Bot = (state) => {
  const en = enemy(state);
  if (!en || !en.alive) return;
  for (const e of state.entities) {
    if (e.kind !== "fighter" || !e.alive || e.current) continue;
    if (hexDistance(e.hex, en.hex) > 1) moveToward(state, e, en.hex);
    else startAction(state, e.id, FIGHTER_ATTACK);
  }
  const healer = state.entities.find((e) => e.kind === "healer");
  if (healer && healer.alive && !healer.current) {
    const hurt = livingParty(state)
      .filter((p) => p.hp < p.maxHp)
      .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp);
    if (hurt[0] && healer.mana >= (FAST_HEAL.manaCost ?? 0)) {
      if (inRange(healer, FAST_HEAL, hurt[0])) {
        startAction(state, healer.id, FAST_HEAL, hurt[0].id);
      } else {
        moveToward(state, healer, hurt[0].hex);
      }
    }
  }
};

/** AFK player: nobody does anything. Should lose. */
const afkBot: Bot = () => {};

interface RunResult {
  state: GameState;
  healerClawDamage: number; // single-target damage the healer took
  healerRoarDamage: number;
}

function runOne(bot: Bot, reactionDelay: number): RunResult {
  const state = createInitialState();
  const dt = 0.05;
  let sinceOrder = 0;
  let lastScan = 0;
  let healerClawDamage = 0;
  let healerRoarDamage = 0;
  while (state.phase === "playing" && state.elapsedTime < 600) {
    sinceOrder += dt;
    if (sinceOrder >= reactionDelay) {
      bot(state);
      sinceOrder = 0;
    }
    update(state, dt);
    // Attribute fresh damage events on the healer: Roar hits everyone in the
    // same instant as a fighter, Claw doesn't.
    for (const ev of state.events) {
      if (ev.at <= lastScan || ev.kind !== "damage") continue;
      if (ev.entityId !== "healer") continue;
      const sharedWithFighter = state.events.some(
        (o) =>
          o.kind === "damage" &&
          o.at === ev.at &&
          o.entityId.startsWith("fighter"),
      );
      if (sharedWithFighter) healerRoarDamage += ev.amount + ev.blocked;
      else healerClawDamage += ev.amount + ev.blocked;
    }
    lastScan = state.elapsedTime;
  }
  return { state, healerClawDamage, healerRoarDamage };
}

function summarize(name: string, bot: Bot, reactionDelay: number): void {
  const runs = 200;
  let wins = 0;
  let totalTime = 0;
  let totalDeaths = 0;
  let timeouts = 0;
  let clawOnHealer = 0;
  let roarOnHealer = 0;
  for (let i = 0; i < runs; i++) {
    const r = runOne(bot, reactionDelay);
    if (r.state.phase === "won") {
      wins++;
      totalTime += r.state.elapsedTime;
    }
    if (r.state.phase === "playing") timeouts++;
    totalDeaths += r.state.stats.deaths;
    clawOnHealer += r.healerClawDamage;
    roarOnHealer += r.healerRoarDamage;
  }
  const avgTime = wins ? (totalTime / wins).toFixed(1) : "-";
  console.log(
    `${name.padEnd(28)} win ${((wins / runs) * 100).toFixed(0).padStart(3)}%  ` +
      `avg kill ${avgTime}s  avg deaths ${(totalDeaths / runs).toFixed(2)}  ` +
      `healer dmg claw/roar ${(clawOnHealer / runs).toFixed(1)}/${(roarOnHealer / runs).toFixed(1)}` +
      (timeouts ? `  TIMEOUTS ${timeouts}` : ""),
  );
}

summarize("smart, 0.3s reactions", smartBot, 0.3);
summarize("smart, 1.0s reactions", smartBot, 1.0);
summarize("smart, 2.0s reactions", smartBot, 2.0);
summarize("sloppy, 0.5s reactions", sloppyBot, 0.5);
summarize("afk", afkBot, 1.0);
