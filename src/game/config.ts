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
// player. Area 3+ is meant to be cleared only once the skill tree lands.

import type { SkillNode } from "./types";

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
    slowHeal: { castTime: 3.0, cooldown: 0.5, heal: 30, mana: 15 }, // recast 3.5s
    hot: { castTime: 1.0, cooldown: 5.0, perTick: 5, interval: 1.0, duration: 10.0, mana: 20 }, // 50 over 10s
    aoeHeal: { castTime: 3.0, cooldown: 7.0, heal: 15, mana: 25 }, // all party, recast 10s
    // Skill-tree unlock: revive a DEAD ally. The long cast + mana cost is the price.
    resurrect: { castTime: 5.0, cooldown: 0, mana: 30, reviveFraction: 0.1 }, // +10%/rank via Greater Resurrection
  },

  // --- Between-fight recovery (applied once at each fight transition in an area) ---
  recovery: {
    hpFraction: 0.1, // living members heal +10% max HP
    manaFraction: 0.1, // healer regains +10% max mana
    reviveHpFraction: 0.1, // dead members revive at 10% max HP
  },

  // --- Skill points ---
  // Killing an enemy grants its archetype's `sp` directly (no levels). Trash give
  // 1 each; bosses scale 4/6/8/10/14 by area. A first-try campaign (42 trash + 5
  // bosses) yields ~84 SP ≈ 25% of the 337-SP tree.

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
    a1small: { name: "Imp", maxHp: 90, sp: 1, rotation: ["claw"], attacks: { claw: { castTime: 2.6, damage: 8 } } },
    a2small: { name: "Kobold", maxHp: 95, sp: 1, rotation: ["claw"], attacks: { claw: { castTime: 2.6, damage: 9 } } },
    a3small: { name: "Gnoll", maxHp: 95, sp: 1, rotation: ["claw"], attacks: { claw: { castTime: 2.5, damage: 9 } } },
    a4small: { name: "Marauder", maxHp: 100, sp: 1, rotation: ["claw", "claw", "line"], attacks: { claw: { castTime: 2.4, damage: 10 }, line: { castTime: 3.2, damage: 7 } } },
    a5small: { name: "Reaver", maxHp: 100, sp: 1, rotation: ["claw", "claw", "line"], attacks: { claw: { castTime: 2.3, damage: 9 }, line: { castTime: 3.0, damage: 7 } } },

    // Boss 1 — single-target claws on the tank only. The gentle introduction; a
    // comfortable cap on area 1 that a skilled healer clears with mana to spare.
    boss1: {
      name: "Ogre Brute",
      isBoss: true,
      maxHp: 480,
      sp: 4,
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
      sp: 6,
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
      sp: 8,
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
      sp: 10,
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
      sp: 14,
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

// --- Skill tree (kept outside `as const` so the derivation module reads plain
// arrays, not readonly tuples). Five independent roots: the free center `heal`
// (Healing tree), plus `mana-pool` (Sustain) and `tank-training` / `deadeye` /
// `arcane-power` (the three Party sub-trees), each buyable from the start. A node
// is buyable once every prereq has >= 1 rank; costs RAMP per rank (later ranks of
// a node cost more). Effect math lives in skills.ts by id.
// Total purchasable cost == 337 SP (asserted by skills.ts).
export const SKILL_NODES: SkillNode[] = [
  // Center — the always-owned Heal and its upgrades.
  { id: "heal", name: "Heal", description: "Your core single-target heal. 3.0s cast, 30 HP, 15 mana.", branch: "heal", prereqs: [], maxRank: 1, costs: [0] },
  { id: "potent-heal", name: "Potent Heal", description: "+5 HP healed by Heal per rank.", branch: "heal", prereqs: ["heal"], maxRank: 3, costs: [1, 3, 5] },
  { id: "efficient-heal", name: "Efficient Heal", description: "-1 mana cost of Heal per rank.", branch: "heal", prereqs: ["heal"], maxRank: 3, costs: [1, 3, 5] },
  { id: "swift-heal", name: "Swift Heal", description: "-0.1s cast time of Heal per rank.", branch: "heal", prereqs: ["heal"], maxRank: 3, costs: [1, 3, 5] },

  // Branch A — Healing spine: Heal -> Quick Heal -> Regen -> Group Heal -> Resurrect.
  { id: "quick-heal", name: "Quick Heal", description: "Unlock a fast panic heal. 1.0s cast, 15 HP, 10 mana.", branch: "heal", prereqs: ["heal"], maxRank: 1, costs: [4] },
  { id: "potent-quick-heal", name: "Potent Quick Heal", description: "+2 HP healed by Quick Heal per rank.", branch: "heal", prereqs: ["quick-heal"], maxRank: 3, costs: [1, 3, 5] },
  { id: "efficient-quick-heal", name: "Efficient Quick Heal", description: "-1 mana cost of Quick Heal per rank.", branch: "heal", prereqs: ["quick-heal"], maxRank: 3, costs: [1, 3, 5] },
  { id: "swift-quick-heal", name: "Swift Quick Heal", description: "-0.1s cast time of Quick Heal per rank.", branch: "heal", prereqs: ["quick-heal"], maxRank: 3, costs: [1, 3, 5] },
  { id: "regen", name: "Regen", description: "Unlock a heal-over-time. 5 HP/tick for 10s, 20 mana.", branch: "heal", prereqs: ["quick-heal"], maxRank: 1, costs: [4] },
  { id: "lingering-regen", name: "Lingering Regen", description: "+2s Regen duration per rank.", branch: "heal", prereqs: ["regen"], maxRank: 3, costs: [1, 3, 5] },
  { id: "efficient-regen", name: "Efficient Regen", description: "-1 mana cost of Regen per rank.", branch: "heal", prereqs: ["regen"], maxRank: 3, costs: [1, 3, 5] },
  { id: "swift-regen", name: "Swift Regen", description: "-0.1s cast time of Regen per rank.", branch: "heal", prereqs: ["regen"], maxRank: 3, costs: [1, 3, 5] },
  { id: "group-heal", name: "Group Heal", description: "Unlock a heal on all living allies. 15 HP each, 25 mana.", branch: "heal", prereqs: ["regen"], maxRank: 1, costs: [4] },
  { id: "wide-grace", name: "Wide Grace", description: "+4 HP healed by Group Heal per rank.", branch: "heal", prereqs: ["group-heal"], maxRank: 3, costs: [1, 3, 5] },
  { id: "efficient-group-heal", name: "Efficient Group Heal", description: "-1 mana cost of Group Heal per rank.", branch: "heal", prereqs: ["group-heal"], maxRank: 3, costs: [1, 3, 5] },
  { id: "swift-group-heal", name: "Swift Group Heal", description: "-0.1s cast time of Group Heal per rank.", branch: "heal", prereqs: ["group-heal"], maxRank: 3, costs: [1, 3, 5] },
  { id: "resurrect", name: "Resurrect", description: "Unlock a revive for a dead ally. 5.0s cast, 30 mana, 10% HP.", branch: "heal", prereqs: ["group-heal"], maxRank: 1, costs: [6] },
  { id: "greater-resurrection", name: "Greater Resurrection", description: "+10% HP restored by Resurrect per rank.", branch: "heal", prereqs: ["resurrect"], maxRank: 3, costs: [1, 3, 5] },

  // Branch B — Sustain (root: Mana Pool).
  { id: "mana-pool", name: "Mana Pool", description: "+10 maximum mana per rank.", branch: "sustain", prereqs: [], maxRank: 3, costs: [1, 3, 5] },
  { id: "meditation", name: "Meditation", description: "+0.3 mana/sec regen per rank.", branch: "sustain", prereqs: ["mana-pool"], maxRank: 3, costs: [1, 3, 5] },
  { id: "second-wind", name: "Second Wind", description: "+5% between-fight HP & mana recovery per rank.", branch: "sustain", prereqs: ["mana-pool"], maxRank: 2, costs: [1, 3] },
  { id: "field-rations", name: "Field Rations", description: "Revived allies return with +10% HP per rank.", branch: "sustain", prereqs: ["second-wind"], maxRank: 2, costs: [1, 3] },
  { id: "crit-heals", name: "Crit Heals", description: "+10% chance per rank for a heal to land at 1.5x.", branch: "sustain", prereqs: ["meditation"], maxRank: 2, costs: [1, 3] },
  { id: "overheal-shield", name: "Overheal Shield", description: "Overhealing becomes a temporary absorb shield (cap 15 HP).", branch: "sustain", prereqs: ["meditation"], maxRank: 1, costs: [8] },
  { id: "reinforced-shield", name: "Reinforced Shield", description: "+5 Overheal Shield cap per rank.", branch: "sustain", prereqs: ["overheal-shield"], maxRank: 3, costs: [1, 3, 5] },

  // Branch C — Party (auto-cast abilities fire on cooldown). Tank sub-tree (root: Tank Training).
  { id: "tank-training", name: "Tank Training", description: "+15 Tank max HP per rank.", branch: "party", prereqs: [], maxRank: 3, costs: [1, 3, 5] },
  { id: "heavy-strikes", name: "Heavy Strikes", description: "+2 Tank attack damage per rank.", branch: "party", prereqs: ["tank-training"], maxRank: 2, costs: [1, 3] },
  { id: "shield-wall", name: "Shield Wall", description: "Tank gains a shield blocking the next hit every 15s; +1 hit absorbed per rank (1/2/3).", branch: "party", prereqs: ["tank-training"], maxRank: 3, costs: [4, 3, 5] },
  { id: "thorns", name: "Thorns", description: "Tank reflects melee damage taken for 10s every 20s; +10% reflected per rank (10/20/30%).", branch: "party", prereqs: ["shield-wall"], maxRank: 3, costs: [4, 3, 5] },
  { id: "bulwark", name: "Bulwark", description: "Every 60s, the whole party gains a shield blocking their next hit.", branch: "party", prereqs: ["thorns"], maxRank: 1, costs: [8] },

  // Ranger sub-tree (root: Deadeye).
  { id: "deadeye", name: "Deadeye", description: "+2 Ranger attack damage per rank.", branch: "party", prereqs: [], maxRank: 3, costs: [1, 3, 5] },
  { id: "ranger-training", name: "Ranger Training", description: "+10 Ranger max HP per rank.", branch: "party", prereqs: ["deadeye"], maxRank: 2, costs: [1, 3] },
  { id: "aimed-shot", name: "Aimed Shot", description: "Ranger fires a strong shot at the focus every 10s; +10 damage per rank (35/45/55).", branch: "party", prereqs: ["deadeye"], maxRank: 3, costs: [4, 3, 5] },
  { id: "volley", name: "Volley", description: "Ranger hits the focus + 2 others every 15s; +4 damage per rank (12/16/20).", branch: "party", prereqs: ["aimed-shot"], maxRank: 3, costs: [4, 3, 5] },
  { id: "serpent-sting", name: "Serpent Sting", description: "Ranger applies a damage-over-time to the focus every 10s; +1/tick per rank (4/5/6).", branch: "party", prereqs: ["volley"], maxRank: 3, costs: [8, 4, 6] },

  // Mage sub-tree (root: Arcane Power).
  { id: "arcane-power", name: "Arcane Power", description: "+2 Mage attack damage per rank.", branch: "party", prereqs: [], maxRank: 3, costs: [1, 3, 5] },
  { id: "mage-training", name: "Mage Training", description: "+10 Mage max HP per rank.", branch: "party", prereqs: ["arcane-power"], maxRank: 2, costs: [1, 3] },
  { id: "fireball", name: "Fireball", description: "Mage nukes the focus every 15s; +12 damage per rank (45/57/69).", branch: "party", prereqs: ["arcane-power"], maxRank: 3, costs: [4, 3, 5] },
  { id: "firestorm", name: "Firestorm", description: "Mage hits all enemies every 20s; +6 damage per rank (20/26/32).", branch: "party", prereqs: ["fireball"], maxRank: 3, costs: [4, 3, 5] },
  { id: "arcane-conduit", name: "Arcane Conduit", description: "Mage restores mana to the healer every 20s; +5 per rank (10/15/20).", branch: "party", prereqs: ["firestorm"], maxRank: 3, costs: [8, 4, 6] },
];
