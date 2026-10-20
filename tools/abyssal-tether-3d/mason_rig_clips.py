"""THE MASON RIG: the animation clips, authored in code (numpy, no bpy), 30 fps, in place, root never keyed.

Axes are glTF's, and every bone is identity-oriented at rest, so bone-local rotations are rotations about the world axes
through the bone's own pivot: +X right, +Y dorsal (up), +Z backward (tail-ward); the head faces -Z.
  yaw   about +Y: positive turns the crown to the left      pitch about +X: positive tilts the nose up
  roll  about +Z: positive tips the top of the crown to the left (outward for the left arms)
Values are DELTAS from the rest pose (degrees / kit metres / scale factors, 1 = unchanged). Base clips are absolute poses of
the crown subtree (the delta from rest); additive clips have an identity first frame (the runtime applies
AnimationUtils.makeClipAdditive); parametric clips are driven by time = value x duration; the leg template is retargeted
by renaming tracks. Animation principles as code (CREATURE_RIG_PLAN 4.1): anticipation (a dip before a rear), overshoot (a
slam rings), follow-through (arms / combs / archivolts trail by whole frames), ratcheting holds (stone, not muscle),
asymmetry (hinge_1 drops further than hinge_0, the arms never move as a ring).
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


# ---- the poses the attack clips share -------------------------------------------------------------------------------------------
REAR = dict(crown_pitch=34.0, crown_y=1.7, crown_z=0.9, hinge=(42.0, 58.0), arch=(0.30, 0.65, 1.0), comb=0.75, arm_roll=46.0,
            arm_pitch=-8.0, wrist=-28.0, pit=1.65)


def _arms_pose(c, t, roll, pitch, wrist, delay_frames=2, amp_scale=ARM_REACH):
    for n in range(5):
        r = roll(t - n * delay_frames / FPS) * amp_scale[n] if callable(roll) else roll * amp_scale[n]
        pch = pitch(t - n * delay_frames / FPS) if callable(pitch) else pitch
        w = wrist(t - (n * delay_frames + 2) / FPS) if callable(wrist) else wrist
        c.rot("arm_%d_0" % n, pitch=pch, roll=arm_out(n) * r)
        c.rot("arm_%d_1" % n, pitch=w)


# ---- the clips ---------------------------------------------------------------------------------------------------------------------
def crown_idle():
    c = Clip("crown_idle", 6.0, "base", True, mask=[r"^crown$", r"^portal_", r"^gullet_", r"^pit_", r"^arm_"], note="archivolts breathe, combs chatter, arms drift")
    t, P = c.t, 6.0
    c.rot("crown", yaw=1.6 * noise(t, 1, 0.12, P), roll=0.9 * noise(t, 2, 0.15, P), pitch=0.8 * noise(t, 3, 0.1, P))
    for j, a in enumerate(ARCHES):
        c.move(a, z=0.045 * np.sin(2 * math.pi * (t / P) + 0.8 * j))
        c.rot(a, roll=0.5 * np.sin(2 * math.pi * (t / P) + 1.3 * j))
    for i, nm in enumerate(COMBS):
        burst = np.clip(np.sin(2 * math.pi * (t / P) * 2 + i * 1.7), 0, 1) ** 3
        c.move(nm, x=comb_out(nm) * (0.02 * burst * np.sin(2 * math.pi * 6 * t / 1.0 * (1 if i % 2 else 1.5)) + tic(t, [1.3 + 1.1 * i], 0.0 if i % 2 else 0.05, 0.05) - tic(t, [1.3 + 1.1 * i + 0.14], 0.0 if i % 2 else 0.05, 0.05)))
    for n in range(5):
        c.rot("arm_%d_0" % n, roll=arm_out(n) * (3.0 + 2.5 * noise(t, 10 + n, 0.16, P)), pitch=-2.0 * noise(t, 20 + n, 0.13, P))
        c.rot("arm_%d_1" % n, pitch=-6.0 + 4.0 * noise(t, 30 + n, 0.2, P))
    for j, nm in enumerate(PITS):
        c.scale(nm, 1.0 + 0.04 * np.sin(2 * math.pi * (t / P) * 2 + j * 0.9))
    for j, nm in enumerate(GULLETS):
        s = 1.0 + 0.035 * np.sin(2 * math.pi * (t / P) - j * 0.6)
        c.scale(nm, s, 1.0, s)
    return c.finish()


def listen():
    c = Clip("listen", 3.2, "base", True, events=[("pulse", 0.125), ("pulse", 0.5), ("pulse", 0.75)], mask=CROWN_BONES_MASK(), note="ears out, held still")
    t, D = c.t, 3.2
    tilt = keys(t, [(0, 0), (0.45, 9.5), (0.7, 8.2), (1.45, 8.0), (1.9, -6.5), (2.1, -5.8), (2.85, -6.0), (3.2, 0.0)])
    c.rot("crown", roll=tilt, yaw=-0.4 * tilt + tic(t, [0.95, 2.35], 1.6, 0.05), pitch=3.0 * ramp(t, 0, 0.5) * (1 - ramp(t, 2.7, 3.2)))
    c.move("crown", y=-0.2 * ramp(t, 0, 0.6) * (1 - ramp(t, 2.6, 3.2)))
    flare = ramp(t, 0.1, 0.8) * (1 - ramp(t, 2.6, 3.2))
    tremble = 0.35 * np.sin(2 * math.pi * 9 * t) * flare
    for n in range(5):
        c.rot("arm_%d_0" % n, roll=arm_out(n) * (28.0 * ARM_REACH[n] * stagger(lambda x: ramp(x, 0.1, 0.8) * (1 - ramp(x, 2.6, 3.2)), n, 3)(t) + tremble * (1 + n % 2)), pitch=-6.0 * flare)
        c.rot("arm_%d_1" % n, pitch=-10.0 * flare)
    for j, nm in enumerate(PITS):
        pulse = sum(np.exp(-((t - tp * D) / 0.11) ** 2) for tp in (0.125, 0.5, 0.75))
        c.scale(nm, 1.0 + 0.18 * flare + 0.22 * pulse * (0.7 + 0.3 * ((j * 3) % 7) / 6.0))
    for j, nm in enumerate(ARCHES):
        c.move(nm, z=0.18 * (j + 1) * 0.5 * flare)
    for i, nm in enumerate(COMBS):
        c.move(nm, x=comb_out(nm) * 0.22 * flare)
    for j, nm in enumerate(GULLETS):
        c.scale(nm, 1.0 + 0.05 * flare, 1.0, 1.0 + 0.05 * flare)
    return c.finish()


def CROWN_BONES_MASK():
    return [r"^crown$", r"^portal_", r"^gullet_", r"^pit_", r"^arm_"]


def notice_snap():
    c = Clip("notice_snap", 0.45, "base", False, events=[("snap", 0.22)], mask=CROWN_BONES_MASK(), snap=True, note="the head snaps to the sound")
    t = c.t
    snap = keys(t, [(0, 0), (0.066, 0.0), (0.1, 1.0), (0.17, 1.12), (0.27, 0.96), (0.45, 1.0)])
    c.rot("crown", yaw=9.0 * snap, roll=-5.0 * snap, pitch=2.0 * snap)
    for n in range(5):
        lag = (t - n * 2.0 / FPS)
        s = keys(lag, [(0, 0), (0.06, 0.0), (0.11, 1.0), (0.2, 1.15), (0.3, 0.9), (0.45, 1.0)])
        c.rot("arm_%d_0" % n, roll=arm_out(n) * 24.0 * ARM_REACH[n] * s, pitch=-5.0 * s)
        c.rot("arm_%d_1" % n, pitch=-12.0 * s)
    for j, nm in enumerate(PITS):
        s = keys(t, [(0, 0), (0.07, 0), (0.12, 1.0), (0.3, 0.55), (0.45, 0.4)])
        c.scale(nm, 1.0 + 0.5 * s)
    for i, nm in enumerate(COMBS):
        c.move(nm, x=comb_out(nm) * (0.28 * (tic(t, [0.12 + i * 0.02], 1.0, 0.06) + 0.35 * ramp(t, 0.1, 0.45))))
    return c.finish()


def _rear_pose_values(c, u, t):
    """The wind-up pose function (u = 0..1); shared with `strike` as its first frame."""
    R = REAR
    ant = keys(u, [(0, 0), (0.07, 1.0), (0.16, 0.0), (1.0, 0.0)])               # anticipation: a dip BEFORE the rise
    rise = ramp(u, 0.14, 0.8)
    c.rot("crown", pitch=-7.0 * ant + R["crown_pitch"] * rise, yaw=0.0)
    c.move("crown", y=-0.28 * ant + R["crown_y"] * rise, z=R["crown_z"] * rise)
    trem = np.clip((u - 0.45) / 0.55, 0, 1) ** 1.5 * 1.3 * np.sin(2 * math.pi * 11 * t)
    c.rot("crown", roll=trem, yaw=0.8 * trem * np.sin(2 * math.pi * 3.3 * t))
    for j, nm in enumerate(ARCHES[::-1]):          # the outermost order slides back first: a telescope
        k = ramp(u, 0.3 + 0.06 * j, 0.72 + 0.04 * j)
        c.move(ARCHES[2 - j], z=R["arch"][2 - j] * keys(u, [(0, 0), (0.3 + 0.06 * j, 0), (0.72 + 0.04 * j, 1.1), (0.9 + 0.04 * j, 1.0), (1, 1.0)]))
    for i, nm in enumerate(COMBS):
        k = keys(u, [(0, 0), (0.45 + 0.03 * i, 0.0), (0.62 + 0.03 * i, 1.12), (0.78 + 0.03 * i, 1.0), (1, 1.0)])
        c.move(nm, x=comb_out(nm) * R["comb"] * k, z=0.12 * k)
    for j, nm in enumerate(HINGES):                # asymmetric: the second hinge drops further and later
        k = keys(u, [(0, 0), (0.12, -0.08), (0.5 + 0.07 * j, 0.0), (0.66 + 0.07 * j, 1.1), (0.86 + 0.05 * j, 1.0), (1, 1.0)])
        c.rot(nm, pitch=R["hinge"][j] * k)
    for n in range(5):
        k = keys(u - n * 0.035, [(0, 0), (0.15, -0.15), (0.5, 0.0), (0.7, 0.7), (0.8, 1.06), (0.86, 1.0), (1.0, 1.0)])
        c.rot("arm_%d_0" % n, roll=arm_out(n) * R["arm_roll"] * ARM_REACH[n] * k, pitch=R["arm_pitch"] * k)
        kw = keys(u - n * 0.035 - 0.05, [(0, 0), (0.55, 0.0), (0.7, 1.1), (0.76, 1.0), (1.0, 1.0)])
        c.rot("arm_%d_1" % n, pitch=R["wrist"] * kw)
    for j, nm in enumerate(PITS):
        k = keys(u, [(0, 0), (0.15, -0.2), (0.6, 0.4), (0.9, 1.0), (1.0, 1.0)])
        c.scale(nm, 1.0 + (R["pit"] - 1.0) * k + 0.08 * np.clip((u - 0.5) / 0.5, 0, 1) * np.sin(2 * math.pi * (2.7 + 0.3 * j) * t))
    for j, nm in enumerate(GULLETS):
        k = ramp(u, 0.3 + 0.06 * j, 0.9)
        c.scale(nm, 1.0 + 0.2 * k, 1.0, 1.0 + 0.2 * k)


def rear_windup():
    c = Clip("rear_windup", 0.75, "base", False, events=[("open", 0.6), ("full", 0.9)], mask=CROWN_BONES_MASK() + [r"^neck$"], phase="windup", note="phase-locked to the sim wind-up")
    _rear_pose_values(c, c.u, c.t)
    return c.finish()


def strike():
    """0.40 s: u 0..0.4 is the sim's 0.16 s lunge (the runtime scrubs it); the portal slams shut at contact (u = 0.4)."""
    c = Clip("strike", 0.40, "base", False, events=[("contact", 0.4)], mask=CROWN_BONES_MASK(), phase="strike", snap=True, note="thrust, slam at contact, ring")
    t, u, R = c.t, c.u, REAR
    th = 0.16                                                         # contact time
    go = ease_in(t, 0.0, th, 2.2)                                      # accelerating into the lunge
    pose0 = lambda a, b: a + (b - a) * go
    # the crown dives from the rear pose onto the target and rebounds
    pitch = pose0(R["crown_pitch"], -22.0) + ringing(t, th, 7.5, 0.28, 7.0)
    c.rot("crown", pitch=pitch, roll=1.3 * np.sin(2 * math.pi * 11 * t) * (1 - go) + 2.5 * ringing(t, th, 9.0, 0.22))
    c.move("crown", y=pose0(R["crown_y"], -0.9) + 0.35 * ringing(t, th, 8.0, 0.3), z=pose0(R["crown_z"], -1.4) + 0.5 * ringing(t, th, 7.0, 0.3))
    # the portal: first drops WIDER (the mouth takes the player in), then slams shut at contact and bounces
    for j, nm in enumerate(HINGES):
        wide = R["hinge"][j] + (22.0 + 10 * j) * ramp(t, 0.0, 0.09)
        shut = -16.0 - 6 * j
        a = np.where(t < th - 0.025, wide, wide + (shut - wide) * ramp(t, th - 0.025, th + 0.012))
        c.rot(nm, pitch=a + (11.0 + 5 * j) * ringing(t, th + 0.012, 8.5, 0.24))
    for j, nm in enumerate(ARCHES):
        back = R["arch"][j]
        fwd = -0.22 * (j + 1) / 3.0
        a = np.where(t < th - 0.03, back + (back * 1.15 - back) * ramp(t, 0, 0.06), back * 1.15 + (fwd - back * 1.15) * ramp(t, th - 0.03, th + 0.015))
        c.move(nm, z=a + 0.12 * ringing(t, th + 0.015, 9.0, 0.25))
    for i, nm in enumerate(COMBS):
        ext = R["comb"] + (-0.35 - R["comb"]) * ramp(t, th - 0.03, th + 0.012)
        c.move(nm, x=comb_out(nm) * (ext + 0.1 * ringing(t, th + 0.012, 12.0, 0.2)), z=0.12)
    # the arms sweep in (an embrace) and close
    for n in range(5):
        k = ramp(t - n * 2 / FPS, 0.0, th + 0.02)
        roll = R["arm_roll"] * ARM_REACH[n] * (1 - k) + (-26.0) * ARM_REACH[n] * k
        c.rot("arm_%d_0" % n, roll=arm_out(n) * (roll + 5.0 * ringing(t, th + 2 * n / FPS / 2, 8.0, 0.3)), pitch=R["arm_pitch"] + (-48.0 - R["arm_pitch"]) * k)
        c.rot("arm_%d_1" % n, pitch=R["wrist"] + (-60.0 - R["wrist"]) * ramp(t - n * 2 / FPS, 0.04, th + 0.03))
    for j, nm in enumerate(PITS):
        c.scale(nm, R["pit"] + 0.25 * ramp(t, 0, th - 0.02) - 0.95 * ramp(t, th - 0.01, th + 0.07) + 0.2 * ramp(t, th + 0.07, 0.4))
    for j, nm in enumerate(GULLETS):
        c.scale(nm, 1.2 - 0.3 * ramp(t, th - 0.02, th + 0.06), 1.0, 1.2 - 0.3 * ramp(t, th - 0.02, th + 0.06))
    # the first frame must equal the last frame of rear_windup (continuity of the phase lock): the formulas above start at REAR
    return c.finish()


