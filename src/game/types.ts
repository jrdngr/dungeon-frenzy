// Core data model for Dungeon Frenzy. Pure data — no rendering concerns here.

/** Party members that auto-attack the enemy on their own. The player controls
 * only the healer; everyone else in this set is an AI damage dealer. */
export type AutoAttackerKind = "tank" | "ranger" | "mage";

export type EntityKind = AutoAttackerKind | "healer" | "enemy";

/** Axial hex coordinate. Movement is gone — positions are fixed — but the grid
 * is real so the party column can be drawn. Enemies are positioned from their
 * formation (row/col) by the UI, not from this. */
export interface Hex {
  q: number;
  r: number;
}

/** What an action is allowed to target. */
export type Targeting =
  | "enemy" // the party's focused enemy (party auto-attacks)
  | "ally-single" // one chosen living party member (single-target heals; enemy claw/smash/curse)
  | "ally-dead" // one chosen DEAD party member (Resurrect)
  | "party-all" // all living party members (AoE heal / enemy AoE)
  | "line"; // enemy linear hit: a primary target plus N-1 random others

export type Effect =
  | { kind: "damage"; amount: number }
  | { kind: "heal"; amount: number }
  | { kind: "hot"; perTick: number; interval: number; duration: number }
  // Hostile heal-over-time (Curse): ticks deal damage to a party member.
  | { kind: "dot"; perTick: number; interval: number; duration: number }
  | { kind: "aoe-heal"; amount: number } // heals all living party
  | { kind: "aoe-damage"; amount: number } // damages all living party (enemy)
  // primary + (count-1) random others. Line = 2, Wide Cleave = 3.
  | { kind: "line-damage"; amount: number; count: number }
  // --- Skill-tree additions ---
  | { kind: "aoe-enemy-damage"; amount: number } // damages all living enemies (mage Firestorm)
  // A hit-block shield: absorbs the next `hits` whole incoming hits (Shield Wall / Bulwark).
  | { kind: "shield"; hits: number; scope: "self" | "party-all" }
  // A timed melee-reflect buff on the caster (tank Thorns).
  | { kind: "thorns"; pct: number; duration: number }
  // Restore mana to the healer (mage Arcane Conduit).
  | { kind: "mana-restore"; amount: number }
  // Revive a dead ally at a fraction of max HP (Resurrect).
  | { kind: "revive"; hpFraction: number };

export interface ActionDef {
  id: string;
  name: string;
  castTime: number; // seconds
  manaCost?: number; // undefined = free
  /** Post-cast lockout in seconds before this action can be cast again. The
   * timer starts when the cast *completes*, so the effective recast interval is
   * castTime + cooldown. undefined/0 = no cooldown. */
  cooldown?: number;
  targeting: Targeting;
  effect: Effect;
}

/** An action currently being cast by an entity. */
export interface ActionInstance {
  def: ActionDef;
  elapsed: number; // seconds elapsed into the cast
  targetId?: string;
  /** Line/Cleave attacks pick all their victims at cast start (so the telegraph
   * can show every line); they are re-validated when the hit lands. */
  victimIds?: string[];
}

/** An active heal-over-time effect riding on an entity. Hostile instances
 * (Curse) tick damage instead of healing. */
export interface HotInstance {
  perTick: number;
  interval: number; // seconds between ticks
  duration: number; // total seconds remaining
  sinceTick: number; // seconds accumulated toward the next tick
  hostile?: boolean; // true = damage tick (Curse), false/undefined = heal
}

export interface Entity {
  id: string;
  name: string;
  kind: EntityKind;
  hp: number;
  maxHp: number;
  mana: number; // 0 for entities without a resource
  maxMana: number; // 0 = no mana bar
  /** Mana regenerated per second (healer only; raised by Meditation). 0 = none. */
  manaRegen: number;
  hex: Hex; // party formation; enemies are laid out from row/col by the UI
  current?: ActionInstance; // undefined = idle
  hots: HotInstance[];
  /** Healer-only: spell id -> seconds of cooldown remaining (absent = ready).
   * Party members reuse this for their auto-cast ability cooldowns. */
  cooldowns: Record<string, number>;
  /** Absorb shield (skill tree). `hits` = whole incoming hits to fully negate
   * (Shield Wall / Bulwark), consumed before the `absorb` HP pool (Overheal
   * Shield, capped at `absorbCap`). Absent = no shield. */
  shield?: { hits: number; absorb: number; absorbCap: number };
  /** Active melee-reflect buff on the tank (Thorns): reflect `pct` of melee damage
   * taken back to the attacker for `remaining` more seconds. Absent = none. */
  thorns?: { pct: number; remaining: number };
  alive: boolean;
  /** Enemy-only: counts completed actions to drive the attack rotation. */
  actionCount: number;
  /** Enemy-only: true once HP drops below the enrage threshold. */
  enraged: boolean;
  /** Enemy-only: archetype id -> attack profile (see config.enemyTypes). */
  enemyType?: string;
  /** Enemy-only formation: row (0 = front, closest to party) and column. Only
   * the frontmost living row is targetable by the party. */
  row?: number;
  col?: number;
}

