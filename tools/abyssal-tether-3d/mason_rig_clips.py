"""THE MASON RIG, v2 (2026-10, "the saint that learned to hunt"): the clips, authored in code (numpy, no bpy), 30 fps, in place, root
never keyed. The v1 clips (round-3 crown) are frozen in mason_rig_clips_v1.py; build_mason_rig.py picks them for a v1 kit.

Axes are glTF's, and every bone is identity-oriented at rest, so bone-local rotations are rotations about the world axes through the
bone's own pivot: +X right, +Y dorsal (up), +Z backward (tail-ward); the head faces -Z.
  yaw   about +Y      pitch about +X      roll about +Z
What the crown bones ARE in v2 (bone names and roles of the rig contract unchanged):
  portal_comb_L0 / R0  the two halves of the split stone face: doors hinged at their outer back edge (yaw opens: +L / -R)
  portal_comb_L1 / R1  the rows of human teeth on the split edges, children of their door (x toward the midline: +L / -R)
  portal_hinge_0 / 1   the left / right half of the broken jaw, pivot at its joint (pitch -: drops, yaw +L / -R: splays)
  portal_arch_0..2     three rings of hooked fangs behind the face (2 = front): -z thrusts them out through the open face
  gullet_0..2          the throat (scale x / y: swells, convulses)
  pit_0..6             the clusters of blind eyes in the sockets (children of the doors): rotation = the eyes roll, scale = bulge
  arm_n_0 / arm_n_1    five long flayed arms (shoulder) and their skeleton hands (wrist): yaw spreads (+L / -R), pitch raises
Values are DELTAS from the rest pose (degrees / kit metres / scale factors, 1 = unchanged). Base clips are absolute poses of the crown
subtree (the delta from rest); additive clips have an identity first frame (the runtime applies AnimationUtils.makeClipAdditive);
parametric clips are driven by time = value x duration; the leg template is retargeted by renaming tracks. Principles as code:
anticipation (a clench before the face opens), overshoot and ringing (slams), follow-through (arms and eyes trail by whole frames),
asymmetry (the right half of the jaw drops further, the arms never move as a ring), wrongness (the eyes rove independently, the
throat convulses in waves).
"""
import math

import numpy as np

FPS = 30
ARMS_LEFT = (0, 1, 2)          # x < 0 on the crown (arm_2 is the high left one)
ARM_REACH = {0: 1.0, 1: 0.9, 2: 1.15, 3: 0.95, 4: 1.05}      # how far each arm commits (asymmetric on purpose)
COMBS = ("portal_comb_L0", "portal_comb_L1", "portal_comb_R0", "portal_comb_R1")
HINGES = ("portal_hinge_0", "portal_hinge_1")
ARCHES = ("portal_arch_0", "portal_arch_1", "portal_arch_2")        # 2 is the outermost (front) order
GULLETS = ("gullet_0", "gullet_1", "gullet_2")
PITS = tuple("pit_%d" % j for j in range(7))
CROWN_BONES = ("crown",) + ARCHES + COMBS + HINGES + GULLETS + PITS + tuple("arm_%d_%d" % (n, k) for n in range(5) for k in (0, 1))
CROWN_PARENT = "neck"


# ---- curve helpers (all vectorised over the frame times t, seconds) -------------------------------------------------------
def sstep(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3 - 2 * x)


def ramp(t, a, b):
    return sstep((t - a) / max(b - a, 1e-6))


def ease_in(t, a, b, p=2.5):
    x = np.clip((t - a) / max(b - a, 1e-6), 0.0, 1.0)
    return x ** p


def ease_out(t, a, b, p=2.5):
    x = np.clip((t - a) / max(b - a, 1e-6), 0.0, 1.0)
    return 1.0 - (1.0 - x) ** p


def keys(t, pts, tension=0.5):
    """Catmull-Rom through (time, value) keys (flowing, overshoots naturally); clamps outside the key range."""
    tt = np.array([p[0] for p in pts], float)
    vv = np.array([p[1] for p in pts], float)
    n = len(tt)
    m = np.zeros(n)
    for i in range(n):
        a, b = max(i - 1, 0), min(i + 1, n - 1)
        m[i] = tension * (vv[b] - vv[a]) / max(tt[b] - tt[a], 1e-6) if b != a else 0.0
    out = np.empty_like(t, dtype=float)
    idx = np.clip(np.searchsorted(tt, t, side="right") - 1, 0, n - 2)
    h = tt[idx + 1] - tt[idx]
    s = np.clip((t - tt[idx]) / h, 0.0, 1.0)
    s2, s3 = s * s, s * s * s
    out = ((2 * s3 - 3 * s2 + 1) * vv[idx] + (s3 - 2 * s2 + s) * h * m[idx] + (-2 * s3 + 3 * s2) * vv[idx + 1] + (s3 - s2) * h * m[idx + 1])
    return np.where(t <= tt[0], vv[0], np.where(t >= tt[-1], vv[-1], out))


def ringing(t, t0, freq, zeta, amp=1.0):
    """Damped oscillation that starts at t0 (an impact): the overshoot / settle after a slam."""
    x = np.maximum(t - t0, 0.0)
    w = 2 * math.pi * freq
    return np.where(t >= t0, amp * np.exp(-zeta * w * x) * np.sin(w * math.sqrt(max(1 - zeta * zeta, 1e-3)) * x), 0.0)


def noise(t, seed, freq, period=None, n=3):
    """Smooth pseudo-random in about [-1, 1]. With `period` every component has a whole number of cycles (a seamless loop)."""
    rng = np.random.RandomState(seed)
    out = np.zeros_like(t, dtype=float)
    for i in range(n):
        f = freq * (1 + 0.73 * i + 0.21 * rng.rand())
        if period:
            f = max(1, round(f * period)) / period
        out += np.sin(2 * math.pi * f * t + rng.rand() * 6.283) / (1 + 0.5 * i)
    return out / (1.0 + 0.5 + 0.34)


