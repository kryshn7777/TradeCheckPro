# THE LANTERN: the opening cinematic

> **Superseded in part (2026-11-06) by [OPENING_V2_THE_COLLAR.md](OPENING_V2_THE_COLLAR.md):** shots 1-4 (the lantern alone on a
> chain) are replaced by THE COLLAR (the station, the four hoist drones, the cradle's descent, Lamp Zero, the release); shots 5-9 are
> re-aimed and act III (the knock, the well, the title, the waking) is this film's, moved +15.5 s. The engine, the skip, the settings,
> the hand-off and the rules below still hold; the shot table, the cue sheet and the narration of this file are the first film's.

> Owner (2026-11-05): *"Remove the cutscene at the starting and add a proper one. ... The opening cutscene of lantern must be of
> supreme quality. Also add detailed sfx, no random ones."*

This replaces the old opening (a typed codex page over black, `sim/prologue3d.js` + `render/prologueView.js`, OPENING_STORY.md).
The page told the story; this one **shows** it, in the engine, in the real Threshold, with the lantern as the hero.

## 0. Why real-time, in-engine (and where the video lives)

A pre-rendered film is the wrong tool for a headset: it is a flat rectangle in VR, ignores the head, and a 90 s 1080p film is
30-60 MB against the 80 MiB precache cap. Remotion / HyperFrames make 2D title cards; Veo / Kling / Runway need external keys we do
not have. What we do have is the whole engine, the real level, the real lantern, the real Mason rig, a procedural audio engine and a
local Kokoro voice pipeline. So the opening is an **authored real-time cinematic**: a pure timeline (`sim/openingCinematic.js`)
applied to the live scene (`render/openingView.js`), scored and foleyed by a deterministic cue sheet (`audio/openingSfx.js`), voiced
by Kokoro. The **video** is a by-product: `tools/abyssal-tether-3d/release/render-opening.mjs` steps the same timeline frame by
frame in a headless page and encodes an H.264 MP4 (with the score rendered offline through the same audio code) for the store.

## 1. Logline and arc

**Logline.** A flame that has never gone out is going out. A lantern lit from it is lowered, alone, into the shaft it came from, and
something that was down there before the light is waiting for it to come back.

**Arc (84 s, skippable at any moment):** *wonder* (the flame, the history) -> *awe* (the descent, the window, the colossus) ->
*unease* (the Threshold, the carved rule) -> *dread* (three knocks, the flame leans, eyes in the well) -> *black* -> **THE
LANTERN** -> *the waking* (first person, the lamp flares, your lantern catches, you have control).

The canon rule this serves: the game's first frame is a waking (CHAPTERS.md §5.1 P1). The film ends exactly there. It never says
*restore*, *copy*, *Continuity*, names nothing below the Threshold, and never explains the Mason (DARK_STORY_BIBLE §1.1, §1.7).
The one quiet lie, for the second playthrough: we watch a lantern lowered on a chain, **and nobody is holding it**.

## 2. The hero object

The lantern is the key light of every shot. It is the gauntlet lantern's real model (`player_arms.glb` `Lantern`, 1176 tris) at
2.6x, a procedural flame (one additive lathe, its lean and gutter driven by the timeline), a soft halo (one sprite: it reads as a
star 30 m away in the dark) and, most of all, **the game's own lantern light** (`Renderer3D.lanternGroup`, the same PointLight and
shadow that light the whole game) re-parented onto it for the length of the film and handed back to your gauntlet at the end. It
hangs on a procedural chain (one instanced mesh, <= 120 links, 5.8 k tris) that pays out from the dark above. Every other light in
the chimney is held low until the waking, so the lantern sculpts the stone, the statues and the plaque as it passes them.

## 3. Shot list (desktop: the full choreographed camera)

S1 geography (level-data-3d.js): a 22 x 22 m chimney (x, z in -11..11) from y -6 to 60; the Threshold ledge (x -11..3, z 4..11,
top y 0) under a carved arch on the south wall; two robed Lanternwright statues flanking it; the plaque over the spawn; the girder
(y 7.4) and the first ring; the east window (x 11, z -6..6, y 8..30) onto the Outer Dark and a colossal arch 75 m out; the well and
the pocket beyond the lip. Spawn (-4, 0.4, 8.5), yaw 0 (looking -Z). Times are seconds from the start; lens = vertical FOV.

