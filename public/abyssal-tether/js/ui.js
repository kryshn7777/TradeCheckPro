/* ABYSSAL TETHER — ui.js
 * AT.UI: the DOM layer over the game canvas. Owns screen navigation (menu,
 * difficulty, controls, settings, pause, death, victory), the throttled HUD
 * (time, depth, section, tether-state glyph, depth gauge), contextual hints,
 * section title cards, toasts, the first-run touch-controls primer and the
 * portrait "turn sideways" hint. Menus are fully keyboard navigable (Tab
 * trap, arrow keys with spatial navigation, Enter/Space, Esc = back) and
 * touch friendly. The UI never runs game logic itself: it calls the public
 * AT.Game methods from the architecture contract and listens on the bus.
 */
(function (AT) {
  'use strict';
  const U = AT.util;

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------
  const SCREEN_NAMES = ['menu', 'difficulty', 'controls', 'settings', 'pause', 'death', 'victory'];
  /** Screens reached from the menu or the pause screen; Esc / Back returns. */
  const SUB_SCREENS = { difficulty: true, controls: true, settings: true };
  const HUD_TEXT_INTERVAL = 0.1; // s — HUD text refreshes at most 10x per second
  const SECTION_LABEL_TIME = 6; // s the HUD section label stays lit after a change
  const SECTION_CARD_MS = 4700; // matches the CSS section-card animation
  const DEATH_TAP_ARM_MS = 380; // stray taps right as the death screen opens are ignored
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

  // UI-only persisted flags (game settings live in AT.Storage.loadSettings()).
  const KEY_TIMER = 'ui.showTimer';
  const KEY_PRIMER = 'ui.touchPrimerSeen';
  const KEY_ROTATE = 'ui.rotateHintDismissed';

  const TETHER_LABELS = {
    idle: 'Tether: idle',
    target: 'Tether: anchor in reach',
    attached: 'Tether: attached',
    fragile: 'Tether: attached to a fragile anchor',
  };

  /** Fallback death copy by cause (the game may pass its own `message`). */
  const DEATH_COPY = {
    impact: { kicker: 'The ground came too fast', message: 'The fall was longer than the line.' },
    hazard: { kicker: 'Old iron', message: 'The ironwork was waiting for you.' },
    fall: { kicker: 'No floor', message: 'The dark had no bottom.' },
    creature: { kicker: 'Closer than it sounded', message: 'The Underspire closed its hand.' },
  };

  /** Settings screen schema. `local` keys are UI-only (not part of AT.SETTINGS_DEFAULTS). */
  const SETTINGS_SCHEMA = [
    { group: 'Sound' },
    {
      key: 'volume',
      type: 'range',
      label: 'Master volume',
      min: 0,
      max: 1,
      step: 0.05,
      format: (v) => `${Math.round(v * 100)}%`,
    },
    { group: 'Aim and control' },
    {
      key: 'sensitivity',
      type: 'range',
      label: 'Stick & aim sensitivity',
      desc: 'Virtual sticks, keyboard and gamepad aim.',
      min: 0.5,
      max: 2,
      step: 0.05,
      format: (v) => `${v.toFixed(2)}×`,
    },
    {
      key: 'aimAssist',
      type: 'range',
      label: 'Aim assist',
      desc: 'How generously the tether picks an anchor near your aim.',
      min: 0.6,
      max: 1.4,
      step: 0.05,
      format: (v) => `${Math.round(v * 100)}%`,
    },
    { group: 'Touch' },
    {
      key: 'touchControls',
      type: 'choice',
      label: 'On-screen controls',
      desc: 'Auto shows them on touch screens.',
      options: [
        ['auto', 'Auto'],
        ['always', 'Always'],
        ['never', 'Never'],
      ],
    },
    {
      key: 'touchAimMode',
      type: 'choice',
      label: 'Tether aim',
      desc: 'Touch the anchor itself, or push a right-hand aim stick.',
      options: [
        ['direct', 'Touch anchor'],
        ['stick', 'Aim stick'],
      ],
    },
    {
      key: 'touchGrappleMode',
      type: 'choice',
      label: 'Tether hold',
      desc: 'Hold a finger down to stay attached, or tap once to attach and again to let go.',
      options: [
        ['hold', 'Hold'],
        ['toggle', 'Tap to toggle'],
      ],
    },
    { key: 'haptics', type: 'toggle', label: 'Vibration', desc: 'Short pulses on attach, hard landings and death.' },
    { group: 'Comfort and visibility' },
    {
      key: 'highContrast',
      type: 'toggle',
      label: 'High contrast',
      desc: 'Bold, shape-coded anchors and indicators.',
    },
    { key: 'reducedEffects', type: 'toggle', label: 'Reduced effects', desc: 'Fewer particles, no distortion, lighter rendering.' },
    { key: 'reducedShake', type: 'toggle', label: 'Reduced screen shake' },
    { key: 'showTimer', type: 'toggle', label: 'Show run timer', local: true },
    { type: 'actions' },
  ];

  // ---------------------------------------------------------------------------
  // Small DOM helpers (only used on user actions / screen changes, never per frame)
  // ---------------------------------------------------------------------------
  function byId(id) {
    return document.getElementById(id);
  }
  function make(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }
  function media(query) {
    try {
      return typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
    } catch {
      return false;
    }
  }
  function now() {
    return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  }
  function isVisible(el) {
    return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  }
  function fmtMeters(m) {
    return `${Math.max(0, Math.round(m || 0))} m`;
  }
  function fmtTime(t) {
    return U.formatTime(t);
  }
  /** Fills `el` with `text`, turning `[Key]` tokens into <kbd> elements (no innerHTML). */
  function setRichText(el, text) {
    el.textContent = '';
    const parts = String(text).split(/(\[[^\]]{1,24}\])/);
    for (const part of parts) {
      if (!part) continue;
      if (part.length > 2 && part[0] === '[' && part[part.length - 1] === ']') {
        el.appendChild(make('kbd', null, part.slice(1, -1)));
      } else {
        el.appendChild(document.createTextNode(part));
      }
    }
  }
  function restartAnimation(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth; // force a style flush so the CSS animation restarts (rare: section change)
    el.classList.add(cls);
  }

  const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]';
  const ARROWS = {
    ArrowUp: { dx: 0, dy: -1 },
    ArrowDown: { dx: 0, dy: 1 },
    ArrowLeft: { dx: -1, dy: 0 },
    ArrowRight: { dx: 1, dy: 0 },
  };

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------
  class UI {
    /** @param {AT.Game} game */
    constructor(game) {
      this.game = game;
      /** Current screen name, or null while the game view is unobstructed. */
      this.current = null;
      this.touchMode = false;
      this._ready = false;
      this._pendingScreen = undefined;
      this._returnTo = 'menu';
      this._opener = null; // { screen, el } that opened a sub-screen (focus restore)
      this._showTimer = true;

      // HUD caches — compared before every DOM write.
      this._hud = {
        acc: HUD_TEXT_INTERVAL,
        inRun: null,
        time: '',
        depthM: -1,
        gauge: -1,
        section: -1,
        sectionT: 0,
        tether: '',
        diffKey: '',
        level: null,
      };
      this._hintT = 0;
      this._hintOn = false;
      this._toastTimer = 0;
      this._sectionTimer = 0;
      this._deathArmedAt = 0;
      this._primerStartKey = null;
      this._primerPending = false;
      this._primerReturnFocus = null;
      this._rotateDismissed = false;
      this._warpLevel = null;
      this._controlsTab = null;
      this._fsSupported = false;
      this._ctl = Object.create(null); // settings controls by key
      /** Last input modality: 'none' (fresh page) | 'keyboard' | 'pointer'. */
      this._modality = 'none';
    }

    // ------------------------------------------------------------------ setup
    /** Binds the DOM, builds dynamic controls, shows best times and the menu. */
    init() {
      if (this._ready) return;
      this.root = byId('ui');
      if (!this.root) {
        if (typeof console !== 'undefined') console.error('[AT] UI root #ui missing from index.html');
        return;
      }
      this.screens = Object.create(null);
      for (const name of SCREEN_NAMES) this.screens[name] = byId(`screen-${name}`);
      this.dom = {
        hud: byId('hud'),
        hudTime: byId('hud-time'),
        hudDepth: byId('hud-depth'),
        hudDiff: byId('hud-diff'),
        hudBest: byId('hud-best'),
        hudSection: byId('hud-section'),
        hudTether: byId('hud-tether'),
        gaugeMarker: byId('hud-gauge-marker'),
        gaugeTicks: byId('hud-gauge-ticks'),
        sectionCard: byId('section-card'),
        sectionNum: byId('section-num'),
        sectionName: byId('section-name'),
        sectionSub: byId('section-sub'),
        hint: byId('hint'),
        toast: byId('toast'),
        toastText: byId('toast-text'),
        pauseBtn: byId('btn-pause'),
        menuStartSub: byId('menu-start-sub'),
        menuBest: byId('menu-best'),
        diffGrid: byId('diff-grid'),
        tabs: byId('controls-tabs'),
        settingsBody: byId('settings-body'),
        pausePanel: document.querySelector('#screen-pause .panel'),
        pauseStats: byId('pause-stats'),
        pauseRespawn: byId('pause-respawn'),
        pauseWarp: byId('pause-warp'),
        warpGrid: byId('warp-grid'),
        deathKicker: byId('death-kicker'),
        deathMsg: byId('death-msg'),
        deathStats: byId('death-stats'),
        deathContinue: byId('death-continue'),
        deathContinueSub: byId('death-continue-sub'),
        vTime: byId('v-time'),
        vNew: byId('v-newbest'),
        vBest: byId('v-best'),
        vPrev: byId('v-prev'),
        vDeaths: byId('v-deaths'),
        vDeepest: byId('v-deepest'),
        vDiff: byId('v-diff'),
        vNote: byId('v-note'),
        primer: byId('touch-primer'),
        primerFire: byId('primer-fire'),
        primerOk: byId('primer-ok'),
        rotate: byId('rotate-hint'),
      };

      this._showTimer = AT.Storage.get(KEY_TIMER, true) !== false;
      this._rotateDismissed = AT.Storage.get(KEY_ROTATE, false) === true;
      document.body.classList.toggle('timer-off', !this._showTimer);

      this._cloneTouchDiagrams();
      this._buildBestStrip();
      this._buildDifficultyCards();
      this._buildSettings();
      this._setupFullscreen();
      this._bindDom();
      this._bindBus();
      this.syncSettings();

      // Presentation guess before the first input: phones/tablets without a fine pointer.
      const game = this.game || {};
      const coarseOnly = media('(pointer: coarse)') && !media('(any-pointer: fine)');
      this.setTouchMode(!!(game.isTouch || coarseOnly));

      this._ready = true;
      document.body.classList.remove('is-loading');
      this.refreshMenu();

      let first = this._pendingScreen;
      if (first === undefined) first = !game.state || game.state === 'menu' ? 'menu' : null;
      this.current = undefined; // force a full apply
      this.show(first);
    }

    _cloneTouchDiagrams() {
      const tpl = byId('tpl-touch-diagram');
      if (!tpl || !tpl.content) return;
      const slots = document.querySelectorAll('.touch-diagram-slot');
      for (const slot of slots) {
        slot.textContent = '';
        slot.appendChild(tpl.content.cloneNode(true));
      }
    }

    _bindDom() {
      // One delegated click handler for every [data-action] control.
      this.root.addEventListener('click', (e) => this._onClick(e));
      // Touch presentation + keep UI pointers away from any window-level gameplay listeners.
      this.root.addEventListener('pointerdown', (e) => this._onPointerDown(e));
      // Capture phase so Esc / Enter / Space aimed at a focused menu control are
      // handled here before window-level gameplay input sees them.
      window.addEventListener('keydown', (e) => this._onKeyDown(e), true);
      // Input modality (decides whether opening a screen should move focus).
      window.addEventListener(
        'pointerdown',
        () => {
          this._modality = 'pointer';
        },
        true,
      );

      const onOrient = () => this._updateRotateHint();
      window.addEventListener('resize', onOrient);
      window.addEventListener('orientationchange', onOrient);

      const onFs = () => this._syncFullscreen();
      document.addEventListener('fullscreenchange', onFs);
      document.addEventListener('webkitfullscreenchange', onFs);
    }

    _bindBus() {
      const bus = this.game && this.game.bus;
      if (!bus || typeof bus.on !== 'function') return;
      bus.on('settings:changed', () => this.syncSettings());
      bus.on('game:start', () => {
        this._resetHudCache();
        this.hideHint();
        if (this.current !== null) this.show(null);
      });
      bus.on('game:restart', () => {
        this._resetHudCache();
        this.hideHint();
      });
      bus.on('game:respawn', () => {
        if (this.current === 'death' || this.current === 'pause') this.show(null);
      });
      bus.on('game:pause', () => {
        if (this.current === null) this.show('pause');
      });
      bus.on('game:resume', () => {
        // Resume can also arrive from gameplay input (Esc / P) while a sub-screen opened
        // from pause is visible: never leave a menu over a running game.
        if (this.current !== null && this.current !== 'menu' && this.current !== 'victory') this.show(null);
      });
      bus.on('game:menu', () => {
        this.hideHint();
        if (this.current !== 'menu') this.show('menu');
      });
      bus.on('game:victory', () => this.hideHint());
    }

    // ------------------------------------------------------------------ screens
    /**
     * Shows a screen by name, or the bare game view with `null`.
     * @param {'menu'|'difficulty'|'controls'|'settings'|'pause'|'death'|'victory'|null} name
     */
    show(name) {
      if (name === undefined) name = null;
      if (name !== null && SCREEN_NAMES.indexOf(name) < 0) {
        if (typeof console !== 'undefined') console.warn(`[AT] UI.show: unknown screen "${name}"`);
        return;
      }
      if (!this._ready) {
        this._pendingScreen = name;
        this.current = name;
        return;
      }
      const prev = this.current;
      const game = this.game || {};

      if (SUB_SCREENS[name] && prev !== name) {
        if (prev === 'menu' || prev === 'pause') this._returnTo = prev;
        else this._returnTo = game.state === 'paused' ? 'pause' : 'menu';
        if (prev === 'menu' || prev === 'pause') {
          const active = document.activeElement;
          this._opener = { screen: prev, el: active && this.screens[prev].contains(active) ? active : null };
        }
      }

      this.current = name;
      for (const n of SCREEN_NAMES) {
        const el = this.screens[n];
        if (!el) continue;
        const on = n === name;
        if (el.hidden === on) el.hidden = !on;
      }
      const body = document.body;
      body.dataset.screen = name || 'none';
      body.classList.toggle('playing', name === null);

      const input = game.input;
      if (input && typeof input.setGameplayActive === 'function') {
        try {
          input.setGameplayActive(name === null);
        } catch (err) {
          if (typeof console !== 'undefined') console.error('[AT] input.setGameplayActive failed', err);
        }
      }

      if (name === 'menu') this.refreshMenu();
      else if (name === 'difficulty') this._refreshDifficulty();
      else if (name === 'settings') this.syncSettings();
      else if (name === 'controls' && prev !== 'controls') this._prepareControls();
      else if (name === 'pause') this._preparePause();

      if (name === null) {
        // Never leave keyboard focus on a hidden button (Space would "click" it).
        const active = document.activeElement;
        if (active && active !== document.body && this.root.contains(active) && typeof active.blur === 'function') {
          active.blur();
        }
        if (this.dom.primer && !this.dom.primer.hidden && this._primerStartKey === null) this._closePrimer(false);
      } else if (prev !== name) {
        this._focusInitial(name, prev);
      }

      if (this._primerPending && (name === 'pause' || name === 'menu')) {
        this._primerPending = false;
        this._openPrimer(null);
      }
      this._updateRotateHint();
    }

    _focusInitial(name, prev) {
      const screen = this.screens[name];
      if (!screen) return;
      // On a fresh page nobody has interacted yet: don't paint a focus ring on the
      // title screen. The first Tab / arrow press focuses the first control.
      if (this._modality === 'none' && name !== 'death') return;
      // Coming back from a sub-screen: return focus to the button that opened it.
      if (this._opener && this._opener.screen === name && SUB_SCREENS[prev]) {
        const el = this._opener.el;
        this._opener = null;
        if (el && screen.contains(el) && isVisible(el)) {
          el.focus({ preventScroll: true });
          return;
        }
      }
      let target = null;
      const auto = screen.querySelectorAll('[data-autofocus]');
      for (const el of auto) {
        if (isVisible(el) && !el.disabled) {
          target = el;
          break;
        }
      }
      if (!target) target = this._focusables(screen)[0] || null;
      if (target) target.focus({ preventScroll: true });
    }

    _back() {
      const state = this.game && this.game.state;
      let target = this._returnTo || 'menu';
      if (state === 'paused') target = 'pause';
      else if (state === 'menu' || !state) target = 'menu';
      else if (state === 'playing') target = null;
      this.show(target);
    }

    _openSub(name) {
      this.show(name);
    }

    // ------------------------------------------------------------------ menu
    /** Updates best times on the menu, the Start sub-label and difficulty cards. */
    refreshMenu() {
      if (!this.dom) return;
      const key = this._defaultDifficulty();
      const diff = AT.DIFFICULTY[key];
      const best = AT.Storage.getBest(key);
      if (this.dom.menuStartSub) {
        this.dom.menuStartSub.textContent = best != null ? `${diff.label} · best ${fmtTime(best)}` : diff.label;
      }
      if (this._bestCells) {
        for (const k of AT.DIFFICULTY_ORDER) {
          const dd = this._bestCells[k];
          if (!dd) continue;
          const b = AT.Storage.getBest(k);
          dd.textContent = b != null ? fmtTime(b) : '—';
          dd.classList.toggle('is-empty', b == null);
        }
      }
      this._refreshDifficulty();
    }

    _defaultDifficulty() {
      const s = this.game && this.game.settings;
      const last = s && s.lastDifficulty;
      return last && AT.DIFFICULTY_ORDER.indexOf(last) >= 0 ? last : 'normal';
    }

    _buildBestStrip() {
      const dl = this.dom.menuBest;
      if (!dl) return;
      dl.textContent = '';
      this._bestCells = Object.create(null);
      for (const key of AT.DIFFICULTY_ORDER) {
        const row = make('div');
        row.appendChild(make('dt', null, AT.DIFFICULTY[key].label));
        const dd = make('dd', 'is-empty', '—');
        row.appendChild(dd);
        dl.appendChild(row);
        this._bestCells[key] = dd;
      }
    }

    _buildDifficultyCards() {
      const grid = this.dom.diffGrid;
      if (!grid) return;
      grid.textContent = '';
      this._diffCards = Object.create(null);
      AT.DIFFICULTY_ORDER.forEach((key, i) => {
        const d = AT.DIFFICULTY[key];
        const card = make('button', 'diff-card');
        card.type = 'button';
        card.dataset.action = 'start-diff';
        card.dataset.diff = key;
        const glyph = make('span', 'diff-glyph');
        glyph.setAttribute('aria-hidden', 'true');
        for (let n = 0; n < AT.DIFFICULTY_ORDER.length; n++) glyph.appendChild(make('i', n <= i ? 'on' : null));
        const tag = make('span', 'diff-tag', 'Last played');
        tag.hidden = true;
        const stats = make('span', 'diff-stats');
        const best = make('span', 'diff-best');
        const meta = make('span', 'diff-meta');
        stats.append(best, meta);
        card.append(glyph, make('span', 'diff-name', d.label), make('span', 'diff-blurb', d.blurb), stats, tag);
        grid.appendChild(card);
        this._diffCards[key] = { card, best, meta, tag };
      });
    }

    _refreshDifficulty() {
      if (!this._diffCards) return;
      const last = this._defaultDifficulty();
      for (const key of AT.DIFFICULTY_ORDER) {
        const c = this._diffCards[key];
        if (!c) continue;
        const b = AT.Storage.getBest(key);
        c.best.textContent = '';
        c.best.append('Best ');
        c.best.appendChild(make('b', null, b != null ? fmtTime(b) : '—'));
        const st = AT.Storage.getStats(key);
        const bits = [];
        if (st.completions > 0) bits.push(`${st.completions} descent${st.completions === 1 ? '' : 's'}`);
        if (st.deepest > 0) bits.push(`deepest ${fmtMeters(st.deepest)}`);
        c.meta.textContent = bits.length ? bits.join(' · ') : 'Not yet attempted';
        const isLast = key === last;
        c.tag.hidden = !isLast;
        c.card.classList.toggle('is-last', isLast);
        c.card.toggleAttribute('data-autofocus', isLast);
        c.card.setAttribute('aria-label', `${AT.DIFFICULTY[key].label}. ${AT.DIFFICULTY[key].blurb} Best ${b != null ? fmtTime(b) : 'none'}.`);
      }
    }

    // ------------------------------------------------------------------ controls screen
    _prepareControls() {
      const input = this.game && this.game.input;
      let tab = this.touchMode ? 'touch' : 'desktop';
      if (!this.touchMode && input && input.lastSource === 'gamepad') tab = 'pad';
      this._orderControlTabs();
      this._selectTab(tab, false);
    }

    _orderControlTabs() {
      const list = this.dom && this.dom.tabs;
      if (!list) return;
      const touch = byId('tab-touch');
      const desk = byId('tab-desktop');
      const pad = byId('tab-pad');
      if (!touch || !desk || !pad) return;
      const order = this.touchMode ? [touch, desk, pad] : [desk, pad, touch];
      for (const el of order) list.appendChild(el); // re-appending moves it
    }

    _selectTab(name, focus) {
      const tabs = this.dom.tabs ? this.dom.tabs.querySelectorAll('[role="tab"]') : [];
      for (const tab of tabs) {
        const on = tab.dataset.tab === name;
        tab.setAttribute('aria-selected', on ? 'true' : 'false');
        tab.tabIndex = on ? 0 : -1;
        tab.toggleAttribute('data-autofocus', on);
        const panel = byId(tab.getAttribute('aria-controls'));
        if (panel) panel.hidden = !on;
        if (on && focus) tab.focus();
      }
      this._controlsTab = name;
    }

    // ------------------------------------------------------------------ settings
    _buildSettings() {
      const body = this.dom.settingsBody;
      if (!body) return;
      body.textContent = '';
      let group = null;
      let gi = 0;
      for (const def of SETTINGS_SCHEMA) {
        if (def.group) {
          group = make('section', 'set-group');
          const h = make('h3', 'group-title', def.group);
          h.id = `set-group-${gi++}`;
          group.setAttribute('aria-labelledby', h.id);
          group.appendChild(h);
          body.appendChild(group);
          continue;
        }
        if (!group) continue;
        if (def.type === 'actions') {
          group.appendChild(this._buildSettingActions());
          continue;
        }
        group.appendChild(this._buildSettingRow(def));
      }
      // Keyboard users land on the first setting, not on Back.
      const first = body.querySelector('input, button');
      if (first) first.setAttribute('data-autofocus', '');
    }

    _buildSettingRow(def) {
      const id = `set-${def.key}`;
      const row = make('div', 'set-row');
      const label = make('div', 'set-label');
      const name = def.type === 'choice' ? make('span', 'set-name', def.label) : make('label', 'set-name', def.label);
      name.id = `${id}-label`;
      if (def.type !== 'choice') name.htmlFor = id;
      label.appendChild(name);
      let descText = def.desc || '';
      if (def.key === 'haptics' && !(typeof navigator !== 'undefined' && 'vibrate' in navigator)) {
        descText = 'Not supported by this browser.';
      }
      let desc = null;
      if (descText) {
        desc = make('p', 'set-desc', descText);
        desc.id = `${id}-desc`;
        label.appendChild(desc);
      }
      const ctlWrap = make('div', 'set-control');
      const entry = { def, row };

      if (def.type === 'range') {
        const wrap = make('div', 'range-wrap');
        const input = make('input');
        input.type = 'range';
        input.id = id;
        input.min = String(def.min);
        input.max = String(def.max);
        input.step = String(def.step);
        if (desc) input.setAttribute('aria-describedby', desc.id);
        const out = make('output');
        out.htmlFor = id;
        input.addEventListener('input', () => this._onRange(def, input, false));
        input.addEventListener('change', () => this._onRange(def, input, true));
        wrap.append(input, out);
        ctlWrap.appendChild(wrap);
        entry.input = input;
        entry.out = out;
      } else if (def.type === 'toggle') {
        const btn = make('button', 'switch');
        btn.type = 'button';
        btn.id = id;
        btn.setAttribute('role', 'switch');
        btn.setAttribute('aria-checked', 'false');
        if (desc) btn.setAttribute('aria-describedby', desc.id);
        btn.dataset.action = 'toggle';
        btn.dataset.key = def.key;
        const track = make('span', 'switch-track');
        track.setAttribute('aria-hidden', 'true');
        track.appendChild(make('span', 'switch-knob'));
        const text = make('span', 'switch-text', 'Off');
        text.setAttribute('aria-hidden', 'true');
        btn.append(track, text);
        ctlWrap.appendChild(btn);
        entry.btn = btn;
        entry.text = text;
      } else if (def.type === 'choice') {
        const seg = make('div', 'seg');
        seg.setAttribute('role', 'radiogroup');
        seg.setAttribute('aria-labelledby', name.id);
        if (desc) seg.setAttribute('aria-describedby', desc.id);
        entry.options = [];
        for (const [value, text] of def.options) {
          const b = make('button');
          b.type = 'button';
          b.setAttribute('role', 'radio');
          b.setAttribute('aria-checked', 'false');
          b.tabIndex = -1;
          b.dataset.action = 'choice';
          b.dataset.key = def.key;
          b.dataset.value = value;
          const mark = make('span', 'seg-mark');
          mark.setAttribute('aria-hidden', 'true');
          b.append(mark, text);
          seg.appendChild(b);
          entry.options.push(b);
        }
        ctlWrap.appendChild(seg);
      }
      row.append(label, ctlWrap);
      this._ctl[def.key] = entry;
      return row;
    }

    _buildSettingActions() {
      const row = make('div', 'set-actions');
      const fs = make('button', 'btn');
      fs.type = 'button';
      fs.dataset.action = 'fullscreen';
      fs.setAttribute('aria-pressed', 'false');
      fs.appendChild(make('span', 'btn-label', 'Enter fullscreen'));
      fs.hidden = true; // revealed by _setupFullscreen when supported
      const reset = make('button', 'btn btn-ghost');
      reset.type = 'button';
      reset.dataset.action = 'reset-settings';
      reset.appendChild(make('span', 'btn-label', 'Restore defaults'));
      row.append(fs, reset);
      return row;
    }

    _onRange(def, input, committed) {
      const v = U.clamp(parseFloat(input.value), def.min, def.max);
      if (!isFinite(v)) return;
      this._applySetting(def.key, v);
      if (committed) this._emitClick(); // one blip at the new volume when the drag ends
    }

    _applySetting(key, value) {
      if (key === 'showTimer') {
        this._showTimer = !!value;
        AT.Storage.set(KEY_TIMER, this._showTimer);
        document.body.classList.toggle('timer-off', !this._showTimer);
        this._hud.time = ''; // force a rewrite when shown again
        this.syncSettings();
        return;
      }
      const partial = {};
      partial[key] = value;
      const game = this.game || {};
      if (typeof game.applySettings === 'function') {
        try {
          game.applySettings(partial);
        } catch (err) {
          if (typeof console !== 'undefined') console.error('[AT] applySettings failed', err);
        }
      } else if (game.settings) {
        Object.assign(game.settings, partial);
        AT.Storage.saveSettings(game.settings);
      }
      this.syncSettings();
    }

    /**
     * Reflects the live settings object into body classes and every settings
     * control. Safe to call any time (also bound to `settings:changed`).
     */
    syncSettings() {
      const s = (this.game && this.game.settings) || AT.SETTINGS_DEFAULTS;
      const body = document.body;
      body.classList.toggle('high-contrast', !!s.highContrast);
      body.classList.toggle('reduced-effects', !!s.reducedEffects);
      if (!this._ctl) return;
      for (const key in this._ctl) {
        const c = this._ctl[key];
        const def = c.def;
        const value = def.local ? (key === 'showTimer' ? this._showTimer : null) : s[key];
        if (def.type === 'range') {
          const v = typeof value === 'number' && isFinite(value) ? value : AT.SETTINGS_DEFAULTS[key];
          const str = String(v);
          if (c.input.value !== str && document.activeElement !== c.input) c.input.value = str;
          const shown = parseFloat(c.input.value);
          const pct = ((shown - def.min) / (def.max - def.min)) * 100;
          c.input.style.setProperty('--fill', `${U.clamp(pct, 0, 100).toFixed(1)}%`);
          const txt = def.format(shown);
          if (c.out.textContent !== txt) c.out.textContent = txt;
          c.input.setAttribute('aria-valuetext', txt);
        } else if (def.type === 'toggle') {
          const on = !!value;
          c.btn.setAttribute('aria-checked', on ? 'true' : 'false');
          c.text.textContent = on ? 'On' : 'Off';
        } else if (def.type === 'choice') {
          let any = false;
          for (const b of c.options) {
            const on = b.dataset.value === value;
            if (on) any = true;
            b.setAttribute('aria-checked', on ? 'true' : 'false');
            b.tabIndex = on ? 0 : -1;
          }
          if (!any && c.options[0]) c.options[0].tabIndex = 0;
        }
      }
    }

    _resetSettings() {
      const partial = {};
      for (const key of Object.keys(AT.SETTINGS_DEFAULTS)) {
        if (key === 'lastDifficulty') continue;
        partial[key] = AT.SETTINGS_DEFAULTS[key];
      }
      const game = this.game || {};
      if (typeof game.applySettings === 'function') {
        try {
          game.applySettings(partial);
        } catch (err) {
          if (typeof console !== 'undefined') console.error('[AT] applySettings failed', err);
        }
      } else if (game.settings) {
        Object.assign(game.settings, partial);
        AT.Storage.saveSettings(game.settings);
      }
      this._showTimer = true;
      AT.Storage.set(KEY_TIMER, true);
      document.body.classList.remove('timer-off');
      this.syncSettings();
      this.showToast('Settings restored', 1.6);
    }

    // ------------------------------------------------------------------ fullscreen
    _setupFullscreen() {
      const d = document;
      const el = d.documentElement;
      this._fsSupported = !!(
        (d.fullscreenEnabled || d.webkitFullscreenEnabled) &&
        (el.requestFullscreen || el.webkitRequestFullscreen)
      );
      const btns = this.root.querySelectorAll('[data-action="fullscreen"]');
      for (const b of btns) b.hidden = !this._fsSupported;
      this._syncFullscreen();
    }

    _syncFullscreen() {
      const d = document;
      const on = !!(d.fullscreenElement || d.webkitFullscreenElement);
      const btns = this.root ? this.root.querySelectorAll('[data-action="fullscreen"]') : [];
      for (const b of btns) {
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        const label = on ? 'Exit fullscreen' : 'Enter fullscreen';
        const span = b.querySelector('.btn-label');
        if (span) span.textContent = label;
        else b.setAttribute('aria-label', label);
      }
    }

    _toggleFullscreen() {
      const game = this.game || {};
      if (typeof game.toggleFullscreen === 'function') {
        this._call('toggleFullscreen');
        return;
      }
      // Fallback (only if the game lacks the method).
      const d = document;
      const el = d.documentElement;
      try {
        if (d.fullscreenElement || d.webkitFullscreenElement) {
          (d.exitFullscreen || d.webkitExitFullscreen).call(d);
        } else {
          const req = el.requestFullscreen || el.webkitRequestFullscreen;
          const p = req && req.call(el);
          if (p && typeof p.catch === 'function') p.catch(() => {});
        }
      } catch {
        /* fullscreen refused — nothing to do */
      }
    }

    // ------------------------------------------------------------------ pause
    _preparePause() {
      const game = this.game || {};
      const diff = game.diff || AT.DIFFICULTY[game.difficultyKey] || AT.DIFFICULTY.normal;
      const p = game.player;
      const bits = [diff.label, fmtTime(game.time || 0)];
      if (p) bits.push(fmtMeters(U.depthMeters(p.y)));
      if (game.difficultyKey !== 'sandbox') bits.push(`${game.deaths || 0} death${game.deaths === 1 ? '' : 's'}`);
      this.dom.pauseStats.textContent = bits.join(' · ');

      this.dom.pauseRespawn.hidden = !(diff.checkpoints && diff.checkpoints !== 'none' && p);
      // Two-column landscape layout: an odd count of secondary buttons lets the last one span.
      const actions = this.dom.pauseRespawn.parentNode;
      let secondary = 0;
      for (const b of actions.children) if (!b.hidden && !b.classList.contains('btn-primary')) secondary++;
      actions.classList.toggle('is-odd', secondary % 2 === 1);

      const sandbox = game.difficultyKey === 'sandbox';
      const sections = sandbox && game.level && Array.isArray(game.level.sections) ? game.level.sections : null;
      this.dom.pauseWarp.hidden = !sections;
      if (this.dom.pausePanel) this.dom.pausePanel.classList.toggle('has-warp', !!sections);
      if (sections) {
        if (this._warpLevel !== game.level) this._buildWarpList(sections, game.level);
        const cur = game.sectionIndex | 0;
        const btns = this.dom.warpGrid.children;
        for (let i = 0; i < btns.length; i++) btns[i].classList.toggle('is-current', i === cur);
      }
    }

    _buildWarpList(sections, level) {
      const grid = this.dom.warpGrid;
      grid.textContent = '';
      sections.forEach((s, i) => {
        const b = make('button', 'warp-btn');
        b.type = 'button';
        b.dataset.action = 'warp';
        b.dataset.section = String(i);
        b.append(make('span', 'warp-num', ROMAN[i] || String(i + 1)), make('span', 'warp-name', s.name || `Section ${i + 1}`));
        b.setAttribute('aria-label', `Warp to section ${i + 1}: ${s.name || ''}`);
        grid.appendChild(b);
      });
      this._warpLevel = level;
    }

    // ------------------------------------------------------------------ death / victory
    /**
     * @param {{cause?:string, deaths?:number, canRespawn?:boolean, depthMeters?:number, time?:number, message?:string}} info
     */
    showDeath(info) {
      if (!this._ready) return;
      const i = info || {};
      const copy = DEATH_COPY[i.cause] || DEATH_COPY.impact;
      this.dom.deathKicker.textContent = copy.kicker;
      this.dom.deathMsg.textContent = i.message || copy.message;
      const bits = [];
      if (typeof i.deaths === 'number') bits.push(`Deaths ${i.deaths}`);
      if (typeof i.depthMeters === 'number') bits.push(fmtMeters(i.depthMeters));
      if (typeof i.time === 'number') bits.push(fmtTime(i.time));
      this.dom.deathStats.textContent = bits.join(' · ');
      const canRespawn = i.canRespawn !== false;
      this.dom.deathContinue.querySelector('.btn-label').textContent = canRespawn ? 'Continue' : 'Begin again';
      this.dom.deathContinueSub.textContent = canRespawn ? 'from the last checkpoint' : 'no checkpoints on this difficulty';
      this._deathArmedAt = now() + DEATH_TAP_ARM_MS;
      this.hideHint();
      this.show('death');
    }

    /**
     * @param {{time:number, best:number|null, previous:number|null, isNew:boolean, deaths:number,
     *          deepestMeters:number, difficultyKey:string, label?:string}} info
     */
    showVictory(info) {
      if (!this._ready) return;
      const i = info || {};
      const key = i.difficultyKey || (this.game && this.game.difficultyKey) || 'normal';
      const diff = AT.DIFFICULTY[key] || AT.DIFFICULTY.normal;
      const recorded = diff.recordTimes !== false && key !== 'sandbox';
      const d = this.dom;
      d.vTime.textContent = fmtTime(i.time);
      d.vNew.hidden = !(recorded && i.isNew);
      d.vDeaths.textContent = String(i.deaths || 0);
      d.vDeepest.textContent = fmtMeters(i.deepestMeters);
      d.vDiff.textContent = i.label || diff.label;

      d.vBest.textContent = '';
      d.vPrev.textContent = '';
      if (!recorded) {
        d.vBest.textContent = '—';
        d.vPrev.textContent = '—';
        d.vNote.textContent = 'Sandbox descents are not timed for the records.';
      } else {
        d.vBest.textContent = i.best != null ? fmtTime(i.best) : fmtTime(i.time);
        if (i.previous != null) {
          d.vPrev.textContent = fmtTime(i.previous);
          const delta = i.time - i.previous;
          if (isFinite(delta) && delta !== 0) {
            const sign = delta < 0 ? '−' : '+';
            d.vPrev.appendChild(make('small', null, `${sign}${Math.abs(delta).toFixed(2)} s`));
          }
        } else {
          d.vPrev.textContent = 'First descent';
        }
        d.vNote.textContent = '';
      }
      this.hideHint();
      this.show('victory');
      this.refreshMenu();
    }

    _continueFromDeath(fromBackgroundTap) {
      const game = this.game || {};
      if (game.state !== 'dead') return;
      if (fromBackgroundTap && now() < this._deathArmedAt) return;
      this._call('respawn');
      if (game.state === 'playing' && this.current !== null) this.show(null);
    }

    // ------------------------------------------------------------------ HUD
    /**
     * Per-frame HUD update. Text is refreshed at most every 100 ms and only
     * written when it changed; the tether glyph attribute only on change.
     * @param {AT.Game} game
     * @param {number} dt seconds
     */
    updateHUD(game, dt) {
      if (!this._ready) return;
      const g = game || this.game;
      if (!g) return;
      const h = this._hud;
      const state = g.state;
      const inRun = state === 'playing' || state === 'paused' || state === 'dead' || state === 'victory';
      if (inRun !== h.inRun) {
        h.inRun = inRun;
        document.body.classList.toggle('in-run', inRun);
        if (!inRun) {
          this.hideHint();
          this._resetHudCache();
          h.inRun = false;
        }
      }
      if (!inRun) return;
      const step = dt > 0 && dt < 1 ? dt : 0;

      if (this._hintOn && state === 'playing') {
        this._hintT -= step;
        if (this._hintT <= 0) this.hideHint();
      }
      if (h.sectionT > 0) {
        h.sectionT -= step;
        if (h.sectionT <= 0) this.dom.hudSection.classList.remove('is-on');
      }

      // Tether state glyph (shape-coded): cheap string compare every frame.
      const tether = this._tetherState(g.grapple);
      if (tether !== h.tether) {
        h.tether = tether;
        this.dom.hudTether.dataset.state = tether;
        this.dom.hudTether.setAttribute('aria-label', TETHER_LABELS[tether]);
      }

      h.acc += step;
      if (h.acc < HUD_TEXT_INTERVAL) return;
      h.acc = 0;

      if (this._showTimer) {
        const t = fmtTime(g.time || 0);
        if (t !== h.time) {
          h.time = t;
          this.dom.hudTime.textContent = t;
        }
      }

      const p = g.player;
      if (p) {
        const m = U.depthMeters(p.y);
        if (m !== h.depthM) {
          h.depthM = m;
          this.dom.hudDepth.textContent = `${m} m`;
        }
        const level = g.level;
        if (level && level.bounds) {
          if (h.level !== level) this._buildGaugeTicks(level);
          const y0 = level.bounds.y0 || 0;
          const y1 = level.data && typeof level.data.bottom === 'number' ? level.data.bottom : level.bounds.y1;
          const frac = y1 > y0 ? U.clamp((p.y - y0) / (y1 - y0), 0, 1) : 0;
          if (Math.abs(frac - h.gauge) > 0.002) {
            h.gauge = frac;
            this.dom.gaugeMarker.style.setProperty('--p', frac.toFixed(4));
          }
        }
      }

      if (g.difficultyKey !== h.diffKey) {
        h.diffKey = g.difficultyKey;
        const d = AT.DIFFICULTY[h.diffKey];
        this.dom.hudDiff.textContent = d ? d.label : '';
        const best = d && d.recordTimes !== false ? AT.Storage.getBest(h.diffKey) : null;
        this.dom.hudBest.hidden = best == null;
        if (best != null) this.dom.hudBest.textContent = `Best ${fmtTime(best)}`;
      }

      const si = g.sectionIndex | 0;
      if (si !== h.section) {
        h.section = si;
        const sec = g.level && g.level.sections ? g.level.sections[si] : null;
        if (sec) {
          this.dom.hudSection.textContent = `${ROMAN[si] || si + 1} · ${sec.name}`;
          this.dom.hudSection.classList.add('is-on');
          h.sectionT = SECTION_LABEL_TIME;
        }
      }
    }

    _tetherState(grapple) {
      if (!grapple) return 'idle';
      const anchor = grapple.anchor;
      if (anchor) return anchor.kind === 'fragile' ? 'fragile' : 'attached';
      return grapple.target ? 'target' : 'idle';
    }

    _buildGaugeTicks(level) {
      const h = this._hud;
      h.level = level;
      const box = this.dom.gaugeTicks;
      if (!box) return;
      box.textContent = '';
      const y0 = level.bounds.y0 || 0;
      const y1 = level.data && typeof level.data.bottom === 'number' ? level.data.bottom : level.bounds.y1;
      if (!(y1 > y0) || !Array.isArray(level.sections)) return;
      for (let i = 1; i < level.sections.length; i++) {
        const f = U.clamp((level.sections[i].y0 - y0) / (y1 - y0), 0, 1);
        const tick = make('i');
        tick.style.top = `${(f * 100).toFixed(2)}%`;
        box.appendChild(tick);
      }
    }

    _resetHudCache() {
      const h = this._hud;
      h.acc = HUD_TEXT_INTERVAL;
      h.time = '';
      h.depthM = -1;
      h.gauge = -1;
      h.section = -1;
      h.sectionT = 0;
      h.tether = '';
      h.diffKey = '';
      if (this.dom && this.dom.hudSection) this.dom.hudSection.classList.remove('is-on');
    }

    // ------------------------------------------------------------------ hints, cards, toasts
    /** Contextual hint (bottom centre). `[Key]` tokens render as keycaps. */
    showHint(text, seconds) {
      if (!this._ready || !text) return;
      const el = this.dom.hint;
      setRichText(el, text);
      this._hintT = seconds > 0 ? seconds : 4.5;
      this._hintOn = true;
      el.classList.add('is-on');
    }

    hideHint() {
      this._hintOn = false;
      this._hintT = 0;
      if (this.dom && this.dom.hint) this.dom.hint.classList.remove('is-on');
    }

    /** Large carved section title card that fades in and out. */
    showSectionTitle(name, subtitle) {
      if (!this._ready || !name) return;
      const d = this.dom;
      const sections = this.game && this.game.level && this.game.level.sections;
      let idx = -1;
      if (Array.isArray(sections)) {
        for (let i = 0; i < sections.length; i++) {
          if (sections[i] && sections[i].name === name) {
            idx = i;
            break;
          }
        }
      }
      d.sectionNum.textContent = idx >= 0 ? `— ${ROMAN[idx] || idx + 1} —` : '';
      d.sectionName.textContent = name;
      d.sectionSub.textContent = subtitle || '';
      restartAnimation(d.sectionCard, 'is-on');
      clearTimeout(this._sectionTimer);
      this._sectionTimer = setTimeout(() => d.sectionCard.classList.remove('is-on'), SECTION_CARD_MS);
    }

    /** Small top-centre notice, e.g. "Checkpoint". */
    showToast(text, seconds) {
      if (!this._ready || !text) return;
      const d = this.dom;
      d.toastText.textContent = text;
      d.toast.classList.add('is-on');
      clearTimeout(this._toastTimer);
      const ms = (seconds > 0 ? seconds : 2) * 1000;
      this._toastTimer = setTimeout(() => d.toast.classList.remove('is-on'), ms);
    }

    // ------------------------------------------------------------------ touch
    /** Toggles touch presentation (body.touch-mode, hint text, control ordering). */
    setTouchMode(isTouch) {
      const on = !!isTouch;
      const changed = on !== this.touchMode;
      this.touchMode = on;
      if (document.body) document.body.classList.toggle('touch-mode', on);
      if (!this.dom) return;
      if (changed) {
        this._orderControlTabs();
        if (this.current === 'controls') this._selectTab(on ? 'touch' : 'desktop', false);
        this._updateRotateHint();
      }
      // First touch detected mid-run: show the primer at the next pause / menu.
      if (on && this._ready && !this._primerSeen() && this.current === null) this._primerPending = true;
    }

    _primerSeen() {
      return AT.Storage.get(KEY_PRIMER, false) === true;
    }

    _openPrimer(startKey) {
      const d = this.dom;
      if (!d.primer) return;
      this._primerStartKey = startKey || null;
      const s = (this.game && this.game.settings) || AT.SETTINGS_DEFAULTS;
      const fire = d.primerFire;
      fire.textContent = '';
      let lead;
      let rest;
      if (s.touchAimMode === 'stick') {
        lead = 'Right thumb';
        rest = ' — push the aim stick toward an anchor; push it all the way to fire.';
      } else {
        lead = 'Touch an anchor';
        rest = ' — the tether fires at it.';
      }
      rest +=
        s.touchGrappleMode === 'toggle'
          ? ' Tap again to let go.'
          : s.touchAimMode === 'stick'
            ? ' Lift to let go.'
            : ' Keep holding to stay attached; lift to let go.';
      fire.appendChild(make('b', null, lead));
      fire.appendChild(document.createTextNode(rest));
      d.primerOk.querySelector('.btn-label').textContent = startKey ? 'Begin descent' : 'Got it';
      const active = document.activeElement;
      this._primerReturnFocus = active && this.root.contains(active) ? active : null;
      d.primer.hidden = false;
      d.primerOk.focus({ preventScroll: true });
      this._updateRotateHint();
    }

    _closePrimer(confirm) {
      const d = this.dom;
      if (!d.primer || d.primer.hidden) return;
      d.primer.hidden = true;
      AT.Storage.set(KEY_PRIMER, true);
      this._updateRotateHint();
      const key = this._primerStartKey;
      this._primerStartKey = null;
      if (confirm && key) {
        this._startRun(key);
        return;
      }
      const back = this._primerReturnFocus;
      this._primerReturnFocus = null;
      if (back && isVisible(back)) back.focus({ preventScroll: true });
    }

    _updateRotateHint() {
      const el = this.dom && this.dom.rotate;
      if (!el) return;
      const portrait = media('(orientation: portrait)');
      const touchy = this.touchMode || media('(pointer: coarse)');
      const onMenus = this.current !== null && this.current !== 'death' && this.current !== 'victory';
      const primerOpen = !!(this.dom.primer && !this.dom.primer.hidden);
      const show = !this._rotateDismissed && portrait && touchy && onMenus && !primerOpen;
      if (el.hidden === show) el.hidden = !show;
    }

    // ------------------------------------------------------------------ actions
    _onClick(e) {
      const target = e.target;
      const btn = target && target.closest ? target.closest('[data-action]') : null;
      if (!btn || !this.root.contains(btn)) {
        // "Tap anywhere to continue" on the death screen.
        if (this.current === 'death' && target && target.closest && target.closest('#screen-death')) {
          this._continueFromDeath(true);
        }
        return;
      }
      if (btn.disabled) return;
      this._emitClick();
      this._unlockAudio();
      this._action(btn.dataset.action, btn);
    }

    _onPointerDown(e) {
      if (e.pointerType === 'touch' && !this.touchMode) this.setTouchMode(true);
      // The in-game pause button must never turn into a gameplay touch.
      if (e.target && e.target.closest && e.target.closest('#btn-pause')) e.stopPropagation();
    }

    _action(action, btn) {
      const game = this.game || {};
      switch (action) {
        case 'start':
          this._startRun(this._defaultDifficulty());
          break;
        case 'start-diff':
          this._startRun(btn.dataset.diff);
          break;
        case 'sandbox':
          this._startRun('sandbox');
          break;
        case 'difficulty':
        case 'controls':
        case 'settings':
          this._openSub(action);
          break;
        case 'back':
          this._back();
          break;
        case 'pause':
          if (game.state === 'playing') {
            this._call('pause');
            if (game.state === 'paused' && this.current !== 'pause') this.show('pause');
          }
          break;
        case 'resume':
          this._resume();
          break;
        case 'respawn':
          // Game.respawn() works straight from 'paused' (it restores play itself).
          if (game.state === 'paused') {
            this._call('respawn');
            if (this.current !== null && game.state === 'playing') this.show(null);
          }
          break;
        case 'continue':
          this._continueFromDeath(false);
          break;
        case 'restart':
          if (game.state === 'paused' || game.state === 'dead' || game.state === 'victory') {
            this._call('restart');
            if (game.state === 'playing' && this.current !== null) this.show(null);
          }
          break;
        case 'quit':
        case 'menu':
          this._call('quitToMenu');
          if (this.current !== 'menu') this.show('menu');
          break;
        case 'warp': {
          const i = parseInt(btn.dataset.section, 10);
          if (isFinite(i) && game.difficultyKey === 'sandbox') {
            this._call('warpToSection', i);
            if (game.state === 'paused') this._resume();
          }
          break;
        }
        case 'fullscreen':
          this._toggleFullscreen();
          break;
        case 'tab':
          this._selectTab(btn.dataset.tab, false);
          break;
        case 'toggle': {
          const key = btn.dataset.key;
          const cur = key === 'showTimer' ? this._showTimer : !!(game.settings && game.settings[key]);
          this._applySetting(key, !cur);
          break;
        }
        case 'choice':
          this._applySetting(btn.dataset.key, btn.dataset.value);
          break;
        case 'reset-settings':
          this._resetSettings();
          break;
        case 'primer-ok':
          this._closePrimer(true);
          break;
        case 'rotate-dismiss':
          this._rotateDismissed = true;
          AT.Storage.set(KEY_ROTATE, true);
          this._updateRotateHint();
          break;
        default:
          break;
      }
    }

    _startRun(key) {
      const k = AT.DIFFICULTY[key] ? key : 'normal';
      if (this.touchMode && !this._primerSeen()) {
        this._openPrimer(k);
        return;
      }
      this._call('start', k);
      const game = this.game || {};
      if (game.state === 'playing' && this.current !== null) this.show(null);
    }

    _resume() {
      const game = this.game || {};
      if (game.state !== 'paused') return;
      this._call('resume');
      if (game.state === 'playing' && this.current !== null) this.show(null);
    }

    /** Calls a public Game method defensively (a failure must not wedge the UI). */
    _call(method, arg) {
      const game = this.game;
      if (!game || typeof game[method] !== 'function') return undefined;
      try {
        return arguments.length > 1 ? game[method](arg) : game[method]();
      } catch (err) {
        if (typeof console !== 'undefined') console.error(`[AT] game.${method} failed`, err);
        return undefined;
      }
    }

    _emitClick() {
      const bus = this.game && this.game.bus;
      if (bus && typeof bus.emit === 'function') bus.emit('ui:click', {});
    }

    _unlockAudio() {
      const audio = this.game && this.game.audio;
      if (audio && typeof audio.unlock === 'function') {
        try {
          audio.unlock();
        } catch {
          /* audio is optional */
        }
      }
    }

    // ------------------------------------------------------------------ keyboard
    _activeContainer() {
      if (this.dom.primer && !this.dom.primer.hidden) return this.dom.primer;
      return this.current ? this.screens[this.current] : null;
    }

    _onKeyDown(e) {
      if (!this._ready || e.ctrlKey || e.metaKey || e.altKey) return;
      this._modality = 'keyboard';
      const container = this._activeContainer();
      if (!container) return; // gameplay: input.js owns the keyboard
      const key = e.key;
      const primerOpen = container === this.dom.primer;
      const active = document.activeElement;
      const onControl = !!(active && active !== container && container.contains(active) && active.matches(FOCUSABLE));

      if (key === 'Escape' || key === 'Esc') {
        if (primerOpen) {
          e.preventDefault();
          e.stopPropagation();
          this._closePrimer(false);
        } else if (SUB_SCREENS[this.current]) {
          e.preventDefault();
          e.stopPropagation();
          this._emitClick();
          this._back();
        } else if (this.current === 'pause') {
          this._resumeFallback();
        } else if (this.current === 'menu' && !this.dom.rotate.hidden) {
          this._rotateDismissed = true;
          this._updateRotateHint();
        }
        return;
      }
      if (e.code === 'KeyP' && this.current === 'pause' && !primerOpen) {
        this._resumeFallback();
        return;
      }

      if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
        if (!onControl && !primerOpen && this.current === 'menu' && key === 'Enter' && !e.repeat) {
          // Fresh title screen, nothing focused yet: Enter begins the descent.
          e.preventDefault();
          e.stopPropagation();
          this._emitClick();
          this._unlockAudio();
          this._startRun(this._defaultDifficulty());
          return;
        }
        if (onControl) {
          // The focused control owns this key — don't also feed the game a confirm/grapple edge.
          e.stopPropagation();
          if (e.repeat) e.preventDefault();
        }
        return;
      }

      if (key === 'Tab') {
        this._trapTab(e, container);
        return;
      }

      const dir = ARROWS[key];
      if (dir) this._arrowNav(e, container, onControl ? active : null, dir);
    }

    /**
     * Esc / P on the pause screen are routed by input.js → game (pausePressed
     * toggles). If the game didn't resume within two frames, resume here.
     */
    _resumeFallback() {
      const raf = window.requestAnimationFrame || ((fn) => setTimeout(fn, 16));
      raf(() =>
        raf(() => {
          if (this.current === 'pause' && this.game && this.game.state === 'paused') this._resume();
        }),
      );
    }

    _focusables(container) {
      const out = [];
      const nodes = container.querySelectorAll(FOCUSABLE);
      for (const n of nodes) {
        if (n.disabled || n.tabIndex < 0 || n.closest('[hidden]')) continue;
        if (!isVisible(n)) continue;
        out.push(n);
      }
      return out;
    }

    _trapTab(e, container) {
      const list = this._focusables(container);
      if (!list.length) return;
      const i = list.indexOf(document.activeElement);
      let next = null;
      if (e.shiftKey) {
        if (i <= 0) next = list[list.length - 1];
      } else if (i === -1 || i === list.length - 1) {
        next = list[0];
      }
      if (next) {
        e.preventDefault();
        next.focus();
      }
    }

    _arrowNav(e, container, active, dir) {
      // Sliders keep Left/Right for adjusting; Up/Down moves between rows.
      if (active && active.type === 'range' && dir.dx !== 0) return;
      const group = active ? active.closest('[role="radiogroup"], [role="tablist"]') : null;
      if (group && dir.dx !== 0) {
        e.preventDefault();
        this._moveInGroup(group, active, dir.dx);
        return;
      }
      e.preventDefault();
      const list = this._focusables(container);
      if (!list.length) return;
      if (!active || list.indexOf(active) < 0) {
        list[0].focus();
        return;
      }
      const next = this._spatialPick(list, active, dir) || this._linearPick(list, active, dir);
      if (next) {
        next.focus();
        if (typeof next.scrollIntoView === 'function') next.scrollIntoView({ block: 'nearest' });
      }
    }

    _moveInGroup(group, active, delta) {
      const isTabs = group.getAttribute('role') === 'tablist';
      const items = Array.prototype.filter.call(
        group.querySelectorAll(isTabs ? '[role="tab"]' : '[role="radio"]'),
        isVisible,
      );
      if (!items.length) return;
      let i = items.indexOf(active);
      if (i < 0) i = 0;
      const next = items[(i + delta + items.length) % items.length];
      this._emitClick();
      if (isTabs) {
        this._selectTab(next.dataset.tab, true);
      } else {
        this._applySetting(next.dataset.key, next.dataset.value);
        next.focus();
      }
    }

    /** Nearest focusable in the arrow direction (handles grids and 2-column layouts). */
    _spatialPick(list, active, dir) {
      const a = active.getBoundingClientRect();
      const ax = a.left + a.width / 2;
      const ay = a.top + a.height / 2;
      let best = null;
      let bestScore = Infinity;
      for (const el of list) {
        if (el === active) continue;
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const dx = cx - ax;
        const dy = cy - ay;
        const along = dir.dx !== 0 ? dx * dir.dx : dy * dir.dy;
        if (along <= 4) continue; // not in that direction
        // Must overlap the active element's band on the cross axis a little, or be close.
        const across = dir.dx !== 0 ? Math.abs(dy) : Math.abs(dx);
        const score = along + across * 2.2;
        if (score < bestScore) {
          bestScore = score;
          best = el;
        }
      }
      return best;
    }

    _linearPick(list, active, dir) {
      const i = list.indexOf(active);
      const step = dir.dx + dir.dy > 0 ? 1 : -1;
      return list[(i + step + list.length) % list.length];
    }
  }

  AT.UI = UI;
})((window.AT = window.AT || {}));