def recoil():
    c = Clip("recoil", 0.6, "additive", False, events=[("clack", 0.08)], mask=[r"^neck$", r"^spine_(0\d|10)$", r"^portal_comb", r"^arm_"], snap=True, note="the shiver after a strike or a miss")
    t = c.t
    env = np.exp(-t / 0.24) * (t > 0.01)
    for k in range(11):
        w = 1.0 - 0.06 * k
        ph = k * 0.55
        c.rot("spine_%02d" % k, yaw=2.4 * w * env * np.sin(2 * math.pi * 8.5 * t + ph), roll=3.2 * w * env * np.sin(2 * math.pi * 7.0 * t + ph + 1.0))
    c.rot("neck", pitch=3.5 * env * np.sin(2 * math.pi * 6.5 * t), roll=2.0 * env * np.sin(2 * math.pi * 9.0 * t))
    for i, nm in enumerate(COMBS):
        c.move(nm, x=comb_out(nm) * 0.16 * env * np.sin(2 * math.pi * (12.0 + i) * t + i))
    for n in range(5):
        fold = ramp(t - n * 2 / FPS, 0.0, 0.14) * (1 - 0.65 * ramp(t, 0.3, 0.6))
        c.rot("arm_%d_0" % n, roll=-arm_out(n) * 16.0 * fold, pitch=8.0 * fold)
    return c.finish()


