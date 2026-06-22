// Pure effect resolution. These functions mutate entity HP/HoT state and record
// events/stats, but have no knowledge of rendering or input.

import type { AutoAttackerKind, Entity, GameState, HotInstance } from "./types";
import { isAutoAttacker, isDPS, isParty } from "./types";
import { enemyType } from "./actions";
import { overhealShieldCap } from "./skills";

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

/** All living enemies. */
export function enemies(state: GameState): Entity[] {
  return state.entities.filter((e) => e.kind === "enemy" && e.alive);
}

/** Living enemies in the frontmost row (smallest `row` = closest to the party).
 * Only these are targetable by the party; back-row enemies are shielded until the
 * front row is cleared. */
export function frontRowEnemies(state: GameState): Entity[] {
  const living = enemies(state);
  if (living.length === 0) return [];
  const front = Math.min(...living.map((e) => e.row ?? 0));
  return living.filter((e) => (e.row ?? 0) === front);
}

/** The default focus target: the leftmost living front-row enemy. */
export function frontmostEnemy(state: GameState): Entity | undefined {
  const front = frontRowEnemies(state);
  if (front.length === 0) return undefined;
  return [...front].sort((a, b) => (a.col ?? 0) - (b.col ?? 0))[0];
}

/** The enemy the party is focus-firing, if it is still a living enemy. */
export function focusedEnemy(state: GameState): Entity | undefined {
  if (!state.focusedEnemyId) return undefined;
  const e = findEntity(state, state.focusedEnemyId);
  return e && e.alive && e.kind === "enemy" ? e : undefined;
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

/** Apply `amount` damage to a target, returning the HP actually removed (after any
 * absorb shield). Grants XP and marks death when an enemy is killed. */
export function applyDamage(
  state: GameState,
  target: Entity,
  amount: number,
): number {
  if (!target.alive) return 0;

  // Absorb shield (skill tree): a hit-block charge negates the whole hit; otherwise
  // the absorb pool soaks first. Either way HP only takes what's left.
  let incoming = amount;
  if (target.shield) {
    if (target.shield.hits > 0) {
      target.shield.hits -= 1;
      incoming = 0;
    } else if (target.shield.absorb > 0) {
      const soak = Math.min(incoming, target.shield.absorb);
      target.shield.absorb -= soak;
      incoming -= soak;
    }
  }

  const before = target.hp;
  target.hp = Math.max(0, target.hp - incoming);
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
    else state.totalXp += enemyType(target.enemyType!).xp;
  }
  return dealt;
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
  const overheal = amount - healed;
  state.stats.overhealing += overheal;

  // Overheal Shield (skill tree): spill overhealing into a capped absorb pool.
  const cap = overhealShieldCap(state.skills);
  if (overheal > 0 && cap > 0 && isParty(target)) {
    if (!target.shield) target.shield = { hits: 0, absorb: 0, absorbCap: cap };
    target.shield.absorbCap = cap;
    target.shield.absorb = Math.min(cap, target.shield.absorb + overheal);
  }

  if (healed > 0) {
    state.events.push({
      kind: "heal",
      entityId: target.id,
      amount: healed,
      at: state.elapsedTime,
    });
  }
}

/** Apply a HoT/DoT, refreshing any existing one *of the same hostility* (so a
 * beneficial Renew and a hostile Curse can ride a member at the same time). */
export function applyHot(target: Entity, hot: HotInstance): void {
  if (!target.alive) return;
  const hostile = !!hot.hostile;
  target.hots = [...target.hots.filter((h) => !!h.hostile !== hostile), { ...hot }];
}

/** Advance every living entity's HoTs/DoTs by dt, applying ticks as they come due.
 * Hostile ticks deal damage; friendly ticks heal. Assumes callers step with dt
 * below the smallest interval (main.ts clamps to 0.1s, the sim uses 0.05s); a
 * single dt larger than the interval would drop the ticks it skipped over. */
export function tickHots(state: GameState, dt: number): void {
  for (const e of state.entities) {
    if (!e.alive || e.hots.length === 0) continue;
    for (const hot of e.hots) {
      hot.duration -= dt;
      hot.sinceTick += dt;
      while (hot.sinceTick >= hot.interval && hot.duration > -hot.interval) {
        if (hot.hostile) applyDamage(state, e, hot.perTick);
        else applyHeal(state, e, hot.perTick);
        hot.sinceTick -= hot.interval;
        if (!e.alive) break; // a hostile tick may have killed it
      }
    }
    e.hots = e.hots.filter((h) => h.duration > 0);
  }
}
