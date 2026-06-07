// All canvas drawing. Reads GameState; never mutates it.

import { hexCorners } from "../game/hex";
import type { Entity, GameState } from "../game/types";
import { isParty } from "../game/types";
import { ABILITY_KEYS, partySlots } from "./input";
import {
  actionButtons,
  CANVAS,
  entityCenter,
  HEX_SIZE,
  hpBarRect,
  PANEL,
  progressBarRect,
  TOKEN_RADIUS,
  type Rect,
} from "./layout";

const COLORS = {
  fighter: "#5b8dd6",
  healer: "#5bc98a",
  enemy: "#c9595b",
  dead: "#3a3f4a",
  hpFull: "#5bc98a",
  hpMid: "#d7c08a",
  hpLow: "#c9595b",
  enemyHp: "#c9595b",
  cast: "#8a9bd7",
  enemyCast: "#d79a8a",
  hot: "#5bc98a",
  selected: "#d7c08a",
  target: "#d7c08a",
  text: "#e6e8ee",
  subtext: "#aab2c5",
};

export function render(
  ctx: CanvasRenderingContext2D,
  state: GameState,
): void {
  ctx.clearRect(0, 0, CANVAS.w, CANVAS.h);

  drawGrid(ctx, state);
  drawEntities(ctx, state);
  drawPanel(ctx, state);
  drawStatusBar(ctx, state);

  if (state.phase !== "playing") drawOverlay(ctx, state);
}

function drawGrid(ctx: CanvasRenderingContext2D, state: GameState): void {
  ctx.lineWidth = 1;
  ctx.strokeStyle = "#222733";
  for (const e of state.entities) {
    const center = entityCenter(e);
    const corners = hexCorners(center, HEX_SIZE);
    ctx.beginPath();
    corners.forEach((p, i) =>
      i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y),
    );
    ctx.closePath();
    ctx.stroke();
  }
}

function drawEntities(
  ctx: CanvasRenderingContext2D,
  state: GameState,
): void {
  const pendingTargeting =
    state.pendingActionId !== undefined;
  const slots = partySlots(state); // slot index -> select hotkey (1-based)

  for (const e of state.entities) {
    const c = entityCenter(e);
    const slot = slots.indexOf(e);

    // Selection / valid-target highlight ring.
    if (e.id === state.selectedId) {
      ring(ctx, c.x, c.y, TOKEN_RADIUS + 6, COLORS.selected, 3);
    } else if (pendingTargeting && isValidTarget(e)) {
      ring(ctx, c.x, c.y, TOKEN_RADIUS + 6, COLORS.target, 2);
    }

    // Token.
    ctx.beginPath();
    ctx.arc(c.x, c.y, TOKEN_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = e.alive ? COLORS[e.kind] : COLORS.dead;
    ctx.fill();

    // Label inside token.
    ctx.fillStyle = e.alive ? "#0d0f14" : "#6b7280";
    ctx.font = "bold 13px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(shortName(e), c.x, c.y);

    // Selection-hotkey badge for party members (1-based slot number).
    if (slot >= 0) {
      ctx.fillStyle = COLORS.selected;
      ctx.font = "bold 13px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(slot + 1), c.x - TOKEN_RADIUS + 2, c.y - TOKEN_RADIUS + 2);
    }

    // Name above HP bar.
    ctx.fillStyle = COLORS.subtext;
    ctx.font = "11px system-ui, sans-serif";
    ctx.textBaseline = "bottom";
    ctx.fillText(e.name, c.x, c.y - TOKEN_RADIUS - 26);

    drawHpBar(ctx, e);
    drawProgressBar(ctx, e);

    if (!e.alive) {
      ctx.fillStyle = COLORS.hpLow;
      ctx.font = "bold 12px system-ui, sans-serif";
      ctx.fillText("DEAD", c.x, c.y + TOKEN_RADIUS + 4);
    }
  }
}

function isValidTarget(e: Entity): boolean {
  // Iteration 1: all targeted player actions (heals) target a living party member.
  return isParty(e) && e.alive;
}

function drawHpBar(ctx: CanvasRenderingContext2D, e: Entity): void {
  const r = hpBarRect(e);
  const pct = e.maxHp > 0 ? e.hp / e.maxHp : 0;
  bar(ctx, r, "#1c2029");
  let color: string;
  if (e.kind === "enemy") color = COLORS.enemyHp;
  else if (pct > 0.5) color = COLORS.hpFull;
  else if (pct > 0.25) color = COLORS.hpMid;
  else color = COLORS.hpLow;
  bar(ctx, { ...r, w: r.w * pct }, color);
  // HP number, centered inside the bar. Light text + shadow stays readable on
  // both the colored fill and the dark empty track.
  ctx.font = "bold 10px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillText(`${Math.ceil(e.hp)}/${e.maxHp}`, r.x + r.w / 2 + 1, r.y + r.h / 2 + 2);
  ctx.fillStyle = COLORS.text;
  ctx.fillText(`${Math.ceil(e.hp)}/${e.maxHp}`, r.x + r.w / 2, r.y + r.h / 2 + 1);

  // HoT indicator.
  if (e.alive && e.hots.length > 0) {
    ctx.fillStyle = COLORS.hot;
    ctx.font = "bold 11px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("+", r.x + r.w + 4, r.y + r.h);
  }
}

function drawProgressBar(ctx: CanvasRenderingContext2D, e: Entity): void {
  if (!e.alive) return;
  const r = progressBarRect(e);
  if (!e.current) {
    // Idle: faint empty track only for party members (signals "needs orders").
    if (isParty(e)) {
      bar(ctx, r, "#1c2029");
    }
    return;
  }
  bar(ctx, r, "#1c2029");
  const pct = Math.min(1, e.current.elapsed / e.current.def.castTime);
  const color = e.kind === "enemy" ? COLORS.enemyCast : COLORS.cast;
  bar(ctx, { ...r, w: r.w * pct }, color);

  // Action name under the bar.
  ctx.fillStyle = COLORS.subtext;
  ctx.font = "10px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(e.current.def.name, r.x + r.w / 2, r.y + r.h + 2);
}

function drawPanel(ctx: CanvasRenderingContext2D, state: GameState): void {
  // Panel background.
  ctx.fillStyle = "#10131a";
  ctx.fillRect(PANEL.x, PANEL.y, PANEL.w, PANEL.h);
  ctx.strokeStyle = "#222733";
  ctx.strokeRect(PANEL.x + 0.5, PANEL.y + 0.5, PANEL.w - 1, PANEL.h - 1);

  const sel = state.selectedId
    ? state.entities.find((e) => e.id === state.selectedId)
    : undefined;

  if (!sel || !sel.alive) {
    ctx.fillStyle = COLORS.subtext;
    ctx.font = "14px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(
      "Select a party member to choose an action.",
      PANEL.x + PANEL.w / 2,
      PANEL.y + PANEL.h / 2,
    );
    return;
  }

  if (state.pendingActionId) {
    ctx.fillStyle = COLORS.target;
    ctx.font = "13px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(
      "Choose a target (click a party member) — or click empty space to cancel.",
      PANEL.x + PANEL.w / 2,
      PANEL.y + 10,
    );
  }

  actionButtons(sel).forEach((b, i) => {
    const isPending = state.pendingActionId === b.def.id;
    const hotkey = ABILITY_KEYS[i]?.toUpperCase();
    button(ctx, b.rect, b.def.name, `${b.def.castTime.toFixed(1)}s`, isPending, hotkey);
  });
}

