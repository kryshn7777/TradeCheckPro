/* ABYSSAL TETHER 3D — bagGesture.js
 * The VR gesture for the bag, as a small state machine on plain numbers (no three.js, no DOM: unit-tested in Node).
 *
 *   1. Reach a hand to the bag: a point at the right hip, BAG_ZONE.down (0.45 m) below the head and BAG_ZONE.right
 *      (0.22 m) to its right in the body yaw frame (the head's heading), radius BAG_ZONE.radius (0.25 m). Entering
 *      the zone gives a short haptic tick (`entered` edge).
 *   2. Press the GRIP of that hand in the zone: a radial of four icons opens floating at the hand
 *      (anchor = where the hand was). While it is open the grip does not yank the rope.
 *   3. Point and release: move the hand from the anchor toward an icon (left = first aid kit, up = bandage,
 *      right = adrenaline, down = battery; further than BAG_ZONE.pick = 0.06 m) and RELEASE the grip. That item
 *      is applied (`chosen` = slot 0..3). Release without pointing (or on an empty slot, `hover` -1) just closes it.
 *   4. A grip press in the zone while an item is being applied cancels it (`cancel` edge).
 *   5. THE KNOCKER (sim/knocker3d.js): with the radial open, DRAW the hand up and out of the bag (BAG_ZONE.draw = 0.2 m from the
 *      anchor, at least BAG_ZONE.drawUp = 0.15 m of it upward) still squeezing the grip: a knocker comes out in that hand
 *      (`drawn` edge, `knocker` = the hand; only when S.knocker says one may be drawn, else `drawRefused` once). Swing the arm
 *      and RELEASE the grip: `thrown` edge (the hand); the game throws it with the hand's release velocity, or puts it back
 *      when the release was too gentle. One reach-and-throw motion: grab at the hip, pull, throw.
 *
 * update() fills `out` every frame; edges (`entered`, `chosen`, `cancel`) last one frame.
 */

export const BAG_ZONE = {
  right: 0.22, // m to the right of the head, in the head-yaw frame (the right hip)
  down: 0.45, // m below the head
  forward: 0.0,
  radius: 0.25, // a hand within this of the zone point is "at the bag"
  pick: 0.06, // m of hand travel from the anchor that selects an icon
  gripOn: 0.55,
  gripOff: 0.35,
  radial: 0.1, // m: distance of the icons from the anchor (drawn by BagFx)
  draw: 0.2, // m from the anchor: pulling the hand this far out (and up) with the grip held draws a knocker
  drawUp: 0.15, // m of that upward
};

/** Slot hovered for a hand offset (right r, up u) from the anchor, or -1 inside the dead centre. Left 0, up 1, right 2, down 3. */
export function radialSlot(r, u, pick = BAG_ZONE.pick) {
  if (r * r + u * u < pick * pick) return -1;
  if (Math.abs(r) >= Math.abs(u)) return r < 0 ? 0 : 2;
  return u > 0 ? 1 : 3;
}

export function makeBagGesture() {
  return {
    zone: -1, // hand index (0 left, 1 right) in the bag zone, else -1
    open: false, // the radial is open (grip held)
    hand: -1, // the hand that opened it
    ax: 0,
    ay: 0,
    az: 0, // radial anchor (world)
    px: 0,
    py: 0,
    pz: 0, // the zone point (world), for a marker
    hover: -1, // slot under the hand while open
    entered: false, // edge: a hand just entered the zone
    chosen: -1, // edge: slot released on (0..3), else -1
    cancel: false, // edge: grip pressed in the zone while applying
    knocker: -1, // the hand holding a knocker drawn from the bag, else -1
    drawn: -1, // edge: a knocker was drawn into this hand
    thrown: -1, // edge: this hand let the knocker go (the game throws it / puts it back)
    drawRefused: false, // edge: a draw was tried while none may be drawn
    drawK: 0, // 0..1 how far the open hand is along the draw (the radial's hint)
    _refused: false,
    gripping: false, // the opening hand's grip is held (the rope must not yank)
    // gripDown[i]: hand i's grip is pressed (hysteresis); the InputManager does not yank a rope with a grip that is at the bag
    _prevZone: -1,
    gripDown: [false, false],
  };
}

/**
 * @param {object} g makeBagGesture()
 * @param {object} S  { live, applying, hx,hy,hz, yaw, hands: [{ok,x,y,z,grip} left, right], counts: [4] }
 */