def roar_display():
    c = Clip("roar_display", 2.5, "base", False, events=[("open", 0.22), ("peak", 0.44), ("close", 0.84)], mask=CROWN_BONES_MASK() + [r"^neck$"], note="the crown raised, the portal wide, the arms offering")
    t, u, D = c.t, c.u, 2.5
    op = keys(u, [(0, 0), (0.06, -0.06), (0.22, 1.1), (0.30, 1.0), (0.44, 1.0), (0.84, 0.98), (0.92, 0.1), (0.97, -0.04), (1.0, 0.0)])
    hold = ramp(u, 0.1, 0.3) * (1 - ramp(u, 0.84, 0.97))
    tremor = hold * np.sin(2 * math.pi * 7.3 * t)
    c.rot("crown", pitch=30.0 * op + 1.0 * tremor, roll=1.4 * tremor * np.sin(2 * math.pi * 2.1 * t) + 3.0 * noise(t, 5, 0.4) * hold, yaw=4.0 * noise(t, 6, 0.35) * hold)
    c.move("crown", y=1.4 * op, z=0.7 * op)
    c.rot("neck", pitch=-4.0 * op)
    for j, nm in enumerate(HINGES):
        c.rot(nm, pitch=(66.0 + 10 * j) * op + 2.5 * tremor)
    for j, nm in enumerate(ARCHES):
        k = keys(u - 0.025 * (2 - j), [(0, 0), (0.06, -0.05), (0.25, 1.08), (0.32, 1.0), (0.84, 1.0), (0.97, 0.0), (1.0, 0.0)])
        c.move(nm, z=(1.3, 0.85, 0.5)[j] * k)
    for i, nm in enumerate(COMBS):
        k = keys(u - 0.02 * i, [(0, 0), (0.22, 1.15), (0.3, 1.0), (0.84, 1.0), (0.95, 0.0), (1.0, 0.0)])
        c.move(nm, x=comb_out(nm) * 0.85 * k + 0.0)
    for n in range(5):
        k = keys(u - 0.03 * n, [(0, 0), (0.08, -0.12), (0.3, 1.1), (0.4, 1.0), (0.84, 0.95), (0.97, 0.0), (1.0, 0.0)])
        c.rot("arm_%d_0" % n, roll=arm_out(n) * 58.0 * ARM_REACH[n] * k + 1.5 * tremor, pitch=-32.0 * k + 3 * np.sin(2 * math.pi * (0.8 + 0.1 * n) * t) * hold)
        c.rot("arm_%d_1" % n, pitch=-52.0 * k + 5 * np.sin(2 * math.pi * 1.9 * t + n) * hold)
    for j, nm in enumerate(PITS):
        flare = 1.0 + (0.55 * op + 0.22 * np.sin(2 * math.pi * (2.4 + 0.2 * j) * t + j) * hold)
        c.scale(nm, flare)
    for j, nm in enumerate(GULLETS):
        wave = 1.0 + 0.2 * np.sin(2 * math.pi * 2.5 * t - j * 1.1) * hold + 0.1 * op
        c.scale(nm, wave, 1.0, wave)
    return c.finish()


