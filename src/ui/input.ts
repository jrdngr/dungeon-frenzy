// Input handling for the healing game. The healer is the implicit, always-the-
// caster unit — there is no unit-selection step. Hotkeys / buttons ARM a spell;
// clicking a target ally casts it; the armed spell stays armed (sticky) so you
// can keep clicking targets. There is no queue: an order issued while the healer
// is mid-cast replaces that cast (interrupting wastes nothing).
// Returns restart=true when any input dismisses the end screen.

import type { Point } from "../game/hex";
import { cancelCast, issueOrder } from "../game/engine";
import { HEALER_ACTIONS } from "../game/actions";
import type { ActionDef, Entity, GameState } from "../game/types";
import { isParty } from "../game/types";
import {
  actionButtons,
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

export function canAfford(e: Entity, def: ActionDef): boolean {
  return def.manaCost === undefined || e.mana >= def.manaCost;
}

function offCooldown(e: Entity, def: ActionDef): boolean {
  return (e.cooldowns[def.id] ?? 0) <= 0;
}

/** Is this spell castable right now? Drives input rejection and the greyed-out
 * button. With no queue, an order takes effect immediately (replacing any cast
 * in progress), so mana and cooldown are always checked. */
export function canUse(state: GameState, def: ActionDef): boolean {
  const h = healerOf(state);
  if (!h || !h.alive) return false;
  if (!canAfford(h, def)) return false;
  if (!offCooldown(h, def)) return false;
  return true;
}

export function handleClick(state: GameState, p: Point): { restart: boolean } {
  if (state.phase !== "playing") return { restart: true };

  // 1. Spell buttons (always the healer's four heals).
  for (const b of actionButtons()) {
    if (pointInRect(p, b.rect)) {
      onSpellButton(state, b.def);
      return { restart: false };
    }
  }

  // 2. Party frames behave exactly like clicking the unit's token.
  const slots = partySlots(state);
  for (let i = 0; i < slots.length; i++) {
    if (pointInRect(p, partyFrameRect(i))) {
      castOnTarget(state, slots[i]);
      return { restart: false };
    }
  }

  // 3. Clicking an entity token: cast on an ally; the enemy can't be targeted.
  const clicked = state.entities.find((e) => e.alive && pointInToken(p, e));
  if (clicked && isParty(clicked)) castOnTarget(state, clicked);

  // 4. Clicking the enemy or empty space is a no-op (Escape clears the spell).
  return { restart: false };
}

export function handleKey(
  state: GameState,
  rawKey: string,
): { restart: boolean } {
  if (state.phase !== "playing") return { restart: true };
  const key = rawKey.toLowerCase();

  // Number keys cast the armed spell on a party member by slot.
  if (key >= "1" && key <= "9") {
    const slot = partySlots(state)[Number(key) - 1];
    if (slot) castOnTarget(state, slot);
    return { restart: false };
  }

  if (key === "escape") {
    state.armedSpellId = undefined;
    return { restart: false };
  }

  // Stop-cast: abort the healer's current cast. Mana/cooldown only commit on
  // completion, so this is free.
  if (key === "x") {
    const h = healerOf(state);
    if (h) cancelCast(state, h.id);
    return { restart: false };
  }

  // Ability keys arm (or smart-cast) the healer's spells, left to right.
  const idx = ABILITY_KEYS.indexOf(key);
  if (idx >= 0) {
    const def = HEALER_ACTIONS[idx];
    if (def) onSpellButton(state, def);
  }
  return { restart: false };
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

/** Smart-cast target: lowest HP-fraction living party member missing HP. */
function smartCastTarget(state: GameState): Entity | undefined {
  let best: Entity | undefined;
  for (const e of state.entities) {
    if (!isParty(e) || !e.alive || e.hp >= e.maxHp) continue;
    if (!best || e.hp / e.maxHp < best.hp / best.maxHp) best = e;
  }
  return best;
}

function onSpellButton(state: GameState, def: ActionDef): void {
  const h = healerOf(state);
  if (!h || !h.alive) return;

  if (!canUse(state, def)) return; // button renders greyed out

  if (state.armedSpellId === def.id) {
    // Smart-cast: re-press fires on the most-wounded ally. Stays armed.
    const target = smartCastTarget(state);
    if (target) issueOrder(state, h.id, def, target.id);
  } else {
    state.armedSpellId = def.id; // arm it (sticky until Esc or another spell)
  }
}
