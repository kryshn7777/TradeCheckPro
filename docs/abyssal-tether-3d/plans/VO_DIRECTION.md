# ABYSSAL TETHER 3D — Voice direction for the AI placeholder (VO_DIRECTION)

**Status (2026-11-05).** Every voiced line (62 in Chapter I, 5 in Chapter II) ships as an AI placeholder that is now *performed*,
not read: `tools/abyssal-tether-3d/voice/performance.json` directs each line and `tools/abyssal-tether-3d/build_voices.py`
renders it with Kokoro-82M v1.0 at full precision. Human recordings still override any line with no code change
(`VO_SCRIPT.md` §4). **Nobody has listened to these clips**: everything below was decided from the story and checked by
measurement (§5), not by ear.

## 1. The engine

| | before | now |
|---|---|---|
| Model | Kokoro-82M v1.0, q8 ONNX (`model_quantized.onnx`, 92 MB, SHA-256 `fbae9257…a1478`) | Kokoro-82M v1.0, **fp32 ONNX** (`onnx/model.onnx`, 325,532,232 bytes, SHA-256 `8fbea51ea711f2af382e88c833d9e288c6dc82ce5e98421ea61c058ce21a34cb`) |
| Source | npm shards + kokoro-js voices (Hugging Face was unreachable then) | `huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX` at revision `1939ad2a8e416c0acfeecc08a694d14ef25f2231`, every file SHA-256-checked (`ENGINE`, `VOICE_SHA256` in build_voices.py) |
| Voices | one stock voice per speaker | a blend of 2-3 official style tensors per speaker (§2) |
| Rendering | one synthesis per line, one speed, a pitch drift | phrase by phrase: own speed / pitch / stress per phrase, measured silences, breaths, false starts, fx (§3) |
| Clips | Opus 24 kb/s, 535 KB for 62 clips | Opus **32 kb/s** (same 24 kHz mono Ogg, -23 LUFS, peak < -1 dBFS), 882 KB for 67 clips (budget 2.5 MB: unchanged) |

`python3 tools/abyssal-tether-3d/build_voices.py --fetch` downloads and verifies the model and the 11 voices once into
`tools/abyssal-tether-3d/voice/.cache/kokoro-fp32/` (git-ignored); then `build_voices.py` renders everything in one process
(about 6 minutes on a shared 4-core machine; onnxruntime at a fixed 2 threads, so a rebuild is byte-identical on one machine:
checked by rebuilding two clips and comparing hashes). Licence: Apache-2.0 (model and voices).

## 2. The cast: one blended voice per speaker

Kokoro voices are 510 x 256 style tensors; mixing them by weight gives an in-between voice. Each speaker is a blend chosen from
the casting notes (`VO_SCRIPT.md` §2, `voice/direction.mjs` CAST), so no character is a stock "assistant" voice.

| Speaker | Blend | Speed | Pitch | Why |
|---|---|---|---|---|
| ODESSA | af_heart 0.65 + af_nicole 0.25 + af_kore 0.10 | 0.94 | -0.3 st | af_heart (the best-rated Kokoro voice) keeps her warm and clear; af_nicole's breathy, close quality makes her intimate (the "too close" s8-warm depends on it); af_kore and -0.3 st add age (45-60) and control |
| TICK | am_puck 0.70 + am_fenrir 0.30 | 1.08 | 0 | am_puck is the youngest, quickest male voice (22-32, jokey); am_fenrir adds grit and energy so the nerves read under the jokes |
| MAREN | bf_emma 0.70 + bf_isabella 0.30 | 0.93 | -0.6 st | bf_emma's crisp British consonants (the historian); bf_isabella and -0.6 st darken and age her (55-70), apart from Odessa through a band-pass |
| VESPER | bm_george 0.70 + bm_daniel 0.30 | 1.00 | 0 | bm_george's even, measured delivery, flattened by bm_daniel; never a breath, no fx: the suit is the one clean voice |
| ELIAS | am_michael 0.70 + am_onyx 0.30 | 0.94 | -0.5 st | am_michael is the steadiest baritone; am_onyx and -0.5 st make him lower, tireder, warmer (40-55); always "close" (inside the suit, at the mouth) |

