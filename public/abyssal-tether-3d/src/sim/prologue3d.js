/* ABYSSAL TETHER 3D — prologue3d.js
 * The story that plays when a new descent begins: a page from one of Perennial's library books ("On the Unforeseen", entry 9,
 * the Underspire) that types itself out, grows colder and darker page by page, and is torn off mid-sentence. It tells the player
 * only three things (why the company exists, what the descent is, what they must do) and then the record turns: something was
 * here before the lamp, and the entry stops. Everything else (the Keepers, the menders, what the walls are made of, what the
 * radio does not say) is for the player to find on the way down (STORY.md, DARK_STORY_BIBLE.md).
 *
 * Pure and deterministic: no three.js, no DOM, no Math.random, no clock other than the dt it is stepped with.
 *
 *   Prologue3D(onEvent?)
 *     .update(dt)     advance the timeline (dt clamped to 0.1 s)
 *     .advance()      a press: finish the page that is still typing, else turn to the next page (the last one ends it)
 *     .skipAll()      Esc / B / pause: end now
 *     .reset()
 *   read-only:  active, done, page (index), pageT (s into it), typedEnd, pageDur, chars[i] (characters of line i shown),
 *               tone 0..4 (eased: the page's coldness, drives the colours), wake 0..1 (the ancient glyph ring waking),
 *               glitch 0..1, cut (s since the last line was torn off; -1 before), depth (m, the gauge), depthLost (the gauge lost its number),
 *               t (total s), pageIn / pageOut 0..1 (cross-fade)
 *   events:  onEvent('page', i) · onEvent('dark') (page of the addendum begins) · onEvent('cut') · onEvent('end', skipped)
 */

/** line kinds: meta (small caps record keeping), head (the large title of an entry), body (the prose), cut (prose torn off mid-word) */
export const PAGES = Object.freeze([
  {
    id: 'book',
    tone: 0,
    cps: 54,
    hold: 1.0,
    wake: 0,
    depth: [0, 0],
    lines: [
      { k: 'meta', t: 'PERENNIAL · DEEP RECOVERY LIBRARY' },
      { k: 'meta', t: 'VOLUME XI · ON THE UNFORESEEN' },
      { k: 'head', t: 'The Underspire' },
      { k: 'meta', t: 'ENTRY 9 · FILED UNDER: PHENOMENA, NOT PREVENTABLE' },
    ],
  },
  {
    id: 'light',
    tone: 1,
    cps: 46,
    hold: 1.1,
    wake: 0,
    depth: [0, 0],
    lines: [
      { k: 'body', t: 'Perennial exists to keep the light on.' },
      { k: 'body', t: 'Everyone we have ever raised from the dark was raised by one flame. We call it the Ember.' },
      { k: 'body', t: 'It left this shaft in 1791, in the hands of the only one who climbed back.' },
      { k: 'head', t: 'It is dimming.' },
    ],
  },
  {
    id: 'shaft',
    tone: 2,
    cps: 44,
    hold: 1.2,
    wake: 0.05,
    depth: [0, 556],
    lines: [
      { k: 'body', t: 'Below the capped mouth lie 556 metres of cut stone.' },
      { k: 'body', t: 'Every probe we lowered fell silent at the same depth.' },
      { k: 'head', t: 'So we are lowering a person.' },
    ],
  },
  {
    id: 'task',
    tone: 2.6,
    cps: 44,
    hold: 1.3,
    wake: 0.1,
    depth: [556, 556],
    lines: [
      { k: 'meta', t: 'DESCENT PROCEDURE' },
      { k: 'body', t: 'Go down. Rope by rope, lamp by lamp.' },
      { k: 'body', t: 'Reach the bottom. Take a fresh kindling from the source. Carry it back up to the light.' },
      { k: 'body', t: 'The lantern will fail before the shaft does. Your visor will not.' },
    ],
  },
  {
    id: 'before',
    tone: 4,
    cps: 26,
    hold: 0.2, // the cut ends the page
    wake: 1,
    depth: [556, 556],
    lost: true, // the gauge loses its number here
    lines: [
      { k: 'meta', t: 'ADDENDUM · RECOVERED · CONDITION: POOR' },
      { k: 'body', t: 'Something existed here before that.' },
      { k: 'body', t: 'Before the lamp. Before the first stone was cut.' },
      { k: 'body', t: 'Something we had not prepared for. A threat that may lie dormant for a hundred years, and wake in a breath.' },
      { k: 'body', t: 'It was never meant to be disturbed.' },
      { k: 'cut', t: 'We confronted it, but' },
    ],
  },
  {
    id: 'title',
    tone: 3,
    cps: 30,
    hold: 2.0,
    wake: 0.6,
    depth: [556, 556],
    lines: [
      { k: 'head', t: 'ABYSSAL TETHER' },
      { k: 'meta', t: 'EXPEDITION 41 · DESCENT AUTHORISED' },
    ],
  },
]);

export const TIMING = Object.freeze({
  lineGap: 0.38, // s between two lines of a page
  lineGapMeta: 0.22, // s after a meta line
  lead: 0.5, // s of the page fading in before the first character
  fadeIn: 0.55,
  fadeOut: 0.45,
  cutStatic: 1.1, // s of static after the last line is torn off
  ease: 3, // 1/s: how fast the tone / wake follow their page
});

const MAX_LINES = 8;

