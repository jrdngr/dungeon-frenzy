// All canvas drawing. Reads GameState; never mutates it.

import { hexCorners, type Point } from "../game/hex";
import {
  findEntity,
  focusedEnemy,
  frontRowEnemies,
} from "../game/combat";
import { enemyType, isBossType } from "../game/actions";
import { CONFIG } from "../game/config";
import type { ActionDef, Entity, GameState } from "../game/types";
import { isParty } from "../game/types";
import { ABILITY_KEYS, areaUnlocked, canUse, partySlots } from "./input";
import {
  actionButtons,
  areaCardRect,
  CANVAS,
  entityCenter,
  entityRadius,
  HEX_SIZE,
  hpBarRect,
  manaBarRect,
  PANEL,
  partyFrameRect,
  pointInRect,
  progressBarRect,
  quitButtonRect,
  type Rect,
} from "./layout";

const COLORS = {
  tank: "#5b8dd6",
  ranger: "#6cc06c",
  mage: "#a87fe0",
  healer: "#5bc98a",
  enemy: "#c9595b",
  boss: "#d4504f",
  dead: "#3a3f4a",
  hpFull: "#5bc98a",
  hpMid: "#d7c08a",
  hpLow: "#c9595b",
  enemyHp: "#c9595b",
  cast: "#8a9bd7",
  enemyCast: "#d79a8a",
  line: "#e8a13a",
  curse: "#b06cd9",
  smash: "#ff5a4d",
  hot: "#5bc98a",
  mana: "#5aa9e8",
  threat: "#e05a5c",
  armed: "#d7c08a",
  target: "#d7c08a",
  focus: "#f2e85c",
  targetable: "#7d7a52",
  cooldown: "rgba(9, 11, 16, 0.6)",
  text: "#e6e8ee",
  subtext: "#aab2c5",
  locked: "#5a6170",
  cleared: "#5bc98a",
  grid: "#222733",
  gridFill: "#11141b",
};

/** Seconds a floating combat-text entry stays on screen. */
const FCT_LIFE = 1.1;

export function render(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  mouse: Point | null = null,
): void {
  ctx.clearRect(0, 0, CANVAS.w, CANVAS.h);

  if (state.phase === "area-select") {
    drawHub(ctx, state, mouse);
    return;
  }

  drawGrid(ctx, state);
  drawTelegraphs(ctx, state);
  drawEntities(ctx, state);
  drawPartyFrames(ctx, state);
  drawFloatingText(ctx, state);
  drawPanel(ctx, state, mouse);
  drawStatusBar(ctx, state);

  if (state.phase === "playing" && mouse) drawSpellTooltip(ctx, mouse);
  if (state.phase !== "playing") drawOverlay(ctx, state);
}

function tracePath(ctx: CanvasRenderingContext2D, pts: Point[]): void {
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
}

/** A tile under each entity — large hexes for the party column, small ones under
 * each enemy token. */
function drawGrid(ctx: CanvasRenderingContext2D, state: GameState): void {
  ctx.lineWidth = 1.5;
  for (const e of state.entities) {
    const c = entityCenter(state, e);
    const size = e.kind === "enemy" ? entityRadius(e) + 7 : HEX_SIZE;
    tracePath(ctx, hexCorners(c, size));
    ctx.fillStyle = COLORS.gridFill;
    ctx.fill();
    ctx.strokeStyle = COLORS.grid;
    ctx.stroke();
  }
}

function threatLine(
  ctx: CanvasRenderingContext2D,
  from: Point,
  to: Point,
  progress: number,
  color: string,
  radius: number,
  width = 2,
): void {
  ctx.save();
  ctx.globalAlpha = 0.3 + 0.6 * progress;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash([7, 5]);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ring(ctx, to.x, to.y, radius + 8, color, width);
  ctx.restore();
}

/** Show every living enemy's wind-up: a line to a Claw victim (thicker/red for a
 * Heavy Smash), purple lines for a Curse, two/three lines for a Cleave, and
 * warning rings on the party for a Roar (AoE). */
