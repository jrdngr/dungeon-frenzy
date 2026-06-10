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
  SLOW_HEAL,
} from "../src/game/actions.ts";
import { enemy, livingParty } from "../src/game/combat.ts";
import type { Entity, GameState } from "../src/game/types.ts";

type Bot = (state: GameState, reactionDelay: number) => void;

/** Reasonable player: fighters Heavy Swing (Brace when a Roar is casting and
 * they're idle), healer triages with Slow Heal / Renew / Fast Heal. */
const smartBot: Bot = (state) => {
  const en = enemy(state);
  const roarIncoming =
    en?.alive && en.current?.def.effect.kind === "aoe-damage";

  for (const e of state.entities) {
    if (e.kind !== "fighter" || !e.alive || e.current) continue;
    if (roarIncoming && !e.shield) {
      startAction(state, e.id, FIGHTER_BRACE);
    } else {
      startAction(state, e.id, FIGHTER_HEAVY);
    }
  }

  const healer = state.entities.find((e) => e.kind === "healer");
  if (healer && healer.alive && !healer.current) {
    const hurt = livingParty(state)
      .map((p) => ({ p, missing: p.maxHp - p.hp }))
      .sort((a, b) => b.missing - a.missing);
    const worst = hurt[0];
    if (worst && worst.missing > 0) {
      const pct = worst.p.hp / worst.p.maxHp;
      if (pct < 0.3 && healer.mana >= (FAST_HEAL.manaCost ?? 0)) {
        startAction(state, healer.id, FAST_HEAL, worst.p.id);
      } else if (
        worst.missing >= 35 &&
        healer.mana >= (SLOW_HEAL.manaCost ?? 0)
      ) {
        startAction(state, healer.id, SLOW_HEAL, worst.p.id);
      } else if (
        worst.missing >= 20 &&
        worst.p.hots.length === 0 &&
        healer.mana >= (HEAL_OVER_TIME.manaCost ?? 0)
      ) {
        startAction(state, healer.id, HEAL_OVER_TIME, worst.p.id);
      } else if (
        worst.missing >= 14 &&
        healer.mana >= (SLOW_HEAL.manaCost ?? 0)
      ) {
        startAction(state, healer.id, SLOW_HEAL, worst.p.id);
      }
      // Otherwise: sit on mana (small deficits aren't worth casts).
    }
  }
};

/** Sloppy player: fighters spam basic Attack, healer spams Fast Heal on the
 * most hurt target, never braces. */
const sloppyBot: Bot = (state) => {
  for (const e of state.entities) {
    if (e.kind !== "fighter" || !e.alive || e.current) continue;
    startAction(state, e.id, FIGHTER_ATTACK);
  }
  const healer = state.entities.find((e) => e.kind === "healer");
  if (healer && healer.alive && !healer.current) {
    const hurt = livingParty(state)
      .filter((p) => p.hp < p.maxHp)
      .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp);
    if (hurt[0] && healer.mana >= (FAST_HEAL.manaCost ?? 0)) {
      startAction(state, healer.id, FAST_HEAL, hurt[0].id);
    }
  }
};

/** AFK player: nobody does anything. Should lose. */
const afkBot: Bot = () => {};

function runOne(bot: Bot, reactionDelay: number): GameState {
  const state = createInitialState();
  const dt = 0.05;
  let sinceOrder = 0;
  while (state.phase === "playing" && state.elapsedTime < 600) {
    sinceOrder += dt;
    if (sinceOrder >= reactionDelay) {
      bot(state, reactionDelay);
      sinceOrder = 0;
    }
    update(state, dt);
  }
  return state;
}

function summarize(name: string, bot: Bot, reactionDelay: number): void {
  const runs = 200;
  let wins = 0;
  let totalTime = 0;
  let totalDeaths = 0;
  let timeouts = 0;
  for (let i = 0; i < runs; i++) {
    const s = runOne(bot, reactionDelay);
    if (s.phase === "won") {
      wins++;
      totalTime += s.elapsedTime;
    }
    if (s.phase === "playing") timeouts++;
    totalDeaths += s.stats.deaths;
  }
  const avgTime = wins ? (totalTime / wins).toFixed(1) : "-";
  console.log(
    `${name.padEnd(28)} win ${((wins / runs) * 100).toFixed(0)}%  ` +
      `avg kill ${avgTime}s  avg deaths ${(totalDeaths / runs).toFixed(2)}` +
      (timeouts ? `  TIMEOUTS ${timeouts}` : ""),
  );
}

summarize("smart, 0.3s reactions", smartBot, 0.3);
summarize("smart, 1.0s reactions", smartBot, 1.0);
summarize("smart, 2.0s reactions", smartBot, 2.0);
summarize("sloppy, 0.5s reactions", sloppyBot, 0.5);
summarize("afk", afkBot, 1.0);
