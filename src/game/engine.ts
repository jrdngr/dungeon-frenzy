// The simulation. update(state, dt) drives everything; no canvas/DOM here.

import { CONFIG } from "./config";
import {
  ENEMY_AOE,
  ENEMY_AOE_ENRAGED,
  ENEMY_BASIC,
  ENEMY_BASIC_ENRAGED,
  MOVE_ENEMY,
} from "./actions";
import {
  applyDamage,
  applyHeal,
  applyHot,
  applyShield,
  canMoveTo,
  enemy,
  fighters,
  findEntity,
  inRange,
  livingParty,
  tickHots,
} from "./combat";
import { hexDistance, hexNeighbors } from "./hex";
import type {
  ActionDef,
  Entity,
  GameState,
  Hex,
  HotInstance,
} from "./types";
import { isParty } from "./types";

/** How long finished events are kept around for the UI to animate. */
const EVENT_TTL = 3.0;

/** Build a fresh battle on a hex-disk battlefield: the party holds one side,
 * the enemy starts across the field and walks in. Fighters begin between the
 * enemy and the healer — the wall the player is meant to maintain. */
export function createInitialState(): GameState {
  const entities: Entity[] = [
    makeEntity("enemy", "enemy", "Ogre", CONFIG.enemy.maxHp, 0, {
      q: 2,
      r: -3,
    }),
    makeEntity("fighter-a", "fighter", "Fighter A", CONFIG.fighter.maxHp, 0, {
      q: 0,
      r: 0,
    }),
    makeEntity("fighter-b", "fighter", "Fighter B", CONFIG.fighter.maxHp, 0, {
      q: 1,
      r: 0,
    }),
    makeEntity(
      "healer",
      "healer",
      "Healer",
      CONFIG.healer.maxHp,
      CONFIG.healer.maxMana,
      { q: 0, r: 2 },
    ),
  ];

  const state: GameState = {
    entities,
    mapRadius: CONFIG.map.radius,
    phase: "playing",
    timeScale: 1,
    elapsedTime: 0,
    events: [],
    stats: {
      damageDealt: 0,
      damageTaken: 0,
      healingDone: 0,
      overhealing: 0,
      damageBlocked: 0,
      idleSeconds: 0,
      deaths: 0,
      ordersDropped: 0,
    },
  };

  // The enemy starts acting immediately; the party waits for the player.
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
    alive: true,
    idleFor: 0,
    actionCount: 0,
    enraged: false,
  };
}

/** Full legality check for an order: mana, move destination, target range.
 * Used both when starting an action and when promoting a queued one. */
function validateOrder(
  state: GameState,
  caster: Entity,
  def: ActionDef,
  targetId?: string,
  targetHex?: Hex,
): boolean {
  if (!caster.alive) return false;
  if (def.manaCost !== undefined && caster.mana < def.manaCost) return false;

  if (def.effect.kind === "move") {
    return targetHex !== undefined && canMoveTo(state, caster, targetHex);
  }

  const target = targetId
    ? findEntity(state, targetId)
    : def.targeting === "enemy"
      ? enemy(state)
      : undefined;
  if (targetId && (!target || !target.alive)) return false;
  if (target && !inRange(caster, def, target)) return false;
  return true;
}

/** Begin an action on an entity, replacing whatever it was doing. Validates
 * mana, range, and move legality so an illegal order is simply ignored.
 * Mana is checked here but only spent when the cast completes, so replacing
 * a cast (or a mis-click) never wastes mana. */
export function startAction(
  state: GameState,
  casterId: string,
  def: ActionDef,
  targetId?: string,
  targetHex?: Hex,
): void {
  const caster = findEntity(state, casterId);
  if (!caster) return;
  if (!validateOrder(state, caster, def, targetId, targetHex)) return;

  if (def.effect.kind === "move") {
    caster.current = { def, elapsed: 0, targetHex };
    return;
  }
  // Fighter attacks resolve their implied target now.
  const target = targetId
    ? findEntity(state, targetId)
    : def.targeting === "enemy"
      ? enemy(state)
      : undefined;
  caster.current = { def, elapsed: 0, targetId: target?.id ?? targetId };
}

/** Bank an order to auto-start when the current cast ends. Deliberately
 * lenient (alive caster is enough): legality is re-checked at promotion so
 * the player may queue a heal they can't afford *yet*. */
export function queueAction(
  state: GameState,
  casterId: string,
  def: ActionDef,
  targetId?: string,
  targetHex?: Hex,
): void {
  const caster = findEntity(state, casterId);
  if (!caster || !caster.alive) return;
  caster.queued = { def, elapsed: 0, targetId, targetHex };
}

/** The single entry point for player/bot orders: starts immediately when the
 * unit is idle, otherwise banks the order in the one queued slot. */
