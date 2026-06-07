// Static action definitions built from CONFIG. These are immutable data;
// an entity casting one wraps it in an ActionInstance.

import { CONFIG } from "./config";
import type { ActionDef } from "./types";

const c = CONFIG;

export const FIGHTER_ATTACK: ActionDef = {
  id: "fighter-attack",
  name: "Attack",
  castTime: c.fighter.attack.castTime,
  targeting: "enemy",
  effect: { kind: "damage", amount: c.fighter.attack.damage },
};

export const FAST_HEAL: ActionDef = {
  id: "fast-heal",
  name: "Fast Heal",
  castTime: c.healer.fastHeal.castTime,
  targeting: "ally-single",
  effect: { kind: "heal", amount: c.healer.fastHeal.heal },
};

export const SLOW_HEAL: ActionDef = {
  id: "slow-heal",
  name: "Slow Heal",
  castTime: c.healer.slowHeal.castTime,
  targeting: "ally-single",
  effect: { kind: "heal", amount: c.healer.slowHeal.heal },
};

export const HEAL_OVER_TIME: ActionDef = {
  id: "hot",
  name: "Renew",
  castTime: c.healer.hot.castTime,
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
  targeting: "fighters",
  effect: { kind: "aoe-heal", amount: c.healer.aoeHeal.heal },
};

export const ENEMY_BASIC: ActionDef = {
  id: "enemy-basic",
  name: "Claw",
  castTime: c.enemy.basicAttack.castTime,
  targeting: "ally-single", // resolved to a random living party member at cast start
  effect: { kind: "damage", amount: c.enemy.basicAttack.damage },
};

export const ENEMY_AOE: ActionDef = {
  id: "enemy-aoe",
  name: "Roar",
  castTime: c.enemy.aoeAttack.castTime,
  targeting: "party-all",
  effect: { kind: "aoe-damage", amount: c.enemy.aoeAttack.damage },
};

/** Actions available to the player for each party-member kind. */
export const FIGHTER_ACTIONS: ActionDef[] = [FIGHTER_ATTACK];
export const HEALER_ACTIONS: ActionDef[] = [
  FAST_HEAL,
  SLOW_HEAL,
  HEAL_OVER_TIME,
  AOE_HEAL,
];
