// The simulation. update(state, dt) drives everything; no canvas/DOM here.

import { CONFIG } from "./config";
import {
  ENEMY_AOE,
  ENEMY_AOE_ENRAGED,
  ENEMY_BASIC,
  ENEMY_BASIC_ENRAGED,
} from "./actions";
import {
  applyDamage,
  applyHeal,
  applyHot,
  applyShield,
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

/** How long finished events are kept around for the UI to animate. */
const EVENT_TTL = 3.0;

/** Build a fresh battle: 2 fighters + 1 healer vs 1 enemy, fixed positions.
 * Layout (axial, pointy-top): enemy in front (top), fighters side by side,
 * healer behind (bottom). */
export function createInitialState(): GameState {
  const entities: Entity[] = [
    makeEntity("enemy", "enemy", "Ogre", CONFIG.enemy.maxHp, 0, {
      q: 1,
      r: -1,
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
      { q: 0, r: 1 },
    ),
  ];

  const state: GameState = {
    entities,
    phase: "playing",
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

/** Begin an action on an entity, replacing whatever it was doing.
 * Mana is checked here but only spent when the cast completes, so replacing
 * a cast (or a mis-click) never wastes mana. */
export function startAction(
  state: GameState,
  casterId: string,
  def: ActionDef,
  targetId?: string,
): void {
  const caster = findEntity(state, casterId);
  if (!caster || !caster.alive) return;
  if (def.manaCost !== undefined && caster.mana < def.manaCost) return;
  caster.current = { def, elapsed: 0, targetId };
}

function startEnemyAction(state: GameState): void {
  const e = enemy(state);
  if (!e || !e.alive) return;
  const basic = e.enraged ? ENEMY_BASIC_ENRAGED : ENEMY_BASIC;
  const aoe = e.enraged ? ENEMY_AOE_ENRAGED : ENEMY_AOE;
  const useAoe =
    (e.actionCount + 1) % CONFIG.enemy.aoeEveryNthAction === 0;
  if (useAoe) {
    startAction(state, e.id, aoe);
  } else {
    // Basic attack picks a random living party member as its target now.
    const targets = livingParty(state);
    if (targets.length === 0) return;
    const target = targets[Math.floor(Math.random() * targets.length)];
    startAction(state, e.id, basic, target.id);
  }
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
        if (f.alive) applyHeal(state, f, def.effect.amount);
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

/** Advance the whole simulation by dt seconds. */
export function update(state: GameState, dt: number): void {
  if (state.phase !== "playing") return;

  state.elapsedTime += dt;

  // 1. Resources and timed effects.
  for (const e of state.entities) {
    if (e.alive && e.maxMana > 0) {
      e.mana = Math.min(e.maxMana, e.mana + CONFIG.healer.manaRegen * dt);
    }
    if (e.shield) {
      e.shield.remaining -= dt;
      if (e.shield.remaining <= 0) e.shield = undefined;
    }
  }
  tickHots(state, dt);

  // 2. Idle tracking (the player's core job is noticing these).
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
        // Enemy never idles — immediately queue the next action.
        if (e.alive) startEnemyAction(state);
      }
    }
  }

  // 4. Enrage when the enemy drops below the threshold. The current cast
  // finishes as-is; the next action uses the enraged stats.
  const en = enemy(state);
  if (
    en &&
    en.alive &&
    !en.enraged &&
    en.hp <= en.maxHp * CONFIG.enemy.enrage.hpFraction
  ) {
    en.enraged = true;
    state.events.push({ kind: "enrage", entityId: en.id, at: state.elapsedTime });
  }

  // 5. Clean up: dead casters drop their action; clear stale selection.
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
