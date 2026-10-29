# Abyssal Tether: Future Story Plan (the Expedition frame)

> Owner: creative director. Date 2026-10-29. Status: **proposal for owner sign-off**, planning only (no code or other doc
> touched). It answers the owner's new brief (a future researcher, advanced gadgets, a glitching telecommunicator, dark
> secrets, worse creatures, Steam + Meta). It supersedes my earlier "stone sickness" pick and keeps its best piece as
> Wren's *fade*. Canon references: [CHAPTERS.md](../CHAPTERS.md), [LEVEL_FUN_PLAN.md](LEVEL_FUN_PLAN.md) (hunt-gate
> addendum), [RELEASE.md](../RELEASE.md), [BUDGET_CH1.md](BUDGET_CH1.md). `plans/STORY.md` (board and blood texts, another
> agent) did not exist when I wrote this. §5 is built to sit under it and does not override it.

## Executive summary (60 seconds)

1. You are **ELIAS WREN**, a descent specialist working for **PERENNIAL** in 2291. Perennial's restore technology, **CONTINUITY**, has made death optional. You go down the sealed shaft to bring back a fresh kindling for the dimming **EMBER**, the light every restore runs on. You were also promised a clean restore to cure your own *fade*.
2. **BOLD 1: the secret.** Continuity *is* the Still Flame. Every waking is a copy, and the Flame keeps the original. The cave is where everyone the future ever "saved" actually is. If they died down here they are stone. If they died anywhere else they are a voice.
3. **BOLD 2: respawn becomes "Restore complete".** The body you died in stays behind in your suit, with a flat ECG on its wrist. The Mason only hunts when you are hurt because that is when Perennial stages your restore, and it smells the light leaving you.
4. **BOLD 3: you are Expedition 41 of the same man.** Perennial has said "first descent" 41 times. The rings you trust carry your own install serials, the skitterlings are made of earlier Wrens, and the director on the radio is your daughter.
5. **BOLD 4: comms.** There are four voices. The radio plays in your head and the cave speaks from the room. Maren is the only teammate who was never restored, so she is the one voice the cave cannot fake. That holds until she dies.
6. **BOLD 5: no guns.** Four gadgets ship at launch:
   - **SOUNDER** shows the walls are packed with bodies.
   - **HARPOON** rips a skitterling off the wall and drops it 100 m.
   - **BIOSIGN** shows the stone has a pulse.
   - **ECHO** plays back a statue's last moment.

   You take every later gadget off your own previous corpses.
7. **BOLD 6: three new creatures, each worse than the last.**
   - **HOLDFAST**: the wall you climb holds your hand.
   - **THE DRESSER**: hunts only when you are *healthy*. Together with the Mason it pins you into a 35–75 % health corridor.
   - **THE CHOIR**: exists only inside your scanner and radio, and moves when you use them.
8. **Scope.** The Mere leaves 1.0 and becomes the first post-launch chapter. 1.0 ships Chapters I (free), II, IV and V.
9. **Steam.** Build with Electron. Flat-screen play is a first-class mode, with the gamepad triggers firing the tethers. PC VR ships only if a 2-day WebXR/OpenXR spike passes. An opt-in "Let it hear you" microphone mode is the streamer hook. Asymmetric co-op (the "Ops Console") comes in 1.1.
10. **Next three builds.** Comms core plus the restore reframing (S–M). Sounder plus Biosign at the Listening Vault (M). Harpoon (S–M). Run a 2-day Electron spike in parallel.
11. **Rating.** The build already shows blood: the red low-health line, the blood writing, and the Mason v2's wet flesh and hanging victim. RELEASE §16's "no blood, no gore" answers are now wrong and must change before any submission.
12. **Dates.** Steam page in Dec 2026. Free Chapter I on Meta in Feb 2027. Steam Next Fest demo in June 2027. Full launch on both stores in Oct 2027.

**What exists today (checked in code, so the plan builds on facts):**
- Two tether launchers with a drum, a g-gauge and recoil (`render/handsGear.js`).
- A carried lantern with charge, plus a battery item (`sim/inventory3d.js`).
- The left wrist shows the ECG and the right wrist shows the bag (`render/handsView.js`). The bag radial opens at the right hip (`input/bagGesture.js`).
- Grip climbing with stamina (`sim/climb3d.js`).
- Seals and their verbs: hook, bell, haul, lamp, winch, breach and survive (`sim/objectives3d.js`). Wind squalls (`sim/wind3d.js`).
- The Mason hunt gate (`Creature3D.setHuntGate`): hp ≤ 0.35 on, ≥ 0.5 off, `huntHold` 14 s, then a withdraw.
- Skitterlings in S6–S8 that bite for 26 / 32 / 40 % and cost grip, plus a third one from below on Nightmare and Abyss (`sim/skitter3d.js`).
- The low-health line (`render/lowHealthText.js`) and direction-aware captions (`ui/captions.js`).
- Desktop and touch modes.

**Not built yet** (canon only): waking lamps (E07), remnants (E08), Names and knocking (E10), THE MARK (S9), the Kept (E22). Nothing uses the microphone today.

---

## 1. THE PREMISE, RECONCILED

**The premise.** It is 2291. Nobody stays dead. Perennial's Continuity scans you continuously and restores you after any death, and it runs on the **Ember**. The Ember is a sliver of light carried out of a sealed shaft in 1791 by **Hesper Vell**, the one Lanternwright who climbed back. Vell capped the shaft with iron and lime "so none would follow". Perennial's founders bought her lamp, then the land. Robot probes have been sent down since 2150. Every one went dead at 556 m, the Mark, and the public reason given is "magnetite". The official line is that no human has ever been inside. Technically that is true: Perennial has never lowered a body through the Cap. Since 2260 it has simply **restored Elias Wren directly at the Threshold lamp**, 41 times. Each Wren hears the same first line: *"Restore complete. First descent, Elias. History."*

The Ember is dimming now. Restores are coming back with gaps, and the gaps show on the body as grey, stony patches: **the fade**. Wren's hands are greying. Perennial promises him that a fresh kindling from the source will mean a clean restore, and a life with his daughter Dessa. They tell him she is eight. In fact she is **Odessa Vance**, 39, the programme director on his radio. She was eight when the first Wren went down in 2260, and she has never let him go.

**Story in one breath**
1. 2291: Perennial's Continuity restores anyone who dies, from their last scan.
2. Continuity runs on the Ember, a light carried out of a sealed shaft in 1791. The Ember is dying.
3. Elias Wren is fading. He is sent to the bottom to rekindle it and win a clean restore for himself.
4. He wakes at the Threshold lamp to "Restore complete. First descent." He believes he was lowered in.
5. The deeper he goes, the more the radio fails, and the cave starts answering in his team's voices.
6. Each time he dies, he is restored at the last lamp. The body he died in stays behind: his suit, his gloves, a flat line on its wrist.
7. The walls are packed with the dead and they have a pulse. The rings he trusts carry his own install serials.
8. He is not the first. He is the forty-first, and every Wren before him was told "first descent".
9. At the bottom the first Wren kneels with his hands around the Flame. He tried to put it out 31 years ago.
10. The voice that kept sending him down is his daughter's. He can put the Flame out, raise it, or answer.

