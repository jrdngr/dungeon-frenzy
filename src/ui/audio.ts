// Synthesized audio cues (Web Audio, no assets). The point is to move
// monitoring load from the eyes to the ears: each party member has a "ready"
// ping at its own pitch, Roar and enrage announce themselves, and a dropped
// queued order complains. Cues fire on transitions only — never nagging
// (deliberately sitting idle to bank mana is correct play).
//
// The module diffs GameState against its own previous-frame snapshot; the sim
// stays pure and never imports this.

import type { GamePhase, GameState } from "../game/types";
import { partySlots } from "./input";

let ctx: AudioContext | null = null;
let muted = false;

let lastEventAt = 0;
let prevPhase: GamePhase = "playing";
let prevRoar = false;
const prevCasting = new Map<string, boolean>();

/** Create/resume the AudioContext. Browsers require a user gesture before
 * audio may play, so call this from click/keydown handlers. */
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

/** Ready-ping pitch per party slot (F1 low, F2 mid, healer high) so the ear
 * can tell WHO came free without looking. */
const READY_PITCHES = [523, 659, 880];

/** Call once per frame after update(). Diffs against the previous frame and
 * emits cues for: unit became idle, Roar cast started, enrage, dropped
 * queued order, win/lose. Safe to call before unlock() (no-ops, but keeps
 * the snapshots warm so unlocking doesn't replay a burst). */
export function updateAudio(state: GameState): void {
  // A restart resets elapsed time; reset our trackers with it.
  if (state.elapsedTime < lastEventAt) {
    lastEventAt = 0;
    prevRoar = false;
    prevPhase = "playing";
    prevCasting.clear();
  }

  // Per-unit casting -> idle transition: one short ping at the slot's pitch.
  partySlots(state).forEach((e, i) => {
    const casting = !!e.current;
    const was = prevCasting.get(e.id) ?? false;
    if (was && !casting && e.alive && state.phase === "playing") {
      beep(READY_PITCHES[i] ?? 700, 0.09);
    }
    prevCasting.set(e.id, casting);
  });

  // Roar cast start: rising two-tone warning.
  const en = state.entities.find((e) => e.kind === "enemy");
  const roar = !!en?.alive && en.current?.def.effect.kind === "aoe-damage";
  if (roar && !prevRoar) {
    beep(330, 0.16, "square", 0.035);
    beep(440, 0.22, "square", 0.035, 0.16);
  }
  prevRoar = roar;

  // Event-driven cues.
  for (const ev of state.events) {
    if (ev.at <= lastEventAt) continue;
    if (ev.kind === "enrage") {
      beep(110, 0.5, "sawtooth", 0.06);
      beep(98, 0.6, "sawtooth", 0.05, 0.1);
    } else if (ev.kind === "queue-dropped") {
      beep(420, 0.09, "triangle", 0.06);
      beep(255, 0.16, "triangle", 0.06, 0.09);
    }
  }
  lastEventAt = state.elapsedTime;

  // Win / lose stingers.
  if (state.phase !== prevPhase) {
    if (state.phase === "won") {
      beep(523, 0.14);
      beep(659, 0.14, "sine", 0.05, 0.14);
      beep(784, 0.3, "sine", 0.05, 0.28);
    } else if (state.phase === "lost") {
      beep(220, 0.3);
      beep(165, 0.5, "sine", 0.05, 0.25);
    }
    prevPhase = state.phase;
  }
}