export function issueOrder(
  state: GameState,
  casterId: string,
  def: ActionDef,
  targetId?: string,
  targetHex?: Hex,
): void {
  const caster = findEntity(state, casterId);
  if (!caster || !caster.alive) return;
  if (caster.current) queueAction(state, casterId, def, targetId, targetHex);
  else startAction(state, casterId, def, targetId, targetHex);
}

/** Abort the current cast (free — mana is only spent on completion). Any
 * queued order starts immediately: the emergency "stop and Brace" play. */
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

/** Try to start the queued order now that the unit is idle. If it has become
 * illegal (target died, mana spent, hex taken) it is dropped *loudly* — a
 * silently lost order is the worst failure mode of a queue. */
function promoteQueued(state: GameState, e: Entity): void {
  if (!e.queued || e.current || !e.alive) return;
  const q = e.queued;
  e.queued = undefined;
  startAction(state, e.id, q.def, q.targetId, q.targetHex);
  if (!e.current) {
    state.stats.ordersDropped += 1;
    state.events.push({
      kind: "queue-dropped",
      entityId: e.id,
      actionName: q.def.name,
      at: state.elapsedTime,
    });
  }
}

/** Enemy decision-making:
 * 1. Every Nth combat action is the (global, telegraphed) Roar.
 * 2. Otherwise Claw a random adjacent party member — adjacency is what makes
 *    body-blocking work: the enemy never walks past someone in its face.
 * 3. Nothing adjacent: lumber one hex toward the nearest party member.
 */
function startEnemyAction(state: GameState): void {
  const e = enemy(state);
  if (!e || !e.alive) return;
  const party = livingParty(state);
  if (party.length === 0) return;

  const basic = e.enraged ? ENEMY_BASIC_ENRAGED : ENEMY_BASIC;
  const aoe = e.enraged ? ENEMY_AOE_ENRAGED : ENEMY_AOE;

  const roarDue =
    (e.actionCount + 1) % CONFIG.enemy.aoeEveryNthAction === 0;
  if (roarDue) {
    startAction(state, e.id, aoe);
    return;
  }

  const adjacent = party.filter(
    (p) => hexDistance(p.hex, e.hex) <= (basic.range ?? 1),
  );
  if (adjacent.length > 0) {
    const target = adjacent[Math.floor(Math.random() * adjacent.length)];
    startAction(state, e.id, basic, target.id);
    return;
  }

  // Walk toward the nearest living party member.
  let nearest = party[0];
  for (const p of party) {
    if (hexDistance(p.hex, e.hex) < hexDistance(nearest.hex, e.hex)) nearest = p;
  }
  const options = hexNeighbors(e.hex).filter((h) => canMoveTo(state, e, h));
  if (options.length === 0) return; // boxed in: retried next update
  const currentDist = hexDistance(e.hex, nearest.hex);
  let best = options.filter((h) => hexDistance(h, nearest.hex) < currentDist);
  if (best.length === 0) {
    // Can't get closer (blocked): sidestep along equal distance if possible.
    best = options.filter((h) => hexDistance(h, nearest.hex) === currentDist);
  }
  if (best.length === 0) return;
  const dest = best[Math.floor(Math.random() * best.length)];
  startAction(state, e.id, MOVE_ENEMY, undefined, dest);
}

/** Resolve a completed action's effect. */
function resolveAction(state: GameState, caster: Entity): void {
  const inst = caster.current;
  if (!inst) return;
  const { def } = inst;

  if (def.manaCost !== undefined) {
    caster.mana = Math.max(0, caster.mana - def.manaCost);
  }

  switch (def.effect.kind) {
    case "move": {
      // Re-check at arrival: someone may have stepped in during the cast.
      if (inst.targetHex && canMoveTo(state, caster, inst.targetHex)) {
        caster.hex = inst.targetHex;
      }
      break;
    }
    case "damage": {
      const target = inst.targetId
        ? findEntity(state, inst.targetId)
        : enemy(state);
      // Fighter attacks always hit the enemy if no explicit target.
      const finalTarget = target ?? enemy(state);
      if (finalTarget && finalTarget.alive) {
        applyDamage(state, finalTarget, def.effect.amount);
      }
      break;
    }
    case "heal": {
      const target = inst.targetId
        ? findEntity(state, inst.targetId)
        : undefined;
      if (target && target.alive) applyHeal(state, target, def.effect.amount);
      break;
    }
    case "hot": {
      const target = inst.targetId
        ? findEntity(state, inst.targetId)
        : undefined;
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
      for (const f of fighters(state)) {
        if (f.alive && inRange(caster, def, f)) {
          applyHeal(state, f, def.effect.amount);
        }
      }
      break;
    }
    case "aoe-damage": {
      for (const p of livingParty(state)) {
        applyDamage(state, p, def.effect.amount);
      }
      break;
    }
    case "shield": {
      applyShield(state, caster, def.effect.amount, def.effect.duration);
      break;
    }
  }
}

