// All tunable balance numbers live here so balancing is a single-file edit.
// Times are in seconds; amounts are flat HP.

export const CONFIG = {
  fighter: {
    maxHp: 60,
    attack: { castTime: 2.5, damage: 10 },
  },

  healer: {
    maxHp: 50,
    fastHeal: { castTime: 1.5, heal: 14 },
    slowHeal: { castTime: 4.0, heal: 42 },
    hot: { castTime: 2.0, perTick: 5, interval: 1.0, duration: 6.0 }, // 30 total
    aoeHeal: { castTime: 3.0, heal: 12 }, // to both fighters
  },

  enemy: {
    maxHp: 600,
    basicAttack: { castTime: 3.0, damage: 9 }, // random living party member
    aoeAttack: { castTime: 6.0, damage: 7 }, // all three party members
    // Every Nth enemy action is the AoE; the rest are basic attacks.
    aoeEveryNthAction: 4,
  },
} as const;
