// Pure effect resolution. These functions mutate entity HP/HoT state and record
// events/stats, but have no knowledge of rendering or input.

import type { Entity, GameState, HotInstance } from "./types";
import { isDPS, isParty } from "./types";

export function findEntity(state: GameState, id: string): Entity | undefined {
  return state.entities.find((e) => e.id === id);
}

/** Party members that auto-attack the enemy (everyone but the healer). */
export function autoAttackers(state: GameState): Entity[] {
  return state.entities.filter(
    (e) => e.kind === "tank" || e.kind === "ranger" || e.kind === "mage",
  );
}

export function livingParty(state: GameState): Entity[] {
  return state.entities.filter((e) => isParty(e) && e.alive);
}

export function enemy(state: GameState): Entity | undefined {
  return state.entities.find((e) => e.kind === "enemy");
}

/** The living party member the enemy targets first: tank, then a damage dealer,
 * then the healer. Used for single-target Claws and as the line attack's
 * primary victim. */
export function frontmostLiving(state: GameState): Entity | undefined {
  const tank = state.entities.find((e) => e.kind === "tank" && e.alive);
  if (tank) return tank;
  const dps = state.entities.find((e) => isDPS(e) && e.alive);
  if (dps) return dps;
  return state.entities.find((e) => e.kind === "healer" && e.alive);
}

export function applyDamage(
  state: GameState,
  target: Entity,
  amount: number,
): void {
  if (!target.alive) return;

  const before = target.hp;
  target.hp = Math.max(0, target.hp - amount);
  const dealt = before - target.hp;

  if (isParty(target)) state.stats.damageTaken += dealt;
  else state.stats.damageDealt += dealt;

  state.events.push({
    kind: "damage",
    entityId: target.id,
    amount: dealt,
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
