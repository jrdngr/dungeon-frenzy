// Static action definitions built from CONFIG. These are immutable data;
// an entity casting one wraps it in an ActionInstance.

import { CONFIG } from "./config";
import type { ActionDef } from "./types";

const c = CONFIG;

// --- Movement ---

export const MOVE_PARTY: ActionDef = {
  id: "move-party",
  name: "Move",
  castTime: c.fighter.moveTime, // same for fighter and healer
  range: 1,
  targeting: "hex",
  effect: { kind: "move" },
};

export const MOVE_ENEMY: ActionDef = {
  id: "move-enemy",
  name: "Lumber",
  castTime: c.enemy.moveTime,
  range: 1,
  targeting: "hex",
  effect: { kind: "move" },
};

// --- Fighter ---

export const FIGHTER_ATTACK: ActionDef = {
  id: "fighter-attack",
  name: "Attack",
  castTime: c.fighter.attack.castTime,
  range: c.fighter.attack.range,
  targeting: "enemy",
  effect: { kind: "damage", amount: c.fighter.attack.damage },
};

export const FIGHTER_HEAVY: ActionDef = {
  id: "fighter-heavy",
  name: "Heavy Swing",
  castTime: c.fighter.heavySwing.castTime,
  range: c.fighter.heavySwing.range,
  targeting: "enemy",
  effect: { kind: "damage", amount: c.fighter.heavySwing.damage },
};

export const FIGHTER_BRACE: ActionDef = {
  id: "fighter-brace",
  name: "Brace",
  castTime: c.fighter.brace.castTime,
  targeting: "self",
  effect: {
    kind: "shield",
    amount: c.fighter.brace.block,
    duration: c.fighter.brace.duration,
  },
};

// --- Healer ---

export const FAST_HEAL: ActionDef = {
  id: "fast-heal",
  name: "Fast Heal",
  castTime: c.healer.fastHeal.castTime,
  manaCost: c.healer.fastHeal.mana,
  range: c.healer.healRange,
  targeting: "ally-single",
  effect: { kind: "heal", amount: c.healer.fastHeal.heal },
};

export const SLOW_HEAL: ActionDef = {
  id: "slow-heal",
  name: "Slow Heal",
  castTime: c.healer.slowHeal.castTime,
  manaCost: c.healer.slowHeal.mana,
  range: c.healer.healRange,
  targeting: "ally-single",
  effect: { kind: "heal", amount: c.healer.slowHeal.heal },
};

export const HEAL_OVER_TIME: ActionDef = {
  id: "hot",
  name: "Renew",
  castTime: c.healer.hot.castTime,
  manaCost: c.healer.hot.mana,
  range: c.healer.healRange,
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
  manaCost: c.healer.aoeHeal.mana,
  range: c.healer.healRange,
  targeting: "fighters",
  effect: { kind: "aoe-heal", amount: c.healer.aoeHeal.heal },
};

// --- Enemy ---

export const ENEMY_BASIC: ActionDef = {
  id: "enemy-basic",
  name: "Claw",
  castTime: c.enemy.basicAttack.castTime,
  range: c.enemy.basicAttack.range,
  targeting: "ally-single", // resolved to a random *adjacent* party member at cast start
  effect: { kind: "damage", amount: c.enemy.basicAttack.damage },
};

export const ENEMY_AOE: ActionDef = {
  id: "enemy-aoe",
  name: "Roar",
  castTime: c.enemy.aoeAttack.castTime,
  targeting: "party-all",
  effect: { kind: "aoe-damage", amount: c.enemy.aoeAttack.damage },
};

export const ENEMY_BASIC_ENRAGED: ActionDef = {
  id: "enemy-basic-enraged",
  name: "Frenzied Claw",
  castTime: c.enemy.enrage.basicAttack.castTime,
  range: c.enemy.enrage.basicAttack.range,
  targeting: "ally-single",
  effect: { kind: "damage", amount: c.enemy.enrage.basicAttack.damage },
};

export const ENEMY_AOE_ENRAGED: ActionDef = {
  id: "enemy-aoe-enraged",
  name: "Roar",
  castTime: c.enemy.enrage.aoeAttack.castTime,
  targeting: "party-all",
  effect: { kind: "aoe-damage", amount: c.enemy.enrage.aoeAttack.damage },
};

/** Actions available to the player for each party-member kind. Movement has
 * no button: selecting a unit highlights its legal hexes and clicking one
 * issues MOVE_PARTY directly (see ui/input.ts). */
export const FIGHTER_ACTIONS: ActionDef[] = [
  FIGHTER_ATTACK,
  FIGHTER_HEAVY,
  FIGHTER_BRACE,
];
export const HEALER_ACTIONS: ActionDef[] = [
  FAST_HEAL,
  SLOW_HEAL,
  HEAL_OVER_TIME,
  AOE_HEAL,
];