function drawTelegraphs(ctx: CanvasRenderingContext2D, state: GameState): void {
  for (const en of state.entities) {
    if (en.kind !== "enemy" || !en.alive || !en.current) continue;
    const inst = en.current;
    const progress = Math.min(1, inst.elapsed / inst.def.castTime);
    const c = entityCenter(state, en);
    const kind = inst.def.effect.kind;

    if (kind === "damage") {
      const t = inst.targetId ? findEntity(state, inst.targetId) : undefined;
      if (t && t.alive) {
        const smash = inst.def.name === "Heavy Smash";
        threatLine(
          ctx,
          c,
          entityCenter(state, t),
          progress,
          smash ? COLORS.smash : COLORS.threat,
          entityRadius(t),
          smash ? 4 : 2,
        );
      }
    } else if (kind === "dot") {
      const t = inst.targetId ? findEntity(state, inst.targetId) : undefined;
      if (t && t.alive) {
        threatLine(ctx, c, entityCenter(state, t), progress, COLORS.curse, entityRadius(t));
      }
    } else if (kind === "line-damage") {
      for (const id of inst.victimIds ?? []) {
        const t = findEntity(state, id);
        if (t && t.alive) {
          threatLine(ctx, c, entityCenter(state, t), progress, COLORS.line, entityRadius(t));
        }
      }
    } else if (kind === "aoe-damage") {
      const pulse = 1 + Math.sin(state.elapsedTime * 8) * 0.5;
      ctx.save();
      ctx.globalAlpha = (0.3 + 0.5 * progress) * (0.6 + 0.4 * pulse);
      ctx.setLineDash([5, 4]);
      for (const p of state.entities) {
        if (!isParty(p) || !p.alive) continue;
        const pc = entityCenter(state, p);
        ring(ctx, pc.x, pc.y, entityRadius(p) + 11, COLORS.threat, 3);
      }
      ctx.setLineDash([]);
      ctx.restore();
    }
  }
}