def linger_breathe():
    c = Clip("linger_breathe", 3.0, "base", True, events=[("inhale", 0.1), ("inhale", 0.6)], mask=CROWN_BONES_MASK(), note="feeling the air before the lantern")
    t, D = c.t, 3.0
    ph = 2 * math.pi * t / D
    c.rot("crown", roll=2.2 * np.sin(ph * 1.0 + 0.4) + 0.6 * noise(t, 41, 0.33, D), pitch=3.5 + 1.2 * np.sin(ph * 2 + 1.0), yaw=2.0 * np.sin(ph + 2.0))
    c.move("crown", y=-0.12 + 0.06 * np.sin(ph * 2))
    for n in range(5):
        a = ph - n * 0.55
        sweep = 0.5 + 0.5 * np.sin(a)
        c.rot("arm_%d_0" % n, roll=arm_out(n) * (16.0 - 26.0 * sweep) * ARM_REACH[n], pitch=-18.0 - 22.0 * sweep + 4.0 * np.sin(2 * a))
        c.rot("arm_%d_1" % n, pitch=-18.0 - 14.0 * sweep + 6.0 * np.sin(a - 0.8))
    for j, nm in enumerate(PITS):
        inh = 0.5 - 0.5 * np.cos(2 * math.pi * (t / D) * 2 + j * 0.25)      # two inhales per loop
        c.scale(nm, 1.0 + 0.4 * inh ** 2)
    for j, nm in enumerate(GULLETS):
        s = 1.0 + 0.09 * np.sin(2 * ph - j * 0.7)
        c.scale(nm, s, 1.0, s)
    for j, nm in enumerate(ARCHES):
        c.move(nm, z=0.07 * (j + 1) * (0.5 + 0.5 * np.sin(ph + j)) + 0.1 * (j + 1) * 0.3)
    for i, nm in enumerate(COMBS):
        c.move(nm, x=comb_out(nm) * 0.1 * (0.5 + 0.5 * np.sin(ph * 2 + i)))
    return c.finish()