def tic(t, times, amp, width=0.07):
    """Sharp one-sided twitches (an instant offset that decays in `width` seconds): stone ratcheting, not muscle."""
    out = np.zeros_like(t, dtype=float)
    for t0 in times:
        x = t - t0
        out += np.where(x >= 0, amp * np.exp(-x / width), 0.0)
    return out


def stagger(fn, i, frames):
    """Follow-through: the same curve `frames` whole frames later per index."""
    return lambda t: fn(t - i * frames / FPS)


# ---- clip container ---------------------------------------------------------------------------------------------------------
def _qmul(a, b):
    ax, ay, az, aw = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    bx, by, bz, bw = b[..., 0], b[..., 1], b[..., 2], b[..., 3]
    return np.stack([aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz], axis=-1)


def _qaxis(axis, deg):
    ax = np.asarray(axis, float)
    ax = ax / (np.linalg.norm(ax) + 1e-12)
    h = np.radians(np.asarray(deg, float)) * 0.5
    s = np.sin(h)
    return np.stack([ax[0] * s, ax[1] * s, ax[2] * s, np.cos(h)], axis=-1)


class Clip:
    def __init__(self, name, duration, kind="base", loop=False, events=None, mask=None, phase=None, snap=False, note=""):
        self.name, self.duration, self.kind, self.loop = name, float(duration), kind, loop
        self.events = events or []          # [(name, u)]
        self.mask = mask or []              # regexes of the bones the runtime may expect tracks for
        self.phase = phase                  # 'windup' | 'strike' | None
        self.snap = snap                    # exempt from the angular speed gate
        self.note = note
        self.F = int(round(duration * FPS)) + 1
        self.t = np.arange(self.F) / FPS
        self.u = self.t / self.duration
        self.q = {}                         # bone -> (F,4) xyzw delta rotation
        self.p = {}                         # bone -> (F,3) delta translation (kit metres, bone-parent frame)
        self.s = {}                         # bone -> (F,3) scale (1 = unchanged)

    def _q(self, bone):
        if bone not in self.q:
            self.q[bone] = np.tile(np.array([0.0, 0.0, 0.0, 1.0]), (self.F, 1))
        return self.q[bone]

    def rot(self, bone, yaw=None, pitch=None, roll=None, axis=None, deg=None):
        """Adds a rotation (degrees, arrays or scalars): yaw about Y, then pitch about X, then roll about Z (applied in that
        order after whatever the bone already has), or an arbitrary axis."""
        q = self._q(bone)
        for ax, v in (((0, 1, 0), yaw), ((1, 0, 0), pitch), ((0, 0, 1), roll)):
            if v is not None:
                q[:] = _qmul(q, _qaxis(ax, np.broadcast_to(np.asarray(v, float), (self.F,))))
        if axis is not None:
            q[:] = _qmul(q, _qaxis(axis, np.broadcast_to(np.asarray(deg, float), (self.F,))))

    def move(self, bone, x=0.0, y=0.0, z=0.0):
        p = self.p.setdefault(bone, np.zeros((self.F, 3)))
        p += np.stack([np.broadcast_to(np.asarray(v, float), (self.F,)) for v in (x, y, z)], axis=-1)

    def scale(self, bone, x=1.0, y=None, z=None):
        y = x if y is None else y
        z = x if z is None else z
        s = self.s.setdefault(bone, np.ones((self.F, 3)))
        s *= np.stack([np.broadcast_to(np.asarray(v, float), (self.F,)) for v in (x, y, z)], axis=-1)

    def finish(self):
        """Makes quaternions continuous and the loop seamless (last key = first key for loops)."""
        for b, q in self.q.items():
            for i in range(1, self.F):
                if np.dot(q[i], q[i - 1]) < 0:
                    q[i] = -q[i]
            q /= np.linalg.norm(q, axis=1, keepdims=True)
        if self.loop:
            for d in (self.q, self.p, self.s):
                for b, a in d.items():
                    a[-1] = a[0]
        return self

    def bones(self):
        return sorted(set(self.q) | set(self.p) | set(self.s))


def arm_out(n):
    """+1 where a positive roll swings the arm outward (the left arms), -1 for the right ones."""
    return 1.0 if n in ARMS_LEFT else -1.0


def comb_out(name):
    return -1.0 if "_L" in name else 1.0          # world x direction that leads out of the portal (into the jamb)


# ---- v2 anatomy helpers ------------------------------------------------------------------------------------------------------
DOORS = ("portal_comb_L0", "portal_comb_R0")
ROWS = ("portal_comb_L1", "portal_comb_R1")
JAWS = ("portal_hinge_0", "portal_hinge_1")
RINGS = ARCHES
OPEN = {"L": 1.0, "R": -1.0}                      # yaw sign that swings a door / splays a jaw half / spreads an arm outward
JAW_OPEN = -1.0                                   # pitch sign that drops a jaw half (pivot behind and above the chin)
JAW_SIDE = ("L", "R")
DOOR_REACH = {"L": 1.0, "R": 1.18}                # the right half always opens further (asymmetric)


def door(c, j, deg):
    side = "LR"[j]
    c.rot(DOORS[j], yaw=OPEN[side] * deg * DOOR_REACH[side])


def row(c, j, m):
    c.move(ROWS[j], x=OPEN["LR"[j]] * m)


def jaw(c, j, drop, splay=0.0):
    c.rot(JAWS[j], yaw=OPEN[JAW_SIDE[j]] * splay, pitch=JAW_OPEN * drop)