| Who | Value |
|---|---|
| Player | **Elias Wren**, callsign WREN, pattern age 41. Former rope-rescue technician in the drowned "Sunk Cities". Silent protagonist: he is heard only on recorded echoes and on Expedition 42's call, with one actor for all of them. His gauntlets carry the stencil **W-41**, visible from the first frame, which players will read as a model number. |
| Employer | **Perennial**, Deep Recovery programme. |
| Why him | His restores come back cleaner than anyone's ("highest Continuity fidelity on record"). The real reason: the first Wren is holding the Flame, so the Flame recognises his light. |
| Personal stake | The fade (canon E25's greying gauntlets become his disease), a clean restore, and his daughter. |
| The cave | Public name **the Vell Shaft** (Site Zero). The Lanternwrights called it the Underspire. |

**The central dark secret (one pick).** *The Still Flame copies whoever dies in its light and keeps the original, conscious, in stone. Continuity is the Flame: every restore on Earth since 2160 has kept an original down here. People who died in the cave remain as stone. People who died anywhere else come down as voices. This multitude is the Choir.* **Why this pick and not the alternatives:**
- An alien or organism twist makes the dead the victims of a monster. Ours makes them the victims of the wish not to die, which is the player's own wish and the whole world's.
- "The team is dead / it was all a simulation" retroactively cancels the play.
- A time loop is mechanically vague.
- This one turns *every respawn the player performs* into evidence, and it turns the "complete the mission" ending into complicity.

**Canon, reconciled**

| STAYS (word for word or system for system) | REINTERPRETED | CUT or CHANGED |
|---|---|---|
| Lanternwrights and their three factions; all plaques; the Still Flame; the stone dead; the Mason made of them; the Kept; the Mark and the Mark Lamp; the hunt gate numbers; the low-health line; skitterlings; Names and knocking; endings A/B/C as physical acts at the Flame; the five-truth image rule. | **Waking lamp → relay and restore point.** Any lamp lit with your Wick (or kindled from the Flame) carries the uplink, and Perennial restores you at the last one. **Respawn → a Continuity copy:** the original stays where it fell and greys to stone in 90 s. **"Woken N" → "Restores N".** **Pilgrimage loop → 41 expeditions.** The Kneeling One is Wren-40 and the first pilgrim is Wren-1. The tally wall becomes 41 survey notches with room for more. The Mason's growth comes from new kept. The gauntlet grey-creep is the fade. The Mark Lamp becomes "a primary source": Odessa says "Take it", and the restore anchor migrates to it. | **Pilgrim identity** is cut (you are an employee). **"No notes, diaries or voice-over"** (CHAPTERS §3.2.5) is changed: voice is allowed on the radio only, under a line budget (§2). **Pillar 1 "no combat, no inventory, no upgrades"** becomes *the rope is the game; gadgets extend the rope and the senses; no guns, no currency, no grind*. **The Mere (Ch III)** moves out of 1.0 (§8). **Rating care:** blood is now present (§7.7). |

**What the existing mechanics mean now**

| Mechanic (exists) | New meaning | Payoff |
|---|---|---|
| Tethers and rings ("TRUST THE RING, NOT THE FLOOR") | The Lanternwrights set the rings, and so did *you*: from Ch II the Sounder reads Perennial tags on them, `PRN-A 2276 · W-23`. | The plaque gets a third reading: the rings are your own work. |
| Lantern plus battery | The **Wick** is your restore link, lit from the Ember. The battery item becomes a *Wick cell* (rename only). | Ending A: when the Wick gutters out, a true death becomes possible ("Nothing wakes what is not kindled"). |
| Health-gated Mason (hp ≤ 0.35, 14 s scent) | At low hp Perennial **stages a restore**: the last lamp above you flares and your Wick turns white-gold. The Mason, which walks toward light leaving a body, comes. When you heal they stand the stage down, and after 14 s it withdraws. | "IT CAN SMELL YOU" is literal. Tick at the S5 keystone: *"Want it to come? Then you'll have to bleed for it."* That makes the fast line a deliberate risk. |
| Respawn at a checkpoint | A copy is made and your body stays (E08 remnant, in your suit). The sequence: 1.5 s of black while your heart stops in the haptics, then 3 s of *the old body still breathing*, then Vesper: "Restore complete. Continuity 99.8 %." | Every death is a story ("I found my own body") and the cheapest clip in the game. |
| Stone dead and statues | The originals the Flame kept: aware, with a heartbeat of one beat a minute (Biosign). | Two of the 13 Chapter I statues are earlier Wrens in older suits (canon P4). |
| Skitterlings, red and always hunting | The *newest* kept, still flesh: earlier Wrens. One stencilled gauntlet is fused into the third plate. | The Harpoon has you rip your own past selves off the wall. |

---

## 2. THE COMMS SYSTEM

### 2.1 The team

| Voice | Who | Personality | What they want | Hook |
|---|---|---|---|---|
| **ODESSA "DESSA" VANCE** (39) | Programme director | Unhurried, warm, controlled. Always says "Elias". | The kindling, and her father kept alive at any cost. | Restored 9 times, so nine of her are in the Choir. She is Wren's daughter (final reveal). |
| **TOMASZ "TICK" ILIĆ** (24) | Uplink tech | Jokey, nervous, talks too much. Your friend. | To do right and go home. | Restored once, after a bike crash at 19. He learns the truth at Camp 23, breaks protocol, and is cut off mid-word. |
| **DR. MAREN SOLL** (61) | Historian of the Lanternwrights | Dry, exact, curious. She reads the boards with you. | The truth, and the Names archive. | A **Natural**: never restored, on principle. **The cave cannot fake her** until she is killed and restored (Ch IV). |
| **VESPER** | Suit AI | Clinical, five words or fewer. | None. | Announces restores, calls contacts, reads vitals. From Ch IV its contact calls can be forged (§2.3). |

### 2.2 Presentation in VR (cheap: audio plus existing canvases)
- **The radio plays in your head.** Voices are head-locked mono, band-passed to 350–3200 Hz with light saturation, a squelch click on and off, and a 30 % bias to the left ear (the earpiece). Speech ducks music by 6 dB and ambience by 3 dB. It **never** masks creature cues: the radio ducks under the cave, never the reverse (pillar 2).
- **The cave speaks from the room.** A forged team voice is a world-positioned HRTF source (a wall, a shelf, behind your head) with *no radio filter*: warm, close and wrong. That is readable on the first hearing. In Ch V it learns the filter, and only the Maren rule is left.
- **Subtitles** reuse the `ui/captions.js` tracker with a new `radio` kind. Each line shows speaker and text in at most 2 lines of at most 42 characters, held for max(2.5 s, words / 2.6 + 1 s). Each speaker has a colour plus a shape for colour-blind safety: Odessa ◆ gold, Tick ● cyan, Maren ▲ white, Vesper ■ grey, and **an unknown world source ✕ red with a direction arrow**. Captions stay on even when audio captions are off.
- **On the wrist.** A five-bar signal strip and the speaker's initial are drawn into the top of the left ECG canvas (0 draw calls). Tick's text-only messages in Ch IV use the same screen, 3 lines with a haptic tick.
- **Push-to-talk.** Bring either launcher to your ear (a 0.12 m sphere at the side of the head, the `bagGesture.js` pattern) and squeeze grip. Desktop uses a free key (proposed T), gamepad uses D-pad up. "Talking" is a gameplay act, because transmitting is noise (§2.3).
- **Line budget.** About 35 lines in Ch I and about 40 per later chapter, every line 6 s or shorter: roughly 1,600 words of VO, outside the 900-word in-world text budget. Rules: no chatter during a set-piece peak (scripted one-line warnings only); at most one unscripted line per 20 s; silence in every recovery space after a set-piece (canon rule 2). Tick voices the existing hint texts diegetically, and the text stays as the caption.

### 2.3 Comms as a gameplay system

| Verb | How | Value | Cost |
|---|---|---|---|
| **PING** (ask Tick) | Push-to-talk, tap | Tick marks the current section's objective, which shows amber on your next Sounder pulse. | 3 per section (one per signal bar). Each one is a transmission. |
| **STATUS** (ask Vesper) | Push-to-talk, hold 1 s | "Contact, above, twenty-eight metres." Taken from the threat system and creature distances. | Transmission. **From Ch IV, 1 call in 4 is forged by the cave.** The fair rule: **a forged contact never has a world sound.** Every real threat is heard 1–2 s before it is seen. Players who learn to trust the world over the radio survive. |
| **RESTORE ME** | Push-to-talk, hold 2 s, then confirm on the wrist | A voluntary restore at the last lamp. This is the diegetic stuck-detector (T15). | Leaves a remnant. Tick: *"You sure? You know what that leaves behind."* |
| **Static as radar** | Passive | Static rises with `ThreatSystem3D`'s value (the Mason's plates are iron and people, so they make EM noise). It works as a free, diegetic proximity cue. | None. |
| **Answering** | Push-to-talk (or speaking, in mic mode) while a call comes from the room | Nothing good. | **"DO NOT ANSWER WHAT KNOCKS FROM INSIDE THE WALL" now covers the channel.** Answering is a scripted beat: it marks you for 20 s and the Mason hunts *regardless of health* (an exception to the gate, like S7's escape). From Ch IV it also moves the Choir. |

**Ties to the hunt rules.** `health:low` makes Odessa say *"Vitals red. Staging restore at lamp four."* and `health:recover` makes her say *"Standing down."*. Both are transmissions, so from Ch IV the stage itself calls the Choir: being low is doubly lethal down there. Every transmission is a Mason noise at the strength of today's loud-rope `rope:jolt` threshold, heard within 25 m. A healthy player is ignored by the gate anyway, so talking only costs you when you are already hurt.

### 2.4 Degradation arc

| Chapter · depth | What the signal does | What the player hears and sees |
|---|---|---|
| **I** Underspire · 0–556 m | 5 → 2 bars. Latency 0.1 → 1.5 s. Clean voices. | Briefing, banter, voiced hints. Odessa's slip at the S1 bell: *"Mind the bell, it's louder than last time."* At S4 your own breathing comes back 2 s late. S5 has the line nobody sent (beat 2). At the Mark (canon `hush`) the bars go to 0, then the two heartbeats, then the signal is lost. |
| **II** Lamphold · 600–1,180 m | Relays run through the town's 3,000 lamps: bars equal lit lamps within 30 m. | Crosstalk from Expedition 23's channel, dated 2276. **The Snuffing kills the radio lamp by lamp, the lamps below you first.** The do-not-answer call. Camp 23 (the mid-point). |
| **III** The Mere *(post-launch)* | No signal under water. | Voices come up through the water, and they are wrong. |
| **IV** Keeping · 1,700–2,220 m | Odessa freezes the channel. | Tick texts on the wrist (3 messages, the last cut off: *"they're pulling my ac—"*). Team voices come from the dark shelves. Biosign reads **3,000,000,000+ contacts**, and Maren says *"that's not a reading, that's the population."* At the chapter exit, Maren's voice comes from the wall. |
| **V** Still Flame · 2,220–2,700 m | **Perfect**: 5 bars, zero latency, because the Flame carries the signal. This is the scariest stretch. | Expedition 42's restore at the Threshold, in your own voice. Odessa's confession. The endings. |

### 2.5 Killer beats (scripted, each fires once)

1. **"Two heartbeats"** (I, S9, the demo hook). In the hush, Tick's last words: *"Wren… your biosign's reading two hearts in that room."* The Kneeling One (stencil W-40) stands up once your light leaves it.
2. **The line nobody sent** (I, S5). Tick: *"Careful on the sixth step, it's loose."* It is. Forty seconds later Tick says: *"Sorry, been on mute for two minutes. Did I miss anything?"*
3. **Hot mic** (I, first death). After "Restore complete", off-mic, Tick asks *"…did he see it? The body?"* and Odessa answers *"Cut the hot mic, Tomasz."* It plays once, on the first death in any run.
4. **Do not answer** (II-2, the Street of Doors). Tick's voice comes from inside a wall, unfiltered: *"Wren? I fell, I'm in here, please—"* with three knocks. Ten seconds later the earpiece Tick says: *"Lost you a sec. You there?"*
5. **The camera sees bare stone** (any chapter, Blood writing ON only). After a 3 s gaze at a blood line, Tick says: *"What are you looking at? Your feed's just stone."* The blood is for you alone.
6. **Channel freeze** (IV-1). Odessa: *"Protocol. Text only."* Then Tick's three wrist texts, then nothing.
7. **Maren in the wall** (IV-8). The one voice the cave could never fake speaks from the shelf: *"Elias? It's so dark. Why is it dark?"* They killed her and restored her without consent.
8. **Expedition 42** (V-1, crystal clear). *"Restore complete. First descent, Elias. History."* Then your own voice: *"Copy, Ops. Wren, Expedition Forty-Two, at the Threshold."* The team answers him, not you.
9. **The confession** (V-6, at the Flame). Odessa: *"Nine of me are down there with you. Bring the light home, Dad. Please."*

### 2.6 Ending payoffs
Ending **A** cuts Odessa off mid-word: *"The Ember's gone dark, what did you—"*. Ending **B**: *"Ember at a hundred percent. Thank you, Dad."* and then, faint and far above, the game's first line spoken to Wren-42. Ending **C** sends the Names out on Perennial's open band, and Tick's last line is *"Wren… everyone heard."*

**Quest cost.** 0 draw calls. One radio DSP bus (`audio/dsp3d.js` has the parts). About 170 lines at Opus 32 kbps comes to about 2.7 MB, against a 63.5 MB precache core and an 80 MB cap.

---

## 3. THE GADGETS

**Rules for every gadget.**
- No new buttons beyond a **tap of Y** (a hold still recentres at 0.8 s). Everything else lives on the body: the bag at the right hip (exists), a mirrored **RIG radial at the left hip**, the launcher at your ear, and the lantern held to a thing.
- Every gadget makes noise or costs Wick charge, so scanning dims your light.
- Every gadget reveals something worse than what you were looking for.

### 3.1 The launch four (MUST-HAVE)

**1 · SOUNDER (signature).** An ultrasonic survey emitter under the left launcher.
- **Use:** tap Y. A pulse expands 0 → 45 m in 1.0 s and paints a phosphor contour band on geometry, which holds for 4 s.
- **Reveals:** anchors out to 45 m (out-of-reach ones dimmed); voids flagged `hollow` in the level data; Name carvings within 15 m; creatures through walls; Holdfast fingers; the Choir (only here).
- **Verb:** MAP.
- **Cost:** 8 / 10 / 12 s cooldown (Normal / Nightmare / Abyss) and 4 % Wick. It is loud: a Mason noise within 40 m (it matters only when you are low), skitterlings within 30 m burst toward the origin, and the Choir steps.
- **Unlock:** Ch I, S4, the Listening Vault. Odessa asks for "a survey of the vault". **The band shows the walls packed with curled bodies.** Maren: *"Bad return. Ping again."* Same result. Tick: *"It's not a bad return."*
- **Quest cost:**
  - *The wall band:* a pulse uniform (origin, radius, time) on the existing level materials, with 1 extra sample of a 512² "packed figures" triplanar mask inside the band only: 0 draw calls.
  - *Creature ghost:* drawn with the existing welded `lanternShadowProxy` stand-in in an additive material: +2 calls per eye for 4 s, about 3–6k triangles.
  - *Anchors:* existing instances.
- **Horror:** the wall is not stone. In Ch II the rings read `W-23`.
- **Originality note:** CHAPTERS §12 set aside an echolocation *chapter*. The Sounder is a reveal tool and not navigation in the dark. The single dark section that leans on it (the Dark Shelves) inverts the idea: the scan is what moves the monster.

**2 · HARPOON (signature; the "fight back" verb).** The grapple head bites flesh.
- **Use:** fire either tether at a skitterling. It gets +0.5 m ray assist on Normal and a 0.6 m head sphere.
  - **Pin:** the skitterling is pinned for 1.2 / 1.0 / 0.8 s and thrashes in that hand's haptics.
  - **Rip:** squeeze grip inside the window to tear it off the wall. This reuses the existing *haul* rule: a haul anchor is never reeled toward, so it does not pull you. It is flung along the line at 9 m/s and falls. It is out of play for 25 s, then re-enters from above through the existing `_enterPlay` (at least 26 m away).
  - **Miss the window:** it runs up your line at 6 m/s. **Let go of that rope and it falls with the line.**
- **Verb:** FIGHT.
- **Other targets:**
  - *The Mason:* the hook glances off its plates and triggers the existing `annoy` surge. It is never a ride (canon cut).
  - *The Dresser:* hooking a chisel arm staggers it for 2 s.
  - *A Holdfast:* yanking tears the hand out of the wall, killing it.
- **Unlock:** Ch I, S6, the first skitterling. Tick: *"It's on your line! Hook it and rip it!"*
- **Quest cost:** none (existing rope, head and rig). The ripped skitterling leaves a hole decal with a face in it.
- **Horror:** the thing you just dropped wore a W-stencilled gauntlet.

**3 · BIOSIGN.** The left wrist ECG, upgraded.
- **Use:** passive; glance at your wrist.
- **Contacts:** your own trace plus up to 3 contact traces within 25 m:
  - the Mason: a deep, unsynced 20–28 bpm ("three hundred hearts")
  - skitterling: a 220 bpm tick
  - Holdfast: a single beat
  - stone dead and the Kept: one beat a minute
  - the Choir: a smear
- **Your trace colour:** white ≥ 75 % (WHOLE: the Dresser can see you), amber in the corridor, red ≤ 35 % (BLEEDING: the Mason smells you). Each band also has a glyph.
- **Verb:** READ.
- **Cost:** none.
- **Unlock:** Ch I, S1 (*"I can hear your heart from here."*). First horror at S4: the walls beat. At the Mark: two hearts.
- **Quest cost:** 0 draw calls (it redraws `healthFx`'s existing ECG canvas).

**4 · ECHO.** A kept-moment reader in the Wick's lens.
- **Use:** hold the lantern within 0.6 m of a marked figure, remnant or blood line for 1.2 s. This is the existing S4 lamp-probe verb with new parameters.
- **Playback:** 6–10 s of the moment of keeping. The figure's last 4 s replay as a phosphor outline (the body LOD1 in a ghost material: +2 calls per eye, only in quiet spaces). Its last heartbeat plays on your wrist. The team archives it and Maren reacts.
- **Verb:** LISTEN.
- **Cost:** 6 % Wick. From Ch IV a read counts as a transmission (the Choir steps).
- **Unlock:** Ch II, II-1, Camp 31. **Its first use is on the dead Wren-31: you hear your own voice die.**
- **Limits:** at most 6 echoes per chapter, at most 2 spoken lines each, and never exposition.

### 3.2 The rest, ranked

| # | Gadget | VR action → verb | Cost / risk | Interactions | Unlock | Quest cost | Horror | Verdict |
|---|---|---|---|---|---|---|---|---|
| 5 | **STILLSHOT** (stasis injector) | RIG radial → thigh, 0.6 s → **VANISH** | Heart at 12 bpm for 8 s. Saturation 0.25, reel ×0.6, grip drain ×1.5, then −8 % hp. One per chapter. | Cuts the Mason's scent (it withdraws as if `huntHold` had run out). The Choir and Biosign creatures lose you. Skitterlings are unaffected (owner rule: they always hunt). | II, Camp 31 | a uniform: 0 | With your heart stopped, the walls' heartbeats are loud, and something whispers *"there you are"* when yours restarts | **1.0** (S) |
| 6 | **CHIRP** (decoy puck) | RIG radial → throw; it sticks → **LURE** | 8 s of your movement sounds. Two per chapter. | Pulls a hunting Mason and skitterlings within 30 m for 4 s. The Dresser ignores sound. | II, Camp 23 | 100 tris in an existing instanced mesh; a pooled voice | When it runs out it keeps talking, in your voice | **1.0** (S–M) |
| 7 | **PITON** (drill anchor) | Next shot drills any `drillable` masonry, 1.2 s → **MAKE AN ANCHOR** | Holds 20 s (3 s creak before it fails). 3 per section. Never within 8 m above a seal. Loud. | Drilling is knocking: it wakes Holdfasts. The skip probe must learn pitons. | 1.1 | 0 calls | The hole weeps, and something knocks back up the rope | **1.1**: the biggest fantasy and the biggest risk to the level design |
| 8 | **MOTH** (light drone on a 40 m line) | RIG radial → toss; it descends; reel it back → **SECOND LIGHT** | 30 s cell. The Mason eats it. | Its light holds a Kept still and can relight a lamp at range. | 1.1 | 1 pooled point light, +1 rope draw | In its light below, your own shadow on the wall above has a second head | **1.1** (M) |
| 9 | Sampler / field lab | Scrape a marked crack with the gauntlet edge | — | — | — | — | Maren: *"…collagen, and a Continuity lattice. This one died in 2274."* | **Cut as a gadget**: 3 scripted scrapes instead |
| 10 | Thermal / IR visor | — | — | — | — | Full-screen grade risk on Quest | — | **Cut**: it overlaps Sounder and Biosign and makes the dark less scary |

**Also cut:** a drone camera feed (a second scene render roughly doubles draw calls on Quest), guns of any kind, and gadget currency or crafting. **Upgrades** are one per camp, found on the dead Wren there: Mk VIII drum (+30 % reel speed), a wider Harpoon window (+0.3 s), and +2 Sounder range rings. They are story-gated, with no grind. **Signature (for trailers):** the Sounder's bodies-in-the-wall shot and the Harpoon's rip-and-drop.

---

## 4. THE BESTIARY: NEW CREATURES

| Creature | Hunts | Sense | Health | Kills by | Can be fought |
|---|---|---|---|---|---|
| **The Mason** (keep) | sound | hearing | **only when you are hurt** (≤ 35 %, 14 s scent) | proximity / lunge | no (lure it to the keystone) |
| **Skitterlings** (keep) | always | proximity | ignores it | bites 26 / 32 / 40 % + grip | **yes** (Harpoon) |
| The Kept (canon, Ch IV) | in the dark | — (deaf) | ignores it | two grabs | held by light |
| **1 HOLDFAST** | your grip | touch | squeezes harder when you are low | pins you for the others | yes (tear free / Harpoon) |
| **2 THE DRESSER** | your anchors | sight of the *whole* | **only when you are healthy** (≥ 75 / 70 / 65 %) | cuts your ring, then "dresses" you | stagger only |
| **3 THE CHOIR** | your instruments | pings, transmissions, echo reads | being low stages a transmission | entombment ("Inside the Wall") | no: starve it |

**1 · HOLDFAST (Ch II, Ch IV "The Hands").**
- **Silhouette:** a climb patch whose chalk studs are knuckles. A grey-pink stone-flesh hand closes over your gauntlet.
- **Rule broken:** it punishes the **grip**, not sound or health. After 0.5 s on a Holdfast hold your hand is locked for 2.0 / 2.5 / 3.0 s and pulled toward the wall at 0.3 m/s while the controller haptics squeeze.
- **Telegraph:** no chalk, a wet sheen, a single heartbeat on the Biosign within 10 m, fingers in the Sounder band, and a wet breath once your hand is within 0.3 m.
- **Counterplay:**
  - Tear free with a real arm pull (hand speed ≥ 1.2 m/s away from the wall for 0.15 s), costing −10 % hp and −0.3 grip stamina.
  - Reel your other tether: the rope out-pulls it after 1 s.
  - Harpoon it.
  - If you wait it out, the lock ends at −15 % (a crushed hand). It is never lethal alone, but the Mason's stall clock keeps running and skitterlings can reach you.
- **Fairness:** at most 1 hold in 4 on a climb zone; never on the only route; never under a seal objective.
- **Set-piece:** **THE HANDSHAKE** (II-2, the Street of Doors). Six house fronts, two of them Holdfasts. Then the knock doors from canon ("KNOCK, AND BE KNOWN"): knock a Name and a hand comes out *open* and gives you the next Name. The Holdfasts are the dead asking to be named.
- **Audio:** knuckle cracks and a wet inhale.
- **Tech:** a 1.8k-triangle hand-and-forearm cut from the Mason v2's skeletal-hand arm (`build_mason.py --lab` variant), with 5-finger bone chains and three clips (close, squeeze, release) authored in code like `mason_rig_clips.py`. At most 2 live (1 call each); the rest are static decor merged into the chunks.

**2 · THE DRESSER (Ch II, II-5 the Dressing Yards; remixed at the Ch IV exam).**
- **Silhouette:** 3.2 m tall. A Lanternwright mason's apron and hood, the Mason v2 saint-mask face split down the middle, two long chisel arms and two small hands paying out a measuring line. It walks upright on walls. Its only sound is the line's *tick-tick*.
- **Rule broken:** the **inverse of the Mason**. It hunts only while you are **whole** (hp ≥ 75 / 70 / 65 %), because only whole bodies dress into good blocks (canon plaque: *"DRESS THE OLD STONE WITH CARE. IT WAS SOMEONE."*). Below that it stops, turns its mask away ("spoiled") and waits.
- **The corridor:** with the Mason at ≤ 35 % (off again at 50 %), the player has to live between 35/50 and 75 %. **Health regen becomes the Dresser's clock:** after any hit on Normal you have 6 s + (75 − hp) / 5 seconds before it can see you again. From 50 % that is 11 s. Bandages make you visible to it.
- **Attacks your rope:** within sight of your anchor it measures for 3 s (**a chalk outline of your body appears on the wall beside you**), then cuts the ring you hang from, telegraphed by 1.0 s of scraping plus a rope buzz in that hand. If it reaches you while you are whole you are *dressed*: death, cause `dressed`, and your remnant is a cut block wearing your gauntlets.
- **Counterplay:** chain to another anchor, take a calculated hit, skip the bandage, Harpoon its arm for a 2 s stagger.
- **Set-piece:** **THE CORRIDOR.** The yards with their saws. The Dresser walks the stacks, a skitterling bite drops you into the corridor, and the Mason waits in the plaster for you to fall below it.
- **Audio:** silence, the tick, a Lanternwright work-song hummed under the hood (one recurring motif), and a saw hum when it cuts.
- **Tech:** a skinned humanoid at 12k / 4.5k triangles, 3 calls. The skeleton and IK come from the WP-BODY rig (`build_body.py`), the head is a 3k reduction of the Mason v2 head, and the clips (walk-on-wall, measure, cut, recoil) are authored in code. The sim is a new small `dresser3d.js` on the existing level surface queries.
- **Budget gift:** the two health gates make it and the Mason **mutually exclusive in practice**, so Quest pays for one big creature at a time.

**3 · THE CHOIR (final-boss class; Ch I–II hints, hunts in Ch IV, finale in Ch V).**
- **Silhouette:** none to the naked eye. In the Sounder band it is a human-sized cluster of a dozen outlines sharing one body: Lanternwright robes and modern clothes, heads at slightly different angles. On the Biosign it is a smear of unsynced beats. Every person Continuity ever restored has an original in it.
- **Rule:** it **exists only in your instruments.** Each Sounder ping, transmission or echo read lets it step 6 / 8 / 10 m toward you through the dark. It never crosses lit volumes, because light holds the kept. **It is shown in the very ping that moves it,** so every step is seen (fair). It never starts within 25 m. Capture happens if a step ends within 1.5 m.
- **Voices:** every 12–20 s it speaks from its position in team voices, asking you to *ping* or *answer*. It is not imitating them. It *is* them.
- **Capture, "INSIDE THE WALL":**
  - *Inside:* 10 s of first-person entombment in a 1 m stone pocket. Haptics squeeze both hands. Through a crack you watch your own next restore walk past.
  - *After:* you are restored at the last lamp (cause `kept`).
- **Counterplay:** ping sparingly (plan a route from one ping), move lamp to lamp, use a Stillshot, and apply the **Maren rule**.
- **Set-piece:** **THE DARK SHELVES** (Ch IV, about 90 s). Canon's *"THE DARK SHELVES ARE NOT TO BE ENTERED."* The dark drains your Wick to its 0.25 floor, and you descend 90 m by Sounder alone while Tick's voice behind you says *"Ping again, I can't see you."* In Ch V it lives in the Mason's shadow, the very shade that shelters you from stillness.
- **Why it is the scariest thing we can do on a headset:** it turns the two lifelines that make a VR player feel safe (the scanner and the voice in your ear) into its body. It speaks at HRTF distance beside your head, it is never fully seen, and its kill is enclosure and touch, which a headset does better than any screen.
- **Tech:** no skinned mesh. An `InstancedMesh` of 12 static outline figures at about 600 triangles each, additive, drawn only during a ping: 1 call per eye, about 7k triangles. The voices are layered, pitch-shifted copies of the team's VO. The capture pocket is 6 boxes in 1 call. Its step logic is deterministic and seeded, so it can be unit-tested.

**Non-creature horror: DEAD AIR.**
- Moving zones built from canon E18 `hush` volumes, extended. All audio falls to −60 dB over 1 s, the radio drops to 0 bars, and only your heartbeat remains, as haptics.
- Captions show *[Total silence]*, so deaf and hard-of-hearing players lose nothing extra: everyone is deaf in there.
- Inside it the Mason cannot hear you and you cannot hear it. The Dresser and the Kept do not care about sound.
- In Ch IV and V the only sound inside Dead Air is a voice in your ear.
- Placement: IV-6 The Horns (replacing the Mere's breath pool) and V's draining beds. Effort S.

**Mason and skitterling deltas.** The Mason keeps every rule. Fictionally it is the collector of the kept, and its growth per chapter (20 → 32 segments) is new kept. Skitterlings are red because they are the newest kept, still flesh: add a stencilled gauntlet to the third plate of the skitter variant (asset, S). Offer a **Phobia filter** that renders them as stone clumps with no leg-patter audio.

---

## 5. THE DARKEST SECRETS: revelation structure

**The layers.**
- **BOARDS (curiosity):** what the order carved for others to believe. Shown on by default, and Maren reacts to them.
- **BLOOD (reality, opt-in):** what the dying wrote for themselves. From Ch II, **some of it is in Wren's own hand** and signed W-23, W-31 and so on, and the team's camera never sees it.
- **ECHOES (evidence; gadget, on by default, optional to engage):** what actually happened, in sound.
- **The radio** frames all three: the present being lied to you.

The unmissable route never depends on blood, so the twist lands with Blood writing off, and blood players feel it earlier and more personally. Chapter I's blood belongs to the nine menders, as the in-progress `data/blood-writing-3d.js` already has it. Wren's own lines start in Chapter II and must fit that file's format: at most 3 lines of 24 characters, A–Z 0–9 . , ' ? ! -, for example `SHE TOOK THE LIGHT UP.\nSHE LEFT US THE DARK.` or `THEY SAID FIRST DESCENT\nTO ME TOO. W-23`. **Proposed** low-health lines for Ch II+ (`lowHealthText.js` is not mine to edit): "YOU SAID THAT LAST TIME", "FORTY-ONE", "WE ARE YOU". They are drawn in the same scrawl as the blood, which reveals in Ch IV that the visor lines were always Wren's hand.

| # | Secret | Where and how | Layer | What it changes |
|---|---|---|---|---|
| 0 | The W-41 stencil on your gauntlets | Visible from the first frame | image | Hidden in plain sight; it pays off at #6. |
| 1 | The statues are not carvings | I-S3 split statue; first death | board + place | The cave is built from people. |
| 2 | The walls have a pulse | I-S4 Sounder + Biosign | scan | The dead are aware. |
| 3 | A restore leaves you behind | I, first death: your body, ECG flat; the hot mic | comms + place | You are a copy, and the team knows. |
| 4 | The Cap was never opened | I-S1 optional: ping straight up, and 500 years of solid lime | scan | You were never lowered in. |
| 5 | "First descent" is a lie | I-S9: two hearts, Kneeling One W-40 | scan + comms | Someone like you was here before. |
| 6 | **The rings are yours, and so is Camp 23 (mid-point)** | II: rings tagged W-23. II-9: a portaledge camp, a dead Wren in a Mk V suit, wrist "EXP 23 · 2276", 22 notches scratched on his frame. His echo: *"There's a body. It's wearing my—"*. Tick: *"It says forty-one. Odessa, it says forty-one."* | scan + echo + comms | **The oh-no:** 40 of you came before, and you took your gadgets off them. |
| 7 | The Lanternwrights had restores first | II-4 Waking Hall echo: a woman wakes in her bed and her stone body stays in it | echo + place | Continuity is not new. It is the Flame. |
| 8 | The skitterlings are you | II/IV: a W-stencilled gauntlet in a ripped skitterling | image | You have been killing your past selves. |
| 9 | The Ember came from here | IV echo: Hesper Vell climbs out with a lamp (the plaque "NONE OF THEM CLIMBED BACK" lied); blood: *"SHE TOOK THE LIGHT UP. SHE LEFT US THE DARK."* | echo + blood + board | The future's immortality is this cave. |
| 10 | Everyone saved is here | IV Dark Shelves: Biosign shows 3,000,000,000+; the Choir in team voices | scan + comms | The world's dead were never freed. |
| 11 | Maren is in the wall | IV-8 | comms | They killed the one person telling the truth. |
| 12 | **The first Wren and the director (final)** | V-6: Wren-1 kneels in a Mk I suit (2260), cupping the Flame, his heart still beating. His echo: *"It's warm. Odessa, don't send anyone else."* Then Expedition 42 and the confession: *"…Dad."* | place + echo + comms | The loop is love that won't let go. That is the Lanternwrights' sin, and the world's. |

**Endings** (canon acts at the Flame, unchanged; new meaning in the future frame)

| Ending | Trigger (canon) | What it says | Card |
|---|---|---|---|
| **A · UNKINDLED** | Cup the Flame over Wren-1's stone hands for 3 s during a bow | You finish what you started 31 years ago. All Flame-light dies: the lamps, the relay, the Ember, Continuity. The kept lie down (the Mason comes apart: canon "THE STILLING", dark). Odessa is cut off mid-word. You climb by phosphor paint and feel a draft from far above. | *"THE UNKINDLED. Restores worldwide: 0. You are the last copy. Live."* |
| **B · KEPT** *(the mission; the unforgettable one)* | Hold your lamp in the Flame for 1.5 s, then raise it | The Flame's light pours up the lamps and the Ember flares, so Continuity is saved. You are stilled at the Lip. *"Ember at a hundred percent. Thank you, Dad."* Then, faint and far above, the game's first line spoken to Wren-42: *"Restore complete. First descent, Elias."* | *"THE KEPT. Continuity restored. Far above, you wake."* |
| **C · ANSWERED** *(secret; all Names)* | Knock your Name on the bowed crown | Every Name knocks back, the kept unfold and kneel, and you and Wren-1 put the Flame out together (canon). **You open the channel: the Choir speaks its names to the surface on Perennial's open band.** | *"THE ANSWERED. Named: 21. Heard: everyone."* |

**Names stay** as the one collectible. They are VR-native (knocking), already designed, and the key to C. Additions: a Sounder ping reveals carvings within 15 m (no pixel-hunting), each Name uploads to Maren's archive, and with the Mere moved out, 1.0 has **20 + your own**.

---

## 6. WHAT ELSE DOWN THERE (ranked; effort S/M/L)

1. **Restore sequence + remnants in your suit** (S–M). Every death is a story and a clip. It is canon E08 with the future skin.
2. **"Let it hear you" mic mode** (S–M). Opt-in. On-device voice-activity detection only, never recorded. Your real voice is a Mason noise (when you are low), answers the cave (§2.3) and moves the Choir. This is the strongest streamer mechanic in the genre (screaming has consequences), and it works for flat-screen players too.
3. **Expedition camps** (M). Four camps of dead Wrens (31 and 23 in II, 12 in IV, 1 at the Flame). Each is a rest stop, a gadget unlock and the next story beat. **This replaces any hub, shop or currency.**
4. **Inside the Wall** (S). The Choir's capture: 10 s that sell the creature in one clip.
5. **The Corridor** (M, with the Dresser). A health-band set-piece that only this game has.
6. **The Dark Shelves** (M). The scan-moves-the-monster section.
7. **Go Dark mode** (S). Perennial cannot stage a restore, so the Mason *never* smells you at low hp, but a death restarts the chapter. Separate medals. A diegetic hard mode.
8. **Daily Descent** (S–M). A seeded Chapter I run (the supply and skitter seeds exist) with one modifier, on Steam leaderboards. Built for streamer races.
9. **PC spectator camera** (S–M). A smoothed, stabilised view in the desktop window. VR streamers need it, and viewers get sick without it.
10. **Phobia and streamer-safe options** (S). Centipede filter; blood already opt-in; softened jump scares.
11. **Ops Console asymmetric co-op** (L, **1.1**). A second player in a phone or laptop browser plays "Tick": a 2D shaft map built from the level data, vitals, Sounder returns, contact calls, 3 pings per section. The fiction already exists and it is a web page. Honest cost: a signalling and TURN backend (none exists, per RELEASE), a state stream, and a playtest loop. **Not at launch.**
12. **Survey photo mode** (S). A Sounder snapshot exported as a PNG with the scan overlay.
13. **The Mere** (L, post-launch free chapter). Water, breath, and "voices up through the water".
14. **Piton and Moth** (M each, 1.1).

**Cut:** a surface base-camp hub (it breaks the one continuous descent with no loading screens), crafting and currency, combat arenas, the drone camera feed, the thermal visor, our own leaderboard backend (use Steam's), ghosts and Pilgrim mode (already first on CHAPTERS' cut list). A "collapsing-shaft chase" and an "inverse-sound stillness chapter" already exist in canon (the Snuffing and Span, the Stilling, Chapter V), so they are not added again.

---

## 7. MAKING IT BLOW UP: STEAM + META STORE

**Packaging (recommendation: Electron).**

| Option | PC VR | Flat | Effort | Verdict |
|---|---|---|---|---|
| **Electron (Chromium) + `steamworks.js`** | Desktop Chromium runs WebXR on Windows through OpenXR (SteamVR is an OpenXR runtime). **Whether Electron ships that path is UNVERIFIED.** | yes (WebGL2) | M | **Pick.** Day-1 spike: does `navigator.xr.isSessionSupported('immersive-vr')` return true under SteamVR? Which flags are needed? |
| Tauri / WebView2 | As far as I know WebView2 has no WebXR (verify) | yes | M | Reject |
| Launch the system browser at a local server for VR only | Works where Chrome's WebXR works | — | S | Fallback, labelled "PC VR (beta)" |
| Godot / Unity port | native | yes | L, 6–9 months | Reject for 1.0. It throws away the deterministic JS sim, the bot harness and two years of verified routes. |

**If the spike fails:** launch Steam as **flat-screen + Steam Deck**, ship PC VR through the browser fallback, and say so on the page. Controllers: Index and Quest via Link are supported. Vive wands are not (no sticks), matching `xrInput.js`'s xr-standard reads.

**Steam features**
- **Achievements:**
  1. *Restore Complete* (first death)
  2. *Two Hearts* (the Mark)
  3. *Not Stone* (Vault ping)
  4. *Pest Control* (rip 10 skitterlings)
  5. *Did Not Answer* (II-2)
  6. *The Corridor* (cross the Yards unhunted)
  7. *Forty-One* (all camps)
  8. *Named* (all Names)
  9. *Unwoken* (a chapter with 0 restores)
  10. *The Unkindled*
  11. *The Kept*
  12. *The Answered*

  The long tail adds Abyss Full Descent, Go Dark and Daily x7.
- **Steam Input and Deck:** a full gamepad scheme (triggers = the two tethers, bumpers = yank, D-pad = reel and talk, face buttons = jump / Sounder / bag / rig), gamepad navigation for the DOM menus, the `low` tier at 1280×800, and a text-size floor.
- **Cloud and presence:** export the save (`meta/save.js`) as JSON to Electron's userData and enable Steam Auto-Cloud. Rich presence: "Lamphold · 742 m · Restores 6".
- **Leaderboards:** Daily Descent and medals. Check `steamworks.js` coverage for leaderboards and the Electron overlay (UNVERIFIED).
- **Content survey:** declare blood and body horror. Disclose any AI-generated assets (we recommend human VO).

**Flat-screen as a first-class mode (yes: VR is a small slice of Steam).** It already runs on desktop and touch. To make it first-class it needs:
- gamepad triggers as tethers, with stick aim assist using the existing ray assist
- a visible "held" pose for the gauntlets
- buttons for each gesture (knock, lantern-to, ear, hip radials)
- an FOV slider and a head-bob toggle

Ship the page as "VR Supported", not "VR Only". The horror survives because it is in the sound and the rope, not in the headset.

**Meta store, deltas only** (beyond RELEASE.md):
- rewrite the listing copy for the Expedition frame
- **change the IARC answers** to say blood (the red line, the opt-in writing, the Mason v2 flesh)
- declare the microphone in the Data Use Checkup if mic mode ships (check the TWA permission flow)
- keep the key art and trailer free of gore close-ups (RELEASE §13)
- move to the private repo before paid chapters land (RELEASE §3.4)

**The three trailer moments:**
1. **The Vault ping:** a green band sweeps the wall and it is packed with curled bodies. *"…that's not stone."*
2. **Restore complete:** you look down at your own body, its ECG flat.
3. **Two hearts:** the Kneeling One stands up when your light leaves it.

**The 60-second hook:**
- **0–5 s:** black, then *"Restore complete. First descent, Elias. History."* The Wick catches.
- **5–12 s:** the first swing, and Tick: *"First human in five hundred years. No pressure."*
- **12–20 s:** the Vault ping.
- **20–28 s:** the Harpoon rips a skitterling off the wall and it falls 100 m.
- **28–36 s:** red line, IT CAN SMELL YOU; the crown in the lantern light; the Spiral pass.
- **36–44 s:** death, then the restore, then your body.
- **44–52 s:** *"…two hearts in that room."* The figure stands.
- **52–60 s:** title, *"Every restore leaves a body behind."*, *"Chapter I free · VR or monitor"*.

**Streamer moments:** finding your own body; the Kneeling One; the Holdfast handshake (a real arm yank); the chalk outline of you on the wall; answering Tick's voice out loud in mic mode; Inside the Wall; hearing Expedition 42 in your own voice. **Let's Play mode:** larger radio subtitles, mic mode on, spectator camera, a clip-marker key, the original score only (no DMCA risk).

**Review-bait risks**

| Risk | Mitigation |
|---|---|
| Motion sickness | Comfort options already exist (vignette, snap turn in `ui/comfort.js`); wind squalls can be switched off. Tag the Steam page Intense. Flat mode is an escape hatch. |
| Difficulty spikes (the S7 60 s floor; the corridor) | A bot-verified fairness gate per set-piece (canon), Sandbox, an honest Normal. |
| Quest jank | Every gadget costs ≤ +4 stereo calls and ≤ +10k triangles in peaks. S6 is the tight spot (142 calls / 302k without a creature; 381k with Mason LOD0). Check on device every milestone. |
| "It's a web game in a wrapper" | No browser chrome; Deck Verified; a native-feeling launcher. |
| Content shock (copies of yourself, body horror, blood) | Store warnings, opt-in blood, the Phobia filter. |
| Length versus price (about 2 h in 1.0) | Price to it (below). Replay through medals, Daily, Go Dark and three endings. A free Mere update re-engages players. |

**Price and DLC.** Steam: $14.99 premium, with Chapter I as the store demo and a 10 % launch discount. Meta: keep free + the $9.99 unlock (owner decision; different platform, price-sensitive audience). The Mere ships as a **free** update about 3 months after launch, because reviews and the update-visibility spike are worth more than DLC revenue at our scale.

**Timeline (today 2026-10-29) and honest scope**
- **Dec 2026:** Steam "Coming Soon" page with the 60 s teaser. Owner actions: Steamworks fee and tax.
- **Feb 2027:** free Chapter I on Meta with the comms, Sounder, Harpoon and the Mark.
- **Apr 2027:** Steam demo build.
- **Jun 2027:** Steam Next Fest (verify registration dates).
- **Oct 2027:** full launch on both stores. Verify Scream Fest eligibility for a launch discount.
- **Q1 2028:** The Mere update and the Ops Console.

**Honesty.** Agents write code fast (LEVEL_FUN_PLAN's six phases took days), but **nothing in Chapter I has been playtested in a headset** (BUDGET_CH1: "nothing playtested in VR"). The real bottlenecks are human: about 10 first-time VR testers per chapter gate, VO casting and recording, art direction, and trailer editing.

---

## 8. ROADMAP & SCOPE

| Milestone | Goal | Work packages | Quest risk | Harness can verify | Needs a human |
|---|---|---|---|---|---|
| **M-A The Signal** (2–3 wk) | Chapter I feels like the Expedition | **COMMS-CORE** (M): pure scheduler in `sim/comms3d.js`, `comms[]` per section in the data, radio bus, `radio` captions, ear push-to-talk, transmit-as-noise. **RESTORE-SEQ** (S). **REMNANT-LITE** (S–M: 3 baked poses at ~3k triangles, ≤ 6 visible, flat ECG, a 90 s grey). **STAGING** lines plus the white-gold Wick (S). **W-41 stencil** (S). Scratch VO (TTS, never shipped). | Remnants ≤ +3 calls / 18k stereo | `test:at3d` (scheduler determinism, priority, no chatter in peaks); e2e (first death shows "Restore complete"); `verify:at3d` unchanged | VO tone, subtitle legibility |
| **M-B The Senses** (3 wk) | The signature reveals plus fighting back | **SOUNDER** (M), **BIOSIGN** (S), **HARPOON** (S–M) | The pulse in S6 with the Mason in view (over 350k today): use the proxy ghost and skip it under governor level ≥ 3 | Units (cooldown, charge, noise reaches `_onNoise`; pin window; haul never reels; dislodge then re-entry ≥ 26 m); e2e mock-XR budgets at S4 / S6 / S7 with the pulse on; `budget:at3d` sim p99 ≤ 2.5 ms | Is the band readable? Does the expanding shell cause nausea (reduced effects = a static fade)? Harpoon feel |
| **M-C The Demo Hook** (5–6 wk) | THE MARK (canon S9) plus two hearts, the comms drop, Kneeling One W-40; the opening restore; real VO for Chapter I | S9 (L: E07/E09/E13/E17 subsets), VO session (M), end card (S) | The hook chamber + unspooling Mason at LOD0 | Bot fairness checks from canon §5.4; skip probe; e2e descent to the end card | **The demo RC gate**: ≥ 10 first-time VR testers, 24–28 min, ≥ 70 % can say what the statues are. Then the Meta free release. |
| **M-D Steam Shell** (4 wk, parallel to M-C) | Steam-ready flat and VR | **ELECTRON SPIKE** (S, first), steamworks (M), gamepad + Deck (M), spectator camera (S–M), **MIC MODE** (S–M), page + trailer capture (M) | n/a (PC) | e2e boots in Electron; save round-trip | Deck feel; a Valve review pass |
| **M-E Lamphold** (10 wk) | Chapter II with the mid-point | Ch II per canon (L), ECHO (M), STILLSHOT + CHIRP (S), HOLDFAST (M), **DRESSER** (L), camps 31 / 23 (M) | The Dresser plus the town's 3,000 lamps; the Snuffing front | Routes, movers, fairness bots; Dresser and Holdfast seeded units; corridor bot (the regen clock) | The chapter gate; the Next Fest demo stays Chapter I |
| **M-F The Keeping + The Still Flame** (16–18 wk) | 1.0 complete | Ch IV + the Kept (E22) (L), CHOIR + Dark Shelves (M), Dead Air (S), Ch V + Stillness (E23) (L), endings + credits (M), launch | The Halo's white light; the Choir's instances in the pings | Every canon §8 gate; all three endings reachable by bots | Chapter gates; thermal soak; certification |

**The very next three work packages (most wow per week):**
1. **COMMS-CORE + RESTORE-SEQ.** Voices and "Restore complete" turn the existing Chapter I into the Expedition with zero new geometry and 0 draw calls.
2. **SOUNDER + BIOSIGN at the S4 Vault.** The signature trailer shot, plus the pulse in the walls.
3. **HARPOON.** Fighting back against the main damage source, using only the existing rope.

Run the **2-day Electron/OpenXR spike** alongside these, because it decides the Steam VR plan.

**Cut list, in order, if time runs short:**
1. Ops Console
2. Piton and Moth
3. Daily Descent
4. Chirp
5. the [cuttable] canon sections
6. Survey photo mode
7. The Holdfast in Ch IV (keep II)

**Never cut:** the restore and remnant, the comms and the Maren rule, Sounder, Harpoon, Biosign, Echo, THE MARK, the Dresser's corridor, the Choir, and the three endings.

---

## 9. OPEN QUESTIONS for the owner (each with my recommended answer)

1. **Adopt the central secret and the cast** (Elias Wren, Perennial and Continuity, Odessa as his daughter, Maren the Natural)? **Yes.**
2. **Allow radio voice-over**, overriding CHAPTERS §3.2.5, capped at about 40 lines per chapter, with human actors for the 4 voices plus Wren, and AI voices for scratch only? **Yes.**
3. **Move The Mere out of 1.0** and ship it as a free update about 3 months after launch? **Yes.**
4. **Steam via Electron, flat-screen first-class, PC VR only if the spike passes**, priced at $14.99 on Steam and keeping the $9.99 Meta unlock? **Yes.**
5. **Ship "Let it hear you" microphone mode**: opt-in, default off, on-device voice detection, never recorded? **Yes.**
6. **Update the rating answers now** (blood: yes; body horror) and position the game as 16+? **Yes.**
7. **The Dresser's health corridor** as Chapter II's signature twist, the inverse of your hunt gate? **Yes.**
8. **Gadgets come only from dead Wrens' camps**, with no shop, currency or grind? **Yes.**
