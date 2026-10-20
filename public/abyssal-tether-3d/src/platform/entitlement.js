/* ABYSSAL TETHER 3D — entitlement.js (E06, DORMANT in the free Chapter I release)
 *
 * Full-game unlock through the Digital Goods API + Payment Request, as designed in RELEASE.md §10 (adopted from
 * docs/abyssal-tether-3d/pwa/entitlement.draft.js, behaviour unchanged). Chapter I is always playable; the gate
 * `isChapterPlayable(n)` returns true for n <= 1 and, for later chapters, only while the unlock is owned. The
 * free release ships NO purchase UI and no content behind the gate: the module only (a) reports the state and
 * (b) answers the gate, so Chapters II-V can be wired without touching this file.
 *
 * Facts this relies on (Meta, "In-app purchases in WebXR PWAs", retrieved 2026-10-19):
 *   - IAP in Horizon OS PWAs works only through the Digital Goods API, only in WebXR PWAs installed from the
 *     Meta Horizon Store (ALPHA/BETA channels included).
 *   - Service URL passed to window.getDigitalGoodsService(): 'https://quest.meta.com/billing'.
 *   - Item ids are the add-on SKUs from the Developer Dashboard; there is no call that lists them.
 *   - listPurchases() returns all DURABLE purchases; "Restore purchases" == listPurchases().
 * Not documented (verify on device, RELEASE.md §19): the exact shape Meta expects in PaymentRequest `data`
 * (we send { sku }), whether listPurchases() works offline, whether a WebXR `select` counts as user activation.
 *
 * Testing without a store (dev channel only; the release build ignores the switch, RELEASE.md §10.7):
 *   ?entitlement=owned | demo | buy | cancel | offline | error
 *     owned    store install that owns the unlock           demo    store install that does not
 *     buy      like demo, purchase() succeeds               cancel  like demo, the dialog is cancelled
 *     offline  provider unreachable, a cached "owned" answer is honoured   error  provider unreachable, no cache
 *
 * Events (through options.bus.emit, wired by Game3D): 'entitlement:change' { state, source },
 * 'purchase:start' {}, 'purchase:result' { result }.
 */
import { BUILD } from './buildInfo.js';

export const FULL_GAME_SKU = 'abyssal_tether_full_game'; // must match the Dashboard SKU exactly (case-sensitive)
export const BILLING_SERVICE = 'https://quest.meta.com/billing';
export const CACHE_KEY = 'abyssalTether3d.v1.entitlement'; // same prefix family as Storage in config3d.js
/** Highest chapter that exists in this build. Later chapters are gated even for an owner (nothing to play yet). */
export const FREE_CHAPTER = 1;

const CALL_TIMEOUT_MS = 6000;
const REVOKE_AFTER_MS = 24 * 3600 * 1000; // do not trust a negative answer within 24 h of a grant
const CONFIRM_RETRIES = 5;

