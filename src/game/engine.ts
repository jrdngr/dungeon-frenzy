// The simulation. update(state, dt) drives everything; no canvas/DOM here.

import { CONFIG } from "./config";
import { autoAttackFor, enemyType } from "./actions";
import {
  applyDamage,
  applyHeal,
  applyHot,
  autoAttackers,
  enemies,
  enemyTargetPriority,
  findEntity,
  focusedEnemy,
  frontRowEnemies,
  frontmostEnemy,
  frontmostLiving,
  livingParty,
  tickHots,
} from "./combat";
import {
  canPurchase,
  critHealChance,
  effectiveHealer,
  effectiveParty,
  effectiveRecovery,
  nextNodeCost,
  partyAbilities,
} from "./skills";
import type {
  ActionDef,
  ActionInstance,
  AutoAttackerKind,
  Entity,
  GameState,
  Stats,
} from "./types";
import { isDPS, isParty } from "./types";

/** How long finished events are kept around for the UI to animate. */
const EVENT_TTL = 3.0;

function emptyStats(): Stats {
  return { damageDealt: 0, healingDone: 0, overhealing: 0, deaths: 0 };
}

/** A fresh game sits at the area-select hub — no party or enemies yet. Picking an
 * area (startArea) builds the party and spawns the first fight. */
export function createInitialState(): GameState {
  return {
    entities: [],
    armedSpellId: undefined,
    focusedEnemyId: undefined,
    areaIndex: 0,
    fightIndex: 0,
    clearedAreas: CONFIG.areas.map(() => false),
    phase: "area-select",
    elapsedTime: 0,
    events: [],
    stats: emptyStats(),
    skillPoints: 0,
    runStartSkillPoints: 0,
    skills: { heal: 1 }, // the center Heal spell starts owned/free
    skillTreeOpen: false,
  };
}

interface MakeOpts {
  id: string;
  kind: Entity["kind"];
  name: string;
  maxHp: number;
  maxMana?: number;
  manaRegen?: number;
  hex: Entity["hex"];
  enemyType?: string;
  row?: number;
  col?: number;
}

function makeEntity(o: MakeOpts): Entity {
  return {
    id: o.id,
    name: o.name,
    kind: o.kind,
    hp: o.maxHp,
    maxHp: o.maxHp,
    mana: o.maxMana ?? 0,
    maxMana: o.maxMana ?? 0,
    manaRegen: o.manaRegen ?? 0,
    hex: o.hex,
    current: undefined,
    hots: [],
    cooldowns: {},
    alive: true,
    actionCount: 0,
    enraged: false,
    enemyType: o.enemyType,
    row: o.row,
    col: o.col,
  };
}

/** Enter an area: build the party fresh at full HP/MP (they persist across the
 * area's 3 fights) and start fight 1. The party holds a fixed centered column —
 * tank in front, ranger + mage on the middle row, the healer (you) in the back. */
export function startArea(state: GameState, areaIndex: number): void {
  if (areaIndex < 0 || areaIndex >= CONFIG.areas.length) return;
  state.areaIndex = areaIndex;
  state.fightIndex = 0;
  state.elapsedTime = 0;
  state.events = [];
  state.stats = emptyStats();
  state.armedSpellId = undefined;
  // Bank the SP carried in; anything earned this run is forfeit if the player quits.
  state.runStartSkillPoints = state.skillPoints;
  // Layer skill-tree bonuses onto the base config when the party is (re)built.
  const party = effectiveParty(state.skills);
  const healer = effectiveHealer(state.skills);
  state.entities = [
    makeEntity({ id: "tank", kind: "tank", name: "Tank", maxHp: party.tank.maxHp, hex: { q: 0, r: 0 } }),
    makeEntity({ id: "ranger", kind: "ranger", name: "Ranger", maxHp: party.ranger.maxHp, hex: { q: -1, r: 1 } }),
    makeEntity({ id: "mage", kind: "mage", name: "Mage", maxHp: party.mage.maxHp, hex: { q: 0, r: 1 } }),
    makeEntity({ id: "healer", kind: "healer", name: "Healer", maxHp: CONFIG.healer.maxHp, maxMana: healer.maxMana, manaRegen: healer.manaRegen, hex: { q: -1, r: 2 } }),
  ];
  startFight(state, 0);
}

