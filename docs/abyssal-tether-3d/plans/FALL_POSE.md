# The body's falling animation

> "Make a falling animation to the body" (a screenshot of the body seen from above in a fall, circled)

In free fall the body hung as when standing: the legs looped the Fall clip, but the torso stayed upright, the pack and pouches (springs driven by
acceleration, which is zero at constant speed) hung still, and on the desktop the two virtual hands stayed at the corners of the view.

`render/fallPose.js` turns the fall into a weight (`fallAmount`: 0 below 5 m/s down, complete at 20, smooth; none on the ground, in the first 0.25 s of
the air, on a line or on a hold: the hanging pose owns those) and `FallPose` eases it (in 7 /s, out 4 /s) and keeps a clock. Then:

* `BodyView` (render/bodyView.js): the pelvis swings the legs up and back (belly to the ground, wavering), the Fall clip kicks up to 2.1x faster, the
  chest is buffeted (a few hundredths of a radian, before the arms are solved so the sleeves follow), the pack and the pouches are lifted and flapped
  by the airstream (extra targets on their springs).
* Desktop: the virtual hands (the input sockets) go up and out, roll and flutter, and are put back to the resting position and aim exactly when the
  weight is gone. VR hands are the real controllers and are left alone.

Cost: a few quaternion multiplies per frame while falling, nothing otherwise; no new draw calls. Numbers in `FALL_POSE`.
Not measured on a headset; the leg swing and the flutter amplitudes are first guesses.

Tests: `tests/render/test-fall-pose.mjs`.
