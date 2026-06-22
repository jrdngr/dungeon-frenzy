// Pure effect resolution. These functions mutate entity HP/HoT state and record
// events/stats, but have no knowledge of rendering or input.

import type { AutoAttackerKind, Entity, GameState, HotInstance } from "./types";
import { isAutoAttacker, isDPS, isParty } from "./types";

export function findEntity(state: GameState, id: string): Entity | undefined {
  return state.entities.find((e) => e.id === id);
}

/** Party members that auto-attack the enemy (everyone but the healer). */
export function autoAttackers(
  state: GameState,
): (Entity & { kind: AutoAttackerKind })[] {
  return state.entities.filter(isAutoAttacker);
}

export function livingParty(state: GameState): Entity[] {
  return state.entities.filter((e) => isParty(e) && e.alive);
}

export function enemy(state: GameState): Entity | undefined {
  return state.entities.find((e) => e.kind === "enemy");
}

/** The enemy's target-priority skeleton: the tank, then a living damage dealer
 * chosen by `pickDps`, then the healer. The picker is the only thing that varies
 * — frontmostLiving picks the first DPS deterministically (Line primary / a
 * resolve-time fallback), while the Claw victim is a *random* DPS (clawTargetId
 * in engine.ts). Keep those pickers distinct; the divergence is intentional. */
export function enemyTargetPriority(
  state: GameState,
  pickDps: (dps: Entity[]) => Entity | undefined,
): Entity | undefined {
  const tank = state.entities.find((e) => e.kind === "tank" && e.alive);
  if (tank) return tank;
  const dps = state.entities.filter((e) => isDPS(e) && e.alive);
  if (dps.length > 0) {
    const chosen = pickDps(dps);
    if (chosen) return chosen;
  }
  return state.entities.find((e) => e.kind === "healer" && e.alive);
}

/** The living party member the enemy targets first: tank, then the first living
 * damage dealer, then the healer. Used for the line attack's primary victim and
 * as a resolve-time fallback. */
export function frontmostLiving(state: GameState): Entity | undefined {
  return enemyTargetPriority(state, (dps) => dps[0]);
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

  if (!isParty(target)) state.stats.damageDealt += dealt;

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

/** Advance every living entity's HoTs by dt, applying ticks as they come due.
 * Assumes callers step with dt below the smallest HoT interval (main.ts clamps
 * to 0.1s, the sim harness uses 0.05s); a single dt larger than the interval
 * would drop the ticks it skipped over. */
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