def arm(c, n, spread, lift, wrist):
    c.rot("arm_%d_0" % n, yaw=arm_out(n) * spread * ARM_REACH[n], pitch=lift)
    c.rot("arm_%d_1" % n, pitch=wrist)


def eyes_rove(c, t, amp, period=None, seed=0, rate=1.0):
    """Every cluster looks somewhere else: slow drift plus sharp saccades (stone ratchets, muscle does not)."""
    for j, nm in enumerate(PITS):
        y = amp * noise(t, 300 + j + seed, 0.35 * rate, period) + 0.6 * amp * np.sin(2 * math.pi * np.floor(t * (1.1 + 0.3 * j) * rate) * 1.7 + j)
        p = 0.7 * amp * noise(t, 400 + j + seed, 0.3 * rate, period)
        c.rot(nm, yaw=y, pitch=p)


def CROWN_BONES_MASK():
    return [r"^crown$", r"^portal_", r"^gullet_", r"^pit_", r"^arm_"]


# ---- the poses the attack clips share -------------------------------------------------------------------------------------------
REAR = dict(crown_pitch=-16.0, crown_y=1.0, crown_z=0.9, door=(23.0, 23.0), jaw=(18.0, 22.0), splay=(8.0, 10.0), ring=(0.2, 0.32, 0.45),
            row=0.06, spread=32.0, lift=22.0, wrist=-30.0, pit=1.5, gullet=1.3)


def crown_idle():
    c = Clip("crown_idle", 6.0, "base", True, mask=CROWN_BONES_MASK(), note="the crack breathes, the jaw twitches, the eyes rove")
    t, P = c.t, 6.0
    c.rot("crown", yaw=1.8 * noise(t, 1, 0.12, P), roll=1.0 * noise(t, 2, 0.15, P), pitch=0.9 * noise(t, 3, 0.1, P))
    for j in range(2):
        door(c, j, 1.3 + 1.3 * np.sin(2 * math.pi * t / P + 1.7 * j))
        burst = np.clip(np.sin(2 * math.pi * (t / P) * 2 + j * 1.7), 0, 1) ** 3
        row(c, j, 0.012 * burst * np.sin(2 * math.pi * 7 * t) + tic(t, [1.1 + 2.3 * j, 4.2 - 1.5 * j], 0.03, 0.05))
        jaw(c, j, 2.0 * noise(t, 7 + j, 0.2, P) + tic(t, [2.2 + 1.9 * j], 3.5 + 2 * j, 0.09), 1.0 * noise(t, 9 + j, 0.15, P))
    for j, nm in enumerate(RINGS):
        c.move(nm, z=0.05 * np.sin(2 * math.pi * (t / P) + 0.9 * j))
        c.rot(nm, roll=2.0 * np.sin(2 * math.pi * (t / P) - 1.2 * j))
    eyes_rove(c, t, 5.0, P)
    for j, nm in enumerate(PITS):
        c.scale(nm, 1.0 + 0.05 * np.sin(2 * math.pi * (t / P) * 2 + j * 0.9))
    for j, nm in enumerate(GULLETS):
        s = 1.0 + 0.05 * np.sin(2 * math.pi * (t / P) - j * 0.7)
        c.scale(nm, s, s, 1.0)
    for n in range(5):
        arm(c, n, 3.0 * noise(t, 10 + n, 0.16, P), 3.5 * noise(t, 20 + n, 0.13, P), -6.0 + 7.0 * noise(t, 30 + n, 0.2, P))
    return c.finish()


def listen():
    c = Clip("listen", 3.2, "base", True, events=[("pulse", 0.125), ("pulse", 0.5), ("pulse", 0.75)], mask=CROWN_BONES_MASK(),
             note="the head cocks, every eye turns to the sound, the crack opens a hand's breadth")
    t, D = c.t, 3.2
    tilt = keys(t, [(0, 0), (0.45, 10.5), (0.7, 9.2), (1.45, 9.0), (1.9, -7.5), (2.1, -6.8), (2.85, -7.0), (3.2, 0.0)])
    c.rot("crown", roll=tilt, yaw=-0.4 * tilt + tic(t, [0.95, 2.35], 1.8, 0.05), pitch=3.0 * ramp(t, 0, 0.5) * (1 - ramp(t, 2.7, 3.2)))
    c.move("crown", y=-0.2 * ramp(t, 0, 0.6) * (1 - ramp(t, 2.6, 3.2)))
    flare = ramp(t, 0.1, 0.8) * (1 - ramp(t, 2.6, 3.2))
    tremble = 0.4 * np.sin(2 * math.pi * 9 * t) * flare
    for j in range(2):
        door(c, j, 5.0 * flare + tremble)
        row(c, j, 0.03 * flare)
        jaw(c, j, 6.0 * flare + 1.5 * tremble, 3.0 * flare)
    # all the eyes snap round to the sound at once (one direction per tilt), then hold quivering
    look = keys(t, [(0, 0), (0.35, 0.0), (0.42, 1.0), (1.8, 1.0), (1.87, -1.0), (2.9, -1.0), (3.2, 0.0)])
    for j, nm in enumerate(PITS):
        c.rot(nm, yaw=11.0 * look + 1.2 * np.sin(2 * math.pi * (13 + j) * t) * flare, pitch=-4.0 * flare)
        pulse = sum(np.exp(-((t - tp * D) / 0.11) ** 2) for tp in (0.125, 0.5, 0.75))
        c.scale(nm, 1.0 + 0.2 * flare + 0.18 * pulse * (0.7 + 0.3 * ((j * 3) % 7) / 6.0))
    for j, nm in enumerate(RINGS):
        c.move(nm, z=0.12 * (j + 1) * 0.5 * flare)
    for j, nm in enumerate(GULLETS):
        c.scale(nm, 1.0 + 0.06 * flare, 1.0 + 0.06 * flare, 1.0)
    for n in range(5):
        k = stagger(lambda x: ramp(x, 0.1, 0.8) * (1 - ramp(x, 2.6, 3.2)), n, 3)(t)
        arm(c, n, 24.0 * k + tremble * (1 + n % 2), -6.0 * flare, -12.0 * flare)
    return c.finish()


