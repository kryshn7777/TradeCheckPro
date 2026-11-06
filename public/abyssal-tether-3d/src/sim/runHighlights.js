/* THE LANTERN — runHighlights.js
 * RUN HIGHLIGHTS (docs/abyssal-tether-3d/plans/RUN_HIGHLIGHTS.md): the run's best moments, kept so the death card can tell one
 * ("Biggest catch: 21 m/s") and the victory card can list them, plus a stable share line for streamers:
 *   THE LANTERN · Ch I · Nightmare · 11:42.3 · 3 deaths · Chain x9 · ◆◆◇
 *
 * Bus-driven and pure (no DOM, no three.js, no Math.random). The run's maxima live from start() (reset) to the next start():
 * a death and a respawn reset nothing. Listens to:
 *   rope:catch {speed}                    THE CATCH (game.js): the fall speed a bite saved          → maxCatch
 *   flow:end {n}                          a swing chain ended (sim/flow3d.js)                      → bestChain
 *   creature:strike {hit, distance}       a lunge that missed within NEAR_MISS_M m                 → nearMisses, closestMiss
 *   player:land {impact, lethalRatio}     a landing survived (ratio < 1, alive)                    → biggestLand
 *   chase:lost {…}                        a chase shaken off (optional: the Chase Arc emits it)     → escapes
 *   knocker:throw                         a knocker thrown (optional)                              → knockers
 *   player:death / game:respawn           alive gate for the landings
 * and game.js calls sample(vx, vy, vz) once per frame while playing (top speed). sample() and the handlers allocate nothing.
 */
import { SPLIT_MEDALS } from './splits3d.js';

/** A miss counts as near when the lunge stopped within this many metres of the player. */
export const NEAR_MISS_M = 4;

/** Medal glyphs of the share line (one per whole section split this run): gold ◆, silver ◈, brass ◇, none ·. */
export const MEDAL_GLYPH = Object.freeze({ [SPLIT_MEDALS[0][0]]: '◆', [SPLIT_MEDALS[1][0]]: '◈', [SPLIT_MEDALS[2][0]]: '◇' });
export const NO_MEDAL_GLYPH = '·';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
const TIMES = ['', 'once', 'twice'];

const fin = (v) => typeof v === 'number' && isFinite(v);
const ms = (v) => `${Math.round(v)} m/s`;

/**
 * The priority table: best() returns the first row whose value reaches `best` (the death card's one line); all() lists every
 * row whose value reaches `show`, in this order (the victory block). Thresholds are in the row's own unit.
 */
export const HIGHLIGHT_TABLE = Object.freeze([
  { key: 'maxCatch', best: 12, show: 8, line: (v) => `Biggest catch: ${ms(v)}` },
  { key: 'bestChain', best: 5, show: 3, line: (v) => `Chain x${v}` },
  { key: 'escapes', best: 1, show: 1, line: (v) => `Lost it ${TIMES[v] || `${v} times`}` },
  { key: 'nearMisses', best: 2, show: 1, line: (v) => `${v} near miss${v === 1 ? '' : 'es'}` },
  { key: 'biggestLand', best: 12, show: 9, line: (v) => `Walked off a ${ms(v)} landing` },
  { key: 'topSpeed', best: 18, show: 12, line: (v) => `Top speed ${ms(v)}` },
  { key: 'knockers', best: 3, show: 1, line: (v) => `${v} knocker${v === 1 ? '' : 's'} thrown` },
  // the floors: something always reads (a short run still gets a line)
  { key: 'bestChain', best: 2, show: Infinity, line: (v) => `Chain x${v}` },
  { key: 'topSpeed', best: 1, show: Infinity, line: (v) => `Top speed ${ms(v)}` },
]);

export class RunHighlights {
  /**
   * @param {{on:Function}|null} bus  the game's bus
   * @param {() => boolean} [gate]    counts events only while it returns true (game.js: a run is under way)
   */
  constructor(bus, gate) {
    this.gate = typeof gate === 'function' ? gate : null;
    this._offs = [];
    this.reset();
    if (bus && typeof bus.on === 'function') {
      const on = (t, fn) => {
        const off = bus.on(t, fn);
        if (typeof off === 'function') this._offs.push(off);
      };
      on('rope:catch', (e) => this.onCatch(e));
      on('flow:end', (e) => this.onChain(e));
      on('creature:strike', (e) => this.onStrike(e));
      on('player:land', (e) => this.onLand(e));
      on('chase:lost', (e) => this.onEscape(e));
      on('knocker:throw', () => this.onKnocker());
      on('player:death', () => {
        this.dead = true;
      });
      on('game:respawn', () => {
        this.dead = false;
      });
    }
  }

  /** A new run: every maximum back to zero (game.js start()). */
  reset() {
    this.maxCatch = 0;
    this.bestChain = 0;
    this.nearMisses = 0;
    this.closestMiss = Infinity;
    this.biggestLand = 0;
    this.topSpeed = 0;
    this.escapes = 0;
    this.knockers = 0;
    this.dead = false;
    this.runs = (this.runs | 0) + 1;
  }

