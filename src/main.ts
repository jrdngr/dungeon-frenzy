// Entry point: wire up the canvas, run the fixed-timestep-ish rAF loop.

import { createInitialState, update } from "./game/engine";
import { render } from "./ui/render";
import { handleClick, handleKey } from "./ui/input";
import { toggleMute, unlock, updateAudio } from "./ui/audio";
import type { Point } from "./game/hex";

const canvas = document.getElementById("game") as HTMLCanvasElement | null;
if (!canvas) throw new Error("Missing #game canvas");
const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("Could not get 2D context");

let state = createInitialState();

canvas.addEventListener("click", (ev) => {
  unlock(); // browsers only allow audio after a user gesture
  const rect = canvas.getBoundingClientRect();
  const p: Point = {
    x: (ev.clientX - rect.left) * (canvas.width / rect.width),
    y: (ev.clientY - rect.top) * (canvas.height / rect.height),
  };
  const result = handleClick(state, p);
  if (result.restart) state = createInitialState();
});

window.addEventListener("keydown", (ev) => {
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return; // leave browser shortcuts alone
  unlock();
  // Mute only while playing; on the end screen let M fall through so it
  // restarts like any other key (the overlay invites "press a key to play again").
  if (state.phase === "playing" && ev.key.toLowerCase() === "m") {
    toggleMute();
    return;
  }
  const result = handleKey(state, ev.key);
  if (result.restart) state = createInitialState();
});

let last = performance.now();
const MAX_DT = 0.1; // clamp big gaps (e.g. tab was backgrounded)

function frame(now: number): void {
  const dt = Math.min(MAX_DT, (now - last) / 1000);
  last = now;

  update(state, dt);
  updateAudio(state);
  render(ctx!, state);

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
