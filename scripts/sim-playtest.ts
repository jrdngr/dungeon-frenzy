// Headless balance check: scripted "healers" of varying skill drive the sim.
// The tank/ranger/mage auto-attack on their own; the bot only plays the healer.
// Run: npx -y tsx scripts/sim-playtest.ts

import { createInitialState, issueOrder, update } from "../src/game/engine.ts";
import {
  AOE_HEAL,
  FAST_HEAL,
  RENEW,
  SLOW_HEAL,
} from "../src/game/actions.ts";
import { enemy, livingParty } from "../src/game/combat.ts";
import type { ActionDef, Entity, GameState } from "../src/game/types.ts";
import { isParty } from "../src/game/types.ts";

type Bot = (state: GameState) => void;

function healer(state: GameState): Entity | undefined {
  return state.entities.find((e) => e.kind === "healer");
}

/** Off cooldown AND affordable right now. */
function ready(h: Entity, def: ActionDef): boolean {
  return (h.cooldowns[def.id] ?? 0) <= 0 && h.mana >= (def.manaCost ?? 0);
}

/** The smart bot's triage decision: what to cast on whom given current
 * readiness. Models a mana-conscious player — it leans on the efficient heals
 * (Renew/Slow/Group) and spends the inefficient Fast Heal only on true
 * emergencies or when mana is comfortable. Returns undefined to bank. */
function triage(
  state: GameState,
  h: Entity,
): { def: ActionDef; targetId: string } | undefined {
  const party = livingParty(state);
  const lowMana = h.mana < h.maxMana * 0.35;
  const hurt = party
    .map((p) => ({ p, missing: p.maxHp - p.hp, pct: p.hp / p.maxHp }))
    .sort((a, b) => a.pct - b.pct);
  const worst = hurt[0];
  if (!worst || worst.missing === 0) return undefined;

  // 1. Emergency: someone about to die -> Fast Heal regardless of mana.
  if (worst.pct < 0.3 && ready(h, FAST_HEAL)) {
    return { def: FAST_HEAL, targetId: worst.p.id };
  }
  // 2. Keep Renew rolling on the tank (cheap, efficient anchor).
  const tank = party.find((p) => p.kind === "tank");
  if (tank && tank.maxHp - tank.hp >= 14 && tank.hots.length === 0 && ready(h, RENEW)) {
    return { def: RENEW, targetId: tank.id };
  }
  // 3. Group heal when several are hurt (efficient multi-target — after a Roar).
  if (hurt.filter((x) => x.missing >= 16).length >= 3 && ready(h, AOE_HEAL)) {
    return { def: AOE_HEAL, targetId: worst.p.id };
  }
  // 4. Big single deficit -> Slow Heal (the efficient workhorse).
  if (worst.missing >= 38 && ready(h, SLOW_HEAL)) {
    return { def: SLOW_HEAL, targetId: worst.p.id };
  }
  // 5. Moderate deficit -> Fast Heal, but only while mana is comfortable so we
  //    don't burn the inefficient heal during a conservation phase.
  if (!lowMana && worst.pct < 0.6 && ready(h, FAST_HEAL)) {
    return { def: FAST_HEAL, targetId: worst.p.id };
  }
  return undefined; // otherwise bank mana / let Renew + HP buffers ride
}

/** Reasonable player: cooldown-aware triage on the healer. */
const smartBot: Bot = (state) => {
  const h = healer(state);
  if (!h || !h.alive || h.current) return;
  const order = triage(state, h);
  if (order) issueOrder(state, h.id, order.def, order.targetId);
};

/** Sloppy player: spams Fast Heal on the most-hurt. Inefficient -> should run
 * dry and lose, guarding the invariant that there is no infinite sustain. */
const sloppyBot: Bot = (state) => {
  const h = healer(state);
  if (!h || !h.alive || h.current) return;
  const worst = livingParty(state)
    .filter((p) => p.hp < p.maxHp)
    .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
  if (worst && ready(h, FAST_HEAL)) issueOrder(state, h.id, FAST_HEAL, worst.id);
};

/** AFK player: never heals. The party auto-attacks but wipes. Must lose. */
const afkBot: Bot = () => {};

interface RunResult {
  state: GameState;
  healerLine: number; // line (cleave) damage taken by the healer
  healerAoe: number; // roar/aoe damage taken by the healer
  healerClaw: number; // single-target damage taken by the healer
  starvation: number | null; // first time mana hit ~empty
  enrage: number | null; // time the enemy enraged
}

