// THE SOLDIERS' WEAPONS: where they lie, the bag, the save, the sounds, the wiring (Node, plans/SOLDIER_WEAPONS.md).
//   placement on the REAL level: seeded and deterministic, the counts per difficulty (Normal = Sandbox 4 grenades + 1 revolver, Nightmare
//   3 + 1, Abyss 2 + 1 with 4 rounds), the fairness invariants (never slow / taken / quiet / a rest / a hazard / stacked), by the fallen
//   bodies, the supplies and knockers untouched; the pickup (a revolver = its rounds, caps), a respawn keeps them taken; the bag kinds 5 / 6
//   (BAG_KINDS 7, names, caps, refusals), old 5-kind arrays migrate, the save round trip; the setting + ?weapons=off; the recipes valid
//   and routed; the captions; the tutorial step; the glue's hot paths allocate nothing; the wiring (game.js, input, touch, the view).
//   node test-weapon-pickups.mjs [--root DIR]
import fs from 'node:fs';
import { srcUrl, SRC_DIR, TOOLS_DIR } from '../../verify/root.mjs';
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { LEVEL_DATA_3D } = await import(srcUrl('data/level-data-3d.js'));
const { DIFFICULTY, EventBus, CONFIG, SETTINGS_DEFAULTS, sanitizeUxSettings } = await import(srcUrl('sim/config3d.js'));
const { Pickups3D, pickWeapons, checkWeaponFairness, checkFairness, pickSupplies, WEAPON_SPAWN } = await import(srcUrl('sim/pickups3d.js'));
const { Inventory3D, ITEM, ITEM_COUNT, BAG_KINDS, ITEM_KEYS, ITEM_NAMES, ITEM_SHORT, migrateCounts } = await import(srcUrl('sim/inventory3d.js'));
const { WEAPON_RECIPES, WEAPON_ROUTES, registerWeaponSfx } = await import(srcUrl('audio/weaponSfx.js'));
const { compileRecipe, validateRecipe } = await import(srcUrl('audio/sfxDesign.js'));
const { captionForEvent, WEAPON_RULES, CAPTION_EVENTS } = await import(srcUrl('ui/captions.js'));
const { STEPS } = await import(srcUrl('ui/tutorial.js'));
const { WeaponGlue, GADGETS, WEAPON_LORE } = await import(srcUrl('weaponGlue.js'));

let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const read = (p) => fs.readFileSync(SRC_DIR + '/' + p, 'utf8');

const levels = {};
const levelOf = (key) => levels[key] || (levels[key] = new Level3D(LEVEL_DATA_3D, DIFFICULTY[key].levelVariant));
const pickupsOf = (key, seed, weapons = true) => {
  const pk = new Pickups3D(levelOf(key), null);
  pk.weaponDiff = weapons ? key : '';
  pk.reset(seed);
  return pk;
};
const count = (pk, kind) => pk.items.filter((i) => i.kind === kind).length;

// ---- 1. the counts per difficulty ---------------------------------------------------------------------------------------------------
{
  const want = { normal: [4, 1, 6], sandbox: [4, 1, 6], nightmare: [3, 1, 6], abyss: [2, 1, 4] };
  for (const key of ['normal', 'sandbox', 'nightmare', 'abyss']) {
    let good = true;
    let ex = '';
    for (let s = 1; s <= 12; s++) {
      const pk = pickupsOf(key, s * 7919);
      const g = count(pk, ITEM.GRENADE);
      const r = pk.items.filter((i) => i.kind === ITEM.SIDEARM);
      if (g !== want[key][0] || r.length !== want[key][1] || r[0].amount !== want[key][2]) {
        good = false;
        ex = `seed ${s}: ${g} grenades, ${r.length} revolvers`;
      }
    }
    ok(good, `${key}: ${want[key][0]} grenades + ${want[key][1]} revolver (${want[key][2]} rounds) every run${ex ? ' — ' + ex : ''}`);
  }
  ok(WEAPON_SPAWN.sandbox.every === WEAPON_SPAWN.normal.every && WEAPON_SPAWN.nightmare.every > WEAPON_SPAWN.normal.every && WEAPON_SPAWN.abyss.every > WEAPON_SPAWN.nightmare.every, 'fewer on Nightmare, fewest on Abyss, Sandbox as Normal');
  const pk = pickupsOf('normal', 99);
  const secs = pk.items.filter((i) => i.kind === ITEM.GRENADE).map((i) => i.section).sort((a, b) => a - b);
  ok(secs.join() === '1,3,5,7', `Normal: a grenade in every second section (S2 S4 S6 S8: ${secs.map((s) => 'S' + (s + 1)).join(' ')})`);
  const rs = pk.items.find((i) => i.kind === ITEM.SIDEARM).section;
  ok(rs >= 2 && rs <= 5, `the revolver lies in a middle section (S${rs + 1})`);
  ok(pickupsOf('normal', 99, false).items.every((i) => i.kind < ITEM.GRENADE), 'weaponDiff empty (the default, ?weapons=off, the route bots): none at all');
  ok(new Pickups3D(levelOf('normal'), null).weaponDiff === '', 'Pickups3D lays none unless the game asks (the bots and tools are untouched)');
}

