// All tunable balance numbers live here so balancing is a single-file edit.
// Times are in seconds; amounts are flat HP/mana.
//
// Dungeon Frenzy is a pure healing game (see docs/initial-design.md, Iteration 7):
// you are the healer keeping a fixed, auto-fighting party (tank + ranger + mage +
// you) alive against one immobile enemy. Everything is immobile; hexes are layout.
//
// Balance sketch (validated with scripts/sim-playtest.ts):
// - Party auto-attacks for ~15.7 DPS; enemy HP 1100 -> ~70s clean kill, ~72s real.
// - The enemy hammers the TANK with heavy single-target Claws (the main heal sink,
//   ~8.6 DPS to the tank), periodically throws a Line (tank + one random other —
//   the only regular way to hit the healer) and an AoE (all four, smaller).
// - Healer mana: Renew (8 HPS) does NOT fully cover the tank, so you supplement
//   with Slow/Fast heals; real spend outruns regen (2.7/s) and the 100 pool drains
//   so that by ~35s you often can't even afford Fast Heal (20) and must wait on
//   regen. From there HP slips — you must kill the enemy before mana collapses.
// - Cooldowns (post-cast lockout) force a rotation: you can't just spam the
//   efficient heals. Fast Heal has no cooldown but is the inefficient emergency;
//   panic-spamming it (sloppy play) goes dry by ~14s and loses.
// - Enrage (below 15% HP, ~62s in) hits last — after starvation has already begun —
//   and makes the finale a frantic, near-empty-mana race.
// - Sim evidence: a mana-conscious healer wins ~100% but still loses ~0.5 party
//   members; Fast-Heal spam and AFK lose 100%. Knobs to retune by feel: manaRegen
//   and spell mana costs (difficulty), enemy claw damage (tank pressure),
//   enrage.hpFraction (finale timing).

export const CONFIG = {
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
    manaRegen: 2.7, // per second
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
    claw: { castTime: 2.6, damage: 30 }, // single-target on the tank (the main heal sink)
    line: { castTime: 3.0, damage: 14 }, // tank + one random other, each
    aoe: { castTime: 3.5, damage: 11 }, // all living party, each
    // Below this HP fraction the enemy enrages: faster, harder attacks. Tuned low
    // so the finale lands ~60s in — after mana starvation has already begun.
    enrage: {
      hpFraction: 0.15,
      claw: { castTime: 2.0, damage: 40 },
      line: { castTime: 2.4, damage: 19 },
      aoe: { castTime: 3.0, damage: 15 },
    },
  },
} as const;