function runOne(bot: Bot, reactionDelay: number): RunResult {
  const state = createInitialState();
  const dt = 0.05;
  let sinceOrder = 0;
  let lastScan = 0;
  let healerLine = 0;
  let healerAoe = 0;
  let healerClaw = 0;
  let starvation: number | null = null;
  let enrage: number | null = null;

  while (state.phase === "playing" && state.elapsedTime < 600) {
    sinceOrder += dt;
    if (sinceOrder >= reactionDelay) {
      bot(state);
      sinceOrder = 0;
    }
    update(state, dt);

    const h = healer(state);
    // "Starved" = can no longer afford even the cheapest heal (Fast Heal).
    if (starvation === null && h && h.alive && h.mana < (FAST_HEAL.manaCost ?? 0)) {
      starvation = state.elapsedTime;
    }
    const en = enemy(state);
    if (enrage === null && en && en.enraged) enrage = state.elapsedTime;

    // Attribute fresh damage on the healer by how many allies were hit at the
    // same instant: all -> Roar, two -> Cleave, one -> Claw.
    for (const ev of state.events) {
      if (ev.at <= lastScan || ev.kind !== "damage" || ev.entityId !== "healer") {
        continue;
      }
      const sharedCount = state.events.filter(
        (o) =>
          o.kind === "damage" &&
          o.at === ev.at &&
          isParty(state.entities.find((e) => e.id === o.entityId) ?? ({} as Entity)),
      ).length;
      if (sharedCount >= 3) healerAoe += ev.amount;
      else if (sharedCount === 2) healerLine += ev.amount;
      else healerClaw += ev.amount;
    }
    lastScan = state.elapsedTime;
  }
  return { state, healerLine, healerAoe, healerClaw, starvation, enrage };
}

function summarize(name: string, bot: Bot, reactionDelay: number): void {
  const runs = 200;
  let wins = 0;
  let totalTime = 0;
  let totalDeaths = 0;
  let timeouts = 0;
  let line = 0;
  let aoe = 0;
  let claw = 0;
  let starvSum = 0;
  let starvN = 0;
  let enrageSum = 0;
  let enrageN = 0;
  for (let i = 0; i < runs; i++) {
    const r = runOne(bot, reactionDelay);
    if (r.state.phase === "won") {
      wins++;
      totalTime += r.state.elapsedTime;
    }
    if (r.state.phase === "playing") timeouts++;
    totalDeaths += r.state.stats.deaths;
    line += r.healerLine;
    aoe += r.healerAoe;
    claw += r.healerClaw;
    if (r.starvation !== null) {
      starvSum += r.starvation;
      starvN++;
    }
    if (r.enrage !== null) {
      enrageSum += r.enrage;
      enrageN++;
    }
  }
  const avgTime = wins ? (totalTime / wins).toFixed(1) : "-";
  const avgStarv = starvN ? (starvSum / starvN).toFixed(0) : "-";
  const avgEnrage = enrageN ? (enrageSum / enrageN).toFixed(0) : "-";
  console.log(
    `${name.padEnd(26)} win ${((wins / runs) * 100).toFixed(0).padStart(3)}%  ` +
      `kill ${String(avgTime).padStart(5)}s  deaths ${(totalDeaths / runs).toFixed(2)}  ` +
      `OOM@${String(avgStarv).padStart(3)}s enrage@${String(avgEnrage).padStart(3)}s  ` +
      `healer L/A/C ${(line / runs).toFixed(0)}/${(aoe / runs).toFixed(0)}/${(claw / runs).toFixed(0)}` +
      (timeouts ? `  TIMEOUTS ${timeouts}` : ""),
  );
}

/** Single annotated run: a timeline of HP / mana / enemy HP, plus deaths, so we
 * can see whether the tank or squishies fall and where mana goes. */
function debugRun(bot: Bot, reactionDelay: number): void {
  const state = createInitialState();
  const dt = 0.05;
  let sinceOrder = 0;
  let nextLog = 0;
  const dead = new Set<string>();
  const hp = (id: string) => {
    const e = state.entities.find((x) => x.id === id)!;
    return `${Math.round(e.hp)}`.padStart(3);
  };
  while (state.phase === "playing" && state.elapsedTime < 200) {
    sinceOrder += dt;
    if (sinceOrder >= reactionDelay) {
      bot(state);
      sinceOrder = 0;
    }
    update(state, dt);
    for (const e of state.entities) {
      if (!e.alive && isParty(e) && !dead.has(e.id)) {
        dead.add(e.id);
        console.log(`  t=${state.elapsedTime.toFixed(1)}s  DEATH: ${e.name}`);
      }
    }
    if (state.elapsedTime >= nextLog) {
      const h = healer(state)!;
      const en = enemy(state)!;
      console.log(
        `t=${state.elapsedTime.toFixed(0).padStart(3)}s  enemy ${Math.round(en.hp).toString().padStart(4)}${en.enraged ? "*" : " "}  ` +
          `mana ${Math.round(h.mana).toString().padStart(3)}  ` +
          `TK ${hp("tank")} RG ${hp("ranger")} MG ${hp("mage")} H ${hp("healer")}`,
      );
      nextLog += 5;
    }
  }
  console.log(`  -> ${state.phase} at ${state.elapsedTime.toFixed(1)}s\n`);
}

if (process.argv[2] === "debug") {
  debugRun(smartBot, 0.3);
  process.exit(0);
}

summarize("smart, 0.3s", smartBot, 0.3);
summarize("smart, 1.0s", smartBot, 1.0);
summarize("smart, 2.0s", smartBot, 2.0);
summarize("sloppy, 0.4s", sloppyBot, 0.4);
summarize("afk", afkBot, 1.0);