def take_close():
    c = Clip("take_close", 1.0, "base", False, events=[("dark", 0.8)], mask=CROWN_BONES_MASK(), snap=True, note="the arms close round the view, the portal shuts")
    t, u = c.t, c.u
    k = keys(u, [(0, 0), (0.12, -0.08), (0.55, 0.9), (0.72, 1.05), (1.0, 1.0)])
    c.rot("crown", pitch=-8.0 * k, roll=0.0)
    c.move("crown", z=-1.4 * ramp(u, 0.1, 0.8), y=-0.4 * k)
    for n in range(5):
        kk = keys(u - 0.05 * n, [(0, 0), (0.15, -0.1), (0.6, 0.95), (0.78, 1.05), (1.0, 1.0)])
        if n == 2:
            c.rot("arm_2_0", roll=arm_out(2) * -42.0 * kk, pitch=-78.0 * kk)
        else:
            c.rot("arm_%d_0" % n, roll=arm_out(n) * (-46.0 * kk + 18.0 * (1 - kk)) * ARM_REACH[n], pitch=-35.0 * kk)
        c.rot("arm_%d_1" % n, pitch=-70.0 * kk)
    for j, nm in enumerate(HINGES):
        c.rot(nm, pitch=-(22.0 + 4 * j) * keys(u, [(0, 0), (0.25, 0.6), (0.4, 1.1), (0.55, 1.0), (1, 1)]))
    for j, nm in enumerate(ARCHES):
        c.move(nm, z=-(0.35 + 0.15 * j) * ramp(u, 0.1 + 0.05 * (2 - j), 0.55))
    for i, nm in enumerate(COMBS):
        c.move(nm, x=-comb_out(nm) * 0.3 * ramp(u, 0.2, 0.6))
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
    c = Clip("breathe_seams", 5.0, "additive", True, events=[("exhale", 0.52)], mask=[r"^neck$", r"^spine_0[0-5]$", r"^gullet_"], note="the column heaves, the throat swells")
    t, D = c.t, 5.0
    ph = 2 * math.pi * t / D
    h = lambda p: 0.5 - 0.5 * np.cos(ph + p) - (0.5 - 0.5 * math.cos(p))
    c.move("neck", y=0.035 * h(0.0))
    for k in range(6):
        c.move("spine_%02d" % k, y=0.03 * h(-0.3 * (k + 1)))
        c.rot("spine_%02d" % k, pitch=0.35 * h(-0.3 * (k + 1)) * 4)
    for j, nm in enumerate(GULLETS):
        s = 1.0 + 0.07 * h(-0.5 * j)
        c.scale(nm, s, 1.0, s)
    return c.finish()


