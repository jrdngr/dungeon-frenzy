// All tunable balance numbers live here so balancing is a single-file edit.
// Times are in seconds; amounts are flat HP/mana.
//
// Dungeon Frenzy is a pure healing game (see docs/initial-design.md): you are the
// healer keeping a fixed, auto-fighting party (tank + ranger + mage + you) alive.
// Iteration 8 expands it into a CAMPAIGN: 5 areas, each 3 fights (small pack ->
// bigger pack -> boss). HP/MP carry across the 3 fights of an area; between fights
// everyone restores a little and the dead revive at low HP. Everything is immobile.
//
// Targeting:
// - Enemies pile single-target (Claw / Heavy Smash) on the TANK; Line/Cleave hit a
//   primary + random others; AoE hits all; Curse is a hostile DoT on the backline.
// - The party focus-fires ONE enemy (player picks it by clicking a front-row enemy);
//   only the frontmost living row is targetable — back-row enemies (e.g. a shielded
//   boss) can't be hit until the front row is cleared, though they still attack.
//
// The difficulty curve is validated/retuned with scripts/sim-playtest.ts (a
// skilled "smart" bot, 200 runs/area). Target curve, base kit (no skill tree yet):
//   area 1  comfortable        (~100% win, no deaths, never OOM)
//   area 2  a clear step up     (beatable but punishing: deaths + early OOM)
//   area 3  the HARD WALL       (~0% win; wipes on the boss with it still ~2/3 HP)
//   areas 4-5  harder walls     (~0% win; barely/never dent the boss)
// Each area's wall is its BOSS — the small packs stay passable for a skilled
// player. Area 3+ is meant to be cleared only once the (future) skill tree lands.

