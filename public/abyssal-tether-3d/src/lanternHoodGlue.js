/* THE LANTERN (ABYSSAL TETHER 3D) — lanternHoodGlue.js
 * THE HOOD (docs/abyssal-tether-3d/plans/LANTERN_HOOD.md): what game.js needs to let the player cover the lantern, in one module.
 *
 *   const hg = new LanternHoodGlue(game)   once (game.js _setupHood, with the bus): `game.hood` = hg.hood (sim/lanternHood.js: on, k)
 *   hg.update(dt, intent)                  once a run frame (game.js _updateRun, before the bag drains the charge)
 *
 * Input: intent.hood (held: VR right grip at the lantern, desktop V, touch HOOD) and intent.hoodToggle (VR quick left stick click), from
 * input/inputManager.js; the mode from settings.lanternHood ('hold' | 'toggle'). The run is live while playing, alive and before the
 * victory; otherwise the hood is off at once. A new run / a restart / the menu / a death uncover it.
 * What reads it (game.js and the views): the Mason's sight gets lit = false while `hood.on`; _updateLantern scales the light by
 * hood.lightMul and its range by hood.rangeMul; the bag drains at hood.drainMul; render/roachView.js (the swarm) and
 * render/lanternMood.js (the flame) read hood.k. Sounds: audio/lanternHoodSfx.js on 'lantern:hood'. No allocation per frame.
 */
import { LanternHood, hoodMode } from './sim/lanternHood.js';
import { registerLanternHoodSfx } from './audio/lanternHoodSfx.js';

export class LanternHoodGlue {
  constructor(game) {
    this.game = game;
    this.hood = new LanternHood(game && game.bus);
    this._sfx = false;
    const bus = game && game.bus;
    if (bus && typeof bus.on === 'function') {
      const off = () => this.hood.reset();
      bus.on('game:start', off);
      bus.on('game:restart', off);
      bus.on('game:menu', off);
      bus.on('player:death', off);
    }
  }

  update(dt, intent) {
    const g = this.game;
    if (!this._sfx && g.audio) this._sfx = registerLanternHoodSfx(g.audio) || g.audio.registerSfx === undefined;
    const h = this.hood;
    h.mode = hoodMode(g.settings);
    const p = g.player;
    const live = g.state === 'playing' && !!p && p.alive !== false && !(g.victoryT >= 0) && !g.hidePlayer && !!g.bag;
    h.update(dt, !!(intent && intent.hood), live, !!(intent && intent.hoodToggle));
  }
}
