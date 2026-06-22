// Headless balance check: scripted "healers" of varying skill drive the sim
// through whole AREAS (3 fights each, HP/MP carrying over with the between-fight
// recovery). The tank/ranger/mage auto-attack; the bot only plays the healer
// (and picks the party's focus target).
// Run: npx -y tsx scripts/sim-playtest.ts   (add "debug <area>" for a timeline)

import {
  advanceFight,
  createInitialState,
  issueOrder,
  setFocus,
  startArea,
  update,
} from "../src/game/engine.ts";
import { AOE_HEAL, FAST_HEAL, RENEW, SLOW_HEAL } from "../src/game/actions.ts";
import { enemies, frontRowEnemies, livingParty } from "../src/game/combat.ts";
import { CONFIG } from "../src/game/config.ts";
import type { ActionDef, Entity, GameState } from "../src/game/types.ts";

type Bot = (state: GameState) => void;

function healer(state: GameState): Entity | undefined {
  return state.entities.find((e) => e.kind === "healer");
}

/** Off cooldown AND affordable right now. */
function ready(h: Entity, def: ActionDef): boolean {
  return (h.cooldowns[def.id] ?? 0) <= 0 && h.mana >= (def.manaCost ?? 0);
}

/** Focus the lowest-HP front-row enemy so the party kills targets fast (less
 * incoming damage over the fight). */
function pickFocus(state: GameState): void {
  const front = frontRowEnemies(state);
  if (front.length === 0) return;
  const target = [...front].sort((a, b) => a.hp - b.hp)[0];
  setFocus(state, target.id);
}

/** The smart bot's triage: a mana-conscious player leaning on the efficient heals
 * (Renew/Slow/Group) and spending Fast Heal only on emergencies / when comfortable. */
function triage(
  state: GameState,
  h: Entity,
): { def: ActionDef; targetId: string } | undefined {
  const party = livingParty(state);
  const manaPct = h.mana / h.maxMana;
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
  if (tank && tank.maxHp - tank.hp >= 16 && !tank.hots.some((x) => !x.hostile) && ready(h, RENEW)) {
    return { def: RENEW, targetId: tank.id };
  }
  // 3. Group heal when several are hurt (efficient multi-target).
  if (hurt.filter((x) => x.missing >= 16).length >= 3 && ready(h, AOE_HEAL)) {
    return { def: AOE_HEAL, targetId: worst.p.id };
  }
  // 4. Big single deficit -> Slow Heal (the efficient workhorse).
  if (worst.missing >= 30 && ready(h, SLOW_HEAL)) {
    return { def: SLOW_HEAL, targetId: worst.p.id };
  }
  // 5. Top up only when fairly low AND mana is comfortable (Fast Heal is wasteful;
  //    leaning on it across an area is how you go OOM).
  if (worst.pct < 0.45 && manaPct > 0.5 && ready(h, FAST_HEAL)) {
    return { def: FAST_HEAL, targetId: worst.p.id };
  }
  return undefined;
}

const smartBot: Bot = (state) => {
  pickFocus(state);
  const h = healer(state);
  if (!h || !h.alive || h.current) return;
  const order = triage(state, h);
  if (order) issueOrder(state, h.id, order.def, order.targetId);
};

/** Sloppy player: spams Fast Heal on the most-hurt. Should run dry and lose. */
const sloppyBot: Bot = (state) => {
  pickFocus(state);
  const h = healer(state);
  if (!h || !h.alive || h.current) return;
  const worst = livingParty(state)
    .filter((p) => p.hp < p.maxHp)
    .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
  if (worst && ready(h, FAST_HEAL)) issueOrder(state, h.id, FAST_HEAL, worst.id);
};

/** AFK player: never heals (still picks focus so the party fights). Must lose. */
const afkBot: Bot = (state) => {
  pickFocus(state);
};

interface RunResult {
  outcome: "win" | "defeat" | "timeout";
  fightReached: number; // fight index when it ended (0-based)
  deaths: number;
  time: number;
  starvation: number | null;
  enrage: number | null;
  healerDmg: number;
  // Lowest HP% any boss was pushed to this run (0 = killed; null = never
  // reached a boss). The key "hard wall vs near-miss" signal for 0%-win areas.
  bossMinHp: number | null;
}

function runArea(bot: Bot, reactionDelay: number, areaIndex: number): RunResult {
  const state = createInitialState();
  startArea(state, areaIndex);
  const dt = 0.05;
  let sinceOrder = 0;
  let lastScan = 0;
  let starvation: number | null = null;
  let enrage: number | null = null;
  let healerDmg = 0;
  let bossMinHp: number | null = null;

  while (state.elapsedTime < 1200) {
    if (state.phase === "fight-cleared") {
      advanceFight(state);
      continue;
    }
    if (state.phase !== "playing") break;

    sinceOrder += dt;
    if (sinceOrder >= reactionDelay) {
      bot(state);
      sinceOrder = 0;
    }
    update(state, dt);

    const h = healer(state);
    if (starvation === null && h && h.alive && h.mana < (FAST_HEAL.manaCost ?? 0)) {
      starvation = state.elapsedTime;
    }
    if (enrage === null && enemies(state).some((e) => e.enraged)) {
      enrage = state.elapsedTime;
    }
    for (const e of state.entities) {
      if (e.enemyType?.startsWith("boss")) {
        const frac = (e.hp / e.maxHp) * 100;
        if (bossMinHp === null || frac < bossMinHp) bossMinHp = frac;
      }
    }
    for (const ev of state.events) {
      if (ev.at > lastScan && ev.kind === "damage" && ev.entityId === "healer") {
        healerDmg += ev.amount;
      }
    }
    lastScan = state.elapsedTime;
  }

  const outcome =
    state.phase === "area-cleared" ? "win" : state.phase === "defeat" ? "defeat" : "timeout";
  return {
    outcome,
    fightReached: state.fightIndex,
    deaths: state.stats.deaths,
    time: state.elapsedTime,
    starvation,
    enrage,
    healerDmg,
    bossMinHp,
  };
}

