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
  spendSkillPoint,
  startArea,
} from "../game/engine";
import { healerSpells } from "../game/skills";
import { CONFIG, SKILL_NODES } from "../game/config";
import type { ActionDef, Entity, GameState } from "../game/types";
import { isParty } from "../game/types";
import {
  actionButtons,
  areaCardRect,
  partyFrameRect,
  pointInRect,
  pointInToken,
  quitButtonRect,
  skillNodeRect,
  skillTreeButtonRect,
  skillTreeCloseRect,
} from "./layout";

/** Ability hotkeys, left-to-right onto the healer's spells (up to 5: Q W E R T). */
export const ABILITY_KEYS = ["q", "w", "e", "r", "t"];

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
    if (state.skillTreeOpen) {
      handleSkillTreeClick(state, p);
      return;
    }
    if (pointInRect(p, skillTreeButtonRect())) {
      state.skillTreeOpen = true;
      return;
    }
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
  // 0. Quit the area (abandon the run, no progress) and return to the hub.
  if (pointInRect(p, quitButtonRect())) {
    returnToHub(state);
    return;
  }

  // 1. Spell buttons (the healer's unlocked heals, dynamic count).
  for (const b of actionButtons(state)) {
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

  // 3. Clicking an entity token: cast on an ally (incl. a dead one, for Resurrect),
  // or focus a living front-row enemy.
  const clicked = state.entities.find(
    (e) => pointInToken(state, p, e) && (e.alive || isParty(e)),
  );
  if (clicked) {
    if (isParty(clicked)) castOnTarget(state, clicked);
    else setFocus(state, clicked.id); // front-row only (validated in setFocus)
  }
}

export function handleKey(state: GameState, rawKey: string): void {
  const key = rawKey.toLowerCase();

  // Non-playing phases: any key continues; the hub also takes 1-N to pick an area.
  if (state.phase !== "playing") {
    if (state.phase === "area-select" && state.skillTreeOpen) {
      if (key === "escape") state.skillTreeOpen = false;
      return;
    }
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
    const def = healerSpells(state.skills)[idx];
    if (def) onSpellButton(state, def);
  }
}

/** Cast the armed spell on `ally` (replacing any cast in progress). The spell
 * stays armed afterward so you can keep clicking targets. Resurrect (ally-dead)
 * needs a dead target; every other heal needs a living one. */
function castOnTarget(state: GameState, ally: Entity): void {
  if (!isParty(ally)) return;
  const h = healerOf(state);
  if (!h || !h.alive || !state.armedSpellId) return;
  const def = healerSpells(state.skills).find((a) => a.id === state.armedSpellId);
  if (!def) return;
  if (def.targeting === "ally-dead" ? ally.alive : !ally.alive) return;
  issueOrder(state, h.id, def, ally.id);
}

/** Clicks inside the skill-tree overlay: close it, or buy the clicked node (the
 * engine validates prereqs/cost). */
function handleSkillTreeClick(state: GameState, p: Point): void {
  if (pointInRect(p, skillTreeCloseRect())) {
    state.skillTreeOpen = false;
    return;
  }
  for (const node of SKILL_NODES) {
    if (pointInRect(p, skillNodeRect(node.id))) {
      spendSkillPoint(state, node.id);
      return;
    }
  }
}

function onSpellButton(state: GameState, def: ActionDef): void {
  const h = healerOf(state);
  if (!h || !h.alive) return;
  if (!canUse(state, def)) return; // button renders greyed out

  // Arm the spell (sticky until Esc or another spell). Re-pressing the armed
  // spell is a no-op; you must click an ally or press 1-4 to cast.
  state.armedSpellId = def.id;
}
