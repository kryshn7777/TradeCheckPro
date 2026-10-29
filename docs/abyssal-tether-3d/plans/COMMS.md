# COMMS: the Expedition radio and the CONTINUITY restore (Chapter I, build 1)

> First build step of the owner-approved Expedition frame ([FUTURE_STORY_PLAN.md](FUTURE_STORY_PLAN.md) §1, §2 and the §8
> work package "COMMS-CORE + RESTORE-SEQ"). Chapter I only (S1-S8, about 560 m). No gadgets, no new creatures, no new
> geometry: everything here is presentation keyed on bus events that already existed, plus one head-locked quad.
> `?comms=off` turns all of it off (the old death panel comes back; the e2e and the store captures run that way).

## 1. The frame in one paragraph

It is 2291. You are **Elias Wren**, a descent specialist for **Perennial**. Perennial's **Continuity** restores anyone who dies;
it runs on the dimming **Ember**, and you are going down the sealed Underspire for a fresh kindling. Four voices talk to you
over a wireless uplink. The signal fails as the shaft deepens. A death is no longer "waking at a lamp": the checkpoint lamp is
an **uplink relay**, your body stays where it fell, and Continuity restores you from the last sync. The opening line is a
restore the player takes for a lowering: *"Restore complete. Continuity 99.8%." / "First descent, Elias. History."*

## 2. The cast (§2.1 of the plan; colour **and** shape, never colour alone)

| Voice | Who | Personality | On the panel |
|---|---|---|---|
| **ODESSA** | Odessa Vance, programme director | Unhurried, warm, controlled. Always says "Elias". | ◆ gold |
| **TICK** | Tomasz "Tick" Ilić, uplink tech | Jokey, nervous, talks too much. Says "Wren". | ● cyan |
| **MAREN** | Dr. Maren Soll, historian of the Lanternwrights | Dry, exact, curious. Reads the boards with you. | ▲ white |
| **VESPER** | the suit AI | Clinical, five words or fewer. In the suit, not on the radio: never glitches, no latency. | ■ grey |
| UPLINK | the open channel, no speaker (the S4 echo) | — | ✕ red |

The radio is a **third voice** next to the boards (the Keepers' riddles) and the blood (the menders' first person,
[STORY.md](STORY.md)): the clinical, human present of Perennial. Its horror is what it says that it should not know.

## 3. How it works

| Part | File | What it does |
|---|---|---|
| Script, signal, scheduler, restore plan | `src/sim/comms3d.js` | Pure, deterministic, DOM-free, three.js-free (runs in Node; seeded; no `Math.random`, no clock but dt). |
| Subtitle panel + restore overlay | `src/render/commsView.js` | ONE head-locked quad (camera child, like `lowHealthText.js`), two canvas textures, one material: +1 draw call while something shows, 0 otherwise. |
| Radio voices | `src/audio/radio3d.js` (+ hooks in `audio3d.js`, `music3d.js`) | Synthesised voice-substitute per speaker through a radio chain. **Placeholder VO** (§6). |
| Signal bars on the wrist | `src/render/healthFx.js` | Five bars + the on-air speaker's initial drawn into the left ECG canvas (0 draw calls); `NO UPLINK` at the Mark. |
| Integration | `src/game.js` | Builds the director (`_setupComms`), feeds it (`_updateComms`), plans the restore (`_restoreBegin`), holds the death panel while it plays (`_updateDeath`), the debug API `AT3D.debug.comms`. |

