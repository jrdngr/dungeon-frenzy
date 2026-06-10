// Pure effect resolution. These functions mutate entity HP/HoT/shield state
// and record events/stats, but have no knowledge of rendering or input.

import { hexDistance, hexEquals, inDisk } from "./hex";
import type { ActionDef, Entity, GameState, Hex, HotInstance } from "./types";
import { isParty } from "./types";

export function findEntity(state: GameState, id: string): Entity | undefined {
  return state.entities.find((e) => e.id === id);
}

/** The living entity standing on `hex`, if any. Corpses don't block. */
export function occupant(state: GameState, hex: Hex): Entity | undefined {
  return state.entities.find((e) => e.alive && hexEquals(e.hex, hex));
}

/** Can this entity legally step onto `hex` right now? */
export function canMoveTo(state: GameState, mover: Entity, hex: Hex): boolean {
  return (
    inDisk(hex, state.mapRadius) &&
    hexDistance(mover.hex, hex) === 1 &&
    occupant(state, hex) === undefined
  );
}

/** Is `target` within `def`'s range of `caster`? Unlimited if no range set. */
export function inRange(caster: Entity, def: ActionDef, target: Entity): boolean {
  return def.range === undefined || hexDistance(caster.hex, target.hex) <= def.range;
}

export function fighters(state: GameState): Entity[] {
  return state.entities.filter((e) => e.kind === "fighter");
}

export function livingParty(state: GameState): Entity[] {
  return state.entities.filter((e) => isParty(e) && e.alive);
}

export function enemy(state: GameState): Entity | undefined {
  return state.entities.find((e) => e.kind === "enemy");
}

export function applyDamage(
  state: GameState,
  target: Entity,
  amount: number,
): void {
  if (!target.alive) return;

  // A shield (Brace) eats up to its amount from this one hit, then is spent.
  let blocked = 0;
  if (target.shield) {
    blocked = Math.min(target.shield.amount, amount);
    amount -= blocked;
    target.shield = undefined;
    state.stats.damageBlocked += blocked;
  }

  const before = target.hp;
  target.hp = Math.max(0, target.hp - amount);
  const dealt = before - target.hp;

  if (isParty(target)) state.stats.damageTaken += dealt;
  else state.stats.damageDealt += dealt;

  state.events.push({
    kind: "damage",
    entityId: target.id,
    amount: dealt,
    blocked,
    at: state.elapsedTime,
  });

  if (target.hp === 0) {
    target.alive = false;
    if (isParty(target)) state.stats.deaths += 1;
  }
}

export function applyHeal(
  state: GameState,
  target: Entity,
  amount: number,
): void {
  if (!target.alive) return;
  const before = target.hp;
  target.hp = Math.min(target.maxHp, target.hp + amount);
  const healed = target.hp - before;

  state.stats.healingDone += healed;
  state.stats.overhealing += amount - healed;

  if (healed > 0) {
    state.events.push({
      kind: "heal",
      entityId: target.id,
      amount: healed,
      at: state.elapsedTime,
    });
  }
}

export function applyHot(target: Entity, hot: HotInstance): void {
  if (!target.alive) return;
  // Refresh: a re-applied HoT replaces any existing one rather than stacking.
  target.hots = [{ ...hot }];
}

export function applyShield(
  state: GameState,
  target: Entity,
  amount: number,
  duration: number,
): void {
  if (!target.alive) return;
  target.shield = { amount, remaining: duration };
  state.events.push({
    kind: "shield",
    entityId: target.id,
    amount,
    at: state.elapsedTime,
  });
}

/** Advance every living entity's HoTs by dt, applying ticks as they come due. */
export function tickHots(state: GameState, dt: number): void {
  for (const e of state.entities) {
    if (!e.alive || e.hots.length === 0) continue;
    for (const hot of e.hots) {
      hot.duration -= dt;
      hot.sinceTick += dt;
      while (hot.sinceTick >= hot.interval && hot.duration > -hot.interval) {
        applyHeal(state, e, hot.perTick);
        hot.sinceTick -= hot.interval;
      }
    }
    e.hots = e.hots.filter((h) => h.duration > 0);
  }
}
