// Axial hex math + pixel layout. Pointy-top hexes.

import type { Hex } from "./types";

export interface Point {
  x: number;
  y: number;
}

/** Convert an axial hex coordinate to a pixel center, given a hex size (radius)
 * and an origin offset. Pointy-top orientation. */
export function hexToPixel(hex: Hex, size: number, origin: Point): Point {
  const x = size * Math.sqrt(3) * (hex.q + hex.r / 2);
  const y = size * (3 / 2) * hex.r;
  return { x: origin.x + x, y: origin.y + y };
}

/** Inverse of hexToPixel: which hex contains this pixel point? */
export function pixelToHex(p: Point, size: number, origin: Point): Hex {
  const x = (p.x - origin.x) / size;
  const y = (p.y - origin.y) / size;
  const q = (Math.sqrt(3) / 3) * x - (1 / 3) * y;
  const r = (2 / 3) * y;
  return hexRound(q, r);
}

/** Round fractional axial coordinates to the nearest hex (via cube rounding). */
function hexRound(qf: number, rf: number): Hex {
  const sf = -qf - rf;
  let q = Math.round(qf);
  let r = Math.round(rf);
  const s = Math.round(sf);
  const dq = Math.abs(q - qf);
  const dr = Math.abs(r - rf);
  const ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q, r };
}

/** The six corner points of a pointy-top hex centered at `center`. */
export function hexCorners(center: Point, size: number): Point[] {
  const corners: Point[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    corners.push({
      x: center.x + size * Math.cos(angle),
      y: center.y + size * Math.sin(angle),
    });
  }
  return corners;
}

export function hexEquals(a: Hex, b: Hex): boolean {
  return a.q === b.q && a.r === b.r;
}

/** Hex grid distance between two axial coordinates. */
export function hexDistance(a: Hex, b: Hex): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

const DIRECTIONS: Hex[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

/** The six hexes adjacent to `h`. */
export function hexNeighbors(h: Hex): Hex[] {
  return DIRECTIONS.map((d) => ({ q: h.q + d.q, r: h.r + d.r }));
}

/** Is `h` within a hex disk of the given radius centered on the origin? */
export function inDisk(h: Hex, radius: number): boolean {
  return hexDistance(h, { q: 0, r: 0 }) <= radius;
}

/** All hexes in a disk of the given radius centered on the origin. */
export function hexesInDisk(radius: number): Hex[] {
  const out: Hex[] = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      const h = { q, r };
      if (inDisk(h, radius)) out.push(h);
    }
  }
  return out;
}
