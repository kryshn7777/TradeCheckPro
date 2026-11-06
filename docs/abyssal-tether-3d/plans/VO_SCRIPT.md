# ABYSSAL TETHER 3D — Voice-over script and actor package

**Status (2026-10-30): no human voice exists in the game.** Nobody has been cast or recorded. Every spoken radio line ships as
an **AI placeholder** clip (Kokoro-82M text-to-speech), disclosed in the About credits and the store listing. This document is
what a casting director, the actors and the recording engineer need to replace those placeholders with real performances. The
pipeline is built so that recordings drop in **with no code change**.

| | |
|---|---|
| Roles | 5 speaking roles: ODESSA, TICK, MAREN, VESPER and ELIAS (the player's own voice); the UPLINK "voice" is synthesised breathing: no actor |
| Lines | 62 live Chapter I lines + 5 Chapter II radio lines + 11 specified story-bible lines not yet in the game (record them in the same session) = 78 |
| Finished audio | about 2.5 minutes (lines are 1-6 s; most 2-4 s) |
| Session estimate | about 1 hour per actor for 3 takes of each line, plus pickups |
| Source of truth | the line text is the game's subtitle (`public/abyssal-tether-3d/src/sim/comms3d.js`); direction lives in `tools/abyssal-tether-3d/voice/direction.mjs`; the machine-readable table is `tools/abyssal-tether-3d/voice/lines.csv` |

## 1. The story in one paragraph (for the actors)

2291. Elias Wren is lowered into a sealed shaft under a 500-year-old cathedral-machine for the PERENNIAL programme. Four voices
talk to him over a failing wireless uplink while something vast hunts him. When he dies, a system called CONTINUITY "restores"
him at the last relay; the team behaves as if this is routine, and keeps slipping ("louder than last time"). The signal degrades
section by section until, at the bottom, the voice on the channel is not quite Odessa. Elias never speaks. The horror is in
what the team does not say: **play every line as ordinary, competent professionals.** The game adds every radio effect.

## 2. Casting notes

| Role | Age | Accent | Register | Must NOT |
|---|---|---|---|---|
| **ODESSA** Vance, programme director | 45-60 | neutral mid-Atlantic or soft RP; educated, unplaceable | warm mid alto; controlled, unhurried, the calmest voice on the channel; calls him "Elias" | be shrill, panicked, villain-coded or knowingly sinister; the slips must sound like ordinary speech, not hints |
| **TICK** (Tomasz Ilic), uplink tech | 22-32 | any light regional accent (Central-European roots welcome, not a caricature); casual | younger tenor / baritone; quick, jokey, nervous underneath; calls him "Wren" | be a cartoon nerd or mug the jokes; the fear is under the jokes, not instead of them |
| **MAREN** Soll, historian of the Lanternwrights | 55-70 | British or Northern-European English; precise consonants | dry, exact, low-key; academic understatement; real curiosity under the dryness | be theatrical, a "spooky narrator", or warm the way Odessa is |
| **VESPER**, the suit AI | any adult | neutral, unplaceable | clinical, even, five words or fewer; equal stress; no breath, no emotion | sound robotic-funny or menacing; it never glitches (the suit is the one clean voice); no processing on the take |

Distinctness matters more than beauty: a player must tell the four apart in one word through a band-passed radio. Cast two
voices of each register (two alto/soprano, two tenor/baritone or a clearly different timbre for Vesper) and audition them
through a telephone-band filter (300-3400 Hz).

**Pronunciation.** Elias = ih-LYE-us · Tomasz = TOH-mash · Wren = ren · Dessa = DESS-uh · Maren = MAH-ren · Lanternwrights =
LAN-tern-rites · Perennial = per-EN-ee-ul · "1791" = seventeen ninety-one · "99.8%" = ninety-nine point eight percent ·
"five-fifty-six" = five fifty-six (metres). The `say` column gives the spoken form wherever it differs from the subtitle.

## 3. Recording specification

- **Format:** WAV, **48 kHz, 24-bit, mono**, one file per line, named exactly by the line id: `s1-open-2.wav`.
- **Dry and close:** large-diaphragm condenser or broadcast dynamic, 15-20 cm, pop filter, treated room (no audible reflections,
  noise floor below -60 dBFS). **No processing at all**: no EQ, compression, limiting, de-noise, de-ess, reverb, and above all
  **no radio / phone effect** (the game's radio chain adds band-pass, squelch, static, dropouts and the stuck word at runtime;
  a baked effect would be doubled and would break the signal arc).
- **Levels:** peaks around -12 to -6 dBFS; never clip. The build normalises every take to -23 LUFS and trims silence; leave
  0.3-0.5 s of room tone before and after.
- **Takes:** 3 takes per line (slate the id), the director picks one. Deliver the chosen take as `<id>.wav`; keep alternates
  outside the recordings folder (for example `takes/<id>_t2.wav`).
- **Length:** each line has a **Max s** (the subtitle's reading time + 0.5 s, capped at 6 s). Longer takes still work (the
  subtitle holds longer) but break the pacing: aim inside it.
- **Special lines:** OFF MIC lines (`back-hot-1`, and the specified `ch-last`) are performed turned away from the mic about 1 m,
  quiet but intelligible, still unprocessed. The NOT QUITE ODESSA line (`s8-warm`) is delivered clean and close; the game
  pitches and doubles it. Lines with a stuck word (`s7-hang`, and any S6-S8 line at random) are recorded clean; the game makes
  the word stick using the word timing it measures from the take.
- **Pickups:** when the script changes after the session, `lines.csv` marks the affected recorded lines
  `NEEDED: script changed since the recording` (the build stores a hash of the text each take was made from).

## 4. How a recording replaces the AI placeholder (no code change)

1. Put `<id>.wav` files into `tools/abyssal-tether-3d/voice/recordings/`.
2. Run `python3 tools/abyssal-tether-3d/build_voices.py` (Python deps: `pip install -r tools/abyssal-tether-3d/voice/requirements.txt`;
   `--no-ai` if the AI model is not fetched on that machine; `--report out.md` for a per-clip table).
3. The build converts each WAV (mono, 24 kHz, 70 Hz high-pass, trimmed, -23 LUFS, Opus 24 kb/s), measures its word timing
   (PocketSphinx forced alignment) and writes `public/abyssal-tether-3d/assets/audio/voice/<speaker>/<id>.ogg` and
   `manifest.json` with `"src": "human"`. **A recording always overrides the AI clip of the same id.**
4. The game reads the manifest; the subtitle is timed by the new clip automatically. Run `npm run test:at3d` (the voice suite
   checks every line has a clip, the budget, the word timings) and ship.

Lines without a recording keep the AI placeholder (or, with `--no-ai`, the synthesised babble).

## 5. The AI placeholder (what ships today)

| Speaker | Kokoro voice blend (style tensors mixed by weight) | Language | Base speed | Pitch | Always-on fx |
|---|---|---|---|---|---|
| ODESSA | af_heart 0.65 + af_nicole 0.25 + af_kore 0.10 | American English | 0.94 | -0.3 st | |
| TICK | am_puck 0.70 + am_fenrir 0.30 | American English | 1.08 | | |
| MAREN | bf_emma 0.70 + bf_isabella 0.30 | British English | 0.93 | -0.6 st | |
| VESPER | bm_george 0.70 + bm_daniel 0.30 | British English | 1.00 | | (never a breath) |
| ELIAS | am_michael 0.70 + am_onyx 0.30 | American English | 0.94 | -0.5 st | close (proximity) |

- **Engine:** Kokoro-82M v1.0 at **full precision**: the onnx-community fp32 ONNX export (`onnx/model.onnx`, 325,532,232 bytes,
  SHA-256 `8fbea51e...21a34cb`, pinned to repository revision `1939ad2a`), replacing the q8 quantisation (`model_quantized.onnx`,
  `fbae9257...a1478`) the first placeholders used. Run on CPU by `kokoro-onnx` 0.6.1 (onnxruntime, a fixed thread count) with
  espeak-ng phonemes. `build_voices.py --fetch` downloads the model and the 11 official voice style tensors the cast blends from,
  from huggingface.co at that revision, and refuses any file whose SHA-256 differs (the table is `ENGINE` / `VOICE_SHA256` in
  `build_voices.py`); they live in `tools/abyssal-tether-3d/voice/.cache/kokoro-fp32/` (git-ignored, ~331 MB).
- **Licence:** Apache-2.0 (model and voices). Commercial use is permitted; we credit it. The generated clips contain no third-party
  recording. espeak-ng (GPL-3.0) and PocketSphinx (BSD-2) are build-time tools only and are not shipped.
- **Direction (the AI now acts):** `tools/abyssal-tether-3d/voice/performance.json` performs every line: the story moment, the
  emotion and register, a line speed and pitch, and the take itself, phrase by phrase: each phrase synthesised on its own (its own
  speed and pitch, stressed words forced to primary stress in the phonemes and lifted 2 dB) and joined with measured silences;
  false starts cut from the speech itself; synthesised breaths, exhales and half-laughs; trailing off; per-line fx (close,
  breathy, hushed, off mic). A line too long for its Max s gives its pauses first, then its pace (<= 1.16x). The word timing is
  aligned phrase by phrase. The per-line table, the cast choices and what was measured: `VO_DIRECTION.md`. The `ai_pace` /
  `ai_pitch` columns of `lines.csv` echo the line speed and pitch from it; the Direction column stays the actors' brief.
- **Clips:** Ogg Opus mono 24 kHz at 32 kb/s (was 24 kb/s: the breaths and the dry in-suit voice keep their air), -23 LUFS each,
  peaks under -1 dBFS; about 0.9 MB for the 67 clips (budget 2.5 MB).
- **Measured, not heard:** nobody has listened to these clips during the build (there was no listener in the build session).
  They were checked by machine: loudness and peaks, every clip word-aligned, the pauses measured in the audio, and a generic
  speech recogniser (PocketSphinx, its default news language model) as a rough intelligibility check (see VO_DIRECTION.md).
  That is a weak recogniser, not a perception test. **Listen to them before any release.**
- **Disclosure:** while any AI clip ships, the About credits (page and VR panel) and the store listing say the radio voices are
  AI-generated placeholders, not actors (RELEASE.md §18.0 item 10).

## 6. Licensing for the human session

- A work-for-hire or buy-out agreement per actor covering the game, its updates, trailers and store media, worldwide, perpetual.
- **Explicit consent clause for AI:** no synthetic voice, voice clone or training on the actor's recordings without separate
  written consent and payment (a union agreement such as SAG-AFTRA's interactive media terms may require this anyway).
- Credit each actor by name and role in the About credits; remove the AI wording from the credits and the listing once the last
  AI clip is replaced.

## 7. The lines

Columns: **Id** (the file name), **Sect.** (S1-S8, or *any* = can play anywhere), **Trigger** (what makes it play), the
**Line** as the subtitle shows it (with the spoken form when different, and the kind: *offmic*, *notquite*, *echo*),
**Direction**, **Max s**, **Pickup** (filled by the exporter once human takes exist).

<!-- LINES:BEGIN -->
<!-- generated by tools/abyssal-tether-3d/voice/export-lines.mjs: edit voice/direction.mjs or comms3d.js, then re-run -->

#### ODESSA (16 lines) — Odessa Vance, programme director (gold, diamond)

| Id | Sect. | Trigger | Line (subtitle) | Direction | Max s | Pickup |
|---|---|---|---|---|---|---|
| `s1-open-2` | S1 | 0.4 s after s1-open-1 | **First descent, Elias. History.** | Warm, proud, controlled: a director marking a moment for the record. A small smile. "History." lands a beat later. | 3 |  |
| `s1-open-5` | S1 | 0.4 s after s1-open-4w | **The Ember's dimming, Elias. Bring us a kindling. Take your time.** | Warm, unhurried. "Take your time" is reassurance that is slightly too practised. | 5.7 |  |
| `s1-bell-1` | S1 | event hint (hint about "bell") or event bell:ring | **Mind the bell, Elias. It's louder than last time.** | A casual warning. THE SLIP: "louder than last time" must come out natural; she does not notice it. Do not land it. | 5 |  |
| `s1-bell-3` | S1 | 0.3 s after s1-bell-2 | **The probes, Tomasz. Focus.**<br>*say:* The probes, Tomash. Focus. | A smooth correction a fraction too fast: covering. Cool, not angry. | 3 |  |
| `s4-enter` | S4 | entering S4 (+1.5 s) | **A hundred metres, Elias. Vitals good. Signal's thinning.** | A calm status update. "Signal's thinning" neutral, deliberately unworried. | 4.6 |  |
| `s4-stall` | S4 | no progress for 60 s (voiced hint) | **The cold lamps, Elias. Hold your lantern to each one.** | A practical hint; patient. | 5.3 |  |
| `s5-enter` | S5 | entering S5 (+1 s) | **Contact above you, Elias. Keep moving. Don't look for it.** | Urgent but controlled: the director voice. Clipped. Never shouted. | 5.3 |  |
| `s7-iris` | S7 | event objective:done verb=survive | **The iris is open. Go now, Elias.** | An urgent command: the most force she uses all chapter. Still not shouted. | 4.2 |  |
| `s8-enter` | S8 | entering S8 (+1 s) | **Signal's going, Elias. Whatever you hear after this, it's us.** | Very calm, slower, emphatic: she needs him to believe it. "it's us" lands. | 5.3 |  |
| `s8-warm` | S8 | reaching 526 m in S8 | **Keep coming down, Elias. It's warm down here.** *(notquite)* | NOT QUITE ODESSA. Record it as Odessa, but too close, too intimate, too slow, smiling; no radio distance. The game pitches and doubles it at runtime: deliver it clean, no effect. | 4.6 |  |
| `s8-stall` | S8 | no progress for 60 s (voiced hint) | **The grate, Elias. Run for the light.** | Urgent, controlled. | 4.2 |  |
| `any-low` | any | event health:low | **Vitals red. Staging a restore at the last relay.** | Procedural and calm, reading a checklist while he is dying. Cold in its calm. | 5 |  |
| `back-hot-2` | any | 0.25 s after back-hot-1 | **Cut the hot mic, Tomasz.**<br>*say:* Cut the hot mic, Tomash. | Sharp, quiet, fast. Ice. | 3.4 |  |
| `back-impact` | any | after a restore (impact) | **Restore logged. Slower on the rope this time, Elias.** | A logged note, then a mild instruction; professional warmth. | 5 |  |
| `back-mason` | any | after a restore (mason) | **It came for you when you bled. Noted.** | A clinical observation. "Noted." flat. | 4.6 |  |
| `back-many` | any | after a restore (many) | **Fidelity holding. You're fine, Elias. You're fine.** | Reassurance; the second "You're fine" slightly too firm. She is reassuring herself. | 4.2 |  |

#### TICK (20 lines) — Tomasz "Tick" Ilic, uplink tech (cyan, circle)

| Id | Sect. | Trigger | Line (subtitle) | Direction | Max s | Pickup |
|---|---|---|---|---|---|---|
| `s1-open-3` | S1 | 0.4 s after s1-open-2w | **Uplink's clean, five bars. I've got your eyes and your heart.** | Bright and quick, showing off his kit; a touch too cheerful. Close on a headset mic. | 5.7 |  |
| `s1-bell-2` | S1 | 0.35 s after s1-bell-1 | **Last time?** | Genuinely puzzled, half a laugh. Quick. | 3 |  |
| `s1-stall` | S1 | no progress for 60 s (voiced hint) | **Fire at the glowing ring and hold. Let the rope work.** | A patient hint; he has been watching you hang there. Coaching, friendly. | 5.7 |  |
| `s2-stall` | S2 | no progress for 60 s (voiced hint) | **Hook the counterweight and haul. That's your way down.** | A practical hint, plain. | 5 |  |
| `s3-winch` | S3 | event objective:done verb=winch | **Gear's turning. Five hundred years, and it still turns.** | Awed, with a small nervous laugh in it. | 5 |  |
| `s3-stall` | S3 | no progress for 60 s (voiced hint) | **Ride the gear. Hook its ring and hold on.** | A practical hint, plain. | 5 |  |
| `s4-sight` | any | event creature:sighting | **Did you see that? Something big, out in the dark.** | Startled, fast, the fear rising; trying to sound casual and failing. | 5.3 |  |
| `s5-frayed` | S5 | entering S5 (+14 s) | **Careful in the middle. Those rings are frayed. They hold once.** | THE LINE NOBODY SENT. Play it as ordinary, helpful Tick: casual, kind. It must sound exactly like him; the horror comes 40 s later. | 5.7 |  |
| `s5-mute` | any | 40 s after s5-frayed | **Sorry, been on mute for two minutes. Did I miss anything?** | Breezy and oblivious, just back at the mic. Light. He has no idea. | 5.7 |  |
| `s5-key` | S5 | event objective:done verb=breach | **That was loud. Everything down there heard that.** | Hushed and scared, close to the mic, almost under his breath. | 4.6 |  |
| `s5-stall` | S5 | no progress for 60 s (voiced hint) | **The keystone: hide and let it knock, or haul its ring.** | A practical hint, plain. | 5.7 |  |
| `s7-hang` | S7 | reaching 296 m in S7 | **The floor unbolts while you hold. So hold, Wren.** | Tense instruction, trying to steady him. (The game makes one word stick; record it clean.) | 5 |  |
| `s7-stall` | S7 | no progress for 60 s (voiced hint) | **Chain the rings. Fire the next before you let go.** | A practical hint, quick. | 5.3 |  |
| `s8-probes` | S8 | reaching 500 m in S8 | **Probes all died at five-fifty-six. No pressure, Wren.** | Gallows humour; the voice nearly cracks under the joke. | 5.3 |  |
| `any-hurt` | any | event health:damage lethal=false cause!=creature\|skitter | **Vesper says that was minor. I say ow. Easy, Wren.** | Wincing sympathy, joking to cover the worry. | 5.3 |  |
| `any-relay` | any | event checkpoint | **That lamp's a relay now. Anything happens, we restore you there.** | An upbeat tech explanation. | 5.7 |  |
| `any-gaze` | any | 3 s looking at a blood writing (Blood writing on) | **What are you looking at? Your feed's just stone.** | Puzzled, light, a little uneasy. | 5 |  |
| `back-1` | any | after a restore (first) | **Wren? Wren, sync is holding. Welcome back.** | The first restore: relief, careful, checking he is really there. | 4.2 |  |
| `back-hot-1` | any | 0.9 s after back-1 | **...did he see it? The body?** *(offmic)* | OFF MIC: turned away, whispering to Odessa, not meant for Elias. Record about 1 m off-axis, quiet but intelligible. | 3.8 |  |
| `back-dressed` | any | after a restore (dressed) | **Your feed went square for a second. Then black.** | Shaken, quiet; he does not want to say what he saw. | 5 |  |

#### MAREN (9 lines) — Dr. Maren Soll, historian of the Lanternwrights (white, triangle)

| Id | Sect. | Trigger | Line (subtitle) | Direction | Max s | Pickup |
|---|---|---|---|---|---|---|
| `s1-open-4` | S1 | 0.4 s after s1-open-3w | **Nobody's stood there since 1791. Read me every board you pass.**<br>*say:* Nobody's stood there since seventeen ninety-one. Read me every board you pass. | Dry, precise, quietly thrilled underneath: the historian meeting her subject. Crisp consonants. | 6 |  |
| `s2-board` | S2 | reaching 24 m in S2 | **'It does not send us back.' Cheerful people, the Lanternwrights.**<br>*say:* 'It does not send us back.' Cheerful people, the Lantern wrights. | Reads the board aloud flat, as a quotation; then a bone-dry aside. | 5.7 |  |
| `s2-haul` | S2 | event objective:done verb=haul | **That chain's been oiled. Recently. Write that down, Tomasz.**<br>*say:* That chain's been oiled. Recently. Write that down, Tomash. | Precise, unsettled underneath. A beat before "Recently." A brisk instruction to finish. | 5 |  |
| `s3-enter` | S3 | entering S3 (+3 s) | **Closed from this side. So someone was still inside.** | Quiet deduction. The second sentence lower and slower. | 5 |  |
| `s4-knock` | S4 | reaching 108 m in S4 | **If something knocks, don't knock back. Their rule. I'd keep it.** | Low and careful, close to a whisper, as if the thing could hear the radio. | 5.7 |  |
| `s6-fork` | S6 | entering S6 (+5 s) | **The Throat is 'for the late'. I'd like you early, Elias.** | Dry wit, but real care leaks through on "early". | 5.7 |  |
| `s6-stall` | S6 | no progress for 60 s (voiced hint) | **Either way down will do. Standing still won't.** | Dry, a little impatient. | 4.6 |  |
| `s7-enter` | S7 | entering S7 (+2 s) | **Nothing to stand on. A church you can only hang in.** | Quiet awe, almost to herself. | 5.7 |  |
| `back-skitter` | any | after a restore (skitter) | **Whatever that was, the boards warned us about it.** | Dry, a little shaken. | 5 |  |

#### VESPER (5 lines) — Vesper, the suit AI (grey, square); in the suit, not on the radio

| Id | Sect. | Trigger | Line (subtitle) | Direction | Max s | Pickup |
|---|---|---|---|---|---|---|
| `s1-open-1` | S1 | entering S1 (+1.4 s) | **Restore complete. Continuity 99.8%.**<br>*say:* Restore complete. Continuity ninety-nine point eight percent. | In-suit readout as he wakes. Clinical, even, equal stress. He takes it for a lowering check; so does the line. | 4.6 |  |
| `s6-enter` | S6 | entering S6 (+0.8 s) | **Signal degraded. Latency rising.** | Suit status. Clinical, even. | 3 |  |
| `s6-skit` | any | first skitterling contact | **Contact. Small. Closing.** | Suit alert. Three flat words, evenly spaced. No urgency in the voice; the words carry it. | 3 |  |
| `s8-two` | S8 | reaching 470 m in S8 | **Heart rates: two. Recalibrating.** | Suit readout. Even; the number is just a number. | 3 |  |
| `s8-lost` | S8 | reaching 538 m in S8 | **Uplink lost.** | Suit readout. Two words, flat, final. | 3 |  |

#### ELIAS (12 lines) — Elias Wren, the player: your own voice in the suit (pale blue-white, ring)

| Id | Sect. | Trigger | Line (subtitle) | Direction | Max s | Pickup |
|---|---|---|---|---|---|---|
| `s1-open-2w` | S1 | 0.5 s after s1-open-2 | **First. Right. Copy, Odessa.** | A beat after "History." Flat, a half-step too quiet: "First." catches on something; "Right." is him putting it away. Then the professional "Copy, Odessa." | 3 |  |
| `s1-open-3w` | S1 | 0.4 s after s1-open-3 | **Five bars. Keep them coming, Tick.** | Practical, a little dry. "Keep them coming" is half a joke and half meant. | 3.8 |  |
| `s1-open-4w` | S1 | 0.4 s after s1-open-4 | **Every board, Doctor Soll. You'll hear all of it.** | Patient, the faintest smile. The reassurance of a man who has done this kind of thing before. | 5 |  |
| `s1-open-5w` | S1 | 0.4 s after s1-open-5 | **Kindling. Rope by rope. Going down.** | Low and quiet, to himself as much as to them. "Going down" is a decision, not a boast. | 3.8 |  |
| `s1-self` | S1 | no progress for 60 s (voiced hint) | **Think, Elias. The grating won't open itself. A bell, somewhere.** | Muttered, thinking aloud; the third sentence rises, finding it. Close to the mic, a little breath. | 5.3 |  |
| `s2-self` | S2 | no progress for 60 s (voiced hint) | **A counterweight. Hook it and haul, Elias. Don't just stand here.** | Muttered, a little impatient with himself. "Don't just stand here" is an order he gives himself. | 5.7 |  |
| `s3-self` | S3 | no progress for 60 s (voiced hint) | **The gear still turns. Hook its ring, let it carry me.** | Working it out as he says it, slow, then decided on "let it carry me". | 5.7 |  |
| `s4-self` | S4 | no progress for 60 s (voiced hint) | **Cold lamps. My lantern, one at a time. Slowly.** | Hushed: the vault is listening. Slow, careful, each word placed. | 5 |  |
| `s5-self` | S5 | no progress for 60 s (voiced hint) | **The keystone. Hide and let it knock. Or haul the ring.** | Tight, under his breath; the "Or" is a real choice he has not made yet. | 5.7 |  |
| `s6-self` | S6 | no progress for 60 s (voiced hint) | **Two ways down. Pick one, Elias. Standing here picks neither.** | Dry, tired, almost amused at his own stalling. | 5.3 |  |
| `s7-self` | S7 | no progress for 60 s (voiced hint) | **One ring, then the next. Never let go first.** | A rhythm he is saying to keep moving: even, a mantra. "Never let go first" is the rule. | 5 |  |
| `s8-self` | S8 | no progress for 60 s (voiced hint) | **The grate. Don't look back. Run for the light.** | Out of breath, low, urgent but controlled. Not a shout. | 5 |  |

#### UPLINK (1 line) — the open channel (no speaker)

| Id | Sect. | Trigger | Line (subtitle) | Direction | Max s | Pickup |
|---|---|---|---|---|---|---|
| `s4-echo` | S4 | reaching 124 m in S4 | **[Your breathing comes back on the channel. Two seconds late.]** *(echo)* | NO ACTOR. The channel plays the player's breathing back two seconds late; the game synthesises it. | 5.3 |  |

#### CHAPTER II · LAMPHOLD (5 lines; data/chapter2-text.js radio, said by chapter2Glue.js radioScript)

| Id | Sect. | Trigger | Line (subtitle) | Direction | Max s | Pickup |
|---|---|---|---|---|---|---|
| `c2-open` | II-S1 | entering II-1 (+2.5 s) | **ODESSA: Five bars, Elias. Down here. The lamps are carrying us.** | Relief and a little wonder: five bars, this deep. "Down here." is almost to herself. Warmer than Chapter I, still controlled. | 5.3 |  |
| `c2-bell` | II-S5 | the Usher answers a toll (II-9, the second answer) | **TICK: Something answered the bell. Wren, it answered the bell.** | The jokes are gone. Fast, breath caught; the repeat climbs and stresses "bell". Not a scream. | 5 |  |
| `c2-rule` | II-S5 | 1 s after c2-bell | **MAREN: Not your footsteps. Not you. The bell.** | Cold, exact: she has worked out the rule. Three short sentences, a beat between; "The bell." lower and slower. | 4.2 |  |
| `c2-bars` | II-S6 | entering II-12 (+3 s) | **ODESSA: Bars are dropping, Elias. Lamps are going out.** | Calm under pressure: reporting, not alarming. A touch quicker than her usual. | 4.6 |  |
| `c2-orderly` | II-S6 | the Round begins (II-12, phase A) | **MAREN: That isn't the Mason. That's orderly.** | Hushed realisation. A beat before "That's orderly."; the word is the chill. | 3.8 |  |

#### PUZZLE FOCUS (81 lines; data/puzzle-focus-text.js, said by puzzleFocusGlue.js when the player reaches a puzzle: plans/PUZZLE_FOCUS.md)

| Id | Sect. | Trigger | Line (subtitle) | Direction | Max s | Pickup |
|---|---|---|---|---|---|---|
| `pf-bell-1a` | S1 | puzzle focus: bell, first sight | **ELIAS: A bell. Why is there a bell down here?** | Half to himself, puzzled more than afraid. A small breath before "Why". | 5 |  |
| `pf-bell-1b` | S1 | puzzle focus: bell, first sight | **TICK: Wren, your scanner's pinging brass under you. Big. Hollow.** | Reading his screen, curious, quick. "Big. Hollow." as he reads it off. | 5 |  |
| `pf-bell-2a` | S1 | puzzle focus: bell, 40 s later, still pending | **ODESSA: That bell's hung to be struck, Elias. Swing into it.** | Patient, warm, a teacher who has seen it done. No hurry. | 5.3 |  |
| `pf-bell-2b` | S1 | puzzle focus: bell, 40 s later, still pending | **ELIAS: Hung to be struck. So strike it. Swing hard.** | Working it out loud; the last two words decided. | 5 |  |
| `pf-bell-3a` | S1 | puzzle focus: bell, the 20 s highlight comes on | **TICK: Marked the bell for you, Wren. Swing into it hard.** | Helpful, a little pleased with his marker. Quick. | 5.3 |  |
| `pf-bell-3b` | S1 | puzzle focus: bell, the 20 s highlight comes on | **VESPER: Bell marked. Strike it.** | Suit readout. Flat. | 3 |  |
| `pf-haul-1a` | S2 | puzzle focus: haul, first sight | **MAREN: A counterweight. Lanternwright work. That chain lowers something.** | Dry, exact, interested: she has read about these and never seen one. | 4.6 |  |
| `pf-haul-1b` | S2 | puzzle focus: haul, first sight | **ELIAS: A counterweight on a chain. That's my way down.** | Sizing it up. Practical, tired. | 5 |  |
| `pf-haul-2a` | S2 | puzzle focus: haul, 40 s later, still pending | **TICK: Wren, the counterweight. Hook it and haul. It ratchets.** | Explaining kit he likes. Brisk. | 5 |  |
| `pf-haul-2b` | S2 | puzzle focus: haul, 40 s later, still pending | **ELIAS: Hook the weight. Haul. One notch at a time.** | Muttered plan, one step per breath. | 5 |  |
| `pf-haul-3a` | S2 | puzzle focus: haul, the 20 s highlight comes on | **ODESSA: The counterweight's marked, Elias. Hook it and haul.** | Calm instruction, warm. | 4.6 |  |
| `pf-haul-3b` | S2 | puzzle focus: haul, the 20 s highlight comes on | **VESPER: Counterweight marked. Haul it.** | Suit readout. Flat. | 3 |  |
| `pf-winch-1a` | S3 | puzzle focus: winch, first sight | **TICK: Something's moving on your scanner, Wren. A gear. Still turning.** | Surprised, a nervous little laugh under it. | 5.3 |  |
| `pf-winch-1b` | S3 | puzzle focus: winch, first sight | **ELIAS: That gear's still turning. There's a ring on it.** | Low, noticing. A beat between the sentences. | 5 |  |
| `pf-winch-2a` | S3 | puzzle focus: winch, 40 s later, still pending | **MAREN: Their gears carried people, Elias. Let it carry you.** | Dry, a historian giving a practical tip. | 5 |  |
| `pf-winch-2b` | S3 | puzzle focus: winch, 40 s later, still pending | **ELIAS: Catch the ring as it comes round. Let it carry me.** | Timing it under his breath. | 5.7 |  |
| `pf-winch-3a` | S3 | puzzle focus: winch, the 20 s highlight comes on | **TICK: Marked the gear ring. Hook it when it's out, Wren.** | Quick, helpful. | 5.3 |  |
| `pf-winch-3b` | S3 | puzzle focus: winch, the 20 s highlight comes on | **VESPER: Gear ring marked. Time it.** | Suit readout. Flat. | 3.4 |  |
| `pf-lamp-1a` | S4 | puzzle focus: lamp, first sight | **MAREN: Cold lamps. They lit them to pass. Hold your light close.** | Hushed: the vault is listening. Exact. | 5.7 |  |
| `pf-lamp-1b` | S4 | puzzle focus: lamp, first sight | **ELIAS: A dead lamp. Wick's still there. My lantern, then.** | Whispered to himself. | 5 |  |
| `pf-lamp-2a` | S4 | puzzle focus: lamp, 40 s later, still pending | **ODESSA: Three cold lamps, Elias. Your lantern to each wick.** | Quiet, controlled. | 5 |  |
| `pf-lamp-2b` | S4 | puzzle focus: lamp, 40 s later, still pending | **ELIAS: Still dark ones. Lantern to the wick. Hold it there.** | Whispered, patient. | 5.3 |  |
| `pf-lamp-3a` | S4 | puzzle focus: lamp, the 20 s highlight comes on | **TICK: Marked the dark wicks, Wren. Hold your lantern there.** | Hushed for once. | 5 |  |
| `pf-lamp-3b` | S4 | puzzle focus: lamp, the 20 s highlight comes on | **VESPER: Cold wicks marked.** | Suit readout. Flat. | 3 |  |
| `pf-rest-1a` | any | puzzle focus: rest, first sight | **MAREN: A Masons' rest. It cannot follow you in. Remember it.** | Low, urgent under the dryness: this one matters. | 5.3 |  |
| `pf-rest-1b` | any | puzzle focus: rest, first sight | **ELIAS: Lamp-lit corner. Carved glyphs. Somewhere to hide.** | Noting it, breath held. | 4.6 |  |
| `pf-breach-1a` | S5 | puzzle focus: breach, first sight | **ELIAS: That stone's holding the grating up. A keystone.** | Working it out, quiet: something is above him. | 4.6 |  |
| `pf-breach-1b` | S5 | puzzle focus: breach, first sight | **TICK: Scanner says one stone's carrying the whole grate. Huh.** | Reading, then the "Huh." of someone who gets it. | 5 |  |
| `pf-breach-2a` | S5 | puzzle focus: breach, 40 s later, still pending | **MAREN: Let it knock, they wrote. Its blows break stone.** | Cold, exact: the rule as a tool. | 5 |  |
| `pf-breach-2b` | S5 | puzzle focus: breach, 40 s later, still pending | **ELIAS: Hide in the niche. Let it hit the stone. Or haul.** | Fast, low, a plan made in fear. | 5.7 |  |
| `pf-breach-3a` | S5 | puzzle focus: breach, the 20 s highlight comes on | **TICK: Keystone marked. Hide and let it knock, or haul the ring.** | Fast, nervous. | 5.7 |  |
| `pf-breach-3b` | S5 | puzzle focus: breach, the 20 s highlight comes on | **VESPER: Keystone marked. Loud option: haul.** | Suit readout. Flat. | 3.4 |  |
| `pf-lure-1a` | S5 | puzzle focus: lure, first sight | **MAREN: That niche. 'Let it knock. Do not knock back.' Get in.** | Reading the plaque, then an order she has no right to give. | 5.7 |  |
| `pf-lure-1b` | S5 | puzzle focus: lure, first sight | **ELIAS: A niche behind the keystone. Small enough to hide in.** | Whispered. | 5.3 |  |
| `pf-fork-1a` | S6 | puzzle focus: fork, first sight | **MAREN: Two ways down, Elias. The slow stair or the quick rings.** | Through static. Even, a choice laid out. | 5.7 |  |
| `pf-fork-1b` | S6 | puzzle focus: fork, first sight | **ELIAS: Two ways down. Stairs, or those rings. Choose.** | Tired, weighing it. | 4.6 |  |
| `pf-fork-2a` | S6 | puzzle focus: fork, 40 s later, still pending | **ELIAS: Pick a way. Hook the last ring on either line.** | Firm with himself. | 5.3 |  |
| `pf-fork-2b` | S6 | puzzle focus: fork, 40 s later, still pending | **VESPER: Two routes. Either suffices.** | Suit readout. Flat. | 3 |  |
| `pf-fork-3a` | S6 | puzzle focus: fork, the 20 s highlight comes on | **VESPER: Route rings marked. Hook one.** | Suit readout. Flat. | 3.4 |  |
| `pf-fork-3b` | S6 | puzzle focus: fork, the 20 s highlight comes on | **TICK: Marked both last rings, Wren. Either one opens it.** | Through static, quick. | 5 |  |
| `pf-survive-1a` | S7 | puzzle focus: survive, first sight | **ELIAS: The iris. It won't open while I stand on the landing.** | Reading the tablet aloud, then understanding it. Low. | 5.7 |  |
| `pf-survive-1b` | S7 | puzzle focus: survive, first sight | **VESPER: Iris sealed. Hang below.** | Suit readout. Flat. | 3 |  |
| `pf-survive-2a` | S7 | puzzle focus: survive, 40 s later, still pending | **ELIAS: Off the landing. Hang in the nave. Hold on.** | Bracing himself. | 5 |  |
| `pf-survive-2b` | S7 | puzzle focus: survive, 40 s later, still pending | **VESPER: Landing pauses it. Descend.** | Suit readout. Flat. | 3 |  |
| `pf-survive-3a` | S7 | puzzle focus: survive, the 20 s highlight comes on | **VESPER: Iris marked. Keep hanging.** | Suit readout. Flat. | 3 |  |
| `pf-survive-3b` | S7 | puzzle focus: survive, the 20 s highlight comes on | **ELIAS: Hang on, Elias. It opens for the ones who hang.** | Through the teeth. | 5.3 |  |
| `pf-swing-1a` | any | puzzle focus: swing, first sight | **TICK: That ring's swinging, Wren. Catch it on the way in.** | Delighted, five bars again. | 5.3 |  |
| `pf-swing-1b` | any | puzzle focus: swing, first sight | **ELIAS: A ring on a chain, swinging. Catch it as it comes.** | Watching it, timing it. | 5.7 |  |
| `pf-lift-1a` | II-S2 | puzzle focus: lift, first sight | **TICK: Lift on the wall, Wren. Ring on top. Free ride.** | Cheerful, the old Tick for a moment. | 5.3 |  |
| `pf-lift-1b` | II-S2 | puzzle focus: lift, first sight | **ELIAS: A lift on the wall. Counterweighted. Still running.** | Impressed despite himself. | 4.6 |  |
| `pf-knocker-1a` | II-S2 | puzzle focus: knocker, first sight | **MAREN: A knocker. 'Knock, and be known.' Hook it, Elias.** | Reading the canon plaque with relish. | 5 |  |
| `pf-knocker-1b` | II-S2 | puzzle focus: knocker, first sight | **ELIAS: A door with a knocker. Somebody's name behind it.** | Gentle: it is someone's house. | 5 |  |
| `pf-knocker-2a` | II-S2 | puzzle focus: knocker, 40 s later, still pending | **MAREN: Knock first, Elias. Their names are behind the doors.** | Dry, a little insistent. | 5 |  |
| `pf-knocker-2b` | II-S2 | puzzle focus: knocker, 40 s later, still pending | **ELIAS: Hook the knocker. Knock. Be known.** | Quiet, almost a ritual. | 3.8 |  |
| `pf-knocker-3a` | II-S2 | puzzle focus: knocker, the 20 s highlight comes on | **TICK: Marked the knocker, Wren. Hook it, that's a knock.** | Quick, a little proud of the joke. | 5 |  |
| `pf-knocker-3b` | II-S2 | puzzle focus: knocker, the 20 s highlight comes on | **VESPER: Knocker marked. Hook it.** | Suit readout. Flat. | 3 |  |
| `pf-name-1a` | any | puzzle focus: name, first sight | **MAREN: A name, carved and lit. Read it to me, Elias.** | Soft: this is why she came. | 5.3 |  |
| `pf-name-1b` | any | puzzle focus: name, first sight | **ELIAS: Someone's name, lit like a grave. Go and read it.** | Quiet respect. | 5.3 |  |
| `pf-peal-1a` | II-S5 | puzzle focus: peal, first sight | **MAREN: Ring the morning, they wrote. Five bells, Elias. Then listen.** | Reading, then a warning she cannot name. | 5.3 |  |
| `pf-peal-1b` | II-S5 | puzzle focus: peal, first sight | **ELIAS: Bells. A whole row of them. Swing into them?** | Uneasy: the last bell answered. | 5 |  |
| `pf-peal-2a` | II-S5 | puzzle focus: peal, 40 s later, still pending | **TICK: That's five bells to open the floor, Wren. Swing through.** | Trying to be light; not quite. | 5.3 |  |
| `pf-peal-2b` | II-S5 | puzzle focus: peal, 40 s later, still pending | **ELIAS: Five bells. Swing from the beam. One after another.** | Planning, low. | 5 |  |
| `pf-peal-3a` | II-S5 | puzzle focus: peal, the 20 s highlight comes on | **TICK: Marked the bells you haven't rung. Swing through them.** | Quick, helpful. | 5 |  |
| `pf-peal-3b` | II-S5 | puzzle focus: peal, the 20 s highlight comes on | **VESPER: Unrung bells marked.** | Suit readout. Flat. | 3 |  |
| `pf-clapper-1a` | II-S6 | puzzle focus: clapper, first sight | **ELIAS: A clapper ring on the rim. Haul it, a bell speaks.** | Whispered, thinking fast: the Doorman is near. | 5.7 |  |
| `pf-clapper-1b` | II-S6 | puzzle focus: clapper, first sight | **MAREN: Clapper rings. Haul one and a bell speaks over there.** | Through static, hushed. | 5.3 |  |
| `pf-clapper-2a` | II-S6 | puzzle focus: clapper, 40 s later, still pending | **ELIAS: Put the bell where I'm not. Haul the clapper.** | The plaque's rule, said as a plan. | 5 |  |
| `pf-clapper-2b` | II-S6 | puzzle focus: clapper, 40 s later, still pending | **VESPER: Clapper ring. Haul to toll.** | Suit readout. Flat. | 3.4 |  |
| `pf-clapper-3a` | II-S6 | puzzle focus: clapper, the 20 s highlight comes on | **VESPER: Clapper marked. Haul it.** | Suit readout. Flat. | 3 |  |
| `pf-clapper-3b` | II-S6 | puzzle focus: clapper, the 20 s highlight comes on | **ELIAS: There. The clapper. Haul it and get clear.** | Tight, fast. | 4.6 |  |
| `pf-pawl-1a` | II-S6 | puzzle focus: pawl, first sight | **ELIAS: The gate's pawl. Hit it hard enough and it breaks.** | Low, sizing up iron. | 5.3 |  |
| `pf-pawl-1b` | II-S6 | puzzle focus: pawl, first sight | **MAREN: That pawl holds the gate. Iron breaks to a blow.** | Through static, exact. | 5.3 |  |
| `pf-pawl-2a` | II-S6 | puzzle focus: pawl, 40 s later, still pending | **ELIAS: Swing into the pawl. Faster. It wants a real blow.** | Breathing hard. | 5.3 |  |
| `pf-pawl-2b` | II-S6 | puzzle focus: pawl, 40 s later, still pending | **VESPER: Pawl intact. Strike harder.** | Suit readout. Flat. | 3 |  |
| `pf-pawl-3a` | II-S6 | puzzle focus: pawl, the 20 s highlight comes on | **VESPER: Pawl marked. Strike it.** | Suit readout. Flat. | 3 |  |
| `pf-pawl-3b` | II-S6 | puzzle focus: pawl, the 20 s highlight comes on | **ELIAS: The pawl. Full swing, Elias. Break it.** | Through the teeth. | 4.2 |  |
| `pf-lever-1a` | II-S6 | puzzle focus: lever, first sight | **ELIAS: A lever on the landing. The cage goes down on it.** | Fast, hopeful. | 5.7 |  |
| `pf-lever-1b` | II-S6 | puzzle focus: lever, first sight | **VESPER: Cage lever. Haul once.** | Suit readout. Flat. | 3 |  |
| `pf-lever-2a` | II-S6 | puzzle focus: lever, 40 s later, still pending | **ELIAS: Haul the lever. Ride the cage down. Go.** | Urgent, low. | 4.6 |  |
| `pf-lever-3a` | II-S6 | puzzle focus: lever, the 20 s highlight comes on | **VESPER: Lever marked. Haul it.** | Suit readout. Flat. | 3 |  |
| `pf-lever-3b` | II-S6 | puzzle focus: lever, the 20 s highlight comes on | **ELIAS: The lever. Now, Elias. Haul it.** | Hard, to himself. | 3.8 |  |

#### Specified, not in the game yet (DARK_STORY_BIBLE.md §4.3: 11 lines; record them in the same session)

| Id | Sect. | Trigger | Line (subtitle) | Direction | Max s | Pickup |
|---|---|---|---|---|---|---|
| `s1-tally` | S1 | 2 s looking at board bd-s1-tally | **MAREN: Forty tally marks. The last one's still sharp.** | Reading the wall, counting; the last clause quieter. | 4.6 |  |
| `s1-tally-2` | S1 | chain: after s1-tally | **ODESSA: Probes, Maren. Keep moving, Elias.** | Smooth redirect, a fraction too quick (like "The probes, Tomasz"). | 3.4 |  |
| `s1-wake` | S1 | looking at board bd-s1-wake | **MAREN: 'If you don't remember the climb down...' You remember it, don't you, Elias?** | Reads the quote flat, then asks gently. Leave room: Wren never answers. (14 words: over the 11-word subtitle rule; the writer must trim it before it goes in.) | 6 |  |
| `s2-ledger` | S2 | looking at board bd-s2-ledger | **TICK: Four thousand one hundred and eleven paid. Paid with what?** | Reading numbers, then a real question into static. Nobody answers. | 5.3 |  |
| `s3-measure` | S3 | looking at board bd-s3-measure | **TICK: Fourteen hands and a knock. Dessa, is that his height?** | Half a joke that stops being one on "his height". | 5.3 |  |
| `s3-measure-2` | S3 | chain: after s3-measure | **ODESSA: Focus, Tomasz.**<br>*say:* Focus, Tomash. | Two words, cool, closing the subject. | 3 |  |
| `s3-cage` | S3 | looking at board bd-s3-cage | **MAREN: Up forty-one, down forty-two. Someone stayed down.** | Reads the tally like a ledger; the last sentence slower. | 5 |  |
| `s6-third` | S6 | looking at board bd-s6-third | **TICK: No way up on the scans either. What's the extraction plan?** | Trying to sound procedural; the question is scared. | 5.7 |  |
| `s6-third-2` | S6 | chain: after s6-third | **ODESSA: Restore. Same as always.** | THE SLIP (like "louder than last time"): matter-of-fact, unnoticed by her. | 3 |  |
| `ch-fit` | S8 | the goal box, before the slam (2.8 s): a dead zone that shows five bars for this one line | **VESPER: Fit: ninety-nine point eight.** | Suit readout, perfectly clean. A measurement. | 3.4 |  |
| `ch-last` | S8 | chain: after ch-fit; off mic, clean; must play before 'game:victory' cuts the radio | **ODESSA: He fits now.** *(offmic)* | THE LAST LINE OF CHAPTER I. Off mic, close, quiet, satisfied; not to Elias. No radio distance; impossibly clean in a dead zone. | 3 |  |

<!-- LINES:END -->