/** Spawn a fight's enemies and reset per-fight transient party state (clear casts/
 * HoTs/DoTs, reset cooldowns). HP/MP carry over; only the between-fight recovery
 * (applyRecovery) changes them. The armed spell carries over too, so the player
 * keeps their selected heal between an area's fights; startArea clears it on a
 * fresh area entry. */
function startFight(state: GameState, fightIndex: number): void {
  state.fightIndex = fightIndex;
  state.entities = state.entities.filter((e) => e.kind !== "enemy");
  for (const e of state.entities) {
    e.current = undefined;
    e.hots = [];
    e.cooldowns = {};
  }

  const fight = CONFIG.areas[state.areaIndex].fights[fightIndex];
  fight.enemies.forEach((p, i) => {
    const type = enemyType(p.type);
    state.entities.push(
      makeEntity({
        id: `enemy-${i}`,
        kind: "enemy",
        name: type.name,
        maxHp: type.maxHp,
        hex: { q: 0, r: 0 },
        enemyType: p.type,
        row: p.row,
        col: p.col,
      }),
    );
  });

  state.focusedEnemyId = frontmostEnemy(state)?.id;
  for (const e of enemies(state)) startEnemyAction(state, e);
  state.phase = "playing";
}

/** Between-fight recovery: living members +10% max HP, healer +10% max mana, dead
 * members revive at 10% max HP. (Knobs in CONFIG.recovery.) */
function applyRecovery(state: GameState): void {
  const rec = effectiveRecovery(state.skills);
  for (const e of state.entities) {
    if (e.kind === "enemy") continue;
    if (!e.alive) {
      e.alive = true;
      e.hp = Math.max(1, Math.round(e.maxHp * rec.reviveHpFraction));
    } else {
      e.hp = Math.min(e.maxHp, e.hp + e.maxHp * rec.hpFraction);
    }
    if (e.maxMana > 0) e.mana = Math.min(e.maxMana, e.mana + e.maxMana * rec.manaFraction);
  }
}

/** Player clicked "continue" on the fight-cleared screen: apply recovery and start
 * the next fight. */
export function advanceFight(state: GameState): void {
  if (state.phase !== "fight-cleared") return;
  applyRecovery(state);
  startFight(state, state.fightIndex + 1);
}

/** Return to the area-select hub (from an end overlay), keeping cleared progress.
 * Progression (skillPoints/skills) persists — it is never reset here. SP earned
 * this run banks here because reaching an end overlay means the area was cleared
 * or the party died (the only ways to keep run SP). */
export function returnToHub(state: GameState): void {
  state.phase = "area-select";
  state.entities = [];
  state.armedSpellId = undefined;
  state.focusedEnemyId = undefined;
  state.events = [];
}

/** Abandon the run mid-fight (the Quit Area button): forfeit every SP earned this
 * run by rolling back to the run-start snapshot, then return to the hub. Clearing
 * the area or dying is the only way to keep run SP. */
export function quitArea(state: GameState): void {
  state.skillPoints = state.runStartSkillPoints;
  returnToHub(state);
}

/** Spend a skill point on the next rank of a node (hub only). Returns whether it
 * succeeded (prereqs met, not maxed, enough SP). */
export function spendSkillPoint(state: GameState, nodeId: string): boolean {
  if (state.phase !== "area-select") return false;
  if (!canPurchase(state, nodeId).ok) return false;
  const cost = nextNodeCost(state.skills, nodeId);
  if (cost === null) return false;
  state.skills[nodeId] = (state.skills[nodeId] ?? 0) + 1;
  state.skillPoints -= cost;
  return true;
}

/** Set the party's focus-fire target. Only a living front-row enemy is allowed. */
export function setFocus(state: GameState, enemyId: string): void {
  const e = findEntity(state, enemyId);
  if (!e || !e.alive || e.kind !== "enemy") return;
  if (!frontRowEnemies(state).some((f) => f.id === enemyId)) return;
  state.focusedEnemyId = enemyId;
}

/** Full legality check for starting an action: caster + target alive, mana,
 * cooldown. */
function validateOrder(
  state: GameState,
  caster: Entity,
  def: ActionDef,
  targetId?: string,
): boolean {
  if (!caster.alive) return false;

  if (def.targeting === "enemy") {
    const t = targetId ? findEntity(state, targetId) : frontmostEnemy(state);
    if (!t || !t.alive || t.kind !== "enemy") return false;
  } else if (def.targeting === "ally-dead") {
    const t = targetId ? findEntity(state, targetId) : undefined;
    if (!t || t.alive || !isParty(t)) return false; // Resurrect needs a DEAD ally
  } else if (targetId) {
    const t = findEntity(state, targetId);
    if (!t || !t.alive) return false;
  }

  if (def.manaCost !== undefined && caster.mana < def.manaCost) return false;
  if ((caster.cooldowns[def.id] ?? 0) > 0) return false;
  return true;
}