def notice_snap():
    c = Clip("notice_snap", 0.45, "base", False, events=[("snap", 0.22)], mask=CROWN_BONES_MASK(), snap=True, note="the head snaps to the sound")
    t = c.t
    snap = keys(t, [(0, 0), (0.066, 0.0), (0.1, 1.0), (0.17, 1.12), (0.27, 0.96), (0.45, 1.0)])
    c.rot("crown", yaw=9.0 * snap, roll=-5.0 * snap, pitch=2.0 * snap)
    clack = keys(t, [(0, 0), (0.07, 0.0), (0.1, 1.0), (0.16, -0.4), (0.24, 0.3), (0.45, 0.2)])
    for j in range(2):
        door(c, j, 6.0 * clack)
        jaw(c, j, -8.0 * clack + 4.0 * ramp(t, 0.2, 0.45), 2.0 * clack)
        row(c, j, 0.05 * tic(t, [0.11 + 0.02 * j], 1.0, 0.06))
    for j, nm in enumerate(PITS):
        s = keys(t, [(0, 0), (0.07, 0), (0.11, 1.0), (0.3, 0.6), (0.45, 0.45)])
        c.rot(nm, yaw=14.0 * s, pitch=-5.0 * s)
        c.scale(nm, 1.0 + 0.5 * s)
    for n in range(5):
        lag = (t - n * 2.0 / FPS)
        s = keys(lag, [(0, 0), (0.06, 0.0), (0.11, 1.0), (0.2, 1.15), (0.3, 0.9), (0.45, 1.0)])
        arm(c, n, 20.0 * s, 8.0 * s, -14.0 * s)
    return c.finish()


def _rear_pose_values(c, u, t):
    """The wind-up (u = 0..1): the face unhinges. A clench first, then the halves swing open like doors, the broken jaw drops and
    splays, the rings of fangs draw back into the throat (loading), the eyes bulge, the arms rise wide. Shared with `strike`."""
    R = REAR
    ant = keys(u, [(0, 0), (0.07, 1.0), (0.16, 0.0), (1.0, 0.0)])               # anticipation: a dip and a clench BEFORE the rise
    rise = ramp(u, 0.14, 0.8)
    c.rot("crown", pitch=5.0 * ant + R["crown_pitch"] * rise, yaw=0.0)      # it rears back but keeps its face on the prey
    c.move("crown", y=-0.28 * ant + R["crown_y"] * rise, z=R["crown_z"] * rise)
    trem = np.clip((u - 0.45) / 0.55, 0, 1) ** 1.5 * 1.3 * np.sin(2 * math.pi * 11 * t)
    c.rot("crown", roll=trem, yaw=0.8 * trem * np.sin(2 * math.pi * 3.3 * t))
    for j in range(2):
        k = keys(u, [(0, 0), (0.1, -0.06), (0.32 + 0.05 * j, 0.0), (0.62 + 0.05 * j, 1.12), (0.8 + 0.04 * j, 1.0), (1, 1.0)])
        door(c, j, R["door"][j] * k + 1.2 * trem)
        kj = keys(u, [(0, 0), (0.12, -0.1), (0.45 + 0.07 * j, 0.0), (0.66 + 0.07 * j, 1.1), (0.86 + 0.05 * j, 1.0), (1, 1.0)])
        jaw(c, j, R["jaw"][j] * kj, R["splay"][j] * kj)
        kr = keys(u, [(0, 0), (0.5, 0.0), (0.7, 1.1), (0.85, 1.0), (1, 1.0)])
        row(c, j, R["row"] * kr + 0.01 * np.sin(2 * math.pi * 17 * t) * kr)
    for j, nm in enumerate(RINGS):          # the fangs draw back into the throat: loading the spring
        k = keys(u, [(0, 0), (0.3 + 0.06 * j, 0), (0.72 + 0.04 * j, 1.1), (0.9 + 0.04 * j, 1.0), (1, 1.0)])
        c.move(nm, z=R["ring"][j] * k)
    for n in range(5):
        k = keys(u - n * 0.035, [(0, 0), (0.15, -0.15), (0.5, 0.0), (0.7, 0.7), (0.8, 1.06), (0.86, 1.0), (1.0, 1.0)])
        kw = keys(u - n * 0.035 - 0.05, [(0, 0), (0.55, 0.0), (0.7, 1.1), (0.76, 1.0), (1.0, 1.0)])
        arm(c, n, R["spread"] * k, R["lift"] * k, R["wrist"] * kw)
    for j, nm in enumerate(PITS):
        k = keys(u, [(0, 0), (0.15, -0.25), (0.6, 0.4), (0.9, 1.0), (1.0, 1.0)])
        c.scale(nm, 1.0 + (R["pit"] - 1.0) * k + 0.08 * np.clip((u - 0.5) / 0.5, 0, 1) * np.sin(2 * math.pi * (2.7 + 0.3 * j) * t))
        c.rot(nm, yaw=(6.0 - 2.0 * j) * k, pitch=-8.0 * k)              # every eye turns onto the prey
    for j, nm in enumerate(GULLETS):
        k = ramp(u, 0.3 + 0.06 * j, 0.9)
        c.scale(nm, 1.0 + (R["gullet"] - 1.0) * k, 1.0 + (R["gullet"] - 1.0) * k, 1.0)


