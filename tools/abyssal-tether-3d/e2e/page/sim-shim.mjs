// Browser stand-in for ../../verify/sim.mjs: only what bot.mjs imports.
// Same module URLs as the game, so CONFIG / HANDS are the game's own instances.
import { CONFIG } from '/src/sim/config3d.js';
import { HANDS } from '/src/sim/physics3d.js';

export { CONFIG, HANDS };
export const FRAME = 1 / 60;
export const SUB = 4;

function makeHandIntent() {
  return { aim: null, pressed: false, held: false, released: false, yank: 0 };
}
export function makeIntent() {
  return {
    move: { x: 0, z: 0 },
    reel: 0,
    jumpPressed: false,
    brake: false,
    turnRate: 0,
    hands: { left: makeHandIntent(), right: makeHandIntent() },
    pausePressed: false,
    restartPressed: false,
    confirmPressed: false,
    backPressed: false,
    ui: { ray: null, click: false },
  };
}