/** Begin an action on an entity, replacing whatever it was doing. Validates
 * target/mana/cooldown so an illegal order is ignored. Mana and cooldown are
 * checked here but only *spent/started* on completion, so replacing a cast (or a
 * mis-click) never wastes them. */
function startAction(
  state: GameState,
  casterId: string,
  def: ActionDef,
  targetId?: string,
  victimIds?: string[],
): ActionInstance | undefined {
  const caster = findEntity(state, casterId);
  if (!caster) return undefined;
  if (!validateOrder(state, caster, def, targetId)) return undefined;

  let resolved = targetId;
  if (def.targeting === "enemy" && !resolved) resolved = frontmostEnemy(state)?.id;

  // Re-issuing the same spell on the same target mid-cast keeps the existing cast
  // going — don't restart the progress bar. Only a different spell or target does.
  const cur = caster.current;
  if (cur && cur.def.id === def.id && cur.targetId === resolved) return cur;

  caster.current = { def, elapsed: 0, targetId: resolved, victimIds };
  return caster.current;
}

/** The single entry point for player/bot orders. There is no queue: an order
 * issued while the caster is already casting *replaces* that cast (mana/cooldown
 * only commit on completion). An illegal order is ignored. */
export function issueOrder(
  state: GameState,
  casterId: string,
  def: ActionDef,
  targetId?: string,
): void {
  startAction(state, casterId, def, targetId);
}

/** Abort the current cast (free — mana/cooldown only commit on completion). */
export function cancelCast(state: GameState, casterId: string): void {
  const caster = findEntity(state, casterId);
  if (!caster || !caster.alive || !caster.current) return;
  caster.current = undefined;
}

/** Single-target (Claw / Heavy Smash) victim: the tank, then a random living DPS,
 * then the healer. */
function clawTargetId(state: GameState): string | undefined {
  return enemyTargetPriority(
    state,
    (dps) => dps[Math.floor(Math.random() * dps.length)],
  )?.id;
}

/** Curse victim: a random living NON-tank if any (the DoT spreads to the squishy
 * backline / the healer), otherwise the tank. */
function curseTargetId(state: GameState): string | undefined {
  const party = livingParty(state);
  const back = party.filter((p) => p.kind !== "tank");
  const pool = back.length > 0 ? back : party;
  if (pool.length === 0) return undefined;
  return pool[Math.floor(Math.random() * pool.length)].id;
}

/** Pick `count` distinct Line/Cleave victims: the priority target (tank-first)
 * plus random others. */
function pickLineVictims(state: GameState, count: number): string[] {
  const primary = frontmostLiving(state);
  const victims: Entity[] = primary ? [primary] : [];
  const others = livingParty(state).filter((p) => p !== primary);
  for (let i = others.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [others[i], others[j]] = [others[j], others[i]];
  }
  victims.push(...others.slice(0, Math.max(0, count - victims.length)));
  return victims.map((v) => v.id);
}

/** Enemy decision-making: pick the next attack from this enemy's rotation (its
 * enraged variant when frenzied) and choose its target(s). */
function startEnemyAction(state: GameState, e: Entity): void {
  if (!e.alive || !e.enemyType) return;
  if (livingParty(state).length === 0) return;

  const type = enemyType(e.enemyType);
  const slot = type.rotation[e.actionCount % type.rotation.length];
  const def = (e.enraged && type.enraged[slot]) || type.normal[slot];
  if (!def) return;

  switch (def.effect.kind) {
    case "aoe-damage":
      startAction(state, e.id, def);
      break;
    case "line-damage":
      startAction(state, e.id, def, undefined, pickLineVictims(state, def.effect.count));
      break;
    case "dot":
      startAction(state, e.id, def, curseTargetId(state));
      break;
    default: // single-target damage (Claw / Heavy Smash)
      startAction(state, e.id, def, clawTargetId(state));
  }
}

/** The first off-cooldown auto-cast ability for an attacker (partyAbilities is
 * pre-sorted longest-cooldown first), or undefined to fall back to the basic swing. */
