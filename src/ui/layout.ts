// Screen geometry: where the grid, entities, bars, and buttons live on the
// canvas. Kept separate from drawing so input hit-testing and rendering agree.

import { hexToPixel, pixelToHex, type Point } from "../game/hex";
import {
  FIGHTER_ACTIONS,
  HEALER_ACTIONS,
} from "../game/actions";
import type { ActionDef, Entity, Hex } from "../game/types";

export const CANVAS = { w: 960, h: 720 };
// Sized so a radius-3 hex disk (the whole battlefield) fits the battle area.
export const HEX_SIZE = 46;
// Origin = pixel center of hex (0,0), the middle of the disk.
export const HEX_ORIGIN: Point = { x: 480, y: 272 };

export const TOKEN_RADIUS = 22;

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

/** Which hex (if any grid math applies) contains this pixel point? */
export function hexAtPoint(p: Point): Hex {
  return pixelToHex(p, HEX_SIZE, HEX_ORIGIN);
}

/** HP bar rect, sitting above the token. Tall enough to hold the HP number. */
export function hpBarRect(e: Entity): Rect {
  const c = entityCenter(e);
  const w = 60;
  return { x: c.x - w / 2, y: c.y - TOKEN_RADIUS - 17, w, h: 11 };
}

/** Mana bar rect, a thin strip tucked under the HP bar. */
export function manaBarRect(e: Entity): Rect {
  const hp = hpBarRect(e);
  return { x: hp.x, y: hp.y + hp.h + 1, w: hp.w, h: 4 };
}

/** Cast-progress bar rect, sitting below the token. */
export function progressBarRect(e: Entity): Rect {
  const c = entityCenter(e);
  const w = 56;
  return { x: c.x - w / 2, y: c.y + TOKEN_RADIUS + 5, w, h: 6 };
}

export interface ActionButton {
  def: ActionDef;
  rect: Rect;
}

export function actionsFor(e: Entity): ActionDef[] {
  if (e.kind === "fighter") return FIGHTER_ACTIONS;
  if (e.kind === "healer") return HEALER_ACTIONS;
  return [];
}

/** Lay out action buttons for the selected entity inside the panel. */
export function actionButtons(e: Entity): ActionButton[] {
  const defs = actionsFor(e);
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