// ---- 2. determinism and variety -----------------------------------------------------------------------------------------------------
{
  const sig = (pk) => pk.items.filter((i) => i.kind >= ITEM.GRENADE).map((i) => `${i.kind}@${i.id}`).join(',');
  ok(sig(pickupsOf('normal', 1234)) === sig(pickupsOf('normal', 1234)), 'deterministic per seed');
  const set = new Set();
  for (let s = 1; s <= 10; s++) set.add(sig(pickupsOf('normal', s * 101)));
  ok(set.size >= 4, `random across runs (${set.size} layouts in 10 seeds)`);
  const src = read('sim/pickups3d.js') + read('sim/weapons3d.js') + read('weaponGlue.js') + read('audio/weaponSfx.js') + read('render/weaponView.js');
  ok(!/Math\.random\(/.test(src), 'no Math.random anywhere in the weapons');
}

// ---- 3. fairness ---------------------------------------------------------------------------------------------------------------------
{
  let bad = [];
  let near = 0;
  let tot = 0;
  let suppliesSame = true;
  let fair = true;
  for (const key of ['normal', 'nightmare', 'abyss']) {
    for (let s = 1; s <= 10; s++) {
      const seed = s * 7717;
      const pk = pickupsOf(key, seed);
      const plain = pickupsOf(key, seed, false);
      const other = pk.items.filter((i) => i.kind < ITEM.GRENADE);
      if (other.map((i) => i.id + i.kind).join() !== plain.items.map((i) => i.id + i.kind).join()) suppliesSame = false;
      const weaponPicks = pk.items.filter((i) => i.kind >= ITEM.GRENADE).map((i) => ({ spot: i.spot, kind: i.kind }));
      const taken = new Uint8Array(pk.spots.length);
      for (const i of other) taken[i.spot] = 1;
      const z = pk.zones();
      const probs = checkWeaponFairness(pk.spots, weaponPicks, { quiet: z.quiet, rests: z.rests, hazards: z.hazards, taken, others: other.map((i) => pk.spots[i.spot]) });
      if (probs.length) bad = bad.concat(probs.map((p) => `${key}/${s}: ${p}`));
      const sup = other.filter((i) => i.kind !== ITEM.KNOCKER).map((i) => ({ spot: i.spot, kind: i.kind }));
      if (checkFairness(pk.spots, sup, levelOf(key).sections.length).length) fair = false;
      const bodies = pk.bodies();
      for (const w of weaponPicks) {
        tot++;
        const sp = pk.spots[w.spot];
        if (bodies.some((b) => Math.hypot(b.x - sp.x, b.y - sp.y, b.z - sp.z) < 6)) near++;
      }
    }
  }
  ok(bad.length === 0, `never slow / taken / quiet / in a rest / by a hazard / stacked (30 runs)${bad.length ? ' — ' + bad.slice(0, 3).join('; ') : ''}`);
  ok(suppliesSame, 'the supplies and the knockers are exactly the same with and without the weapons (they only add)');
  ok(fair, 'the supplies still pass checkFairness');
  ok(tot > 0 && near / tot > 0.45, `found with the fallen: ${near} of ${tot} weapons lie within 6 m of a body`);
  // a direct unit check of the exclusions
  const spots = [
    { id: 'q', x: 0, y: 0, z: 0, section: 1, tier: 'ledge' },
    { id: 'slow', x: 20, y: 0, z: 0, section: 1, tier: 'slow' },
    { id: 'haz', x: 40, y: 0, z: 0, section: 1, tier: 'risk' },
    { id: 'ok', x: 60, y: 0, z: 0, section: 1, tier: 'risk' },
  ];
  const r = pickWeapons(spots, 5, { sections: 2, diff: 'normal', quiet: [{ x: 0, y: 0, z: 1 }], hazards: [{ minX: 39, maxX: 41, minY: -1, maxY: 1, minZ: -1, maxZ: 1 }] });
  ok(r.length >= 1 && r.every((p) => spots[p.spot].id === 'ok'), `the exclusions hold (only 'ok' can take one: ${r.map((p) => spots[p.spot].id).join()})`);
}

// ---- 4. the pickup and the respawn ---------------------------------------------------------------------------------------------------
{
  const bus = new EventBus();
  const ev = [];
  bus.on('pickup:collect', (e) => ev.push(e));
  const pk = new Pickups3D(levelOf('normal'), bus);
  pk.weaponDiff = 'normal';
  pk.reset(42);
  const inv = new Inventory3D(null);
  pk.snapshot();
  inv.snapshot();
  const rev = pk.items.find((i) => i.kind === ITEM.SIDEARM);
  const gr = pk.items.find((i) => i.kind === ITEM.GRENADE);
  pk.update(1 / 60, { x: rev.x, y: rev.y, z: rev.z }, inv);
  ok(inv.counts[ITEM.SIDEARM] === 6 && ev.length === 1 && ev[0].amount === 6, 'walking over the revolver: 6 rounds in the bag (pickup:collect {amount 6})');
  pk.update(1 / 60, { x: gr.x, y: gr.y, z: gr.z }, inv);
  ok(inv.counts[ITEM.GRENADE] === 1, 'a grenade: one in the bag');
  inv.restore();
  pk.restore();
  ok(inv.counts[ITEM.SIDEARM] === 6 && inv.counts[ITEM.GRENADE] === 1 && rev.taken && gr.taken, 'a respawn keeps them (bag and world): never farmed');
  inv.seed(ITEM.SIDEARM, 10);
  const r2 = pk.spawnAt(ITEM.SIDEARM, 0, -1000, 0);
  pk.update(1 / 60, { x: 0, y: -1000, z: 0 }, inv);
  ok(inv.counts[ITEM.SIDEARM] === 12 && r2.taken, 'rounds cap at 12 (a revolver still found tops it up)');
  inv.seed(ITEM.GRENADE, 3);
  const g2 = pk.spawnAt(ITEM.GRENADE, 0, -1100, 0);
  pk.update(1 / 60, { x: 0, y: -1100, z: 0 }, inv);
  ok(!g2.taken && inv.counts[ITEM.GRENADE] === 3, 'a full grenade pouch (3) leaves it lying (pickup:full)');
}

// ---- 5. the bag kinds, the migration, the save ------------------------------------------------------------------------------------------
{
  ok(ITEM.GRENADE === 5 && ITEM.SIDEARM === 6 && BAG_KINDS === 7 && ITEM_COUNT === 4, 'ITEM.GRENADE 5, ITEM.SIDEARM 6, BAG_KINDS 7, ITEM_COUNT still 4');
  ok(ITEM_KEYS[5] === 'GRENADE' && ITEM_KEYS[6] === 'SIDEARM' && ITEM_NAMES[5] === 'Grenade' && ITEM_NAMES[6] === 'Service revolver' && ITEM_SHORT[5] === 'GRENADE' && ITEM_SHORT[6] === 'REVOLVER', 'names: Grenade / GRENADE, Service revolver / REVOLVER');
  ok(CONFIG.bag.caps.length === 7 && CONFIG.bag.caps[5] === 3 && CONFIG.bag.caps[6] === 12 && CONFIG.bag.applyTime.length === 7 && CONFIG.bag.heal.length === 7, 'caps 3 / 12, the per-kind arrays have 7 entries');
  const inv = new Inventory3D(null);
  ok(inv.counts.length === 7 && inv.refusal(ITEM.GRENADE, null) === 'thrown' && inv.refusal(ITEM.SIDEARM, null) === 'fired' && !inv.use(ITEM.GRENADE), 'not applied: refused (thrown / fired)');
  inv.select(ITEM.GRENADE);
  ok(inv.selected !== ITEM.GRENADE, 'not a numbered slot: select() ignores it');
  const m = migrateCounts([1, 3, 0, 2, 2]);
  ok(m.length === 7 && m[0] === 1 && m[4] === 2 && m[5] === 0 && m[6] === 0, 'an old 5-kind array migrates (padded with zeros)');
  const m2 = migrateCounts([9, -1, 'x', null, 99, 99, 99]);
  ok(m2[0] === 1 && m2[1] === 0 && m2[2] === 0 && m2[4] === 3 && m2[5] === 3 && m2[6] === 12 && migrateCounts(null).every((v) => v === 0), 'garbage and over-cap counts are clamped');
  inv.seed(ITEM.GRENADE, 2);
  inv.seed(ITEM.SIDEARM, 9);
  inv.seed(ITEM.BANDAGE, 3);
  const saved = JSON.parse(JSON.stringify(inv.exportCounts()));
  const inv2 = new Inventory3D(null);
  inv2.importCounts(saved);
  ok(Array.from(inv2.counts).join() === Array.from(inv.counts).join(), 'the save round trip (exportCounts -> JSON -> importCounts)');
  inv2.importCounts([0, 1, 0, 0, 1]);
  ok(inv2.counts[5] === 0 && inv2.counts[6] === 0 && inv2.counts[1] === 1, 'an old save imports cleanly');
  inv.snapshot();
  inv.take(ITEM.GRENADE);
  inv.take(ITEM.SIDEARM);
  inv.restore();
  ok(inv.counts[ITEM.GRENADE] === 1 && inv.counts[ITEM.SIDEARM] === 8, 'a respawn keeps the counts as the death left them (thrown / fired are gone)');
  ok(inv.total === 1 + 8 + 3, 'total counts them');
}

// ---- 6. the setting ------------------------------------------------------------------------------------------------------------------
{
  ok(SETTINGS_DEFAULTS.weapons === true, 'settings.weapons defaults ON');
  const keys = Object.keys(SETTINGS_DEFAULTS);
  ok(keys.indexOf('weapons') > keys.indexOf('frameRate') && keys.indexOf('weapons') < keys.indexOf('touchControls'), 'appended at the end of the WP-UX block');
  ok(sanitizeUxSettings({ weapons: 'off' }).weapons === false && sanitizeUxSettings({ weapons: false }).weapons === false && sanitizeUxSettings({}).weapons === true, 'sanitised: on unless switched off');
  const ui = read('ui/ui3d.js');
  ok(/key: 'weapons', tab: 'rope', type: 'toggle'/.test(ui), 'one SETTINGS_SCHEMA row (Rope)');
  const e2e = fs.readFileSync(TOOLS_DIR + '/e2e/e2e.cjs', 'utf8');
  const fa = fs.readFileSync(TOOLS_DIR + '/e2e/free-attach.cjs', 'utf8');
  ok(e2e.includes('&weapons=off') && (fa.match(/&weapons=off/g) || []).length >= 2, 'the e2e and the free-attach bot pass &weapons=off');
  ok(read('weaponGlue.js').includes('[?&]weapons=off'), '?weapons=off switch');
}

// ---- 7. the sounds ------------------------------------------------------------------------------------------------------------------
{
  const ids = Object.keys(WEAPON_RECIPES);
  const probs = [];
  for (const id of ids) probs.push(...validateRecipe(compileRecipe(id, WEAPON_RECIPES[id])));
  ok(ids.length >= 10 && probs.length === 0, `${ids.length} designed recipes, all valid${probs.length ? ' — ' + probs.slice(0, 3).join('; ') : ''}`);
  for (const need of ['grenade.fizz', 'grenade.bounce', 'grenade.blast', 'revolver.shot', 'revolver.dry', 'weapon.hit', 'mason.pain', 'mason.flee', 'skitter.squish']) if (!ids.includes(need)) ok(false, `recipe ${need}`);
  const reg = { recipes: [], routes: [] };
  const audio = { registerSfx: (id, r) => (reg.recipes.push(id), compileRecipe(id, r)), registerSfxRoute: (t) => reg.routes.push(t) };
  ok(registerWeaponSfx(audio) && reg.recipes.length === ids.length && ['grenade:throw', 'grenade:fizz', 'grenade:blast', 'revolver:fire', 'revolver:dry', 'weapon:hit', 'creature:frighten', 'skitter:killed'].every((t) => reg.routes.includes(t)), 'registered through registerSfx / registerSfxRoute, every event routed');
  ok(registerWeaponSfx(null) === false, 'no engine: nothing');
  const played = [];
  const o = { x: 0, y: 0, z: 0, key: 0, delay: 0 };
  const E = { opts: () => o, play: (id, k) => played.push(id + ':' + k) };
  WEAPON_ROUTES['grenade:blast']({ x: 1, y: 2, z: 3 }, E);
  WEAPON_ROUTES['creature:frighten']({ x: 1, y: 2, z: 3, stagger: false }, E);
  WEAPON_ROUTES['creature:frighten']({ x: 1, y: 2, z: 3, stagger: true }, E);
  WEAPON_ROUTES['revolver:fire']({}, E);
  ok(played.join() === 'grenade.blast:1,mason.pain:1,mason.flee:0.5,mason.pain:0.2,revolver.shot:0.5', `routes play the designed sounds (${played.join(' ')})`);
  ok(!WEAPON_RECIPES['grenade.blast'].layers.every((l) => !l.at) && WEAPON_RECIPES['grenade.blast'].send >= 0.5, 'the blast has its shaft tail (delayed slap-backs, a wet send)');
}

// ---- 8. captions, tutorial, lore ---------------------------------------------------------------------------------------------------
{
  ok(captionForEvent('grenade:blast', {}) === WEAPON_RULES.blast && captionForEvent('creature:frighten', { stagger: false }) === WEAPON_RULES.flee && captionForEvent('creature:frighten', { stagger: true }) === WEAPON_RULES.stagger && captionForEvent('skitter:killed', {}) === WEAPON_RULES.squish && captionForEvent('grenade:throw', {}) === WEAPON_RULES.fuse, 'captions: [A blast], [It screams and flees up the shaft], [It recoils, screaming], [A wet crunch], [A fuse hissing]');
  ok(['grenade:throw', 'grenade:blast', 'creature:frighten', 'skitter:killed'].every((t) => CAPTION_EVENTS.includes(t)), 'the caption tracker subscribes them');
  const st = STEPS.find((s) => s.id === 'weapons');
  ok(!!st && STEPS[STEPS.length - 1] === st && st.desktop && st.touch && st.text, 'the tutorial step (appended), desktop / touch / VR wording');
  ok(WEAPON_LORE[5].length < 140 && WEAPON_LORE[6].length < 140 && /soldier/i.test(WEAPON_LORE[5]) && !/Lanternwright/.test(WEAPON_LORE[5] + WEAPON_LORE[6]), 'the first-pickup lines: short, the soldiers of an earlier expedition (no canon clash)');
}

// ---- 9. the glue: selection, the hot paths -------------------------------------------------------------------------------------------
{
  const bus = new EventBus();
  const bag = new Inventory3D(null);
  const game = { bus, bag, settings: { weapons: true }, knocker: { enabled: true, held: -1 }, difficultyKey: 'nightmare', state: 'playing', player: { x: 0, y: 0, z: 0, alive: true }, realTime: 0 };
  const g = new WeaponGlue(game);
  ok(g.gadget === ITEM.KNOCKER && GADGETS.join() === '4,5,6', 'the knocker is the default gadget');
  g._ensure();
  ok(!!g.sim && g.sim.diffKey === 'nightmare', 'a Weapons3D per world, on the run difficulty');
  bag.seed(ITEM.SIDEARM, 4);
  ok(g.cycle(1) === ITEM.SIDEARM, 'cycling skips the empty grenade pouch');
  ok(g.select(ITEM.GRENADE) === ITEM.GRENADE, 'select(5)');
  game.settings.weapons = false;
  ok(g.pickupDiff() === '' && g.select(ITEM.SIDEARM) === ITEM.GRENADE, 'the setting off: no pickups, no weapon selectable');
  game.settings.weapons = true;
  ok(g.pickupDiff() === 'nightmare', 'pickupDiff = the run difficulty');
  bag.seed(ITEM.GRENADE, 0);
  g.select(ITEM.KNOCKER);
  bag.seed(ITEM.KNOCKER, 0);
  bag.add(ITEM.GRENADE, 1);
  bus.emit('pickup:collect', { kind: ITEM.GRENADE, x: 0, y: 0, z: 0 });
  ok(g.gadget === ITEM.GRENADE && g._toastText === WEAPON_LORE[5], 'a grenade picked up with no knocker left: it becomes the gadget, the lore line is queued');
  const src = read('weaponGlue.js');
  const body = (name) => {
    const a = src.indexOf('\n  ' + name + '(');
    const b = src.indexOf('\n  }\n', a);
    return src.slice(a, b).replace(/\/\/[^\n]*/g, '');
  };
  const hot = ['input', '_origin', '_fireView', '_inputVR', '_scripted', 'step', 'update'].map(body).join('\n');
  const bad = [/\bnew\s(?!g\.modules)/, /=>/, /`/, /[=(,:]\s*\[/, /[=(,]\s*\{/, /\.(map|filter|slice|concat|join|bind)\(/].filter((r) => r.test(hot));
  ok(hot.length > 3000 && bad.length === 0, `the glue's per-frame paths allocate nothing${bad.length ? ' — found ' + bad.join(' ') : ''}`);
}

// ---- 10. the wiring ------------------------------------------------------------------------------------------------------------------
{
  const game = read('game.js');
  ok(game.includes("import { WeaponGlue, weaponDebug } from './weaponGlue.js'") && game.includes('this._setupWeapons();') && game.includes('this.weapons.input(dt, intent)') && game.includes('this.weapons.step(dt)') && game.includes('this.weapons.update(dt)'), 'game.js: _setupWeapons, input before the knocker, step after it, update with the views');
  ok(game.indexOf('this.weapons.input(dt, intent)') < game.indexOf('this._updateKnockerInput(dt, intent);', game.indexOf('this.weapons.input(dt, intent)') - 400), 'the weapons read G before the knocker');
  ok(game.includes("weaponView: './render/weaponView.js'") && game.includes('this.pickups.weaponDiff = this.weapons ? this.weapons.pickupDiff()') && game.includes('weapons: weaponDebug(() => this.weapons)'), 'the view module, the pickups, AT3D.debug.weapons');
  const desk = read('input/desktopInput.js');
  ok(desk.includes("Digit7: 1") && desk.includes("im._bagEdge('gcycle', 1)") && desk.includes("im._bagEdge('gadget'"), 'desktop: 5 6 7 select, T cycles');
  const touch = read('input/touchInput.js');
  ok(touch.includes("'GREN', 'GUN'") && touch.includes('i5:') && touch.includes('i6:'), 'touch: GREN and GUN in the bag');
  const im = read('input/inputManager.js');
  const bg = read('input/bagGesture.js');
  ok(im.includes('S.gadget = wp && wp.gadget >= 4') && bg.includes('S.counts[gk] > 0'), 'VR: the pull-up draws the selected gadget');
  const view = read('render/weaponView.js');
  ok(/SEAM/.test(view) && view.includes('export function weaponTemplate(kind)') && (view.match(/new THREE\.InstancedMesh/g) || []).length === 1 && !/new THREE\.\w*Light\b/.test(view) && !/Texture\(/.test(view), 'the view: one InstancedMesh, no light, no texture, the itemModels seam');
  const bfx = read('render/bagFx.js');
  ok(bfx.includes('ITEM.GRENADE') && bfx.includes('X: SWITCH') && bfx.includes("'REVOLVER'"), 'the bag strip / VR ring show the gadget and the switch');
}

console.log(fails ? `\n${fails} FAILED` : '\nALL WEAPON PICKUP CHECKS PASS');
process.exit(fails ? 1 : 0);
