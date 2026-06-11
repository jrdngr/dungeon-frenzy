// All canvas drawing. Reads GameState; never mutates it.

import {
  hexCorners,
  hexesInDisk,
  hexNeighbors,
  type Point,
} from "../game/hex";
import {
  canMoveTo,
  enemy as findEnemy,
  findEntity,
  inRange,
} from "../game/combat";
import { CONFIG } from "../game/config";
import type { ActionDef, Entity, GameState } from "../game/types";
import { isParty } from "../game/types";
import { ABILITY_KEYS, canUse, partySlots } from "./input";
import {
  actionButtons,
  actionsFor,
  CANVAS,
  entityCenter,
  hexCenter,
  HEX_SIZE,
  hpBarRect,
  manaBarRect,
  PANEL,
  partyFrameRect,
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
  mana: "#5aa9e8",
  shield: "#7fd4f0",
  idle: "#e8b339",
  threat: "#e05a5c",
  selected: "#d7c08a",
  target: "#d7c08a",
  text: "#e6e8ee",
  subtext: "#aab2c5",
  grid: "#222733",
  gridFill: "#11141b",
};

/** Seconds a floating combat-text entry stays on screen. */
const FCT_LIFE = 1.1;

export function render(
  ctx: CanvasRenderingContext2D,
  state: GameState,
): void {
  ctx.clearRect(0, 0, CANVAS.w, CANVAS.h);

  drawGrid(ctx, state);
  drawMoveTargets(ctx, state);
  drawTelegraphs(ctx, state);
  drawEntities(ctx, state);
  drawPartyFrames(ctx, state);
  drawFloatingText(ctx, state);
  drawPanel(ctx, state);
  drawStatusBar(ctx, state);
  if (state.phase === "playing") drawPause(ctx, state);

  if (state.phase !== "playing") drawOverlay(ctx, state);
}

function tracePath(ctx: CanvasRenderingContext2D, pts: Point[]): void {
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
}

function drawGrid(ctx: CanvasRenderingContext2D, state: GameState): void {
  ctx.lineWidth = 1;
  for (const hex of hexesInDisk(state.mapRadius)) {
    const corners = hexCorners(hexCenter(hex), HEX_SIZE);
    tracePath(ctx, corners);
    ctx.fillStyle = COLORS.gridFill;
    ctx.fill();
    ctx.strokeStyle = COLORS.grid;
    ctx.stroke();
  }
}

