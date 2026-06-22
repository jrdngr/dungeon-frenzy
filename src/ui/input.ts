// Input handling for the healing game. The healer is the implicit, always-the-
// caster unit — there is no unit-selection step. Hotkeys / buttons ARM a spell;
// clicking a target ally casts it; the armed spell stays armed (sticky) so you
// can keep clicking targets. There is no queue: an order issued while the healer
// is mid-cast replaces that cast (interrupting wastes nothing). Clicking a
// front-row enemy sets the party's focus-fire target.

import type { Point } from "../game/hex";
import {
  advanceFight,
  cancelCast,
  issueOrder,
  returnToHub,
  setFocus,
  startArea,
} from "../game/engine";
import { HEALER_ACTIONS } from "../game/actions";
import { CONFIG } from "../game/config";
import type { ActionDef, Entity, GameState } from "../game/types";
import { isParty } from "../game/types";
import {
  actionButtons,
  areaCardRect,
  partyFrameRect,
  pointInRect,
  pointInToken,
} from "./layout";

/** Ability hotkeys, left-to-right onto the healer's four spells (Q W E R). */
export const ABILITY_KEYS = ["q", "w", "e", "r"];

const ROLE_ORDER: Record<string, number> = {
  tank: 0,
  ranger: 1,
  mage: 2,
  healer: 3,
};

/** Party members in a fixed role order: tank, ranger, mage, healer. Slot 0 ->
 * key "1", etc. Drives party frames, number-key targeting, and audio pitches. */
export function partySlots(state: GameState): Entity[] {
  return state.entities
    .filter(isParty)
    .sort((a, b) => (ROLE_ORDER[a.kind] ?? 9) - (ROLE_ORDER[b.kind] ?? 9));
}

/** The healer — the only unit the player controls. */
export function healerOf(state: GameState): Entity | undefined {
  return state.entities.find((e) => e.kind === "healer");
}

/** An area is playable if it's the first or the previous one has been cleared. */
export function areaUnlocked(state: GameState, i: number): boolean {
  return i === 0 || !!state.clearedAreas[i - 1];
}

export function canAfford(e: Entity, def: ActionDef): boolean {
  return def.manaCost === undefined || e.mana >= def.manaCost;
}

function offCooldown(e: Entity, def: ActionDef): boolean {
  return (e.cooldowns[def.id] ?? 0) <= 0;
}

/** Is this spell castable right now? Drives input rejection and the greyed-out
 * button. */
export function canUse(state: GameState, def: ActionDef): boolean {
  const h = healerOf(state);
  if (!h || !h.alive) return false;
  if (!canAfford(h, def)) return false;
  if (!offCooldown(h, def)) return false;
  return true;
}

export function handleClick(state: GameState, p: Point): void {
  // Non-playing phases: the hub picks an area; the interstitials/overlays advance.
  if (state.phase === "area-select") {
    for (let i = 0; i < CONFIG.areas.length; i++) {
      if (pointInRect(p, areaCardRect(i)) && areaUnlocked(state, i)) {
        startArea(state, i);
        return;
      }
    }
    return;
  }
  if (state.phase === "fight-cleared") {
    advanceFight(state);
    return;
  }
  if (state.phase === "area-cleared" || state.phase === "defeat") {
    returnToHub(state);
    return;
  }

  // Playing.
  // 1. Spell buttons (always the healer's four heals).
  for (const b of actionButtons()) {
    if (pointInRect(p, b.rect)) {
      onSpellButton(state, b.def);
      return;
    }
  }

  // 2. Party frames behave exactly like clicking the unit's token.
  const slots = partySlots(state);
  for (let i = 0; i < slots.length; i++) {
    if (pointInRect(p, partyFrameRect(i))) {
      castOnTarget(state, slots[i]);
      return;
    }
  }

  // 3. Clicking an entity token: cast on an ally, or focus a front-row enemy.
  const clicked = state.entities.find((e) => e.alive && pointInToken(state, p, e));
  if (clicked) {
    if (isParty(clicked)) castOnTarget(state, clicked);
    else if (clicked.kind === "enemy") setFocus(state, clicked.id); // front-row only
  }
}

export function handleKey(state: GameState, rawKey: string): void {
  const key = rawKey.toLowerCase();

  // Non-playing phases: any key continues; the hub also takes 1-N to pick an area.
  if (state.phase !== "playing") {
    if (state.phase === "fight-cleared") {
      advanceFight(state);
    } else if (state.phase === "area-cleared" || state.phase === "defeat") {
      returnToHub(state);
    } else if (state.phase === "area-select" && key >= "1" && key <= "9") {
      const i = Number(key) - 1;
      if (i < CONFIG.areas.length && areaUnlocked(state, i)) startArea(state, i);
    }
    return;
  }

  // Number keys cast the armed spell on a party member by slot.
  if (key >= "1" && key <= "9") {
    const slot = partySlots(state)[Number(key) - 1];
    if (slot) castOnTarget(state, slot);
    return;
  }

  if (key === "escape") {
    state.armedSpellId = undefined;
    return;
  }

  // Stop-cast: abort the healer's current cast (free).
  if (key === "x") {
    const h = healerOf(state);
    if (h) cancelCast(state, h.id);
    return;
  }

  // Ability keys arm the healer's spells, left to right.
  const idx = ABILITY_KEYS.indexOf(key);
  if (idx >= 0) {
    const def = HEALER_ACTIONS[idx];
    if (def) onSpellButton(state, def);
  }
}

/** Cast the armed spell on `ally` (replacing any cast in progress). The spell
 * stays armed afterward so you can keep clicking targets. */
function castOnTarget(state: GameState, ally: Entity): void {
  if (!ally.alive || !isParty(ally)) return;
  const h = healerOf(state);
  if (!h || !h.alive || !state.armedSpellId) return;
  const def = HEALER_ACTIONS.find((a) => a.id === state.armedSpellId);
  if (def) issueOrder(state, h.id, def, ally.id);
}

function onSpellButton(state: GameState, def: ActionDef): void {
  const h = healerOf(state);
  if (!h || !h.alive) return;
  if (!canUse(state, def)) return; // button renders greyed out

  // Arm the spell (sticky until Esc or another spell). Re-pressing the armed
  // spell is a no-op; you must click an ally or press 1-4 to cast.
  state.armedSpellId = def.id;
}
