// Click handling: the select -> action -> target state machine.
// Targets are party members (heals) or hexes (movement). Orders issued while
// a unit is casting are queued (one slot) and auto-start when the cast ends.
// Returns true when the player asked to restart (click on the end overlay).

import type { Point } from "../game/hex";
import { hexNeighbors } from "../game/hex";
import { cancelCast, clearQueue, issueOrder } from "../game/engine";
import {
  canMoveTo,
  enemy,
  fighters,
  findEntity,
  inRange,
} from "../game/combat";
import type { ActionDef, Entity, GameState } from "../game/types";
import { isParty } from "../game/types";
import {
  actionButtons,
  actionsFor,
  hexAtPoint,
  partyFrameRect,
  pointInRect,
  pointInToken,
} from "./layout";

/** Ability hotkeys map left-to-right onto the selected unit's action list. */
export const ABILITY_KEYS = ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"];

/** Party members in slot order. Slot 0 -> key "1", slot 1 -> key "2", etc.
 * Order is by id so it stays stable while entities move around the field. */
export function partySlots(state: GameState): Entity[] {
  return state.entities
    .filter(isParty)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function canAfford(e: Entity, def: ActionDef): boolean {
  return def.manaCost === undefined || e.mana >= def.manaCost;
}

/** Is this action currently usable at all (mana, range, somewhere to go)?
 * Drives both input rejection and the greyed-out button state. While the
 * unit is casting, mana is NOT checked: queued orders may rely on regen and
 * are re-validated when they actually start. */
export function canUse(state: GameState, e: Entity, def: ActionDef): boolean {
  if (!e.current && !canAfford(e, def)) return false;
  switch (def.targeting) {
    case "enemy": {
      const en = enemy(state);
      return !!en && en.alive && inRange(e, def, en);
    }
    case "fighters":
      return fighters(state).some((f) => f.alive && inRange(e, def, f));
    case "hex":
      return hexNeighbors(e.hex).some((h) => canMoveTo(state, e, h));
    default:
      return true;
  }
}

function pendingDefFor(
  state: GameState,
  sel: Entity | undefined,
): ActionDef | undefined {
  if (!sel || !state.pendingActionId) return undefined;
  return actionsFor(sel).find((a) => a.id === state.pendingActionId);
}

export function handleClick(state: GameState, p: Point): { restart: boolean } {
  if (state.phase !== "playing") {
    return { restart: true };
  }

  const sel = state.selectedId
    ? findEntity(state, state.selectedId)
    : undefined;
  const pendingDef = pendingDefFor(state, sel);

  // 1. Action buttons take priority when a unit is selected.
  if (sel && sel.alive) {
    for (const b of actionButtons(sel)) {
      if (pointInRect(p, b.rect)) {
        onActionButton(state, b.def);
        return { restart: false };
      }
    }
  }

  // 2. Party frames behave exactly like clicking the unit's token.
  const slots = partySlots(state);
  for (let i = 0; i < slots.length; i++) {
    if (pointInRect(p, partyFrameRect(i))) {
      targetOrSelect(state, sel, pendingDef, slots[i]);
      return { restart: false };
    }
  }

  // 3. Clicking an entity token.
  const clicked = state.entities.find(
    (e) => e.alive && pointInToken(p, e),
  );
  if (clicked) {
    if (!isParty(clicked)) {
      // The enemy can't be selected or healed; while targeting, treat the
      // click as a cancel rather than silently ignoring it.
      state.pendingActionId = undefined;
      return { restart: false };
    }
    targetOrSelect(state, sel, pendingDef, clicked);
    return { restart: false };
  }

  // 4. While placing a move, clicking a legal hex orders it.
  if (sel && sel.alive && pendingDef?.targeting === "hex") {
    const hex = hexAtPoint(p);
    if (canMoveTo(state, sel, hex)) {
      issueOrder(state, sel.id, pendingDef, undefined, hex);
      state.pendingActionId = undefined;
      return { restart: false };
    }
  }

  // 5. Clicked empty space: cancel pending target, else clear selection.
  if (state.pendingActionId) {
    state.pendingActionId = undefined;
  } else {
    state.selectedId = undefined;
  }
  return { restart: false };
}

/** Keyboard input: 1-3 select party members, QWERTY... fire the selected
 * unit's abilities, X stops the current cast, Escape cancels.
 * Returns restart=true if a key dismisses the end screen. */
export function handleKey(state: GameState, rawKey: string): { restart: boolean } {
  if (state.phase !== "playing") {
    return { restart: true };
  }
  const key = rawKey.toLowerCase();

  // Number keys select (or, while heal-targeting, target) a party member.
  if (key >= "1" && key <= "9") {
    const slot = partySlots(state)[Number(key) - 1];
    if (slot && slot.alive) {
      const sel = state.selectedId
        ? findEntity(state, state.selectedId)
        : undefined;
      targetOrSelect(state, sel, pendingDefFor(state, sel), slot);
    }
    return { restart: false };
  }

  if (key === "escape") {
    if (state.pendingActionId) state.pendingActionId = undefined;
    else state.selectedId = undefined;
    return { restart: false };
  }

  // Stop-cast: abort the selected unit's current cast (mana is never spent
  // mid-cast, so this is free). A queued order starts immediately — the
  // emergency "stop Heavy Swing, Brace now" play.
  if (key === "x") {
    if (state.selectedId) cancelCast(state, state.selectedId);
    return { restart: false };
  }

  // Ability keys act on the selected unit's action list, left to right.
  const abilityIdx = ABILITY_KEYS.indexOf(key);
  if (abilityIdx >= 0) {
    const sel = state.selectedId ? findEntity(state, state.selectedId) : undefined;
    if (sel && sel.alive) {
      const def = actionsFor(sel)[abilityIdx];
      if (def) onActionButton(state, def);
    }
  }
  return { restart: false };
}

/** Shared behavior for clicking/keying a party member (token or frame):
 * completes a pending single-target action when valid, otherwise selects.
 * An out-of-range ally keeps targeting active (the rings show who is legal). */
function targetOrSelect(
  state: GameState,
  sel: Entity | undefined,
  pendingDef: ActionDef | undefined,
  e: Entity,
): void {
  if (!e.alive || !isParty(e)) return;

  if (sel && pendingDef?.targeting === "ally-single") {
    if (inRange(sel, pendingDef, e)) {
      issueOrder(state, sel.id, pendingDef, e.id);
      state.pendingActionId = undefined;
    }
    return;
  }
  state.selectedId = e.id;
  state.pendingActionId = undefined;
}

/** Smart-cast target: lowest HP-fraction living party member in range who is
 * actually missing HP. */
function smartCastTarget(
  state: GameState,
  caster: Entity,
  def: ActionDef,
): Entity | undefined {
  let best: Entity | undefined;
  for (const e of state.entities) {
    if (!isParty(e) || !e.alive || e.hp >= e.maxHp) continue;
    if (!inRange(caster, def, e)) continue;
    if (!best || e.hp / e.maxHp < best.hp / best.maxHp) best = e;
  }
  return best;
}

function onActionButton(state: GameState, def: ActionDef): void {
  const sel = state.selectedId
    ? findEntity(state, state.selectedId)
    : undefined;
  if (!sel || !sel.alive) return;

  // Re-pressing an ability that is already queued un-queues it.
  if (sel.queued?.def.id === def.id) {
    clearQueue(state, sel.id);
    return;
  }

  if (!canUse(state, sel, def)) return; // button renders greyed out

  switch (def.targeting) {
    case "ally-single":
      if (state.pendingActionId === def.id) {
        // Smart-cast: re-press fires on the most-wounded ally in range.
        const target = smartCastTarget(state, sel, def);
        if (target) {
          issueOrder(state, sel.id, def, target.id);
          state.pendingActionId = undefined;
        }
      } else {
        state.pendingActionId = def.id;
      }
      break;
    case "hex":
      // Needs a hex click next; pressing the same action again cancels.
      state.pendingActionId =
        state.pendingActionId === def.id ? undefined : def.id;
      break;
    case "enemy":
    case "fighters":
    case "self":
    case "party-all":
      // No target choice needed — start (or queue) immediately.
      issueOrder(state, sel.id, def);
      state.pendingActionId = undefined;
      break;
  }
}