**Events the director listens to** (all existed before): `game:start` / `restart` / `menu` / `pause` / `victory`,
`section:enter`, `checkpoint`, `hint`, `bell:ring`, `objective:done`, `health:damage`, `health:low`, `creature:sighting`,
`creature:state` (a skitterling's, tagged `skit`), `dresser:appear`, `player:death`, `game:respawn`. Per frame game.js passes
a small context: playing, section, depth, the fraction through the section, **danger** (a Mason / skitterling attack
wind-up or burst, a Dresser measure), **tense** (the Mason pursuing within 40 m), the continue input (skips the opening) and,
with Blood writing on, whether the view rests on a blood writing. The director emits `comms:line` / `comms:end` on the bus
(the radio speaks them). It never touches the simulation: the route bots, the verify harness, the hunt gate, the Dresser and
the skitterlings behave exactly as before.

**Scheduling rules**

- One transmission at a time, at least 0.7 s apart.
- Never during danger: a line on air when a wind-up starts is cut at once (an early cut of a priority >= 2 line comes back
  once); nothing starts until the danger has passed.
- Priority 3 (beats, the opening) > 2 (story, reactions) > 1 (flavour, voiced hints). Priority 1 waits while the Mason is
  close and keeps at least 20 s between flavour lines.
- Stale lines are dropped, never played late: each line has a ttl (8-60 s), and a line tied to a section goes stale when you
  leave it.
- Latency: a reply arrives 0.1 s (S1) to 1.5 s (S8) after its trigger; Vesper has none.
- The opening (five lines at the Threshold) is skippable with the continue input (Enter, or A in the headset).
- Restore reactions: on the first three restores of a run, then every third.

## 4. The signal arc (§2.4 of the plan, Chapter I)

| Section | Signal (top) | Bars | Latency | Glitches the arc allows (chance per transmission) |
|---|---|---|---|---|
| S1 Threshold | 1.00 | 5 | 0.1 s | none |
| S2 Long Swing | 0.94 | 5 → 4 | 0.2 s | none |
| S3 Broken Gallery | 0.82 | 4 | 0.35 s | static 20 % |
| S4 Listening Vault | 0.70 | 4 → 3 | 0.5 s | static 35 % · the late breath (scripted) |
| S5 Gullet Stair | 0.58 | 3 | 0.7 s | static 45 %, dropout 25 % · the line nobody sent (scripted) |
| S6 Two Descents | 0.46 | 3 → 2 | 0.9 s | static 55 %, dropout 40 %, stuck word 12 % |
| S7 Hollow Nave | 0.33 | 2 → 1 | 1.1 s | static 65 %, dropout 50 %, stuck word 20 % (+ the nave's scripted one) |
| S8 Last Throat | 0.20 → 0 | 1 → NO SIGNAL | 1.5 s | static 75 %, dropout 60 %, stuck word 25 % · not quite Odessa (scripted) |

The signal falls linearly through each section to the next one's value (S8 to 0 at its bottom; nothing from the Mark,
544 m, down) with a slow ±0.025 deterministic wander; a dropout reads 0 bars while it lasts. Bars: >= 0.86 five, >= 0.66
four, >= 0.46 three, >= 0.26 two, >= 0.06 one, below that NO SIGNAL.

**Glitch kinds** (deterministic per seed, line and count): *static* (a burst of noise; on the panel two noise bands, a
speckle and a 10 px tear of one row), *dropout* (the voice gaps, the static fills it; the row dims, the bars read 0),
*repeat* (a stuck word: "The floor unbolts while— while— while you hold."), *label* (the voice that is not quite the
speaker: the name will not hold still and turns red). Vesper, the opening and the lines marked clean never glitch.
**Accessibility:** every transmission has text; glitch onsets are at least 0.34 s apart and last at least 0.17 s (never
faster than 3 Hz); the words stay readable through every glitch. Settings › Access › **Signal glitches** OFF (or Reduced
effects) draws a plain panel and lowers the radio static.

## 5. The script (51 transmissions)

Generated from `COMMS_SCRIPT`; keep this table in step when you edit it. Killer beats in **bold** (the plan's §2.5 and §2.4
beats that fit Chapter I: the slip at the bell, the late breath, the line nobody sent, the hot mic, the camera sees bare
stone, two hearts, "it's us", not quite Odessa).

| id | where | speaker | trigger | prio | line | note |
|---|---|---|---|---|---|---|
| `s1-open-1` | S1 Threshold | VESPER | entry +1.4 s | 3 | Restore complete. Continuity 99.8%. | **opening** · glitch: none · skippable |
| `s1-open-2` | S1 Threshold | ODESSA | after `s1-open-1` +0.4 s | 3 | First descent, Elias. History. | glitch: none · skippable |
| `s1-open-3` | S1 Threshold | TICK | after `s1-open-2` +0.5 s | 3 | Uplink's clean, five bars. I've got your eyes and your heart. | glitch: none · skippable |
| `s1-open-4` | S1 Threshold | MAREN | after `s1-open-3` +0.5 s | 3 | Nobody's stood there since 1791. Read me every board you pass. | glitch: none · skippable |
| `s1-open-5` | S1 Threshold | ODESSA | after `s1-open-4` +0.5 s | 3 | The Ember's dimming, Elias. Bring us a kindling. Take your time. | glitch: none · skippable |
| `s1-bell-1` | S1 Threshold | ODESSA | `hint` (hint with "bell") or `bell:ring` | 2 | Mind the bell, Elias. It's louder than last time. | **the slip** |
| `s1-bell-2` | S1 Threshold | TICK | after `s1-bell-1` +0.35 s | 2 | Last time? |  |
| `s1-bell-3` | S1 Threshold | ODESSA | after `s1-bell-2` +0.3 s | 2 | The probes, Tomasz. Focus. |  |
| `s1-stall` | S1 Threshold | TICK | stall (60 s, no progress) | 1 | Fire at the glowing ring and hold. Let the rope work. |  |
| `s2-board` | S2 Long Swing | MAREN | depth 24 m | 1 | 'It does not send us back.' Cheerful people, the Lanternwrights. |  |
| `s2-haul` | S2 Long Swing | MAREN | `objective:done` verb=haul | 2 | That chain's been oiled. Recently. Write that down, Tomasz. |  |
| `s2-stall` | S2 Long Swing | TICK | stall (60 s, no progress) | 1 | Hook the counterweight and haul. That's your way down. |  |
| `s3-enter` | S3 Broken Gallery | MAREN | entry +3 s | 2 | Closed from this side. So someone was still inside. |  |
| `s3-winch` | S3 Broken Gallery | TICK | `objective:done` verb=winch | 1 | Gear's turning. Five hundred years, and it still turns. |  |
| `s3-stall` | S3 Broken Gallery | TICK | stall (60 s, no progress) | 1 | Ride the gear. Hook its ring and hold on. |  |
| `s4-enter` | S4 Listening Vault | ODESSA | entry +1.5 s | 2 | A hundred metres, Elias. Vitals good. Signal's thinning. |  |
| `s4-sight` | anywhere | TICK | `creature:sighting` | 2 | Did you see that? Something big, out in the dark. |  |
| `s4-knock` | S4 Listening Vault | MAREN | depth 108 m | 2 | If something knocks, don't knock back. Their rule. I'd keep it. |  |
| `s4-echo` | S4 Listening Vault | UPLINK | depth 124 m | 2 | [Your breathing comes back on the channel. Two seconds late.] | **the late breath** · echo · glitch: none |
| `s4-stall` | S4 Listening Vault | ODESSA | stall (60 s, no progress) | 1 | The cold lamps, Elias. Hold your lantern to each one. |  |
| `s5-enter` | S5 Gullet Stair | ODESSA | entry +1 s | 2 | Contact above you, Elias. Keep moving. Don't look for it. |  |
| `s5-frayed` | S5 Gullet Stair | TICK | entry +14 s | 3 | Careful in the middle. Those rings are frayed. They hold once. | **the line nobody sent** |
| `s5-mute` | anywhere | TICK | after `s5-frayed` +40 s | 3 | Sorry, been on mute for two minutes. Did I miss anything? |  |
| `s5-key` | S5 Gullet Stair | TICK | `objective:done` verb=breach | 2 | That was loud. Everything down there heard that. |  |
| `s5-stall` | S5 Gullet Stair | TICK | stall (60 s, no progress) | 1 | The keystone: hide and let it knock, or haul its ring. |  |
| `s6-enter` | S6 Two Descents | VESPER | entry +0.8 s | 2 | Signal degraded. Latency rising. |  |
| `s6-fork` | S6 Two Descents | MAREN | entry +5 s | 1 | The Throat is 'for the late'. I'd like you early, Elias. |  |
| `s6-skit` | anywhere | VESPER | first skitterling contact | 2 | Contact. Small. Closing. |  |
| `s6-stall` | S6 Two Descents | MAREN | stall (60 s, no progress) | 1 | Either way down will do. Standing still won't. |  |
| `s7-enter` | S7 Hollow Nave | MAREN | entry +2 s | 1 | Nothing to stand on. A church you can only hang in. |  |
| `s7-hang` | S7 Hollow Nave | TICK | depth 296 m | 2 | The floor unbolts while you hold. So hold, Wren. | glitch: repeat (the stuck word) |
| `s7-iris` | S7 Hollow Nave | ODESSA | `objective:done` verb=survive | 2 | The iris is open. Go now, Elias. |  |
| `s7-stall` | S7 Hollow Nave | TICK | stall (60 s, no progress) | 1 | Chain the rings. Fire the next before you let go. |  |
| `s8-enter` | S8 Last Throat | ODESSA | entry +1 s | 3 | Signal's going, Elias. Whatever you hear after this, it's us. | **it is us** |
| `s8-two` | S8 Last Throat | VESPER | depth 470 m | 2 | Heart rates: two. Recalibrating. | **two hearts (foreshadow)** |
| `s8-probes` | S8 Last Throat | TICK | depth 500 m | 2 | Probes all died at five-fifty-six. No pressure, Wren. |  |
| `s8-warm` | S8 Last Throat | ODESSA | depth 526 m | 3 | Keep coming down, Elias. It's warm down here. | **not quite Odessa** · notquite (no radio filter, lower, the name will not hold) |
| `s8-lost` | S8 Last Throat | VESPER | depth 538 m | 3 | Uplink lost. |  |
| `s8-stall` | S8 Last Throat | ODESSA | stall (60 s, no progress) | 1 | The grate, Elias. Run for the light. |  |
| `any-hurt` | anywhere | TICK | `health:damage` lethal=false (the first) | 1 | Vesper says that was minor. I say ow. Easy, Wren. |  |
| `any-low` | anywhere | ODESSA | `health:low` | 2 | Vitals red. Staging a restore at the last relay. | repeat after 75 s (the hunt gate, read as Perennial staging your restore) |
| `any-relay` | anywhere | TICK | `checkpoint` (the first) | 2 | That lamp's a relay now. Anything happens, we restore you there. |  |
| `any-gaze` | anywhere | TICK | 3 s gaze at blood (Blood writing on) | 2 | What are you looking at? Your feed's just stone. | **the camera sees bare stone** |
| `back-1` | anywhere | TICK | restore: first | 3 | Wren? Wren, sync is holding. Welcome back. | glitch: none |
| `back-hot-1` | anywhere | TICK | after `back-1` +0.9 s | 3 | ...did he see it? The body? | **hot mic** · offmic · glitch: none |
| `back-hot-2` | anywhere | ODESSA | after `back-hot-1` +0.25 s | 3 | Cut the hot mic, Tomasz. | glitch: none |
| `back-impact` | anywhere | ODESSA | restore: impact (also fall, hazard) | 2 | Restore logged. Slower on the rope this time, Elias. |  |
| `back-skitter` | anywhere | MAREN | restore: skitterling | 2 | Whatever that was, the boards warned us about it. |  |
| `back-mason` | anywhere | ODESSA | restore: the Mason | 2 | It came for you when you bled. Noted. |  |
| `back-dressed` | anywhere | TICK | restore: dressed | 2 | Your feed went square for a second. Then black. |  |
| `back-many` | anywhere | ODESSA | restore: 4th, then alternating | 2 | Fidelity holding. You're fine, Elias. You're fine. |  |

Limits (held by the tests): at most 84 characters, at most two panel rows of 42, at most 11 words (a hold of
max(2.5 s, words / 2.6 + 1 s), 2.5-5.5 s), only `A-Z a-z 0-9 . , ' ? ! : ; % ( ) [ ] -` and the em dash; Vesper
five words or fewer.

## 6. Presentation

**Subtitle panel** (`commsView.js`, subtitle mode). Head-locked, 1.4 m in front of the eyes, 0.95 m wide (× Text size),
centred about 15° below the eye line; it drops to about 22° while a VR hint card is up (they would overlap). The speaker's
shape and name in its colour, the signal bars, the line in white at ~1.4° letter height on a dark panel (82 % opaque). Fades in
0.2 s, out 0.35 s. Redrawn per line and per glitch change only (at most 3 per second), never per frame.

**Radio voices** (`radio3d.js`). **PLACEHOLDER VOICE-OVER.** There are no recordings: each transmission is "spoken" by a
synthesised voice-substitute (a pitched, formant-filtered syllable babble timed to the subtitle: Odessa warm and falling,
~196 Hz triangle; Tick quick and bouncy, ~138 Hz sawtooth; Maren dry and measured, ~176 Hz; Vesper flat square-wave syllables
with a two-tone suit chime). The radio chain: band-pass 350-3200 Hz, light saturation, a squelch click on and off, a static
bed that rises as the signal fails, the line's static bursts and dropouts, 30 % to the left ear (the earpiece). The hot mic is
muffled with no squelch; the not-quite voice comes without the radio filter, lower and warm. While a line is on air the music
ducks ~6 dB and the ambience ~3 dB; the creature is never ducked. **The real VO session (plan §8, M-C) replaces the babble with
recorded lines; the subtitles, timings and the radio chain stay.**

**The restore** (`planRestore` + `commsView.js` restore mode, `game.js _updateDeath`). Instead of the death panel, a 5.6 s
overlay in the clinical voice over the existing death fade (the death causes, sounds and respawn logic are untouched):

| t (s) | Line |
|---|---|
| 0.15-0.75 | the panel fades in: CONTINUITY · PERENNIAL DEEP RECOVERY |
| 0.45 | VITALS LOST AT *N* M, then the cause: BLUNT IMPACT · FREE FALL. NO FLOOR READ · PENETRATING TRAUMA. IRONWORK · MULTIPLE BITES. SMALL CONTACTS (a skitterling) · LARGE CONTACT. REMAINS NOT FOUND (the Mason) · PRECISION CUTS. REMAINS SQUARED (the Dresser) |
| 1.25 | RESTORE IN PROGRESS |
| 1.5-3.7 | SYNC 0-100 % (a later restore pauses at 97 %) |
| 3.95 | RESTORE COMPLETE · RESTORE *n* (this run's restores) |
| 4.45 | the last line |
| 5.6 | Continuity restores you at the last relay (the same `respawn()`); the overlay fades as the relay fades in |

The continue input (click / Enter, A / a trigger; from 0.6 s) skips it, exactly as it skipped the panel; hold X / R still
restarts. With no relays (Abyss) the overlay says NO RELAY ON THIS DESCENT / RESTORING AT THE THRESHOLD and the death panel
follows it. The **last line** worsens with the count and the depth (tier = min(3, (n - 1) / 2) + 0 above the Vault, 1 to the
Gullet, 2 below) and never repeats the one before. The first restore always says *First descent, Elias. History.* (Perennial
says it every time):

| Tier | Lines |
|---|---|
| 0 | Pattern stable. Welcome back, Elias. · Fidelity 99.8%. Highest on record. |
| 1 | Previous body left at *d* m. Do not retrieve. · Grey patches on both hands. Within tolerance. |
| 2 | Fade progression 0.4%. Proceed. · Previous body still reading warm. Disregard. |
| 3 | Restore count corrected: *n*. · Kit serial W-41 verified. First descent. |
| 4 | Two patterns on file. Keeping the newer. · Previous body: *d* m. It has moved. |
| 5 | First descent, Elias. First descent. · Do not look for the other bodies, Elias. |

Chapter I keeps the hints subtle: the serials and the 41 expeditions are for Chapter II.

**Relay, not checkpoint.** The toast says *Relay synced*; the death and pause buttons say *restore at the last relay*. The
boards, the blood and the section subtitles are the Lanternwrights' and are unchanged.

**Menu.** Under the tagline: *Perennial · Expedition 41 · The Underspire · Descent authorised* (VR: *PERENNIAL · EXPEDITION 41 ·
DESCENT AUTHORISED* in the tagline's place). The victory card: *Uplink lost below the Mark. Expedition 42 on standby.*

**Settings.** Settings › Sound › **Radio voices** (on; off = silent, the subtitles still show every line) and Settings ›
Access › **Signal glitches** (on; off = a plain panel, the radio static lowered). Both saved like every setting (Storage and the
save profile). They sit on Sound and Access because the VR Display and Comfort pages are full (six rows and a link each).

## 7. Budget

+1 draw call (2 triangles, one 1024 × 256 or 1024 × 512 canvas texture, no mipmaps) only while a line or the restore shows;
nothing otherwise. The wrist bars are drawn into the existing ECG canvas (0 calls). The director and the view allocate nothing
per frame (tested in a fresh process). The radio builds a handful of nodes once and about 15-25 per line, released after it.

## 8. How to add a line

1. Append an `L(id, speaker, text, { section, when, prio, ... })` to `COMMS_SCRIPT` in `src/sim/comms3d.js`. Use an existing
   trigger (§3; reuse bus events, do not add sim events). Keep it short (the limits in §5) and in the voice of its speaker.
2. A beat that must fire: priority 3 and a `beat` name; a reaction that is only worth hearing at once: a short `ttl`.
3. Run `node tools/abyssal-tether-3d/tests/comms/comms.mjs` (limits, charset, coverage, glitches, the director on a simulated
   descent), then update the table in §5.
4. Look at it: `AT3D.debug.comms.say('<id>', { glitch: 'static', at: 1 })` in the browser console, or a capture recipe
   (`capture-screens.mjs --only shots --recipe shot-comms`; also `shot-comms-deep` and `shot-restore`, all with `&comms=on`).

## 9. Not verified yet

Nothing has run on a headset: the head-locked text comfort and size, the spatial feel of the radio (the earpiece bias, the
not-quite voice from no direction), the restore overlay over the real death fade, and of course the real VO.
