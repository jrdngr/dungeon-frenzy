// Core data model for Dungeon Frenzy. Pure data — no rendering concerns here.

/** Party members that auto-attack the enemy on their own. The player controls
 * only the healer; everyone else in this set is an AI damage dealer. */
export type AutoAttackerKind = "tank" | "ranger" | "mage";

export type EntityKind = AutoAttackerKind | "healer" | "enemy";

/** Axial hex coordinate. Movement is gone — positions are fixed — but the grid
 * is real so the battlefield can be drawn and later iterations can re-add it. */
export interface Hex {
  q: number;
  r: number;
}

/** What an action is allowed to target. */
export type Targeting =
  | "enemy" // the single enemy (party auto-attacks)
  | "ally-single" // one chosen living party member (single-target heals)
  | "party-all" // all living party members (AoE heal / enemy AoE)
  | "line"; // enemy linear hit: a primary target plus one random other

export type Effect =
  | { kind: "damage"; amount: number }
  | { kind: "heal"; amount: number }
  | { kind: "hot"; perTick: number; interval: number; duration: number }
  | { kind: "aoe-heal"; amount: number } // heals all living party
  | { kind: "aoe-damage"; amount: number } // damages all living party (enemy)
  | { kind: "line-damage"; amount: number }; // primary + one random other

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
  /** Line attacks pick a second victim at cast start so the telegraph can show
   * both lines; it is re-validated when the hit lands. */
  secondaryTargetId?: string;
}

/** An active heal-over-time effect riding on an entity. */
export interface HotInstance {
  perTick: number;
  interval: number; // seconds between ticks
  duration: number; // total seconds remaining
  sinceTick: number; // seconds accumulated toward the next tick
}

export interface Entity {
  id: string;
  name: string;
  kind: EntityKind;
  hp: number;
  maxHp: number;
  mana: number; // 0 for entities without a resource
  maxMana: number; // 0 = no mana bar
  hex: Hex;
  current?: ActionInstance; // undefined = idle
  hots: HotInstance[];
  /** Healer-only: spell id -> seconds of cooldown remaining (absent = ready). */
  cooldowns: Record<string, number>;
  alive: boolean;
  /** Enemy-only: counts completed actions to drive the attack rotation. */
  actionCount: number;
  /** Enemy-only: true once HP drops below the enrage threshold. */
  enraged: boolean;
}

/** Things that just happened, for floating combat text and other feedback.
 * The engine appends; the UI reads; old events are pruned each update. */
export type GameEvent =
  | { kind: "damage"; entityId: string; amount: number; at: number }
  | { kind: "heal"; entityId: string; amount: number; at: number }
  | { kind: "enrage"; entityId: string; at: number };

/** Cumulative battle stats, shown on the end screen. */
export interface Stats {
  damageDealt: number; // party -> enemy
  healingDone: number; // effective healing (excludes overheal)
  overhealing: number;
  deaths: number;
}

export type GamePhase = "playing" | "won" | "lost";

export interface GameState {
  entities: Entity[];
  /** The healer's currently armed spell, awaiting a target click. The healer is
   * the implicit, always-the-caster unit; there is no unit-selection step. */
  armedSpellId?: string;
  phase: GamePhase;
  elapsedTime: number; // total game seconds the battle has run
  events: GameEvent[];
  stats: Stats;
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