def arms_flare():
    c = Clip("arms_flare", 1.0, "parametric", False, mask=[r"^arm_"], note="time = body.frondOpen x duration")
    u = c.u
    for n in range(5):
        c.rot("arm_%d_0" % n, roll=arm_out(n) * 36.0 * ARM_REACH[n] * u, pitch=-8.0 * u)
        c.rot("arm_%d_1" % n, pitch=-16.0 * u)
    return c.finish()


def pit_dilate():
    c = Clip("pit_dilate", 1.0, "parametric", False, mask=[r"^pit_"], note="time = dilation x duration")
    for j, nm in enumerate(PITS):
        c.scale(nm, 1.0 + 0.55 * c.u * (0.85 + 0.3 * ((j * 5) % 7) / 6.0))
    return c.finish()


def portal_open():
    c = Clip("portal_open", 1.0, "parametric", False, events=[("clack", 1.0)], mask=[r"^portal_", r"^crown$"], note="time = opening x duration")
    u = c.u
    for j, nm in enumerate(ARCHES):
        c.move(nm, z=0.5 * (j + 1) / 3.0 * u * 1.4)
    for nm in COMBS:
        c.move(nm, x=comb_out(nm) * 0.55 * u)
    for j, nm in enumerate(HINGES):
        c.rot(nm, pitch=(30.0 + 12 * j) * u)
    c.rot("crown", pitch=6.0 * u)
    return c.finish()