export const CONFIG = {
  // --- Party damage dealers (AI auto-attackers; the player can't control them) ---
  // They stand still and focus-fire the player's chosen enemy; party DPS sets the
  // kill clock for each enemy.
  tank: {
    maxHp: 140, // soaks the enemies' single-target focus
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
    manaRegen: 1.5, // per second (halved: mana is now scarce across an area's 3 fights)
    // HP-per-mana: Renew 2.5 > Group 2.4 > Slow 2.0 > Fast 1.5. Renew is the cheap
    // rolling anchor (small net mana drain); Fast is the fast (1s) but draining
    // panic button — leaning on it is how you go OOM.
    fastHeal: { castTime: 1.0, cooldown: 0.5, heal: 15, mana: 10 }, // recast 1.5s
    slowHeal: { castTime: 3.0, cooldown: 2.0, heal: 30, mana: 15 }, // recast 5s
    hot: { castTime: 1.0, cooldown: 5.0, perTick: 5, interval: 1.0, duration: 10.0, mana: 20 }, // 50 over 10s
    aoeHeal: { castTime: 3.0, cooldown: 7.0, heal: 15, mana: 25 }, // all party, recast 10s
  },

  // --- Between-fight recovery (applied once at each fight transition in an area) ---
  recovery: {
    hpFraction: 0.1, // living members heal +10% max HP
    manaFraction: 0.1, // healer regains +10% max mana
    reviveHpFraction: 0.1, // dead members revive at 10% max HP
  },

  // --- Enemy archetypes ---
  // Each type has a maxHp, an attack profile (only the listed attacks exist), a
  // rotation indexed by completed actions, and optional enrage (a near-death
  // frenzy: damage *= damageScale, castTime *= castScale below hpFraction).
  // Attack keys & how they resolve (engine builds the ActionDefs from these):
  //   claw   single-target on the tank (tank-first priority)        [damage]
  //   line   primary + 1 random other (Cleave)                      [line, count 2]
  //   cleave primary + 2 random others (Wide Cleave)                [line, count 3]
  //   smash  big single hit on the tank (Heavy Smash; pre-heal it)  [damage]
  //   aoe    all living party (Roar)                                [aoe-damage]
  //   curse  hostile damage-over-time on a backline member          [dot]
  enemyTypes: {
    // Small enemies — die fast; pressure comes from their numbers. They mirror the
    // area boss's base attacks (claw, later light line). Never enrage. Trash is
    // tuned to stay PASSABLE for a skilled player in every area (so each area's
    // wall is its boss, not its packs); difficulty rises gently a1 -> a5, with the
    // a4/a5 line cleaves reaching the backline.
    a1small: { name: "Imp", maxHp: 90, rotation: ["claw"], attacks: { claw: { castTime: 2.6, damage: 8 } } },
    a2small: { name: "Kobold", maxHp: 95, rotation: ["claw"], attacks: { claw: { castTime: 2.6, damage: 9 } } },
    a3small: { name: "Gnoll", maxHp: 95, rotation: ["claw"], attacks: { claw: { castTime: 2.5, damage: 9 } } },
    a4small: { name: "Marauder", maxHp: 100, rotation: ["claw", "claw", "line"], attacks: { claw: { castTime: 2.4, damage: 10 }, line: { castTime: 3.2, damage: 7 } } },
    a5small: { name: "Reaver", maxHp: 100, rotation: ["claw", "claw", "line"], attacks: { claw: { castTime: 2.3, damage: 9 }, line: { castTime: 3.0, damage: 7 } } },

    // Boss 1 — single-target claws on the tank only. The gentle introduction; a
    // comfortable cap on area 1 that a skilled healer clears with mana to spare.
    boss1: {
      name: "Ogre Brute",
      isBoss: true,
      maxHp: 480,
      rotation: ["claw"],
      attacks: { claw: { castTime: 2.6, damage: 15 } },
    },
    // Boss 2 — claws + a Cleave (tank + one random other; first hits on the backline).
    // Area 2's capstone: a clear step up from area 1 but still beatable by a
    // skilled, mana-disciplined healer.
    boss2: {
      name: "Cleaver",
      isBoss: true,
      maxHp: 700,
      rotation: ["claw", "claw", "line", "claw"],
      attacks: { claw: { castTime: 2.6, damage: 17 }, line: { castTime: 3.0, damage: 11 } },
    },
    // Boss 3 — the original Ogre fight (claw + line + AoE), now area 3's finale and
    // the campaign's HARD WALL: with the base kit a skilled player clears the trash,
    // reaches the boss, but wipes with it still well above half HP. Beating it is
    // gated behind the (future) skill tree.
    boss3: {
      name: "Ogre",
      isBoss: true,
      maxHp: 1050,
      rotation: ["claw", "claw", "line", "claw", "claw", "aoe"],
      attacks: {
        claw: { castTime: 2.6, damage: 29 },
        line: { castTime: 3.0, damage: 14 },
        aoe: { castTime: 3.5, damage: 13 },
      },
      enrage: { hpFraction: 0.15, damageScale: 1.35, castScale: 0.78 },
    },
    // Boss 4 — adds Curse (hostile DoT) + Wide Cleave (3 targets). Fights from the
    // BACK row, shielded by front-row adds you must clear first. A harder wall than
    // boss3: the party reaches it but dents it less before wiping.
    boss4: {
      name: "Cursed Warlord",
      isBoss: true,
      maxHp: 1050,
      rotation: ["claw", "cleave", "claw", "curse", "claw", "aoe"],
      attacks: {
        claw: { castTime: 2.5, damage: 16 },
        cleave: { castTime: 3.2, damage: 10 },
        curse: { castTime: 2.4, perTick: 4, interval: 1.0, duration: 6.0 },
        aoe: { castTime: 3.5, damage: 9 },
      },
      enrage: { hpFraction: 0.15, damageScale: 1.35, castScale: 0.8 },
    },
    // Boss 5 — everything: Curse + Heavy Smash (big tank nuke) + Wide Cleave. Also
    // back-row, behind tougher adds. The campaign's hardest wall.
    boss5: {
      name: "Dread Tyrant",
      isBoss: true,
      maxHp: 1100,
      rotation: ["claw", "smash", "cleave", "claw", "curse", "aoe"],
      attacks: {
        claw: { castTime: 2.4, damage: 17 },
        smash: { castTime: 3.6, damage: 40 },
        cleave: { castTime: 3.0, damage: 10 },
        curse: { castTime: 2.2, perTick: 4, interval: 1.0, duration: 6.0 },
        aoe: { castTime: 3.2, damage: 8 },
      },
      enrage: { hpFraction: 0.15, damageScale: 1.4, castScale: 0.78 },
    },
  },

  // --- Areas: 5, each 3 fights. row 0 = front (targetable first); higher = back. ---
  areas: [
    {
      name: "Whispering Glade",
      fights: [
        { enemies: [r("a1small", 0, 0), r("a1small", 0, 1)] },
        { enemies: [r("a1small", 0, 0), r("a1small", 0, 1), r("a1small", 1, 0), r("a1small", 1, 1)] },
        { enemies: [r("boss1", 0, 0)] },
      ],
    },
    {
      name: "Sunken Crossroads",
      fights: [
        { enemies: [r("a2small", 0, 0), r("a2small", 0, 1), r("a2small", 0, 2)] },
        { enemies: [r("a2small", 0, 0), r("a2small", 0, 1), r("a2small", 0, 2), r("a2small", 1, 0), r("a2small", 1, 1)] },
        { enemies: [r("boss2", 0, 0)] },
      ],
    },
    {
      name: "Ashfall Keep",
      fights: [
        { enemies: [r("a3small", 0, 0), r("a3small", 0, 1), r("a3small", 0, 2)] },
        { enemies: [r("a3small", 0, 0), r("a3small", 0, 1), r("a3small", 0, 2), r("a3small", 1, 0), r("a3small", 1, 1)] },
        { enemies: [r("boss3", 0, 0)] },
      ],
    },
    {
      name: "Cursed Hollow",
      fights: [
        { enemies: [r("a4small", 0, 0), r("a4small", 0, 1), r("a4small", 0, 2)] },
        { enemies: [r("a4small", 0, 0), r("a4small", 0, 1), r("a4small", 0, 2), r("a4small", 1, 0), r("a4small", 1, 1)] },
        { enemies: [r("boss4", 1, 0), r("a4small", 0, 0), r("a4small", 0, 1)] },
      ],
    },
    {
      name: "Tyrant's Throne",
      fights: [
        { enemies: [r("a5small", 0, 0), r("a5small", 0, 1), r("a5small", 0, 2)] },
        { enemies: [r("a5small", 0, 0), r("a5small", 0, 1), r("a5small", 0, 2), r("a5small", 1, 0), r("a5small", 1, 1)] },
        { enemies: [r("boss5", 1, 0), r("a5small", 0, 0), r("a5small", 0, 1)] },
      ],
    },
  ],
} as const;

/** Tiny helper to keep fight rosters terse: an enemy placement {type, row, col}. */
function r(type: string, row: number, col: number) {
  return { type, row, col };
}
