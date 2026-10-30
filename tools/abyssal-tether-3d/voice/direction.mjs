// ABYSSAL TETHER 3D: the voice direction table (hand-authored; docs/abyssal-tether-3d/plans/VO_SCRIPT.md).
// export-lines.mjs merges this with the live script (public/abyssal-tether-3d/src/sim/comms3d.js COMMS_SCRIPT) into
// voice/lines.csv and the per-line table of VO_SCRIPT.md. The TEXT of a live line always comes from comms3d.js (the subtitle);
// this file only adds how it is said:
//   dir    direction for the actor (emotion, distance from the mic, what is happening); the AI placeholder cannot act on it
//   say    the spoken form when it differs from the subtitle (numbers, a respelt name). One space-separated token per subtitle
//          word, in order; an underscore joins the words of one token ("seventeen_ninety-one" speaks "1791"), so the word
//          timings stay aligned with the subtitle's words (the stuck-word glitch repeats a subtitle word)
//   pace   AI placeholder only: a speed multiplier on the speaker's base pace (1 = the speaker's own)
//   pitch  AI placeholder only: semitones of pitch drift (small: +-0.5)
// SPEC_LINES: radio lines the story bible specifies (DARK_STORY_BIBLE.md §4.3) that are NOT in the game yet (they need new
// triggers: board gazes by board id, the goal box, a forced five-bar dead zone). They are in the actor package so one session
// records everything; once comms3d.js adds an id, the line is live and build_voices.py ships it with no other change.

/** Casting notes per speaker (VO_SCRIPT.md). */
export const CAST = Object.freeze({
  ODESSA: {
    who: 'Odessa Vance, programme director (gold, diamond)',
    age: '45-60',
    accent: 'neutral mid-Atlantic or soft Received Pronunciation; educated, unplaceable',
    register: 'warm mid alto; controlled, unhurried, the calmest voice on the channel; calls him "Elias"',
    not: 'never shrill, never panicked, never villain-coded or knowingly sinister; the slips must sound like ordinary speech, not hints',
    ai: 'Kokoro af_heart (American English, female), base pace 0.95',
  },
  TICK: {
    who: 'Tomasz "Tick" Ilic, uplink tech (cyan, circle)',
    age: '22-32',
    accent: 'any light regional accent (Central-European roots welcome, not a caricature); casual',
    register: 'younger tenor/baritone; quick, jokey, nervous underneath; calls him "Wren"',
    not: 'never a cartoon nerd, never mugging the jokes; the fear is under the jokes, not instead of them',
    ai: 'Kokoro am_puck (American English, male), base pace 1.1',
  },
  MAREN: {
    who: 'Dr. Maren Soll, historian of the Lanternwrights (white, triangle)',
    age: '55-70',
    accent: 'British or Northern-European English; precise consonants',
    register: 'dry, exact, low-key; academic understatement; real curiosity under the dryness',
    not: 'never theatrical, never "spooky narrator", never warm in the way Odessa is',
    ai: 'Kokoro bf_emma (British English, female), base pace 0.92',
  },
  VESPER: {
    who: 'Vesper, the suit AI (grey, square); in the suit, not on the radio',
    age: 'n/a (any adult voice)',
    accent: 'neutral, unplaceable',
    register: 'clinical, even, five words or fewer; equal stress; no breath, no emotion',
    not: 'never robotic-funny, never menacing, never glitches (the suit is the one clean voice); no processing on the take',
    ai: 'Kokoro bm_george (British English, male), base pace 1.0',
  },
  UPLINK: {
    who: 'the open channel (no speaker)',
    age: 'n/a',
    accent: 'n/a',
    register: 'not a voice: the game synthesises the S4 echo (your breathing played back late)',
    not: 'no actor; nothing to record',
    ai: 'none (radio3d.js _breaths)',
  },
});

