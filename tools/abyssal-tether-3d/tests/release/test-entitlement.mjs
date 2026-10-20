// Node tests for platform/entitlement.js (E06): the draft's nine scenarios against a mocked billing service, plus the
// chapter gate, the URL mock switch (dev channel only) and the events.
// Run: node tools/abyssal-tether-3d/tests/release/test-entitlement.mjs [--root DIR]
import { srcUrl } from '../../verify/root.mjs';

const E = await import(srcUrl('platform/entitlement.js'));
const { Entitlement, FULL_GAME_SKU, BILLING_SERVICE, CACHE_KEY, createMockStore, FREE_CHAPTER } = E;

let pass = 0;
let fail = 0;
const ok = (c, m) => {
  if (c) pass++;
  else {
    fail++;
    console.log('FAIL:', m);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k) };
}
function fakeEnv({ purchases = [], listFails = false, serviceFails = false, show = 'ok', hasStore = true } = {}) {
  const env = { Intl, calls: [] };
  if (hasStore) {
    env.getDigitalGoodsService = async (url) => {
      env.calls.push(['service', url]);
      if (serviceFails) throw new Error('provider unavailable');
      return {
        listPurchases: async () => {
          if (listFails) throw new Error('offline');
          return purchases;
        },
        getDetails: async (ids) => ids.map((itemId) => ({ itemId, price: { currency: 'USD', value: '9.99' } })),
      };
    };
    env.PaymentRequest = class {
      constructor(methods) {
        env.calls.push(['payment', methods[0].supportedMethods, methods[0].data]);
      }
      show() {
        if (show === 'cancel') return Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' }));
        if (show === 'error') return Promise.reject(new Error('boom'));
        purchases.push({ itemId: FULL_GAME_SKU });
        return Promise.resolve({ complete: async () => {} });
      }
    };
  }
  return env;
}
const mk = (env, storage = memStorage(), now = () => Date.now()) => new Entitlement({ env, storage, now });

