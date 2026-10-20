// Stub 3D shaft for creature tests: a square shaft (inner faces at ±16 m) built
// from wall boxes in 40 m courses, with ledges, pillars, a bridge, a window
// opening and the 2D game's 8 sections scaled to a 560 m descent.
export function makeShaftData(opts = {}) {
  const H = opts.half || 16; // inner half width
  const T = 6; // wall thickness
  const bottom = -560;
  const solids = [];
  const box = (minX, minY, minZ, maxX, maxY, maxZ, kind = 'stone', extra = {}) =>
    solids.push(Object.assign({ minX, minY, minZ, maxX, maxY, maxZ, kind }, extra));
  for (let y = 20; y > bottom - 10; y -= 40) {
    const y0 = y - 40;
    const window = y <= -180 && y > -260; // an opening in the +X wall (sighting gallery)
    // -X wall, +X wall (split around the window), -Z, +Z
    box(-H - T, y0, -H - T, -H, y, H + T, 'wall');
    if (window) {
      box(H, y0, -H - T, H + T, y, -6, 'wall');
      box(H, y0, 6, H + T, y, H + T, 'wall');
    } else box(H, y0, -H - T, H + T, y, H + T, 'wall');
    box(-H, y0, -H - T, H, y, -H, 'wall');
    box(-H, y0, H, H, y, H + T, 'wall');
  }
  // Ledges along the walls every ~14 m, alternating walls.
  let k = 0;
  for (let y = -8; y > bottom + 6; y -= 14, k++) {
    const side = k % 4;
    const w = 7 + (k % 3) * 2;
    const c = ((k * 37) % 17) - 8;
    if (side === 0) box(-H, y - 1, c - w / 2, -H + 3.2, y, c + w / 2, 'stone');
    else if (side === 1) box(H - 3.2, y - 1, c - w / 2, H, y, c + w / 2, 'stone');
    else if (side === 2) box(c - w / 2, y - 1, -H, c + w / 2, y, -H + 3.2, 'stone');
    else box(c - w / 2, y - 1, H - 3.2, c + w / 2, y, H, 'metal');
  }
  // Pillars and a bridge.
  box(-9, -360, -9, -6, -300, -6, 'pillar');
  box(5, -470, 4, 8, -400, 7, 'pillar');
  box(-H, -331, -1.2, H, -330, 1.2, 'bridge');
  // Chamber floor + goal + gate.
  box(-H - T, bottom - 4, -H - T, H + T, bottom, H + T, 'stone');
  const sec = (id, yTop, yBottom, mode, lethal, spawnOffsetY, triggers = []) => ({
    id, name: id, yTop, yBottom, checkpoint: { x: 0, y: yTop - 1.5, z: 0 },
    creature: { mode, lethal, speedMul: 1, burstRate: 0, spawnOffsetY }, triggers, hints: [],
  });
  const sections = [
    sec('s1', 20, -30, 'dormant', false, 100),
    sec('s2', -30, -112, 'dormant', false, 100),
    sec('s3', -112, -162, 'dormant', false, 92),
    sec('s4', -162, -230, 'sighting', false, 85, [{ y: -172, name: 'sighting', data: { x: 0, y: -222, z: 0, dx: 0.3, dz: 1, span: 44, duration: 8.5 } }]),
    sec('s5', -230, -307, 'stalk', true, 52),
    sec('s6', -307, -390, 'hunt', true, 48),
    sec('s7', -390, -478, 'frenzy', true, 44),
    sec('s8', -478, -560, 'escape', true, 40),
  ];
  return {
    name: 'stub shaft',
    spawn: { x: 0, y: 0.4, z: 0, yaw: 0 },
    goal: { minX: -4, maxX: 4, minY: bottom, maxY: bottom + 4, minZ: -H, maxZ: -H + 6 },
    gate: { minX: -4, maxX: 4, minY: bottom, maxY: bottom + 6, minZ: -H + 6, maxZ: -H + 6.5 },
    sections,
    solids,
    hazards: [],
    anchors: [],
    decor: [],
    lights: [],
  };
}