function drawStatusBar(
  ctx: CanvasRenderingContext2D,
  state: GameState,
): void {
  ctx.fillStyle = COLORS.subtext;
  ctx.font = "12px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(`Time: ${state.elapsedTime.toFixed(1)}s`, 12, 12);
}

function drawOverlay(ctx: CanvasRenderingContext2D, state: GameState): void {
  ctx.fillStyle = "rgba(8, 10, 14, 0.78)";
  ctx.fillRect(0, 0, CANVAS.w, PANEL.y);

  const cx = CANVAS.w / 2;
  const cy = PANEL.y / 2;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.fillStyle = state.phase === "won" ? COLORS.hpFull : COLORS.hpLow;
  ctx.font = "bold 48px system-ui, sans-serif";
  ctx.fillText(
    state.phase === "won" ? "Victory!" : "Game Over",
    cx,
    cy - 24,
  );

  ctx.fillStyle = COLORS.text;
  ctx.font = "18px system-ui, sans-serif";
  ctx.fillText(
    `Survived ${state.elapsedTime.toFixed(1)}s · Click anywhere to play again`,
    cx,
    cy + 28,
  );
}

// --- primitives ---

function bar(ctx: CanvasRenderingContext2D, r: Rect, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(r.x, r.y, r.w, r.h);
}

function ring(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
  width: number,
): void {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function button(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  title: string,
  sub: string,
  active: boolean,
  hotkey?: string,
): void {
  ctx.fillStyle = active ? "#2a2f1a" : "#1b2029";
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeStyle = active ? COLORS.selected : "#333a47";
  ctx.lineWidth = active ? 2 : 1;
  ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);

  ctx.fillStyle = COLORS.text;
  ctx.font = "bold 16px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(title, r.x + r.w / 2, r.y + r.h / 2 - 8);

  ctx.fillStyle = COLORS.subtext;
  ctx.font = "12px system-ui, sans-serif";
  ctx.fillText(sub, r.x + r.w / 2, r.y + r.h / 2 + 12);

  // Hotkey badge in the top-left corner.
  if (hotkey) {
    ctx.fillStyle = COLORS.selected;
    ctx.font = "bold 12px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(hotkey, r.x + 8, r.y + 6);
  }
}

function shortName(e: Entity): string {
  if (e.kind === "fighter") return e.id.endsWith("a") ? "F1" : "F2";
  if (e.kind === "healer") return "H";
  return "E";
}
