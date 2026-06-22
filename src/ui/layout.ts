// Screen geometry: where the grid, entities, bars, and buttons live on the
// canvas. Kept separate from drawing so input hit-testing and rendering agree.

import { hexToPixel, type Point } from "../game/hex";
import { HEALER_ACTIONS, isBossType } from "../game/actions";
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

/** Lay out the healer's spell buttons inside the panel. */
export function actionButtons(): ActionButton[] {
  const defs = HEALER_ACTIONS;
  const btnW = 164;
  const btnH = 64;
  const gap = 14;
  const totalW = defs.length * btnW + (defs.length - 1) * gap;
  const startX = PANEL.x + (PANEL.w - totalW) / 2;
  const y = PANEL.y + (PANEL.h - btnH) / 2 + 8;
  return defs.map((def, i) => ({
    def,
    rect: { x: startX + i * (btnW + gap), y, w: btnW, h: btnH },
  }));
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