/** While placing a move, light up the hexes the selected unit may step to. */
function drawMoveTargets(
  ctx: CanvasRenderingContext2D,
  state: GameState,
): void {
  if (!state.pendingActionId || !state.selectedId) return;
  const sel = findEntity(state, state.selectedId);
  if (!sel || !sel.alive) return;
  const def = actionsFor(sel).find((a) => a.id === state.pendingActionId);
  if (!def || def.targeting !== "hex") return;

  for (const hex of hexNeighbors(sel.hex)) {
    if (!canMoveTo(state, sel, hex)) continue;
    const corners = hexCorners(hexCenter(hex), HEX_SIZE - 3);
    tracePath(ctx, corners);
    ctx.fillStyle = "rgba(215, 192, 138, 0.12)";
    ctx.fill();
    ctx.strokeStyle = COLORS.target;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

/** Show what's winding up: a line to the Claw victim, warning rings on
 * everyone while a Roar is incoming, and movement destinations. */
function drawTelegraphs(
  ctx: CanvasRenderingContext2D,
  state: GameState,
): void {
  // Anyone casting a move shows a dashed arrow to the destination hex.
  for (const e of state.entities) {
    if (!e.alive || e.current?.def.effect.kind !== "move" || !e.current.targetHex) {
      continue;
    }
    const from = entityCenter(e);
    const to = hexCenter(e.current.targetHex);
    const color = e.kind === "enemy" ? COLORS.threat : COLORS.subtext;
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.setLineDash([]);
    const corners = hexCorners(to, HEX_SIZE - 6);
    tracePath(ctx, corners);
    ctx.stroke();
    ctx.restore();
  }

  const en = findEnemy(state);
  if (!en || !en.alive || !en.current) return;
  const inst = en.current;
  const progress = Math.min(1, inst.elapsed / inst.def.castTime);
  const c = entityCenter(en);

  if (inst.def.effect.kind === "damage" && inst.targetId) {
    const target = findEntity(state, inst.targetId);
    if (!target || !target.alive) return;
    const t = entityCenter(target);

    ctx.save();
    ctx.globalAlpha = 0.3 + 0.6 * progress;
    ctx.strokeStyle = COLORS.threat;
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 5]);
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(t.x, t.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ring(ctx, t.x, t.y, TOKEN_RADIUS + 8, COLORS.threat, 2);
    ctx.restore();
  }

  if (inst.def.effect.kind === "aoe-damage") {
    const pulse = 1 + Math.sin(state.elapsedTime * 8) * 0.5;
    ctx.save();
    ctx.globalAlpha = (0.3 + 0.5 * progress) * (0.6 + 0.4 * pulse);
    ctx.setLineDash([5, 4]);
    for (const p of state.entities) {
      if (!isParty(p) || !p.alive) continue;
      const pc = entityCenter(p);
      ring(ctx, pc.x, pc.y, TOKEN_RADIUS + 11, COLORS.threat, 3);
    }
    ctx.setLineDash([]);
    ctx.restore();
  }
}

function drawEntities(
  ctx: CanvasRenderingContext2D,
  state: GameState,
): void {
  const sel = state.selectedId ? findEntity(state, state.selectedId) : undefined;
  const pendingDef =
    sel && state.pendingActionId
      ? actionsFor(sel).find((a) => a.id === state.pendingActionId)
      : undefined;
  const slots = partySlots(state); // slot index -> select hotkey (1-based)

  for (const e of state.entities) {
    const c = entityCenter(e);
    const slot = slots.indexOf(e);

    // Selection / valid-target highlight ring.
    if (e.id === state.selectedId) {
      ring(ctx, c.x, c.y, TOKEN_RADIUS + 5, COLORS.selected, 3);
    } else if (
      sel &&
      pendingDef?.targeting === "ally-single" &&
      isParty(e) &&
      e.alive &&
      inRange(sel, pendingDef, e)
    ) {
      ring(ctx, c.x, c.y, TOKEN_RADIUS + 5, COLORS.target, 2);
    }

    // Idle alarm: the whole game is noticing these, so make it loud.
    if (isParty(e) && e.alive && !e.current && e.idleFor > 0.4) {
      const pulse = Math.sin(state.elapsedTime * 7);
      ring(ctx, c.x, c.y, TOKEN_RADIUS + 8 + pulse * 2, COLORS.idle, 3);
      ctx.fillStyle = COLORS.idle;
      ctx.font = "bold 11px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.globalAlpha = 0.65 + 0.35 * pulse;
      ctx.fillText("IDLE!", c.x, c.y + TOKEN_RADIUS + 14);
      ctx.globalAlpha = 1;
    }

    // Enraged enemy seethes.
    if (e.kind === "enemy" && e.alive && e.enraged) {
      const pulse = 0.6 + 0.4 * Math.sin(state.elapsedTime * 6);
      ctx.save();
      ctx.globalAlpha = pulse;
      ring(ctx, c.x, c.y, TOKEN_RADIUS + 5, COLORS.threat, 4);
      ctx.restore();
    }

    // Token.
    ctx.beginPath();
    ctx.arc(c.x, c.y, TOKEN_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = e.alive ? COLORS[e.kind] : COLORS.dead;
    ctx.fill();

    // Brace shield: a tight ring hugging the token.
    if (e.alive && e.shield) {
      ring(ctx, c.x, c.y, TOKEN_RADIUS + 2, COLORS.shield, 3);
    }

    // Label inside token.
    ctx.fillStyle = e.alive ? "#0d0f14" : "#6b7280";
    ctx.font = "bold 12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(shortName(e), c.x, c.y);

    // Selection-hotkey badge for party members (1-based slot number).
    if (slot >= 0 && e.alive) {
      ctx.fillStyle = COLORS.selected;
      ctx.font = "bold 11px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        String(slot + 1),
        c.x - TOKEN_RADIUS + 1,
        c.y - TOKEN_RADIUS + 1,
      );
    }

    drawHpBar(ctx, e);
    if (e.maxMana > 0 && e.alive) drawManaBar(ctx, e);
    if (e.kind === "enemy" && e.alive) drawRoarPips(ctx, e);
    drawProgressBar(ctx, e);

    if (!e.alive) {
      ctx.fillStyle = COLORS.hpLow;
      ctx.font = "bold 11px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText("DEAD", c.x, c.y + TOKEN_RADIUS + 6);
    }
  }
}

/** Fixed unit panels on the left: HP, mana, cast + queued order, idle flash.
 * Clickable exactly like the unit's token, so healing never requires chasing
 * a moving token with the mouse or the eyes. */
function drawPartyFrames(
  ctx: CanvasRenderingContext2D,
  state: GameState,
): void {
  const sel = state.selectedId ? findEntity(state, state.selectedId) : undefined;
  const pendingDef =
    sel && state.pendingActionId
      ? actionsFor(sel).find((a) => a.id === state.pendingActionId)
      : undefined;
  const slots = partySlots(state);

  slots.forEach((e, i) => {
    const r = partyFrameRect(i);

    ctx.fillStyle = "#10131a";
    ctx.fillRect(r.x, r.y, r.w, r.h);

    // Border tells the story: selected, legal heal target, idle, or calm.
    let border = "#333a47";
    let lw = 1;
    let borderAlpha = 1;
    if (e.id === state.selectedId) {
      border = COLORS.selected;
      lw = 2;
    } else if (
      sel &&
      pendingDef?.targeting === "ally-single" &&
      e.alive &&
      inRange(sel, pendingDef, e)
    ) {
      border = COLORS.target;
      lw = 1.5;
    } else if (e.alive && !e.current && e.idleFor > 0.4) {
      border = COLORS.idle;
      lw = 2;
      borderAlpha = 0.55 + 0.45 * Math.sin(state.elapsedTime * 7);
    }
    ctx.save();
    ctx.globalAlpha = borderAlpha;
    ctx.strokeStyle = border;
    ctx.lineWidth = lw;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    ctx.restore();

    // Header: hotkey + name (+ state tag).
    ctx.font = "bold 11px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = COLORS.selected;
    ctx.fillText(String(i + 1), r.x + 6, r.y + 5);
    ctx.fillStyle = e.alive ? COLORS.text : "#6b7280";
    ctx.fillText(e.name, r.x + 18, r.y + 5);
    if (!e.alive) {
      ctx.fillStyle = COLORS.hpLow;
      ctx.textAlign = "right";
      ctx.fillText("DEAD", r.x + r.w - 6, r.y + 5);
    } else if (!e.current && e.idleFor > 0.4) {
      ctx.fillStyle = COLORS.idle;
      ctx.textAlign = "right";
      ctx.fillText("IDLE", r.x + r.w - 6, r.y + 5);
    }

    // HP bar.
    const hp: Rect = { x: r.x + 6, y: r.y + 20, w: r.w - 12, h: 10 };
    bar(ctx, hp, "#1c2029");
    const pct = e.maxHp > 0 ? e.hp / e.maxHp : 0;
    bar(ctx, { ...hp, w: hp.w * pct }, hpColor(e, pct));
    ctx.font = "bold 9px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = COLORS.text;
    ctx.fillText(
      `${Math.ceil(e.hp)}/${e.maxHp}`,
      hp.x + hp.w / 2,
      hp.y + hp.h / 2 + 1,
    );

    // Mana strip.
    if (e.maxMana > 0 && e.alive) {
      const mana: Rect = { x: hp.x, y: hp.y + hp.h + 2, w: hp.w, h: 4 };
      bar(ctx, mana, "#1c2029");
      bar(ctx, { ...mana, w: mana.w * (e.mana / e.maxMana) }, COLORS.mana);
    }

    // Cast progress + current/queued order.
    if (e.alive) {
      const cast: Rect = { x: hp.x, y: r.y + 40, w: hp.w, h: 5 };
      bar(ctx, cast, "#1c2029");
      let label = "—";
      if (e.current) {
        const pctCast = Math.min(1, e.current.elapsed / e.current.def.castTime);
        bar(ctx, { ...cast, w: cast.w * pctCast }, COLORS.cast);
        label = e.current.def.name;
      }
      if (e.queued) label += ` ▸ ${e.queued.def.name}`;
      ctx.font = "9px system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillStyle = e.queued ? COLORS.mana : COLORS.subtext;
      ctx.fillText(label, cast.x, cast.y + 7, hp.w);
    }
  });
}

function hpColor(e: Entity, pct: number): string {
  if (e.kind === "enemy") return COLORS.enemyHp;
  if (pct > 0.5) return COLORS.hpFull;
  if (pct > 0.25) return COLORS.hpMid;
  return COLORS.hpLow;
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
  ctx.font = "bold 9px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillText(`${Math.ceil(e.hp)}/${e.maxHp}`, r.x + r.w / 2 + 1, r.y + r.h / 2 + 2);
  ctx.fillStyle = COLORS.text;
  ctx.fillText(`${Math.ceil(e.hp)}/${e.maxHp}`, r.x + r.w / 2, r.y + r.h / 2 + 1);

  // HoT indicator.
  if (e.alive && e.hots.length > 0) {
    ctx.fillStyle = COLORS.hot;
    ctx.font = "bold 10px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("+", r.x + r.w + 3, r.y + r.h - 2);
  }
}

function drawManaBar(ctx: CanvasRenderingContext2D, e: Entity): void {
  const r = manaBarRect(e);
  bar(ctx, r, "#1c2029");
  const pct = e.mana / e.maxMana;
  bar(ctx, { ...r, w: r.w * pct }, COLORS.mana);
}

/** Pips above the enemy's HP bar counting down to the next Roar: filled =
 * claws done since the last Roar; all filled = Roar is next. */
function drawRoarPips(ctx: CanvasRenderingContext2D, e: Entity): void {
  const hp = hpBarRect(e);
  const total = CONFIG.enemy.aoeEveryNthAction - 1;
  const filled = e.actionCount % CONFIG.enemy.aoeEveryNthAction;
  const gap = 12;
  const y = hp.y - 7;
  const cx = hp.x + hp.w / 2;
  const startX = cx - ((total - 1) * gap) / 2;
  for (let i = 0; i < total; i++) {
    ctx.beginPath();
    ctx.arc(startX + i * gap, y, 3.5, 0, Math.PI * 2);
    if (i < filled) {
      ctx.fillStyle = COLORS.enemyCast;
      ctx.fill();
    } else {
      ctx.strokeStyle = "#4a3a3a";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
  ctx.fillStyle = COLORS.subtext;
  ctx.font = "8px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("roar", startX + total * gap - 2, y);
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
  const isRoar = e.current.def.effect.kind === "aoe-damage";
  const color =
    e.kind === "enemy"
      ? isRoar
        ? COLORS.threat
        : COLORS.enemyCast
      : COLORS.cast;
  bar(ctx, { ...r, w: r.w * pct }, color);

  // Action name under the bar (with the queued order chained on).
  ctx.fillStyle = isRoar ? COLORS.threat : COLORS.subtext;
  ctx.font = isRoar
    ? "bold 9px system-ui, sans-serif"
    : "9px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  let label = isRoar ? `${e.current.def.name}!` : e.current.def.name;
  if (e.queued) label += ` ▸ ${e.queued.def.name}`;
  ctx.fillText(label, r.x + r.w / 2, r.y + r.h + 2);
}

/** Floating combat text driven by sim events: damage, heals, blocks, enrage. */
function drawFloatingText(
  ctx: CanvasRenderingContext2D,
  state: GameState,
): void {
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  for (const ev of state.events) {
    const age = state.elapsedTime - ev.at;

    if (ev.kind === "enrage") {
      if (age > 2.2) continue;
      const e = findEntity(state, ev.entityId);
      if (!e) continue;
      const c = entityCenter(e);
      const t = age / 2.2;
      ctx.globalAlpha = 1 - t * t;
      ctx.fillStyle = COLORS.threat;
      ctx.font = "bold 28px system-ui, sans-serif";
      ctx.fillText("ENRAGED!", c.x, c.y - TOKEN_RADIUS - 38 - t * 24);
      ctx.globalAlpha = 1;
      continue;
    }

    if (age > FCT_LIFE) continue;
    const e = findEntity(state, ev.entityId);
    if (!e) continue;
    const c = entityCenter(e);
    const t = age / FCT_LIFE;
    // Deterministic per-event horizontal jitter so stacked numbers separate.
    const x = c.x + Math.sin(ev.at * 137.1) * 14;
    const y = c.y - TOKEN_RADIUS - 22 - t * 28;
    ctx.globalAlpha = 1 - t * t;

    if (ev.kind === "damage") {
      ctx.fillStyle = COLORS.threat;
      if (ev.amount === 0 && ev.blocked > 0) {
        ctx.font = "bold 12px system-ui, sans-serif";
        ctx.fillStyle = COLORS.shield;
        ctx.fillText("BLOCKED", x, y);
      } else {
        ctx.font = "bold 14px system-ui, sans-serif";
        ctx.fillText(`-${Math.round(ev.amount)}`, x, y);
        if (ev.blocked > 0) {
          ctx.font = "9px system-ui, sans-serif";
          ctx.fillStyle = COLORS.shield;
          ctx.fillText(`(${Math.round(ev.blocked)} blocked)`, x, y + 11);
        }
      }
    } else if (ev.kind === "heal") {
      ctx.fillStyle = COLORS.hot;
      ctx.font = "bold 13px system-ui, sans-serif";
      ctx.fillText(`+${Math.round(ev.amount)}`, x, y);
    } else if (ev.kind === "shield") {
      ctx.fillStyle = COLORS.shield;
      ctx.font = "bold 12px system-ui, sans-serif";
      ctx.fillText("BRACED", x, y);
    } else if (ev.kind === "queue-dropped") {
      ctx.fillStyle = COLORS.idle;
      ctx.font = "bold 12px system-ui, sans-serif";
      ctx.fillText("ORDER LOST", x, y);
    }
    ctx.globalAlpha = 1;
  }
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

  const pendingDef = state.pendingActionId
    ? actionsFor(sel).find((a) => a.id === state.pendingActionId)
    : undefined;
  if (pendingDef) {
    ctx.fillStyle = COLORS.target;
    ctx.font = "13px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(
      pendingDef.targeting === "hex"
        ? "Click a highlighted hex to move there — or click empty space to cancel."
        : "Choose a target (click a party member or press 1-3) — or click empty space to cancel.",
      PANEL.x + PANEL.w / 2,
      PANEL.y + 10,
    );
  }

  // Who's selected (names no longer fit on the battlefield).
  ctx.fillStyle = COLORS.text;
  ctx.font = "bold 13px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(sel.name, PANEL.x + 14, PANEL.y + 10);
  if (sel.maxMana > 0) {
    ctx.fillStyle = COLORS.mana;
    ctx.font = "bold 12px system-ui, sans-serif";
    ctx.fillText(
      `Mana ${Math.floor(sel.mana)}/${sel.maxMana}`,
      PANEL.x + 14,
      PANEL.y + 28,
    );
  }
  if (sel.current) {
    ctx.fillStyle = COLORS.subtext;
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillText("casting — press to queue · X stops", PANEL.x + 14, PANEL.y + 46);
  }
  if (sel.queued) {
    ctx.fillStyle = COLORS.mana;
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillText(`Next: ${sel.queued.def.name}`, PANEL.x + 14, PANEL.y + 62);
  }

  actionButtons(sel).forEach((b, i) => {
    const isPending = state.pendingActionId === b.def.id;
    const hotkey = ABILITY_KEYS[i]?.toUpperCase();
    button(
      ctx,
      b.rect,
      b.def.name,
      buttonSub(b.def),
      isPending,
      hotkey,
      !canUse(state, sel, b.def),
      sel.queued?.def.id === b.def.id,
    );
  });
}

function buttonSub(def: ActionDef): string {
  const parts = [`${def.castTime.toFixed(1)}s`];
  if (def.manaCost !== undefined) parts.push(`${def.manaCost} mana`);
  if (def.targeting === "enemy") parts.push("melee");
  return parts.join(" · ");
}

/** Tactical-pause cue: a cool vignette over the battlefield plus a PAUSED
 * tag, both fading with how far the clock is dialed down so the ease in/out
 * reads on screen instead of feeling like lag. */
function drawPause(ctx: CanvasRenderingContext2D, state: GameState): void {
  const span = 1 - CONFIG.time.pausedScale;
  const strength = Math.min(1, Math.max(0, (1 - state.timeScale) / span));
  if (strength < 0.02) return;

  const cx = PANEL.x + PANEL.w / 2;
  const cy = PANEL.y / 2;
  const g = ctx.createRadialGradient(cx, cy, PANEL.y * 0.45, cx, cy, PANEL.y);
  g.addColorStop(0, "rgba(90, 169, 232, 0)");
  g.addColorStop(1, `rgba(90, 169, 232, ${0.22 * strength})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, CANVAS.w, PANEL.y);

  ctx.globalAlpha = strength;
  ctx.fillStyle = COLORS.mana;
  ctx.font = "bold 13px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText("◷ PAUSED — issue an order or press Esc to resume", cx, 12);
  ctx.globalAlpha = 1;
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

  ctx.textAlign = "right";
  ctx.fillText(
    "1-3 select · Q-T abilities (press while casting to queue) · X stop cast · Esc cancel · M mute",
    CANVAS.w - 12,
    12,
  );
}

function drawOverlay(ctx: CanvasRenderingContext2D, state: GameState): void {
  ctx.fillStyle = "rgba(8, 10, 14, 0.85)";
  ctx.fillRect(0, 0, CANVAS.w, PANEL.y);

  const cx = CANVAS.w / 2;
  const s = state.stats;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.fillStyle = state.phase === "won" ? COLORS.hpFull : COLORS.hpLow;
  ctx.font = "bold 48px system-ui, sans-serif";
  ctx.fillText(state.phase === "won" ? "Victory!" : "Game Over", cx, 150);

  const lines: Array<[string, string]> = [
    ["Time", `${state.elapsedTime.toFixed(1)}s`],
    ["Damage dealt", `${Math.round(s.damageDealt)}`],
    [
      "Healing done",
      `${Math.round(s.healingDone)} (${Math.round(s.overhealing)} overheal)`,
    ],
    ["Damage blocked", `${Math.round(s.damageBlocked)}`],
    ["Party idle time", `${s.idleSeconds.toFixed(1)}s`],
    ["Orders lost", `${s.ordersDropped}`],
    ["Deaths", `${s.deaths}`],
  ];

  ctx.font = "16px system-ui, sans-serif";
  lines.forEach(([label, value], i) => {
    const y = 220 + i * 28;
    ctx.fillStyle = COLORS.subtext;
    ctx.textAlign = "right";
    ctx.fillText(label, cx - 12, y);
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = "left";
    ctx.fillText(value, cx + 12, y);
  });

  ctx.fillStyle = COLORS.subtext;
  ctx.textAlign = "center";
  ctx.font = "15px system-ui, sans-serif";
  ctx.fillText("Click anywhere (or press a key) to play again", cx, 430);
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
  disabled?: boolean,
  queued?: boolean,
): void {
  ctx.fillStyle = disabled ? "#13161c" : active ? "#2a2f1a" : "#1b2029";
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeStyle = active ? COLORS.selected : queued ? COLORS.mana : "#333a47";
  ctx.lineWidth = active || queued ? 2 : 1;
  ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);

  if (queued) {
    ctx.fillStyle = COLORS.mana;
    ctx.font = "bold 9px system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillText("QUEUED", r.x + r.w - 6, r.y + 5);
  }

  ctx.fillStyle = disabled ? "#5a6170" : COLORS.text;
  ctx.font = "bold 15px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(title, r.x + r.w / 2, r.y + r.h / 2 - 8);

  ctx.fillStyle = disabled ? "#4a5160" : COLORS.subtext;
  ctx.font = "11px system-ui, sans-serif";
  ctx.fillText(sub, r.x + r.w / 2, r.y + r.h / 2 + 12);

  // Hotkey badge in the top-left corner.
  if (hotkey) {
    ctx.fillStyle = disabled ? "#4a5160" : COLORS.selected;
    ctx.font = "bold 11px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(hotkey, r.x + 7, r.y + 5);
  }
}

function shortName(e: Entity): string {
  if (e.kind === "fighter") return e.id.endsWith("a") ? "F1" : "F2";
  if (e.kind === "healer") return "H";
  return "E";
}
