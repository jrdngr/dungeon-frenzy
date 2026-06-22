// Headless balance check: scripted "healers" of varying skill drive the sim
// through whole AREAS (3 fights each, HP/MP carrying over with the between-fight
// recovery). The tank/ranger/mage auto-attack (and auto-cast their unlocked
// skill-tree abilities); the bot only plays the healer (and picks the focus).
//
// The bot is SKILL-TREE-AWARE: it heals from whatever spells are unlocked
// (healerSpells), and a build is just a `skills` record. Two ways to drive it:
//   - fixed builds: makeBuild(sp) spends `sp` points by BUILD_PRIORITY, then we
//     measure per-area win rate (bare start vs. a 25/50-SP build).
//   - campaign grind: grindCampaign() plays areas in order, banking SP, buying by
//     priority at the hub, and retrying on defeat — the "can a player grind
//     through, and how many attempts?" metric.
//
// Run: npx -y tsx scripts/sim-playtest.ts
//      npx -y tsx scripts/sim-playtest.ts debug <sp> <area>   (annotated timeline)

import {
  advanceFight,
  createInitialState,
  issueOrder,
  returnToHub,
  setFocus,
  spendSkillPoint,
  startArea,
  update,
} from "../src/game/engine.ts";
import { canPurchase, healerSpells } from "../src/game/skills.ts";
import { enemies, frontRowEnemies, livingParty } from "../src/game/combat.ts";
import { CONFIG, SKILL_NODES } from "../src/game/config.ts";
import type { ActionDef, Entity, GameState } from "../src/game/types.ts";
import { isParty } from "../src/game/types.ts";

type Bot = (state: GameState) => void;
type Skills = Record<string, number>;

/** The bare starting kit: only Heal unlocked. */
const BARE: Skills = { heal: 1 };

/** Low-mana threshold for the OOM metric: can't afford the cheapest heal. */
const LOW_MANA = CONFIG.healer.fastHeal.mana;

function healer(state: GameState): Entity | undefined {
  return state.entities.find((e) => e.kind === "healer");
}

/** A healer spell by id, but only if unlocked, off cooldown, AND affordable. */
function spellReady(state: GameState, h: Entity, id: string): ActionDef | undefined {
  const d = healerSpells(state.skills).find((s) => s.id === id);
  if (!d) return undefined;
  return (h.cooldowns[d.id] ?? 0) <= 0 && h.mana >= (d.manaCost ?? 0) ? d : undefined;
}

/** Focus the lowest-HP front-row enemy so the party kills targets fast. */
function pickFocus(state: GameState): void {
  const front = frontRowEnemies(state);
  if (front.length === 0) return;
  const target = [...front].sort((a, b) => a.hp - b.hp)[0];
  setFocus(state, target.id);
}

/** Mana-conscious triage over whatever spells are unlocked: revive when stable,
 * panic-heal when someone's dying, keep Regen rolling, Group when several hurt,
 * Heal the big deficits, Quick Heal to top up when mana is comfortable. */
function triage(
  state: GameState,
  h: Entity,
): { def: ActionDef; targetId: string } | undefined {
  const party = livingParty(state);
  const manaPct = h.maxMana > 0 ? h.mana / h.maxMana : 1;
  const hurt = party
    .map((p) => ({ p, missing: p.maxHp - p.hp, pct: p.hp / p.maxHp }))
    .sort((a, b) => a.pct - b.pct);
  const worst = hurt[0];
  let d: ActionDef | undefined;

  // Revive a fallen ally when the living party is stable (restores party DPS).
  const deadAlly = state.entities.find((e) => isParty(e) && !e.alive);
  if (deadAlly && (!worst || worst.pct > 0.55) && (d = spellReady(state, h, "resurrect"))) {
    return { def: d, targetId: deadAlly.id };
  }
  if (!worst || worst.missing === 0) return undefined;

  // 1. Emergency: someone about to die -> Quick Heal (fast), else Heal.
  if (worst.pct < 0.3) {
    if ((d = spellReady(state, h, "quick-heal"))) return { def: d, targetId: worst.p.id };
    if ((d = spellReady(state, h, "heal"))) return { def: d, targetId: worst.p.id };
  }
  // 2. Keep Regen rolling on the tank (cheap, efficient anchor).
  const tank = party.find((p) => p.kind === "tank");
  if (tank && tank.maxHp - tank.hp >= 16 && !tank.hots.some((x) => !x.hostile) && (d = spellReady(state, h, "regen"))) {
    return { def: d, targetId: tank.id };
  }
  // 3. Group heal when several are hurt (efficient multi-target).
  if (hurt.filter((x) => x.missing >= 16).length >= 3 && (d = spellReady(state, h, "group-heal"))) {
    return { def: d, targetId: worst.p.id };
  }
  // 4. Big single deficit -> Heal (the workhorse, always available).
  if (worst.missing >= 28 && (d = spellReady(state, h, "heal"))) return { def: d, targetId: worst.p.id };
  // 5. Top up only when fairly low AND mana is comfortable.
  if (worst.pct < 0.5 && manaPct > 0.5 && (d = spellReady(state, h, "quick-heal"))) {
    return { def: d, targetId: worst.p.id };
  }
  // 6. Last resort: Heal the worst if reasonably hurt (base kit has only this).
  if (worst.missing >= 15 && (d = spellReady(state, h, "heal"))) return { def: d, targetId: worst.p.id };
  return undefined;
}

