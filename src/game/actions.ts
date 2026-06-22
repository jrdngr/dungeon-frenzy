// Static action definitions built from CONFIG. These are immutable data;
// an entity casting one wraps it in an ActionInstance.

import { CONFIG } from "./config";
import type { ActionDef, AutoAttackerKind } from "./types";

const c = CONFIG;

// --- Party auto-attacks (tank / ranger / mage) ---
// Not on any action bar: idle attackers cast their own swing automatically at the
// party's focused enemy (see engine.ts). The player controls only the healer.

export const TANK_ATTACK: ActionDef = {
  id: "tank-attack",
  name: "Strike",
  castTime: c.tank.attack.castTime,
  targeting: "enemy",
  effect: { kind: "damage", amount: c.tank.attack.damage },
};

export const RANGER_ATTACK: ActionDef = {
  id: "ranger-attack",
  name: "Shoot",
  castTime: c.ranger.attack.castTime,
  targeting: "enemy",
  effect: { kind: "damage", amount: c.ranger.attack.damage },
};

export const MAGE_ATTACK: ActionDef = {
  id: "mage-attack",
  name: "Bolt",
  castTime: c.mage.attack.castTime,
  targeting: "enemy",
  effect: { kind: "damage", amount: c.mage.attack.damage },
};

/** The auto-attack for a given attacker kind, with skill-derived damage (the base
 * defs supply id/name/castTime; Heavy Strikes / Deadeye / Arcane Power raise dmg). */
export function autoAttackFor(kind: AutoAttackerKind, damage: number): ActionDef {
  switch (kind) {
    case "tank":
      return { ...TANK_ATTACK, effect: { kind: "damage", amount: damage } };
    case "ranger":
      return { ...RANGER_ATTACK, effect: { kind: "damage", amount: damage } };
    case "mage":
      return { ...MAGE_ATTACK, effect: { kind: "damage", amount: damage } };
  }
}

// --- Healer spells (the player's whole kit) ---
// Each has a post-cast cooldown (except Fast Heal) so the efficient heals can't
// be spammed; a healing rotation emerges from sequencing them.

export const FAST_HEAL: ActionDef = {
  id: "fast-heal",
  name: "Fast Heal",
  castTime: c.healer.fastHeal.castTime,
  cooldown: c.healer.fastHeal.cooldown,
  manaCost: c.healer.fastHeal.mana,
  targeting: "ally-single",
  effect: { kind: "heal", amount: c.healer.fastHeal.heal },
};

export const SLOW_HEAL: ActionDef = {
  id: "slow-heal",
  name: "Slow Heal",
  castTime: c.healer.slowHeal.castTime,
  cooldown: c.healer.slowHeal.cooldown,
  manaCost: c.healer.slowHeal.mana,
  targeting: "ally-single",
  effect: { kind: "heal", amount: c.healer.slowHeal.heal },
};

export const RENEW: ActionDef = {
  id: "renew",
  name: "Renew",
  castTime: c.healer.hot.castTime,
  cooldown: c.healer.hot.cooldown,
  manaCost: c.healer.hot.mana,
  targeting: "ally-single",
  effect: {
    kind: "hot",
    perTick: c.healer.hot.perTick,
    interval: c.healer.hot.interval,
    duration: c.healer.hot.duration,
  },
};

export const AOE_HEAL: ActionDef = {
  id: "aoe-heal",
  name: "Group Heal",
  castTime: c.healer.aoeHeal.castTime,
  cooldown: c.healer.aoeHeal.cooldown,
  manaCost: c.healer.aoeHeal.mana,
  targeting: "party-all", // heals everyone, but still needs a target click
  effect: { kind: "aoe-heal", amount: c.healer.aoeHeal.heal },
};

/** The healer's action bar, in display / hotkey (Q W E R) order. */
export const HEALER_ACTIONS: ActionDef[] = [FAST_HEAL, SLOW_HEAL, RENEW, AOE_HEAL];

// --- Enemy attack profiles (built per archetype from CONFIG.enemyTypes) ---
// Each enemy entity carries an `enemyType` id; the engine looks up its profile to
// pick the next attack from its rotation (enraged variants when frenzied).

export interface EnemyTypeActions {
  id: string;
  name: string;
  isBoss: boolean;
  maxHp: number;
  /** Skill points granted to the player when this enemy is killed. */
  sp: number;
  rotation: string[];
  /** Attack key -> ActionDef. `enraged` is empty unless the type enrages. */
  normal: Record<string, ActionDef>;
  enraged: Record<string, ActionDef>;
  enrage?: { hpFraction: number; damageScale: number; castScale: number };
}

/** Build one enemy attack ActionDef from a config attack entry, scaling damage/
 * cast for the enraged variant. `params` is the raw config object for that key. */
function makeEnemyAttack(
  typeId: string,
  key: string,
  params: any,
  dmgScale: number,
  castScale: number,
  suffix: string,
): ActionDef {
  const id = `${typeId}-${key}${suffix}`;
  const castTime = params.castTime * castScale;
  switch (key) {
    case "claw":
      return { id, name: "Claw", castTime, targeting: "ally-single", effect: { kind: "damage", amount: params.damage * dmgScale } };
    case "shot":
      return { id, name: "Snipe", castTime, targeting: "ally-backline", effect: { kind: "damage", amount: params.damage * dmgScale } };
    case "smash":
      return { id, name: "Heavy Smash", castTime, targeting: "ally-single", effect: { kind: "damage", amount: params.damage * dmgScale } };
    case "line":
      return { id, name: "Cleave", castTime, targeting: "line", effect: { kind: "line-damage", amount: params.damage * dmgScale, count: 2 } };
    case "cleave":
      return { id, name: "Wide Cleave", castTime, targeting: "line", effect: { kind: "line-damage", amount: params.damage * dmgScale, count: 3 } };
    case "aoe":
      return { id, name: "Roar", castTime, targeting: "party-all", effect: { kind: "aoe-damage", amount: params.damage * dmgScale } };
    case "curse":
      return { id, name: "Curse", castTime, targeting: "ally-backline", effect: { kind: "dot", perTick: params.perTick * dmgScale, interval: params.interval, duration: params.duration } };
    default:
      throw new Error(`unknown enemy attack "${key}"`);
  }
}

function buildEnemyType(id: string, def: any): EnemyTypeActions {
  const normal: Record<string, ActionDef> = {};
  const enraged: Record<string, ActionDef> = {};
  for (const [key, params] of Object.entries(def.attacks)) {
    normal[key] = makeEnemyAttack(id, key, params, 1, 1, "");
    if (def.enrage) {
      enraged[key] = makeEnemyAttack(id, key, params, def.enrage.damageScale, def.enrage.castScale, "-enraged");
    }
  }
  return {
    id,
    name: def.name,
    isBoss: !!def.isBoss,
    maxHp: def.maxHp,
    sp: def.sp,
    rotation: [...def.rotation],
    normal,
    enraged,
    enrage: def.enrage,
  };
}

/** Built attack profiles for every enemy archetype, keyed by type id. */
export const ENEMY_TYPES: Record<string, EnemyTypeActions> = Object.fromEntries(
  Object.entries(CONFIG.enemyTypes).map(([id, def]) => [id, buildEnemyType(id, def)]),
);

export function enemyType(id: string): EnemyTypeActions {
  const t = ENEMY_TYPES[id];
  if (!t) throw new Error(`unknown enemy type "${id}"`);
  return t;
}

/** Whether an archetype id is a boss (drives token size + rotation pips). */
export function isBossType(id: string | undefined): boolean {
  return !!id && !!ENEMY_TYPES[id]?.isBoss;
}