function drawEntities(ctx: CanvasRenderingContext2D, state: GameState): void {
  const armed = !!state.armedSpellId;
  const slots = partySlots(state);
  const front = new Set(frontRowEnemies(state).map((e) => e.id));
  const focus = focusedEnemy(state);

  for (const e of state.entities) {
    const c = entityCenter(state, e);
    const radius = entityRadius(e);
    const slot = slots.indexOf(e);
    const backRow = e.kind === "enemy" && e.alive && !front.has(e.id);

    ctx.save();
    if (!e.alive) ctx.globalAlpha = 0.32; // corpse
    else if (backRow) ctx.globalAlpha = 0.55; // shielded back row

    // Target/focus affordances.
    if (armed && isParty(e) && e.alive) {
      ring(ctx, c.x, c.y, radius + 5, COLORS.target, 2);
    }
    if (e.kind === "enemy" && e.alive) {
      if (focus && focus.id === e.id) ring(ctx, c.x, c.y, radius + 5, COLORS.focus, 3);
      else if (front.has(e.id)) ring(ctx, c.x, c.y, radius + 5, COLORS.targetable, 1.5);
    }

    // Enraged enemy seethes.
    if (e.kind === "enemy" && e.alive && e.enraged) {
      const pulse = 0.6 + 0.4 * Math.sin(state.elapsedTime * 6);
      ctx.save();
      ctx.globalAlpha = pulse;
      ring(ctx, c.x, c.y, radius + 5, COLORS.threat, 4);
      ctx.restore();
    }

    // Token.
    ctx.beginPath();
    ctx.arc(c.x, c.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = e.alive ? tokenColor(e) : COLORS.dead;
    ctx.fill();

    // Label inside token.
    ctx.fillStyle = e.alive ? "#0d0f14" : "#6b7280";
    ctx.font = "bold 12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(shortName(e), c.x, c.y);

    // Target-hotkey badge for party members.
    if (slot >= 0 && e.alive) {
      ctx.fillStyle = COLORS.armed;
      ctx.font = "bold 11px system-ui, sans-serif";
      ctx.fillText(String(slot + 1), c.x - radius + 1, c.y - radius + 1);
    }

    if (e.alive) {
      drawHpBar(ctx, state, e);
      if (e.maxMana > 0) drawManaBar(ctx, state, e);
      if (e.kind === "enemy" && isBossType(e.enemyType)) drawRotationIndicator(ctx, state, e);
      drawProgressBar(ctx, state, e);
      drawCurseMark(ctx, state, e);
    } else if (isParty(e)) {
      ctx.fillStyle = COLORS.hpLow;
      ctx.font = "bold 11px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText("DEAD", c.x, c.y + radius + 6);
    }

    ctx.restore();
  }
}

function tokenColor(e: Entity): string {
  if (e.kind === "enemy") return isBossType(e.enemyType) ? COLORS.boss : COLORS.enemy;
  return COLORS[e.kind];
}

/** Fixed unit panels on the left: HP, mana, cast. */
function drawPartyFrames(ctx: CanvasRenderingContext2D, state: GameState): void {
  const armed = !!state.armedSpellId;
  const slots = partySlots(state);

  slots.forEach((e, i) => {
    const r = partyFrameRect(i);

    ctx.fillStyle = "#10131a";
    ctx.fillRect(r.x, r.y, r.w, r.h);

    let border = "#333a47";
    let lw = 1;
    if (armed && e.alive) {
      border = COLORS.target;
      lw = 1.5;
    }
    ctx.strokeStyle = border;
    ctx.lineWidth = lw;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);

    ctx.font = "bold 11px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = COLORS.armed;
    ctx.fillText(String(i + 1), r.x + 6, r.y + 5);
    ctx.fillStyle = e.alive ? COLORS.text : "#6b7280";
    ctx.fillText(e.name, r.x + 18, r.y + 5);
    if (!e.alive) {
      ctx.fillStyle = COLORS.hpLow;
      ctx.textAlign = "right";
      ctx.fillText("DEAD", r.x + r.w - 6, r.y + 5);
    } else if (e.hots.some((h) => h.hostile)) {
      ctx.fillStyle = COLORS.curse;
      ctx.textAlign = "right";
      ctx.fillText("CURSED", r.x + r.w - 6, r.y + 5);
    }

    const hp: Rect = { x: r.x + 6, y: r.y + 20, w: r.w - 12, h: 10 };
    bar(ctx, hp, "#1c2029");
    const pct = e.maxHp > 0 ? e.hp / e.maxHp : 0;
    bar(ctx, { ...hp, w: hp.w * pct }, hpColor(e, pct));
    ctx.font = "bold 9px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = COLORS.text;
    ctx.fillText(`${Math.ceil(e.hp)}/${e.maxHp}`, hp.x + hp.w / 2, hp.y + hp.h / 2 + 1);

    if (e.maxMana > 0 && e.alive) {
      const mana: Rect = { x: hp.x, y: hp.y + hp.h + 2, w: hp.w, h: 4 };
      bar(ctx, mana, "#1c2029");
      bar(ctx, { ...mana, w: mana.w * (e.mana / e.maxMana) }, COLORS.mana);
    }

    if (e.alive) {
      const cast: Rect = { x: hp.x, y: r.y + 40, w: hp.w, h: 5 };
      bar(ctx, cast, "#1c2029");
      let label = "—";
      if (e.current) {
        const pctCast = Math.min(1, e.current.elapsed / e.current.def.castTime);
        bar(ctx, { ...cast, w: cast.w * pctCast }, COLORS.cast);
        label = e.current.def.name;
      }
      ctx.font = "9px system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillStyle = COLORS.subtext;
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

function drawHpBar(ctx: CanvasRenderingContext2D, state: GameState, e: Entity): void {
  const r = hpBarRect(state, e);
  const pct = e.maxHp > 0 ? e.hp / e.maxHp : 0;
  bar(ctx, r, "#1c2029");
  bar(ctx, { ...r, w: r.w * pct }, hpColor(e, pct));
  ctx.font = "bold 9px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillText(`${Math.ceil(e.hp)}/${e.maxHp}`, r.x + r.w / 2 + 1, r.y + r.h / 2 + 2);
  ctx.fillStyle = COLORS.text;
  ctx.fillText(`${Math.ceil(e.hp)}/${e.maxHp}`, r.x + r.w / 2, r.y + r.h / 2 + 1);

  if (e.alive && e.hots.some((h) => !h.hostile)) {
    ctx.fillStyle = COLORS.hot;
    ctx.font = "bold 10px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("+", r.x + r.w + 3, r.y + r.h - 2);
  }
}

function drawManaBar(ctx: CanvasRenderingContext2D, state: GameState, e: Entity): void {
  const r = manaBarRect(state, e);
  bar(ctx, r, "#1c2029");
  bar(ctx, { ...r, w: r.w * (e.mana / e.maxMana) }, COLORS.mana);
}

/** A small skull-ish mark over a cursed party member (hostile DoT riding them). */
function drawCurseMark(ctx: CanvasRenderingContext2D, state: GameState, e: Entity): void {
  if (!isParty(e) || !e.hots.some((h) => h.hostile)) return;
  const r = hpBarRect(state, e);
  ctx.fillStyle = COLORS.curse;
  ctx.font = "bold 12px system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText("☠", r.x - 3, r.y + r.h / 2);
}

/** Pips above a boss's HP bar showing its attack rotation. */
function drawRotationIndicator(ctx: CanvasRenderingContext2D, state: GameState, e: Entity): void {
  const rotation = enemyType(e.enemyType!).rotation;
  const active = e.actionCount % rotation.length;
  const hp = hpBarRect(state, e);
  const gap = 12;
  const y = hp.y - 8;
  const cx = hp.x + hp.w / 2;
  const startX = cx - ((rotation.length - 1) * gap) / 2;
  rotation.forEach((slot, i) => {
    const x = startX + i * gap;
    const color = pipColor(slot);
    ctx.beginPath();
    ctx.arc(x, y, i === active ? 4.5 : 3, 0, Math.PI * 2);
    if (i === active) {
      ctx.fillStyle = color;
      ctx.fill();
      ring(ctx, x, y, 6.5, COLORS.text, 1.5);
    } else {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.restore();
    }
  });
}

function pipColor(slot: string): string {
  switch (slot) {
    case "aoe":
      return COLORS.threat;
    case "line":
    case "cleave":
      return COLORS.line;
    case "curse":
      return COLORS.curse;
    case "smash":
      return COLORS.smash;
    default:
      return COLORS.enemyCast;
  }
}

function drawProgressBar(ctx: CanvasRenderingContext2D, state: GameState, e: Entity): void {
  const r = progressBarRect(state, e);
  if (!e.current) {
    if (isParty(e)) bar(ctx, r, "#1c2029");
    return;
  }
  bar(ctx, r, "#1c2029");
  const pct = Math.min(1, e.current.elapsed / e.current.def.castTime);
  const kind = e.current.def.effect.kind;
  const name = e.current.def.name;
  const big = kind === "aoe-damage" || name === "Heavy Smash";
  let color = COLORS.cast;
  if (e.kind === "enemy") {
    if (kind === "aoe-damage") color = COLORS.threat;
    else if (name === "Heavy Smash") color = COLORS.smash;
    else if (kind === "line-damage") color = COLORS.line;
    else if (kind === "dot") color = COLORS.curse;
    else color = COLORS.enemyCast;
  }
  bar(ctx, { ...r, w: r.w * pct }, color);

  ctx.fillStyle = color === COLORS.cast ? COLORS.subtext : color;
  ctx.font = big ? "bold 9px system-ui, sans-serif" : "9px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(big ? `${name}!` : name, r.x + r.w / 2, r.y + r.h + 2);
}

function drawFloatingText(ctx: CanvasRenderingContext2D, state: GameState): void {
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  for (const ev of state.events) {
    const age = state.elapsedTime - ev.at;
    const e = findEntity(state, ev.entityId);
    if (!e) continue;
    const c = entityCenter(state, e);
    const radius = entityRadius(e);

    if (ev.kind === "enrage") {
      if (age > 2.2) continue;
      const t = age / 2.2;
      ctx.globalAlpha = 1 - t * t;
      ctx.fillStyle = COLORS.threat;
      ctx.font = "bold 24px system-ui, sans-serif";
      ctx.fillText("ENRAGED!", c.x, c.y - radius - 30 - t * 24);
      ctx.globalAlpha = 1;
      continue;
    }

    if (age > FCT_LIFE) continue;
    const t = age / FCT_LIFE;
    const x = c.x + Math.sin(ev.at * 137.1) * 14;
    const y = c.y - radius - 18 - t * 28;
    ctx.globalAlpha = 1 - t * t;

    if (ev.kind === "damage") {
      ctx.fillStyle = COLORS.threat;
      ctx.font = "bold 14px system-ui, sans-serif";
      ctx.fillText(`-${Math.round(ev.amount)}`, x, y);
    } else if (ev.kind === "heal") {
      ctx.fillStyle = COLORS.hot;
      ctx.font = "bold 13px system-ui, sans-serif";
      ctx.fillText(`+${Math.round(ev.amount)}`, x, y);
    }
    ctx.globalAlpha = 1;
  }
}

function drawPanel(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  mouse: Point | null,
): void {
  ctx.fillStyle = "#10131a";
  ctx.fillRect(PANEL.x, PANEL.y, PANEL.w, PANEL.h);
  ctx.strokeStyle = "#222733";
  ctx.strokeRect(PANEL.x + 0.5, PANEL.y + 0.5, PANEL.w - 1, PANEL.h - 1);

  const h = state.entities.find((e) => e.kind === "healer");

  if (h) {
    ctx.fillStyle = COLORS.text;
    ctx.font = "bold 13px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("Healer", PANEL.x + 14, PANEL.y + 10);
    ctx.fillStyle = COLORS.mana;
    ctx.font = "bold 12px system-ui, sans-serif";
    ctx.fillText(`Mana ${Math.floor(h.mana)}/${h.maxMana}`, PANEL.x + 14, PANEL.y + 28);
    const mb: Rect = { x: PANEL.x + 14, y: PANEL.y + 44, w: 150, h: 6 };
    bar(ctx, mb, "#1c2029");
    bar(ctx, { ...mb, w: mb.w * (h.mana / h.maxMana) }, COLORS.mana);
  }

  const armedDef = state.armedSpellId ? HEALER_SPELL(state.armedSpellId) : undefined;
  ctx.fillStyle = armedDef ? COLORS.armed : COLORS.subtext;
  ctx.font = "12px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(
    armedDef
      ? `${armedDef.name} armed — click an ally (or press 1-4) to cast`
      : "Pick a spell (Q W E R or click), then click an ally to heal · click an enemy to focus-fire",
    PANEL.x + PANEL.w / 2,
    PANEL.y + 10,
  );

  actionButtons().forEach((b, i) => {
    const armed = state.armedSpellId === b.def.id;
    const hotkey = ABILITY_KEYS[i]?.toUpperCase();
    const total = b.def.cooldown ?? 0;
    const remain = h ? h.cooldowns[b.def.id] ?? 0 : 0;
    const cdFrac = total > 0 ? Math.max(0, Math.min(1, remain / total)) : 0;
    button(ctx, b.rect, b.def.name, buttonSub(b.def), armed, hotkey, {
      disabled: !canUse(state, b.def),
      cdFrac,
      cdRemain: remain,
    });
  });

  drawQuitButton(ctx, mouse);
}

/** "Quit Area" button: abandon the run and go back to the hub (no progress kept). */
function drawQuitButton(ctx: CanvasRenderingContext2D, mouse: Point | null): void {
  const r = quitButtonRect();
  const hovered = mouse !== null && pointInRect(mouse, r);
  ctx.fillStyle = hovered ? "#2a1b1f" : "#1b1115";
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeStyle = hovered ? COLORS.hpLow : "#5a3a40";
  ctx.lineWidth = hovered ? 2 : 1;
  ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);

  ctx.fillStyle = hovered ? COLORS.text : COLORS.subtext;
  ctx.font = "bold 14px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Quit Area", r.x + r.w / 2, r.y + r.h / 2 - 7);
  ctx.fillStyle = "#7a818f";
  ctx.font = "10px system-ui, sans-serif";
  ctx.fillText("back to map", r.x + r.w / 2, r.y + r.h / 2 + 9);
}

function HEALER_SPELL(id: string): ActionDef | undefined {
  return actionButtons().find((b) => b.def.id === id)?.def;
}

function healAmount(def: ActionDef): number {
  const e = def.effect;
  if (e.kind === "heal" || e.kind === "aoe-heal") return e.amount;
  if (e.kind === "hot") return Math.round(e.perTick * (e.duration / e.interval));
  return 0;
}

function buttonSub(def: ActionDef): string {
  let heal = `+${healAmount(def)}`;
  if (def.effect.kind === "aoe-heal") heal += " all";
  const parts = [heal];
  if (def.manaCost !== undefined) parts.push(`${def.manaCost} mp`);
  return parts.join(" · ");
}

function drawSpellTooltip(ctx: CanvasRenderingContext2D, mouse: Point): void {
  const hovered = actionButtons().find((b) => pointInRect(mouse, b.rect));
  if (!hovered) return;
  const def = hovered.def;
  const e = def.effect;

  const heal = healAmount(def);
  const healText =
    e.kind === "aoe-heal"
      ? `${heal} to all`
      : e.kind === "hot"
        ? `${heal} over ${e.duration.toFixed(0)}s`
        : `${heal}`;
  const rows: Array<[string, string]> = [
    ["Heals", healText],
    ["Cast time", `${def.castTime.toFixed(1)}s`],
    ["Cooldown", def.cooldown ? `${def.cooldown.toFixed(1)}s` : "none"],
    ["Mana", def.manaCost !== undefined ? `${def.manaCost}` : "free"],
  ];

  const pad = 10;
  const titleH = 18;
  const rowH = 15;
  const w = 168;
  const hgt = pad * 2 + titleH + rows.length * rowH;
  const x = Math.max(6, Math.min(CANVAS.w - 6 - w, hovered.rect.x + hovered.rect.w / 2 - w / 2));
  const y = hovered.rect.y - 10 - hgt;

  ctx.fillStyle = "rgba(12, 15, 21, 0.97)";
  ctx.fillRect(x, y, w, hgt);
  ctx.strokeStyle = COLORS.armed;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, hgt - 1);

  ctx.fillStyle = COLORS.text;
  ctx.font = "bold 13px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(def.name, x + pad, y + pad);

  ctx.font = "11px system-ui, sans-serif";
  rows.forEach(([label, value], i) => {
    const ry = y + pad + titleH + i * rowH;
    ctx.fillStyle = COLORS.subtext;
    ctx.textAlign = "left";
    ctx.fillText(label, x + pad, ry);
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = "right";
    ctx.fillText(value, x + w - pad, ry);
  });
}

