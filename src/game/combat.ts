// Pure effect resolution. These functions mutate entity HP/HoT state but have
// no knowledge of rendering or input.

import type { Entity, GameState, HotInstance } from "./types";
import { isParty } from "./types";

export function findEntity(state: GameState, id: string): Entity | undefined {
  return state.entities.find((e) => e.id === id);
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

export function applyDamage(target: Entity, amount: number): void {
  if (!target.alive) return;
  target.hp = Math.max(0, target.hp - amount);
  if (target.hp === 0) target.alive = false;
}

export function applyHeal(target: Entity, amount: number): void {
  if (!target.alive) return;
  target.hp = Math.min(target.maxHp, target.hp + amount);
}

export function applyHot(target: Entity, hot: HotInstance): void {
  if (!target.alive) return;
  // Refresh: a re-applied HoT replaces any existing one rather than stacking.
  target.hots = [{ ...hot }];
}

/** Advance every living entity's HoTs by dt, applying ticks as they come due. */
export function tickHots(state: GameState, dt: number): void {
  for (const e of state.entities) {
    if (!e.alive || e.hots.length === 0) continue;
    for (const hot of e.hots) {
      hot.duration -= dt;
      hot.sinceTick += dt;
      while (hot.sinceTick >= hot.interval && hot.duration > -hot.interval) {
        applyHeal(e, hot.perTick);
        hot.sinceTick -= hot.interval;
      }
    }
    e.hots = e.hots.filter((h) => h.duration > 0);
  }
}