  dispose() {
    for (let i = 0; i < this._offs.length; i++) this._offs[i]();
    this._offs.length = 0;
  }

  _live() {
    return !this.gate || !!this.gate();
  }

  onCatch(e) {
    const v = e && fin(e.speed) ? Math.abs(e.speed) : 0;
    if (this._live() && v > this.maxCatch) this.maxCatch = v;
  }

  onChain(e) {
    const n = e && fin(e.n) ? e.n | 0 : 0;
    if (this._live() && e.reason !== 'death' && n > this.bestChain) this.bestChain = n;
  }

  onStrike(e) {
    if (!e || e.hit || !this._live() || this.dead) return;
    const d = fin(e.distance) ? e.distance : Infinity;
    if (!(d <= NEAR_MISS_M)) return;
    this.nearMisses++;
    if (d < this.closestMiss) this.closestMiss = d;
  }

  onLand(e) {
    if (!e || this.dead || !this._live()) return;
    const r = fin(e.lethalRatio) ? e.lethalRatio : 1;
    const v = fin(e.impact) ? e.impact : 0;
    if (r < 1 && v > this.biggestLand) this.biggestLand = v;
  }

  onEscape() {
    if (this._live()) this.escapes++;
  }

  onKnocker() {
    if (this._live()) this.knockers++;
  }

  /** Once per frame while playing: the player's velocity (m/s). No allocation. */
  sample(vx, vy, vz) {
    if (this.dead) return;
    const s = Math.sqrt(vx * vx + vy * vy + vz * vz);
    if (s > this.topSpeed && s < 200) this.topSpeed = s; // (a teleport / respawn snap is not a speed)
  }

  _value(key) {
    const v = this[key];
    return key === 'maxCatch' || key === 'biggestLand' || key === 'topSpeed' ? Math.round(v) : v | 0;
  }

  /** The single most impressive line (the death card), or '' when the run has nothing yet. */
  best() {
    for (let i = 0; i < HIGHLIGHT_TABLE.length; i++) {
      const r = HIGHLIGHT_TABLE[i];
      const v = this._value(r.key);
      if (v >= r.best) return r.line(v);
    }
    return '';
  }

  /** Every line worth showing, in priority order (the victory block). */
  all() {
    const out = [];
    for (let i = 0; i < HIGHLIGHT_TABLE.length; i++) {
      const r = HIGHLIGHT_TABLE[i];
      const v = this._value(r.key);
      if (v >= r.show) out.push(r.line(v));
    }
    return out;
  }

  /** A plain read-out (tests, the debug API). */
  state() {
    return {
      maxCatch: this.maxCatch,
      bestChain: this.bestChain,
      nearMisses: this.nearMisses,
      closestMiss: isFinite(this.closestMiss) ? this.closestMiss : null,
      biggestLand: this.biggestLand,
      topSpeed: this.topSpeed,
      escapes: this.escapes,
      knockers: this.knockers,
      best: this.best(),
      all: this.all(),
    };
  }

  /**
   * The share line: `THE LANTERN · Ch I · Nightmare · 11:42.3 · 3 deaths · Chain x9 · ◆◆◇`. Stable (no locale: ASCII digits, no
   * thousands commas). Segments without data are left out.
   * @param {{chapter?:number, label?:string, time?:number, deaths?:number, splits?:({medal?:string|null}|null)[]}} info
   */
  shareLine(info) {
    const i = info || {};
    const parts = ['THE LANTERN'];
    const ch = i.chapter | 0 || 1;
    parts.push(`Ch ${ROMAN[ch - 1] || ch}`);
    if (i.label) parts.push(String(i.label));
    if (fin(i.time) && i.time >= 0) parts.push(clock(i.time));
    const d = fin(i.deaths) ? Math.max(0, i.deaths | 0) : 0;
    parts.push(`${d} death${d === 1 ? '' : 's'}`);
    const top = this.best();
    if (top) parts.push(top);
    if (Array.isArray(i.splits)) {
      let g = '';
      for (const sp of i.splits) if (sp) g += MEDAL_GLYPH[sp.medal] || NO_MEDAL_GLYPH;
      if (g) parts.push(g);
    }
    return parts.join(' · ');
  }
}

/** m:ss.d, h:mm:ss.d past the hour (tenths; ASCII only). */
export function clock(t) {
  const d = Math.round(Math.max(0, t) * 10);
  const h = Math.floor(d / 36000);
  const m = Math.floor((d % 36000) / 600);
  const s = (d % 600) / 10;
  const ss = `${s < 10 ? '0' : ''}${s.toFixed(1)}`;
  return h > 0 ? `${h}:${m < 10 ? '0' : ''}${m}:${ss}` : `${m}:${ss}`;
}
