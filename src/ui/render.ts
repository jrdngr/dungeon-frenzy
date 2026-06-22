// All canvas drawing. Reads GameState; never mutates it.

import { hexCorners, hexesInDisk, type Point } from "../game/hex";
import { enemy as findEnemy, findEntity } from "../game/combat";
import { CONFIG } from "../game/config";
import type { ActionDef, Entity, GameState } from "../game/types";
import { isParty } from "../game/types";
import { ABILITY_KEYS, canUse, partySlots } from "./input";
import {
  actionButtons,
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
  tank: "#5b8dd6", // steel blue
  ranger: "#6cc06c", // green
  mage: "#a87fe0", // violet
  healer: "#5bc98a", // teal-green (you)
  enemy: "#c9595b",
  dead: "#3a3f4a",
  hpFull: "#5bc98a",
  hpMid: "#d7c08a",
  hpLow: "#c9595b",
  enemyHp: "#c9595b",
  cast: "#8a9bd7",
  enemyCast: "#d79a8a",
  line: "#e8a13a", // line-attack telegraph / pip
  hot: "#5bc98a",
  mana: "#5aa9e8",
  threat: "#e05a5c",
  armed: "#d7c08a",
  target: "#d7c08a",
  cooldown: "rgba(9, 11, 16, 0.6)",
  text: "#e6e8ee",
  subtext: "#aab2c5",
  grid: "#222733",
  gridFill: "#11141b",
};

/** Seconds a floating combat-text entry stays on screen. */
const FCT_LIFE = 1.1;

