// THE FALL (docs/abyssal-tether-3d/plans/OPENING_V2_THE_COLLAR.md section 7), Node: ringing the S1 bell (the objective that already
// opens the seal under the chimney) releases his line from above and he goes down below Lamp Zero. The beat is the radio's: it fires once
// per run, in order, after the opening and the slip at the bell, never cuts into another exchange, and plays below Lamp Zero on the first
// entry of S2. It is presentation only (no sim change): the level's S1 objective / seal and the S1 -> S2 route are unchanged.
//   node fall-beat.mjs [--root DIR]
import { srcUrl } from '../../verify/root.mjs';

const { CommsDirector, COMMS_SCRIPT } = await import(srcUrl('sim/comms3d.js'));
const { LEVEL_DATA_3D } = await import(srcUrl('data/level-data-3d.js'));
let fails = 0;
const ok = (c, msg, d) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg + (d !== undefined ? `  - ${JSON.stringify(d)}` : ''));
  if (!c) fails++;
};
const byId = Object.fromEntries(COMMS_SCRIPT.map((l) => [l.id, l]));
const FALL = ['s1-fall-1', 's1-fall-2', 's1-fall-3'];
const BELOW = ['s2-fall-1', 's2-fall-2', 's2-fall-3', 's2-fall-3w'];

// ---- the lines -----------------------------------------------------------------------------------------------------------------------
ok([...FALL, ...BELOW].every((id) => byId[id] && byId[id].prio === 3 && byId[id].glitch === 'none'), 'the seven lines exist, beats (prio 3), on a clean signal');
const f1 = byId['s1-fall-1'];
ok(f1.speaker === 'VESPER' && f1.section === -1 && f1.when.length === 1 && f1.when[0].ev === 'objective:done' && f1.when[0].match.verb === 'bell' && f1.wait.includes('s1-open-1') && f1.wait.includes('s1-bell-1'), 'Vesper reads the release when the bell is done (any section: a quick drop still hears it), after the opening and the slip');
ok(byId['s1-fall-2'].speaker === 'TICK' && /didn't send that/.test(byId['s1-fall-2'].text) && byId['s1-fall-3'].speaker === 'ODESSA' && !/didn't|did not/.test(byId['s1-fall-3'].text), 'Tick did not send it; Odessa never says she did not (the radio lies only by omission)');
ok(byId['s2-fall-1'].section === 1 && byId['s2-fall-1'].when[0].enter && byId['s2-fall-1'].wait.includes('s1-fall-1') && /Lamp Zero/.test(byId['s2-fall-1'].text) && /Lighters will find you/.test(byId['s2-fall-3'].text) && byId['s2-fall-3w'].speaker === 'ELIAS', 'below Lamp Zero: Tick alarmed, Maren quiet, Odessa calm ("The Lighters will find you."), Elias answers');
ok(/ring the bell/i.test(byId['s1-open-5'].text) && /Lighters/.test(byId['s1-open-5'].text), 'the small job: the opening tells him to ring the bell for the Lighters');

