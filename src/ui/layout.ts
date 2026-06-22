// Screen geometry: where the grid, entities, bars, and buttons live on the
// canvas. Kept separate from drawing so input hit-testing and rendering agree.

import { hexToPixel, type Point } from "../game/hex";
import { isBossType } from "../game/actions";
import { healerSpells } from "../game/skills";
import { CONFIG } from "../game/config";
import type { ActionDef, Entity, GameState, Hex } from "../game/types";

export const CANVAS = { w: 960, h: 720 };
// The party column uses large hex tiles (only the 4 occupied party hexes are drawn).
export const HEX_SIZE = 60;
// Origin = pixel center of hex (0,0), the tank's tile.
export const HEX_ORIGIN: Point = { x: 480, y: 285 };

export const TOKEN_RADIUS = 26; // party tokens
const ENEMY_BOSS_RADIUS = 32;
const ENEMY_SMALL_RADIUS = 22;

// Enemy formation zone (kept clear of the party frames on the left edge). Enemies
// fill rows above the party; the frontmost row sits closest to the tank.
const ENEMY_ZONE = { cx: 540, width: 700, maxSpacing: 150, rowGap: 100 };

// Bottom action panel.
export const PANEL = { x: 0, y: 545, w: CANVAS.w, h: CANVAS.h - 545 };

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function hexCenter(hex: Hex): Point {
  return hexToPixel(hex, HEX_SIZE, HEX_ORIGIN);
}

export function entityRadius(e: Entity): number {
  if (e.kind !== "enemy") return TOKEN_RADIUS;
  return isBossType(e.enemyType) ? ENEMY_BOSS_RADIUS : ENEMY_SMALL_RADIUS;
}

/** Pixel center of an entity. Party members use their fixed hex; enemies are laid
 * out from their formation (row/col) so a variable number fit in rows above the
 * party. Layout is computed from ALL enemy entities (incl. corpses) so positions
 * stay put as enemies die. */
export function entityCenter(state: GameState, e: Entity): Point {
  if (e.kind !== "enemy") return hexCenter(e.hex);

  const all = state.entities.filter((x) => x.kind === "enemy");
  const rowKeys = [...new Set(all.map((x) => x.row ?? 0))].sort((a, b) => a - b);
  const myRow = e.row ?? 0;
  const rowFromFront = Math.max(0, rowKeys.indexOf(myRow));
  const frontY = rowKeys.length >= 2 ? 205 : 150;
  const y = frontY - rowFromFront * ENEMY_ZONE.rowGap;

  const peers = all
    .filter((x) => (x.row ?? 0) === myRow)
    .sort((a, b) => (a.col ?? 0) - (b.col ?? 0));
  const n = peers.length;
  const idx = Math.max(0, peers.findIndex((x) => x.id === e.id));
  const spacing = Math.min(ENEMY_ZONE.maxSpacing, ENEMY_ZONE.width / Math.max(1, n));
  const x = ENEMY_ZONE.cx - (spacing * (n - 1)) / 2 + idx * spacing;
  return { x, y };
}

/** HP bar rect, sitting above the token. Narrow for party tiles (so neighbouring
 * bars don't collide); wider for enemies (bosses have four-digit HP). */
export function hpBarRect(state: GameState, e: Entity): Rect {
  const c = entityCenter(state, e);
  const radius = entityRadius(e);
  const w = e.kind === "enemy" ? (isBossType(e.enemyType) ? 70 : 48) : 44;
  return { x: c.x - w / 2, y: c.y - radius - 17, w, h: 11 };
}

/** Mana bar rect, a thin strip tucked under the HP bar. */
export function manaBarRect(state: GameState, e: Entity): Rect {
  const hp = hpBarRect(state, e);
  return { x: hp.x, y: hp.y + hp.h + 1, w: hp.w, h: 4 };
}

/** Cast-progress bar rect, sitting below the token. */
export function progressBarRect(state: GameState, e: Entity): Rect {
  const c = entityCenter(state, e);
  const radius = entityRadius(e);
  const w = e.kind === "enemy" ? (isBossType(e.enemyType) ? 64 : 46) : 44;
  return { x: c.x - w / 2, y: c.y + radius + 5, w, h: 6 };
}

/** Fixed-position party frame (HP/mana/cast panel) for slot `i` (0-based). */
export function partyFrameRect(i: number): Rect {
  return { x: 12, y: 44 + i * 68, w: 150, h: 60 };
}

export interface ActionButton {
  def: ActionDef;
  rect: Rect;
}

/** Lay out the healer's (dynamic 1-5) spell buttons inside the panel. Button width
 * shrinks with the count and the row is centered in the space left of the Quit
 * button so a full 5-spell bar never collides with it. */
export function actionButtons(state: GameState): ActionButton[] {
  const defs = healerSpells(state.skills);
  const count = defs.length;
  const gap = 14;
  const btnH = 64;
  const leftX = 14;
  const rightX = quitButtonRect().x - 14; // keep clear of the Quit button
  const avail = rightX - leftX;
  const btnW = Math.min(164, (avail - (count - 1) * gap) / count);
  const totalW = count * btnW + (count - 1) * gap;
  const startX = leftX + (avail - totalW) / 2;
  const y = PANEL.y + (PANEL.h - btnH) / 2 + 8;
  return defs.map((def, i) => ({
    def,
    rect: { x: startX + i * (btnW + gap), y, w: btnW, h: btnH },
  }));
}