/** Things that just happened, for floating combat text and other feedback.
 * The engine appends; the UI reads; old events are pruned each update. */
export type GameEvent =
  | { kind: "damage"; entityId: string; amount: number; at: number }
  | { kind: "heal"; entityId: string; amount: number; at: number }
  // Skill points awarded for a kill, floated over the dying enemy.
  | { kind: "sp"; entityId: string; amount: number; at: number }
  | { kind: "enrage"; entityId: string; at: number };

/** Cumulative battle stats for one area attempt, shown on the end overlays. */
export interface Stats {
  damageDealt: number; // party -> enemies
  healingDone: number; // effective healing (excludes overheal)
  overhealing: number;
  deaths: number;
}

/** Which of the three branches a skill node lives in (center "Heal" is `heal`). */
export type SkillBranch = "heal" | "sustain" | "party";

/** A node in the skill tree. Pure structure: the per-rank *effect* math lives in
 * skills.ts keyed by id; this only describes cost/prereqs/branch/shape. */
export interface SkillNode {
  id: string;
  name: string;
  description: string;
  branch: SkillBranch;
  /** Node ids that must each have >= 1 rank before this node can be bought. */
  prereqs: string[];
  maxRank: number;
  /** SP cost of each rank; costs.length === maxRank (rank N costs costs[N-1]). */
  costs: number[];
}

/** Game flow:
 * - area-select: the hub; pick an unlocked area.
 * - playing: a fight is in progress.
 * - fight-cleared: a fight was won and more remain; waiting for the player to
 *   continue (applies the between-fight recovery).
 * - area-cleared: the area's last fight was won.
 * - defeat: the party was wiped (or left unable to win). */
export type GamePhase =
  | "area-select"
  | "playing"
  | "fight-cleared"
  | "area-cleared"
  | "defeat";

export interface GameState {
  entities: Entity[];
  /** The healer's currently armed spell, awaiting a target click. The healer is
   * the implicit, always-the-caster unit; there is no unit-selection step. */
  armedSpellId?: string;
  /** The enemy the party focus-fires. Always a living front-row enemy; the
   * player sets it by clicking a front-row enemy. */
  focusedEnemyId?: string;
  /** Which area is being played, and which of its 3 fights (0-based). */
  areaIndex: number;
  fightIndex: number;
  /** Per-area cleared flags (length = number of areas) — drives the hub's
   * sequential unlock. In-memory only. */
  clearedAreas: boolean[];
  phase: GamePhase;
  elapsedTime: number; // seconds the current area attempt has run
  events: GameEvent[];
  stats: Stats;
  // --- Persistent progression (kept across runs/death like clearedAreas; reset
  // only by createInitialState). In-memory only — no localStorage. Killing an enemy
  // grants skill points directly (its archetype's `sp`); there are no levels. ---
  skillPoints: number; // unspent skill points
  skills: Record<string, number>; // node id -> ranks purchased ({ heal: 1 } at start)
  /** UI-only: the skill-tree overlay is open (only meaningful at the hub). */
  skillTreeOpen?: boolean;
}

export function isParty(e: Entity): boolean {
  return e.kind !== "enemy";
}

/** A directly-damageable damage dealer (not the tank, not the healer). */
export function isDPS(e: Entity): boolean {
  return e.kind === "ranger" || e.kind === "mage";
}

/** Party members that auto-attack the enemy on their own (tank/ranger/mage).
 * Narrows `kind` so callers can hand it to autoAttackFor without a cast. */
export function isAutoAttacker(
  e: Entity,
): e is Entity & { kind: AutoAttackerKind } {
  return e.kind === "tank" || e.kind === "ranger" || e.kind === "mage";
}
