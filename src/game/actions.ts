// Static action definitions built from CONFIG. These are immutable data;
// an entity casting one wraps it in an ActionInstance.

import { CONFIG } from "./config";
import type { ActionDef } from "./types";

const c = CONFIG;

// --- Party auto-attacks (tank / ranger / mage) ---
// Not on any action bar: idle attackers cast their own swing automatically (see
// engine.ts). The player controls only the healer.

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

/** The auto-attack for a given attacker kind. */
export function autoAttackFor(kind: "tank" | "ranger" | "mage"): ActionDef {
  switch (kind) {
    case "tank":
      return TANK_ATTACK;
    case "ranger":
      return RANGER_ATTACK;
    case "mage":
      return MAGE_ATTACK;
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

// --- Enemy ---

export const ENEMY_CLAW: ActionDef = {
  id: "enemy-claw",
  name: "Claw",
  castTime: c.enemy.claw.castTime,
  targeting: "ally-single", // resolved to the priority target at cast start
  effect: { kind: "damage", amount: c.enemy.claw.damage },
};

export const ENEMY_LINE: ActionDef = {
  id: "enemy-line",
  name: "Cleave",
  castTime: c.enemy.line.castTime,
  targeting: "line", // primary (tank) + one random other
  effect: { kind: "line-damage", amount: c.enemy.line.damage },
};

export const ENEMY_AOE: ActionDef = {
  id: "enemy-aoe",
  name: "Roar",
  castTime: c.enemy.aoe.castTime,
  targeting: "party-all",
  effect: { kind: "aoe-damage", amount: c.enemy.aoe.damage },
};

export const ENEMY_CLAW_ENRAGED: ActionDef = {
  ...ENEMY_CLAW,
  id: "enemy-claw-enraged",
  name: "Frenzied Claw",
  castTime: c.enemy.enrage.claw.castTime,
  effect: { kind: "damage", amount: c.enemy.enrage.claw.damage },
};

export const ENEMY_LINE_ENRAGED: ActionDef = {
  ...ENEMY_LINE,
  id: "enemy-line-enraged",
  name: "Frenzied Cleave",
  castTime: c.enemy.enrage.line.castTime,
  effect: { kind: "line-damage", amount: c.enemy.enrage.line.damage },
};

export const ENEMY_AOE_ENRAGED: ActionDef = {
  ...ENEMY_AOE,
  id: "enemy-aoe-enraged",
  name: "Roar",
  castTime: c.enemy.enrage.aoe.castTime,
  effect: { kind: "aoe-damage", amount: c.enemy.enrage.aoe.damage },
};

/** The healer's action bar, in display / hotkey (Q W E R) order. */
export const HEALER_ACTIONS: ActionDef[] = [
  FAST_HEAL,
  SLOW_HEAL,
  RENEW,
  AOE_HEAL,
];