/** True while the tactical pause should hold the sim: the player has a
 * living, *idle* party member selected, i.e. they are choosing its order. */
function tacticalPauseActive(state: GameState): boolean {
  if (!state.selectedId) return false;
  const sel = findEntity(state, state.selectedId);
  return !!sel && isParty(sel) && sel.alive && !sel.current;
}

/** Advance the whole simulation by dt *real* seconds. The tactical pause may
 * dilate the sim clock; everything below step 0 runs on game time. */
export function update(state: GameState, dt: number): void {
  if (state.phase !== "playing") return;

  // 0. Tactical pause: ease the clock to a stop while an idle unit is
  // selected, and back to full speed once it has orders or is deselected.
  // The easing itself runs on real time so the ramp feels the same at any
  // sim speed.
  const t = CONFIG.time;
  const target = tacticalPauseActive(state) ? t.pausedScale : 1;
  const span = 1 - t.pausedScale; // full ramp distance
  if (state.timeScale > target) {
    state.timeScale = Math.max(
      target,
      state.timeScale - (span / t.rampDownSeconds) * dt,
    );
  } else if (state.timeScale < target) {
    state.timeScale = Math.min(
      target,
      state.timeScale + (span / t.rampUpSeconds) * dt,
    );
  }
  const sdt = dt * state.timeScale; // dilated game-time step

  state.elapsedTime += sdt;

  // 1. Resources and timed effects.
  for (const e of state.entities) {
    if (e.alive && e.maxMana > 0) {
      e.mana = Math.min(e.maxMana, e.mana + CONFIG.healer.manaRegen * sdt);
    }
    if (e.shield) {
      e.shield.remaining -= sdt;
      if (e.shield.remaining <= 0) e.shield = undefined;
    }
  }
  tickHots(state, sdt);

  // 2. Idle tracking (the player's core job is noticing these).
  for (const e of state.entities) {
    if (isParty(e) && e.alive && !e.current) {
      e.idleFor += sdt;
      state.stats.idleSeconds += sdt;
    } else {
      e.idleFor = 0;
    }
  }

  // 3. Advance casts and resolve completed ones.
  for (const e of state.entities) {
    if (!e.alive || !e.current) continue;
    e.current.elapsed += sdt;
    if (e.current.elapsed >= e.current.def.castTime) {
      const wasMove = e.current.def.effect.kind === "move";
      resolveAction(state, e);
      e.current = undefined;
      if (e.kind === "enemy") {
        // Only combat actions advance the Roar schedule.
        if (!wasMove) e.actionCount += 1;
        // Enemy never idles — immediately queue the next action.
        if (e.alive) startEnemyAction(state);
      } else {
        // Party: a banked order starts now (validated against the world as
        // it is *after* this cast resolved and spent its mana).
        promoteQueued(state, e);
      }
    }
  }

  // 3a. Safety net: any idle party member with a banked order starts it.
  for (const e of state.entities) {
    if (isParty(e) && e.alive && !e.current && e.queued) {
      promoteQueued(state, e);
    }
  }

  // 3b. If the enemy is idle (e.g. it was boxed in last decision), retry.
  const en = enemy(state);
  if (en && en.alive && !en.current) startEnemyAction(state);

  // 4. Enrage when the enemy drops below the threshold. The current cast
  // finishes as-is; the next action uses the enraged stats.
  if (
    en &&
    en.alive &&
    !en.enraged &&
    en.hp <= en.maxHp * CONFIG.enemy.enrage.hpFraction
  ) {
    en.enraged = true;
    state.events.push({ kind: "enrage", entityId: en.id, at: state.elapsedTime });
  }

  // 5. Clean up: dead casters drop their action and queue; clear stale selection.
  for (const e of state.entities) {
    if (!e.alive) {
      if (e.current) e.current = undefined;
      if (e.queued) e.queued = undefined;
    }
  }
  if (state.selectedId) {
    const sel = findEntity(state, state.selectedId);
    if (!sel || !sel.alive) {
      state.selectedId = undefined;
      state.pendingActionId = undefined;
    }
  }

  // 6. Win/lose.
  if (en && !en.alive) {
    state.phase = "won";
  } else if (livingParty(state).length === 0) {
    state.phase = "lost";
  }

  // 7. Drop events the UI is done animating.
  state.events = state.events.filter(
    (ev) => ev.at > state.elapsedTime - EVENT_TTL,
  );
}

export function isPartyMember(e: Entity): boolean {
  return isParty(e);
}
