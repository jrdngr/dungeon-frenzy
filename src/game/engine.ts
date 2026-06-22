// The simulation. update(state, dt) drives everything; no canvas/DOM here.

import { CONFIG } from "./config";
import {
  ENEMY_AOE,
  ENEMY_AOE_ENRAGED,
  ENEMY_CLAW,
  ENEMY_CLAW_ENRAGED,
  ENEMY_LINE,
  ENEMY_LINE_ENRAGED,
  autoAttackFor,
} from "./actions";
import {
  applyDamage,
  applyHeal,
  applyHot,
  autoAttackers,
  enemy,
  findEntity,
  frontmostLiving,
  livingParty,
  tickHots,
} from "./combat";
import type {
  ActionDef,
  ActionInstance,
  Entity,
  GameState,
  HotInstance,
} from "./types";
import { isDPS, isParty } from "./types";

/** How long finished events are kept around for the UI to animate. */
const EVENT_TTL = 3.0;

/** Build a fresh battle: the party holds a fixed formation facing the enemy.
 * Tank in front (it soaks the enemy's focus), ranger + mage flanking the middle
 * row, the healer (you) safe in the back. Everything is immobile. */
export function createInitialState(): GameState {
  const entities: Entity[] = [
    makeEntity("enemy", "enemy", "Ogre", CONFIG.enemy.maxHp, 0, { q: 0, r: -3 }),
    makeEntity("tank", "tank", "Tank", CONFIG.tank.maxHp, 0, { q: 0, r: -1 }),
    makeEntity("ranger", "ranger", "Ranger", CONFIG.ranger.maxHp, 0, { q: -1, r: 0 }),
    makeEntity("mage", "mage", "Mage", CONFIG.mage.maxHp, 0, { q: 1, r: 0 }),
    makeEntity("healer", "healer", "Healer", CONFIG.healer.maxHp, CONFIG.healer.maxMana, { q: 0, r: 2 }),
  ];

  const state: GameState = {
    entities,
    mapRadius: CONFIG.map.radius,
    phase: "playing",
    elapsedTime: 0,
    events: [],
    stats: {
      damageDealt: 0,
      damageTaken: 0,
      healingDone: 0,
      overhealing: 0,
      idleSeconds: 0,
      deaths: 0,
      ordersDropped: 0,
    },
  };

  // The enemy starts acting immediately; the party auto-attacks from frame one.
  startEnemyAction(state);
  return state;
}

function makeEntity(
  id: string,
  kind: Entity["kind"],
  name: string,
  maxHp: number,
  maxMana: number,
  hex: Entity["hex"],
): Entity {
  return {
    id,
    name,
    kind,
    hp: maxHp,
    maxHp,
    mana: maxMana,
    maxMana,
    hex,
    hots: [],
    cooldowns: {},
    alive: true,
    idleFor: 0,
    actionCount: 0,
    enraged: false,
  };
}

type OrderStatus = "ok" | "wait" | "drop";

/** Classify an order against the world right now:
 * - "ok": legal, start it.
 * - "wait": temporarily blocked (not enough mana yet, or still on cooldown) but
 *   could become legal — a queued order should keep waiting, not be dropped.
 * - "drop": permanently illegal (caster/target dead) — drop loudly. */
function classifyOrder(
  state: GameState,
  caster: Entity,
  def: ActionDef,
  targetId?: string,
): OrderStatus {
  if (!caster.alive) return "drop";

  const target = targetId
    ? findEntity(state, targetId)
    : def.targeting === "enemy"
      ? enemy(state)
      : undefined;
  if (targetId && (!target || !target.alive)) return "drop";
  if (def.targeting === "enemy" && (!target || !target.alive)) return "drop";

  if (def.manaCost !== undefined && caster.mana < def.manaCost) return "wait";
  if ((caster.cooldowns[def.id] ?? 0) > 0) return "wait";
  return "ok";
}

/** Full legality check for starting an action: target alive, mana, cooldown. */
function validateOrder(
  state: GameState,
  caster: Entity,
  def: ActionDef,
  targetId?: string,
): boolean {
  return classifyOrder(state, caster, def, targetId) === "ok";
}

/** Begin an action on an entity, replacing whatever it was doing. Validates
 * target/mana/cooldown so an illegal order is ignored. Mana and cooldown are
 * checked here but only *spent/started* on completion, so replacing a cast (or a
 * mis-click) never wastes them.
 * Returns the started instance, or undefined if the order was illegal. */
export function startAction(
  state: GameState,
  casterId: string,
  def: ActionDef,
  targetId?: string,
  secondaryTargetId?: string,
): ActionInstance | undefined {
  const caster = findEntity(state, casterId);
  if (!caster) return undefined;
  if (!validateOrder(state, caster, def, targetId)) return undefined;

  const target = targetId
    ? findEntity(state, targetId)
    : def.targeting === "enemy"
      ? enemy(state)
      : undefined;
  caster.current = {
    def,
    elapsed: 0,
    targetId: target?.id ?? targetId,
    secondaryTargetId,
  };
  return caster.current;
}