def rear_windup():
    c = Clip("rear_windup", 0.75, "base", False, events=[("open", 0.6), ("full", 0.9)], mask=CROWN_BONES_MASK() + [r"^neck$"], phase="windup",
             note="phase-locked to the sim wind-up: the face unhinges")
    _rear_pose_values(c, c.u, c.t)
    return c.finish()


def strike():
    """0.40 s: u 0..0.4 is the sim's 0.16 s lunge (the runtime scrubs it). The rings of fangs shoot out through the open face onto the
    target, the face slams shut round them at contact (u = 0.4), the jaw snaps up, the arms sweep in; everything rings."""
    c = Clip("strike", 0.40, "base", False, events=[("contact", 0.4)], mask=CROWN_BONES_MASK(), phase="strike", snap=True,
             note="the inner jaws shoot out, the face slams shut, ring")
    t, u, R = c.t, c.u, REAR
    th = 0.16
    go = ease_in(t, 0.0, th, 2.2)
    pose0 = lambda a, b: a + (b - a) * go
    pitch = pose0(R["crown_pitch"], -26.0) + ringing(t, th, 7.5, 0.28, 7.0)
    c.rot("crown", pitch=pitch, roll=1.3 * np.sin(2 * math.pi * 11 * t) * (1 - go) + 2.5 * ringing(t, th, 9.0, 0.22))
    c.move("crown", y=pose0(R["crown_y"], -0.9) + 0.35 * ringing(t, th, 8.0, 0.3), z=pose0(R["crown_z"], -1.4) + 0.5 * ringing(t, th, 7.0, 0.3))
    # the rings: from loaded (drawn back) to thrust far out of the face at contact, then they whip back
    thrust = (1.25, 1.0, 0.75)
    for j, nm in enumerate(RINGS):
        k = np.where(t < th, ease_in(t, 0.0, th - 0.01, 1.6), 1.0)
        z = R["ring"][j] + (-thrust[2 - j] * 1.0 - R["ring"][j]) * k
        back = ramp(t, th + 0.05, 0.4)
        c.move(nm, z=z + (thrust[2 - j] * 0.75) * back + 0.12 * ringing(t, th, 9.0 + j, 0.25))
    for j in range(2):
        # the doors open a little wider for the thrust, then slam shut at contact and bounce
        wide = R["door"][j] + 6.0 * ramp(t, 0.0, 0.08)
        shut = -3.0
        a = np.where(t < th - 0.02, wide, wide + (shut - wide) * ramp(t, th - 0.02, th + 0.015))
        door(c, j, a + (5.0 + 2.0 * j) * ringing(t, th + 0.015, 8.5, 0.24))
        wj = R["jaw"][j] + (14.0 + 6 * j) * ramp(t, 0.0, 0.09)
        sj = -22.0 - 8 * j
        aj = np.where(t < th - 0.025, wj, wj + (sj - wj) * ramp(t, th - 0.025, th + 0.012))
        jaw(c, j, aj + (9.0 + 4 * j) * ringing(t, th + 0.012, 8.5, 0.24), R["splay"][j] * (1 - ramp(t, th - 0.02, th + 0.02)))
        row(c, j, R["row"] + (0.1 - R["row"]) * ramp(t, th - 0.03, th) + 0.04 * ringing(t, th, 12.0, 0.2))
    for n in range(5):
        k = ramp(t - n * 2 / FPS, 0.0, th + 0.02)
        spread = R["spread"] * (1 - k) + (-26.0) * k
        lift = R["lift"] + (46.0 - R["lift"]) * k
        arm(c, n, spread + 5.0 * ringing(t, th + n / FPS, 8.0, 0.3), lift, R["wrist"] + (-62.0 - R["wrist"]) * ramp(t - n * 2 / FPS, 0.04, th + 0.03))
    for j, nm in enumerate(PITS):
        c.scale(nm, R["pit"] + 0.25 * ramp(t, 0, th - 0.02) - 0.95 * ramp(t, th - 0.01, th + 0.07) + 0.2 * ramp(t, th + 0.07, 0.4))
        c.rot(nm, yaw=(6.0 - 2.0 * j), pitch=-8.0)
    for j, nm in enumerate(GULLETS):
        s = R["gullet"] - 0.45 * ramp(t, th - 0.02, th + 0.06) + 0.1 * ringing(t, th + 0.06, 6.0 + j, 0.3)
        c.scale(nm, s, s, 1.0)
    return c.finish()


def recoil():
    c = Clip("recoil", 0.6, "additive", False, events=[("clack", 0.08)], mask=[r"^neck$", r"^spine_(0\d|10)$", r"^portal_comb", r"^arm_"], snap=True,
             note="the shiver after a strike or a miss")
    t = c.t
    env = np.exp(-t / 0.24) * (t > 0.01)
    for k in range(11):
        w = 1.0 - 0.06 * k
        ph = k * 0.55
        c.rot("spine_%02d" % k, yaw=2.4 * w * env * np.sin(2 * math.pi * 8.5 * t + ph), roll=3.2 * w * env * np.sin(2 * math.pi * 7.0 * t + ph + 1.0))
    c.rot("neck", pitch=3.5 * env * np.sin(2 * math.pi * 6.5 * t), roll=2.0 * env * np.sin(2 * math.pi * 9.0 * t))
    for j in range(2):
        door(c, j, 4.0 * env * np.sin(2 * math.pi * (12.0 + j) * t + j))
        row(c, j, 0.04 * env * np.sin(2 * math.pi * (15.0 + j) * t))
    for n in range(5):
        fold = ramp(t - n * 2 / FPS, 0.0, 0.14) * (1 - 0.65 * ramp(t, 0.3, 0.6))
        arm(c, n, -16.0 * fold, -8.0 * fold, -10.0 * fold)
    return c.finish()