function drawStatusBar(ctx: CanvasRenderingContext2D, state: GameState): void {
  const area = CONFIG.areas[state.areaIndex];
  const fights = area.fights.length;
  ctx.fillStyle = COLORS.subtext;
  ctx.font = "12px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(
    `${area.name} — Fight ${state.fightIndex + 1}/${fights}  ·  ${state.elapsedTime.toFixed(1)}s`,
    12,
    12,
  );

  ctx.textAlign = "right";
  ctx.fillText(
    "Q W E R / click spell · 1-4 / click ally to cast · click enemy to focus · X stop · Esc clear · M mute",
    CANVAS.w - 12,
    12,
  );
}

/** End-of-fight interstitial / area-cleared / defeat overlay. */
function drawOverlay(ctx: CanvasRenderingContext2D, state: GameState): void {
  ctx.fillStyle = "rgba(8, 10, 14, 0.85)";
  ctx.fillRect(0, 0, CANVAS.w, PANEL.y);

  const cx = CANVAS.w / 2;
  const area = CONFIG.areas[state.areaIndex];
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  let title: string;
  let titleColor: string;
  let footer: string;
  if (state.phase === "fight-cleared") {
    title = `Fight ${state.fightIndex + 1}/${area.fights.length} cleared`;
    titleColor = COLORS.hpFull;
    footer = "Party recovers (+10% HP/MP · fallen revived) — click or press a key to continue";
  } else if (state.phase === "area-cleared") {
    title = `${area.name} cleared!`;
    titleColor = COLORS.hpFull;
    footer = "Click (or press a key) to return to the map";
  } else {
    title = "Defeated";
    titleColor = COLORS.hpLow;
    footer = "Click (or press a key) to return to the map";
  }

  ctx.fillStyle = titleColor;
  ctx.font = "bold 44px system-ui, sans-serif";
  ctx.fillText(title, cx, 150);

  if (state.phase !== "fight-cleared") {
    const s = state.stats;
    const lines: Array<[string, string]> = [
      ["Time", `${state.elapsedTime.toFixed(1)}s`],
      ["Damage dealt", `${Math.round(s.damageDealt)}`],
      ["Healing done", `${Math.round(s.healingDone)} (${Math.round(s.overhealing)} overheal)`],
      ["Deaths", `${s.deaths}`],
    ];
    ctx.font = "16px system-ui, sans-serif";
    lines.forEach(([label, value], i) => {
      const y = 230 + i * 28;
      ctx.fillStyle = COLORS.subtext;
      ctx.textAlign = "right";
      ctx.fillText(label, cx - 12, y);
      ctx.fillStyle = COLORS.text;
      ctx.textAlign = "left";
      ctx.fillText(value, cx + 12, y);
    });
  }

  ctx.fillStyle = COLORS.subtext;
  ctx.textAlign = "center";
  ctx.font = "15px system-ui, sans-serif";
  ctx.fillText(footer, cx, 430);
}