const smartBot: Bot = (state) => {
  pickFocus(state);
  const h = healer(state);
  if (!h || !h.alive || h.current) return;
  const order = triage(state, h);
  if (order) issueOrder(state, h.id, order.def, order.targetId);
};

/** Sloppy player: spams the fastest available heal on the most-hurt. */
const sloppyBot: Bot = (state) => {
  pickFocus(state);
  const h = healer(state);
  if (!h || !h.alive || h.current) return;
  const worst = livingParty(state)
    .filter((p) => p.hp < p.maxHp)
    .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
  if (!worst) return;
  const d = spellReady(state, h, "quick-heal") ?? spellReady(state, h, "heal");
  if (d) issueOrder(state, h.id, d, worst.id);
};

/** AFK player: never heals (still picks focus so the party fights). */
const afkBot: Bot = (state) => {
  pickFocus(state);
};

// --- Skill-tree builds ---

/** A balanced DPS + sustain build order; buyBuild greedily fills by priority.
 * Listed so prereqs come before dependents (the outer loop also handles gaps). */
const BUILD_PRIORITY: string[] = [
  "quick-heal", "mana-pool", "meditation", "regen", "group-heal",
  "tank-training", "heavy-strikes", "deadeye", "arcane-power",
  "aimed-shot", "fireball", "shield-wall", "volley", "firestorm", "thorns",
  "potent-heal", "efficient-heal", "swift-heal",
  "potent-quick-heal", "efficient-quick-heal", "swift-quick-heal",
  "lingering-regen", "efficient-regen", "swift-regen",
  "wide-grace", "efficient-group-heal", "swift-group-heal",
  "ranger-training", "mage-training", "second-wind", "crit-heals", "field-rations",
  "overheal-shield", "reinforced-shield",
  "bulwark", "serpent-sting", "arcane-conduit",
  "resurrect", "greater-resurrection",
];

/** Spend all available skill points by priority (validating prereqs/cost). Must be
 * called at the hub (area-select), where spendSkillPoint is allowed. */
function buyBuild(state: GameState): void {
  let bought = true;
  while (bought) {
    bought = false;
    for (const id of BUILD_PRIORITY) {
      while (canPurchase(state, id).ok) {
        spendSkillPoint(state, id);
        bought = true;
      }
    }
  }
}

/** A build of up to `sp` skill points, chosen by BUILD_PRIORITY. */
function makeBuild(sp: number): Skills {
  const s = createInitialState();
  s.skillPoints = sp;
  buyBuild(s);
  return s.skills;
}

interface RunResult {
  outcome: "win" | "defeat" | "timeout";
  fightReached: number;
  deaths: number;
  time: number;
  starvation: number | null;
  enrage: number | null;
  healerDmg: number;
  bossMinHp: number | null;
}

function runArea(bot: Bot, reactionDelay: number, areaIndex: number, skills: Skills): RunResult {
  const state = createInitialState();
  state.skills = { ...skills };
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
    if (starvation === null && h && h.alive && h.mana < LOW_MANA) {
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

function summarize(
  name: string,
  bot: Bot,
  reactionDelay: number,
  areaIndex: number,
  skills: Skills,
): void {
  const runs = 150;
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
    const r = runArea(bot, reactionDelay, areaIndex, skills);
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
    if (r.outcome === "defeat" && r.bossMinHp !== null) {
      bossSum += r.bossMinHp;
      bossN++;
    }
  }
  const avgTime = wins ? (totalTime / wins).toFixed(0) : "-";
  const avgStarv = starvN ? (starvSum / starvN).toFixed(0) : "-";
  const avgBoss = bossN ? `${(bossSum / bossN).toFixed(0)}%` : "-";
  console.log(
    `${name.padEnd(18)} win ${((wins / runs) * 100).toFixed(0).padStart(3)}%  ` +
      `time ${String(avgTime).padStart(4)}s  deaths ${(totalDeaths / runs).toFixed(2)}  ` +
      `OOM@${String(avgStarv).padStart(3)}s  ` +
      `failF ${fightFail.map((n) => (n / runs).toFixed(2)).join("/")}  ` +
      `boss▼${avgBoss.padStart(4)}  ` +
      `hDmg ${(healerDmg / runs).toFixed(0)}` +
      (timeouts ? `  TIMEOUTS ${timeouts}` : ""),
  );
}

// --- Campaign grind: play areas in order, banking SP and buying by priority,
// retrying on defeat (SP/skills persist). The headline progression metric. ---

function playOnce(
  state: GameState,
  bot: Bot,
  reactionDelay: number,
  area: number,
): { win: boolean; time: number } {
  startArea(state, area);
  const dt = 0.05;
  let sinceOrder = 0;
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
  }
  return { win: state.phase === "area-cleared", time: state.elapsedTime };
}

