/* SUPERSEDED (2026-10-20, WP-RELEASE): adopted as src/platform/entitlement.js (same behaviour, injectable env, mock, chapter gate). Kept as design notes. */
/* ABYSSAL TETHER 3D: full-game entitlement DRAFT (Digital Goods API + Payment Request).
 *
 * Status: proposal, not wired into the game. Design and rationale: ../RELEASE.md, "In-app
 * purchase: free demo + $9.99 full-game unlock". Intended home once adopted:
 * src/platform/entitlement.js (owned by the game agent), consumed by Game3D + UI3D.
 *
 * Facts this relies on (Meta, "In-app purchases in WebXR PWAs", retrieved 2026-10-19):
 *   - IAP in Horizon OS PWAs works only through the Digital Goods API, only in WebXR PWAs
 *     installed from the Meta Horizon Store (ALPHA/BETA channels included).
 *   - Service URL passed to window.getDigitalGoodsService(): 'https://quest.meta.com/billing'
 *     (also the payment method name Meta's Bubblewrap fork registers in the APK).
 *   - Item ids are the add-on SKUs from the Developer Dashboard; there is no call that lists
 *     them, so the SKU is hard-coded here.
 *   - listPurchases() returns all DURABLE purchases (and unconsumed consumables); the store has
 *     no separate purchase history, so "Restore purchases" == listPurchases().
 * Not documented (verify on device, see RELEASE.md "Open questions"): the exact shape Meta
 * expects in PaymentRequest `data` (we send { sku }), whether listPurchases() works offline,
 * and whether show() accepts a WebXR controller 'select' event as user activation.
 */

export const FULL_GAME_SKU = 'abyssal_tether_full_game'; // must match the Dashboard SKU exactly (case-sensitive)
export const BILLING_SERVICE = 'https://quest.meta.com/billing';

const CACHE_KEY = 'abyssalTether3d.v1.entitlement'; // same prefix family as Storage in config3d.js
const CALL_TIMEOUT_MS = 6000;
const REVOKE_AFTER_MS = 24 * 3600 * 1000; // do not trust a negative answer within 24 h of a grant
const CONFIRM_RETRIES = 5;

function safeStorage() {
  try {
    const s = window.localStorage;
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
 * state: 'unknown' (not checked yet) | 'demo' (Chapter 1 only) | 'full' (all chapters)
 * source: why we are in that state: 'store' (fresh listPurchases), 'cache' (offline grace),
 *         'purchase' (just bought, confirmation pending), 'none' (no store: browser tab, desktop)
 */
export class Entitlement {
  constructor({ storage = safeStorage(), now = () => Date.now(), onChange = null } = {}) {
    this.storage = storage;
    this.now = now;
    this.onChange = onChange;
    this.state = 'unknown';
    this.source = 'none';
    this.service = null;
    this.storeAvailable = false;
    this.price = null; // localized display string from getDetails(), e.g. "$9.99"
    this.lastError = null;
  }

  /** True only inside the store-installed PWA (the API is absent in tabs and on desktop). */
  static hasDigitalGoods() {
    return typeof window !== 'undefined' && typeof window.getDigitalGoodsService === 'function';
  }

  /** Call once at boot, without awaiting it before the XR session starts (startup VRC). */
  async init() {
    if (!Entitlement.hasDigitalGoods()) {
      // Browser tab, desktop, sideloaded debug build: demo only. The cached flag is ignored
      // here on purpose, so editing localStorage in a tab does not unlock anything.
      this._set('demo', 'none');
      return this.state;
    }
    const cached = this._readCache();
    if (cached && cached.owned) this._set('full', 'cache'); // optimistic: never flash "demo" at a buyer
    try {
      this.service = await withTimeout(window.getDigitalGoodsService(BILLING_SERVICE), CALL_TIMEOUT_MS, 'getDigitalGoodsService');
      this.storeAvailable = !!this.service;
    } catch (err) {
      // Rejects when the provider is unavailable (e.g. a build not installed from the Store).
      this.lastError = err;
      this.storeAvailable = false;
    }
    await this.refresh();
    this.loadPrice(); // fire and forget: only used for the label on the unlock button
    return this.state;
  }

  /** Re-reads ownership from the store. Also the "Restore purchases" action. */
  async refresh() {
    if (!this.service) {
      if (!Entitlement.hasDigitalGoods()) {
        this._set('demo', 'none');
        return this.state;
      }
      // Store install whose billing service did not answer (possibly offline): offline grace.
      try {
        this.service = await withTimeout(window.getDigitalGoodsService(BILLING_SERVICE), CALL_TIMEOUT_MS, 'getDigitalGoodsService');
        this.storeAvailable = !!this.service;
      } catch (err) {
        this.lastError = err;
      }
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
      // Offline or store hiccup: offline grace from the last verified answer, no expiry for a
      // durable item. Never lock a buyer out because the headset is offline.
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
        this.price = new Intl.NumberFormat(undefined, { style: 'currency', currency: item.price.currency }).format(value);
        this._emit();
      }
    } catch (err) {
      this.lastError = err;
    }
    return this.price;
  }

  /**
   * Starts the store purchase dialog. MUST be called synchronously from a user-activation
   * handler (a DOM click, or the WebXR controller 'select' event of the hand that pressed
   * "Unlock"), with no await before request.show(). Returns 'purchased' | 'owned' |
   * 'cancelled' | 'unavailable' | 'error'.
   */
  purchase() {
    if (this.state === 'full') return Promise.resolve('owned');
    if (!this.service || typeof window.PaymentRequest !== 'function') return Promise.resolve('unavailable');
    let request;
    try {
      request = new window.PaymentRequest(
        [{ supportedMethods: BILLING_SERVICE, data: { sku: FULL_GAME_SKU } }],
        // The store dialog shows the real price; the total is a placeholder some engines require.
        { total: { label: 'Total', amount: { currency: 'USD', value: '0' } } },
      );
    } catch (err) {
      this.lastError = err;
      return Promise.resolve('error');
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
        return 'purchased';
      },
      (err) => {
        this.lastError = err;
        // AbortError = the player closed the dialog. Anything else: show a retry message.
        return err && err.name === 'AbortError' ? 'cancelled' : 'error';
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

  /** Chapter gate. Chapter 1 is always free. */
  canPlayChapter(n) {
    return n <= 1 || this.state === 'full';
  }

  _set(state, source) {
    const changed = state !== this.state || source !== this.source;
    this.state = state;
    this.source = source;
    if (changed) this._emit();
  }

  _emit() {
    if (typeof this.onChange === 'function') {
      try {
        this.onChange(this);
      } catch {
        /* UI errors must not break the entitlement flow */
      }
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
