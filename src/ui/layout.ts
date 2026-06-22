// Screen geometry: where the grid, entities, bars, and buttons live on the
// canvas. Kept separate from drawing so input hit-testing and rendering agree.

import { hexToPixel, type Point } from "../game/hex";
import { HEALER_ACTIONS } from "../game/actions";
import type { ActionDef, Entity, Hex } from "../game/types";

export const CANVAS = { w: 960, h: 720 };
// Only the occupied hexes are drawn (no empty filler), so they're sized large to
// fill the battle area: the party column spans 8 * HEX_SIZE vertically.
export const HEX_SIZE = 60;
// Origin = pixel center of hex (0,0), the tank's tile. Chosen so the column
// (enemy two rows up, healer two rows down) is centered in the battle area.
export const HEX_ORIGIN: Point = { x: 480, y: 285 };

export const TOKEN_RADIUS = 26;

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

export function entityCenter(e: Entity): Point {
  return hexCenter(e.hex);
}

/** HP bar rect, sitting above the token. Kept narrow (so adjacent party tiles'
 * bars never collide) — except the enemy, whose four-digit HP needs more room
 * and which has no neighbors to overlap. */
export function hpBarRect(e: Entity): Rect {
  const c = entityCenter(e);
  const w = e.kind === "enemy" ? 64 : 44;
  return { x: c.x - w / 2, y: c.y - TOKEN_RADIUS - 17, w, h: 11 };
}

/** Mana bar rect, a thin strip tucked under the HP bar. */
export function manaBarRect(e: Entity): Rect {
  const hp = hpBarRect(e);
  return { x: hp.x, y: hp.y + hp.h + 1, w: hp.w, h: 4 };
}

/** Cast-progress bar rect, sitting below the token. Narrow for party tiles
 * (same reason as the HP bar); wider for the lone enemy. */
export function progressBarRect(e: Entity): Rect {
  const c = entityCenter(e);
  const w = e.kind === "enemy" ? 60 : 44;
  return { x: c.x - w / 2, y: c.y + TOKEN_RADIUS + 5, w, h: 6 };
}

/** Fixed-position party frame (HP/mana/cast panel) for slot `i` (0-based).
 * A stable column on the left edge so the player's eyes have a home base
 * instead of chasing tokens around the field. Callers pair these with
 * partySlots() ordering. */
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

export function pointInRect(p: Point, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

export function pointInToken(p: Point, e: Entity): boolean {
  const c = entityCenter(e);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return dx * dx + dy * dy <= TOKEN_RADIUS * TOKEN_RADIUS;
}
