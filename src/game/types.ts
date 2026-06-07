// Core data model for Dungeon Frenzy. Pure data — no rendering concerns here.

export type EntityKind = "fighter" | "healer" | "enemy";

/** Axial hex coordinate. Movement is not used in iteration 1, but the grid is
 * real so later iterations can add movement without reworking positions. */
export interface Hex {
  q: number;
  r: number;
}

/** What an action is allowed to target. */
export type Targeting =
  | "enemy" // the single enemy (fighter attack)
  | "ally-single" // one chosen living party member
  | "fighters" // both fighters (AoE heal)
  | "party-all" // all party members (enemy AoE)
  | "self";

export type Effect =
  | { kind: "damage"; amount: number }
  | { kind: "heal"; amount: number }
  | { kind: "hot"; perTick: number; interval: number; duration: number }
  | { kind: "aoe-heal"; amount: number }
  | { kind: "aoe-damage"; amount: number };

export interface ActionDef {
  id: string;
  name: string;
  castTime: number; // seconds
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

export interface Entity {
  id: string;
  name: string;
  kind: EntityKind;
  hp: number;
  maxHp: number;
  hex: Hex;
  current?: ActionInstance; // undefined = idle
  hots: HotInstance[];
  alive: boolean;
  /** Enemy-only: counts completed actions to schedule the periodic AoE. */
  actionCount: number;
}

export type GamePhase = "playing" | "won" | "lost";

export interface GameState {
  entities: Entity[];
  selectedId?: string; // currently selected party member
  pendingActionId?: string; // action awaiting a target click
  phase: GamePhase;
  elapsedTime: number; // total seconds the battle has run
}

export const PARTY_KINDS: EntityKind[] = ["fighter", "healer"];

export function isParty(e: Entity): boolean {
  return e.kind !== "enemy";
}