function readyAbility(
  state: GameState,
  a: Entity & { kind: AutoAttackerKind },
): ActionDef | undefined {
  return partyAbilities(a.kind, state.skills).find(
    (def) => (a.cooldowns[def.id] ?? 0) <= 0,
  );
}

/** Victims for a party Volley: the focus plus (count-1) other front-row enemies. */
function pickEnemyLineVictims(
  state: GameState,
  focusId: string,
  count: number,
): string[] {
  const others = frontRowEnemies(state).filter((e) => e.id !== focusId);
  for (let i = others.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [others[i], others[j]] = [others[j], others[i]];
  }
  return [focusId, ...others.slice(0, Math.max(0, count - 1)).map((e) => e.id)];
}

/** Attackers never stand around: any idle tank/ranger/mage casts a ready skill-tree
 * ability (shields/nukes/AoE/DoT) at the focus, else its basic swing. */
function startAutoAttacks(state: GameState): void {
  const focusId = focusedEnemy(state)?.id ?? frontmostEnemy(state)?.id;
  if (!focusId) return;
  const party = effectiveParty(state.skills);
  for (const a of autoAttackers(state)) {
    if (!a.alive || a.current) continue;
    const ability = readyAbility(state, a);
    if (ability) {
      const victimIds =
        ability.effect.kind === "line-damage"
          ? pickEnemyLineVictims(state, focusId, ability.effect.count)
          : undefined;
      const targetId = ability.targeting === "enemy" ? focusId : undefined;
      startAction(state, a.id, ability, targetId, victimIds);
    } else {
      startAction(state, a.id, autoAttackFor(a.kind, party[a.kind].attackDamage), focusId);
    }
  }
}

/** Refresh an entity's hit-block shield to at least `hits` charges, preserving its
 * absorb pool (both shield flavors coexist on one struct). */
function grantHitShield(e: Entity, hits: number): void {
  if (!e.shield) e.shield = { hits: 0, absorb: 0, absorbCap: 0 };
  e.shield.hits = Math.max(e.shield.hits, hits);
}

/** Resolve a completed action's effect, spending mana and starting its cooldown. */
function resolveAction(state: GameState, caster: Entity): void {
  const inst = caster.current;
  if (!inst) return;
  const { def } = inst;

  if (def.manaCost !== undefined) caster.mana = Math.max(0, caster.mana - def.manaCost);
  if (def.cooldown) caster.cooldowns[def.id] = def.cooldown;

  // Crit Heals: a healer cast may land at 1.5x (rolled once per cast).
  const critMult =
    caster.kind === "healer" && Math.random() < critHealChance(state.skills) ? 1.5 : 1;

  switch (def.effect.kind) {
    case "damage": {
      let target = inst.targetId ? findEntity(state, inst.targetId) : undefined;
      if (!target || !target.alive) {
        target =
          caster.kind === "enemy"
            ? frontmostLiving(state)
            : focusedEnemy(state) ?? frontmostEnemy(state);
      }
      if (target && target.alive) {
        const dealt = applyDamage(state, target, def.effect.amount);
        // Thorns: an enemy melee hit on a buffed tank reflects damage to the attacker.
        if (caster.kind === "enemy" && target.thorns && target.thorns.remaining > 0 && dealt > 0) {
          applyDamage(state, caster, dealt * target.thorns.pct);
        }
      }
      break;
    }
    case "heal": {
      const target = inst.targetId ? findEntity(state, inst.targetId) : undefined;
      if (target && target.alive) applyHeal(state, target, def.effect.amount * critMult);
      break;
    }
    case "hot":
    case "dot": {
      const target = inst.targetId ? findEntity(state, inst.targetId) : undefined;
      if (target && target.alive) {
        applyHot(target, {
          perTick: def.effect.perTick,
          interval: def.effect.interval,
          duration: def.effect.duration,
          sinceTick: 0,
          hostile: def.effect.kind === "dot",
        });
      }
      break;
    }
    case "aoe-heal":
      for (const p of livingParty(state)) applyHeal(state, p, def.effect.amount * critMult);
      break;
    case "aoe-damage":
      for (const p of livingParty(state)) applyDamage(state, p, def.effect.amount);
      break;
    case "aoe-enemy-damage":
      // Front-row only — back-row enemies stay shielded until the front clears.
      for (const e of frontRowEnemies(state)) applyDamage(state, e, def.effect.amount);
      break;
    case "line-damage": {
      for (const id of inst.victimIds ?? []) {
        const v = findEntity(state, id);
        if (v && v.alive) applyDamage(state, v, def.effect.amount);
      }
      break;
    }
    case "shield": {
      if (def.effect.scope === "party-all") {
        for (const p of livingParty(state)) grantHitShield(p, def.effect.hits);
      } else {
        grantHitShield(caster, def.effect.hits);
      }
      break;
    }
    case "thorns":
      caster.thorns = { pct: def.effect.pct, remaining: def.effect.duration };
      break;
    case "mana-restore": {
      const healer = state.entities.find((e) => e.kind === "healer" && e.alive);
      if (healer && healer.maxMana > 0) {
        healer.mana = Math.min(healer.maxMana, healer.mana + def.effect.amount);
      }
      break;
    }
    case "revive": {
      const target = inst.targetId ? findEntity(state, inst.targetId) : undefined;
      if (target && !target.alive && isParty(target)) {
        target.alive = true;
        target.hp = Math.max(1, Math.round(target.maxHp * def.effect.hpFraction));
        target.hots = [];
        target.current = undefined;
        state.events.push({ kind: "heal", entityId: target.id, amount: target.hp, at: state.elapsedTime });
      }
      break;
    }
  }
}