| # | Shot | Time | Camera (move, lens) | In frame / light | Sound | Text / VO |
|---|---|---|---|---|---|---|
| 1 | **EMBER** | 0.0-9.0 | Extreme close-up, 0.55 -> 0.42 m from the flame, a slow push-in and a 6 deg drift round it; 24 deg (long lens: shallow, intimate) | Only the lantern: the flame, the glass, the brass catching its own light; total black beyond. Fade up from black 0.4-3.6 s | Room tone of a vast space (very low brown-noise wind), the flame's breath (soft band-passed crackle, a fixed pattern), the **Lamp motif** (five notes on bowed metal) enters at 4.0 | MAREN 2.6: *"Seventeen ninety-one. One woman climbed out of this shaft, carrying a flame."* |
| 2 | **THE LIGHT WE KEPT** | 9.0-17.5 | Slow arc 40 deg round the lantern at 1.3 m, rising 0.4 m to reveal the chain going up into the dark; 32 deg | The chain, the first carved stone the light reaches. At 14.6 the flame **gutters**: it shrinks, the light dips 45 %, recovers to 70 % | The drone settles; the gutter is a breathy dip with a flutter; the motif's last note bends down a semitone | MAREN 9.6: *"It burned nothing. It never went out. Every lamp we have was lit from hers."* ODESSA 15.0: *"It is dimming."* |
| 3 | **THE LOWERING** (rev. 2) | 17.5-28.0 | High in the shaft on the open side of the chain (2 m off it), looking down it into the south-west corner; a crane down 7 m (y 52.9 -> 45.9) that orbits 25 deg round the chain, the lens tightening 46 -> 36 deg (a slow vertigo); pitch -60 -> -85 deg | The lantern falls away from the lens (3.4 -> 23 m): the two corner walls converge on it and its pool slides down them (the only light: the shafts, the baked light and the fill are held off); the chain is the leading line into the dark, a slow wave running up it from the weight; **grit** (mortar shaken loose by the chain) falls past it through its light; at 26.6 it **grazes the great girder** (y 26, 0.9 m from the chain's line), the iron lit for a beat | The winch eases in (the weight is taken first: 0.2 m/s at the cut), the chain links paying out, a ratchet every 8th; **the girder sings** (26.05: inharmonic iron partials swelling to the pass, a breath of air) | ODESSA 18.6: *"Five hundred and fifty-six metres of cut stone. Every probe we lowered went quiet at the bottom."* ODESSA 25.4: *"So we are lowering a person."* |
| 4 | **THE WINDOW** | 28.0-38.0 | Inside the chimney by the west wall (x -8.5), level with the lantern, a slow lateral dolly south 5 m as it sinks past the east window; 38 deg | **The wonder shot.** The lantern in silhouette against the cold Outer Dark; the colossal arch 75 m out in the haze; the cold window light and the god rays come up (they were held down until now) | No VO. The score opens: a cold high cluster over the drone, the motif's second statement, fuller; the chain clinks keep time under it | (none) |
| 5 | **THE THRESHOLD** | 38.0-48.0 | Low on the Threshold floor, looking up past a statue's raised lantern as our lantern comes down beside it; then a slow push to the plaque; 34 -> 30 deg | The statue sculpted by the passing key light (face in shadow under the hood, the raised stone lantern lit); the carved arch; the plaque *HERE THE DESCENT BEGINS. TRUST THE RING, NOT THE FLOOR. THE FLOOR KEEPS.* lit and readable | The chain slows and stops with a heavy clank (39.6), dust trickles off the arch; silence opens under the music | MAREN 40.6: *"They carved one rule over the door."* MAREN 44.2: *"Trust the ring, not the floor. The floor keeps."* |
| 6 | **THE KNOCK** | 48.0-56.5 | Medium on the still lantern over the lip, a slow push-in to a close-up of the flame; 30 -> 22 deg | The lantern hangs dead still. **Three slow knocks** from inside the wall (48.7, 49.5, 50.3). On the third, the flame **leans**: toward the well, toward what is below | The music drops out on the first knock. The knocks are dry, huge, with the chimney's long reverb; a low heartbeat (2 per 1.4 s) begins | MAREN 51.4, hushed: *"The record says something was down here before the lamp."* |
| 7 | **BEFORE THE LAMP** | 56.5-66.0 | Over the lantern's shoulder, looking down past the lip into the well, a slow creep forward; 40 deg | Black below. At 59.2 two **red points** ignite 22 m down; the crown of raised stone arms catches the lantern's light; it rises, slowly, then at 64.2 it **lunges** up the shaft at the lens | Plates grinding far below, a slow wet breath that is too big; the heartbeat quickens; a rising sub; at 64.2 the lunge roar | MAREN 57.4: *"Before the first stone was cut. Something we never prepared for."* MAREN 62.4: *"We confronted it, but"* (the line is **cut** mid-breath by static, 64.0) |
| 8 | **THE LANTERN** | 66.0-76.0 | Black (the lantern went out at 64.6). The title is a world-locked plate 6 m ahead | 1.3 s of total black and silence. **67.3: the title lands**, *THE LANTERN*, ember gold, its letters lit from inside like a flame behind glass; a thin rule and *I · THE UNDERSPIRE* under it; it breathes for 6 s, then embers out 73.6-75.6 | **The one big hit** at 67.3: a match-strike transient, a sub drop 62 -> 26 Hz, a struck bell (inharmonic partials, 7 s tail), the motif's root held as a drone under the title | (title) |
| 9 | **THE WAKING** | 76.0-84.0 | **First person, at the spawn**: the eye at the spawn's eye height, looking down at the gauntlet (pitch -0.42) and rising to the spawn's look (pitch 0, yaw 0) by 83.0; 70 deg (the game's own lens) | Black. 77.4 the Threshold lamp **flares**; 78.6 **your lantern catches** (the game's lantern light ramps 0 -> 1 on your gauntlet); the fade lifts 78.0-82.5; the chimney's own lights return | A gas whoomp (the lamp), a small ignite (your lantern), **a drawn breath** (77.9), cloth and a gauntlet creak as the head comes up (80.2), two heartbeats, the game's ambience fades in | (none: the game's first radio line follows the hand-off) |

**The hand-off.** At 84.0 the timeline's camera *is* the game's spawn view (position, yaw, pitch 0, FOV 70, fade 0, lantern at
full): the state turns to `playing`, the first section is entered (title card, Vesper's *Restore complete*), and nothing moves. The
tests check the last frame equals the spawn pose to the millimetre.

## 4. Lighting and lens

- **Exposure:** the chimney's lamps, the window light and the god rays are held (`lights` 0.08-0.15) through shots 1-3, so the
  lantern is the only key; shot 4 brings the cold up (the wonder), shot 5 lets the Threshold lamp pool warm the statues a little,
  shots 6-7 pull everything down again (to 0.05), shot 8 is black, shot 9 brings the world back to 1.0 by the hand-off.
- **Depth:** fog is the depth of field. The lantern's halo and the Outer Dark's haze give the separation; long lenses (22-34 deg)
  on the close shots compress the stone behind the lantern, the wide 50 deg on the lowering makes the shaft vast.
- **Motion:** every move is an eased curve (smootherstep in and out, never linear); the only cuts are on a beat or through black.
  A letterbox (2.39:1) on desktop for shots 1-8, opening up to the full frame through the waking.

## 5. VR comfort (the camera never moves the player's head)

- **No rotation the player did not make, ever.** The rig's yaw stays the spawn yaw for the whole film; head tracking is always live.
- **Two vantages, both static, changed only through black.** Shots 1-2: you float in the dark at the top of the chimney with the
  lantern hanging 0.9 m in front of your eyes (world-locked; you can lean in and look round it). The cut to the Threshold happens
  in a 1.2 s fade through black (17.0-18.2). Shots 3-9: you stand on the Threshold at the spawn (the place you will play from); the
  lantern comes down to you out of the dark above, past the window, to hang over the lip in front of you; the knocks come from the
  wall behind your left shoulder (HRTF); the eyes are in the well in front and below; the title is a world-locked plate 6 m ahead.
- **No forced translation either:** the rig does not dolly. The world animates around you.
- **Seated / standing:** the vantage is an offset of the head over the floor, so a seated player's eyes are as high above the
  Threshold as they are above their own floor (the game's height calibration). The top vantage has no floor under it (black), and
  the lantern is placed at the head's own height + 0.05 m, so nobody looks down into a drop.
- No letterbox, no camera shake, no flash in a headset; reduced effects removes the shake and the flash on desktop too.

## 6. Skip and settings

- **Desktop:** Esc skips at once. Holding any mouse button or Space / Enter for 1 s fills a ring in the corner and skips.
- **VR:** hold both triggers (or B) for 1 s: a small ring fills below the line of sight, then it skips.
- A skip jumps to the last 2 s of the waking (your lantern catching, the fade lifting) so the hand-off is never a pop.
- **Settings > Display > Opening cinematic** (`openingCinematic`, on by default) replaces *Story intro*; a player who had turned
  Story intro off keeps it off (config3d.js loadSettings migrates `storyIntro: false`). `?intro=off` still skips it (tests,
  captures). It plays only for a descent begun from the menu in Chapter I, never on Continue / restart / respawn.

## 7. Sound (deterministic: every sound is a designed cue at a fixed time, nothing random)

The cue sheet lives in the timeline (`CUES`); `audio/openingSfx.js` turns each into Web Audio nodes at the moment it is crossed
(and the trailer renders the whole sheet offline with the same code). Noise sources are seeded buffers, not Math.random.

| Layer | What | When |
|---|---|---|
| Score | the **drone** (D, sine + filtered saw, its low-pass and level by act), the **Lamp motif** (D-A-F-E-D on bowed metal, 3 statements: soft, full, broken), a cold high cluster (window), the riser and the **title hit**, the held root under the title | 0-76 |
| Foley | the flame's breath (a fixed crackle pattern), the gutter, lantern creak on the swing, the chain paying out (link clinks, a ratchet), the chain's stop, dust off the arch, the snuff | 0-66 |
| Creature | three knocks in the wall, the plates grinding far below, the breath, the lunge roar | 48-65 |
| Player | the drawn breath, cloth and gauntlet, two heartbeats, the lamp's whoomp, the lantern's catch | 76-84 |
| Voice | 9 Kokoro lines (MAREN 7, ODESSA 3), dry and close, not through the radio chain (this is the record, not the uplink) | 2-64 |

## 8. Voice (Kokoro, the game's own cast)

Rendered by `tools/abyssal-tether-3d/voice/build_opening_vo.py` with the radio cast's blends (performance.json `cast`), directed in
`voice/opening_performance.json` (phrases, measured pauses, stress, breaths), to `assets/audio/opening/*.ogg` (-23 LUFS, Opus,
outside `assets/audio/voice/` so the radio build never prunes them). Captions show the words (they are subtitles, not sound
captions, and always on: the film needs them).

| Id | Speaker | Line | Direction |
|---|---|---|---|
| op-1 | MAREN | Seventeen ninety-one. One woman climbed out of this shaft, carrying a flame. | The record, read aloud; quiet wonder; a beat after the year |
| op-2 | MAREN | It burned nothing. It never went out. Every lamp we have was lit from hers. | Three facts, each a little lower; *hers* stressed |
| op-3 | ODESSA | It is dimming. | Close, flat, the first time she has said it aloud |
| op-4 | ODESSA | Five hundred and fifty-six metres of cut stone. Every probe we lowered went quiet at the bottom. | The briefing voice; *quiet* is her word for it |
| op-5 | ODESSA | So we are lowering a person. | Calm, procedural (the radio lies only by omission: nobody is lowered) |
| op-6 | MAREN | They carved one rule over the door. | Dry, curious |
| op-7 | MAREN | Trust the ring, not the floor. The floor keeps. | Quoting; the last three words lower and slower |
| op-8 | MAREN | The record says something was down here before the lamp. | Hushed, careful |
| op-9 | MAREN | Before the first stone was cut. Something we never prepared for. | A near whisper |
| op-10 | MAREN | We confronted it, but | Torn off: the game cuts it with static at 64.0 |

## 9. Budget

Draw calls while it plays: the level as the spawn view already costs (the lantern prop 1, the flame 1, the halo 1, the chain 1, the
letterbox / title / skip ring 3, the Mason rig only in shot 7) = **+7 over the spawn view** (and the hands / body are hidden until
the waking: -6). Triangles: +8 k (lantern 2.4 k at 2 LODs, chain 5.8 k, plates); the Mason in shot 7 is the rig's LOD1 (~23 k) at 22 m
and LOD0 only during the lunge's last 0.4 s. No per-frame allocation (all scratch vectors are module constants). Assets: 10 voice
clips (~170 KB, precache core), no new model or texture file.

## 10. Files

`src/sim/openingCinematic.js` (the timeline: shots, keys, cues, captions, VR vantages; pure) · `src/render/openingView.js` (the
lantern, flame, halo, chain, letterbox, title, skip ring; applies the timeline to the camera, the lights, the Mason) ·
`src/audio/openingSfx.js` (the score and foley) · `src/game.js` (state `intro`, `_beginOpening` / `_updateOpening` /
`_applyOpeningCam` / `_endOpening`, the debug hooks) · `src/sim/config3d.js` (`openingCinematic`, the migration) · `src/ui/ui3d.js`
(the settings row) · `assets/audio/opening/` · `tools/abyssal-tether-3d/voice/build_opening_vo.py`, `opening_performance.json` ·
`tools/abyssal-tether-3d/release/render-opening.mjs` (stills, contact sheet, the MP4) · test
`tools/abyssal-tether-3d/tests/ux/opening.mjs`.