def roar_display():
    c = Clip("roar_display", 2.5, "base", False, events=[("open", 0.22), ("peak", 0.44), ("close", 0.84)], mask=CROWN_BONES_MASK() + [r"^neck$"],
             note="the face splits wide, the jaw hangs to the chest, the throat convulses, every eye rolls, the arms lift")
    t, u, D = c.t, c.u, 2.5
    op = keys(u, [(0, 0), (0.06, -0.06), (0.22, 1.1), (0.30, 1.0), (0.44, 1.0), (0.84, 0.98), (0.92, 0.1), (0.97, -0.04), (1.0, 0.0)])
    hold = ramp(u, 0.1, 0.3) * (1 - ramp(u, 0.84, 0.97))
    tremor = hold * np.sin(2 * math.pi * 7.3 * t)
    c.rot("crown", pitch=-8.0 * op + 1.0 * tremor, roll=1.4 * tremor * np.sin(2 * math.pi * 2.1 * t) + 3.0 * noise(t, 5, 0.4) * hold,
          yaw=4.0 * noise(t, 6, 0.35) * hold)
    c.move("crown", y=0.9 * op, z=0.7 * op)
    c.rot("neck", pitch=-4.0 * op)
    for j in range(2):
        k = keys(u - 0.02 * j, [(0, 0), (0.06, -0.08), (0.24, 1.1), (0.32, 1.0), (0.84, 1.0), (0.95, 0.0), (1.0, 0.0)])
        door(c, j, 26.0 * k + 2.0 * tremor)
        jaw(c, j, (24.0 + 6.0 * j) * op + 3.0 * tremor, (12.0 + 3.0 * j) * op)
        row(c, j, 0.08 * k + 0.02 * np.sin(2 * math.pi * 11 * t) * hold)
    # the throat convulses: waves of the rings pushing out and sucking back, phase-lagged down the gullet
    for j, nm in enumerate(RINGS):          # behind the face: they never pass the closed part of the split
        wave = np.sin(2 * math.pi * 1.6 * t - 1.1 * (2 - j))
        c.move(nm, z=(0.12 - 0.22 * wave) * hold * (0.6 + 0.2 * j))
        c.rot(nm, roll=6.0 * np.sin(2 * math.pi * 0.9 * t + j) * hold)
    for j, nm in enumerate(GULLETS):
        wave = 1.0 + 0.32 * np.sin(2 * math.pi * 1.6 * t - 1.1 * (3 + j)) * hold + 0.12 * op
        c.scale(nm, wave, wave, 1.0)
    for n in range(5):
        k = keys(u - 0.03 * n, [(0, 0), (0.08, -0.12), (0.3, 1.1), (0.4, 1.0), (0.84, 0.95), (0.97, 0.0), (1.0, 0.0)])
        arm(c, n, 46.0 * k + 1.5 * tremor, 36.0 * k + 3 * np.sin(2 * math.pi * (0.8 + 0.1 * n) * t) * hold,
            -48.0 * k + 8 * np.sin(2 * math.pi * 1.9 * t + n) * hold)
    eyes_rove(c, t, 16.0 * hold + 1e-6, rate=2.2, seed=7)
    for j, nm in enumerate(PITS):
        c.scale(nm, 1.0 + (0.55 * op + 0.22 * np.sin(2 * math.pi * (2.4 + 0.2 * j) * t + j) * hold))
    return c.finish()


def linger_breathe():
    c = Clip("linger_breathe", 3.0, "base", True, events=[("inhale", 0.1), ("inhale", 0.6)], mask=CROWN_BONES_MASK(),
             note="feeling the air before the lantern: the crack breathes open, the hands drift toward the light")
    t, D = c.t, 3.0
    ph = 2 * math.pi * t / D
    c.rot("crown", roll=2.2 * np.sin(ph * 1.0 + 0.4) + 0.6 * noise(t, 41, 0.33, D), pitch=3.5 + 1.2 * np.sin(ph * 2 + 1.0), yaw=2.0 * np.sin(ph + 2.0))
    c.move("crown", y=-0.12 + 0.06 * np.sin(ph * 2))
    inh = 0.5 - 0.5 * np.cos(2 * ph)
    for j in range(2):
        door(c, j, 2.0 + 5.0 * inh ** 1.5)
        jaw(c, j, 4.0 + 7.0 * inh + 1.5 * np.sin(ph * 3 + j), 2.0 * inh)
        row(c, j, 0.02 * inh)
    for n in range(5):
        a = ph - n * 0.55
        sweep = 0.5 + 0.5 * np.sin(a)
        arm(c, n, 14.0 - 26.0 * sweep, 6.0 + 16.0 * sweep + 4.0 * np.sin(2 * a), -10.0 - 16.0 * sweep + 6.0 * np.sin(a - 0.8))
    eyes_rove(c, t, 7.0, D, seed=3)
    for j, nm in enumerate(PITS):
        c.scale(nm, 1.0 + 0.3 * (0.5 - 0.5 * np.cos(2 * ph + j * 0.25)) ** 2)
    for j, nm in enumerate(GULLETS):
        s = 1.0 + 0.09 * np.sin(2 * ph - j * 0.7)
        c.scale(nm, s, s, 1.0)
    for j, nm in enumerate(RINGS):
        c.move(nm, z=-0.06 * (j + 1) * (0.5 + 0.5 * np.sin(ph + j)))
    return c.finish()