export function updateBagGesture(g, S) {
  g.entered = false;
  g.chosen = -1;
  g.cancel = false;
  g.drawn = -1;
  g.thrown = -1;
  g.drawRefused = false;
  g.drawK = 0;
  const cy = Math.cos(S.yaw);
  const sy = Math.sin(S.yaw);
  // right = (cos, 0, -sin), forward = (-sin, 0, -cos)
  const rx = cy;
  const rz = -sy;
  const fx = -sy;
  const fz = -cy;
  const side = S.left ? -1 : 1; // WP-UX: settings.dominantHand 'left' puts the bag on the left hip
  g.px = S.hx + rx * BAG_ZONE.right * side + fx * BAG_ZONE.forward;
  g.py = S.hy - BAG_ZONE.down;
  g.pz = S.hz + rz * BAG_ZONE.right * side + fz * BAG_ZONE.forward;

  // Which hand is in the zone (the nearer when both)?
  let zone = -1;
  let best = BAG_ZONE.radius * BAG_ZONE.radius;
  for (let i = 0; i < 2; i++) {
    const h = S.hands[i];
    if (!h || !h.ok) continue;
    const dx = h.x - g.px;
    const dy = h.y - g.py;
    const dz = h.z - g.pz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < best) {
      best = d2;
      zone = i;
    }
  }
  if (!S.live) {
    g.open = false;
    g.hand = -1;
    g.hover = -1;
    g.gripping = false;
    g.zone = -1;
    g._prevZone = -1;
    g.gripDown[0] = g.gripDown[1] = false;
    g.knocker = -1;
    return g;
  }
  // A knocker in a hand: the release of that grip throws it (an untracked hand lets go too).
  if (g.knocker >= 0) {
    const kh = g.knocker;
    const h = S.hands[kh];
    const down = !!h && h.ok && (g.gripDown[kh] ? h.grip > BAG_ZONE.gripOff : h.grip >= BAG_ZONE.gripOn);
    g.gripDown[kh] = down;
    if (!down) {
      g.thrown = kh;
      g.knocker = -1;
    }
  }
  if (g.open) {
    // Keep the opening hand even if it wanders off the zone.
    const h = S.hands[g.hand];
    if (!h || !h.ok) {
      g.open = false;
      g.hover = -1;
      g.gripping = false;
    } else {
      const ox = h.x - g.ax;
      const oy = h.y - g.ay;
      const oz = h.z - g.az;
      const r = ox * rx + oz * rz;
      const slot = radialSlot(r, oy);
      g.hover = slot >= 0 && S.counts[slot] > 0 ? slot : -1;
      const wasDown = g.gripDown[g.hand];
      const down = wasDown ? h.grip > BAG_ZONE.gripOff : h.grip >= BAG_ZONE.gripOn;
      g.gripDown[g.hand] = down;
      const d2 = ox * ox + oy * oy + oz * oz;
      g.drawK = oy > 0 ? Math.min(1, Math.min(oy / BAG_ZONE.drawUp, Math.sqrt(d2) / BAG_ZONE.draw)) : 0;
      if (down && oy >= BAG_ZONE.drawUp && d2 >= BAG_ZONE.draw * BAG_ZONE.draw && S.counts.length > 4 && S.counts[4] > 0) {
        if (S.knocker) {
          // pulled out of the bag: the knocker is in this hand, the radial closes, the grip holds it
          g.knocker = g.hand;
          g.drawn = g.hand;
          g.open = false;
          g.hover = -1;
          g.gripping = true;
          g._refused = false;
        } else if (!g._refused) {
          g._refused = true;
          g.drawRefused = true;
        }
      } else if (!down) {
        if (g.hover >= 0) g.chosen = g.hover;
        g.open = false;
        g.hover = -1;
        g.gripping = false;
      } else {
        g.gripping = true;
      }
    }
  } else {
    g.gripping = false;
    for (let i = 0; i < 2; i++) {
      if (i === g.knocker || i === g.thrown) continue; // that grip is holding (or just threw) the knocker
      const h = S.hands[i];
      const wasDown = g.gripDown[i];
      const down = !!h && h.ok && (wasDown ? h.grip > BAG_ZONE.gripOff : h.grip >= BAG_ZONE.gripOn);
      g.gripDown[i] = down;
      if (down && !wasDown && zone === i) {
        if (S.applying) {
          g.cancel = true;
        } else {
          g.open = true;
          g._refused = false;
          g.hand = i;
          g.ax = h.x;
          g.ay = h.y;
          g.az = h.z;
          g.hover = -1;
          g.gripping = true;
        }
      }
    }
  }
  if (zone >= 0 && g._prevZone < 0) g.entered = true;
  g._prevZone = zone;
  g.zone = zone;
  return g;
}