/** The area-select hub. */
function drawHub(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  mouse: Point | null,
): void {
  ctx.fillStyle = "#0c0f15";
  ctx.fillRect(0, 0, CANVAS.w, CANVAS.h);

  const cx = CANVAS.w / 2;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = COLORS.text;
  ctx.font = "bold 34px system-ui, sans-serif";
  ctx.fillText("Dungeon Frenzy", cx, 80);
  ctx.fillStyle = COLORS.subtext;
  ctx.font = "15px system-ui, sans-serif";
  ctx.fillText("Choose an area — clear it to unlock the next", cx, 120);

  CONFIG.areas.forEach((area, i) => {
    const r = areaCardRect(i);
    const unlocked = areaUnlocked(state, i);
    const cleared = !!state.clearedAreas[i];
    const hovered = unlocked && mouse !== null && pointInRect(mouse, r);

    ctx.fillStyle = unlocked ? (hovered ? "#1b2230" : "#141923") : "#0f1219";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = cleared ? COLORS.cleared : unlocked ? "#3a4456" : "#242a36";
    ctx.lineWidth = cleared || hovered ? 2 : 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);

    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = unlocked ? COLORS.subtext : COLORS.locked;
    ctx.font = "bold 12px system-ui, sans-serif";
    ctx.fillText(`AREA ${i + 1}`, r.x + r.w / 2, r.y + 16);

    ctx.fillStyle = unlocked ? COLORS.text : COLORS.locked;
    ctx.font = "bold 16px system-ui, sans-serif";
    wrapText(ctx, area.name, r.x + r.w / 2, r.y + 42, r.w - 20, 20);

    // Difficulty pips (area index + 1 filled of 5).
    const pipY = r.y + 96;
    const pips = CONFIG.areas.length;
    const pipGap = 16;
    const pipStart = r.x + r.w / 2 - ((pips - 1) * pipGap) / 2;
    for (let k = 0; k < pips; k++) {
      ctx.beginPath();
      ctx.arc(pipStart + k * pipGap, pipY, 4, 0, Math.PI * 2);
      ctx.fillStyle = k <= i ? COLORS.threat : "#2a3140";
      ctx.fill();
    }
    ctx.fillStyle = unlocked ? COLORS.subtext : COLORS.locked;
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillText("difficulty", r.x + r.w / 2, pipY + 14);

    // Status line.
    ctx.font = "bold 13px system-ui, sans-serif";
    ctx.textBaseline = "bottom";
    if (cleared) {
      ctx.fillStyle = COLORS.cleared;
      ctx.fillText("✓ Cleared", r.x + r.w / 2, r.y + r.h - 16);
    } else if (unlocked) {
      ctx.fillStyle = COLORS.armed;
      ctx.fillText(`Play (${i + 1})`, r.x + r.w / 2, r.y + r.h - 16);
    } else {
      ctx.fillStyle = COLORS.locked;
      ctx.fillText("🔒 Locked", r.x + r.w / 2, r.y + r.h - 16);
    }
  });
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  y: number,
  maxW: number,
  lineH: number,
): void {
  const words = text.split(" ");
  let line = "";
  let yy = y;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, cx, yy);
      line = w;
      yy += lineH;
    } else {
      line = test;
    }
  }
  ctx.fillText(line, cx, yy);
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