interface GrindResult {
  cleared: number;
  attempts: number[];
  spSpent: number;
}

/** Total SP invested in the owned skills (sum of paid rank costs). */
function spSpent(skills: Skills): number {
  let spent = 0;
  for (const id in skills) {
    const node = SKILL_NODES.find((n) => n.id === id);
    if (!node) continue;
    for (let r = 0; r < skills[id]; r++) spent += node.costs[r] ?? 0;
  }
  return spent;
}

function grindCampaign(bot: Bot, reactionDelay: number, capPerArea = 40): GrindResult {
  const state = createInitialState();
  const attempts: number[] = [];
  let cleared = 0;
  for (let area = 0; area < CONFIG.areas.length; area++) {
    let a = 0;
    let won = false;
    while (!won && a < capPerArea) {
      buyBuild(state); // at the hub (area-select)
      a++;
      won = playOnce(state, bot, reactionDelay, area).win;
      returnToHub(state); // retain SP/skills; back to the hub
    }
    attempts.push(a);
    if (won) cleared++;
    else break;
  }
  return { cleared, attempts, spSpent: spSpent(state.skills) };
}

function summarizeGrind(name: string, bot: Bot, reactionDelay: number, runs: number): void {
  let clearedSum = 0;
  let fullClears = 0;
  let spSum = 0;
  const attemptsSum: number[] = CONFIG.areas.map(() => 0);
  const attemptsN: number[] = CONFIG.areas.map(() => 0);
  for (let i = 0; i < runs; i++) {
    const r = grindCampaign(bot, reactionDelay);
    clearedSum += r.cleared;
    if (r.cleared === CONFIG.areas.length) fullClears++;
    spSum += r.spSpent;
    r.attempts.forEach((a, idx) => {
      attemptsSum[idx] += a;
      attemptsN[idx]++;
    });
  }
  const avgAttempts = attemptsSum.map((s, i) => (attemptsN[i] ? (s / attemptsN[i]).toFixed(1) : "-"));
  console.log(
    `${name.padEnd(12)} full-clear ${((fullClears / runs) * 100).toFixed(0).padStart(3)}%  ` +
      `areas ${(clearedSum / runs).toFixed(1)}/5  ` +
      `attempts/area [${avgAttempts.join(", ")}]  ` +
      `SP spent ${(spSum / runs).toFixed(0)}`,
  );
}

/** Single annotated run of one area with a given build: HP/mana/enemy timeline. */
function debugRun(bot: Bot, reactionDelay: number, areaIndex: number, skills: Skills): void {
  const state = createInitialState();
  state.skills = { ...skills };
  startArea(state, areaIndex);
  const dt = 0.05;
  let sinceOrder = 0;
  let nextLog = 0;
  const dead = new Set<string>();
  const hp = (id: string) => {
    const e = state.entities.find((x) => x.id === id);
    return e ? `${Math.round(e.hp)}`.padStart(3) : "  -";
  };
  console.log(`\n== ${CONFIG.areas[areaIndex].name} (skills: ${Object.keys(skills).length} nodes) ==`);
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
  const sp = Number(process.argv[3] ?? 0);
  const area = Number(process.argv[4] ?? 2);
  debugRun(smartBot, 0.3, area, sp > 0 ? makeBuild(sp) : BARE);
  process.exit(0);
}

const build40 = makeBuild(40); // ~halfway through a campaign
const build84 = makeBuild(84); // a full first-try campaign's worth
console.log(
  `builds: bare=1 node · @40sp=${Object.keys(build40).length} nodes · @84sp=${Object.keys(build84).length} nodes`,
);

console.log("\n== per-area win rate by build (smart bot, 0.3s reaction) ==");
for (let a = 0; a < CONFIG.areas.length; a++) summarize(`area ${a + 1} bare`, smartBot, 0.3, a, BARE);
console.log("");
for (let a = 0; a < CONFIG.areas.length; a++) summarize(`area ${a + 1} @40sp`, smartBot, 0.3, a, build40);
console.log("");
for (let a = 0; a < CONFIG.areas.length; a++) summarize(`area ${a + 1} @84sp`, smartBot, 0.3, a, build84);

console.log("\n== campaign grind (buy by priority, retry on loss, SP retained) ==");
summarizeGrind("smart 0.3", smartBot, 0.3, 40);
summarizeGrind("smart 1.0", smartBot, 1.0, 40);
summarizeGrind("sloppy 0.4", sloppyBot, 0.4, 40);