Measured (median F0 of each speaker's clips): Elias 122 Hz and Tick 119 Hz were nearly the same voice before; now Elias 114 Hz,
Tick 142 Hz, Vesper 150 Hz, Maren 182 Hz, Odessa 186 Hz. A blend check on the plain text (one synthesis per line, the
recogniser of §5): am_michael alone 61.9 % of words recovered, the Elias blend 64.8 %; am_puck alone 59.4 %, the Tick blend
59.4 %: the blends cost no intelligibility.

## 3. What the direction layer encodes (`voice/performance.json`)

Per line: the **moment** (where it falls in the story), the **emotion** and **register** (calm professional, strained, hushed,
muttering to himself, suit readout ...), a line **speed** (x the speaker's) and **pitch** (st), per-line **fx**, and the
**take**, item by item:

- **Phrases** are synthesised on their own and joined with **measured silences** (ms), so a held breath before a name, a beat
  before bad news ("That chain's been oiled. ⟨500⟩ Recently.") or the space after a trailing "…" is exact, not left to the
  model. Splits are at sentence ends and at deliberate beats only (a comma split makes Kokoro end the fragment like a sentence).
- Per phrase: **speed** and **pitch** (rubberband, formants preserved), **gain**, **trail** (the voice falls 8 dB over the last
  third: trailing off).
- **Stress**: `*word*` forces primary stress on the word in the espeak phonemes Kokoro reads (an unreduced "it's *us*") and lifts
  it 2 dB over its aligned span.
- **Non-verbal**, synthesised (shaped, band-passed noise scaled to the line's own speech level; no new asset files): breath in
  (`{in}`, `soft`, `quick`, `sharp` = a gasp), exhale / sigh (`{out}`), a half-laugh through the nose (`{laugh}`: two or three
  air pulses). Never on Vesper.
- **False starts** (`{"cut": "Hook it", "keep": 0.5}`): the words are synthesised and cut off mid-word, then the phrase
  restarts: Elias's self-talk hesitates (s2, s5, s7).
- **fx**: `close` (proximity: +2 dB at 160 Hz, softer top), `breathy` (aspiration noise that follows the voice's own envelope: a
  mutter), `hushed` (softer top, a little air: the nearest Kokoro gets to a half-whisper), `offmic` (low-passed, two early
  reflections: Tick turned away on the hot mic).
- **Fit**: a take longer than its Max s (the subtitle's reading time + 0.5 s) gives its pauses first (to 80 %, 65 %), then its
  pace (to 1.16x). In this build 12 lines were fitted, none harder than 1.08x pace / 65 % pauses (s1-open-2w, s8-two); the rest
  at most 1.04x / 80 %.
- **Words**: the phrases must say exactly the subtitle's words (or the `say` column's) in order (the build refuses otherwise);
  the forced alignment runs phrase by phrase and gives the game one timing per subtitle word (the stuck-word glitch). All 67
  clips are aligned (none fell back to the proportional split).

The registers, in short: **radio under stress** (s4-sight, s5-enter, s7-iris, s8-stall, c2-bell) is quicker, clipped, short
pauses (150-220 ms), a sharp or quick breath first; **calm lines** (s1-open-5, s8-enter, back-mason) are slower with long beats
(450-520 ms) before the line that matters; **Elias's self-talk** (sN-self) is lower (-0.7 st overall), breathy, with breaths,
false starts, "…" trailing and a rising "somewhere." when he finds the answer; S8 is panted (a quick breath before each
fragment). The opening answers (s1-open-Nw) are dry and close, not muttered. The Chapter II lines run from relief (c2-open)
through panic (c2-bell) to cold precision (c2-rule) and a hushed chill (c2-orderly).

## 4. Chapter II

The five radio lines of `src/data/chapter2-text.js` (`radio`: c2-open, c2-bell, c2-rule, c2-bars, c2-orderly) are now voiced.
`voice/export-lines.mjs` reads them next to comms3d.js (status `ch2` in lines.csv, section `II-S<n>` = the chapter's own
section), and the clips go to `assets/audio/voice/<speaker>/<id>.ogg` with `s` = the beat's index in the chapter. **They play in
the game with no source change**: `chapter2Glue.js` gives the chapter's CommsDirector Chapter I's voice hook (`cm.voice =
cm1.voice`), which asks the radio's VoiceBank by line id (`audio/radio3d.js voiceFor(id)` -> `manifest.lines[id]`), and section
entries prefetch by index (`audio3d.js _onSection`). Like every clip, a line asked for before its clip is decoded speaks with the
babble that time and with its clip afterwards. The voice test now accepts these ids as script lines (and checks their text
hash).

## 5. Measured, not heard

Nothing here was listened to. Measured on the shipped clips (`before` = the q8 build, 62 clips):

| | before | now |
|---|---|---|
| Loudness / peak | -23 LUFS, < -1 dBFS | -22.7 to -23.5 LUFS, peaks -2.2 to -8.8 dBFS |
| Silences ≥ 120 ms inside a line (Chapter I) | 0.76 per line, mean 265 ms | 1.60 per line, mean 322 ms |
| Spoken length of Chapter I's 62 lines | 171.6 s | 214.9 s (every clip within its Max s) |
| Speech rate (words per second of speech) | Tick 4.5, Odessa 3.4, Elias 3.4, Maren 3.6 | Tick 4.4, Odessa 3.0, Elias 2.6, Maren 2.9 |
| PocketSphinx word recall (a weak generic recogniser, news LM) | 330 / 527 (62.6 %) | 318 / 527 on the same lines (60.3 %): Odessa 82 → 85, Maren 56 → 61, Vesper 15 → 15, Tick 108 → 98, Elias 69 → 59 |

Elias's drop is the intended mutter (lower, breathier, hesitant, never announcer-clear); the subtitle carries the words. Tick's
drop is spread across lines (the recogniser's language model guesses differently on the split phrases), and the plain-text blend
check (§2) shows it is not the blend. A recogniser is not a listener: **listen to every clip through the game's radio before a
release** (`build_voices.py --demo out.ogg` renders an offline radio approximation), especially the synthesised breaths and
laughs, the false starts and the off-mic line.

## 6. Every line

Speed = the speaker's base x the line's (before any fit). Pauses written = the silences of the take (ms, before any fit);
pauses measured = silences ≥ 120 ms found in the shipped clip (they include the model's own pauses at commas and the gaps around
breaths). ⟨n⟩ = a pause; [words–] = a false start.

| Id | Speaker | Moment | Emotion / register | Speed | Pauses written (ms) | The take | Duration before → after (s) | Max s | Pauses measured (ms) |
|---|---|---|---|---|---|---|---|---|---|
| `s1-open-1` | VESPER | S1, waking after the restore he takes for a lowering | clinical · suit readout | 1.04 | 360 | Restore complete. ⟨360⟩ Continuity, ninety-nine point eight percent. | 4.228 → 4.446 | 4.6 | 360, 170 |
| `s1-open-2` | ODESSA | S1, first words of the expedition | warm pride · calm professional · -0.3 st | 0.92 | 520 | First descent, Elias. ⟨520⟩ History. (×0.88, -0.3 st) | 2.189 → 2.889 | 3 | 460 |
| `s1-open-2w` | ELIAS | S1, his answer: 'First' catches on something | unease put away · talking to himself, then professional · fx close · -0.5 st | 0.94 | 330, 230 | First. (×0.92, -0.4 st) ⟨330⟩ Right. ⟨230⟩ Copy, Odessa. | 2.179 → 2.948 | 3 | 250, 210 |
| `s1-open-3` | TICK | S1, Tick showing off the uplink | bright, a touch too cheerful · casual tech | 1.08 | 220 | {in:quick} Uplink's clean, five bars. ⟨220⟩ I've got your *eyes* and your *heart*. | 2.916 → 3.232 | 5.7 | 260 |
| `s1-open-3w` | ELIAS | S1, his answer to Tick | dry, half joking · practical · fx close · -0.5 st | 0.94 | 300 | Five bars. ⟨300⟩ Keep them *coming*, Tick. | 2.322 → 2.754 | 3.8 | 360 |
| `s1-open-4` | MAREN | S1, the historian meets her subject | quietly thrilled · dry academic · -0.6 st | 0.91 | 380 | Nobody's stood there since seventeen ninety-one. ⟨380⟩ Read me *every* board you pass. | 4.463 → 4.822 | 6 | 420 |
| `s1-open-4w` | ELIAS | S1, his answer to Maren | patient, faint smile · professional · fx close · -0.5 st | 0.94 | 300 | Every board, Doctor Soll. ⟨300⟩ You'll hear *all* of it. | 2.869 → 3.305 | 5 | 350 |
| `s1-open-5` | ODESSA | S1, the mission and a practised reassurance | warm, unhurried · calm professional · -0.3 st | 0.94 | 320, 450 | The Ember's dimming, Elias. ⟨320⟩ Bring us a kindling. ⟨450⟩ Take your time. (×0.92) | 3.761 → 4.502 | 5.7 | 340, 510 |
| `s1-open-5w` | ELIAS | S1, the decision to go down | resolve, quiet · half to himself · fx close · -0.5 st | 0.94 | 280, 330 | Kindling. (×0.95) ⟨280⟩ Rope by rope. ⟨330⟩ Going down. (×0.93, -0.3 st) | 2.643 → 3.756 | 3.8 | 340, 400 |
| `s1-bell-1` | ODESSA | S1, THE SLIP: 'louder than last time' | casual, unaware · calm professional · -0.3 st | 0.94 | 240 | Mind the *bell*, Elias. ⟨240⟩ It's louder than last time. (×1.04) | 2.962 → 3.063 | 5 | 290 |
| `s1-bell-2` | TICK | S1, Tick catches the slip | puzzled, half a laugh · casual | 1.12 | 60 | {laugh:soft} ⟨60⟩ Last time? (+0.4 st) | 0.712 → 1.092 | 3 | 210 |
| `s1-bell-3` | ODESSA | S1, Odessa covers the slip | cool, covering · calm professional, a fraction too fast · -0.3 st | 1.00 | 150 | The probes, Tomash. ⟨150⟩ Focus. (-0.3 st) | 1.88 → 2.099 | 3 | 200 |
| `s1-self` | ELIAS | S1, a minute stuck at the grating | thinking aloud, uneasy · muttering to himself · fx close, breathy · -0.7 st | 0.94 | 340, 380, 150 | Think, Elias. ⟨340⟩ The grating won't open itself. ⟨380⟩ A bell, (×0.96) ⟨150⟩ somewhere. (+0.5 st) | 4.224 → 5.21 | 5.3 | 340, 420, 180 |
| `s1-stall` | TICK | S1 stall: coaching the first swing | friendly · coaching | 1.08 | 300 | Fire at the glowing ring and *hold*. ⟨300⟩ Let the rope work. | 2.616 → 2.699 | 5.7 | 350 |
| `s2-board` | MAREN | S2, reading a Lanternwright board | flat quotation, then bone-dry · dry academic · -0.6 st | 0.93 | 540 | {in:soft} It does not send us back. (×0.92, -0.2 st) ⟨540⟩ Cheerful people, the Lantern wrights. (×1.02) | 3.493 → 4.676 | 5.7 | 600 |
| `s2-haul` | MAREN | S2, the chain is freshly oiled | precise, unsettled · dry academic · -0.6 st | 0.93 | 440, 360 | That chain's been oiled. ⟨440⟩ Recently. (×0.88, -0.3 st) ⟨360⟩ Write that down, Tomash. (×1.06) | 3.534 → 4.933 | 5 | 510, 440 |
| `s2-self` | ELIAS | S2, a minute stuck at the counterweight | impatient with himself · muttering to himself · fx close, breathy · -0.7 st | 0.94 | 420, 110, 360 | {out} A counterweight. ⟨420⟩ [Hook it–] ⟨110⟩ Hook it and haul, Elias. ⟨360⟩ Don't just *stand* here. (×1.04) | 3.821 → 5.621 | 5.7 | 280, 540, 120, 340 |
| `s2-stall` | TICK | S2 stall | plain · practical hint | 1.08 | 260 | Hook the counterweight and *haul*. ⟨260⟩ That's your way down. | 2.088 → 2.386 | 5 | 330 |
| `s3-enter` | MAREN | S3, a door closed from the inside | quiet deduction, dread · dry academic, lower · -0.6 st | 0.93 | 580 | Closed from *this* side. ⟨580⟩ So someone was still inside. (×0.88, -0.4 st) | 3.342 → 4.186 | 5 | 650 |
| `s3-winch` | TICK | S3, a 500-year-old gear still turns | awed, nervous · casual | 1.08 | 220, 120, 200 | Gear's turning. ⟨220⟩ {laugh:soft} ⟨120⟩ Five hundred years, ⟨200⟩ and it *still* turns. | 2.535 → 3.412 | 5 | 270, 290, 250 |
| `s3-self` | ELIAS | S3, a minute stuck at the gear | working it out, then decided · muttering to himself · fx close, breathy · -0.7 st | 0.90 | 200, 440 | The gear… (×0.92) ⟨200⟩ still turns. ⟨440⟩ {in:soft} Hook its ring, let it *carry* me. | 3.514 → 4.846 | 5.7 | 270, 550, 130 |
| `s3-stall` | TICK | S3 stall | plain · practical hint | 1.08 | 220 | Ride the gear. ⟨220⟩ Hook its ring and hold on. | 1.794 → 2.09 | 5 | 290 |
| `s4-enter` | ODESSA | S4, a hundred metres down | deliberately unworried · calm professional · -0.3 st | 0.94 | 250, 260 | A hundred metres, Elias. ⟨250⟩ Vitals good. ⟨260⟩ Signal's thinning. | 3.692 → 4.185 | 4.6 | 280, 320 |
| `s4-sight` | TICK | S4, something vast moves in the dark | startled, fear rising · strained, trying for casual · +0.2 st | 1.12 | 150 | {in:sharp} Did you see that? (×1.06, +0.3 st) ⟨150⟩ Something big, out in the dark. (+0.1 st) | 2.028 → 2.482 | 5.3 | 270 |
| `s4-knock` | MAREN | S4, the rule of the knock | careful, near whisper · hushed · fx hushed · -0.8 st | 0.93 | 400, 320 | If something knocks, don't knock *back*. (×0.96) ⟨400⟩ Their rule. ⟨320⟩ I'd keep it. (-0.2 st) | 3.376 → 4.828 | 5.7 | 460, 390 |
| `s4-self` | ELIAS | S4, the vault is listening | hushed fear, careful · whispered to himself · fx close, breathy · -0.8 st | 0.91 | 360, 180, 400 | Cold lamps. (×0.95) ⟨360⟩ My lantern… ⟨180⟩ one at a time. ⟨400⟩ Slowly. (×0.9, -0.3 st, trails off) | 3.472 → 4.927 | 5 | 340, 170, 370 |
| `s4-stall` | ODESSA | S4 stall | patient · calm professional · -0.3 st | 0.94 | 300 | The cold lamps, Elias. ⟨300⟩ Hold your lantern to *each* one. | 3.262 → 3.453 | 5.3 | 340 |
| `s5-enter` | ODESSA | S5, contact above him | urgent, controlled · clipped professional · -0.3 st | 0.98 | 190, 210 | {in:quick} Contact above you, Elias. ⟨190⟩ Keep moving. ⟨210⟩ Don't look for it. (-0.2 st) | 3.324 → 4.121 | 5.3 | 220, 260 |
| `s5-frayed` | TICK | S5, THE LINE NOBODY SENT (must sound exactly like Tick) | ordinary, kind · casual | 1.08 | 230, 250 | Careful in the middle. ⟨230⟩ Those rings are frayed. ⟨250⟩ They hold *once*. | 2.734 → 3.154 | 5.7 | 300, 320 |
| `s5-mute` | TICK | S5, Tick back at the mic, 40 s later | breezy, oblivious · casual | 1.08 | 250 | Sorry, been on mute for two minutes. ⟨250⟩ Did I miss anything? (+0.3 st) | 2.665 → 2.777 | 5.7 | 290 |
| `s5-key` | TICK | S5, the keystone was loud | scared · hushed, close · fx hushed · +0.2 st | 1.06 | 400 | {in:sharp} That was *loud*. ⟨400⟩ Everything down there heard that. (trails off) | 2.042 → 2.688 | 4.6 | 490 |
| `s5-self` | ELIAS | S5, the keystone: a choice not yet made | tight, under his breath · muttering to himself · fx close, breathy · -0.7 st | 0.94 | 300, 110, 400, 240 | The keystone. ⟨300⟩ [Hide and–] ⟨110⟩ Hide and let it knock. ⟨400⟩ Or… (×0.92) ⟨240⟩ haul the ring. | 3.274 → 5.613 | 5.7 | 290, 120, 390, 310 |
| `s5-stall` | TICK | S5 stall | plain · practical hint | 1.08 | 200 | The keystone: ⟨200⟩ hide and let it knock, or haul its ring. | 2.455 → 2.701 | 5.7 | 250 |
| `s6-enter` | VESPER | S6, the signal degrades | clinical · suit readout | 1.08 | 200 | Signal degraded. ⟨200⟩ Latency rising. | 2.824 → 2.965 | 3 | 220 |
| `s6-fork` | MAREN | S6, the fork: the Throat is 'for the late' | dry wit, care leaking · dry academic · -0.6 st | 0.93 | 150, 400 | The Throat is… ⟨150⟩ for the late. (-0.2 st) ⟨400⟩ I'd like you *early*, Elias. (×0.94) | 3.065 → 4.511 | 5.7 | 180, 470 |
| `s6-skit` | VESPER | S6, first skitterling contact | clinical · suit alert, evenly spaced | 1.00 | 260, 260 | Contact. ⟨260⟩ Small. ⟨260⟩ Closing. | 2.116 → 2.883 | 3 | 240, 280 |
| `s6-self` | ELIAS | S6, the fork: stalling | dry, tired, almost amused · muttering to himself · fx close, breathy · -0.7 st | 0.94 | 360, 260, 140 | Two ways down. ⟨360⟩ Pick one, Elias. ⟨260⟩ {laugh:soft} ⟨140⟩ Standing here picks *neither*. (×1.02) | 3.892 → 5.253 | 5.3 | 420, 290, 310 |
| `s6-stall` | MAREN | S6 stall | dry, a little impatient · dry academic · -0.6 st | 0.93 | 280 | Either way down will do. ⟨280⟩ Standing still *won't*. (×1.04) | 2.847 → 3.366 | 4.6 | 330 |
| `s7-enter` | MAREN | S7, the Hollow Nave | quiet awe · almost to herself · fx hushed · -0.6 st | 0.93 | 540 | {in:soft} Nothing to stand on. (×0.9) ⟨540⟩ A church you can only hang in. (×0.88, -0.2 st) | 3.169 → 4.615 | 5.7 | 580 |
| `s7-hang` | TICK | S7, the floor unbolts (the game makes 'hold' stick) | tense, steadying · strained | 1.08 | 300 | {in} The floor unbolts while you hold. ⟨300⟩ So *hold*, Wren. (×0.96) | 2.453 → 3.053 | 5 | 120, 370 |
| `s7-iris` | ODESSA | S7, the iris opens: go now | urgent command · the most force she uses, not shouted · -0.3 st | 1.02 | 150 | The iris is open. ⟨150⟩ Go *now*, Elias. (×1.02) | 2.41 → 2.433 | 4.2 | 210 |
| `s7-self` | ELIAS | S7, hanging over nothing | steadying, a mantra · muttering to himself · fx close, breathy · -0.7 st | 0.92 | 400, 130 | {in} One ring, then the next. ⟨400⟩ [Never–] ⟨130⟩ Never let go *first*. (×0.96) | 3.065 → 4.457 | 5 | 120, 450, 140 |
| `s7-stall` | TICK | S7 stall | quick · practical hint | 1.08 | 170 | Chain the rings. ⟨170⟩ Fire the next *before* you let go. | 2.265 → 2.48 | 5.3 | 240 |
| `s8-enter` | ODESSA | S8, the signal is going: 'it's us' | very calm, emphatic · slow, she needs him to believe it · -0.5 st | 0.88 | 460, 280 | Signal's going, Elias. ⟨460⟩ Whatever you hear after this, (×0.96) ⟨280⟩ it's *us*. (×0.86) | 3.91 → 4.855 | 5.3 | 520, 330 |
| `s8-two` | VESPER | S8, two heartbeats on the suit | clinical · suit readout | 1.05 | 110, 200 | Heart rates: ⟨110⟩ two. ⟨200⟩ Recalibrating. | 2.46 → 2.952 | 3 | 140, 170 |
| `s8-probes` | TICK | S8, the probes all died here | gallows humour, nearly cracking · strained casual | 1.08 | 280, 100 | Probes all died at five fifty-six. ⟨280⟩ {laugh:soft} ⟨100⟩ No pressure, Wren. (×0.96, +0.3 st) | 2.968 → 3.407 | 5.3 | 300, 260 |
| `s8-warm` | ODESSA | S8, NOT QUITE ODESSA (the game pitches and doubles it) | intimate, smiling, too slow · too close to the mic · fx close · -0.6 st | 0.85 | 140, 380 | {in:soft} Keep coming down, (×0.96) ⟨140⟩ Elias. (×0.9) ⟨380⟩ It's *warm* down here. (×0.94) | 3.201 → 4.194 | 4.6 | 170, 340 |
| `s8-lost` | VESPER | S8, the uplink dies | clinical, final · suit readout | 0.96 | — | Uplink lost. | 1.185 → 1.27 | 3 | — |
| `s8-self` | ELIAS | S8, the last throat, out of breath | urgent, controlled, breathless · panting to himself · fx close, breathy · -0.7 st | 0.98 | 150, 160 | {in:quick} The grate. ⟨150⟩ {in:quick} Don't look back. ⟨160⟩ {in:quick} Run for the *light*. (×1.04) | 2.548 → 3.982 | 5 | 230, 240 |
| `s8-stall` | ODESSA | S8 stall | urgent, controlled · clipped professional · -0.3 st | 0.98 | 190 | The grate, Elias. ⟨190⟩ Run for the *light*. | 2.075 → 2.345 | 4.2 | 250 |
| `any-hurt` | TICK | anywhere, a minor injury | wincing sympathy, joking · casual | 1.08 | 210, 300 | Vesper says that was minor. ⟨210⟩ I say ow. (+0.2 st) ⟨300⟩ Easy, Wren. (×0.92, -0.2 st) | 2.603 → 3.244 | 5.3 | 260, 350 |
| `any-low` | ODESSA | anywhere, he is dying | cold calm · procedural checklist · -0.3 st | 0.94 | 360 | Vitals red. ⟨360⟩ Staging a restore at the last relay. (×0.98) | 3.163 → 3.618 | 5 | 420 |
| `any-relay` | TICK | anywhere, a lamp becomes a relay | upbeat · casual tech | 1.08 | 210 | That lamp's a relay now. ⟨210⟩ Anything happens, we restore you there. | 3.024 → 3.004 | 5.7 | 260 |
| `any-gaze` | TICK | anywhere, staring at blood writing | puzzled, uneasy · casual, unsure | 1.08 | 330 | What are you looking at? ⟨330⟩ Your feed's just stone. (×0.96, trails off) | 2.001 → 2.423 | 5 | 380 |
| `back-1` | TICK | the first restore | relief, careful · strained, then relieved | 1.06 | 440, 260, 60 | {in} Wren? (×0.92, +0.3 st) ⟨440⟩ Wren, sync is holding. ⟨260⟩ {out:soft} ⟨60⟩ Welcome back. (×0.94) | 1.86 → 4.058 | 4.2 | 520, 310, 290 |
| `back-hot-1` | TICK | restore: the hot mic, whispered to Odessa | frightened · off mic, whispering · fx offmic, hushed · +0.2 st | 1.08 | 250 | {in:soft} …did he see it? ⟨250⟩ The body? (×0.92) | 1.167 → 2.039 | 3.8 | 330 |
| `back-hot-2` | ODESSA | restore: Odessa cuts the hot mic | ice · sharp, quiet, fast · -0.3 st | 1.02 | — | Cut the *hot* mic, Tomash. (-0.2 st) | 1.5 → 1.621 | 3.4 | — |
| `back-impact` | ODESSA | restore after an impact | professional warmth · calm professional · -0.3 st | 0.94 | 360 | Restore logged. ⟨360⟩ Slower on the rope this time, Elias. | 3.198 → 3.554 | 5 | 420 |
| `back-skitter` | MAREN | restore after the skitterlings | dry, shaken · dry academic · -0.6 st | 0.93 | — | {out:soft} Whatever that was, the boards warned us about it. | 2.61 → 3.024 | 5 | 220 |
| `back-mason` | ODESSA | restore after the Mason | clinical · cold professional · -0.3 st | 0.94 | 500 | It came for you when you bled. ⟨500⟩ Noted. (×0.92, -0.4 st) | 2.25 → 2.874 | 4.6 | 560 |
| `back-dressed` | TICK | restore after the dressed corpse | shaken, quiet · hushed · fx hushed | 1.06 | 500 | Your feed went square for a second. ⟨500⟩ Then black. (×0.88, -0.3 st, trails off) | 2.221 → 2.766 | 5 | 570 |
| `back-many` | ODESSA | the fourth restore and on | reassuring herself · calm, slightly too firm · -0.3 st | 0.94 | 250, 280 | Fidelity holding. ⟨250⟩ You're fine, Elias. ⟨280⟩ You're *fine*. (×0.94, +1 dB) | 3.189 → 3.806 | 4.2 | 320, 320 |
| `c2-open` | ODESSA | Chapter II, the first warm place: five bars again | relieved wonder · calm, warmer · -0.3 st | 0.92 | 340, 400 | {in:soft} Five bars, Elias. ⟨340⟩ Down here. (×0.92) ⟨400⟩ The lamps are *carrying* us. | new → 4.808 | 5.3 | 180, 390, 470 |
| `c2-bell` | TICK | Chapter II, the first Usher answers the bell | panic breaking through · strained, clipped · +0.2 st | 1.14 | 200 | {in:sharp} Something answered the bell. ⟨200⟩ Wren, it answered the *bell*. (+0.4 st) | new → 2.498 | 5 | 250 |
| `c2-rule` | MAREN | Chapter II, Maren finds the rule | cold precision · dry academic, deliberate · -0.6 st | 0.93 | 280, 400 | Not your footsteps. ⟨280⟩ Not you. ⟨400⟩ The *bell*. (×0.88, -0.3 st) | new → 4.153 | 4.2 | 290, 400 |
| `c2-bars` | ODESSA | Chapter II, the Snuffing: the lamps go out | strained calm · calm professional, under pressure · -0.3 st | 0.96 | 280 | Bars are dropping, Elias. ⟨280⟩ Lamps are going out. (×0.96) | new → 3.259 | 4.6 | 320 |
| `c2-orderly` | MAREN | Chapter II, the Round begins: not the Mason | chilled realisation · hushed academic · fx hushed · -0.6 st | 0.93 | 500 | That isn't the Mason. ⟨500⟩ That's *orderly*. (×0.88, -0.3 st) | new → 3.196 | 3.8 | 560 |
