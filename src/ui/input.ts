// Click handling: the select -> action -> target state machine.
// Returns true when the player asked to restart (click on the end overlay).

import type { Point } from "../game/hex";
import { startAction } from "../game/engine";
import { findEntity } from "../game/combat";
import type { ActionDef, Entity, GameState } from "../game/types";
import { isParty } from "../game/types";
import {
  actionButtons,
  actionsFor,
  pointInRect,
  pointInToken,
} from "./layout";

/** Ability hotkeys map left-to-right onto the selected unit's action list. */
export const ABILITY_KEYS = ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"];

/** Party members in slot order: top-to-bottom, then left-to-right (by hex).
 * Slot 0 -> key "1", slot 1 -> key "2", etc. Order is stable (positions are
 * fixed), so dead members keep their slot. */
export function partySlots(state: GameState): Entity[] {
  return state.entities
    .filter(isParty)
    .sort((a, b) => a.hex.r - b.hex.r || a.hex.q - b.hex.q);
}

export function handleClick(state: GameState, p: Point): { restart: boolean } {
  if (state.phase !== "playing") {
    return { restart: true };
  }

  // 1. Action buttons take priority when a unit is selected.
  const sel = state.selectedId
    ? findEntity(state, state.selectedId)
    : undefined;
  if (sel && sel.alive) {
    for (const b of actionButtons(sel)) {
      if (pointInRect(p, b.rect)) {
        onActionButton(state, b.def);
        return { restart: false };
      }
    }
  }

  // 2. Clicking an entity token.
  const clicked = state.entities.find(
    (e) => e.alive && pointInToken(p, e),
  );
  if (clicked) {
    activateEntity(state, clicked);
    return { restart: false };
  }

  // 3. Clicked empty space: cancel pending target, else clear selection.
  if (state.pendingActionId) {
    state.pendingActionId = undefined;
  } else {
    state.selectedId = undefined;
  }
  return { restart: false };
}

/** Keyboard input: 1-3 select party members, QWERTY... fire the selected
 * unit's abilities. Returns restart=true if a key dismisses the end screen. */
export function handleKey(state: GameState, rawKey: string): { restart: boolean } {
  if (state.phase !== "playing") {
    return { restart: true };
  }
  const key = rawKey.toLowerCase();

  // Number keys select (or, while targeting, target) a party member by slot.
  if (key >= "1" && key <= "9") {
    const slot = partySlots(state)[Number(key) - 1];
    if (slot && slot.alive) activateEntity(state, slot);
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

/** Shared select-or-target behavior for both clicks and number-key presses. */
function activateEntity(state: GameState, e: Entity): void {
  if (!e.alive || !isParty(e)) return; // enemy isn't selectable/targetable

  const sel = state.selectedId ? findEntity(state, state.selectedId) : undefined;
  if (state.pendingActionId && sel) {
    // Awaiting a target: this party member completes the action.
    const def = actionsFor(sel).find((a) => a.id === state.pendingActionId);
    if (def) startAction(state, sel.id, def, e.id);
    state.pendingActionId = undefined;
    return;
  }
  // Otherwise select it.
  state.selectedId = e.id;
  state.pendingActionId = undefined;
}

function onActionButton(state: GameState, def: ActionDef): void {
  const sel = state.selectedId
    ? findEntity(state, state.selectedId)
    : undefined;
  if (!sel || !sel.alive) return;

  switch (def.targeting) {
    case "ally-single":
      // Needs a target click next.
      state.pendingActionId = def.id;
      break;
    case "enemy":
    case "fighters":
    case "self":
    case "party-all":
      // No target choice needed — start immediately.
      startAction(state, sel.id, def);
      state.pendingActionId = undefined;
      break;
  }
}