function safeStorage(win) {
  try {
    const s = win && win.localStorage;
    if (!s) return null;
    const probe = '__at3d_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

function withTimeout(promise, ms, label) {
  let timer = 0;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * state:  'unknown' (not checked yet) | 'demo' (Chapter I only) | 'full' (all chapters)
 * source: why we are in that state: 'store' (fresh listPurchases), 'cache' (offline grace),
 *         'purchase' (just bought, confirmation pending), 'none' (no store: browser tab, desktop)
 */
export class Entitlement {
  /**
   * @param {object} [o]
   * @param {object} [o.env]      { getDigitalGoodsService, PaymentRequest, Intl } (default: window)
   * @param {object} [o.storage]  localStorage-like (default: window.localStorage when usable)
   * @param {Function} [o.now]
   * @param {Function} [o.onChange]
   * @param {{emit:Function}} [o.bus]
   */
  constructor({ env = typeof window !== 'undefined' ? window : {}, storage, now = () => Date.now(), onChange = null, bus = null, mock = null } = {}) {
    this.env = env;
    this.storage = storage === undefined ? safeStorage(typeof window !== 'undefined' ? window : null) : storage;
    this.now = now;
    this.onChange = onChange;
    this.bus = bus;
    this.mock = mock; // mock mode name when created by fromUrl (info only)
    this.state = 'unknown';
    this.source = 'none';
    this.service = null;
    this.storeAvailable = false;
    this.price = null; // localized display string from getDetails(), e.g. "$9.99"
    this.lastError = null;
    this._lastKey = '';
  }

  /**
   * Builds the instance for this page. In a dev-channel build a ?entitlement= switch installs a mock store;
   * the release build never honours it.
   */
  static fromUrl({ win = typeof window !== 'undefined' ? window : null, build = BUILD, bus = null, onChange = null } = {}) {
    let mode = null;
    if (build && build.channel !== 'release' && win && win.location) {
      try {
        mode = new URLSearchParams(win.location.search).get('entitlement');
      } catch {
        /* ignore */
      }
    }
    if (mode && MOCK_MODES.includes(mode)) {
      const m = createMockStore(mode);
      return new Entitlement({ env: m.env, storage: m.storage, bus, onChange, mock: mode });
    }
    return new Entitlement({ env: win || {}, bus, onChange });
  }

  /** True only inside the store-installed PWA (the API is absent in tabs and on desktop). */
  hasDigitalGoods() {
    return !!this.env && typeof this.env.getDigitalGoodsService === 'function';
  }

  static hasDigitalGoods(env = typeof window !== 'undefined' ? window : null) {
    return !!env && typeof env.getDigitalGoodsService === 'function';
  }

  /** Call once at boot, without awaiting it before the XR session starts (startup VRC). */
  async init() {
    if (!this.hasDigitalGoods()) {
      // Browser tab, desktop, sideloaded debug build: demo only. The cached flag is ignored here on purpose,
      // so editing localStorage in a tab does not unlock anything.
      this._set('demo', 'none');
      return this.state;
    }
    const cached = this._readCache();
    if (cached && cached.owned) this._set('full', 'cache'); // optimistic: never flash "demo" at a buyer
    await this._connect();
    await this.refresh();
    this.loadPrice(); // fire and forget: only used for the label on the unlock button
    return this.state;
  }

  async _connect() {
    try {
      this.service = await withTimeout(this.env.getDigitalGoodsService(BILLING_SERVICE), CALL_TIMEOUT_MS, 'getDigitalGoodsService');
      this.storeAvailable = !!this.service;
    } catch (err) {
      // Rejects when the provider is unavailable (e.g. a build not installed from the Store).
      this.lastError = err;
      this.storeAvailable = false;
      this.service = null;
    }
    return this.service;
  }

  /** Re-reads ownership from the store. Also the "Restore purchases" action. */
  async refresh() {
    if (!this.service) {
      if (!this.hasDigitalGoods()) {
        this._set('demo', 'none');
        return this.state;
      }
      // Store install whose billing service did not answer (possibly offline): offline grace.
      await this._connect();
      if (!this.service) {
        const cached = this._readCache();
        this._set(cached && cached.owned ? 'full' : 'demo', 'cache');
        return this.state;
      }
    }
    let purchases;
    try {
      purchases = await withTimeout(this.service.listPurchases(), CALL_TIMEOUT_MS, 'listPurchases');
    } catch (err) {
      // Offline or store hiccup: offline grace from the last verified answer, no expiry for a durable item.
      // Never lock a buyer out because the headset is offline.
      this.lastError = err;
      const cached = this._readCache();
      this._set(cached && cached.owned ? 'full' : 'demo', 'cache');
      return this.state;
    }
    const owned = Array.isArray(purchases) && purchases.some((p) => p && p.itemId === FULL_GAME_SKU);
    const cached = this._readCache();
    if (owned) {
      this._writeCache({ owned: true, verifiedAt: this.now(), grantedAt: (cached && cached.grantedAt) || this.now() });
      this._set('full', 'store');
    } else if (cached && cached.owned && this.now() - (cached.grantedAt || 0) < REVOKE_AFTER_MS) {
      // A purchase made in the last 24 h that the list does not show yet: keep it (propagation).
      this._set('full', 'purchase');
    } else {
      // Authoritative "not owned" (never bought, or refunded): demo.
      this._writeCache({ owned: false, verifiedAt: this.now(), grantedAt: 0 });
      this._set('demo', 'store');
    }
    return this.state;
  }

  async loadPrice() {
    if (!this.service) return null;
    try {
      const items = await withTimeout(this.service.getDetails([FULL_GAME_SKU]), CALL_TIMEOUT_MS, 'getDetails');
      const item = Array.isArray(items) ? items.find((i) => i && i.itemId === FULL_GAME_SKU) : null;
      if (item && item.price && item.price.currency) {
        const value = Number(item.price.value);
        const Fmt = (this.env && this.env.Intl) || Intl;
        this.price = new Fmt.NumberFormat(undefined, { style: 'currency', currency: item.price.currency }).format(value);
        this._emit();
      }
    } catch (err) {
      this.lastError = err;
    }
    return this.price;
  }

  /**
   * Starts the store purchase dialog. MUST be called synchronously from a user-activation handler (a DOM click,
   * or the WebXR controller 'select' event of the hand that pressed "Unlock"), with no await before request.show().
   * Returns 'purchased' | 'owned' | 'cancelled' | 'unavailable' | 'error'.
   */
  purchase() {
    this._busEmit('purchase:start', {});
    const done = (result) => {
      this._busEmit('purchase:result', { result });
      return result;
    };
    if (this.state === 'full') return Promise.resolve(done('owned'));
    const PR = this.env && this.env.PaymentRequest;
    if (!this.service || typeof PR !== 'function') return Promise.resolve(done('unavailable'));
    let request;
    try {
      request = new PR(
        [{ supportedMethods: BILLING_SERVICE, data: { sku: FULL_GAME_SKU } }],
        // The store dialog shows the real price; the total is a placeholder some engines require.
        { total: { label: 'Total', amount: { currency: 'USD', value: '0' } } },
      );
    } catch (err) {
      this.lastError = err;
      return Promise.resolve(done('error'));
    }
    const shown = request.show(); // synchronous call inside the activation window
    return shown.then(
      async (response) => {
        try {
          await response.complete('success');
        } catch {
          /* the dialog is already gone: harmless */
        }
        // The store dialog confirmed the payment: unlock now, then confirm from listPurchases.
        this._writeCache({ owned: true, verifiedAt: 0, grantedAt: this.now() });
        this._set('full', 'purchase');
        this._confirmPurchase();
        return done('purchased');
      },
      (err) => {
        this.lastError = err;
        // AbortError = the player closed the dialog. Anything else: show a retry message.
        return done(err && err.name === 'AbortError' ? 'cancelled' : 'error');
      },
    );
  }

  async _confirmPurchase() {
    for (let i = 0; i < CONFIRM_RETRIES; i++) {
      await wait(1500 * (i + 1));
      await this.refresh();
      if (this.source === 'store' && this.state === 'full') return;
    }
  }

  /**
   * The chapter gate. Chapter I is always playable, with or without a store, online or offline.
   * @param {number} n chapter number (1..5)
   */
  isChapterPlayable(n) {
    n = Number(n);
    if (!(n >= 1)) return false;
    return n <= FREE_CHAPTER || this.state === 'full';
  }

  /** Same gate under the draft's name. */
  canPlayChapter(n) {
    return this.isChapterPlayable(n);
  }

  /** Snapshot for the UI and the debug API. */
  info() {
    return { state: this.state, source: this.source, price: this.price, store: this.hasDigitalGoods(), storeAvailable: this.storeAvailable, mock: this.mock };
  }

  _set(state, source) {
    this.state = state;
    this.source = source;
    this._emit();
  }

  _emit() {
    const key = `${this.state}|${this.source}|${this.price}`;
    if (key === this._lastKey) return;
    this._lastKey = key;
    this._busEmit('entitlement:change', { state: this.state, source: this.source, price: this.price });
    if (typeof this.onChange === 'function') {
      try {
        this.onChange(this);
      } catch {
        /* UI errors must not break the entitlement flow */
      }
    }
  }

  _busEmit(type, payload) {
    if (!this.bus || typeof this.bus.emit !== 'function') return;
    try {
      this.bus.emit(type, payload);
    } catch {
      /* listeners must not break the flow */
    }
  }

  _readCache() {
    if (!this.storage) return null;
    try {
      const raw = this.storage.getItem(CACHE_KEY);
      const v = raw ? JSON.parse(raw) : null;
      return v && typeof v === 'object' ? v : null;
    } catch {
      return null;
    }
  }

  _writeCache(v) {
    if (!this.storage) return;
    try {
      this.storage.setItem(CACHE_KEY, JSON.stringify(v));
    } catch {
      /* storage full or blocked: the store remains the source of truth */
    }
  }
}

// -----------------------------------------------------------------------------
// Mock store (dev channel, ?entitlement=...; also used by the Node tests)
// -----------------------------------------------------------------------------
export const MOCK_MODES = ['owned', 'demo', 'buy', 'cancel', 'offline', 'error'];

function memoryStorage(seed) {
  const m = new Map(Object.entries(seed || {}));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
  };
}

/** A fake window-like environment implementing just the Digital Goods + Payment Request surface used above. */
export function createMockStore(mode, { latency = 20 } = {}) {
  const purchases = [];
  if (mode === 'owned') purchases.push({ itemId: FULL_GAME_SKU });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const service = {
    async listPurchases() {
      await sleep(latency);
      if (mode === 'offline') throw new Error('offline');
      return purchases.slice();
    },
    async getDetails(ids) {
      await sleep(latency);
      return ids.map((itemId) => ({ itemId, title: 'Abyssal Tether: The Full Descent', price: { currency: 'USD', value: '9.99' } }));
    },
  };
  class PaymentRequest {
    constructor(methods) {
      this.methods = methods;
    }
    async show() {
      await sleep(latency);
      if (mode === 'cancel') {
        const e = new Error('cancelled');
        e.name = 'AbortError';
        throw e;
      }
      if (mode !== 'buy') throw new Error('mock store: purchases are not available in mode ' + mode);
      purchases.push({ itemId: FULL_GAME_SKU });
      return { complete: async () => {} };
    }
  }
  const env = {
    getDigitalGoodsService: async (url) => {
      await sleep(latency);
      if (mode === 'error' || url !== BILLING_SERVICE) throw new Error('provider unavailable');
      if (mode === 'offline') throw new Error('offline');
      return service;
    },
    PaymentRequest,
    Intl,
  };
  // 'offline' honours a cached "owned" answer, as a returning buyer would have.
  const storage = memoryStorage(mode === 'offline' ? { [CACHE_KEY]: JSON.stringify({ owned: true, verifiedAt: 1, grantedAt: 1 }) } : {});
  return { env, storage, service, purchases };
}
