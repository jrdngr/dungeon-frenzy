// Core data model for Dungeon Frenzy. Pure data — no rendering concerns here.

export type EntityKind = "fighter" | "healer" | "enemy";

/** Axial hex coordinate. Movement is not used yet, but the grid is real so
 * later iterations can add movement without reworking positions. */
export interface Hex {
  q: number;
  r: number;
}

/** What an action is allowed to target. */
export type Targeting =
  | "enemy" // the single enemy (fighter attacks)
  | "ally-single" // one chosen living party member
  | "fighters" // both fighters (AoE heal)
  | "party-all" // all party members (enemy AoE)
  | "self";

export type Effect =
  | { kind: "damage"; amount: number }
  | { kind: "heal"; amount: number }
  | { kind: "hot"; perTick: number; interval: number; duration: number }
  | { kind: "aoe-heal"; amount: number }
  | { kind: "aoe-damage"; amount: number }
  | { kind: "shield"; amount: number; duration: number };

export interface ActionDef {
  id: string;
  name: string;
  castTime: number; // seconds
  manaCost?: number; // undefined = free
  targeting: Targeting;
  effect: Effect;
}

/** An action currently being cast by an entity. */
export interface ActionInstance {
  def: ActionDef;
  elapsed: number; // seconds elapsed into the cast
  targetId?: string;
}

/** An active heal-over-time effect riding on an entity. */
export interface HotInstance {
  perTick: number;
  interval: number; // seconds between ticks
  duration: number; // total seconds remaining
  sinceTick: number; // seconds accumulated toward the next tick
}

/** A damage absorb (Brace). Eats up to `amount` from the next hit taken. */
export interface ShieldInstance {
  amount: number;
  remaining: number; // seconds until it expires unused
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
  shield?: ShieldInstance;
  alive: boolean;
  /** Seconds this (party) entity has been idle; 0 while casting or dead. */
  idleFor: number;
  /** Enemy-only: counts completed actions to schedule the periodic AoE. */
  actionCount: number;
  /** Enemy-only: true once HP drops below the enrage threshold. */
  enraged: boolean;
}

/** Things that just happened, for floating combat text and other feedback.
 * The engine appends; the UI reads; old events are pruned each update. */
export type GameEvent =
  | { kind: "damage"; entityId: string; amount: number; blocked: number; at: number }
  | { kind: "heal"; entityId: string; amount: number; at: number }
  | { kind: "shield"; entityId: string; amount: number; at: number }
  | { kind: "enrage"; entityId: string; at: number };

/** Cumulative battle stats, shown on the end screen. */
export interface Stats {
  damageDealt: number; // party -> enemy
  damageTaken: number; // enemy -> party (after blocks)
  healingDone: number; // effective healing (excludes overheal)
  overhealing: number;
  damageBlocked: number;
  idleSeconds: number; // summed across living party members
  deaths: number;
}

export type GamePhase = "playing" | "won" | "lost";

export interface GameState {
  entities: Entity[];
  selectedId?: string; // currently selected party member
  pendingActionId?: string; // action awaiting a target click
  phase: GamePhase;
  elapsedTime: number; // total seconds the battle has run
  events: GameEvent[];
  stats: Stats;
}

export const PARTY_KINDS: EntityKind[] = ["fighter", "healer"];

export function isParty(e: Entity): boolean {
  return e.kind !== "enemy";
}