/** Per-line direction (keyed by the comms3d.js id). */
export const DIRECTION = Object.freeze({
  // S1 THE THRESHOLD
  's1-open-1': { dir: 'In-suit readout as he wakes. Clinical, even, equal stress. He takes it for a lowering check; so does the line.', say: 'Restore complete. Continuity ninety-nine_point_eight_percent.' },
  's1-open-2': { dir: 'Warm, proud, controlled: a director marking a moment for the record. A small smile. "History." lands a beat later.', pace: 0.95 },
  's1-open-3': { dir: 'Bright and quick, showing off his kit; a touch too cheerful. Close on a headset mic.' },
  's1-open-4': { dir: 'Dry, precise, quietly thrilled underneath: the historian meeting her subject. Crisp consonants.', say: "Nobody's stood there since seventeen_ninety-one. Read me every board you pass." },
  's1-open-5': { dir: 'Warm, unhurried. "Take your time" is reassurance that is slightly too practised.', pace: 0.95 },
  's1-bell-1': { dir: 'A casual warning. THE SLIP: "louder than last time" must come out natural; she does not notice it. Do not land it.' },
  's1-bell-2': { dir: 'Genuinely puzzled, half a laugh. Quick.', pitch: 0.3 },
  's1-bell-3': { dir: 'A smooth correction a fraction too fast: covering. Cool, not angry.', say: 'The probes, Tomash. Focus.', pace: 1.05 },
  's1-stall': { dir: 'A patient hint; he has been watching you hang there. Coaching, friendly.' },
  // S2 THE LONG SWING
  's2-board': { dir: 'Reads the board aloud flat, as a quotation; then a bone-dry aside.', say: "'It does not send us back.' Cheerful people, the Lantern_wrights." },
  's2-haul': { dir: 'Precise, unsettled underneath. A beat before "Recently." A brisk instruction to finish.', say: "That chain's been oiled. Recently. Write that down, Tomash." },
  's2-stall': { dir: 'A practical hint, plain.' },
  // S3 BROKEN GALLERY
  's3-enter': { dir: 'Quiet deduction. The second sentence lower and slower.', pace: 0.95 },
  's3-winch': { dir: 'Awed, with a small nervous laugh in it.' },
  's3-stall': { dir: 'A practical hint, plain.' },
  // S4 THE LISTENING VAULT
  's4-enter': { dir: 'A calm status update. "Signal\'s thinning" neutral, deliberately unworried.' },
  's4-sight': { dir: 'Startled, fast, the fear rising; trying to sound casual and failing.', pace: 1.08, pitch: 0.4 },
  's4-knock': { dir: 'Low and careful, close to a whisper, as if the thing could hear the radio.', pace: 0.94, pitch: -0.2 },
  's4-echo': { dir: 'NO ACTOR. The channel plays the player\'s breathing back two seconds late; the game synthesises it.' },
  's4-stall': { dir: 'A practical hint; patient.' },
  // S5 THE GULLET STAIR
  's5-enter': { dir: 'Urgent but controlled: the director voice. Clipped. Never shouted.', pace: 1.04 },
  's5-frayed': { dir: 'THE LINE NOBODY SENT. Play it as ordinary, helpful Tick: casual, kind. It must sound exactly like him; the horror comes 40 s later.' },
  's5-mute': { dir: 'Breezy and oblivious, just back at the mic. Light. He has no idea.' },
  's5-key': { dir: 'Hushed and scared, close to the mic, almost under his breath.', pace: 0.96, pitch: 0.3 },
  's5-stall': { dir: 'A practical hint, plain.' },
  // S6 THE TWO DESCENTS
  's6-enter': { dir: 'Suit status. Clinical, even.' },
  's6-fork': { dir: 'Dry wit, but real care leaks through on "early".' },
  's6-skit': { dir: 'Suit alert. Three flat words, evenly spaced. No urgency in the voice; the words carry it.', pace: 0.95 },
  's6-stall': { dir: 'Dry, a little impatient.' },
  // S7 THE HOLLOW NAVE
  's7-enter': { dir: 'Quiet awe, almost to herself.', pace: 0.94 },
  's7-hang': { dir: 'Tense instruction, trying to steady him. (The game makes one word stick; record it clean.)' },
  's7-iris': { dir: 'An urgent command: the most force she uses all chapter. Still not shouted.', pace: 1.06 },
  's7-stall': { dir: 'A practical hint, quick.' },
  // S8 THE LAST THROAT
  's8-enter': { dir: 'Very calm, slower, emphatic: she needs him to believe it. "it\'s us" lands.', pace: 0.92, pitch: -0.2 },
  's8-two': { dir: 'Suit readout. Even; the number is just a number.' },
  's8-probes': { dir: 'Gallows humour; the voice nearly cracks under the joke.' },
  's8-warm': { dir: 'NOT QUITE ODESSA. Record it as Odessa, but too close, too intimate, too slow, smiling; no radio distance. The game pitches and doubles it at runtime: deliver it clean, no effect.', pace: 0.88, pitch: -0.3 },
  's8-lost': { dir: 'Suit readout. Two words, flat, final.' },
  's8-stall': { dir: 'Urgent, controlled.', pace: 1.04 },
  // anywhere
  'any-hurt': { dir: 'Wincing sympathy, joking to cover the worry.' },
  'any-low': { dir: 'Procedural and calm, reading a checklist while he is dying. Cold in its calm.' },
  'any-relay': { dir: 'An upbeat tech explanation.' },
  'any-gaze': { dir: 'Puzzled, light, a little uneasy.' },
  'back-1': { dir: 'The first restore: relief, careful, checking he is really there.', pace: 0.95 },
  'back-hot-1': { dir: 'OFF MIC: turned away, whispering to Odessa, not meant for Elias. Record about 1 m off-axis, quiet but intelligible.', pace: 0.95, pitch: 0.2 },
  'back-hot-2': { dir: 'Sharp, quiet, fast. Ice.', say: 'Cut the hot mic, Tomash.', pace: 1.05 },
  'back-impact': { dir: 'A logged note, then a mild instruction; professional warmth.' },
  'back-skitter': { dir: 'Dry, a little shaken.' },
  'back-mason': { dir: 'A clinical observation. "Noted." flat.' },
  'back-dressed': { dir: 'Shaken, quiet; he does not want to say what he saw.', pace: 0.96 },
  'back-many': { dir: 'Reassurance; the second "You\'re fine" slightly too firm. She is reassuring herself.', pace: 0.94 },
});