interface ButtonState {
  disabled?: boolean;
  cdFrac?: number;
  cdRemain?: number;
}

function button(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  title: string,
  sub: string,
  armed: boolean,
  hotkey: string | undefined,
  st: ButtonState,
): void {
  const { disabled, cdFrac = 0, cdRemain = 0 } = st;
  ctx.fillStyle = disabled ? "#13161c" : armed ? "#2a2f1a" : "#1b2029";
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeStyle = armed ? COLORS.armed : "#333a47";
  ctx.lineWidth = armed ? 2 : 1;
  ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);

  ctx.fillStyle = disabled ? "#5a6170" : COLORS.text;
  ctx.font = "bold 15px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(title, r.x + r.w / 2, r.y + r.h / 2 - 8);

  ctx.fillStyle = disabled ? "#4a5160" : COLORS.subtext;
  ctx.font = "11px system-ui, sans-serif";
  ctx.fillText(sub, r.x + r.w / 2, r.y + r.h / 2 + 12);

  if (hotkey) {
    ctx.fillStyle = disabled ? "#4a5160" : COLORS.armed;
    ctx.font = "bold 11px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(hotkey, r.x + 7, r.y + 5);
  }

  if (cdFrac > 0) {
    ctx.fillStyle = COLORS.cooldown;
    ctx.fillRect(r.x + 1, r.y + 1, r.w - 2, (r.h - 2) * cdFrac);
    ctx.fillStyle = COLORS.text;
    ctx.font = "bold 16px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(cdRemain.toFixed(1), r.x + r.w / 2, r.y + r.h / 2);
  }
}

function shortName(e: Entity): string {
  switch (e.kind) {
    case "tank":
      return "TK";
    case "ranger":
      return "RG";
    case "mage":
      return "MG";
    case "healer":
      return "H";
    default:
      return isBossType(e.enemyType) ? "BOSS" : (e.name.slice(0, 2).toUpperCase());
  }
}
