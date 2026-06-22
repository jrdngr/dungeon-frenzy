// Synthesized audio cues (Web Audio, no assets). The point is to move
// monitoring load from the eyes to the ears: each healer spell finishes with its
// own pitch, a cooldown coming back chimes, and the enemy's Cleave/Roar/enrage
// announce themselves. Cues fire on transitions only — never nagging.
//
// The module diffs GameState against its own previous-frame snapshot; the sim
// stays pure and never imports this.

import type { GamePhase, GameState } from "../game/types";

let ctx: AudioContext | null = null;
let muted = true; // sound off by default; the M key toggles it back on

let lastEventAt = 0;
let prevPhase: GamePhase = "area-select";
let prevRoar = false;
let prevLine = false;
let prevSmash = false;
let prevHealerCast: string | undefined;
let prevCooldowns = new Set<string>();

/** Create/resume the AudioContext. Browsers require a user gesture before audio
 * may play, so call this from click/keydown handlers. */
export function unlock(): void {
  if (typeof window === "undefined") return;
  const AC = window.AudioContext;
  if (!AC) return;
  if (!ctx) ctx = new AC();
  if (ctx.state === "suspended") void ctx.resume();
}

export function toggleMute(): boolean {
  muted = !muted;
  return muted;
}

function beep(
  freq: number,
  durSec: number,
  type: OscillatorType = "sine",
  gainV = 0.05,
  delaySec = 0,
): void {
  if (!ctx || muted) return;
  const t0 = ctx.currentTime + delaySec;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gainV, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + durSec);
  osc.connect(g);
  g.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + durSec + 0.05);
}

/** Per-spell completion pitch so the ear can tell which heal just landed. */
const SPELL_PITCHES: Record<string, number> = {
  heal: 540,
  "quick-heal": 660,
  regen: 760,
  "group-heal": 900,
  resurrect: 480,
};

/** Call once per frame after update(). Diffs against the previous frame and
 * emits cues for: a healer spell completing, a spell's cooldown returning, the
 * enemy's Cleave/Roar winding up, enrage, and win/lose. Safe to call before
 * unlock() (no-ops, but keeps the snapshots warm). */
export function updateAudio(state: GameState): void {
  // A restart resets elapsed time; reset our trackers with it.
  if (state.elapsedTime < lastEventAt) {
    lastEventAt = 0;
    prevRoar = false;
    prevLine = false;
    prevSmash = false;
    prevHealerCast = undefined;
    prevCooldowns = new Set();
  }

  const playing = state.phase === "playing";
  const h = state.entities.find((e) => e.kind === "healer");

  // Healer spell completed: ping at the spell's pitch (you're free to recast).
  const healerCast = h?.alive ? h.current?.def.id : undefined;
  if (prevHealerCast && !healerCast && h?.alive && playing) {
    beep(SPELL_PITCHES[prevHealerCast] ?? 700, 0.09);
  }
  prevHealerCast = healerCast;

  // A spell's cooldown just cleared: a short high chime ("it's back").
  const nowCooldowns = new Set<string>(h ? Object.keys(h.cooldowns) : []);
  if (h?.alive && playing) {
    for (const id of prevCooldowns) {
      if (!nowCooldowns.has(id)) beep(1040, 0.07, "sine", 0.04);
    }
  }
  prevCooldowns = nowCooldowns;

  const casting = (pred: (e: GameState["entities"][number]) => boolean) =>
    state.entities.some((e) => e.kind === "enemy" && e.alive && !!e.current && pred(e));

  // Roar (AoE) cast start by any enemy: rising two-tone warning.
  const roar = casting((e) => e.current!.def.effect.kind === "aoe-damage");
  if (roar && !prevRoar) {
    beep(330, 0.16, "square", 0.035);
    beep(440, 0.22, "square", 0.035, 0.16);
  }
  prevRoar = roar;

  // Cleave (line/wide) cast start: descending two-tone — the backline might be hit.
  const line = casting((e) => e.current!.def.effect.kind === "line-damage");
  if (line && !prevLine) {
    beep(415, 0.14, "square", 0.03);
    beep(311, 0.18, "square", 0.03, 0.14);
  }
  prevLine = line;

  // Heavy Smash wind-up: a low, ominous tone — pre-heal the tank or it dies.
  const smash = casting((e) => e.current!.def.name === "Heavy Smash");
  if (smash && !prevSmash) {
    beep(150, 0.28, "sawtooth", 0.05);
    beep(120, 0.34, "sawtooth", 0.045, 0.16);
  }
  prevSmash = smash;

  // Event-driven cues.
  for (const ev of state.events) {
    if (ev.at <= lastEventAt) continue;
    if (ev.kind === "enrage") {
      beep(110, 0.5, "sawtooth", 0.06);
      beep(98, 0.6, "sawtooth", 0.05, 0.1);
    }
  }
  lastEventAt = state.elapsedTime;

  // Phase-transition stingers.
  if (state.phase !== prevPhase) {
    if (state.phase === "fight-cleared") {
      // A brief two-note "fight done" — softer than the full area fanfare.
      beep(587, 0.1);
      beep(784, 0.16, "sine", 0.05, 0.1);
    } else if (state.phase === "area-cleared") {
      beep(523, 0.14);
      beep(659, 0.14, "sine", 0.05, 0.14);
      beep(784, 0.3, "sine", 0.05, 0.28);
    } else if (state.phase === "defeat") {
      beep(220, 0.3);
      beep(165, 0.5, "sine", 0.05, 0.25);
    }
    prevPhase = state.phase;
  }
}
