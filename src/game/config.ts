// All tunable balance numbers live here so balancing is a single-file edit.
// Times are in seconds; amounts are flat HP/mana; ranges are hex distances.
//
// Balance sketch (see docs/initial-design.md):
// - Two fighters chaining Heavy Swing ≈ 10.8 DPS -> ~46s minimum kill, ~60s real.
// - Claw is melee (range 1) and the enemy only attacks what's adjacent, so
//   fighters standing between the enemy and the healer take all single-target
//   damage. Only Roar (global, telegraphed, weak per-hit) reaches the healer.
// - Healer mana regen sustains roughly the enemy's normal-phase output via
//   Slow Heal; the pool is the burst budget and Fast-Heal spam runs dry.
// - Enrage (last 30% of enemy HP) roughly doubles enemy output: the finale is
//   a race the party is meant to barely win.

export const CONFIG = {
  map: {
    radius: 3, // battlefield = hex disk of this radius
  },

  fighter: {
    maxHp: 60,
    moveTime: 0.9, // seconds per one-hex move
    // Quick hit: lower DPS, short commitment — good for reacting and finishing.
    attack: { castTime: 2.2, damage: 10, range: 1 },
    // Best DPS, but locks the fighter in for 5s — risky during enrage/Roar.
    heavySwing: { castTime: 5.0, damage: 27, range: 1 },
    // Absorb the next hit taken within the window. Counters Roar and enraged
    // Claws at the cost of attack uptime.
    brace: { castTime: 1.2, block: 15, duration: 6.0 },
  },

  healer: {
    maxHp: 50,
    moveTime: 0.9,
    maxMana: 80,
    manaRegen: 1.5, // per second
    healRange: 3, // max hex distance for all heals
    // HP-per-mana: Slow 3.0 > Renew 1.9 > Group 1.6 > Fast 0.9.
    // Fast Heal is the emergency button; spamming it is how you go OOM.
    fastHeal: { castTime: 1.5, heal: 14, mana: 16 },
    slowHeal: { castTime: 4.0, heal: 42, mana: 14 },
    hot: { castTime: 2.0, perTick: 5, interval: 1.0, duration: 6.0, mana: 16 }, // 30 total
    aoeHeal: { castTime: 3.0, heal: 14, mana: 18 }, // to both fighters in range
  },

  enemy: {
    maxHp: 500,
    moveTime: 1.3, // slower than the party, so fighters can intercept
    // Melee: hits a random *adjacent* party member. If nothing is adjacent the
    // enemy walks toward the nearest party member instead of attacking.
    basicAttack: { castTime: 2.8, damage: 11, range: 1 },
    // Global shout — the only way to damage a protected healer. Telegraphed by
    // a long cast and warning rings; deliberately far below healer max HP.
    aoeAttack: { castTime: 6.0, damage: 12 },
    // Every Nth *combat* action is the AoE (moves don't count).
    aoeEveryNthAction: 4,
    // Below this HP fraction the enemy enrages: faster, harder basic attacks
    // and a quicker Roar. This is the fight's finale and the anti-stall clock.
    enrage: {
      hpFraction: 0.3,
      basicAttack: { castTime: 2.0, damage: 16, range: 1 },
      aoeAttack: { castTime: 4.5, damage: 12 },
    },
  },
} as const;