export function render(ctx: CanvasRenderingContext2D, state: GameState): void {
  ctx.clearRect(0, 0, CANVAS.w, CANVAS.h);

  drawGrid(ctx, state);
  drawTelegraphs(ctx, state);
  drawEntities(ctx, state);
  drawPartyFrames(ctx, state);
  drawFloatingText(ctx, state);
  drawPanel(ctx, state);
  drawStatusBar(ctx, state);

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

/** A dashed threat line from the enemy to a victim, with a ring on the victim.
 * Brightens as the cast nears completion. */
function threatLine(
  ctx: CanvasRenderingContext2D,
  from: Point,
  to: Point,
  progress: number,
): void {
  ctx.save();
  ctx.globalAlpha = 0.3 + 0.6 * progress;
  ctx.strokeStyle = COLORS.threat;
  ctx.lineWidth = 2;
  ctx.setLineDash([7, 5]);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ring(ctx, to.x, to.y, TOKEN_RADIUS + 8, COLORS.threat, 2);
  ctx.restore();
}

/** Show what's winding up: a line to the Claw victim, two lines for a Cleave
 * (the tank + one other — this is how the healer gets hit), and warning rings
 * on everyone while a Roar (AoE) is incoming. */
function drawTelegraphs(ctx: CanvasRenderingContext2D, state: GameState): void {
  const en = findEnemy(state);
  if (!en || !en.alive || !en.current) return;
  const inst = en.current;
  const progress = Math.min(1, inst.elapsed / inst.def.castTime);
  const c = entityCenter(en);
  const kind = inst.def.effect.kind;

  if (kind === "damage" && inst.targetId) {
    const t = findEntity(state, inst.targetId);
    if (t && t.alive) threatLine(ctx, c, entityCenter(t), progress);
  } else if (kind === "line-damage") {
    for (const id of [inst.targetId, inst.secondaryTargetId]) {
      if (!id) continue;
      const t = findEntity(state, id);
      if (t && t.alive) threatLine(ctx, c, entityCenter(t), progress);
    }
  } else if (kind === "aoe-damage") {
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

function drawEntities(ctx: CanvasRenderingContext2D, state: GameState): void {
  const armed = !!state.armedSpellId;
  const slots = partySlots(state); // slot index -> hotkey (1-based)

  for (const e of state.entities) {
    const c = entityCenter(e);
    const slot = slots.indexOf(e);

    // With a spell armed, every living ally is a legal click target.
    if (armed && isParty(e) && e.alive) {
      ring(ctx, c.x, c.y, TOKEN_RADIUS + 5, COLORS.target, 2);
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

    // Label inside token.
    ctx.fillStyle = e.alive ? "#0d0f14" : "#6b7280";
    ctx.font = "bold 12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(shortName(e), c.x, c.y);

    // Target-hotkey badge for party members (1-based slot number).
    if (slot >= 0 && e.alive) {
      ctx.fillStyle = COLORS.armed;
      ctx.font = "bold 11px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(slot + 1), c.x - TOKEN_RADIUS + 1, c.y - TOKEN_RADIUS + 1);
    }

    drawHpBar(ctx, e);
    if (e.maxMana > 0 && e.alive) drawManaBar(ctx, e);
    if (e.kind === "enemy" && e.alive) drawRotationIndicator(ctx, e);
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

/** Fixed unit panels on the left: HP, mana, cast + queued order. Clickable
 * exactly like the unit's token, so heal targeting never requires hunting for a
 * token. */
function drawPartyFrames(
  ctx: CanvasRenderingContext2D,
  state: GameState,
): void {
  const armed = !!state.armedSpellId;
  const slots = partySlots(state);

  slots.forEach((e, i) => {
    const r = partyFrameRect(i);

    ctx.fillStyle = "#10131a";
    ctx.fillRect(r.x, r.y, r.w, r.h);

    // Border: a legal heal target (spell armed) lights up; otherwise calm.
    let border = "#333a47";
    let lw = 1;
    if (armed && e.alive) {
      border = COLORS.target;
      lw = 1.5;
    }
    ctx.strokeStyle = border;
    ctx.lineWidth = lw;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);

    // Header: hotkey + name (+ DEAD tag).
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
    ctx.fillText(`${Math.ceil(e.hp)}/${e.maxHp}`, hp.x + hp.w / 2, hp.y + hp.h / 2 + 1);

    // Mana strip (healer only).
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
  bar(ctx, { ...r, w: r.w * pct }, hpColor(e, pct));
  // HP number, centered. Shadow keeps it readable on fill and empty track.
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

/** Pips above the enemy's HP bar showing its attack rotation, coloured by type
 * (salmon Claw, orange Cleave, red Roar). The current/casting slot is enlarged
 * and ringed so the player can read what's coming. */
function drawRotationIndicator(ctx: CanvasRenderingContext2D, e: Entity): void {
  const rotation = CONFIG.enemy.rotation;
  const active = e.actionCount % rotation.length;
  const hp = hpBarRect(e);
  const gap = 13;
  const y = hp.y - 8;
  const cx = hp.x + hp.w / 2;
  const startX = cx - ((rotation.length - 1) * gap) / 2;
  rotation.forEach((slot, i) => {
    const x = startX + i * gap;
    const color =
      slot === "aoe" ? COLORS.threat : slot === "line" ? COLORS.line : COLORS.enemyCast;
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

function drawProgressBar(ctx: CanvasRenderingContext2D, e: Entity): void {
  if (!e.alive) return;
  const r = progressBarRect(e);
  if (!e.current) {
    if (isParty(e)) bar(ctx, r, "#1c2029");
    return;
  }
  bar(ctx, r, "#1c2029");
  const pct = Math.min(1, e.current.elapsed / e.current.def.castTime);
  const kind = e.current.def.effect.kind;
  const isRoar = kind === "aoe-damage";
  const isLine = kind === "line-damage";
  const color =
    e.kind === "enemy"
      ? isRoar
        ? COLORS.threat
        : isLine
          ? COLORS.line
          : COLORS.enemyCast
      : COLORS.cast;
  bar(ctx, { ...r, w: r.w * pct }, color);

  ctx.fillStyle = isRoar ? COLORS.threat : isLine ? COLORS.line : COLORS.subtext;
  ctx.font =
    isRoar || isLine ? "bold 9px system-ui, sans-serif" : "9px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  let label = isRoar ? `${e.current.def.name}!` : e.current.def.name;
  if (e.queued) label += ` ▸ ${e.queued.def.name}`;
  ctx.fillText(label, r.x + r.w / 2, r.y + r.h + 2);
}

/** Floating combat text driven by sim events: damage, heals, enrage, lost orders. */
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
    const x = c.x + Math.sin(ev.at * 137.1) * 14;
    const y = c.y - TOKEN_RADIUS - 22 - t * 28;
    ctx.globalAlpha = 1 - t * t;

    if (ev.kind === "damage") {
      ctx.fillStyle = COLORS.threat;
      ctx.font = "bold 14px system-ui, sans-serif";
      ctx.fillText(`-${Math.round(ev.amount)}`, x, y);
    } else if (ev.kind === "heal") {
      ctx.fillStyle = COLORS.hot;
      ctx.font = "bold 13px system-ui, sans-serif";
      ctx.fillText(`+${Math.round(ev.amount)}`, x, y);
    } else if (ev.kind === "queue-dropped") {
      ctx.fillStyle = COLORS.line;
      ctx.font = "bold 12px system-ui, sans-serif";
      ctx.fillText("ORDER LOST", x, y);
    }
    ctx.globalAlpha = 1;
  }
}

function drawPanel(ctx: CanvasRenderingContext2D, state: GameState): void {
  ctx.fillStyle = "#10131a";
  ctx.fillRect(PANEL.x, PANEL.y, PANEL.w, PANEL.h);
  ctx.strokeStyle = "#222733";
  ctx.strokeRect(PANEL.x + 0.5, PANEL.y + 0.5, PANEL.w - 1, PANEL.h - 1);

  const h = state.entities.find((e) => e.kind === "healer");

  // Header: healer mana (your whole economy) + a hint.
  if (h) {
    ctx.fillStyle = COLORS.text;
    ctx.font = "bold 13px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("Healer", PANEL.x + 14, PANEL.y + 10);
    ctx.fillStyle = COLORS.mana;
    ctx.font = "bold 12px system-ui, sans-serif";
    ctx.fillText(
      `Mana ${Math.floor(h.mana)}/${h.maxMana}`,
      PANEL.x + 14,
      PANEL.y + 28,
    );
    // A wide mana bar so the drain is impossible to miss.
    const mb: Rect = { x: PANEL.x + 14, y: PANEL.y + 44, w: 150, h: 6 };
    bar(ctx, mb, "#1c2029");
    bar(ctx, { ...mb, w: mb.w * (h.mana / h.maxMana) }, COLORS.mana);
  }

  const armedDef = state.armedSpellId
    ? HEALER_SPELL(state.armedSpellId)
    : undefined;
  ctx.fillStyle = armedDef ? COLORS.armed : COLORS.subtext;
  ctx.font = "12px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(
    armedDef
      ? `${armedDef.name} armed — click an ally (or press 1-4) to cast · re-press for lowest HP`
      : "Pick a spell (Q W E R or click), then click an ally to heal.",
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
      queued: h?.queued?.def.id === b.def.id,
      cdFrac,
      cdRemain: remain,
    });
  });
}

/** Look up a healer spell def by id (for the armed-spell label). */
function HEALER_SPELL(id: string): ActionDef | undefined {
  return actionButtons().find((b) => b.def.id === id)?.def;
}

function buttonSub(def: ActionDef): string {
  const parts = [`${def.castTime.toFixed(1)}s`];
  if (def.manaCost !== undefined) parts.push(`${def.manaCost} mp`);
  if (def.cooldown) parts.push(`${def.cooldown.toFixed(1)}s cd`);
  if (def.effect.kind === "aoe-heal") parts.push("all");
  return parts.join(" · ");
}

function drawStatusBar(ctx: CanvasRenderingContext2D, state: GameState): void {
  ctx.fillStyle = COLORS.subtext;
  ctx.font = "12px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(`Time: ${state.elapsedTime.toFixed(1)}s`, 12, 12);

  ctx.textAlign = "right";
  ctx.fillText(
    "Q W E R / click a spell · 1-4 / click an ally to cast · re-press = smart-cast · X stop · Esc clear · M mute",
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
    ["Orders lost", `${s.ordersDropped}`],
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

interface ButtonState {
  disabled?: boolean;
  queued?: boolean;
  cdFrac?: number; // 0..1 fraction of cooldown remaining
  cdRemain?: number; // seconds of cooldown remaining
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
  const { disabled, queued, cdFrac = 0, cdRemain = 0 } = st;
  ctx.fillStyle = disabled ? "#13161c" : armed ? "#2a2f1a" : "#1b2029";
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeStyle = armed ? COLORS.armed : queued ? COLORS.mana : "#333a47";
  ctx.lineWidth = armed || queued ? 2 : 1;
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

  if (hotkey) {
    ctx.fillStyle = disabled ? "#4a5160" : COLORS.armed;
    ctx.font = "bold 11px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(hotkey, r.x + 7, r.y + 5);
  }

  // Cooldown wipe + remaining seconds, drawn last so it sits on top.
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
      return "E";
  }
}
