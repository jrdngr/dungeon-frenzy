// All tunable balance numbers live here so balancing is a single-file edit.
// Times are in seconds; amounts are flat HP/mana.
//
// Dungeon Frenzy is a pure healing game (see docs/initial-design.md, Iteration 7):
// you are the healer keeping a fixed, auto-fighting party (tank + ranger + mage +
// you) alive against one immobile enemy. Everything is immobile; hexes are layout.
//
// Balance sketch:
// - Party auto-attacks for ~15.7 DPS; enemy HP 1100 -> ~70s clean kill, ~75s real.
// - The enemy hammers the TANK with single-target Claws, periodically throws a Line
//   (tank + one random other — the only regular way to hit the healer) and an AoE
//   (all four). Tank takes ~6.3 DPS continuously; squishies take spikes.
// - Healer mana: Renew rolling on the tank nearly pays for itself, but the spikes
//   force extra Slow/Fast/AoE casts so real spend (~4.5/s) outruns regen (2.2/s).
//   The 100 pool drains in ~45-50s; after that you heal at the regen rate (below
//   incoming) and HP slips — you must kill the enemy before mana collapses.
// - Cooldowns (post-cast lockout) force a rotation: you can't just spam the
//   efficient heals. Fast Heal has no cooldown but is the inefficient emergency.
// - Enrage (below 15% HP, ~60s in) hits last — after starvation has already begun —
//   and makes the finale a frantic, near-empty-mana race.

export const CONFIG = {
  map: {
    radius: 3, // battlefield = hex disk of this radius (visual only)
  },

  // --- Party damage dealers (AI auto-attackers; the player can't control them) ---
  // They stand still and swing on a timer; total party DPS sets the kill clock.
  tank: {
    maxHp: 140, // soaks the enemy's single-target focus
    attack: { castTime: 2.4, damage: 9 }, // 3.75 DPS
  },
  ranger: {
    maxHp: 70,
    attack: { castTime: 2.2, damage: 13 }, // 5.91 DPS
  },
  mage: {
    maxHp: 70,
    attack: { castTime: 2.8, damage: 17 }, // 6.07 DPS
  },

  // --- Healer (the player) ---
  healer: {
    maxHp: 80,
    maxMana: 100,
    manaRegen: 2.2, // per second
    // HP-per-mana: Renew 3.56 > Slow 2.29 > AoE <=2.35 > Fast 1.10.
    // Fast Heal is the spammable emergency; leaning on it is how you go OOM.
    fastHeal: { castTime: 1.5, cooldown: 0, heal: 22, mana: 20 },
    slowHeal: { castTime: 3.0, cooldown: 3.0, heal: 55, mana: 24 }, // recast 6s
    // Renew: a heal-over-time; the efficient anchor you keep rolling on the tank.
    hot: { castTime: 1.5, cooldown: 6.5, perTick: 8, interval: 1.0, duration: 8.0, mana: 18 }, // 64 over 8s, recast 8s
    aoeHeal: { castTime: 2.5, cooldown: 7.5, heal: 20, mana: 34 }, // all party, recast 10s
  },

  // --- Enemy (immobile; fixed attack rotation) ---
  enemy: {
    maxHp: 1100,
    // The rotation is indexed by completed combat actions. "line" hits the tank
    // plus one random other; "aoe" hits everyone; otherwise a single-target claw
    // on the tank (or the next priority target once the tank is dead).
    rotation: ["claw", "claw", "line", "claw", "claw", "aoe"],
    claw: { castTime: 2.6, damage: 20 }, // single-target on the tank
    line: { castTime: 3.0, damage: 15 }, // tank + one random other, each
    aoe: { castTime: 3.5, damage: 12 }, // all living party, each
    // Below this HP fraction the enemy enrages: faster, harder attacks. Tuned low
    // so the finale lands ~60s in — after mana starvation has already begun.
    enrage: {
      hpFraction: 0.15,
      claw: { castTime: 2.0, damage: 26 },
      line: { castTime: 2.4, damage: 20 },
      aoe: { castTime: 3.0, damage: 16 },
    },
  },
} as const;