function summarize(name: string, bot: Bot, reactionDelay: number, areaIndex: number): void {
  const runs = 200;
  let wins = 0;
  let defeats = 0;
  let timeouts = 0;
  let totalTime = 0;
  let totalDeaths = 0;
  let starvSum = 0;
  let starvN = 0;
  const fightFail: number[] = [0, 0, 0];
  let healerDmg = 0;
  let bossSum = 0;
  let bossN = 0;
  for (let i = 0; i < runs; i++) {
    const r = runArea(bot, reactionDelay, areaIndex);
    if (r.outcome === "win") {
      wins++;
      totalTime += r.time;
    } else if (r.outcome === "defeat") {
      defeats++;
      fightFail[r.fightReached]++;
    } else {
      timeouts++;
    }
    totalDeaths += r.deaths;
    healerDmg += r.healerDmg;
    if (r.starvation !== null) {
      starvSum += r.starvation;
      starvN++;
    }
    // On a defeat, how low did we ever push the boss? (Skip wins, where the
    // boss is killed and 0% would just drag the wall-depth average down.)
    if (r.outcome === "defeat" && r.bossMinHp !== null) {
      bossSum += r.bossMinHp;
      bossN++;
    }
  }
  const avgTime = wins ? (totalTime / wins).toFixed(0) : "-";
  const avgStarv = starvN ? (starvSum / starvN).toFixed(0) : "-";
  // Lowest boss HP% reached on losing runs: high = hard wall, low = near-miss,
  // "-" = never even reached the boss (walled on the trash).
  const avgBoss = bossN ? `${(bossSum / bossN).toFixed(0)}%` : "-";
  console.log(
    `${name.padEnd(22)} win ${((wins / runs) * 100).toFixed(0).padStart(3)}%  ` +
      `time ${String(avgTime).padStart(4)}s  deaths ${(totalDeaths / runs).toFixed(2)}  ` +
      `OOM@${String(avgStarv).padStart(3)}s  ` +
      `failF ${fightFail.map((n) => (n / runs).toFixed(2)).join("/")}  ` +
      `boss▼${avgBoss.padStart(4)}  ` +
      `hDmg ${(healerDmg / runs).toFixed(0)}` +
      (timeouts ? `  TIMEOUTS ${timeouts}` : ""),
  );
}

/** Single annotated run of one area: timeline of HP / mana / first enemy HP. */
function debugRun(bot: Bot, reactionDelay: number, areaIndex: number): void {
  const state = createInitialState();
  startArea(state, areaIndex);
  const dt = 0.05;
  let sinceOrder = 0;
  let nextLog = 0;
  const dead = new Set<string>();
  const hp = (id: string) => {
    const e = state.entities.find((x) => x.id === id);
    return e ? `${Math.round(e.hp)}`.padStart(3) : "  -";
  };
  console.log(`\n== ${CONFIG.areas[areaIndex].name} ==`);
  while (state.elapsedTime < 1200) {
    if (state.phase === "fight-cleared") {
      console.log(`  t=${state.elapsedTime.toFixed(1)}s  FIGHT ${state.fightIndex + 1} CLEARED`);
      advanceFight(state);
      nextLog = state.elapsedTime;
      continue;
    }
    if (state.phase !== "playing") break;
    sinceOrder += dt;
    if (sinceOrder >= reactionDelay) {
      bot(state);
      sinceOrder = 0;
    }
    update(state, dt);
    for (const e of state.entities) {
      if (!e.alive && e.kind !== "enemy" && !dead.has(e.id)) {
        dead.add(e.id);
        console.log(`  t=${state.elapsedTime.toFixed(1)}s  DEATH: ${e.name}`);
      }
    }
    if (state.elapsedTime >= nextLog) {
      const h = healer(state)!;
      const enemyHp = enemies(state)
        .map((e) => Math.round(e.hp))
        .join(",");
      console.log(
        `t=${state.elapsedTime.toFixed(0).padStart(3)}s F${state.fightIndex + 1}  ` +
          `mana ${Math.round(h.mana).toString().padStart(3)}  ` +
          `TK ${hp("tank")} RG ${hp("ranger")} MG ${hp("mage")} H ${hp("healer")}  ` +
          `enemies [${enemyHp}]`,
      );
      nextLog += 5;
    }
  }
  console.log(`  -> ${state.phase} at ${state.elapsedTime.toFixed(1)}s\n`);
}

if (process.argv[2] === "debug") {
  debugRun(smartBot, 0.3, Number(process.argv[3] ?? 2));
  process.exit(0);
}

for (let a = 0; a < CONFIG.areas.length; a++) {
  summarize(`area ${a + 1} smart .3`, smartBot, 0.3, a);
}
console.log("");
summarize("area 3 smart 1.0", smartBot, 1.0, 2);
summarize("area 3 sloppy", sloppyBot, 0.4, 2);
summarize("area 3 afk", afkBot, 1.0, 2);
summarize("area 5 sloppy", sloppyBot, 0.4, 4);