/** Bank an order to auto-start when the current cast ends. Deliberately lenient
 * (alive caster is enough): legality is re-checked at promotion, so the player
 * may queue a heal they can't afford or that's still on cooldown *yet*. */
export function queueAction(
  state: GameState,
  casterId: string,
  def: ActionDef,
  targetId?: string,
): void {
  const caster = findEntity(state, casterId);
  if (!caster || !caster.alive) return;
  caster.queued = { def, elapsed: 0, targetId };
}

/** The single entry point for player/bot orders: starts immediately when the
 * unit is idle (an auto-attack counts as idle and is overridden), otherwise
 * banks the order in the one queued slot. */
export function issueOrder(
  state: GameState,
  casterId: string,
  def: ActionDef,
  targetId?: string,
): void {
  const caster = findEntity(state, casterId);
  if (!caster || !caster.alive) return;
  if (caster.current && !caster.current.auto) {
    queueAction(state, casterId, def, targetId);
  } else {
    startAction(state, casterId, def, targetId);
  }
}

/** Abort the current cast (free — mana/cooldown only commit on completion). Any
 * queued order starts immediately: the emergency "stop and re-cast" play. */
export function cancelCast(state: GameState, casterId: string): void {
  const caster = findEntity(state, casterId);
  if (!caster || !caster.alive || !caster.current) return;
  caster.current = undefined;
  promoteQueued(state, caster);
}

/** Drop a banked order without touching the current cast. */
export function clearQueue(state: GameState, casterId: string): void {
  const caster = findEntity(state, casterId);
  if (caster) caster.queued = undefined;
}

/** Try to start the queued order now that the unit is idle. If it's only
 * temporarily blocked (mana/cooldown) it stays banked and waits; if it has become
 * permanently illegal (target died) it is dropped *loudly* — a silently lost
 * order is the worst failure mode of a queue. */
function promoteQueued(state: GameState, e: Entity): void {
  if (!e.queued || e.current || !e.alive) return;
  const q = e.queued;
  const status = classifyOrder(state, e, q.def, q.targetId);
  if (status === "wait") return; // keep waiting; it may become castable
  e.queued = undefined;
  if (status === "ok") {
    startAction(state, e.id, q.def, q.targetId);
  } else {
    state.stats.ordersDropped += 1;
    state.events.push({
      kind: "queue-dropped",
      entityId: e.id,
      actionName: q.def.name,
      at: state.elapsedTime,
    });
  }
}

/** Which living party member the enemy single-target Claws: the tank, then a
 * random living damage dealer, then the healer. */
function clawTargetId(state: GameState): string | undefined {
  const tank = state.entities.find((e) => e.kind === "tank" && e.alive);
  if (tank) return tank.id;
  const dps = state.entities.filter((e) => isDPS(e) && e.alive);
  if (dps.length > 0) return dps[Math.floor(Math.random() * dps.length)].id;
  return state.entities.find((e) => e.kind === "healer" && e.alive)?.id;
}

/** Enemy decision-making: a fixed rotation indexed by completed combat actions.
 * - "aoe": hit all living party (the scary, telegraphed spike).
 * - "line": hit the frontmost living member + one random other (the only regular
 *   way to reach the healer).
 * - otherwise: a single-target Claw on the priority target (tank first). */
function startEnemyAction(state: GameState): void {
  const e = enemy(state);
  if (!e || !e.alive) return;
  const party = livingParty(state);
  if (party.length === 0) return;

  const rotation = CONFIG.enemy.rotation;
  const slot = rotation[e.actionCount % rotation.length];

  const claw = e.enraged ? ENEMY_CLAW_ENRAGED : ENEMY_CLAW;
  const line = e.enraged ? ENEMY_LINE_ENRAGED : ENEMY_LINE;
  const aoe = e.enraged ? ENEMY_AOE_ENRAGED : ENEMY_AOE;

  if (slot === "aoe") {
    startAction(state, e.id, aoe);
    return;
  }
  if (slot === "line") {
    const primary = frontmostLiving(state);
    const others = party.filter((p) => p !== primary);
    const secondary =
      others.length > 0
        ? others[Math.floor(Math.random() * others.length)]
        : undefined;
    startAction(state, e.id, line, primary?.id, secondary?.id);
    return;
  }
  startAction(state, e.id, claw, clawTargetId(state));
}

/** Attackers never stand around: any idle tank/ranger/mage with no banked order
 * auto-casts its own attack. The cast is flagged `auto`. */
function startAutoAttacks(state: GameState): void {
  for (const a of autoAttackers(state)) {
    if (!a.alive || a.current || a.queued) continue;
    if (a.kind !== "tank" && a.kind !== "ranger" && a.kind !== "mage") continue;
    const started = startAction(state, a.id, autoAttackFor(a.kind));
    if (started) started.auto = true;
  }
}