def portal_snap():
    c = Clip("portal_snap", 0.25, "additive", False, events=[("clap", 0.48)], mask=[r"^portal_"], snap=True, note="the portal slams shut")
    t = c.t
    shut = ramp(t, 0.0, 0.04)
    ring = ringing(t, 0.04, 10.0, 0.25)
    for j, nm in enumerate(HINGES):
        c.rot(nm, pitch=-(34.0 + 10 * j) * shut + (9.0 + 4 * j) * ring)
    for j, nm in enumerate(ARCHES):
        c.move(nm, z=-(0.55 + 0.2 * j) * shut + 0.1 * ring)
    for nm in COMBS:
        c.move(nm, x=-comb_out(nm) * 0.5 * shut)
    return c.finish()


def flinch():
    c = Clip("flinch", 0.5, "additive", False, mask=[r"^crown$", r"^portal_comb", r"^arm_"], snap=True, note="a hit on the crown")
    t = c.t
    k = ramp(t, 0.0, 0.07) * np.exp(-np.maximum(t - 0.07, 0) / 0.12)
    ring = ringing(t, 0.07, 7.0, 0.3)
    c.rot("crown", pitch=7.0 * k + 3.0 * ring, roll=3.5 * k)
    c.move("crown", z=0.35 * k, y=-0.1 * k)
    for i, nm in enumerate(COMBS):
        c.move(nm, x=-comb_out(nm) * 0.2 * k)
    for n in range(5):
        c.rot("arm_%d_0" % n, roll=-arm_out(n) * 12.0 * ramp(t - n / FPS, 0, 0.08) * np.exp(-np.maximum(t - 0.1, 0) / 0.2))
    return c.finish()


def retreat_fold():
    c = Clip("retreat_fold", 1.4, "additive", False, mask=[r"^neck$", r"^crown$", r"^arm_", r"^pit_", r"^portal_"], note="neck back, arms folded flat, pits shut")
    t = c.t
    k = keys(t, [(0, 0), (0.1, -0.05), (0.55, 1.05), (0.75, 1.0), (1.4, 1.0)])
    c.rot("neck", pitch=-10.0 * k)
    c.rot("crown", pitch=-14.0 * k)
    c.move("crown", z=0.9 * k, y=-0.3 * k)
    for n in range(5):
        kk = keys(t - n * 2 / FPS, [(0, 0), (0.12, -0.08), (0.55, 1.05), (0.75, 1.0), (1.4, 1.0)])
        c.rot("arm_%d_0" % n, roll=-arm_out(n) * 34.0 * kk, pitch=22.0 * kk)
        c.rot("arm_%d_1" % n, pitch=-62.0 * kk)
    for nm in PITS:
        c.scale(nm, 1.0 - 0.5 * k)
    for j, nm in enumerate(HINGES):
        c.rot(nm, pitch=-18.0 * k)
    for j, nm in enumerate(ARCHES):
        c.move(nm, z=-0.2 * k)
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