/** Healer cast-progress bar, centered in the bottom panel just above the spell
 * buttons (mirrors the per-token cast bar that used to sit under the healer). */
export function castBarRect(): Rect {
  const w = 460;
  const h = 16;
  return { x: PANEL.x + (PANEL.w - w) / 2, y: PANEL.y + 28, w, h };
}

/** "Quit area" button in the bottom panel (right of the spells): abandons the
 * current run and returns to the hub with no progress recorded. */
export function quitButtonRect(): Rect {
  const w = 104;
  const h = 44;
  return { x: PANEL.x + PANEL.w - w - 18, y: PANEL.y + (PANEL.h - h) / 2 + 8, w, h };
}

/** Area-select hub: one card per area, in a centered row. */
export function areaCardRect(i: number): Rect {
  const n = CONFIG.areas.length;
  const cardW = 165;
  const cardH = 230;
  const gap = 14;
  const totalW = n * cardW + (n - 1) * gap;
  const startX = (CANVAS.w - totalW) / 2;
  return { x: startX + i * (cardW + gap), y: 210, w: cardW, h: cardH };
}

// --- Skill tree overlay ---

export const SKILL_NODE_W = 104;
export const SKILL_NODE_H = 34;

/** Hand-placed node centers for the skill-tree overlay. Three branches: Sustain
 * (left), Healing (center, each spell's upgrades fanned to its right), Party
 * (bottom, one row per member with the active chain flowing right). */
const SKILL_NODE_POS: Record<string, Point> = {
  // Healing — spine at x=440, upgrades at 550/658/766.
  heal: { x: 440, y: 120 },
  "potent-heal": { x: 550, y: 120 },
  "efficient-heal": { x: 658, y: 120 },
  "swift-heal": { x: 766, y: 120 },
  "quick-heal": { x: 440, y: 188 },
  "potent-quick-heal": { x: 550, y: 188 },
  "efficient-quick-heal": { x: 658, y: 188 },
  "swift-quick-heal": { x: 766, y: 188 },
  regen: { x: 440, y: 256 },
  "lingering-regen": { x: 550, y: 256 },
  "efficient-regen": { x: 658, y: 256 },
  "swift-regen": { x: 766, y: 256 },
  "group-heal": { x: 440, y: 324 },
  "wide-grace": { x: 550, y: 324 },
  "efficient-group-heal": { x: 658, y: 324 },
  "swift-group-heal": { x: 766, y: 324 },
  resurrect: { x: 440, y: 392 },
  "greater-resurrection": { x: 550, y: 392 },
  // Sustain — left block.
  "mana-pool": { x: 95, y: 120 },
  meditation: { x: 95, y: 200 },
  "second-wind": { x: 95, y: 320 },
  "crit-heals": { x: 210, y: 168 },
  "overheal-shield": { x: 210, y: 248 },
  "reinforced-shield": { x: 322, y: 248 },
  "field-rations": { x: 210, y: 320 },
  // Party — bottom, one row per member.
  "tank-training": { x: 95, y: 440 },
  "heavy-strikes": { x: 220, y: 414 },
  "shield-wall": { x: 220, y: 466 },
  thorns: { x: 345, y: 466 },
  bulwark: { x: 470, y: 466 },
  deadeye: { x: 95, y: 535 },
  "ranger-training": { x: 220, y: 509 },
  "aimed-shot": { x: 220, y: 561 },
  volley: { x: 345, y: 561 },
  "serpent-sting": { x: 470, y: 561 },
  "arcane-power": { x: 95, y: 630 },
  "mage-training": { x: 220, y: 604 },
  fireball: { x: 220, y: 656 },
  firestorm: { x: 345, y: 656 },
  "arcane-conduit": { x: 470, y: 656 },
};

export function skillNodePos(id: string): Point {
  return SKILL_NODE_POS[id] ?? { x: 0, y: 0 };
}

export function skillNodeRect(id: string): Rect {
  const c = skillNodePos(id);
  return { x: c.x - SKILL_NODE_W / 2, y: c.y - SKILL_NODE_H / 2, w: SKILL_NODE_W, h: SKILL_NODE_H };
}

/** "Skill Tree" button on the hub (below the area cards). */
export function skillTreeButtonRect(): Rect {
  return { x: CANVAS.w / 2 - 120, y: 470, w: 240, h: 46 };
}

/** "Close" button on the skill-tree overlay (top-right). */
export function skillTreeCloseRect(): Rect {
  return { x: CANVAS.w - 104, y: 26, w: 88, h: 34 };
}

/** Dev-only "+5 SP" button (bottom-left of the overlay) for testing the tree. */
export function skillTreeDevSpRect(): Rect {
  return { x: 16, y: CANVAS.h - 48, w: 132, h: 32 };
}

export function pointInRect(p: Point, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

export function pointInToken(state: GameState, p: Point, e: Entity): boolean {
  const c = entityCenter(state, e);
  const radius = entityRadius(e);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return dx * dx + dy * dy <= radius * radius;
}