/** Precomputed: per page, the time each line starts typing, when the page has finished typing, and its length. */
function plan(p) {
  const starts = [];
  let t = TIMING.lead;
  for (let i = 0; i < p.lines.length; i++) {
    starts.push(t);
    t += p.lines[i].t.length / p.cps + (p.lines[i].k === 'meta' ? TIMING.lineGapMeta : TIMING.lineGap);
  }
  const typedEnd = t - TIMING.lineGap;
  const cutPage = p.lines.length > 0 && p.lines[p.lines.length - 1].k === 'cut';
  return { starts, typedEnd, dur: typedEnd + (cutPage ? TIMING.cutStatic : 0) + p.hold };
}

export const PLANS = Object.freeze(PAGES.map(plan));

/** Total running time of the whole story with no presses (s). */
export const TOTAL = PLANS.reduce((s, p) => s + p.dur, 0);

export class Prologue3D {
  /** @param {(type:string, arg?:any)=>void} [onEvent] */
  constructor(onEvent) {
    this.onEvent = onEvent || null;
    this.chars = new Array(MAX_LINES).fill(0);
    this.reset();
  }

  _emit(type, arg) {
    if (this.onEvent) this.onEvent(type, arg);
  }

  reset() {
    this.active = true;
    this.done = false;
    this.page = 0;
    this.pageT = 0;
    this.t = 0;
    this.tone = 0;
    this.wake = 0;
    this.glitch = 0;
    this.cut = -1;
    this.depth = 0;
    this.depthLost = false;
    this.pageIn = 0;
    this.pageOut = 0;
    this.typedEnd = PLANS[0].typedEnd;
    this.pageDur = PLANS[0].dur;
    this.chars.fill(0);
    this._cutFired = false;
    this._emit('page', 0);
  }

  _go(i) {
    if (i >= PAGES.length) {
      this._finish(false);
      return;
    }
    this.page = i;
    this.pageT = 0;
    this.cut = -1;
    this._cutFired = false;
    this.typedEnd = PLANS[i].typedEnd;
    this.pageDur = PLANS[i].dur;
    this.chars.fill(0);
    this._emit('page', i);
    if (PAGES[i].id === 'before') this._emit('dark');
  }

  _finish(skipped) {
    if (this.done) return;
    this.done = true;
    this.active = false;
    this._emit('end', !!skipped);
  }

  /** A press: finish the page that is still typing, else turn to the next one. */
  advance() {
    if (this.done) return;
    if (this.pageT < this.typedEnd - 0.05) {
      this.pageT = this.typedEnd; // typed at once
      this._fill();
    } else if (PAGES[this.page].lines[PAGES[this.page].lines.length - 1].k === 'cut' && this.cut >= 0 && this.cut < TIMING.cutStatic - 0.05) {
      this.pageT = this.typedEnd + TIMING.cutStatic; // the static runs its course, then the next page
    } else {
      this._go(this.page + 1);
    }
  }

  skipAll() {
    this._finish(true);
  }

  _fill() {
    const P = PAGES[this.page];
    for (let i = 0; i < P.lines.length; i++) this.chars[i] = P.lines[i].t.length;
  }

  update(dt) {
    if (this.done) return this;
    const d = dt > 0 ? (dt < 0.1 ? dt : 0.1) : 0;
    this.t += d;
    this.pageT += d;
    const P = PAGES[this.page];
    const pl = PLANS[this.page];
    // the typewriter
    for (let i = 0; i < P.lines.length; i++) {
      const n = Math.floor((this.pageT - pl.starts[i]) * P.cps);
      this.chars[i] = n < 0 ? 0 : n > P.lines[i].t.length ? P.lines[i].t.length : n;
    }
    // the tone / the glyph ring follow the page, eased
    const a = 1 - Math.exp(-TIMING.ease * d);
    this.tone += (P.tone - this.tone) * a;
    this.wake += (P.wake - this.wake) * a;
    // the depth gauge counts down the shaft while the page types
    const span = Math.max(0.1, pl.typedEnd - TIMING.lead);
    const f = Math.min(1, Math.max(0, (this.pageT - TIMING.lead) / span));
    const e = f * f * (3 - 2 * f);
    this.depth = P.depth[0] + (P.depth[1] - P.depth[0]) * e;
    this.depthLost = !!P.lost && this.pageT > pl.starts[2];
    // the record tears: the glitch builds through the last line and the static runs after it
    const last = P.lines[P.lines.length - 1];
    if (last.k === 'cut') {
      const c = this.pageT - pl.typedEnd;
      this.cut = c >= 0 ? c : -1;
      const build = Math.max(0, this.pageT - pl.starts[P.lines.length - 1]) / Math.max(0.1, last.t.length / P.cps);
      this.glitch = c >= 0 ? (c < TIMING.cutStatic ? 1 : Math.max(0, 1 - (c - TIMING.cutStatic) * 3)) : 0.25 * Math.min(1, build);
      if (c >= 0 && !this._cutFired) {
        this._cutFired = true;
        this._emit('cut');
      }
    } else {
      this.glitch = Math.max(0, this.glitch - d * 2);
    }
    this.pageIn = Math.min(1, this.pageT / TIMING.fadeIn);
    this.pageOut = Math.min(1, Math.max(0, (this.pageT - (pl.dur - TIMING.fadeOut)) / TIMING.fadeOut));
    if (this.pageT >= pl.dur) this._go(this.page + 1);
    return this;
  }
}
