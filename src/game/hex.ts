// Axial hex math + pixel layout. Pointy-top hexes. Movement is gone, so this is
// now only the layout/geometry the visual-only grid needs.

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

/** Hex grid distance between two axial coordinates. */
function hexDistance(a: Hex, b: Hex): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** Is `h` within a hex disk of the given radius centered on the origin? */
function inDisk(h: Hex, radius: number): boolean {
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