/** Resolve a completed action's effect, spending mana and starting its cooldown. */
function resolveAction(state: GameState, caster: Entity): void {
  const inst = caster.current;
  if (!inst) return;
  const { def } = inst;

  if (def.manaCost !== undefined) {
    caster.mana = Math.max(0, caster.mana - def.manaCost);
  }
  if (def.cooldown) {
    caster.cooldowns[def.id] = def.cooldown;
  }

  switch (def.effect.kind) {
    case "damage": {
      const target = inst.targetId
        ? findEntity(state, inst.targetId)
        : enemy(state);
      const finalTarget = target ?? enemy(state);
      if (finalTarget && finalTarget.alive) {
        applyDamage(state, finalTarget, def.effect.amount);
      }
      break;
    }
    case "heal": {
      const target = inst.targetId ? findEntity(state, inst.targetId) : undefined;
      if (target && target.alive) applyHeal(state, target, def.effect.amount);
      break;
    }
    case "hot": {
      const target = inst.targetId ? findEntity(state, inst.targetId) : undefined;
      if (target && target.alive) {
        const hot: HotInstance = {
          perTick: def.effect.perTick,
          interval: def.effect.interval,
          duration: def.effect.duration,
          sinceTick: 0,
        };
        applyHot(target, hot);
      }
      break;
    }
    case "aoe-heal": {
      for (const p of livingParty(state)) applyHeal(state, p, def.effect.amount);
      break;
    }
    case "aoe-damage": {
      for (const p of livingParty(state)) applyDamage(state, p, def.effect.amount);
      break;
    }
    case "line-damage": {
      const primary = inst.targetId
        ? findEntity(state, inst.targetId)
        : frontmostLiving(state);
      if (primary && primary.alive) applyDamage(state, primary, def.effect.amount);
      const secondary = inst.secondaryTargetId
        ? findEntity(state, inst.secondaryTargetId)
        : undefined;
      if (secondary && secondary.alive && secondary !== primary) {
        applyDamage(state, secondary, def.effect.amount);
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
      e.mana = Math.min(e.maxMana, e.mana + CONFIG.healer.manaRegen * dt);
    }
    for (const id in e.cooldowns) {
      e.cooldowns[id] -= dt;
      if (e.cooldowns[id] <= 0) delete e.cooldowns[id];
    }
  }
  tickHots(state, dt);

  // 2. Idle tracking (book-keeping for stats).
  for (const e of state.entities) {
    if (isParty(e) && e.alive && !e.current) {
      e.idleFor += dt;
      state.stats.idleSeconds += dt;
    } else {
      e.idleFor = 0;
    }
  }

  // 3. Advance casts and resolve completed ones.
  for (const e of state.entities) {
    if (!e.alive || !e.current) continue;
    e.current.elapsed += dt;
    if (e.current.elapsed >= e.current.def.castTime) {
      resolveAction(state, e);
      e.current = undefined;
      if (e.kind === "enemy") {
        e.actionCount += 1;
        if (e.alive) startEnemyAction(state);
      } else {
        // Party: a banked order starts now (validated against the world as it is
        // *after* this cast resolved and spent its mana / started its cooldown).
        promoteQueued(state, e);
      }
    }
  }

  // 3a. Safety net: any idle party member with a banked order tries to start it
  // (or keeps waiting if it's only blocked by mana/cooldown).
  for (const e of state.entities) {
    if (isParty(e) && e.alive && !e.current && e.queued) {
      promoteQueued(state, e);
    }
  }

  // 3b. Idle attackers with nothing banked swing automatically.
  startAutoAttacks(state);

  // 3c. Keep the enemy busy (it never idles while the party lives).
  const en = enemy(state);
  if (en && en.alive && !en.current && livingParty(state).length > 0) {
    startEnemyAction(state);
  }

  // 4. Enrage when the enemy drops below the threshold. The current cast finishes
  // as-is; the next action uses the enraged stats.
  if (
    en &&
    en.alive &&
    !en.enraged &&
    en.hp <= en.maxHp * CONFIG.enemy.enrage.hpFraction
  ) {
    en.enraged = true;
    state.events.push({ kind: "enrage", entityId: en.id, at: state.elapsedTime });
  }

  // 5. Clean up: dead casters drop their action/queue; clear a stale armed spell.
  for (const e of state.entities) {
    if (!e.alive) {
      e.current = undefined;
      e.queued = undefined;
    }
  }
  if (state.armedSpellId) {
    const h = state.entities.find((e) => e.kind === "healer");
    if (!h || !h.alive) state.armedSpellId = undefined;
  }

  // 6. Win/lose. You lose if the party is wiped OR no damage dealer remains: the
  // healer alone can't kill the enemy, so the fight is unwinnable -> a loss.
  if (en && !en.alive) {
    state.phase = "won";
  } else {
    const living = livingParty(state);
    const canStillWin = living.some((e) => e.kind === "tank" || isDPS(e));
    if (living.length === 0 || !canStillWin) state.phase = "lost";
  }

  // 7. Drop events the UI is done animating.
  state.events = state.events.filter(
    (ev) => ev.at > state.elapsedTime - EVENT_TTL,
  );
}