def take_close():
    c = Clip("take_close", 1.0, "base", False, events=[("dark", 0.8)], mask=CROWN_BONES_MASK(), snap=True,
             note="the hands close round the view, the face opens over it and shuts")
    t, u = c.t, c.u
    k = keys(u, [(0, 0), (0.12, -0.08), (0.55, 0.9), (0.72, 1.05), (1.0, 1.0)])
    c.rot("crown", pitch=-8.0 * k, roll=0.0)
    c.move("crown", z=-1.4 * ramp(u, 0.1, 0.8), y=-0.4 * k)
    for n in range(5):
        kk = keys(u - 0.05 * n, [(0, 0), (0.15, -0.1), (0.6, 0.95), (0.78, 1.05), (1.0, 1.0)])
        arm(c, n, -46.0 * kk + 14.0 * (1 - kk), 62.0 * kk, -70.0 * kk)
    swallow = keys(u, [(0, 0), (0.2, 0.0), (0.45, 1.0), (0.7, 1.0), (0.85, -0.1), (1.0, -0.08)])
    for j in range(2):
        door(c, j, 26.0 * swallow)
        jaw(c, j, 20.0 * swallow - (24.0 + 6 * j) * ramp(u, 0.7, 0.85), 8.0 * swallow)
    for j, nm in enumerate(RINGS):
        c.move(nm, z=-(0.6 + 0.2 * j) * keys(u, [(0, 0), (0.35, 0.0), (0.6, 1.0), (0.8, 0.3), (1.0, 0.3)]))
    for j, nm in enumerate(PITS):
        c.scale(nm, 1.0 - 0.55 * ramp(u, 0.3, 0.75))
    return c.finish()