// 1. no store (browser tab / desktop): demo, and a cached "owned" flag is IGNORED (editing localStorage unlocks nothing)
{
  const cached = memStorage({ [CACHE_KEY]: JSON.stringify({ owned: true, grantedAt: 1 }) });
  const e = mk(fakeEnv({ hasStore: false }), cached);
  await e.init();
  ok(e.state === 'demo' && e.source === 'none', 'no store: demo');
  ok(!e.isChapterPlayable(2) && e.isChapterPlayable(1), 'no store: chapter 2 locked, chapter 1 open');
}
// 2. owned
{
  const env = fakeEnv({ purchases: [{ itemId: FULL_GAME_SKU }] });
  const e = mk(env);
  await e.init();
  ok(e.state === 'full' && e.source === 'store', 'owned: full');
  ok(env.calls.some((c) => c[0] === 'service' && c[1] === BILLING_SERVICE), 'billing service URL');
  ok(e.isChapterPlayable(2) && e.isChapterPlayable(5), 'owned: later chapters playable');
  await sleep(10);
  ok(e.price === '$9.99', `price label from getDetails (${e.price})`);
}
// 3. not owned
{
  const e = mk(fakeEnv());
  await e.init();
  ok(e.state === 'demo' && e.source === 'store' && !e.isChapterPlayable(2), 'not owned: demo');
}
// 4. offline grace: provider down, previously verified owner keeps the unlock; a stranger stays in the demo
{
  const owner = memStorage({ [CACHE_KEY]: JSON.stringify({ owned: true, verifiedAt: 1, grantedAt: 1 }) });
  const e = mk(fakeEnv({ serviceFails: true }), owner);
  await e.init();
  ok(e.state === 'full' && e.source === 'cache', 'offline grace honoured');
  const e2 = mk(fakeEnv({ serviceFails: true }));
  await e2.init();
  ok(e2.state === 'demo', 'offline, never verified: demo');
  const e3 = mk(fakeEnv({ listFails: true }), memStorage({ [CACHE_KEY]: JSON.stringify({ owned: true, grantedAt: 1 }) }));
  await e3.init();
  ok(e3.state === 'full' && e3.source === 'cache', 'listPurchases failing keeps the cached unlock');
}
// 5. refund: authoritative "not owned" more than 24 h after the grant revokes; within 24 h it is kept (propagation)
{
  let t = 1_000_000;
  const cached = memStorage({ [CACHE_KEY]: JSON.stringify({ owned: true, verifiedAt: t, grantedAt: t }) });
  const young = mk(fakeEnv(), cached, () => t + 3600 * 1000);
  await young.init();
  ok(young.state === 'full' && young.source === 'purchase', 'a grant under 24 h old survives a negative answer');
  const old = mk(fakeEnv(), cached, () => t + 25 * 3600 * 1000);
  await old.init();
  ok(old.state === 'demo' && old.source === 'store', 'refund after 24 h: demo');
}
// 6. purchase
{
  const env = fakeEnv();
  const events = [];
  const e = new Entitlement({ env, storage: memStorage(), bus: { emit: (t, p) => events.push([t, p]) } });
  await e.init();
  const r = await e.purchase();
  ok(r === 'purchased' && e.state === 'full' && e.source === 'purchase', 'purchase unlocks at once');
  const pay = env.calls.find((c) => c[0] === 'payment');
  ok(pay && pay[1] === BILLING_SERVICE && pay[2].sku === FULL_GAME_SKU, 'payment request carries the billing method and { sku }');
  ok(events.some((x) => x[0] === 'purchase:start') && events.some((x) => x[0] === 'purchase:result' && x[1].result === 'purchased') && events.some((x) => x[0] === 'entitlement:change' && x[1].state === 'full'), 'purchase events');
  ok((await e.purchase()) === 'owned', 'buying again reports owned');
}
// 7. cancel / error / outside the store
{
  const c = mk(fakeEnv({ show: 'cancel' }));
  await c.init();
  ok((await c.purchase()) === 'cancelled' && c.state === 'demo', 'cancelled dialog stays in the demo');
  const x = mk(fakeEnv({ show: 'error' }));
  await x.init();
  ok((await x.purchase()) === 'error', 'dialog error');
  const n = mk(fakeEnv({ hasStore: false }));
  await n.init();
  ok((await n.purchase()) === 'unavailable' && n.state === 'demo', 'purchase outside the store is unavailable');
}
// 8. the gate: Chapter I is ALWAYS playable, whatever the state
{
  const g = mk(fakeEnv({ serviceFails: true }));
  ok(g.state === 'unknown' && g.isChapterPlayable(1) === true, 'before init: chapter 1 playable');
  ok(!g.isChapterPlayable(0) && !g.isChapterPlayable(NaN) && !g.isChapterPlayable(2), 'invalid / locked chapters');
  ok(FREE_CHAPTER === 1 && g.canPlayChapter(1), 'draft alias canPlayChapter');
}
// 9. URL mock: dev channel only
{
  const win = (search) => ({ location: { search }, localStorage: memStorage() });
  const dev = Entitlement.fromUrl({ win: win('?entitlement=owned'), build: { channel: 'dev' } });
  await dev.init();
  ok(dev.state === 'full' && dev.mock === 'owned' && dev.isChapterPlayable(2), 'dev channel: ?entitlement=owned');
  const buy = Entitlement.fromUrl({ win: win('?entitlement=buy'), build: { channel: 'dev' } });
  await buy.init();
  ok(buy.state === 'demo' && (await buy.purchase()) === 'purchased' && buy.state === 'full', 'dev mock buy flow');
  const off = Entitlement.fromUrl({ win: win('?entitlement=offline'), build: { channel: 'dev' } });
  await off.init();
  ok(off.state === 'full' && off.source === 'cache', 'dev mock offline honours the cached unlock');
  const err = Entitlement.fromUrl({ win: win('?entitlement=error'), build: { channel: 'dev' } });
  await err.init();
  ok(err.state === 'demo', 'dev mock error: demo');
  const rel = Entitlement.fromUrl({ win: win('?entitlement=owned'), build: { channel: 'release' } });
  await rel.init();
  ok(rel.state === 'demo' && rel.mock === null && !rel.isChapterPlayable(2), 'RELEASE channel ignores the mock switch');
  const junk = Entitlement.fromUrl({ win: win('?entitlement=hack'), build: { channel: 'dev' } });
  await junk.init();
  ok(junk.state === 'demo', 'unknown mock names are ignored');
  const m = createMockStore('owned');
  ok((await m.service.listPurchases()).length === 1, 'mock store owns the SKU in owned mode');
}

console.log(`${fail ? 'FAILED' : 'ok'}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
