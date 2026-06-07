// The simulation. update(state, dt) drives everything; no canvas/DOM here.

import { CONFIG } from "./config";
import { ENEMY_AOE, ENEMY_BASIC } from "./actions";
import {
  applyDamage,
  applyHeal,
  applyHot,
  enemy,
  fighters,
  findEntity,
  livingParty,
  tickHots,
} from "./combat";
import type {
  ActionDef,
  Entity,
  GameState,
  HotInstance,
} from "./types";
import { isParty } from "./types";

/** Build a fresh battle: 2 fighters + 1 healer vs 1 enemy, fixed positions.
 * Layout (axial, pointy-top): enemy in front (top), fighters side by side,
 * healer behind (bottom). */
export function createInitialState(): GameState {
  const entities: Entity[] = [
    makeEntity("enemy", "enemy", "Ogre", CONFIG.enemy.maxHp, { q: 1, r: -1 }),
    makeEntity("fighter-a", "fighter", "Fighter A", CONFIG.fighter.maxHp, {
      q: 0,
      r: 0,
    }),
    makeEntity("fighter-b", "fighter", "Fighter B", CONFIG.fighter.maxHp, {
      q: 1,
      r: 0,
    }),
    makeEntity("healer", "healer", "Healer", CONFIG.healer.maxHp, {
      q: 0,
      r: 1,
    }),
  ];

  const state: GameState = {
    entities,
    phase: "playing",
    elapsedTime: 0,
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
  hex: Entity["hex"],
): Entity {
  return {
    id,
    name,
    kind,
    hp: maxHp,
    maxHp,
    hex,
    hots: [],
    alive: true,
    actionCount: 0,
  };
}

/** Begin an action on an entity, replacing whatever it was doing. */
export function startAction(
  state: GameState,
  casterId: string,
  def: ActionDef,
  targetId?: string,
): void {
  const caster = findEntity(state, casterId);
  if (!caster || !caster.alive) return;
  caster.current = { def, elapsed: 0, targetId };
}

function startEnemyAction(state: GameState): void {
  const e = enemy(state);
  if (!e || !e.alive) return;
  const useAoe =
    (e.actionCount + 1) % CONFIG.enemy.aoeEveryNthAction === 0;
  if (useAoe) {
    startAction(state, e.id, ENEMY_AOE);
  } else {
    // Basic attack picks a random living party member as its target now.
    const targets = livingParty(state);
    if (targets.length === 0) return;
    const target = targets[Math.floor(Math.random() * targets.length)];
    startAction(state, e.id, ENEMY_BASIC, target.id);
  }
}

/** Resolve a completed action's effect. */
function resolveAction(state: GameState, caster: Entity): void {
  const inst = caster.current;
  if (!inst) return;
  const { def } = inst;

  switch (def.effect.kind) {
    case "damage": {
      const target = inst.targetId
        ? findEntity(state, inst.targetId)
        : enemy(state);
      // Fighter attacks always hit the enemy if no explicit target.
      const finalTarget = target ?? enemy(state);
      if (finalTarget && finalTarget.alive) {
        applyDamage(finalTarget, def.effect.amount);
      }
      break;
    }
    case "heal": {
      const target = inst.targetId
        ? findEntity(state, inst.targetId)
        : undefined;
      if (target && target.alive) applyHeal(target, def.effect.amount);
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
        if (f.alive) applyHeal(f, def.effect.amount);
      }
      break;
    }
    case "aoe-damage": {
      for (const p of livingParty(state)) {
        applyDamage(p, def.effect.amount);
      }
      break;
    }
  }
}

/** Advance the whole simulation by dt seconds. */
export function update(state: GameState, dt: number): void {
  if (state.phase !== "playing") return;

  state.elapsedTime += dt;

  // 1. Heal-over-time ticks.
  tickHots(state, dt);

  // 2. Advance casts and resolve completed ones.
  for (const e of state.entities) {
    if (!e.alive || !e.current) continue;
    e.current.elapsed += dt;
    if (e.current.elapsed >= e.current.def.castTime) {
      resolveAction(state, e);
      e.current = undefined;
      if (e.kind === "enemy") {
        e.actionCount += 1;
        // Enemy never idles — immediately queue the next action.
        if (e.alive) startEnemyAction(state);
      }
    }
  }

  // 3. Clean up: dead casters drop their action; clear stale selection.
  for (const e of state.entities) {
    if (!e.alive && e.current) e.current = undefined;
  }
  if (state.selectedId) {
    const sel = findEntity(state, state.selectedId);
    if (!sel || !sel.alive) {
      state.selectedId = undefined;
      state.pendingActionId = undefined;
    }
  }

  // 4. Win/lose.
  const e = enemy(state);
  if (e && !e.alive) {
    state.phase = "won";
  } else if (livingParty(state).length === 0) {
    state.phase = "lost";
  }
}

export function isPartyMember(e: Entity): boolean {
  return isParty(e);
}