/** Advance the whole simulation by dt seconds. */
export function update(state: GameState, dt: number): void {
  if (state.phase !== "playing") return;

  state.elapsedTime += dt;

  // 1. Resources, cooldowns, and timed effects.
  for (const e of state.entities) {
    if (!e.alive) continue;
    if (e.maxMana > 0) {
      e.mana = Math.min(e.maxMana, e.mana + e.manaRegen * dt);
    }
    if (e.thorns) {
      e.thorns.remaining -= dt;
      if (e.thorns.remaining <= 0) e.thorns = undefined;
    }
    for (const id in e.cooldowns) {
      e.cooldowns[id] -= dt;
      if (e.cooldowns[id] <= 0) delete e.cooldowns[id];
    }
  }
  tickHots(state, dt);

  // 2. Advance casts and resolve completed ones. Each enemy re-arms on completion.
  for (const e of state.entities) {
    if (!e.alive || !e.current) continue;
    e.current.elapsed += dt;
    if (e.current.elapsed >= e.current.def.castTime) {
      resolveAction(state, e);
      e.current = undefined;
      if (e.kind === "enemy") {
        e.actionCount += 1;
        if (e.alive && livingParty(state).length > 0) startEnemyAction(state, e);
      }
    }
  }

  // 2a. Keep the focus valid (it may have died this frame), then auto-attack it.
  if (!focusedEnemy(state)) state.focusedEnemyId = frontmostEnemy(state)?.id;
  startAutoAttacks(state);

  // 2b. Keep every living enemy busy (none idles while the party lives).
  if (livingParty(state).length > 0) {
    for (const e of enemies(state)) if (!e.current) startEnemyAction(state, e);
  }

  // 3. Per-enemy enrage when an enemy drops below its threshold.
  for (const e of enemies(state)) {
    const type = enemyType(e.enemyType!);
    if (type.enrage && !e.enraged && e.hp <= e.maxHp * type.enrage.hpFraction) {
      e.enraged = true;
      state.events.push({ kind: "enrage", entityId: e.id, at: state.elapsedTime });
    }
  }

  // 4. Cleanup: dead casters drop their action; clear a stale armed spell.
  for (const e of state.entities) if (!e.alive) e.current = undefined;
  if (state.armedSpellId) {
    const h = state.entities.find((e) => e.kind === "healer");
    if (!h || !h.alive) state.armedSpellId = undefined;
  }

  // 5. Fight end / defeat. Clearing all enemies wins the fight: advance to the next
  // fight, or finish the area. Otherwise you lose if the party is wiped OR no
  // tank/DPS remains (a lone healer can't kill anything).
  if (enemies(state).length === 0) {
    const lastFight = CONFIG.areas[state.areaIndex].fights.length - 1;
    if (state.fightIndex < lastFight) {
      state.phase = "fight-cleared";
    } else {
      state.clearedAreas[state.areaIndex] = true;
      state.phase = "area-cleared";
    }
  } else {
    const living = livingParty(state);
    const canStillWin = living.some((e) => e.kind === "tank" || isDPS(e));
    if (living.length === 0 || !canStillWin) state.phase = "defeat";
  }

  // 6. Drop events the UI is done animating.
  state.events = state.events.filter((ev) => ev.at > state.elapsedTime - EVENT_TTL);
}