/** DARK_STORY_BIBLE.md §4.3: specified, not in the game yet. `section`: 0-based (-1 = the goal box after S8). */
export const SPEC_LINES = Object.freeze([
  { id: 's1-tally', speaker: 'MAREN', section: 0, trigger: '2 s looking at board bd-s1-tally', text: "Forty tally marks. The last one's still sharp.", dir: 'Reading the wall, counting; the last clause quieter.' },
  { id: 's1-tally-2', speaker: 'ODESSA', section: 0, trigger: 'chain: after s1-tally', text: 'Probes, Maren. Keep moving, Elias.', dir: 'Smooth redirect, a fraction too quick (like "The probes, Tomasz").' },
  { id: 's1-wake', speaker: 'MAREN', section: 0, trigger: 'looking at board bd-s1-wake', text: "'If you don't remember the climb down...' You remember it, don't you, Elias?", dir: 'Reads the quote flat, then asks gently. Leave room: Wren never answers. (14 words: over the 11-word subtitle rule; the writer must trim it before it goes in.)' },
  { id: 's2-ledger', speaker: 'TICK', section: 1, trigger: 'looking at board bd-s2-ledger', text: 'Four thousand one hundred and eleven paid. Paid with what?', dir: 'Reading numbers, then a real question into static. Nobody answers.' },
  { id: 's3-measure', speaker: 'TICK', section: 2, trigger: 'looking at board bd-s3-measure', text: 'Fourteen hands and a knock. Dessa, is that his height?', dir: 'Half a joke that stops being one on "his height".' },
  { id: 's3-measure-2', speaker: 'ODESSA', section: 2, trigger: 'chain: after s3-measure', text: 'Focus, Tomasz.', dir: 'Two words, cool, closing the subject.', say: 'Focus, Tomash.' },
  { id: 's3-cage', speaker: 'MAREN', section: 2, trigger: 'looking at board bd-s3-cage', text: 'Up forty-one, down forty-two. Someone stayed down.', dir: 'Reads the tally like a ledger; the last sentence slower.' },
  { id: 's6-third', speaker: 'TICK', section: 5, trigger: 'looking at board bd-s6-third', text: "No way up on the scans either. What's the extraction plan?", dir: 'Trying to sound procedural; the question is scared.' },
  { id: 's6-third-2', speaker: 'ODESSA', section: 5, trigger: 'chain: after s6-third', text: 'Restore. Same as always.', dir: 'THE SLIP (like "louder than last time"): matter-of-fact, unnoticed by her.' },
  { id: 'ch-fit', speaker: 'VESPER', section: 7, trigger: 'the goal box, before the slam (2.8 s): a dead zone that shows five bars for this one line', text: 'Fit: ninety-nine point eight.', dir: 'Suit readout, perfectly clean. A measurement.' },
  { id: 'ch-last', speaker: 'ODESSA', section: 7, trigger: "chain: after ch-fit; off mic, clean; must play before 'game:victory' cuts the radio", text: 'He fits now.', dir: 'THE LAST LINE OF CHAPTER I. Off mic, close, quiet, satisfied; not to Elias. No radio distance; impossibly clean in a dead zone.', kind: 'offmic' },
]);