// ---- a run ---------------------------------------------------------------------------------------------------------------------------
function run(script) {
  const cm = new CommsDirector({ seed: 7 });
  const x = { playing: true, section: 0, depth: 0, frac: 0, danger: false, tense: false, skip: false, gaze: false, bloodOn: false };
  const starts = [];
  cm.onStart = (tx) => starts.push({ id: tx.id, t: +cm.clock.toFixed(3) });
  const ends = [];
  cm.onEnd = (tx) => ends.push({ id: tx.id, t: +cm.clock.toFixed(3) });
  const ev = (type, p) => cm.onEvent(type, p || {});
  const step = (secs) => {
    for (let i = 0; i < Math.round(secs * 60); i++) cm.update(1 / 60, x);
  };
  ev('game:start');
  script({ cm, x, ev, step });
  return { starts, ends, ids: starts.map((s) => s.id) };
}
const enterS2 = (x, ev, first) => {
  x.section = 1;
  x.depth = 22;
  ev('section:enter', { index: 1, first, mode: first ? 'progress' : 'respawn' });
};
const idx = (ids, id) => ids.indexOf(id);
const count = (ids, id) => ids.filter((i) => i === id).length;
{
  // the bell rung during the opening (the slip from the hint still pending): the opening, the slip, then the release
  const r = run(({ x, ev, step }) => {
    ev('section:enter', { index: 0, first: true, mode: 'initial' });
    step(3);
    ev('hint', { text: 'Swing into the bell. Its toll opens the way down.' });
    step(6);
    ev('bell:ring', {});
    ev('objective:done', { verb: 'bell', section: 's1' });
    step(50); // he hangs over the open seal while the radio talks
    enterS2(x, ev, true);
    step(90);
    ev('objective:done', { verb: 'bell', section: 's1' }); // a stray second event
    step(20);
  });
  const ids = r.ids;
  const all = [...FALL, ...BELOW];
  ok(all.every((id) => count(ids, id) === 1), 'each line plays exactly once', all.map((id) => count(ids, id)));
  ok(FALL.every((id, i) => i === 0 || idx(ids, id) > idx(ids, FALL[i - 1])) && BELOW.every((id, i) => i === 0 || idx(ids, id) > idx(ids, BELOW[i - 1])), 'in order: the release, Tick, Odessa; then below Lamp Zero');
  ok(idx(ids, 's1-open-5w') >= 0 && idx(ids, 's1-bell-3') >= 0 && idx(ids, 's1-fall-1') > idx(ids, 's1-open-5w') && idx(ids, 's1-fall-1') > idx(ids, 's1-bell-3') && idx(ids, 's2-fall-1') > idx(ids, 's1-fall-3'), 'after the opening and the slip; below Lamp Zero only after the release exchange', ids);
  let overlap = false;
  for (let i = 1; i < r.starts.length; i++) if (r.starts[i].t < r.ends[i - 1].t) overlap = true;
  ok(!overlap, 'never two lines at once');
}
{
  // a Continue that starts in S2 (no bell this run): only the S2 lines
  const r = run(({ x, ev, step }) => {
    enterS2(x, ev, true);
    step(40);
  });
  ok(FALL.every((id) => !r.ids.includes(id)) && BELOW.every((id) => r.ids.includes(id)), 'a run that starts below Lamp Zero hears only the S2 lines (still true), never the release');
}
{
  // a death and a respawn into S2 after the beat: nothing replays
  const r = run(({ x, ev, step }) => {
    ev('section:enter', { index: 0, first: true, mode: 'initial' });
    step(1);
    ev('objective:done', { verb: 'bell', section: 's1' });
    step(60);
    enterS2(x, ev, true);
    step(40);
    ev('player:death', { cause: 'impact' });
    x.playing = false;
    step(3);
    x.playing = true;
    enterS2(x, ev, false);
    ev('game:respawn', {});
    step(40);
  });
  ok([...FALL, ...BELOW].every((id) => count(r.ids, id) <= 1) && r.ids.includes('s1-fall-1') && r.ids.includes('s2-fall-1'), 'a restore after it replays nothing');
}

// ---- the level: the fall IS the existing route ---------------------------------------------------------------------------------------
{
  const obj = (LEVEL_DATA_3D.objectives || []).find((o) => o.id === 'obj-s1');
  const seal = (LEVEL_DATA_3D.seals || []).find((s) => s.id === 'seal-s1');
  ok(!!obj && obj.verb === 'bell' && obj.sealId === 'seal-s1' && !!seal, 'S1: the bell opens seal-s1 (the grating under the chimney): the fall needs no new geometry or physics', { obj: !!obj, seal: !!seal });
  const s2 = LEVEL_DATA_3D.sections[1];
  ok(s2 && s2.checkpoint && s2.checkpoint.y < -8.5, 'the S2 checkpoint lies below the seal (the drop the route bots already verify)');
}

console.log(fails ? `\n${fails} check(s) failed` : '\nfall beat: all checks pass');
process.exitCode = fails ? 1 : 0;