def plate_shiver():
    c = Clip("plate_shiver", 0.5, "additive", True, mask=[r"^spine_(0\d|10)$", r"^neck$"], note="grinding stone (weight = body.jitter)")
    t, D = c.t, 0.5
    for k in range(11):
        w = 1.0 - 0.05 * k
        f1, f2 = (4, 6)[k % 2], (8, 2)[(k // 2) % 2]
        ph = k * 0.9
        a = lambda f, p: np.sin(2 * math.pi * f * t + p) - math.sin(p)
        c.rot("spine_%02d" % k, roll=1.5 * w * a(f1, ph) * 1.0 + 0.6 * a(f2, ph + 2.0), yaw=0.9 * w * a(f2, ph + 1.0))
        c.move("spine_%02d" % k, y=0.012 * w * a(f1 + 2, ph + 0.5))
    c.rot("neck", roll=0.7 * (np.sin(2 * math.pi * 8 * t) - 0.0), pitch=0.4 * np.sin(2 * math.pi * 6 * t))
    return c.finish()


def breathe_seams():
    c = Clip("breathe_seams", 5.0, "additive", True, events=[("exhale", 0.52)], mask=[r"^neck$", r"^spine_0[0-5]$", r"^gullet_", r"^portal_comb_.0$"],
             note="the column heaves, the throat swells, the crack in the face breathes")
    t, D = c.t, 5.0
    ph = 2 * math.pi * t / D
    h = lambda p: 0.5 - 0.5 * np.cos(ph + p) - (0.5 - 0.5 * math.cos(p))
    c.move("neck", y=0.035 * h(0.0))
    for k in range(6):
        c.move("spine_%02d" % k, y=0.03 * h(-0.3 * (k + 1)))
        c.rot("spine_%02d" % k, pitch=0.35 * h(-0.3 * (k + 1)) * 4)
    for j, nm in enumerate(GULLETS):
        s = 1.0 + 0.07 * h(-0.5 * j)
        c.scale(nm, s, s, 1.0)
    for j in range(2):
        door(c, j, 1.6 * h(-0.4))
    return c.finish()


def arms_flare():
    c = Clip("arms_flare", 1.0, "parametric", False, mask=[r"^arm_"], note="time = body.frondOpen x duration")
    u = c.u
    for n in range(5):
        arm(c, n, 36.0 * u, 10.0 * u, -18.0 * u)
    return c.finish()


def pit_dilate():
    c = Clip("pit_dilate", 1.0, "parametric", False, mask=[r"^pit_"], note="time = dilation x duration")
    for j, nm in enumerate(PITS):
        c.scale(nm, 1.0 + 0.5 * c.u * (0.85 + 0.3 * ((j * 5) % 7) / 6.0))
    return c.finish()


def portal_open():
    c = Clip("portal_open", 1.0, "parametric", False, events=[("clack", 1.0)], mask=[r"^portal_", r"^crown$"], note="time = opening x duration")
    u = c.u
    for j in range(2):
        door(c, j, 26.0 * u)
        jaw(c, j, (26.0 + 10 * j) * u, 8.0 * u)
        row(c, j, 0.05 * u)
    for j, nm in enumerate(RINGS):
        c.move(nm, z=0.3 * (j + 1) / 3.0 * u)
    c.rot("crown", pitch=6.0 * u)
    return c.finish()


def portal_snap():
    c = Clip("portal_snap", 0.25, "additive", False, events=[("clap", 0.48)], mask=[r"^portal_"], snap=True, note="the face slams shut")
    t = c.t
    shut = ramp(t, 0.0, 0.04)
    ring = ringing(t, 0.04, 10.0, 0.25)
    for j in range(2):
        door(c, j, -26.0 * shut + (6.0 + 2 * j) * ring)
        jaw(c, j, -(30.0 + 10 * j) * shut + (8.0 + 4 * j) * ring)
    for j, nm in enumerate(RINGS):
        c.move(nm, z=(0.3 + 0.1 * j) * shut - 0.08 * ring)
    return c.finish()


def flinch():
    c = Clip("flinch", 0.5, "additive", False, mask=[r"^crown$", r"^portal_comb", r"^arm_", r"^pit_"], snap=True, note="a hit on the crown")
    t = c.t
    k = ramp(t, 0.0, 0.07) * np.exp(-np.maximum(t - 0.07, 0) / 0.12)
    ring = ringing(t, 0.07, 7.0, 0.3)
    c.rot("crown", pitch=7.0 * k + 3.0 * ring, roll=3.5 * k)
    c.move("crown", z=0.35 * k, y=-0.1 * k)
    for j in range(2):
        door(c, j, -4.0 * k)
    for j, nm in enumerate(PITS):
        c.scale(nm, 1.0 - 0.35 * k)
    for n in range(5):
        arm(c, n, -12.0 * ramp(t - n / FPS, 0, 0.08) * np.exp(-np.maximum(t - 0.1, 0) / 0.2), 0.0, 0.0)
    return c.finish()


def retreat_fold():
    c = Clip("retreat_fold", 1.4, "additive", False, mask=[r"^neck$", r"^crown$", r"^arm_", r"^pit_", r"^portal_"], note="neck back, arms folded in, eyes shut")
    t = c.t
    k = keys(t, [(0, 0), (0.1, -0.05), (0.55, 1.05), (0.75, 1.0), (1.4, 1.0)])
    c.rot("neck", pitch=-10.0 * k)
    c.rot("crown", pitch=-14.0 * k)
    c.move("crown", z=0.9 * k, y=-0.3 * k)
    for n in range(5):
        kk = keys(t - n * 2 / FPS, [(0, 0), (0.12, -0.08), (0.55, 1.05), (0.75, 1.0), (1.4, 1.0)])
        arm(c, n, -30.0 * kk, -18.0 * kk, -55.0 * kk)
    for nm in PITS:
        c.scale(nm, 1.0 - 0.5 * k)
    for j in range(2):
        door(c, j, -3.0 * k)
        jaw(c, j, -14.0 * k)
    for j, nm in enumerate(RINGS):
        c.move(nm, z=0.25 * k)
    return c.finish()


# leg template: a lead leg on the left side (leg_L06_0..3). `chain` = rest joints (hip, knee, ankle, toe) in glTF space.
LEG_TEMPLATE = "leg_L06"


def leg_probe(chain):
    c = Clip("leg_probe", 0.8, "template", False, events=[("tap", 0.31), ("tap", 0.62)], mask=[r"^leg_"], note="two feeling taps before the foot plants")
    t = c.t
    hip, knee, ankle, toe = [np.asarray(chain[k], float) for k in ("hip", "knee", "ankle", "toe")]
    n = np.cross(knee - hip, ankle - knee)
    n /= np.linalg.norm(n) + 1e-9                                     # the bend axis of the leg
    lift = keys(t, [(0, 0), (0.08, 1.0), (0.2, 1.0), (0.3, 0.0), (0.36, 0.55), (0.5, 0.55), (0.6, 0.0), (0.66, 0.4), (0.8, 0.0)])
    tapk = lift
    c.rot(LEG_TEMPLATE + "_0", axis=n, deg=-7.0 * tapk)
    c.rot(LEG_TEMPLATE + "_1", axis=n, deg=14.0 * tapk + 3.0 * np.sin(2 * math.pi * 14 * t) * (1 - ramp(t, 0.6, 0.8)))
    c.rot(LEG_TEMPLATE + "_2", axis=n, deg=-6.0 * tapk)
    c.rot(LEG_TEMPLATE + "_3", axis=n, deg=-10.0 * tapk)
    return c.finish()


ORDER = ["crown_idle", "listen", "notice_snap", "rear_windup", "strike", "recoil", "roar_display", "linger_breathe", "take_close",
         "plate_shiver", "breathe_seams", "arms_flare", "pit_dilate", "portal_open", "portal_snap", "flinch", "retreat_fold", "leg_probe"]


def build_all(chain):
    fns = dict(crown_idle=crown_idle, listen=listen, notice_snap=notice_snap, rear_windup=rear_windup, strike=strike, recoil=recoil,
               roar_display=roar_display, linger_breathe=linger_breathe, take_close=take_close, plate_shiver=plate_shiver,
               breathe_seams=breathe_seams, arms_flare=arms_flare, pit_dilate=pit_dilate, portal_open=portal_open,
               portal_snap=portal_snap, flinch=flinch, retreat_fold=retreat_fold)
    clips = [fns[n]() for n in ORDER if n != "leg_probe"]
    clips.append(leg_probe(chain))
    return clips


# ---- motion-quality metrics (CREATURE_RIG_PLAN 4.1 gates) -------------------------------------------------------------------------
def quat_angle_deg(q0, q1):
    d = np.abs(np.sum(q0 * q1, axis=-1)).clip(0, 1)
    return np.degrees(2 * np.arccos(d))


def metrics(c):
    """Per-clip gate numbers: max angular speed (deg/s), loop wrap (deg, m), additive frame-0 delta, forbidden tracks."""
    m = dict(name=c.name, kind=c.kind, bones=len(c.bones()), maxspeed=0.0, wrap_deg=0.0, wrap_m=0.0, f0_deg=0.0, f0_m=0.0, root=False)
    for b, q in c.q.items():
        sp = quat_angle_deg(q[1:], q[:-1]) * FPS
        m["maxspeed"] = max(m["maxspeed"], float(sp.max()))
        m["wrap_deg"] = max(m["wrap_deg"], float(quat_angle_deg(q[0], q[-1])))
        m["f0_deg"] = max(m["f0_deg"], float(quat_angle_deg(q[0], np.array([0, 0, 0, 1.0]))))
    for b, p in c.p.items():
        m["wrap_m"] = max(m["wrap_m"], float(np.abs(p[0] - p[-1]).max()))
        m["f0_m"] = max(m["f0_m"], float(np.abs(p[0]).max()))
    for b, s in c.s.items():
        m["wrap_m"] = max(m["wrap_m"], float(np.abs(s[0] - s[-1]).max()))
        m["f0_m"] = max(m["f0_m"], float(np.abs(s[0] - 1).max()))
    m["root"] = any(b == "root" for b in c.bones())
    return m
