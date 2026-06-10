// All tunable balance numbers live here so balancing is a single-file edit.
// Times are in seconds; amounts are flat HP/mana.
//
// Balance sketch (see docs/initial-design.md):
// - Two fighters chaining Heavy Swing ≈ 10.8 DPS -> ~46s minimum kill, ~60s real.
// - Normal-phase enemy output ≈ 4.8 party DPS; healer mana regen sustains
//   ~4.5 HPS via Slow Heal, so the mana pool is the burst budget and sloppy
//   (Fast-Heal-only) play runs dry.
// - Enrage (last 30% of enemy HP) roughly doubles enemy output: the finale is
//   a race the party is meant to barely win with Braces and smart triage.

export const CONFIG = {
  fighter: {
    maxHp: 60,
    // Quick hit: lower DPS, short commitment — good for reacting and finishing.
    attack: { castTime: 2.2, damage: 10 },
    // Best DPS, but locks the fighter in for 5s — risky during enrage/Roar.
    heavySwing: { castTime: 5.0, damage: 27 },
    // Absorb the next hit taken within the window. Counters Roar and enraged
    // Claws at the cost of attack uptime.
    brace: { castTime: 1.2, block: 15, duration: 6.0 },
  },

  healer: {
    maxHp: 50,
    maxMana: 80,
    manaRegen: 1.5, // per second
    // HP-per-mana: Slow 3.0 > Renew 1.9 > Group 1.6 > Fast 0.9.
    // Fast Heal is the emergency button; spamming it is how you go OOM.
    fastHeal: { castTime: 1.5, heal: 14, mana: 16 },
    slowHeal: { castTime: 4.0, heal: 42, mana: 14 },
    hot: { castTime: 2.0, perTick: 5, interval: 1.0, duration: 6.0, mana: 16 }, // 30 total
    aoeHeal: { castTime: 3.0, heal: 14, mana: 18 }, // to both fighters
  },

  enemy: {
    maxHp: 500,
    basicAttack: { castTime: 2.8, damage: 11 }, // random living party member
    aoeAttack: { castTime: 6.0, damage: 12 }, // all party members
    // Every Nth enemy action is the AoE; the rest are basic attacks.
    aoeEveryNthAction: 4,
    // Below this HP fraction the enemy enrages: faster, harder basic attacks
    // and a quicker Roar. This is the fight's finale and the anti-stall clock.
    enrage: {
      hpFraction: 0.3,
      basicAttack: { castTime: 2.0, damage: 16 },
      aoeAttack: { castTime: 4.5, damage: 12 },
    },
  },
} as const;
