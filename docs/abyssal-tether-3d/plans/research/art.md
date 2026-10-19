# ABYSSAL TETHER 3D: Horror visual language for VR, and the Art Direction Bible

Research and art direction for the "10× graphics + rigged, crazy-scary centipede" milestone. Written 2026-10-19.

**Companion reports (same folder).** [`quest.md`](quest.md) covers Quest 3 / Quest Browser hardware limits and budgets.
[`three.md`](three.md) covers the three.js r170 technique inventory and its cost ranking. This file does not repeat their
numbers; it cites them where a rule depends on a budget. It covers the *what* and *why* of the look and the fear. Those
two files cover the *how much it costs*.

**Method.** I read the game's code (`src/render/*`, `src/sim/creature3d.js`, `src/data/level-data-3d.js`,
`src/audio/audio3d.js`), the production bible (`docs/abyssal-tether-3d/CHAPTERS.md`) and the pitches, and looked at the
current Mason preview render (`tools/abyssal-tether-3d/previews/mason_hero.png`). Web research followed. Several hosts
(developers.meta.com, gamedeveloper.com, PubMed Central, Lagarde's blog) could not be fetched from this sandbox, so those
sources were read through search-engine extracts. Each is linked so it can be re-checked. Numbers marked **(design
target)** are my own targets, not published figures. Numbers marked **(derived)** are my arithmetic. Everything in
the Bible must be confirmed in the headset.

**Rules followed.** Nothing under `/home/user/TradeCheckPro` was edited. No Blender renders and no Chromium were run.

---

## 0. Bottom line

1. **On Quest 3, "10× the graphics" comes from art direction and baked content, not from shader features.** The
   hardware reports say the same: a mobile tiler drawing ~5.9 Mpx per stereo frame, no post-processing, ≤ 3 dynamic
   lights, no shadow maps (see `quest.md` §0, §12–14; `three.md` §3). The things that read as "AAA" in a headset all fit
   that budget:
   - one motivated light with real falloff;
   - fog with depth layers;
   - wet specular glints that move with your lantern;
   - near-field detail on your hands, rope and anchors;
   - dense instanced set dressing;
   - a creature whose *behaviour* is authored like a film actor's.
   The owner's "like Unreal Engine" can honestly be met on the **desktop tier** (shadows, bloom, GTAO). On Quest the
   target is "the best-art-directed WebXR horror game", the level of a well-made native Quest title. It is not desktop
   UE5.
2. **"Crazy scary" is mostly staging, timing and sound sync, not polygons.** The research is consistent on four points:
   - Anticipation and uncertainty drive anxiety more than the threat itself ([Grupe & Nitschke 2013](https://pmc.ncbi.nlm.nih.gov/articles/PMC4276319/)).
   - Darkness raises startle magnitude ([Grillon et al. 1997](https://eurekamag.com/research/074/708/074708546.php)).
   - A presence that *lingers* inside personal space is more arousing than its approach ([arXiv 2508.10586](https://arxiv.org/abs/2508.10586)).
   - Slow looming produces freezing, fast looming produces escape ([BMC Biology 2020](https://bmcbiol.biomedcentral.com/articles/10.1186/s12915-020-00825-0); [Yilmaz & Meister 2013](https://meisterlab.caltech.edu/documents/8117/yilmaz_2013_looming_response.pdf)).
   The Mason's rig and AI must therefore support **holding still, lingering, tracking, slow emergence and false
   retreats**, not just lunging. §9 lists 24 such beats, each tied to a clip or procedural layer.
3. **The current Mason does not read as scary yet.** The preview render reads as *scaffolding carrying crates*:
   - The blocks are clean boxes.
   - The legs are straight construction girders, and there are only 10 of them.
   - The fronds are thin white wires with **glowing dot tips, which read as antennae or eye stalks**. That breaks the
     identity rules.
   Bible §8 fixes the shape language:
   - fronds become **a ring of raised, empty stone arms** (the canon already says so);
   - blocks become **dressed voussoir plates with figure reliefs and wet mortar-flesh in the joints**;
   - the crown opens as a **stone iris onto a receding vaulted "nave-throat"**, so there is no jaw and no teeth;
   - leg count rises so that the **metachronal leg wave**, the motion signature of a centipede, is what players see.
4. **Quest 3's LCD cannot show deep black.** Through pancake lenses, dark scenes look grey and murky next to OLED headsets
   ([MIXED](https://mixed-news.com/en/meta-quest-display-dimming-hands-on/)). So darkness has to be *designed*:
   - Read silhouettes as dark on lighter fog.
   - Keep detail out of near-black.
   - Dither every gradient.
   - Make the lantern-pool edge the place where fear lives.
   Bible §5.2 gives a five-band value system.
5. **Peripheral vision is the VR horror channel a flat screen does not have.** Flicker and motion are more salient in
   the periphery ([Frontiers 2021](https://www.frontiersin.org/journals/neuroscience/articles/10.3389/fnins.2021.683153/pdf)).
   A *still*, low-contrast object in the periphery fades from awareness: the Troxler effect
   ([Kanai & Kamitani](https://bicr.atr.jp/~kmtn/pdf/KanaiKamitaniJCogNeuroPre.pdf)). A Mason that freezes at the edge of
   the lantern light genuinely disappears, and reappears when it moves. Fixed foveation lowers resolution there anyway, so
   peripheral beats must be carried by **motion and luminance, never detail**.
6. **In a grappling game the player's gaze is predictable: they look at the next anchor.** The anchor is the camera.
   Reveals are framed *through or behind the next anchor*, along the swing arc, or in the gap a pillar opens as you swing
   past it. Nothing ever moves the view.
7. **Safety limits are not comfort options.** The owner chose no locomotion comfort filters. Photosensitivity is a
   separate matter: Meta points developers to ISO 9241-391 ([Meta best practices](https://developers.meta.com/horizon/resources/bp-overview/)),
   and WCAG 2.3.1's general-flash threshold is a usable proxy
   ([W3C](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html)). **Finding (measured with
   a node script on the formulas in `renderer3d.js`):**
   - Environment-lamp flicker swings intensity by 22–45 % at ~0.9–2 Hz, plus a rare unramped ×0.4 dip.
   - The lantern swings up to ~32 % peak to trough.
   - **Both reach 3 flash pairs in some 1 s windows.** WCAG fails only *above* 3, so they pass on paper with zero
     margin, whenever a flickering light covers much of the view.
   Bible L8 gives them margin. Script: `plans/scripts/flicker_check.mjs`.

---

## 1. The display: what darkness looks like inside a Quest 3

| Fact | Value | Source |
|---|---|---|
| Panels | 2 × LCD, 2064 × 2208 per eye, pancake lenses | [UploadVR specs](https://uploadvr.com/quest-3-specs), [Meta compare](https://www.meta.com/ie/quest/compare/) |
| Field of view | ~110° horizontal, ~96° vertical | same |
| Angular resolution | ~25 pixels per degree | same |
| Black level | LCD, not OLED; dark scenes look greyer than on the Pico 4 | [MIXED Pico 4 vs Quest 3 / dimming hands-on](https://mixed-news.com/en/meta-quest-display-dimming-hands-on/) |
| Adaptive dimming | Experimental "Content Adaptive Brightness Control" dims the backlight in dark scenes. It helps a little ("less murky blacks"), but contrast also drops | [MIXED](https://mixed-news.com/en/meta-quest-3-adaptive-display-dimming/), [MIXED hands-on](https://mixed-news.com/en/meta-quest-display-dimming-hands-on/) |
| Output precision | 8 bits per channel, so smooth dark gradients (fog, lantern falloff) band unless dithered | `quest.md` §12; banding and dithering: [INSIDE GDC talk](https://gdcvault.com/play/1023783/Low-Complexity-High-Fidelity-INSIDE), [Game Developer](https://www.gamedeveloper.com/design/banding-and-dithering) |
| Periphery | Fixed foveation renders it at lower resolution (`quest.md` §6); human vision there is tuned to flicker and motion | [Frontiers 2021](https://www.frontiersin.org/journals/neuroscience/articles/10.3389/fnins.2021.683153/pdf), with a caveat on fast motion in [i-Perception 2020](https://journals.sagepub.com/doi/10.1177/2041669520937029) |

**What a pixel can show at each distance (derived from 25 PPD).** One pixel covers d × tan(0.04°) ≈ d × 0.0007 m:

| Distance | Size of one pixel | Useful texel density | What belongs there |
|---|---|---|---|
| 0.3–1 m (hands, rope, anchor in hand) | 0.2–0.7 mm | ≥ 1024 px/m | Gauntlets, rope fibres, hook teeth, rivets |
| 2 m | 1.4 mm | ~700 px/m | Ledges, the anchor ahead, statue faces |
| 5 m | 3.5 mm | ~290 px/m | Walls along the route, the Mason in a lunge |
| 10 m | 7 mm | ~140 px/m | Mid walls, the Mason hunting |
| 30 m+ | ≥ 2 cm | ≤ 50 px/m | Silhouettes, fog, vista |

**What this means:**
- Spend texture memory and triangles where the player's hands and next anchor are. In VR those near-field objects are
  under stereo and motion parallax, and they are what the player studies most.
- The far shaft needs shape, not texels.
- Today's ~4 m texture tile with 256 px fallback textures is ~64 px/m, far below what a wall 2 m away can show. This is
  the single most visible "cheap" cue in the current build (KTX2 fix: `quest.md` §9).

---

## 2. Research: what raises perceived quality and fear in VR

### 2.1 Lighting

**Single motivated light.** Horror cinematography works in low key:
- a strong key, minimal fill, and fill several stops below key (8:1 or more);
- pools of light that reveal only what the story needs ("it may not be necessary to see their face… it is necessary
  to see their hands");
- edge light to sell a "no-light" look.

Sources: [ASC Shot Craft: Halloween Horrors](https://theasc.com/article/shot-craft-halloween-horrors-creating-visual-cues-to-foster-fright/),
[low-key reference](https://melies.co/cinematic-techniques/lighting/low-key).

The game already has the ideal motivated key: **the player's own lantern**. Every other light must be a source the player
can name (a lamp, a crack of Lamphold's glow, the Mason's listening pits, the Mark Lamp). An unmotivated ambient fill
is the main thing that makes real-time 3D look "gamey". The hemisphere light must stay a fog-coloured floor, never a
key.

**Darkness reads as fear, so it must still read.** Darkness by itself potentiates startle, and the effect tracks fear of
the dark rather than attention ([Grillon et al. 1997](https://eurekamag.com/research/074/708/074708546.php); replicated
in [Grillon et al. 1998, Am J Psychiatry](https://ajp.psychiatryonline.org/doi/10.1176/ajp.155.6.812)). On an LCD
headset, though, "dark" collapses into murky grey (§1). The craft answer:
- **Silhouette against haze.** Distant fog lit by far lamps is the brightest non-source value in most frames, so near
  forms read as dark shapes against it. The renderer already lifts haze (`FOG_GAIN = 1.3`,
  `FOG_LUM_FLOOR ≈ sRGB 30`); keep that.
- **Edge light.** Fresnel and wet speculars give rim highlights facing the lantern.
- **Never put readable detail in near-black.**
- **Dither everything.**

**Colour temperature.** Warm and cool splits are the classic horror language. The research gives a stronger handle:
[Valdez & Mehrabian 1994](https://pubmed.ncbi.nlm.nih.gov/7996122/) found brightness and **saturation** drive emotion
much more than hue. Saturation raises arousal and brightness raises pleasure, and saturation's stronger effect was
confirmed by [Wilms & Oberfeld 2018](https://www.staff.uni-mainz.de/oberfeld/downloads/Wilms-Oberfeld2018_Article_ColorAndEmotionEffectsOfHueSat.pdf).
So **keep the world desaturated and dim, and spend saturation like ammunition**: on the safe warm light and on the
threat's own colour. The bible assigns meaning by temperature:
- warm means human and yours;
- cool means the world and distance;
- pale cold green-white means the Mason sensing you.

Chapter V inverts this on purpose: white-gold is the danger.

**Flicker.** A flame that breathes is alive; a strobe is a hazard and looks cheap. Two constraints:
1. Photosensitive safety. A "flash" is a pair of opposing relative-luminance changes of ≥ 10 % where the darker state is
   below 0.8. Content fails when there are more than 3 such flashes in 1 s over more than 25 % of any 10° field
   ([W3C WCAG 2.3.1 understanding](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html)).
   Meta tells developers to conform to ISO 9241-391 ([Meta best practices](https://developers.meta.com/horizon/resources/bp-overview/))
   and shows a flashing-images warning ([Meta](https://www.oculus.com/legal/horizon-flashing-images-warning)). A lantern
   lights most of the view, so any lantern modulation counts as full-field.
2. Peripheral flicker sensitivity is higher than foveal ([Frontiers 2021](https://www.frontiersin.org/journals/neuroscience/articles/10.3389/fnins.2021.683153/pdf)),
   so even sub-threshold flicker in the periphery reads as "something moved". Use that deliberately (lamp dips when the
   Mason passes) and never accidentally.

Today both the lantern (≤ ~8.5 % fast modulation plus a rare 18 % dip) and the env lamps (22–45 % swings at ~0.9–2 Hz)
peak at exactly 3 flash pairs per second (§0 point 7): compliant with no margin. The goal is a flame that never gets
close to the line.

### 2.2 Atmosphere

- **Depth comes in three zones, and each needs its own cue.** Perception research splits space into **personal**
  (≲ 1.5–2 m), **action** (~2–30 m) and **vista** (> 30 m). Different depth cues dominate in each, and binocular
  disparity fades with distance (Cutting & Vishton's framework, as summarised in
  [Frontiers in Human Neuroscience 2015](https://www.frontiersin.org/journals/human-neuroscience/articles/10.3389/fnhum.2015.00511/full)).
  A vertical abyss lives in vista space, so it needs aerial perspective (fog colour and contrast falloff), stacked
  silhouettes and **motion parallax from particles**: motes drifting past at different depths make a void read as
  deep, not as a black wall. The action zone needs lit relief and parallax. The personal zone needs stereo-true geometry
  and fine texture.
- **Fog layering.** Three layers, each cheap (implementation: `three.md` §2.6, analytic fog in the fog chunk):
  1. distance haze (exists);
  2. **height pooling**: denser fog that settles in the bottoms of chambers and over water, so "down" looks thicker and
     more threatening;
  3. **in-scatter halos** around the lantern and lamps, so light lives in the air, not just on walls.
  Light shafts are additive cards with drifting motes inside them.
- **Particulates.** Dust and ash wrapped around the head already exist (`fx.js`, 900 points). The quality jump comes
  from three things:
  - motes **lit by the lantern** (bright near the light, invisible away from it);
  - **type per chapter** (dust, soot and embers, mist droplets, bone dust, motes that freeze in light);
  - **event particulates**: grit raining when something heavy moves above, drips with splashes, dust sifting from
    seams.
  Particulates are also the main *causal* cue: grit falling *before* you see the Mason above is "heard before seen" in
  visual form.
- **Drips.** A drip seen and heard at the same point sells wetness and space better than any texture. Author drip
  points near the route, with visible streaks, a splash ring and a glint, plus the sound.
- **Breath.** Do **not** spawn visible breath vapour in front of the player's eyes. Particles 0.2–0.4 m from the eyes
  strain vergence and occlude the view, and HoloLens guidance says never to show content closer than 40 cm
  ([Microsoft MR comfort](https://developer.microsoft.com/windows/mixed-reality/comfort)). Breath belongs to the world
  instead:
  - the shaft **inhales and exhales**: fog density and mote drift reverse slowly in time with the wind bed in
    `audio3d.js`;
  - the Mason **breathes through its mortar seams**: small dust puffs at seam points in a slow rhythm. It has no lungs,
    which fits "architecture that learned to hunt".
  The player's own breath stays audio-only, which the game already does.

### 2.3 Material storytelling

- **Wet against dry is the cheapest "next-gen" cue there is.** Wet porous surfaces get **darker in albedo** and gain a
  sharp **specular lobe** from the water film; impermeable metals do not darken
  ([Lagarde's wet-surface work, summarised by fxguide](https://www.fxguide.com/?p=43362);
  [Jensen et al., "Rendering of Wet Materials", EGWR 1999](https://groups.csail.mit.edu/graphics/pubs/wet_materials_egwr99.pdf);
  [porosity values, LabPBR](https://github.com/rre36/lab-pbr/wiki/Specular-Texture-Details)). Under a carried moving
  point light, wet stone throws **highlights that slide as you swing**. That is continuous, view-dependent motion, the
  thing that most separates "rendered" from "painted". Lagarde's advice is to adjust the dry material's BRDF
  parameters, not to add a new lighting model, which suits the existing `onBeforeCompile` patch system.
- **Specular response is how the lantern models form.** Worn bright edges on iron, polished steps, and the waxy sheen of
  mortar-flesh let the one light describe shape. **Albedo must stay physically plausible** (stone roughly sRGB 60–170).
  Darkness comes from *light*, not from black textures. Black albedo kills the lantern's ability to model anything,
  and it is the most common amateur horror mistake.
- **Scale cues.** People judge size from familiar objects and, in VR, from **their own body** ("body-based scaling"),
  most strongly when the virtual hands are realistic ([Frontiers in VR 2022](https://www.frontiersin.org/journals/virtual-reality/articles/10.3389/frvir.2022.869603/pdf);
  [Ogawa et al. 2019, hand realism](https://paper.nweon.com/8921)). Two consequences:
  - High-quality gauntlets and rope are not cosmetic. They are the ruler the player uses for the Mason.
  - Every Mason reveal needs a known-size object in frame: a 2.1 m doorway, a 1.9 m statue, a lamp, a chain with 10 cm
    links, stair risers.
- **Wear that obeys physics reads as real.** Soot goes *up* from flames. Drip stains go *down* from ledges. Grime gathers
  in corners (AO). Steps are polished where feet went. **Rope grooves are worn into the rings by earlier pilgrims**: the
  canon is that you have done this before, and the rings remember. Wear that contradicts physics (random grunge) reads
  as fake even when players cannot say why.

### 2.4 Set-dressing density

- In VR every surface within reach is inspected stereoscopically. A raw box with a tiling texture reads as a box. The
  quality jump comes from **kit modules with real relief** (cornices, voussoir arches, buttress ribs, corbels, iron
  brackets, chains) instanced along walls near the route (`three.md` §3 #8).
- **Density follows the eye.** Put it near anchors and landing ledges, where the player looks.
- **Negative space is a set piece.** Voids must stay empty to feel bottomless; dressing belongs on the walls framing
  them. One distant silhouette per section (a colossus, a hanging cage, the spire) gives the void a scale reference.
- **Story per metre.** Every 10 m of descent needs one thing that says *people lived and died here*: a statue, a tally
  mark, a dropped lantern, a scaffold swallowed by masonry. This is the "plausibility illusion" that VR horror players
  fear most. [Lin 2017](https://ah.lib.nccu.edu.tw/handle/140.119/110472) (DOI 10.1016/j.chb.2017.02.057) found players
  reported more fear toward plausibility-illusion elements than place-illusion elements.

### 2.5 Sound–visual sync

- **Contact events must be tight.** For an impact (a hammer on a nail), observers detect audio *leading* video at about
  **75 ms**, and video leading audio only at about **188 ms**. Speech is more tolerant: 131 / 258 ms
  ([Dixon & Spitz 1980, as reported in Maempel 2011](https://www.simpk.de/fileadmin/user_upload_sim/Dokumente/Forschung/Themen/Abteilung_III/Publikationen/Heide_Maempel_2011_Die_Wahrnehmung_audiovisueller_Synchronitaet_in_elektronischen_Medien.pdf);
  [arXiv 2212.01686](https://arxiv.org/pdf/2212.01686)). Leg plants, plate grinds, knocks and strikes should therefore
  never sound before they are seen, and should sound no later than ~100 ms after **(design target)**.
- **Distance delay sells scale.** Sound travels 343 m/s, so a collapse 70 m away arrives ~0.2 s late and one across the
  190 m Vault ~0.55 s late **(derived)**. Delaying *far* event audio by distance / 343 s (capped near 0.6 s) is a free,
  powerful vista-scale cue. Near events stay tight.
- **"Heard before seen" works on the 1–2 s scale.** That is the production rule (CHAPTERS §3.2), and it is separate from
  sync. The pre-cue must come **from the same place** the threat will appear. Visual pre-cues layer on top: grit falls,
  lamps dip, the rope hums (haptics).
- **Silence must be synchronised too.** When the Mason freezes to listen, its scrape bed cuts *on the same frame* its
  legs stop. A mismatch (sound continues while it is still) breaks the illusion faster than a lower-poly mesh does.

### 2.6 Creature staging in VR

- **Not seeing it is scarier, and the industry knows.** Valve's Half-Life: Alyx team argues the scariest threat is the
  one you cannot see ([Bloody Disgusting interview](https://bloody-disgusting.com/interviews/3609928/interview-valve-discuss-vr-accentuates-horror-half-life-alyx/)).
  Alien: Isolation's director tracks a "menace" measure and withdraws the creature ("backstage") when pressure has been
  high for too long, while the creature never cheats on its senses ([Game Developer, "The Perfect Organism"](https://www.gamedeveloper.com/design/the-perfect-organism-the-ai-of-alien-isolation);
  [GDC Vault, Building Fear in Alien](https://gdcvault.com/play/1021852/Building-Fear-in-Alien)). Our production rules
  already cap Mason screen time at ~10 % per chapter (CHAPTERS §3.2). The *principle* (paced pressure plus honest
  senses) is general design craft. We do not copy any creature's look or specific behaviour.
- **Reveal choreography.** Sound, then an environmental effect, then a part (a leg, a frond-arm, its shadow), then a
  silhouette at vista distance, then (rarely) the whole body, and only at authored wonder beats.
  Geometry helps **(derived)**: Quest 3's ~110° × 96° FOV covers 2.86·d horizontally and 2.22·d vertically at distance
  d. A 30 m Mason on a vertical wall fits entirely in view only from ≥ 13.5 m (48 m in Chapter V: ≥ 21.6 m). **In action
  space it should never fit in the frame.** Stage it so the body always continues behind an occluder (a wall bend, a
  pillar, the fog). Partial occlusion is what makes length read as endless.
- **Silhouette and biological motion.** The visual system has a fast "life detector" driven by the **local motion of
  feet**. Scrambled point-light walkers still convey direction and animacy through foot motion alone
  ([Troje & Westhoff 2006, BioMotion Lab summary](https://www.biomotionlab.ca/the-inversion-effect-in-biological-motion-maybe-there-are-two-of-them/)).
  Many-legged forms also capture attention fast: fear-relevant animals are found in parallel search
  ([Öhman, Flykt & Esteves 2001](https://pubmed.ncbi.nlm.nih.gov/11561921/)). So the Mason's **leg wave** is what reads
  as "alive" in the dark and at distance, more than any surface detail.
  Real centipedes move legs in a travelling **metachronal wave** (retrograde in Scolopendra, switching with terrain).
  Body undulation runs about **2.5 rad ahead of the leg wave** in the most efficient gait
  ([Diaz et al. 2023, JEB](https://crablab.gatech.edu/pages/publications/pdf/Diaz_et_al_2023_JEB.pdf);
  [SICB abstract on body–leg coordination](https://sicb.org/?p=39562)). That is a concrete, authentic parameter for the
  procedural gait. The animation is borrowed from biology; the creature is not.
- **Scale in stereo is absolute.** On a flat screen a giant is a picture. In a headset, body-based scaling makes it
  *that big, there* (§2.3). Reveals must sit next to known-size architecture.
- **Proximity.** Personal-space intrusion by a virtual agent raises skin conductance on a scale comparable to real
  people, and discomfort follows a power law with distance ([Scientific Reports 2021](https://link.springer.com/article/10.1038/s41598-021-99578-1)).
  Arousal was higher while the intruder **stood** inside the boundary than during its approach ([arXiv 2508.10586](https://arxiv.org/abs/2508.10586)).
  The scariest beat is not the fast pass: it is the crown **stopping 3 m away and staying** (the Mark beat already does
  this).
- **Looming speed changes the response.** Slowly expanding threats tend to cause freezing; fast ones cause escape
  ([BMC Biology 2020](https://bmcbiol.biomedcentral.com/articles/10.1186/s12915-020-00825-0)). In mice, a dark disk
  expanding *overhead* (an aerial predator) triggers escape within a second or long freezing
  ([Yilmaz & Meister 2013](https://meisterlab.caltech.edu/documents/8117/yilmaz_2013_looming_response.pdf)). Use slow
  emergence (from below, out of fog) for dread, fast looming only for the telegraphed lunge, and **above** as the
  instinctive threat direction.
- **Above and below.** Viewers fixate near the horizon ("equator bias") in VR scenes
  ([Sitzmann et al. 2018](https://graphics.unizar.es/papers/Sitzmann_TVCG2018_VRsaliency.pdf)). In this game players
  also look *down* at anchors. Directly overhead is the blind zone, which makes it the right place for pre-cues (grit,
  sound) and for "look up" reveals. Below is vertigo: a virtual pit drives heart rate and skin conductance
  ([Meehan et al. 2002](https://www.cs.uky.edu/~sgware/reading/papers/meehan2002psysiological.pdf)). Something rising
  out of the void beneath you stacks two fears.
- **Freezes and Troxler fading.** A stationary, low-contrast object in the periphery fades from awareness under steady
  fixation, and higher contrast reduces the fading ([Kanai & Kamitani](https://bicr.atr.jp/~kmtn/pdf/KanaiKamitaniJCogNeuroPre.pdf);
  [Bonneh et al. 2014](https://www.plosone.org/article/info%3Adoi%2F10.1371%2Fjournal.pone.0092894)). A Mason that stops
  with **all emissive off and all motion off** at the edge of the light becomes part of the wall, and "reappears" the
  instant a leg moves. The rig must support a *true* freeze: no idle breathing and no secondary sway.
- **Tracking the player's head without eyes.** People infer attention from **head orientation**, not just eyes
  ([Langton, Watt & Bruce 2000](https://storre.stir.ac.uk/bitstream/1893/21045/1/LangtonWattBruce_2000.pdf)). An eyeless
  crown that *turns to face you* reads as "it is looking at me". Because the Mason hunts by sound, the crown's facing can
  also show *what it hears*: your breath (head), your rope (the creaking hand) or your lantern (what it wants). A short
  lag, then a snap, reads as animal. Perfect instant tracking reads as a gun turret.
- **False retreats.** It withdraws, there is silence, and it returns from elsewhere (CHAPTERS P10). Paired with a
  menace-style pacing measure, this keeps uncertainty high. Uncertainty is the anxiety driver ([Grupe & Nitschke 2013](https://pmc.ncbi.nlm.nih.gov/articles/PMC4276319/)).
- **The uncanny.** Mori placed the still corpse and the moving zombie at the bottom of the uncanny valley: *movement
  deepens it* ([Mori 1970, IEEE Spectrum translation](https://spectrum.ieee.org/the-uncanny-valley)). The Mason's
  figure-plates (hooded backs, raised stone arms) are human-shaped but faceless and stone, and they **move a little when
  nothing should move them**. Use it sparingly.

### 2.7 Camera-free fear (the player owns the view)

Nothing may rotate the view or cut away (pillar 3). Fear has to be *directed* without a camera:
1. **The anchor is the camera.** The player's next target is predictable, so stage reveals through or behind it, along
   the swing arc, or across the far wall that the release trajectory faces.
2. **The swing is the dolly shot.** Swinging past a pillar or through an arch is a parallax reveal that the player
   performs. Place the beat in the gap an occluder opens.
3. **Steer attention with causes.** Use a sound from a direction (HRTF, behind or above), lamps dipping in sequence
   toward the beat, grit falling in front of the lantern, the rope humming in the hand (haptics). Each cue must have
   a source the player can find.
4. **Gaze-held windows.** Hold a scripted reveal until the head is within ~35° of it, with a soft timeout **(design
   target)**. Gaze may only decide **when something is shown, never whether it moves**: the bible rejects "moves when
   unwatched" as unoriginal (CHAPTERS §0, Kept trigger).
5. **The lantern pool is the frame.** The edge of the lit circle (6–10 m) is the frame line. Legs planting just beyond
   it, catching a sliver of light, are the primary "glimpse".
6. **Dark adaptation as a reveal.** When a light goes out, cut exposure quickly, then raise it slowly over 3–5 s, as
   eyes adapting do. What the "adapted eye" finds should be the Mason's outline, closer than the player thought.
   Implementation: an exposure uniform; no pass.
7. **Silence as a cue.** When the ambient bed (wind, drips) drops out, something is listening. The production rule
   already assigns one meaning to silence per chapter.

### 2.8 Comfort-safe intensity

- VR jump scares are contested. Several developers call them a limited tool or "dangerous" in VR, Oculus reportedly
  discouraged them, and others use them as rare "spice"
  ([Game Developer: jump scares according to horror devs](https://gamedeveloper.com/design/the-time-and-place-for-jump-scares-according-to-horror-devs);
  [Here They Lie and the ethics of VR horror](https://www.gamedeveloper.com/design/-i-here-they-lie-i-and-the-ethics-of-vr-horror);
  [Vive: creating horror VR](https://blog.vive.com/us/creating-horror-vr/)). Dread from uncertainty is sustainable;
  startles habituate and spike. Hence the bible's **startle budget** (§11).
- Next-day fright after VR horror was rare and mostly cognitive in [Lin 2017](https://ah.lib.nccu.edu.tw/handle/140.119/110472).
  Players used approach, avoidance and self-talk coping, so let them look away. Never force a view.
- **Near-eye limit.** Keep nothing within ~0.6 m of the eyes except the player's own hands **(design target)**, stricter
  than [Microsoft's 40 cm](https://developer.microsoft.com/windows/mixed-reality/comfort). Fade any closer creature
  geometry with dithered alpha. The death fade completes before contact.
- **Trypophobia.** Clusters of holes are aversive to about 16 % of adults. The cue is high contrast at mid spatial
  frequencies ([Cole & Wilkins 2013](https://repository.essex.ac.uk/7734/)). The Mason's listening pits should be **few,
  large and spaced** (5, as today), never a lotus-pod texture. That reaction is disgust, a turn-off, not fear.
- Meta's store comfort rating is about motion (Comfortable / Moderate / Intense), and swinging locomotion makes this
  game **Intense** ([Meta help](https://www.meta.com/help/quest/331713305046406/); [store policies](https://developer.oculus.com/policy/store-policies)).
  Content intensity belongs in the store description and the flashing-images warning, not in the rating.

### 2.9 Originality guardrails (research on what *not* to resemble)

The Mason's identity is fixed: **architecture that learned to hunt**. It has no eyes, no antennae and no insect
mandibles. Common tropes it must steer clear of:

| Trope or neighbour | Risk | Guardrail |
|---|---|---|
| Real centipede head (forcipules) | Reads as mandibles | Blunt crenellated crown; opening is a **stone iris of voussoirs** onto a vaulted interior. No pincers, no teeth |
| Circular toothed maw (giant-worm films) | Iconic and taken | No teeth ring. The interior is *architecture* (receding arches, pit glow), not gullet |
| Biomechanical flesh-and-pipe fusion | Strongly associated with existing artists and games | Masonry and wrought iron are dominant (≥ 85 % of visible surface). Flesh is only **mortar-flesh in joints and underside**. No tubes, ribbing or pipes |
| Grafted human-arm clusters | Existing games use wriggling flesh arms | The arms are **carved stone statue arms** (robed sleeves, open empty palms), moved rigidly at stone joints. They never wriggle like fingers |
| "Moves when not watched" | Famous and taken | Already rejected in CHAPTERS. Gaze only times reveals |
| Eye-stalks or antennae | Breaks identity | **Remove the glowing dot tips from the current fronds.** Glow lives only deep inside the pits |
| Siren- or loudspeaker-headed giants, faceless tall humanoids | Internet-horror icons | The Mason is horizontal, long and many-legged. Human figures appear only as reliefs and statues in its plates |

---

## 3. Audit: the current look against this research

| Area | Today | Gap |
|---|---|---|
| Lighting | Lantern PointLight (living flicker), 2 env lights, hemisphere ambient, ACES, radial fog | No in-scatter; no lantern cookie; ambient is a uniform fill; lamp and lantern flicker sit exactly at the 3-flashes/s limit, and the lamp dip is an unramped step |
| Atmosphere | 900 head-wrapped motes; bursts; fog themes per section | Motes not lantern-lit; no height pooling; no event grit, drips or seam breath; no light shafts |
| Materials | Baked PBR sets; ash on top faces; crack overlay; world-space UVs | Low texel density near the player; no wetness layer; no physically placed wear; boxes read as boxes |
| Set dressing | Box solids plus decor shapes; vista colossi | Little kit relief near the route; little story per metre |
| Mason | 65 rigid parts, 1 draw, 10 girder legs, 10 wire fronds with glowing tips, 5 pits | Reads as scaffolding and crates. Fronds read as antennae. Too few legs for "centipede". No deformation, no clips, no true freeze, no linger |
| Sync | Rich procedural audio bus (`creature:step`, `burst`, `attack`, `call`, `retreat`, `sighting`) | Visual counterparts for steps (dust), calls (lamp dips) and listens (silence plus freeze) are missing or partial |

The Mason preview (`tools/abyssal-tether-3d/previews/mason_hero.png`) confirms the creature critique visually.

---

# THE ART DIRECTION BIBLE

## 4. Visual pillars

1. **One light you can name.** Every visible photon has a source the player could point at. The lantern is the key.
2. **Wet stone, worn iron, old hands.** Materials tell how long people have been dying here, and that the deep is wet.
3. **Fear lives at the edge of the light.** The lantern pool's rim, the fog's edge and the periphery are where the Mason
   is glimpsed.
4. **The building is the body.** Every Mason surface is a building material first. What is alive shows only in the
   joints.
5. **Show the cause.** Every scare has a visible or audible cause a moment before it lands: grit, dipping lamps, a
   knock, a rope hum.

## 5. Value and colour system (global)

### 5.1 Colour meaning (fixed across the game, inverted only in Chapter V)

| Meaning | Colour family | Examples (sRGB) |
|---|---|---|
| **Yours, human, safe (I–IV)** | Warm amber to candle | lantern `#ffb46a`, lamps `#e0a050`, Lamphold `#f0b060` |
| **The world, distance, awe** | Desaturated cool slate and teal | fog `#141719`–`#252b30`, shafts `#6fa3b5` |
| **The Mason sensing** | Pale cold green-white, low saturation | pit glow `#b8f0e0` (keep `PALETTE.glow`) |
| **Decay and iron** | Rust and verdigris, low saturation | `#7a3b22`, `#3f6b63` |
| **Still Flame / stillness (V)** | White-gold draining to white | `#f4e6c0`, `#f4ead2` |
| **Interactive (anchors)** | Phosphor `#e8dcc0` plus shape code | unchanged; readable in every palette (CHAPTERS §3.2.6) |

**Rules:**
- **C1.** The Mason never emits warm light. After snuffing a lamp (Chapter II), its pits flare *warm for 0.5 s*, then
  cool. It drank the light.
- **C2.** World saturation ≤ 0.6 in grade (§6). Saturated colour is spent only on the safe light, the Mason's pits,
  and a chapter's "promise colour" in its last section (pillar 6).
- **C3.** Shadows lean cool, light leans warm (grade lift and gain). Chapter V reverses this.

### 5.2 Value bands (what each part of the frame may be)

Design targets, in display sRGB after tone mapping, checked **in the headset**:

| Band | sRGB | What lives here | Rule |
|---|---|---|---|
| B0 void | 0–14 | Death fade only | The LCD shows it as grey anyway; do not rely on it |
| B1 haze floor | 18–34 | Far fog, the darkest part of normal frames | Nothing important is darker than this |
| B2 shadowed form | 30–65 | Unlit surfaces within 15 m, the Mason in shadow | Must separate from B1 by ≥ 1.3:1 luminance, or by an edge or rim |
| B3 lit form | 65–170 | Surfaces in the lantern or lamp pools | Keep albedo plausible so form models properly |
| B4 sources and glints | 170–255 | Flames, wet speculars, pits, glyphs | ≤ ~3 % of the frame typical, ≤ 8 % peak |

**Readability rule.** Anything the player must read (anchors, hazards, the Mason's outline when it matters) needs
≥ 1.5:1 contrast against its local background through at least one of: a silhouette against haze, a rim or wet
highlight, or emissive **(design target)**. Phosphor anchors already do this.

### 5.3 Grade (in shader, no pass)

Each section theme gains `shadowTint`, `highlightTint`, `saturation`, `contrast` and `exposure`, applied in the existing
tone-mapping hook (`three.md` §2.16: CustomToneMapping or AgX plus lift/gamma/gain). Add triangular-noise dither and
grain at 1–2 LSB to every lit and fog fragment, which removes banding (§1). Threat shifts the grade by −0.1 saturation,
+0.05 contrast and a slight green-cyan lift in shadows when the Mason is within 20 m. This is subtle and ramped over
≥ 1 s, never pulsed.

## 6. Palette per section

### 6.1 Chapter I: The Underspire (awe, then dread)

Fog, key and accent are the existing `theme()` values (`level-data-3d.js`); the rest is new.

| § | Fog | Key | Accent | Shadow tint | Highlight tint | Sat | Wet | Particulates | The Mason here |
|---|---|---|---|---|---|---|---|---|---|
| S1 Threshold | `#252b30` | teal shafts `#6fa3b5` from above; threshold lamp | amber `#e0a050` | `#1a2530` | `#fff1dc` | 0.70 | 0.10 (dry, ash on tops) | Slow dust lit in shafts | Absent. Audio only, far below |
| S2 Long Swing | `#22282d` | `#6fa3b5` | `#e0a050` | `#19232b` | `#ffeed8` | 0.70 | 0.15 | Dust; chain sway | Absent; one far call (delayed by distance) |
| S3 Broken Gallery | `#23231f` | `#7c9a9c` | verdigris `#3f6b63` | `#1c211e` | `#f2ead6` | 0.65 | 0.30 (first drips) | Dust and the first drips | A call; one grit sift from above |
| S4 Listening Vault | `#1b2226` | `#5b8c9b` | `#b8f0e0` | `#142027` | `#e8f4f0` | 0.60 | 0.20 | Sparse motes at many depths (void parallax) | **The Pour** (§9 #1) across the far wall; Lamphold glow in floor cracks at 10 % |
| S5 Gullet Stair | `#211b19` | ember `#8a5a3c` | rust `#7a3b22` | `#241a17` | `#ffd9b0` | 0.60 | 0.50 | Grit sifting from seams | **In the walls** (#2), then stalking from above (#3) |
| S6 Two Descents | `#1b1918` | `#5a7d86` | `#9a4a2a` | `#1a1a1c` | `#f4e2cc` | 0.55 | 0.60 | Drips; frayed rope fibres | Hunt; leg wave seen through gaps (#21) |
| S7 Hollow Nave | `#141719` | `#4f7f8c` | pit glow `#b8f0e0` | `#10171b` | `#e6f2f0` | 0.50 | 0.40 | Debris raining off the spire | **The Spiral** (#12), false retreats (#11), frenzy |
| S8 Last Throat | `#120f0e` | `#d9b878` | `#e0a050` → `#f4e6c0` near the grate | `#170f0c` | `#fff0d0` | 0.55 | 0.70 | Ash and debris rain from above | Pursuit from above; grate slam |
| S9 The Mark | `#1a1410` | Mark Lamp `#f4ead2` | dark amber of kneeling statues | `#140e0b` | `#fff6e2` | 0.45 | 0.20 | **None: motes stop.** The hush is visual too | The walls are its coils; **the Linger** (#7) at 3 m |

### 6.2 Chapters II–V (themes from CHAPTERS §4.4; additions here)

| Chapter / phase | Fog · key · accent (existing) | Grade | Material emphasis | Particulates | Mason look |
|---|---|---|---|---|---|
| **II Lamphold, lit** | `#2a1f16` · `#f0b060` · `#ffcf80` | Warm highlights, cool-brown shadows, sat 0.65 | Honey sandstone, brass, **wax drips**, soot above every lamp | Candle smoke threads, warm motes | Soot-dark plates; **wax runs on its plates** from lamps it has snuffed |
| II Winding Floor | `#1b1712` · `#d08a3c` · `#6fbf9a` | Sat 0.55, contrast up | Oiled iron, worn brass edges, chain grease (glossy) | Oil mist near engines | In the walls: bulges (#2) |
| II snuffed | `#110c09` · `#7a2e1e` · `#f07a30` | Sat 0.5; ember highlight; very dark lift | Soot on everything; embers in cracks | **Embers and ash falling** | Warm-flared pits fading cold (C1); seams glowing ember for 10 s after each snuff |
| **III The Mere, air** | `#0e1828` · `#9fb8d0` · `#bfe8ff` | Cool, sat 0.45, silvery highlights | **Everything wet**: dark albedo, sliding speculars; black water with fresnel | Mist layer pooled on water (height fog); drips everywhere | **Streaming water** off its plates when it rises; highest specular in the game |
| III under water | `#061019`, near 0.5, far 14 | Blue-green, sat 0.35 | Silt; floating dark lanterns | Bubbles, suspended silt (lantern-lit) | Crown rising from below (#14) in silt |
| **IV The Keeping** | `#0d0c0b` · `#d8cfba` · `#8a6a3a` | Darkest; sat 0.35; warm only inside your cone | **Bone, chalk and ochre dust: dry, rough**. The only wet thing is the Mason's underside | Bone dust lit inside the lantern cone (the cone becomes visible = the mechanic made visible) | Figure-plates prominent (#16), the Gather (#17), tail paying out (#22) |
| **V The Still Flame** | `#cfc6b0` · `#f4e6c0` · `#ffffff` | **Inverted**: fog lighter than forms; sat 1.0 → 0.15 across the chapter (E25) | Frozen water (glass-smooth), chalky stone, the brightest whites in the game | Motes **stop in light** and drift in shadow | Stone-pale; **its shadow is its silhouette**; moves only in shadow (#23) |

## 7. Lighting rules

- **L1. Motivated only.** Lantern, lamps, Lamphold's glow, the Mason's pits, the Mark Lamp, Chapter V's Flame. The
  hemisphere is a fog-coloured floor (B1–B2), never a key. Key:fill ≥ 8:1 in hero spaces
  ([low-key ratio](https://melies.co/cinematic-techniques/lighting/low-key)).
- **L2. The lantern is a camera light.**
  - Add a **cookie**: the cage bars throw slowly swinging bar shadows on near walls, computed in the shader from the
    lantern's local frame (`three.md` §3).
  - In-scatter halo in the fog around it.
  - Its pool radius (~6–10 m of useful light) is the frame line for glimpses.
- **L3. Fixed light count** (lantern + 2 env + optional creature-only spot on encounters; `quest.md` §14). Everything else
  that glows is emissive plus a halo card.
- **L4. Bake the world** (lightmaps or volume, `three.md` §2.1). Baked lamp light has colour bleed, falloff and contact
  darkening. Without it the world looks lit by one bulb.
- **L5. Silhouette over detail at distance.** Forms beyond ~20 m are designed as dark shapes on lit haze, and their edges
  get the detail.
- **L6. Wet rim.** Surfaces near the route carry enough wetness or edge wear to throw a highlight back at the lantern.
  Form is modelled by speculars sliding as you swing.
- **L7. Light reacts to the Mason (the Lamp Dip).** Env lamps within 15 m dim smoothly toward 40 %, and their flame cards
  lean toward its crown, as it passes. Ramped over ≥ 0.4 s, **never a strobe**. It is the visual call-sign of its
  proximity.
- **L8. Flicker limits** (photosensitive safety; WCAG 2.3.1 as proxy):
  - Fast modulation above 3 Hz stays **< 10 % of intensity**.
  - Larger dips (≥ 10 %) are **≤ 1 per second**, each ≥ 150 ms, ramped.
  - Full-field brightness steps (flashes, explosions, the Flame) ramp over ≥ 100 ms and never repeat more than 3 times
    in 1 s.
  - **Fix needed:** in `_updateEnvLights`, keep the ~0.9–2 Hz swing below 10 % (amplitude ≤ 0.08) and put character
    into slower (< 0.5 Hz) gutters. Ramp the rare ×0.4 dip over ≥ 150 ms instead of stepping it. In the lantern
    formula, either drop the 18 % dip to ≤ 9 % or ramp it, so no 1 s window reaches 3 flash pairs. Re-run
    `plans/scripts/flicker_check.mjs`; the target is ≤ 1 pair per second.
- **L9. Dark adaptation.** After a big light loss (snuffing, lantern doused in Chapter IV's dark), exposure drops
  instantly, then recovers +0.6 EV over 4 s. Never pulse it.
- **L10. Chapter V inversion.** Fog brighter than forms; shadows are shelter. The Flame's light ramps, never flashes.
- **L11. Desktop tier.** Lantern shadow (spot or point with PCF), bloom, GTAO and 6–8 lights. The same art rules apply.

## 8. The Mason: visual identity rules

These are art-direction constraints for the creature-design and rig workflows. Exact proportions belong to them.

| Part | Today | Bible |
|---|---|---|
| **Silhouette** | Uniform box column, straight girders | Three readable postures: **crawl** (long ridge plus a forest of legs), **reared** (a ring of raised arms around a dark opening), **coiled** (a helix around a column). None may read as a head with a face |
| **Plates** | Clean rectangular blocks | Dressed **voussoir-like plates**, irregular, chipped corners, tool marks. **~30 % carry figure reliefs** (hooded backs, raised arms, no faces). One plate per chapter wears **your gauntlets** |
| **Binding** | Rust bands | Wrought-iron straps **bitten into** the stone, riveted, edges worn bright, rust weeping down the stone below them (gravity-true) |
| **Joints** | Gap | **Mortar-flesh**: grey-pink, desaturated (`#8a7069` region), wet sheen (roughness ~0.25), visible only in joints, on the underside and when plates lift. ≤ 15 % of the visible surface |
| **Legs** | 10 straight lattice girders | Two classes. **Hauling legs** (≥ 14 by Chapter I, more as it lengthens): bent lattice-iron upper limb, stone-sheathed lower limb, iron hook, 3 joints plus hook. **Rib legs**: short iron bars, 2 per segment, moving in the metachronal wave and planting only when near a surface. Total visible "legs" ≥ 50, so the centipede reads at 60 m |
| **Crown** | Crenellated block with a jaw option | **Crenellated crown plus stone iris**: 6–8 voussoir leaves that rotate open. Inside: a **receding vaulted "nave-throat"**, arches diminishing into the dark, with the listening pits glowing at the bottom. **No jaw, no teeth** |
| **Fronds** | White wires with glowing dot tips | **Raised arms**: 8–12 carved stone forearms in robed sleeves, open empty palms, fingertips sooted (they once held lamps). Rigid stone joints (2–3 per arm). **No glow on the arms.** They open like a gesture of offering or surrender, and close like hands around a flame |
| **Pits** | 5 glowing pits | 5 deep pits *inside* the crown. The glow is at the bottom, so stereo shows it as depth (VR pays off here). Dilate on listen. Never a cluster of small holes (§2.8) |
| **Scale** | ~24 m | 20 → 32 segments by chapter (E17), ~30 → 48 m. Always staged next to known-size objects |
| **Wear by chapter** | Same everywhere | I slate and soot · II wax runs and soot, ember seams after snuffing · III streaming wet, high specular · IV bone dust, more figures · V chalk-pale |
| **Glow budget** | Pits plus tips | Pits only (plus II's ember seams, C1). The Mason is otherwise lit **only by your light and lamps** |
| **LODs** | LOD1 optional | LOD0 ≤ 70 k tris, LOD1 ≤ 20 k, **LOD2 = silhouette for vista** (`quest.md` §15). LOD2 must still show the leg wave (rib legs as a vertex-animated fringe) |

**Silhouette acceptance tests** (in the headset, Normal fog):
- **(a)** At 60 m, LOD2 crawling across a far wall: 5 of 5 testers call it "a long thing with lots of legs".
- **(b)** Reared at 8 m: nobody reports eyes, a face, antennae or pincers.
- **(c)** Frozen in the periphery outside the lantern pool for 3 s: at least half the testers lose track of it (the
  Troxler goal).

## 9. Mason fear moments (24 beats the rig and AI must support)

### 9.1 Animation architecture (layers)

| Layer | Kind | Contents |
|---|---|---|
| **P-SPINE** | Procedural (sim) | Existing breadcrumb spine and surface crawl (`creature3d.js`): head path, retract along the trail, body length per chapter |
| **P-GAIT** | Procedural | Leg IK plus a **metachronal wave**: wave speed and duty factor scale with crawl speed; retrograde by default, switching on rough surfaces; body undulation phase ~2.5 rad ahead of the leg wave ([Diaz et al. 2023](https://crablab.gatech.edu/pages/publications/pdf/Diaz_et_al_2023_JEB.pdf)). Emits `creature:step` per plant (sound and dust) |
| **P-FOCUS** | Procedural | Crown and arm look-at with a critically damped lag (~0.3–0.5 s), then a small snap on target switch. Targets: head (breath), noisy hand (rope), lantern (want), sound decoy (knock horns, IV) |
| **P-SPRING** | Procedural | Secondary motion: arm sway, hanging chains, dangling mortar strands. Disabled during freezes |
| **P-JITTER** | Vertex shader | Plate shiver (exists as `body.jitter`) and a travelling plate-lift wave |
| **P-TIMESCALE** | Procedural | Per-bone time scale: 0 in the Still Flame's light (V), 1 in shadow. Also drives the "true freeze" |
| **P-HIDE** | Material state | Pits and seams emissive to 0; plates settle flush to the wall normal (camouflage) |
| **P-WORLD** | World shader and lights | Wall-bulge field (up to 2 travelling bulge points as uniforms), Lamp Dip (L7), grit emitters |
| **Base clips** (full body, blended by state) | Authored | `crawl_hold`, `rear_windup`, `coil_grip`, `recoil` |
| **Additive clips** | Authored | `breathe_seams`, `plate_shiver`, `arms_flare`, `arms_reach`, `arms_sweep`, `arms_close`, `pit_dilate`, `iris_open`, `iris_snap`, `listen_freeze`, `knock_x3`, `snuff_close`, `gather_pull`, `take_close` |

Mapping to the rig contract proposed in `three.md` §4: `idle-breathe` → `breathe_seams`, `frond-flare` → `arms_flare`,
`pit-dilate` → `pit_dilate`, **`jaw-gape` → `iris_open`** (no jaw), `lunge-snap` → `iris_snap` plus the P-SPINE thrust,
`recoil` → `recoil`.

### 9.2 The beats

Format for each beat: **what the player perceives** · *staging* · `rig` · AI hook · sync · guard.

1. **The Pour** (vista sighting).
   - **Perceived:** the body pours across a far wall like liquid masonry; the leg wave ripples along it; head and tail
     are never in view together.
   - *Staging:* 60–170 m away, across the Vault's far wall (S4), framed by the catwalk's next anchor.
   - `rig`: LOD2 plus P-GAIT at low frequency; P-SPINE path.
   - AI hook: existing `sighting` trigger and OBSERVING pause, with the crown turning to you mid-path.
   - Sync: scrape audio **delayed by distance / 343 s**; a far plate grind as it turns.
   - Guard: none needed (far).
2. **In the Walls** (bulge).
   - **Perceived:** stone panels beside you bulge outward one after another, dust sifts from the seams, and knocking
     travels with the bulge.
   - *Staging:* 2–8 m, on the walls of S5 and Chapter II, moving parallel to the route.
   - `rig`: P-WORLD bulge field following a hidden path point; no creature mesh.
   - AI hook: E17 hidden `path` (P8).
   - Sync: each knock lands on a bulge peak (≤ 50 ms); controller haptic tick if touching that wall.
   - Guard: bulges ≤ 0.25 m; never on a surface the player stands on.
3. **Grit Rain** (it is above you).
   - **Perceived:** grit and chips fall through the lantern light from above, then the scrape overhead. When you look
     up: legs planting on the ceiling, dark on haze.
   - *Staging:* creature 8–25 m above, within 10 m horizontally.
   - `rig`: P-GAIT on an inverted surface; FX debris emitter at plant points.
   - AI hook: PURSUING or APPROACHING with the head above the player.
   - Sync: grit appears 0.5–1 s before the scrape crescendo; each plant makes a small puff and click.
   - Guard: debris is cosmetic (no hits).
4. **The Lamp Dip.**
   - **Perceived:** lamps dim and their flames lean toward something you cannot yet see.
   - *Staging:* every env lamp within 15 m of the head.
   - `rig`: P-WORLD L7.
   - AI hook: any state with the head < 15 m from a lamp.
   - Sync: a low pressure drone swells in step; the dimming follows the drone's envelope.
   - Guard: L8 ramps; never a strobe.
5. **The Listen** (freeze and track).
   - **Perceived:** everything stops, one leg mid-step, raised. The ring of arms opens wide and **slowly turns to your
     head**. The pits dilate in pulses.
   - *Staging:* 6–25 m.
   - `rig`: `listen_freeze` plus `arms_flare` plus `pit_dilate` loop; P-FOCUS on the head; P-SPRING and
     `breathe_seams` **off**; P-TIMESCALE 0 on the legs.
   - AI hook: existing listen state (`body.listen`).
   - Sync: the scrape bed cuts on the freeze frame; the listening chitter is synced to the pit pulses.
   - Guard: a fair telegraph that the player must be still.
6. **Stone-Still** (Troxler camouflage).
   - **Perceived:** it stops at the edge of the light, pits dark, plates flush. It becomes part of the wall until a leg
     moves.
   - *Staging:* 8–20 m, in the periphery, outside the lantern pool.
   - `rig`: P-HIDE plus a true freeze.
   - AI hook: OBSERVING with a `hide` flag (new) when the player is lit and moving.
   - Sync: drone at −12 dB, never fully silent (it is still in the mix).
   - Guard: never hides within the kill radius × 2. Fairness: audio stays honest.
7. **The Linger.**
   - **Perceived:** the crown comes to **3 m from your head and stays** for 1.5–3 s. The arms sweep the air in front
     of your lantern; the pits draw breath. Then it withdraws.
   - *Staging:* 2.5–4 m, at eye height or just above. On Normal always outside the kill radius (2.6 m).
   - `rig`: `arms_reach` plus `arms_sweep`; P-FOCUS on the lantern, then the head; `pit_dilate`.
   - AI hook: new **LINGER** state. Scripted at the Mark (S9). Systemic and rare (≤ 1 per chapter) when the player is
     perfectly still near a wall.
   - Sync: a pit inhale (suction) on each dilation; rope haptics hum.
   - Guard: ≥ 2.5 m from the eyes on Normal, never < 1.0 m; no sudden motion during the hold.
8. **The Rear** (wind-up telegraph).
   - **Perceived:** the crown rears 1.3 m; the arms flare into a full ring; plates along the first six segments lift
     in a wave; the **iris opens onto the lit nave-throat**.
   - *Staging:* within kill radius × 2.5 (existing `engageMul`).
   - `rig`: `rear_windup` plus `iris_open` plus P-JITTER plate-lift wave.
   - AI hook: existing ATTACK wind-up (0.35–0.75 s).
   - Sync: a rising grind locked to the rear; a stone clack on full open.
   - Guard: the telegraph is always ≥ 0.35 s.
9. **The Snap** (lunge).
   - **Perceived:** the body straightens like a thrown chain and the crown thrusts. On a miss, the iris **snaps shut**
     with a stone clap and the crown hits the wall behind you: chips spray, maybe a lamp shatters.
   - *Staging:* through the space where you were.
   - `rig`: `iris_snap` plus the P-SPINE thrust; FX chips and debris.
   - AI hook: existing strike (`creature:strike`).
   - Sync: the clap is on the visual frame (≤ 30 ms); a chip spray burst.
   - Guard: on a miss the crown never passes within 0.6 m of the eyes (dither-fade any nearer geometry).
10. **Recoil and Scrabble.**
    - **Perceived:** after a miss, a shiver runs nose to tail, and the hooks scrabble to re-grip in a fast, frantic leg
      wave.
    - `rig`: `recoil` plus P-JITTER; P-GAIT at high frequency.
    - AI hook: post-strike and RECOVERING.
    - Sync: a click storm, then quiet.
    - Guard: none.
11. **The False Retreat.**
    - **Perceived:** it withdraws tail-first along its own trail into the dark; sound fades; **six seconds of silence**;
      then a single knock *behind and above you*.
    - `rig`: P-SPINE retract; then relocation on a hidden path.
    - AI hook: the false-lull sequence (P10); a menace-style pacing measure.
    - Sync: silence is total except breath and heartbeat (they never drop out).
    - Guard: audio never lies about where it is; silence may hide it.
12. **The Spiral.**
    - **Perceived:** it coils head-first down the spire past you, legs gripping in a helical wave, debris raining.
    - *Staging:* 6–8 m, at your height (S7).
    - `rig`: `coil_grip` plus P-GAIT on a helix.
    - AI hook: E17 `path` `spiral-s7`, rubber-banded.
    - Sync: plates grind panning behind you, then in front.
    - Guard: bot-verified ≥ 5 m minimum distance (CHAPTERS §5.3).
13. **The Ceiling Crossing.**
    - **Perceived:** it crosses directly overhead upside-down; the arms hang down like a chandelier of hands; one arm
      **brushes your rope**.
    - *Staging:* 4–8 m above.
    - `rig`: inverted crawl; P-SPRING on the arms with gravity; a rope-contact event.
    - AI hook: PURSUING above the player; new `creature:ropeTouch` event.
    - Sync: rope haptic thrum plus a rope-creak spike on contact.
    - Guard: the touch never breaks the rope (cosmetic).
14. **The Rise** (from below).
    - **Perceived:** five faint points of cold light surface out of the fog *beneath* you, then the ring of arms, then
      the crown filling the void below. A **slow** loom.
    - *Staging:* 30 m → 10 m below over 6–10 s.
    - `rig`: a `crown_up` pose (part of `rear_windup` held), P-SPINE climbing.
    - AI hook: `path` or APPROACHING from below. Chapter III variant: through the water surface, with streaming water.
    - Sync: a sub rumble rising in pitch; bubbles (III).
    - Guard: slow expansion only (freeze, not panic).
15. **The Knock Answer.**
    - **Perceived:** it knocks back on the stone in your rhythm, three times. Dust puffs at each knock.
    - `rig`: `knock_x3` on the crown.
    - AI hook: the knock system (E10).
    - Sync: knock, dust and haptic on the same frame.
    - Guard: none.
16. **Plate Turn** (it shows you what it is made of).
    - **Perceived:** as it passes, plates roll a few degrees one after another to face you. The reliefs are hooded backs
      and raised arms. One wears your gauntlets.
    - *Staging:* 5–12 m.
    - `rig`: per-plate roll (procedural, sequential wave), P-FOCUS feeding a plate-facing term.
    - AI hook: authored beats in IV, rare in I–III.
    - Sync: a soft grind per plate.
    - Guard: none.
17. **The Gather.**
    - **Perceived:** it hooks a statue off a shelf with two legs and presses it into a gap between plates; the figure's
      arm stays raised out of its body.
    - *Staging:* 30–40 m, watched from an alcove (IV, the Gathering).
    - `rig`: `gather_pull` (front four legs plus crown); then a plate swap to a new figure-plate.
    - AI hook: `path` beat.
    - Sync: stone grind, then a deep settling knock.
    - Guard: none (it is a watched beat).
18. **Lantern Hunger.**
    - **Perceived:** when you hold the light out, the crown follows **the lantern, not your head**, and the arms reach
      toward it like hands to a fire.
    - `rig`: P-FOCUS on the lantern; `arms_reach`.
    - AI hook: chapters IV–V and the Mark; any LINGER.
    - Sync: pit inhale on reach.
    - Guard: none.
19. **The Snuff.**
    - **Perceived:** the arms close around a lamp; the light dies with a soft pop and a puff of ash; its pits flare warm,
      then go cold.
    - `rig`: `snuff_close` (= `arms_close`); C1 pit hue shift.
    - AI hook: the Snuffing `path` (II).
    - Sync: the pop is on the frame the light goes to 0; a dark-adaptation dip (L9).
    - Guard: L8 ramps.
20. **Seam Breath.**
    - **Perceived:** at rest, the mortar seams exhale grit in a slow rhythm and the plates rise and fall a few
      centimetres. Grit puffs drift at the edge of your light before you see it.
    - `rig`: `breathe_seams` loop (~0.2 Hz) plus a seam particle emitter.
    - AI hook: DISTANT, OBSERVING, RECOVERING. **Off in Listen** (#5), so the contrast tells.
    - Sync: a dry exhale hiss per cycle.
    - Guard: none.
21. **The Leg Forest** (peripheral pass).
    - **Perceived:** it passes behind a colonnade at the edge of your view; only the wave of legs shows through the
      gaps.
    - *Staging:* 6–15 m, in the periphery (S6, II).
    - `rig`: P-GAIT; occluders do the work.
    - AI hook: PURSUING alongside the route.
    - Sync: click rhythm matches the leg wave.
    - Guard: keep the gap-pass rate for high-contrast backlit legs < 3 Hz (L8).
22. **Tail Pay-out.**
    - **Perceived:** the head is long gone, and the body is *still coming* out of the breach.
    - *Staging:* IV, the Gathering.
    - `rig`: P-SPINE length per chapter; LOD swap along the body.
    - AI hook: `path`.
    - Sync: a continuous grind that will not end.
    - Guard: none.
23. **Stilled.**
    - **Perceived:** in the Flame's light it locks mid-motion and the motes around it freeze. In shadow it moves in
      sudden lurches, like stop-motion.
    - `rig`: P-TIMESCALE per bone (lit bones are 0).
    - AI hook: E23 stillness (V).
    - Sync: the scrape cuts per lit section of the body.
    - Guard: lurches are translation only, ≤ 1 m per step near the player.
24. **The Taking** (Mason kill).
    - **Perceived:** the ring of arms closes around your view from the edges inward, like an iris; darkness falls in
      from the periphery; then the fade. Later, a new figure-plate appears in its body: *it wears you now*.
    - `rig`: `take_close`; death fade.
    - AI hook: `creature:strike` with `hit` true.
    - Sync: stone closing; the heartbeat stops on the frame the fade completes.
    - Guard: the fade completes **before** any geometry is closer than 0.8 m; no flash; the brightness step is ramped.

**Coverage check.** Beats per chapter at minimum: I = 1–12, 15, 20, 24 · II = 2, 4, 19, 21 · III = 14, plus 5 under
water · IV = 16–18, 22 · V = 18, 23. No scripted beat repeats in the same form (dread grammar rule 4). Systemic beats
(3–10, 20) recur through the AI and play out differently each time.

## 10. Material rules

| Class | Albedo (sRGB) | Roughness dry → wet | Metal | Notes |
|---|---|---|---|---|
| Masonry (sandstone or limestone) | 90–160 | 0.85 → 0.35 (film) | 0 | Wet albedo × 0.55–0.7 (porous) **(design values informed by Lagarde / LabPBR)** |
| Slate or dark stone | 55–90 | 0.75 → 0.25 | 0 | Wet albedo × 0.7 |
| Statue stone (the Kept, figure-plates) | 120–170 | 0.6 polished at touch points | 0 | Soot on fingertips and lantern hands |
| Wrought iron | 50–70 (dielectric rust over metal) | 0.55, worn edges 0.3 | 0.6–1 at worn edges | Rust weeps *down* the stone below |
| Brass (II) | metal F0 | 0.35, handled areas 0.2 | 1 | Polished where touched |
| Wax (II) | 200–230 warm | 0.4 | 0 | Wrap or back-lighting fakes translucency near flames |
| Mortar-flesh (Mason) | 110–140 grey-pink | 0.25 constant (always wet) | 0 | Wrap lighting plus a lantern back-light rim; no pores, no veins |
| Bone and chalk (IV) | 170–200 | 0.9 | 0 | Bone dust settles on tops |
| Water (III) | n/a | 0.02–0.05 | 0 | Fresnel plus per-section PMREM; ripples from normal scroll |
| Gauntlets (player) | 60–110 leather, 70 iron | 0.5 / 0.35 | mixed | **Highest texel density in the game** (≥ 1024 px/m); greying stone creep (E08) |

**Rules:**
- **M1. Wetness by depth.** Wetness rises with depth in Chapter I (S1 0.1 → S8 0.7). Chapter III is soaked. Chapter IV
  is dry. Drips mark local wet patches, and wet zones darken *below* drip points.
- **M2. Gravity-true wear.** Soot up, stains down, grime in AO corners, polish at contact. Pilgrims' rope grooves
  on rings, polished handholds.
- **M3. Texel density** per §1: ≥ 1024 px/m in the hands, rope and anchors; ≥ 512 px/m on route walls within 3 m;
  256 px/m at 3–10 m.
- **M4. No black albedo.** Darkness is lighting.
- **M5. One tiling texture never covers more than ~4 m** without a detail or variation layer (macro variation, decals,
  vertex-colour grime), so repetition never shows.
- **M6. The Mason's materials match the world's:** the same stone, iron and statue stone. It is made of the building.
  Only mortar-flesh is unique to it.
- **M7. Phosphor anchors** keep their identity in every palette (CHAPTERS §3.2.6). Mason hooks are never phosphor.

## 11. Comfort and safety rules

The owner decided on no locomotion comfort filters. These rules are *safety and quality*, not comfort options.

- **S1. Flash safety.** L8 everywhere: lamps, lantern, impacts (`game.flash`), the Flame, glyph pulses. Desktop and XR
  alike. Check against ISO 9241-391 / WCAG 2.3.1.
- **S2. Near-eye.** No world or creature geometry within 0.6 m of the eye point (dither fade); no particles within
  0.5 m; the death fade completes before contact.
- **S3. Startle budget.** ≤ 1 *loud* startle (an audio peak plus a sudden close visual) per ~5 minutes, and never in the
  rest space after a set-piece (CHAPTERS §3.1.2). Dread beats (listen, linger, rise) are unlimited but paced by the
  menace measure.
- **S4. Slow loom near, fast loom only with a telegraph.** Every fast approach inside 8 m is preceded by beat #8.
- **S5. No forced view.** Nothing rotates or locks the view; gaze only times reveals.
- **S6. Trypophobia-safe.** Pits stay few and large; no hole-cluster textures.
- **S7. `reducedEffects` (existing setting) reduces intensity, not difficulty:**
  - lamp and lantern flicker off;
  - particle density halved;
  - Linger distance +1 m;
  - stinger peaks −6 dB;
  - wall bulges −50 %;
  - the dark-adaptation dip shallower.
- **S8. Store and in-app warnings.** A flashing-images warning ([Meta notice](https://www.oculus.com/legal/horizon-flashing-images-warning))
  and an intense-horror content note in the description.

## 12. VFX list

Budgets: ≤ 4 particle draws, ≤ 3 k live particles, ≤ 25 % blended coverage (`quest.md` §16).

| # | Effect | Trigger | Implementation | Tier |
|---|---|---|---|---|
| V1 | Lantern-lit motes per chapter (dust, soot and embers, mist, bone dust, stilled motes) | Always | Upgrade `fx.js` points: brightness from lantern distance, depth-based size | Q + D |
| V2 | Grit rain and seam sifting | Mason above; `rumble` and `debris` triggers; wall bulge | Instanced streak quads | Q + D |
| V3 | Drips (streak, splash ring, glint) | Authored drip points; Chapter III everywhere | Points plus decal ring; audio per drip | Q + D |
| V4 | Light shafts | Chapter I teal shafts; Chapter V beams | Additive cone cards with scrolling noise and motes | Q + D |
| V5 | Lamp halos (fake bloom) | Every lamp, the pits, the Mark Lamp | Billboards with occlusion fade (exists, extend) | Q; D adds real bloom |
| V6 | Lantern cookie (cage bars) | Always | Shader term in the lantern lighting | Q + D |
| V7 | Height fog pools and water mist | Chamber bottoms, the Mere | Analytic term in the fog chunk | Q + D |
| V8 | Sparks and embers | Grapple on iron (exists); snuffs; Chapter II | Existing burst system | Q + D |
| V9 | Debris chunks | Mason through structure; misses (#9) | Existing InstancedMesh | Q + D |
| V10 | Seam breath puffs | Beat #20 | Burst emitter at seam bones | Q + D |
| V11 | Leg-plant dust and chips | `creature:step` within 20 m | Burst, 4–8 particles per plant | Q + D |
| V12 | Wall bulge | Beat #2 | Vertex displacement uniforms on wall instances | Q + D |
| V13 | Snuff puff | Beat #19 | Ash plus a smoke curl card | Q + D |
| V14 | Water ripples, splash crowns, bubbles | Chapter III | Normal scroll, ring decals, points | Q + D |
| V15 | Stilled particles | Chapter V light | Particle time scale from the light mask | Q + D |
| V16 | Stone creep (greying) | Remnants (E08), Mark cradle | Shader mask on gauntlets and bodies | Q + D |
| V17 | The Taking iris | Beat #24 | Head-locked ring of closing occluder plus fade sphere | Q + D |
| V18 | Shaft breath | Wind bed | Fog density and mote drift modulated at < 0.2 Hz | Q + D |
| V19 | Wet-rope drips and fray fibres | Chapter III; frayed rings | Rope-attached points | Q + D |
| V20 | Desktop extras | Desktop | Real bloom, GTAO, lantern shadow, more motes | D |

## 13. Set-dressing rules

- **D1. Three zones per frame.** The personal zone gets stereo-true props (railings, chains, brackets, statues). The
  action zone gets kit relief on walls. The vista gets ≥ 1 silhouette per section.
- **D2. Route density.** Within 15 m of the main route, per 10 m of descent: ≥ 1 story prop, ≥ 4 secondary props, and
  relief on every wall face within 10 m **(design target)**, all instanced (`quest.md` draw budgets).
- **D3. Voids stay empty.** Nothing floats in the abyss except motes, falling debris and authored silhouettes.
- **D4. Known-size props at every Mason reveal point:** doorway, statue, lamp, chain.
- **D5. Story props follow the canon:** statues (13 in Chapter I, one language), tally marks, dropped lanterns,
  scaffolds swallowed by masonry, rope grooves.
- **D6. No raw box within 30 m of the route.** Every collision box gets a kit dress (collision stays boxes, CHAPTERS
  §3.2.7).

## 14. Sound–visual sync rules

- **A1. Contact sync.** Audio never before the visual; ≤ 100 ms after (Dixon & Spitz thresholds, §2.5).
- **A2. Far events** are delayed by distance / 343 s, capped at 0.6 s.
- **A3. Every visible Mason motion near the player has a sound.** Plant: click and grind. Plate: grind. Arms: dry stone
  scrape. Pits: suction. Iris: clack.
- **A4. Every Mason sound within 25 m has a visible correlate** when in view: dust per step, lamp dip per call, seam
  puff per breath.
- **A5. Freezes cut sound and motion on the same frame.**
- **A6. Haptics are the third channel:** leg plants within 10 m (light tick), rope touches (thrum), knocks (three
  taps), wall bulges under a gripped wall.
- **A7. Pre-cues come from the exact place of the coming appearance.**
- **A8. Breath and heartbeat never drop out,** so silence never sounds like a bug (CHAPTERS §3.2.3).

## 15. How we prove "10×" (acceptance)

1. **Ten postcard shots**, captured on a Quest 3 at every milestone from fixed poses, before and after. These double as
   trailer frames (CHAPTERS §3.1.11):
   - S1 colossus window;
   - S4 Vault Pour;
   - S5 bulging wall;
   - S7 Spiral pass;
   - S9 Linger;
   - II lit town;
   - II Snuff;
   - III Rise through water;
   - IV Gathering;
   - V Stilled in white.
2. **Blind preference test.** Testers rate before and after shots in the headset (5-point quality and fear scales).
   Target: ≥ 80 % prefer the new build on every shot.
3. **Measurable deltas:**

   | Measure | Before | After |
   |---|---|---|
   | Texel density near the route | ~64 px/m | ≥ 512 px/m |
   | Raw boxes visible within 30 m | many | 0 |
   | Mason deformation | 65 rigid parts | skinned, ≤ 256 bones, LOD0 ≤ 70 k tris |
   | Authored creature clips | 0 | ≥ 14 |
   | Fear beats supported | ~5 | 24 |
   | Wet-surface coverage on route walls | none | per M1 |

4. **Silhouette tests** (§8) and **flash test** (L8, S1) pass.
5. **Performance gate** unchanged: 72 fps p95 on Quest 3 (`quest.md` §19).

---

## Sources

**Hardware and display**
- UploadVR, Quest 3 specs: https://uploadvr.com/quest-3-specs
- Meta, Quest compare: https://www.meta.com/ie/quest/compare/
- MIXED, Quest 3 adaptive display dimming: https://mixed-news.com/en/meta-quest-3-adaptive-display-dimming/
- MIXED, display dimming hands-on: https://mixed-news.com/en/meta-quest-display-dimming-hands-on/
- Sibling reports: `quest.md` and `three.md` in this folder (budgets, multiview, post-processing, shadows, particles,
  skinning)

**Lighting, colour and darkness**
- ASC, Shot Craft: Halloween Horrors: https://theasc.com/article/shot-craft-halloween-horrors-creating-visual-cues-to-foster-fright/
- Low-key lighting reference: https://melies.co/cinematic-techniques/lighting/low-key
- Valdez & Mehrabian 1994, Effects of color on emotions: https://pubmed.ncbi.nlm.nih.gov/7996122/
- Wilms & Oberfeld 2018, Color and emotion: https://www.staff.uni-mainz.de/oberfeld/downloads/Wilms-Oberfeld2018_Article_ColorAndEmotionEffectsOfHueSat.pdf
- Grillon et al. 1997, Darkness facilitates the acoustic startle reflex: https://eurekamag.com/research/074/708/074708546.php
- Grillon et al. 1998, Darkness and startle in PTSD (Am J Psychiatry): https://ajp.psychiatryonline.org/doi/10.1176/ajp.155.6.812
- Playdead, Low Complexity, High Fidelity: The Rendering of INSIDE (GDC): https://gdcvault.com/play/1023783/Low-Complexity-High-Fidelity-INSIDE
- Banding and dithering (Game Developer): https://www.gamedeveloper.com/design/banding-and-dithering

**Materials and scale**
- fxguide on Lagarde's wet environments: https://www.fxguide.com/?p=43362
- Jensen et al. 1999, Rendering of Wet Materials: https://groups.csail.mit.edu/graphics/pubs/wet_materials_egwr99.pdf
- LabPBR porosity: https://github.com/rre36/lab-pbr/wiki/Specular-Texture-Details
- Body-based scaling in VR (Frontiers in VR 2022): https://www.frontiersin.org/journals/virtual-reality/articles/10.3389/frvir.2022.869603/pdf
- Ogawa et al. 2019, hand realism and object size: https://paper.nweon.com/8921

**Perception, fear and attention**
- Grupe & Nitschke 2013, Uncertainty and anticipation in anxiety: https://pmc.ncbi.nlm.nih.gov/articles/PMC4276319/
- Yilmaz & Meister 2013, looming response: https://meisterlab.caltech.edu/documents/8117/yilmaz_2013_looming_response.pdf
- BMC Biology 2020, looming speed and defensive behaviour: https://bmcbiol.biomedcentral.com/articles/10.1186/s12915-020-00825-0
- Proxemic threat and physiology (arXiv 2508.10586): https://arxiv.org/abs/2508.10586
- Scientific Reports 2021, personal space in VR and reality: https://link.springer.com/article/10.1038/s41598-021-99578-1
- Sitzmann et al. 2018, Saliency in VR: https://graphics.unizar.es/papers/Sitzmann_TVCG2018_VRsaliency.pdf
- Meehan et al. 2002, Physiological measures of presence: https://www.cs.uky.edu/~sgware/reading/papers/meehan2002psysiological.pdf
- Cutting & Vishton's distance zones, summarised in Frontiers in Human Neuroscience 2015: https://www.frontiersin.org/journals/human-neuroscience/articles/10.3389/fnhum.2015.00511/full
- Peripheral flicker salience (Frontiers in Neuroscience 2021): https://www.frontiersin.org/journals/neuroscience/articles/10.3389/fnins.2021.683153/pdf
- Peripheral sluggishness for fast motion (i-Perception 2020): https://journals.sagepub.com/doi/10.1177/2041669520937029
- Kanai & Kamitani, Troxler fading: https://bicr.atr.jp/~kmtn/pdf/KanaiKamitaniJCogNeuroPre.pdf
- Bonneh et al. 2014 (PLOS ONE), Troxler and contrast: https://www.plosone.org/article/info%3Adoi%2F10.1371%2Fjournal.pone.0092894
- Troje & Westhoff, "life detector" (BioMotion Lab): https://www.biomotionlab.ca/the-inversion-effect-in-biological-motion-maybe-there-are-two-of-them/
- Öhman, Flykt & Esteves 2001, Detecting the snake in the grass: https://pubmed.ncbi.nlm.nih.gov/11561921/
- Langton, Watt & Bruce 2000, Cues to the direction of social attention: https://storre.stir.ac.uk/bitstream/1893/21045/1/LangtonWattBruce_2000.pdf
- Mori 1970, The Uncanny Valley (IEEE Spectrum translation): https://spectrum.ieee.org/the-uncanny-valley
- Cole & Wilkins 2013, Fear of holes: https://repository.essex.ac.uk/7734/
- Fear-potentiated startle (overview): https://en.wikipedia.org/wiki/Fear-potentiated_startle

**Sound–visual sync**
- Maempel 2011, reporting Dixon & Spitz 1980 thresholds: https://www.simpk.de/fileadmin/user_upload_sim/Dokumente/Forschung/Themen/Abteilung_III/Publikationen/Heide_Maempel_2011_Die_Wahrnehmung_audiovisueller_Synchronitaet_in_elektronischen_Medien.pdf
- arXiv 2212.01686, audio-video desynchronization acceptability: https://arxiv.org/pdf/2212.01686

**Creature locomotion**
- Diaz et al. 2023 (JEB), centipede locomotion: https://crablab.gatech.edu/pages/publications/pdf/Diaz_et_al_2023_JEB.pdf
- SICB, coordination of body undulation and leg wave in centipedes: https://sicb.org/?p=39562

**VR horror design and staging**
- Game Developer, The Perfect Organism: the AI of Alien: Isolation: https://www.gamedeveloper.com/design/the-perfect-organism-the-ai-of-alien-isolation
- GDC Vault, Building Fear in Alien: Isolation: https://gdcvault.com/play/1021852/Building-Fear-in-Alien
- GDC Vault, Postmortem: VR Development of Paranormal Activity: https://gdcvault.com/play/1024879/Postmortem-VR-Development-of-Paranormal
- Bloody Disgusting, Valve on VR and horror (Half-Life: Alyx): https://bloody-disgusting.com/interviews/3609928/interview-valve-discuss-vr-accentuates-horror-half-life-alyx/
- Game Developer, jump scares according to horror devs: https://gamedeveloper.com/design/the-time-and-place-for-jump-scares-according-to-horror-devs
- Game Developer, Here They Lie and the ethics of VR horror: https://www.gamedeveloper.com/design/-i-here-they-lie-i-and-the-ethics-of-vr-horror
- Vive blog, Creating horror in VR: https://blog.vive.com/us/creating-horror-vr/
- Lin 2017, Fear in VR (Computers in Human Behavior 72), DOI 10.1016/j.chb.2017.02.057: https://ah.lib.nccu.edu.tw/handle/140.119/110472

**Comfort and safety**
- W3C, WCAG 2.3.1 Three Flashes or Below Threshold: https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html
- Meta developer best practices (ISO 9241-391 reference): https://developers.meta.com/horizon/resources/bp-overview/
- Meta flashing-images warning: https://www.oculus.com/legal/horizon-flashing-images-warning
- Microsoft Mixed Reality comfort (minimum hologram distance): https://developer.microsoft.com/windows/mixed-reality/comfort
- Meta comfort ratings: https://www.meta.com/help/quest/331713305046406/
- Meta Horizon Store policies: https://developer.oculus.com/policy/store-policies
