# CHAPTER II · LAMPHOLD: DIRECTION (the story, the thirteen beats, the boss, the hook, the build)

> Narrative director and lead level designer, 2026-11-04. Status: **proposal for owner sign-off**; planning only (no code, art or other doc touched).
> It direct-plans the owner's Level 2 ([CHAPTER_II_PLAN.md](CHAPTER_II_PLAN.md): Chapter II, 1,250 m, 13 beats, 60-70 minutes, ends on a hook, the villain is the Usher)
> on top of the canon ([CHAPTERS.md](../CHAPTERS.md) §0-§4, §6), the voice ([DARK_STORY_BIBLE.md](DARK_STORY_BIBLE.md)), the villain ([USHER.md](USHER.md)) and what the
> engine already has (`src/sim/movers3d.js`, `objectives3d.js`, `creature3d.js`, `dresser3d.js`, `holdfast3d.js`, `health3d.js`, `data/chapter2-data.js`).
> Contracts it cites: ENGINE_EXTENSIONS E10-E19, E25, E26, E28.
>
> **Legend.** `PROPOSAL` = not in any existing doc, the owner may accept or change it. `NEW-SIM` = new simulation code (Node-testable). `NEW-VIEW` = new render, audio or
> asset work. `DATA-ONLY` = level data on systems that exist today. Depths are the readout (600 -> 1,850 m); chapter-local y = -(depth - 600). Distances are metres.
> Dimensions are for the dressed pit (the bible's 110 m wide); the graybox shaft is 52 m and is widened in WP C2-1c.

---

## 0. Read this first

### 0.1 What is binding (and where it comes from)

| Constraint | Source | Honoured here |
|---|---|---|
| Level 2 is Chapter II, **1,250 m deep (600 -> 1,850 m)**, not the bible's 580 | owner, CHAPTER_II_PLAN header | §2 (13 beats, 1,250 m exactly) |
| 13 beats, depths and lengths fixed; 60-70 min first time on Normal | CHAPTER_II_PLAN §2 | §2 (60 min by the plan's own sum; deaths put the median near 65) |
| It must **end with a hook for the full version** | owner | §4 |
| The villain is **the Usher** (1.95 m headless man, ribbed 3.75 m throat, flared ring; clips Idle / Walk / Lunge / Listen) | owner, USHER.md | §1.3, §3 |
| One chapter, one rule: **LIVE ANCHORS**; pillars 1-6 | CHAPTERS §1, §6 | §3 (the boss is beaten only by live anchors) |
| No combat: nothing is ever fought with damage | task, pillar 1 | §3 (a traversal / puzzle-by-rope boss; no health bar) |

### 0.2 Contradictions found and how they are resolved (owner's constraints win)

1. **Depth.** Bible 600 -> 1,180 m vs owner 600 -> 1,850 m: the owner's number is used; Chapters III-V move down by 670 m (CHAPTER_II_PLAN §1).
2. **Numbering.** The bible's nine beats become 13. Mapping: bible II-1..II-4 = II-1..II-4; Dressing Yards II-5 -> **II-6**; Hung Quarter II-6 -> **II-8**; Winding Floor / Stopping II-7 -> **II-10**; **THE SNUFFING II-8 -> II-12**; Soot Throat II-9 -> **II-13**. New: II-5 Stone Yards, II-7 Counterweight Shafts, II-9 Tolling Gallery, II-11 Cinder Stairs. This document uses the plan's numbers.
3. **Who snuffs the town.** CHAPTERS §6.2 gives the Snuffing to the Mason; the owner's villain is the Usher. Resolved (PROPOSAL): **the Ushers snuff** (§1.3 explains why only they can); the Mason keeps its bible beats in II-5, II-6, II-8, II-10 and II-11 and is **sound only** in II-12. The bible's numbers for the snuff front and the Span are kept.
4. **"Seen, never fought."** CHAPTER_II_PLAN §3 proposed the Usher only as a sighting; this brief asks for a boss. Resolved: the Usher is the exam's antagonist; it is still **never fought** (no damage is dealt, ever).
5. **The Span.** Bible 140 m "across a 110 m pit"; the plan says 150 m "up from 100". Resolved: **150 m along a spiral truss that hugs the pit wall** (it fits a 110 m pit; arc length, not chord).
6. **Voice.** CHAPTERS §3.2 rule 5 / ART_AUDIO §5.3 say "no voice-over"; the shipped radio (COMMS.md) is allowed. Resolved: the radio stays (and is tied to the lamps, §1.8); **the Usher never speaks** (it knocks, breathes, hums).
7. **Text budget.** CHAPTERS §11 (about 860 words) was already passed by the +51 boards of DARK_STORY_BIBLE. Chapter II adds about 200 words (22 lines, §1.6). PROPOSAL: the budget becomes per chapter (about 250 words).
8. **Creatures.** Chapter II inherits the Mason (hurt-gated), the Dresser (whole-gated), the Holdfast (grip) from Chapter I. PROPOSAL: Holdfast in II-2, Dresser in II-6 (its home), **no skitterlings** (they are the Underspire's kin; the Usher is Lamphold's), the Usher from II-9.

### 0.3 The direction in ten lines

1. **Story.** Lamphold was not abandoned, it was put to bed. Every lamp is held up by the stone hand of the one it keeps; every night the Ushers put the town out so it can sleep, and every morning the Lamplighters light it again. The Morning never came.
2. **Cause.** The player started it: lifting the Mark Lamp freed the Mason; the Mason's knocking in the walls jammed the engine; the runaway engine ran the town's clock into Evening early.
3. **Truth.** "Everyone in Lamphold is still here, held by the lamp in their own hand. The Evening needs a Morning. You are the Lamplighter, and you are late."
4. **The Usher.** An office, not a species: the roll-callers. They gave their heads to the roll; the empty place where a face was is the only thing a Flame-lamp cannot burn against, so they can put the lamps out. They answer **bells**.
5. **The rule that beats it.** *The Usher answers bells. Where its cold light falls, it strikes. Put the bell where you are not.* Live anchors are the bells (brass rings, clapper chains, the Great Bell), the doors (the pawl) and the way down (the cage).
6. **The boss.** The **Head Usher** (the Doorman): the same silhouette at 1.8x on a pulpit, whose collar comes undone so that **the throat goes on** (16 -> 24 -> 32 m). Three phases: the Round (II-12 A), the Well (B), the Span and the Lift (C).
7. **The win.** You cannot kill it. You make it open the door for you (it strikes the pawl you toll), you cross while it recoils, and you ride the cage down while it snuffs the last lamp. The Evening ends; the Doorman sits.
8. **The loss.** The player leaves in the dark with the only light left in Lamphold, and every bed is creaking.
9. **The hook (II-13).** The Soot Throat lowers you over the Mere. Under the black water, ranks of Ushers, collars off, throats unbound. They turn to your lamp, rise to the surface and **bow**: an aisle of arching throats leading across the water. *III · THE MERE.* **Who is the seat at the end of the aisle for?**
10. **The ask.** Chapters III-V, one calm button, no countdown.

---

## 1. THE STORY

### 1.1 What Lamphold was (the team truth; never printed on a wall)

1. **The Lampholders** (CHAPTERS §2.2: "Live beside your dead; name them. They lit lamps below the Mark in defiance (*KNOCK, AND BE KNOWN.*)") settled the pit below the Mark. They refused the Keepers' law *BELOW THIS MARK NO LAMPS* and kindled 3,000 lamps from the Still Flame, because (rule 3) "one lamp holds one of them".
2. **The name is literal.** When a Lampholder's last waking came, they were not dressed into a block and built into a wall (that was the Keepers' and the Dressing Yards' rough trade, *DRESS THE OLD STONE WITH CARE. IT WAS SOMEONE.*); they were **set in a niche above their own bed with one arm raised, holding their own lamp**. A *lamp-holder*. The lamp holds the sleeper still; the sleeper holds the lamp up. Closed loop. That is why 3,000 lamps burn (rule 1: a lamp kindled from the Flame never burns down) and why "every lamp has its own small niche, and every niche is full" (DARK_STORY_BIBLE §2.4).
3. **The roll.** A named kept lies down (ending C: "name the dead, and they lie down"). Names wear off, so the Lampholders called the roll **every morning**: the tally plate at each bed is a name in notches (*EVERY LAMP A BED. EVERY BED A MORNING.*).
4. **The day.** Morning: the **Lamplighters** carry the master flame down from the Gallery and light the tiers; the **engine** (the Winding Floor) knocks every door at dawn; the **Ushers** walk the beds, knock each tally plate and say each name. Evening: the Ushers put the town to bed, tier by tier, snuffing the lamps so the lamp-holders may lower their arms for the night; the Lamplighters light them again before the stone remembers it can walk.
5. **Why only Ushers can snuff.** A lamp kindled from the Flame cannot be blown out (rule 4: the Flame's light holds everything still). The Lampholders found one thing it cannot burn against: **an empty place the exact shape of a face**. So they made the office: a man gives his head to the roll (*THE USHER GAVE HIS HEAD TO THE ROLL*); the throat that grows out of the collar is his speaking-tube, and the ring where the face was is the empty place. Put the ring over a lamp and the lamp goes out; the ring keeps the light, cold. (Rhymes with Chapter I: the Fitting is a place cut to fit a person; an Usher is a person with a place cut in him.)
6. **Why the Morning never came.** The Lamplighters sat down in the Assembly at the Bell Well to wait for the last Evening to end, forty of them, lanterns in their laps, and did not stand up. The lamps stayed lit for five hundred years because nobody put them out; the Ushers stood at their stations and waited for the engine's knock.
7. **Why now.** The engine is the town's clock. The Stopping (II-10) jams it; the runaway restart runs the day at 1.6x; Evening arrives early. The Ushers wake to the knock and begin the oldest rite in the town. It needs a Morning to finish. There is no Lamplighter. Then a pilgrim arrives with the brightest lamp in the world in her hand.

### 1.2 Why 3,000 lamps burn (the line the player can reach)

Because each one is held. The Waking Hall (II-4) shows it three ways: the lamp, the hand that holds it, the tally plate under it. The one lowered hand in the hall is MARGERY's (N2-4): the bed with no lamp. She put hers out. She is the first Unkindled in the game, and the seed of Chapter III.

### 1.3 The Ushers: where they come from and what they want (in canon terms)

| Question | Answer (PROPOSAL, all of it) |
|---|---|
| What is an Usher? | An **office**. A man in the town's formal dress (long dark coat, white collar, black tie) whose head was given to the roll. USHER.md's model is exactly this. |
| What is the white collar? | The **leash**. A collared Usher's throat stays short (3.75 m). When a collar comes undone the throat "goes on". The Head Usher's collar falls at the betrayal (§3.12); the Ushers of the Mere (§4) have none. |
| What is the ring? | The empty place. Its cold membrane is the light of every lamp it has put out, kept without warmth. It is the only light an Usher has, and it is also its **torch**: it lights the spot it will strike. |
| What does it hear? | **Bells.** It was built to answer the morning knock, the Evening bell, the pawl, the cage gong. It ignores footsteps, landings, yanks, breath and the Mason (which it cannot reach and cannot stop answering). |
| What does it want? | To **finish the roll**: to answer every toll, and when a toll is a person, to show them to their seat. Its second, darker reading: a ring is an empty place, and it has been waiting a long time for something to fill it. |
| How does it kill? | It strikes the place the bell rang, after a visible warning. A struck player is *seated*: the death line is **"ANSWERED. YOU WERE SHOWN TO YOUR SEAT."**; the remnant is a stone figure sitting, head bowed, hands in lap. No gore. |
| Relation to the Mason | The Mason is the roll's failures knocking to be named; the Ushers are the roll's keepers answering. They never reach each other (one lives in the walls, the other on the floors), which is the saddest fact in the game. The Mason follows the dark the Ushers leave: **the Snuffing is how it grows** (22 -> 24 segments for Chapter III). |
| Relation to the Dresser, Holdfast | The Dresser dressed the old into lamp-holders; the Holdfast is a lamp-holder reaching for a hand; the Usher tucks them in. One family of "what the town does with its dead". |
| Relation to Chapter III and the endings | The Unkindled slept under the Mere and **their** ushers stand over them (the hook). The Ushers want the last lamp out (ending A's instrument, the way the Mason is ending B's). The Mark Lamp is the last lamp. The player carries what both hunt. |

### 1.4 How Chapter I's ending causes Chapter II

| Step | Where | Consequence |
|---|---|---|
| The player lifts the **Mark Lamp** (CHAPTERS §5.4, beat 4) | end of Chapter I | "the coils go dark, wake, and pour away down the shaft": the Mason is loose |
| The Mason arrives in Lamphold | II-2 ("Far below, knocking inside the walls") | it knocks to be named; it is blind and hears every sleeper's tally |
| The Mason jams the engine | II-10, the Stopping | the morning knock stops; then restarts at 1.6x |
| The town's clock runs ahead | II-11 | "the first lamps are failing": the Ushers wake to the knock |
| The Evening | II-12 | every lamp tier by tier |
| The player is blamed twice | plaque *THE LAMPLIGHTER IS LATE.* | the guilt is mechanical: you carried the light that freed the thing that woke the Ushers |

The Mark Lamp "leans toward where the Mason went, which is always toward the Flame" (CHAPTERS §2.4): in Lamphold it leans **down**, at the breach in II-6, at the Head Usher's pulpit in II-12, and at the black water in II-13.
The Mason's canon ("made of everyone the light left behind") is shown by contrast: the Waking Hall is everyone the light **did not** leave. The Snuffing leaves them. Chapter IV's Gathering is where the Mason takes them in.

### 1.5 The chapter's one truth, and its proof images

**Truth (what 70 % of testers must be able to say):** *"Everyone in Lamphold is still here. The lamps keep them still, and someone has to put the lamps out every night."* (CHAPTERS §2.6 truth 2, rewritten for this chapter: they could not die, and they kept their dead as neighbours.)

| Proof | Where | Unmissable? |
|---|---|---|
| The Waking Hall: thousands of alcove beds, a stone hand above each holding its lamp, a tally plate under each | II-4 | yes (the lowering path) |
| The **Lamplighters' stalls**: 40 seated stone figures, lanterns unlit in their laps, facing the Head Usher's pulpit; the 41st seat, front and centre, empty; two wear your gauntlets (Chapter I P4's trick) | seen from the Lamplighters' Gallery, II-12 (PROPOSAL, cut first) | yes (the Gallery's view) |
| The relief: a figure falling, the same figure standing at a lamp | II-4 | optional |
| Margery's lowered hand | II-4 | optional |
| Everything ends: in the dark behind you the lamp-holders' arms **come down** (a sound, not a sight) | II-12 end | yes |

### 1.6 The in-world text (22 new lines + the 4 canon lines)

Voice (DARK_STORY_BIBLE §1): the Lampholders are **domestic and kind**, a town's notices written in chalk (the shipped text style, TEXT_IN_THE_WORLD "written by a hand"); they never explain the mechanism; every line asks one question; no cheap shock words (never *death, dead, kill, doom, horror*); the gaps do the work. Plaques are canon-style (<= 12 words); boards are the board channel (<= 18 words).

| # | Beat | Text | Style | The question it plants | Second reading |
|---|---|---|---|---|---|
| T1 | II-1 roof | THERE IS ALWAYS A LAMP LEFT ON FOR THE LATE. | plaque | who is late, and who left it? | it is for you; Chapter I's *THE LATE ARE USED SOONER* |
| T2 | II-2 | **KNOCK, AND BE KNOWN.** (canon) | plaque | known by whom? | the Ushers answer knocks |
| T3 | II-2 | WE KNOCK TWICE. THE HOUSE KNOCKS BACK. WE ARE GLAD OF IT. | board | glad? | Chapter I: *HALLAM KNOCKED TWICE FOR LUCK. THE WALL KNOCKED THREE.* |
| T4 | II-3 | THE CHANDELIERS KEEP THE HOURS. THE HOURS KEEP THE TOWN. | board | whose hours? | the engine is a clock |
| T5 | II-4 | **EVERY LAMP A BED. EVERY BED A MORNING.** (canon) | plaque | a morning for whom? | the roll |
| T6 | II-4 | THE BEDS ARE MADE AT EVENING. THE USHER SEES TO IT. | board | who is the Usher? | the first printed word of the villain |
| T7 | II-5 | WHAT WAS CARRIED HERE WAS CARRIED GENTLY. | board | carried how? | the blocks are people |
| T8 | II-6 | **DRESS THE OLD STONE WITH CARE. IT WAS SOMEONE.** (canon) | plaque | someone who? | the lamp-holders |
| T9 | II-6 | A LAMP MAY BE ASKED TO HOLD ONE PERSON. NO MORE. | board | what if it holds two? | rule 3 in a town notice |
| T10 | II-7 | THE WEIGHT HAS NOT FALLEN SINCE THE LAST EVENING. IT IS EAGER. | board | the last Evening? | the Evening is a daily rite |
| T11 | II-8 | THE HOUSES SWAY SO THE SLEEPERS ARE ROCKED. THEY ASKED FOR IT. | board | who asked? | they asked to be kept |
| T12 | II-9 | RING THE MORNING. THE USHER ANSWERS. IT HAS ALWAYS ANSWERED. | plaque | always? | the rule, as a custom |
| T13 | II-9 | THE ROLL: FORTY SEATED. ONE TO COME. | board (cut) | seated where? | the stalls; Chapter I's XLI |
| T14 | II-10 | THE ENGINE KNOCKS EVERY DOOR AT DAWN. NO ONE KNOCKS ALONE. | board | what if it stops? | the Stopping |
| T15 | II-10 after the Stopping | A SILENT MORNING IS NOT A QUIET ONE. | scratch | what is it, then? | the Ushers listening |
| T16 | II-11 | THE STAIR WAS BURNED TO KEEP THE EVENING UP HERE. IT DID NOT. | board | who burned it? | the Lamplighters, once, long ago: Evening has come before |
| T17 | II-12 Gallery | **WE ARE PERMITTED OUR LIGHTS. THE MARK IS FOR THE FEARFUL.** (canon) | plaque | permitted by whom? | the Keepers' law broken, and the Mark Lamp in your hand |
| T18 | II-12 Gallery | THE LAMPLIGHTER IS LATE. THE EVENING IS NOT. | plaque | late for what? | you |
| T19 | II-12 stalls | ONE SEAT IN EVERY ROW IS KEPT. DO NOT SIT IN IT. | board (cut) | kept for whom? | the 41st seat |
| T20 | II-12 Span | NO ONE CROSSES THE SPAN AFTER EVENING. THE DOORMAN DOES. | board | who is the Doorman? | the Head Usher |
| T21 | II-12 Lift | THE DOORMAN HAS NEVER LEFT HIS DOOR. | board | never? | it relocates out of sight |
| T22 | II-13 | ONE LAMP IS LEFT. THE LATE MAY HAVE IT. | plaque | the last lamp | bookend of T1 |
| T23 | II-13 platform | NO USHER GOES BELOW THE THROAT. THE MERE HAS ITS OWN. | board | its own what? | the hook |

(T2, T5, T8, T17 are CHAPTERS §6.3's four canon plaques, word for word. The other 19 are new: about 190 words.) Names and codex lines are CHAPTERS §6.3's, unchanged; N2-5 BRASK moves to the Stone Yards (II-5) because the cranes moved there.

### 1.7 The emotional arc, beat by beat (homesick warmth -> awe -> dread -> loss)

| Beat | Minutes | Feeling | The device | What your hands do |
|---|---|---|---|---|
| II-1 The Lowering | 2.5 | relief, homesick warmth | the first warm light in the game; chimes; the chandelier glints toward you | fire as it comes |
| II-2 Street of Doors | 4.5 | comfort, curiosity | doors, set tables, a lantern on every sill; the house knocks back | knock; yank a counterweight |
| II-3 Chandeliers | 5 | joy, mastery | five swinging rings; the town's clockwork | chain, release on the upswing |
| II-4 Waking Hall | 3 | awe, tenderness | thousands of held lamps; the one lowered hand | nothing: you are carried |
| II-5 Stone Yards | 5 | rhythm, work, a little unease | cranes, rails, *CARRIED GENTLY*, the first polite knock | ride the hook |
| II-6 Dressing Yards | 6 | hush, first dread | stay in the light; the plaster bulges; the breach | stay in the circles |
| II-7 Counterweight Shafts | 5.5 | speed, vertigo | 80 m in 9 s | arrest with a ring |
| II-8 Hung Quarter | 4.5 | play, then the telegraph | houses rock like cradles; the rope hums when the wall climbs | pump, ride, release |
| II-9 Tolling Gallery | 4 | reverence, then the chill | you ring the Morning; something answers | swing into bells |
| II-10 Winding Floor | 5.5 | engine awe -> silence terror | the din is the room; the Stopping | on the beat; hold still |
| II-11 Cinder Stairs | 3.5 | mourning | lamps failing behind you; an Usher far across the pit snuffing one | re-light, and watch it go out again |
| II-12 The Snuffing | 8 | panic, loss | the Round; the Doorman; the last lamp | everything |
| II-13 Soot Throat | 3 | stillness -> awe-dread | the one true rest, then the Mere | nothing; then your first step |

### 1.8 The radio (PROPOSAL, 10 transmissions, each <= 6 s; voices and rules from COMMS.md)

**Signal = lamps.** In Lamphold the bars equal the lit lamps within 30 m (FUTURE_STORY_PLAN §2.4). The Snuffing therefore kills the radio **lamp by lamp, the lamps below you first**; the Mere has no lamps, so the hook is radio-silent. The rest spaces (II-4, II-9 after the peal, II-13) have no chatter (CHAPTERS §3.1 rule 2).

| Id | Where / trigger | Speaker | Line |
|---|---|---|---|
| c2-open | II-1, +1.5 s | ODESSA | "Five bars, Elias. Down here. The lamps are carrying us." |
| c2-open-2 | after | TICK | "Someone lit three thousand of these and left them on." |
| c2-knock | gaze T2 | MAREN | "The Lampholders. They defied the Keepers. I like them already." |
| c2-breach | II-6 breach | VESPER | "Contact. Wall. Unlit side." |
| c2-bell | first Usher answer, II-9 | TICK | "Something answered the bell. Wren, it answered the *bell*." |
| c2-rule | +6 s | MAREN | "Not your footsteps. Not you. The bell." |
| c2-bars | II-11 entry | ODESSA | "Bars are dropping, Elias. Lamps are going out." |
| c2-orderly | II-12 Gallery | MAREN | "That isn't the Mason. That's orderly." |
| c2-last | II-12 Phase C, bars = 1 | VESPER | "Signal: one bar." |
| c2-nosignal | the last lamp | (panel) | NO SIGNAL (the wrist bars go to zero; no voice) |

---

## 2. THE THIRTEEN BEATS

Format: the bible's READ / CHOICE / COMMIT / RISK / RECOVERY / REWARD / ESCALATION, then **Build** with every item marked NEW-SIM / NEW-VIEW / DATA-ONLY. Times are first-time, Normal, deaths included
(sum 60.0 min; the plan's own table). The pit rules of CHAPTERS §3 apply: teach, then test, then twist; >= 2 min of low intensity before the exam; a safe line and a fast line in every beat; no camera motion.

| # | Beat | Depth | Len | Min | Int. | Beat type | Mason (creature mode) | Usher | Other |
|---|---|---|---|---|---|---|---|---|---|
| II-1 | The Lowering | 600-640 | 40 | 2.5 | 1 | TEACH live anchors | knocks far below (dormant) | - | - |
| II-2 | The Street of Doors | 640-720 | 80 | 4.5 | 1 | TEACH 2 (yank) | knocks in the walls (dormant) | - | Holdfast x2 |
| II-3 | The Chandeliers | 720-830 | 110 | 5 | 2 | TEST | dormant | - | - |
| II-4 | The Waking Hall | 830-890 | 60 | 3 | 1 | REST / TRUTH 2 | dormant | traces (coats, chairs) | - |
| II-5 | The Stone Yards | 890-1,010 | 120 | 5 | 2-3 | TEACH 2 (rails, cranes) | wall knocks follow you (sighting) | the first polite knock | - |
| II-6 | The Dressing Yards | 1,010-1,130 | 120 | 6 | 3 | TWIST + CREATURE | breach, cannot cross the light (scripted, non-lethal) | - | Dresser |
| II-7 | The Counterweight Shafts | 1,130-1,260 | 130 | 5.5 | 3-4 | SPEED | inside Alpha's wall (hidden path) | - | - |
| II-8 | The Hung Quarter | 1,260-1,360 | 100 | 4.5 | 3 | REMIX I + II | stalk on the outer wall; rope telegraph | - | - |
| II-9 | The Tolling Gallery | 1,360-1,460 | 100 | 4 | 1-2 | REST / TRUTH 3 | dormant | **first sighting, close, safe** | - |
| II-10 | The Winding Floor / Stopping | 1,460-1,560 | 100 | 5.5 | 4 | CREATURE BEAT | hunts in the din; the Stopping; the runaway | its raps in the silence | - |
| II-11 | The Cinder Stairs | 1,560-1,640 | 80 | 3.5 | 2 | RECOVERY with dread | injured, heard above | **second sighting, far, snuffing** | - |
| II-12 | THE SNUFFING | 1,640-1,790 | 150 | 8 | 5 | EXAM | sound only | **the Round, the Head Usher** | - |
| II-13 | The Soot Throat | 1,790-1,850 | 60 | 3 | 1 | RECOVERY, then THE HOOK | - | **the Ushers of the Mere** | - |

(Lengths 40+80+110+60+120+120+130+100+100+100+80+150+60 = 1,250 m.)

#### II-1 · THE LOWERING (seam) · 600-640 m · TEACH LIVE ANCHORS · Int. 1 · 2.5 min
- **READ:** you hang on the Mark's cradle chain under the pit's ceiling; 3,000 lamps in tiers below. The chain has stopped on its pawl 10 m above the Lamplighters' roof. A great chandelier swings under you on a 36 m chain every 9 s; its brass ring **chimes** at each apex and its dashed phosphor rail glints as it comes toward your hand. T1.
- **CHOICE:** fire as it comes, or wait one pass and watch the arc.
- **COMMIT:** fire on the approach; the ring tears you off the chain (<= 7.5 m/s).
- **RISK:** firing as it recedes yanks you the wrong way; a release on the downswing drops you toward the roof's edge (not lethal: the roof is 12 x 14 m, 8-10 m under the whole arc).
- **RECOVERY:** the roof catches every early release on Normal; the chandelier returns every 9 s; the chain ring stays reachable from the roof's edge.
- **REWARD:** release on the upswing onto the roof: the first street, lamp L2-1, the carved title "II · LAMPHOLD" drifting up out of the dark. The chapter swap happens here, grounded and rope-free (CHAPTERS §5.4 beat 12).
- **ESCALATION:** from here, any anchor might move.
- **Build:** pendulum L 36, T 9, amp 0.30 (7.5 m/s), carried brass ring. The seam (E04) and the mover speed cap 1.5 -> 13 m/s (`MOVER_MAX_SPEED`, its V1 check) are NEW-SIM (C2-0, C2-1a); the chime and rail are NEW-VIEW; the rest DATA-ONLY. Mason: heavy irregular knocks far below, very slow.

#### II-2 · THE STREET OF DOORS · 640-720 m · TEACH 2 (yank) · Int. 1 · 4.5 min
- **READ:** a street carved along the pit wall in three switchbacks (26 m each, 3 m wide, 1.1 m parapet): 18 house fronts, doors with notch carvings, set tables through the windows, a lantern on every sill. At the end a lift cage hangs beside a ring on a counterweight chain. T2, T3. Far below, knocking inside the walls.
- **CHOICE:** knock doors (Names, a shortcut) or go straight to the lift.
- **COMMIT:** fire at the counterweight ring (a pull-anchor, the `haul` flag: hauling never moves you) and **yank**: the cage climbs to you (`pulled` mover, 30 m, four loud notches). Step in; it lowers 30 m at 2 m/s. Hint once: *"Some rings move machinery. Yank them."* (desktop: F).
- **RISK:** none lethal; the open side shows the drop; a closing door telegraphs with a ratchet (1.5 s).
- **RECOVERY:** the cage returns on its counterweight; yank again.
- **REWARD:** N2-1 OSWIN behind the first door (on route); N2-2 GODRIC behind a door two houses off route (it opens a shortcut stair that skips a switchback); lamp L2-2 on the lower street.
- **ESCALATION:** the lift was a moving floor. Next, rings that move fast.
- **THE HANDSHAKE (PROPOSAL):** in the third switchback six house-front hands reach out of the stone: two are **Holdfasts** (the shipped sim: locked 2.0 / 2.5 / 3.0 s, never lethal alone), four are open hands that answer a knock (the shipped `hf-s4-answer` site type: palm up, no cost). The Holdfasts are lamp-holders reaching for a hand.
- **Build:** `pulled` mover (integrated, snapshot/restore) NEW-SIM (C2-1a); `haul` ring and Holdfast sites DATA-ONLY; knock doors need E10 NEW-SIM (fallback if E10 is late: doors open on a body strike like the bell, DATA-ONLY); the lift cage kit NEW-VIEW.

#### II-3 · THE CHANDELIERS · 720-830 m · TEST · Int. 2 · 5 min
- **READ:** the pit opens. Five chandeliers on 20-36 m chains swing across a 60 m gap at offset phases, rest balconies (8 x 6 m) between them; each ring has its rail, each chandelier chimes at its apex. A second span of two chains (18 m apart, opposed phase) follows. T4.
- **CHOICE:** chain chandelier to chandelier (fast, timing) or step balcony to balcony (safe, slower).
- **COMMIT:** catch the next ring as it comes toward you while the current one carries you toward it; release on the upswing onto a balcony or the far bridge.
- **RISK:** releasing on the downswing throws you short into a 90 m drop (lethal).
- **RECOVERY:** static recovery rings under the two longest transfers (N 2, NM 1, AB 0); a lift shaft along the wall whose cage roof catches a fall gently (relative-velocity impact, E16); lamp L2-3 on the second balcony.
- **REWARD:** the fast line (two chandeliers chained, no balcony) saves ~25 s; N2-3 HEDDA on a 1 m ledge reachable only by releasing at the third chandelier's maximum amplitude. Trial *Clockwork* starts at the first chandelier.
- **ESCALATION:** the chandeliers end at the Waking Hall's door. Below, saws whine.
- **Build:** pendulums L 20/24/30/36/30, T 8.0-11.0, amp 0.35-0.55 (8.5-11.5 m/s, cap 12): speed cap raise + E16 relative impact NEW-SIM (C2-1a); rails, glints, apex ticks NEW-VIEW; geometry DATA-ONLY.

#### II-4 · THE WAKING HALL · 830-890 m · REST / TRUTH 2 · Int. 1 · 3 min [cuttable: shrink to 1.5 min]
- **READ:** a hall 60 m across and 60 m high: tiers of alcove beds, each under its own lamp, a **stone hand above each holding it up**, a tally plate of notches under each. A relief: a figure falling; the same figure standing at a lamp. T5, T6. Coats hang on hooks at every ward door; a brass speaking-tube at each bedhead; at the end of every tier a row of tall empty chairs: the Usher's stations (the villain's first trace, never explained).
- **CHOICE:** linger and read the place, or ride straight through.
- **COMMIT:** a slow lowering on one great chandelier through the hall's centre (a `lift` anchor at walking pace, 1.2 m/s).
- **RISK:** none (one big `safeLight` volume; non-lethal heights on Normal).
- **RECOVERY:** n/a (lamp L2-4 at the entry).
- **REWARD:** truth 2 on the lowering path; N2-4 MARGERY on the one bed with no lamp, whose hand is **lowered** (knock its tally rhythm).
- **ESCALATION:** as you leave, one lamp far above goes out. Then another (a soft pop, a puff of soot).
- **Build:** the lowering = `lift` mover NEW-SIM (C2-1a); bed impostors beyond 25 m (ART_AUDIO: about 600 beds visible) NEW-VIEW; text DATA-ONLY.

#### II-5 · THE STONE YARDS (new) · 890-1,010 m · TEACH 2 (rails and cranes) · Int. 2-3 · 5 min
- **READ:** three stacked quarry yards (A, B, C, 40 m apart) of cut blocks, linked by overhead crane rails and two monorails. Hooks run on loops at 3-6 m/s; a 3 m block hangs from each crane and sweeps a walkway at the stack ends. T7. In the plaster beside the rail: three light, even raps, then nothing. (This is the Usher. The player cannot tell it from the Mason yet: the Mason's knocks are heavy and never even.)
- **CHOICE:** ride a hook across (fast; keep its speed on release) or hop the stacks between crane passes (slow, timed); then a monorail to the next yard (24 s headway) or climb down the stacks.
- **COMMIT:** catch a hook as it passes and release with its speed onto the far stack; ride the trolley (5 m/s A->B over 48 m, 6 m/s B->C over 60 m).
- **RISK:** the load crushes you against a stack end where marked (a ratchet 1.5 s before, hazard-stripe pattern); the open drop.
- **RECOVERY:** every hook passes again within 12 s; lit zones where nothing moves; Normal adds a catch ring under each monorail.
- **REWARD:** N2-5 BRASK in the crane cab at the end of the B->C rail (ride the hook to the end); lamps L2-5 (Yard A) and L2-6 (Yard C). Fast line (hook, monorail, hook; no stack touched) saves ~40 s.
- **ESCALATION:** the plaster beside you begins to knock as you move.
- **Build:** `path` movers (loop, pingpong) and the crush telegraph (E16) NEW-SIM (C2-1a); crane and monorail kit NEW-VIEW; the rest DATA-ONLY.

#### II-6 · THE DRESSING YARDS · 1,010-1,130 m · TWIST + CREATURE · Int. 3 · 6 min (bible II-5)
- **READ:** where the old were dressed into lamp-holders: half-cut figures with lantern arms raised out of the stone, stone saws on rails between the stacks (whine 1.5 s ahead), plaster walls, three **lit clusters** (lamp rings 12 m across, `safeLight`) with a gallery between. T8, T9.
- **CHOICE:** hop the stacks between saw passes (timed), cross through the lit clusters (safe), or run the overhead rail.
- **COMMIT:** move cluster to cluster; the plaster bulges, dust falls, knocks travel along the wall as you move.
- **RISK:** saws (moving hazard boxes); in the dark gaps the Mason hunts **if you are hurt** (its gate).
- **THE BREACH (scripted, non-lethal):** 20 m away across the lit gallery the crown comes out of the plaster, fronds open. It cannot cross the light; it listens at the edge; it withdraws into the wall. Lesson: light is safe. The Mark Lamp leans toward the hole.
- **THE DRESSER (PROPOSAL, cuttable):** at the upper stacks a whole player is measured (the shipped sim, hp >= 75 / 70 / 65 %). Lit clusters do not stop it (it is the Keepers' tool, not the dead's): the corridor lesson again, in a lit town.
- **RECOVERY:** lit gallery = lamp L2-8; lit zones where nothing moves; Normal adds a catch ring over every saw.
- **REWARD:** lamps L2-7 (upper stacks) and L2-8 (gallery). **ESCALATION:** the knocking is now close.
- **Build:** `safeLight` volumes (E18), Mason hidden path + breach (E17 subset) NEW-SIM (C2-1b); saw rails NEW-SIM (C2-1a); plaster bulge and dust NEW-VIEW; Dresser and hazards DATA-ONLY.

#### II-7 · THE COUNTERWEIGHT SHAFTS (new) · 1,130-1,260 m · SPEED · Int. 3-4 · 5.5 min
- **READ:** three 6 x 6 m shafts cut through the rock, 80 m deep, 15 m of street between them. In each an open-sided cage on a counterweight (a second mass rising in the next shaft). A gong at the top of each: the cage is called. T10.
- **CHOICE:** stand in the cage (safe: a moving floor, 9 s) or hook its roof ring and hang under it, keeping both arms for the next shot (fast: momentum theft).
- **COMMIT:** the express profile: accelerate 2.85 s at 4.6 m/s², cruise at 13 m/s, brake 2.85 s (80 m in 9 s). Chain a static ring before the bottom to arrest (the elastic catch, E15).
- **Gamma (teach):** clean. **Beta (crush):** the counterweight crosses the cage's shaft at mid-height; its gong sounds 1.5 s before; stand in its lane and it is a `crush`. **Alpha (the Mason):** it is inside the wall climbing the shaft at 4 m/s on a closed-form hidden path; its passage bulges the wall 1.5 m into the shaft for a 6 s window (a crush zone, the knocks climbing with it): the express must leave after it has passed, or early enough to clear the zone in 9 s. You time the drop against its sound.
- **RISK:** letting go of the express early at 13 m/s (0.76 / 0.84 / 0.90 of lethal impact on N / NM / AB); crush; the bulge.
- **RECOVERY:** a catch ring below each shaft (N 2 / NM 1 / AB 0); lamps L2-9 (Gamma head) and L2-10 (street between Beta and Alpha).
- **REWARD:** the hang-under line saves ~35 s. **ESCALATION:** the Mason is now below you.
- **Build:** `lift` mover with the express profile (peak <= 13 m/s), crush zones, moving hazards NEW-SIM (C2-1a); Mason hidden path with `bulge` crush volumes NEW-SIM (C2-1b); gongs and shaft kit NEW-VIEW.

#### II-8 · THE HUNG QUARTER · 1,260-1,360 m · REMIX (I + II) · Int. 3 · 4.5 min [cuttable: drop the houses, keep the governor]
- **READ:** six houses (6 x 6 x 8 m) hung on paired 24 m chains over the pit's centre, swaying; across the void the governor shaft, a vertical 30 m shaft with three arms whirling rings in a flat orbit (R 8 m, T 6 s: 8.4 m/s). Old chains carry fragile rings (rule I remix). T11.
- **CHOICE:** pump a house to reach the next (safe: land, then yank its chain ring in rhythm; a **driven pendulum**, amp <= 0.35, <= 6.3 m/s) or ride the governor and release on the tangent across 30 m (fast).
- **COMMIT:** jump at the house's apex; or catch a governor ring and let go on the tangent.
- **RISK:** a mis-release throws you at 8.4 m/s into the pit; frayed rings snap.
- **RECOVERY:** a web of catch chains under the houses (N full, NM half, AB none); lamp L2-11.
- **REWARD:** the governor line saves ~20 s; the engine's roar grows below.
- **ESCALATION (creature):** the Mason stalks the outer wall below you: heard, then seen as a silhouette crossing the lamp tiers. The **rope telegraph** fires for the first time when it climbs the wall your anchor hangs from: that hand buzzes (E11, E26).
- **Build:** `driven` pendulum (integrated; snapshot/restore for the bots) NEW-SIM (C2-1a); rope telegraph NEW-SIM (C2-1b); orbit DATA-ONLY after the cap raise.

#### II-9 · THE TOLLING GALLERY (new) · 1,360-1,460 m · REST / TRUTH 3 · Int. 1-2 · 4 min
*The Usher's first sighting. It teaches the rule and the torch in complete safety.*
- **READ:** a covered nave 64 m long hung on iron beams between two towers; **nine bells** (1-4 m) hang from the roof beams in a line, rope rings along the beams. T12, T13. No machinery runs here: the quietest place in the chapter.
- **CHOICE:** ring the Morning Peal (any five of nine), or sit and listen.
- **COMMIT:** swing into a bell with your body (>= 2.5 / 3.0 / 3.5 m/s; the shipped `bell` verb: it bounces you, every strike is a loud toll). Five open the way down (the tower hoist).
- **THE ANSWER (scripted, deterministic, non-lethal):** toll 1: three light raps from far below. Toll 2: a pale ring turns in the dark 100 m under you. Toll 3: it climbs one tier. Toll 4: it reaches the **Tenor's landing**, 12 m below the nave's end, where the ninth bell (4 m, the Tenor) hangs from a cantilever. It stands under it, ring turned up, and its **torch** lights the bell: a cold sphere of light 2.6 m wide. The hum rises for 2 s. The throat whips and **strikes the Tenor**: BONG. It does not stop; it keeps striking the bell it just rang (it is *parked*, §3.7). After the third blow the iron stand snaps and the Tenor falls 60 m: a long clang, a crash far below; the Usher turns and **walks away down the stairs toward the crash**.
- **RISK:** none, by geometry: the Usher can reach only the Tenor's landing, never the nave (a raised gate leaf); the bot checks that every point the Usher can stand on is >= reach + 3 m from every point the player can stand on.
- **RECOVERY:** n/a. Lamp L2-12 at the nave's start; the rest is not betrayed (CHAPTERS §3.1 rule 2).
- **REWARD:** truth 3 (the roll) and a close, safe look at the villain: the coat, the breath through the throat, the ring, the sphere, the way it turns gold, the recoil. You learn five facts: it answers bells; the torch marks the spot; the blow breaks what it hits; a bell can park it; it walks, it does not climb.
- **ESCALATION:** the hoist drops you past the empty Tenor landing, 12 m from where it stood.
- **Lines:** fast = five bells on three shared rope rings (30 s); safe = one bell at a time from the beams (80 s).
- **Build:** `bell` verb DATA-ONLY (exists); scripted `UsherSight` actor and the Tenor's `blow` fixture NEW-SIM (C2-3d); the Usher in game, the nine bells' modal tones NEW-VIEW (C2-3b).

#### II-10 · THE WINDING FLOOR / THE STOPPING · 1,460-1,560 m · CREATURE BEAT · Int. 4 · 5.5 min (bible II-7, stretched from 60 to 100 m)
- **READ:** the engine hall: a 60 m wheel (render-only rotation; its rim rings are `orbit` movers, T 40 s, 4.7 m/s), an escapement rail ticking rings 1.5 m per 1.2 s, trip-hammers every 4 s, gear trains sweeping hazard teeth between anchors. **The din is the room.** T14. The hunt is on, but inside the din it cannot hear you (`mask` volumes); it sees with its fronds within 10 m.
- **Layout:** 10 m entry (L2-13), 35 m hammer floor and escapement, 15 m wheel-rim climb over the gear wall, 40 m runaway lift.
- **CHOICE:** ride the escapement tick by tick (slow, steady) or the rim over the gear wall (fast; the only climb before Chapter V). Move on the hammer beat (each strike masks you 1.5 s) or hang still between beats.
- **RISK:** gear teeth; hammer strikes shake fragile rings (life x 0.6); within 10 m it sees you.
- **THE STOPPING (~90 s):** when you attach to the escapement's last ring, a 4 s grinding telegraph, then the Mason forces its body into the great escapement: every mover shrieks to a stop over 1.2 s; the din drops to zero. Silence, the designed signal. The stopped machine is a frozen climbing frame of static anchors. It is wedged and **listening**: 20 s, or three loud noises (hard landings, yanks, breaks). In the silence: **three light, even raps from far below** (T15 scratched on a beam). The Mason freezes too: two predators listening to each other. Then it tears free and the engine restarts in a **runaway at 1.6x** (1.8x NM, 2.0x AB); the din is back; ride a runaway lift 40 m down to the head of the Cinder Stairs.
- **RECOVERY:** lamps L2-13 (entry) and L2-14 (runaway start: you wake with the runaway already running, restored exactly, E03).
- **REWARD:** it retreats, injured, up into the lit tiers. Trial *On the Beat*. The engine is the town's clock: **the day now runs at 1.6x**.
- **ESCALATION:** high above, lamps begin to go out.
- **Build:** `escapement`, orbit rim, hammers (moving solids), `mask` volumes, the Stopping action, the runaway `timeScale` ramp NEW-SIM (C2-1a/b); wheel and gear kit NEW-VIEW; `sil.ch2.stopping` NEW-VIEW.

#### II-11 · THE CINDER STAIRS (new) · 1,560-1,640 m · RECOVERY with dread · Int. 2 · 3.5 min
- **READ:** the burnt stair: twelve flights of charred treads spiralling down the pit wall, black beams for anchors, ash drifting. T16. The lamps along it gutter and go out **behind** you, one by one, from above. The injured Mason is heard above, dragging (irregular, wet).
- **CHOICE:** the stair (slow, crumbling treads) or chain the charred beams (fast).
- **COMMIT:** descend; some treads crumble (Chapter I's crumble solids, 0.9 / 0.65 / 0.5 s); falling embers on three rockfall lanes (lead 1.2 s; 0.3 / 0.4 / 0.5 damage, the shipped `lanes`).
- **THE SECOND SIGHTING:** across the pit, 60 m away on the opposite tier, a tall figure walks the gallery with its throat dipping over each lamp: a pop, the next. It never looks at you. The first sight of the Snuffing as an act.
- **THE LAMP YOU CANNOT KEEP (optional, cuttable):** hold the Mark Lamp to a failing lamp for 1.5 s (the shipped `lamp` verb) and it re-lights; 40 s later it goes out again.
- **RECOVERY:** low pressure; a catch ring at every second flight on Normal; lamp L2-15 at the head. The one calm minute before the exam.
- **REWARD:** the view. **ESCALATION:** the Lamplighters' Gallery, lit, over a dark pit.
- **Build:** crumbles, lanes, the `lamp` verb DATA-ONLY; the lamp-field `lit` attribute and `lamp:snuff` events NEW-VIEW + NEW-SIM (E25, E19); `UsherSight` on a gallery path NEW-SIM (C2-3d).

#### II-12 · THE SNUFFING (exam) · 1,640-1,790 m · EXAM · Int. 5 · 8 min (2 quiet) (bible II-8)
Specified in full in **§3** (it is the boss). One line each: **Quiet (2 min)** the Lamplighters' Gallery, lit, T17 T18, the Round far above, the stalls and the pulpit in the dark below; **A, the Round (~110 s)** descend five tiers ahead of the front; **B, the Well (~90 s)** the betrayal and the crossing; **C, the Span and the Lift (~100 s)** the 150 m truss and the cage.

#### II-13 · THE SOOT THROAT · 1,790-1,850 m · RECOVERY, then THE HOOK · Int. 1 · 3 min
Specified in full in **§4**. The true rest (never betrayed) for the first 40 seconds; then the chain.

### 2.1 Where the creatures are (beat summary)

| Creature | Beats | Rule | Lethal? |
|---|---|---|---|
| Mason | knocks II-1..II-5; breach II-6 (scripted); Alpha's wall II-7; stalk + rope telegraph II-8; hunt in the din + the Stopping + runaway II-10; heard above II-11; sound only II-12 | hurt-gated (<= 35 %), hears landings, jolts, yanks | II-10 only (and II-6, II-8 if hurt) |
| Dresser | II-6 upper stacks (PROPOSAL, cuttable) | whole-gated (>= 75 / 70 / 65 %) | cuts a ring; dresses within 1.6 m |
| Holdfast | II-2 Handshake (two sites) | grip | never alone |
| Usher | raps II-5; trace II-4; **first sighting II-9 (parked, safe)**; raps II-10; far sighting II-11; **II-12 (the Round, the Head Usher)**; the Mere II-13 (does not strike) | hears bells only; the torch marks the strike | II-12 only |

### 2.2 Waking lamps (replaces CHAPTERS §6.3's table: 20 lamps for 1,250 m; Normal all; Nightmare every other plus exam starts; Abyss chapter start and end)

| Lamp | Where | N | NM | AB |
|---|---|---|---|---|
| L2-1 | Lamplighters' roof (chapter start, seam) | ● | ● | ● |
| L2-2 | lower street, after the lift | ● | | |
| L2-3 | second chandelier balcony | ● | ● | |
| L2-4 | Waking Hall entry | ● | | |
| L2-5 | Stone Yards, Yard A | ● | ● | |
| L2-6 | Stone Yards, Yard C | ● | | |
| L2-7 | Dressing Yards, upper stacks | ● | ● | |
| L2-8 | the lit gallery | ● | | |
| L2-9 | Shaft Gamma head | ● | ● | |
| L2-10 | street between Beta and Alpha | ● | | |
| L2-11 | Hung Quarter landing | ● | ● | |
| L2-12 | Tolling Gallery start | ● | | |
| L2-13 | Winding Floor entry | ● | ● | |
| L2-14 | runaway start (the Stopping, phase 2) | ● | ● | |
| L2-15 | Cinder Stairs head | ● | | |
| L2-16 | Lamplighters' Gallery (exam start) | ● | ● | |
| L2-17 | Well rim (Phase B start) | ● | ● | |
| L2-18 | Span head (Phase C1 start) | ● | | |
| L2-19 | Lift tower, top landing (Phase C2 start) | ● | ● | |
| L2-20 | Soot Throat (chapter end) | ● | ● | ● |

A Phase B or C lamp is **kindled on arrival** and cannot be snuffed by an Usher (it is the player's lifeline; PROPOSAL: the only lamps in the Snuffing a ring will not touch).

### 2.3 Movers used (speed check; peak speed v = L · amp · 2π / T for a pendulum)

| Mover | Kind | Parameters | Peak | Cap | New? |
|---|---|---|---|---|---|
| II-1 great chandelier | pendulum | L 36, T 9, amp 0.30 | 7.5 m/s | 9 | cap raise |
| II-3 chandeliers | pendulum | L 20-36, T 8-11, amp 0.35-0.55 | 8.5-11.5 | 12 | cap raise |
| II-2 / II-4 / II-10 lifts | `pulled`, `lift` | 30 m at 2 m/s; hall 1.2 m/s; runaway 40 m x 1.6 | <= 4 | 6 | NEW-SIM |
| II-5 hooks, monorails | `path` loop / pingpong | 3-6 m/s; 5 and 6 m/s | 6 | 6 | NEW-SIM |
| II-7 express | `lift` trapezoid | 80 m in 9 s, 2.85 s ramps | 13 | 13 | NEW-SIM |
| II-8 houses | `driven` | L 24, amp <= 0.35 | 6.3 | 12 | NEW-SIM |
| II-8 governor | orbit | R 8, T 6 | 8.4 | 12 | cap raise |
| II-10 wheel rim | orbit | R 30, T 40 | 4.7 | 6 | cap raise |
| II-10 escapement | `escapement` | 1.5 m per 0.25 s move, 1.2 s tick | 6 (bursts) | 6 | NEW-SIM |
| II-12 tier chandeliers | pendulum | L 16-24, T 7-9, amp 0.45 | 6-9 | 12 | cap raise |
| II-12 Great Bell | pendulum | L 40, T 12, amp 0.38 | 8.0 | 12 | cap raise |
| II-12 Span trolleys | `path` | 6-10 m/s | 10 | 13 | NEW-SIM |
| II-12 Lamplighter's Lift | `lift` | 30 m in 15 s, smoothstep | 3.0 | 6 | NEW-SIM |

---

## 3. THE BOSS: THE HEAD USHER (and the Round that leads to him)

### 3.1 The decision, and why

| Option | For | Against | Verdict |
|---|---|---|---|
| The Mason again (bible §6.2) | canon; its sim exists | Chapter I's predator; the owner asked for the Usher; the Mason is already the II-10 antagonist | no (kept as sound and pressure only) |
| One ordinary Usher | the owner's model as made | 1.95 m in a 110 m pit is a speck; a slow walker cannot threaten a 10 m/s rope player | no (it is the **Round**, the supporting cast) |
| A chorus of throats as the boss | beautiful image | a gauntlet, not a duel; nothing to learn once, nothing to beat | no (it is **Phase A**) |
| A new giant | memorable | needs a new asset, new rig, new lore | no |
| **The Head Usher: the same man at 1.8x whose collar comes undone so that the throat goes on** | reuses `usher.glb`; a man-sized silhouette with a 30 m reach is the owner's "nightmares can be beautiful"; one rule (bells); one tell (the torch); the arena does the rest | the long throat needs a render spike (§3.11) | **yes** |

Why it fits the pillars. (1) The rope is the game: it is beaten only by live anchors, never by damage. (2) Heard before seen: raps, keys, breath, the hum. (3) Your body is the camera: nothing moves the view; the collar drop, the bow and the sit are in-world acts the player watches. (4) Every death is a waking: the Usher *seats* you. (5) Learnable, fair, replayable: a closed-form Evening clock plus one reactive rule. (6) One rule: LIVE ANCHORS. The phases are the three things a live anchor can do to a hunter: **carry you past it** (A), **tell it where to strike** (B: the bell, the clapper, the pawl), **take you away from it** (C: the Span, the cage).

### 3.2 What it is

- **Name.** In the team docs: **the Head Usher**. In the town: **the Doorman** (T20, T21): "THE DOORMAN HAS NEVER LEFT HIS DOOR." The name "Usher" is kept (it carries the whole chapter: the roll, the seat, the Evening, the show-in); it fits the lore better than any alternative I tried (Knocker-Up, Warden, Hearer).
- **Lore.** The first Usher; the roll-caller of the Assembly at the Bell Well, who gave his head to the roll before there was a rite. The other Ushers answer one tier each; he answers the door. His collar is brass, not white, with a ring of keys at the belt: one key per bed. He is the only one who can end the Evening.
- **Silhouette and scale.** The USHER.md man at **1.8x** (3.5 m tall at rest, throat 6.75 m coiled) standing on a pier. The throat **pays out**: 6.75 -> 16 m (B) -> 24 m (C1) -> 32+ m (C2), a long ribbed tube arcing across the dark like a crane, the ring held out at the end. From the Gallery he is a coat and a pale dot; from 14 m he is a cathedral.
- **Body language.** Stands perfectly still (Idle). The ring turns to a sound (Listen). When he strikes, the throat draws back into an S, hums, and whips. He never runs. He relocates only when you cannot see him (the Dresser's rule), so he is always at the next door.
- **The Round (Phase A cast).** Five ordinary collared Ushers (1.95 m, the stock model), one per tier. Same rule, shorter reach (4.5 m), they walk.

### 3.3 Senses: it hears tolls

**The rule, in one sentence: the Usher answers bells.** Everything else about you is invisible to it.

| Toll source | Event | Loud | Heard within (Normal) | Where the toll is | Exists today? |
|---|---|---|---|---|---|
| Bell strike (body, blow or clapper) | `bell:ring` | 1.0 | 60 m | the bell | event yes (objectives3d) |
| Machine notch (haul, pull, winch ratchet) | `objective:progress` with `noise` | 0.7 | 42 m | the ring or winch | yes |
| Cage or lift gong, pawl clunk, gong plate | `toll:emit kind gong` | 0.8 | 48 m | the gong | NEW-SIM |
| Great Bell stroke | `evening:stroke` | 1.0 | whole Well | the bell at its apex | NEW-SIM |
| **Brass ring bite** (anchor flag `toll`: a small bell hangs from its rim) | `grapple:attach` | 0.35 | 18 m | the ring | NEW-SIM (flag) |
| Collapse crash (debris landing) | `front:crash` | 0.6 | 36 m | the crash | NEW-SIM |
| Player knock | `player:knock` | 0.5 | 30 m | the hand | needs E10 |
| **Not tolls** | footsteps, landings, wall hits, rope jolts, yanks on non-machine anchors, reel, breath, radio, the Mason | 0 | | | |

Brass rings **chime** from II-1 on, as a harmless joy (the first sound of the chapter). In II-12 the same chime is dread. *The player learned to love the sound that calls it.* Iron rings are silent. Shape-code (a small bell on the rim) and a phosphor flare on bite; the caption is "[Ring chimes]".
**Masking.** A louder event within 10 m of a quieter toll hides it for 1.0 s (a crash hides a chime). The Head Usher hears 1.5x the listed ranges (it is the big ear).
**Aim and lead.** On a toll the Usher aims at the source's position **plus its velocity x (Listen + Coil)**; it leads movers (chandeliers, the cage) because the machine's motion is closed-form and the rite is old. The aim point is clamped to its reach. A toll beyond reach still draws the torch and the throat, which extends fully and **sags short**: the visible reach limit.
**Who the player is.** The player is never the target; the **toll** is. You are in danger only when you stay within the lethal sphere of a toll you made (or stood beside).

### 3.4 The torch: the telegraph grammar

The ring is a torch. Its cold light is a **sphere of light** (a fresnel shell, no depth write) centred on the aim point, with a thin line back to the ring. It reads at any depth in the dark and in VR (a sphere shows both radius and centre).

| Stage | Look | Sound | What it means | Your move |
|---|---|---|---|---|
| LISTEN | pale, wide (3.0 m; Head 4.4 m), drifting toward the toll | the ring's breath turns; three raps | it heard a toll; the aim may still change | note where; stay out of it |
| COIL | tightens to the lethal radius (1.8 m; Head 2.6 m), brightening; the throat draws into an S | a hum rising 200 -> 800 Hz | a strike is coming | leave the sphere |
| COMMIT (last 0.4 s) | **gold**, frozen | the hum jumps an octave; keys stop | aim is locked | be outside; do not turn back |
| WHIP | the throat straightens (0.35 s) | a pipe note, a crack | lethal in the sphere | |
| RECOIL | sphere dies; ring sags | a long breath out | **safe window** (3.0 s): it cannot strike | go |

The rope telegraph (E11): the hand whose anchor lies within the sphere +4 m **buzzes** from LISTEN on and rises through COIL. The player always has the sphere, the hum and the hand.

### 3.5 The arena: THE BELL WELL AND THE SPAN (II-12, 1,640 -> 1,790 m)

Depth below the section top `d` (real depth = 1,640 + d). The pit is 110 m wide; the Well is a 56 m round hall at its foot.

| Zone | d | Content |
|---|---|---|
| **Lamplighters' Gallery** | 0-12 | lit balcony 24 x 10 m, lamp L2-16, T17 T18; the view down: the dark Well, the **pulpit** (a stone pier 4 m across, top at d 92, at x +16, z +8), the **stalls** (40 seated Lamplighters, an empty 41st seat) |
| **Tiers T1..T5** | 12-72 | five half-ring galleries 12 m apart (T1 d 14 ... T5 d 62), 9 lamp clusters (8 lamps each, `safeLight`) per tier; between them: chandeliers (pendulum, L 16-24), two lifts (each a moving `safeLight`), stairs (the slow line, one hidden alcove); every tier has a **bell** at its far end and a **clapper ring** (a pull-anchor on a chain) whose bell-wire rings the bell of the tier above |
| **The Well** | 66-105 | the Great Bell (9 m) at the centre on a 40 m chain from a cross-beam at d 58; rest at d 98; the **gate G** on the east rim (x +28, d 92): a raised iron leaf (the Span's first truss), a **pawl** and a **pawl bell** on it; a **clapper W** on the west rim (rings G's bell by a bell-wire) and a **clapper N** on the north rim (rings the north bell); iron recovery rings under the crossing (N 3, NM 1, AB 0) |
| **The Span** | 92-120 | a spiral iron truss 150 m long hugging the pit wall from G to the Lift tower, falling 28 m; the deck (4 m plates), the under-rail (trolleys on `path`), hanger rings (iron on the right truss, **brass on the left**: the bait row), a stair-step last span |
| **The Lift tower** | 120-150 | top landing (L2-19) at d 120; the tower gate where the Doorman stands; the shaft 8 x 8 m, 30 m deep; the Lamplighter's Lift: a cage 3 x 3 x 3 m with its master lamp, outside rings on three faces, gong plates every 5 m on the shaft wall; at the bottom the Soot Throat's mouth with an iron shutter |

**LIVE ANCHORS beat it.** Phase A: pendulum chandeliers and moving lifts carry you past the Round. Phase B: the Great Bell (the biggest live anchor in the game) and the clapper chains (pull-anchors) decide where the Doorman strikes. Phase C: trolleys and the cage carry you away from his reach. Nothing in II-12 is passed by standing on a static floor.

### 3.6 The exam, phase by phase

#### The Quiet (2 min, d 0-12, lamp L2-16)
Intensity 1. The Lamplighters' Gallery is lit. T17, T18. Far above, a ring of lamps goes out: a soft pop, a puff of soot. Another ring. Below, the Well is dark and still: the Doorman on his pulpit, ring turned up toward you, keys faintly jingling; the stalls below him, the empty seat. A second look: the Round, five tall figures on the upper tiers, in a line, working down, snuffing. No chatter (rest rule). The Gallery has a stair, a lift and a chandelier down to T1. **Trigger:** leaving the Gallery (`inBox`) starts the front. Staying is not a mercy: after 150 s the Round reaches the Gallery and its SNUFF sphere takes your cluster (the same rule as everywhere: a staller loses).

#### PHASE A: THE ROUND (~110 s, d 12 -> 66; the Mason's chase, replaced)
- **Goal:** reach the T5 landing (L2-17) ahead of the front.
- **The front (E19 `snuff`):** the five Ushers of the Round work down the tiers **behind and above you**, each walking its tier's gallery clockwise as the front reaches it and snuffing a cluster every 6 s (NM 5, AB 4); lamps in a snuffed cluster go out with a soft pop and a puff of soot, and the cluster's `safeLight` switches off. Nine clusters a tier, five tiers. The front is rubber-banded 25-40 m (NM 18-30, AB 15-25) above you, 1.2-4 m/s. The Round is the front made visible.
- **The danger:** the Round never reaches a player who keeps moving. It is lethal to **a cluster it is about to snuff while you stand in it** and to **a toll within its reach (4.5 m)**, i.e. to a staller. Its SNUFF warning is a 2.0 m sphere on the cluster for **1.6 s** before the ring dips: the first time the player sees the torch aimed at them. The Round is deterministic (its walk is a function of the front's progress); the bots verify every cluster in order.
- **Lines:** *fast* the chandelier chain (T1 -> T5; brass rings near the galleries chime, which matters only if the front has caught you; the centre rings are iron); *safe* the lifts (silent, each its own moving `safeLight`, a 12 s ride, 8 s headway); *slow* the stairs (a hidden alcove on T3: the one place a staller is not snuffed).
- **The clapper (the first remote toll):** every tier has a **clapper ring** on a chain (a pull-anchor: aim and yank 1.2 s) whose **bell-wire runs up to the bell on the tier above**, where the lowest working Usher is. Yank it and that bell tolls: the Usher walks to it and **strikes it** (it is *parked*: it keeps striking the bell, a cycle of 7.85 s on Normal, for 3 strikes, NM 2, AB 1, then resumes the Round). Parking the lowest working Usher **holds the front** for about 24 / 13 / 6 s after it reaches the bell (plus its walk). The tool for a player who is behind; the cost is a hand and a rope.
- **Recovery:** static iron recovery rings under every chandelier transfer (N 2, NM 1, AB 0); lamp L2-16 (and L2-17 on arrival).
- **Reward / escalation:** T5, the Well rim, a dark pit full of the sound of a thousand chairs. **The Doorman's collar comes undone.**

#### PHASE B: THE WELL (~90 s, d 66 -> 96; the betrayal and the crossing)
- **Start:** you step on the Well rim (L2-17 kindles). **The betrayal:** the lamps **below** you go out. The Doorman unbuttons his brass collar; it falls; the throat **pays out** and sweeps the Well's floor in two arcs at 6 m/s, snuffing the rows of lamps in the stalls from the back forward until the last row; the empty seat's lamp is the last. You see the throat for the first time: 16 m of ribbed tube, a ring at the end, the comet of lamps going out behind it. 12 s. You are out of reach (the rim is 44 m from the pulpit). Then the **Great Bell is released** and begins its stroke.
- **Goal:** reach the Span head (L2-18) through **gate G**, which is shut. G opens only when its **pawl** is struck.
- **The exact rule: the pawl breaks under any blow of 3.5 m/s or more: the Doorman's whip, or your own body.** Both are tolls at G's pawl bell.
- **The Great Bell's stroke** is a toll every 6 s alternating the west and east apex (Normal timeline in §3.7). The Doorman answers each; his reach (16 m from the pulpit, at x +16) covers the east apex and G but not the west apex: a west stroke draws his torch and his throat extends fully and **sags short**. The east stroke gets a real strike 4.5 s later at the east apex point.
- **Safe line (the Doorman opens the door; ~80 s):** (1) on the west rim aim at **clapper W**, yank 1.2 s: G's pawl bell tolls by the bell-wire. (2) The Doorman Listens (2.5 s), Coils (2.0 s), **WHIPs the pawl**: the leaf crashes down (a deck now). (3) Recoil 3 s. He is aimed at G. (4) Cross the Well on the **iron** north-rim chandeliers (silent, outside his reach, 3 rings). (5) On Nightmare and Abyss the leaf's crash is a toll at G, so he is aimed at G again: before the last 14 m, toll **clapper N**; the north bell draws his torch and his throat away (a decoy window of 7.9 s: Listen + Coil + Whip + Recoil, as long as nothing newer rings; the Great Bell's east stroke strikes the east apex, 13 m from G, not G). On Normal the crash is silent and this step is optional insurance. (6) Cross G; step onto the Span; L2-18.
- **Fast line (the player opens the door; ~35 s):** attach to the Great Bell's crown ring as it passes the west apex; ride the swing east (6 s); release at the east apex (the stroke is at the same instant: the Doorman starts to Listen) and fly 13 m to **G's pawl bell**, striking it with your body at >= 3.5 m/s: the pawl breaks, the leaf falls, you bounce onto it, run 12 m to the Span. The whip lands on the east apex (behind you) at +4.5 s, and on Nightmare / Abyss the leaf's crash is a toll at G that re-aims him to the leaf. You are 7 m past it. The speed-run line and a trailer shot.
- **Counters:** iron rings; decoy tolls; riding the bell; Recoil windows; the sag-short sign that you are beyond reach.
- **Recovery:** iron recovery rings under the crossing (N 3, NM 1, AB 0); lamp L2-17 on the rim.
- **Fairness:** no strike within 3 s of respawn; the leaf's crash is not a toll on Normal.

#### PHASE C1: THE SPAN (~60 s, d 92 -> 120, 150 m)
- **Start:** you step on the Span head (L2-18). The Doorman is no longer on the pulpit. At the far end, on the Lift tower, a tall coat and a pale ring: **he is at the next door** (T20, T21). He relocated while you could not see him.
- **The front (E19 `collapse`):** when you are 30 m onto the Span, the **Evening draws up the deck**: segment by segment from the near end, base 7 m/s, target gap 22 m (N); 8 / 16 (NM); 9 / 11 (AB). Each falling segment is a **crash**: a toll at 0.6 within 36 m. Sections fall past and through your swing lines, each warned 0.7 s ahead by a creak and a dust burst; ropes to anchors on a falling section break (`grapple:break`, reason `'front'`); **hooks ahead of the front always stay solid**.
- **Goal:** reach the Lift tower gate. The last 24 m (N 24, NM 26, AB 28) lie inside the Doorman's reach.
- **Lines:** run the deck (5.5 m/s: too slow); drop **under** the deck and swing hanger to hanger (10-12 m/s). The **right truss** hangers are iron (silent: *the safe line*, 4 / 2 / 0 recovery hooks under the deck); the **left truss** hangers are **brass** (*the fast line*: shorter chain, saves ~20 s). A brass chime in the last 27 m is a toll at that hanger (he strikes it 4.5 s later). **The expert move: bite a brass hanger on a crash.** The crash masks the chime (§3.3); the crash schedule is closed-form and audible. Trolleys on the under-rail (moving anchors, 6-10 m/s, silent iron): catch one for a burst, release at the right moment.
- **The last span** drops in stair-steps (-1 m, hold, -2 m, hold, -4 m; a `steps` mover): leap from it to the cage's outside ring as the Span falls away.
- **Recovery:** hooks ahead of the front stay solid; recovery hooks under the deck; lamp L2-18 and L2-19.

#### PHASE C2: THE LIFT AND THE LAST LAMP (~30 s, d 120 -> 150)
- **Start:** the tower top landing (L2-19), the cage waiting. The Doorman stands at the gate 6 m away, ring turned to you; his throat has paid out to 32 m. **No tolls from you = no strike.** Departure: one yank on the cage's lever ring (a `haul` ring on the cage's outside face, one 1.0 s notch: a toll at the cage); the gong sounds at the end of the notch, and that is t = 0.
- **Goal:** ride the Lamplighter's Lift 30 m (15 s) and get through the Soot Throat's door before it shuts.
- **The cage is the bait.** It carries the master lamp (the last lit lamp in Lamphold, a moving `safeLight`). Departure gong at t = 0; a **gong plate every 5 m** on the shaft wall tolls as the cage passes. The Doorman leads the cage: **whip 1 lands at 4.5 s** (NM 3.9, AB 3.5) on the cage's predicted position; **whip 2 at 12.35 s** (NM 10.6, AB 9.25; AB also at 15.0), the last one at the bottom. The sphere (Head: 2.6 m) covers the whole cage. **Do not be in the cage.** Hang from the cage's outside rings on a rope 3.3 m or longer (the cage's side faces the 4 m gap to the shaft wall) or from the shaft's guide rings: the cage is a moving anchor and you ride its speed.
- **The last lamp:** whip 2 hits the cage and **snuffs the master lamp**. The last lit lamp in Lamphold is out. (The Mark Lamp in your hand is not touched: the Usher's rule is to answer the toll, not to chase the lamp.)
- **The door:** the lamp's death starts the **shutter** on the Soot Throat's mouth: a chain ratchet 1.5 s before it moves, then it closes in 5.0 s (NM 4.0, AB 3.0) from the lamp's death. Jump from the cage's outside ring to the Throat's lip (3 m) or reel in.
- **Recovery:** lamp L2-19 (N, NM). If the shutter beats you, or a whip lands, you wake at L2-19 with the cage back at the landing (E03 snapshot).

### 3.7 State machines (to implement from)

Pure sim, `src/sim/usher3d.js` (`Usher3D`, `USHER_TUNING`, `USHER_DIFF`, `tollHeard`), Node-testable, deterministic, allocation-free per step, like `dresser3d.js`. It reads the toll bus and the Evening clock; it never reads the player's velocity.

**Usher (common; the Head Usher is the same machine with the extra rows below).** Timers are Normal / Nightmare / Abyss.

| State | Entry | Exit | Timers and notes |
|---|---|---|---|
| OFF | not in play; relocating (out of the player's view cone) | enters play at its station | the Dresser's `_enterPlay` rule: never within 22 m, only unseen |
| STAND | spawn; Recoil with nothing queued; arrived | a toll heard -> LISTEN; the Round's schedule says walk -> WALK or SNUFF | Idle clip; keys jingle (Head) |
| WALK | patrol node or SEARCH target | arrives -> STAND / SNUFF / SEARCH; a toll -> LISTEN | 1.2 / 1.45 / 1.7 m/s on the authored node graph (A*, <= 40 nodes); never leaves the graph; never climbs |
| SNUFF | arrives at a cluster | after the dip -> WALK | torch sphere (2.0 m) on the cluster for **1.6 / 1.5 / 1.5 s** before the ring dips; pop at the dip; kills only a player in the sphere; the membrane brightens +10 % per cluster |
| LISTEN | a toll above the hearing threshold | hold ends with no newer toll -> COIL if the aim is in reach, else SEARCH; a newer toll re-aims (hold resets to >= 0.6 s, total cap 6 s) | hold **2.5 / 2.2 / 2.0 s**; torch pale, wide (3.0; Head 4.4 m); aim = source + velocity x (hold + coil); the Listen clip |
| SEARCH | a toll beyond reach | within reach - 1 m -> COIL; a newer toll -> LISTEN; 12 s without progress -> STAND | walks toward the aim; the torch sweeps; the Head Usher does not walk: his throat pays out to full reach and **sags short** instead |
| COIL | aim in reach | after the telegraph -> WHIP | **2.0 / 1.7 / 1.5 s** (never < 1.5 s on any difficulty); sphere tightens to 1.8 m (Head 2.6) and brightens; last **0.4 s COMMIT**: aim frozen, gold; the hum rises 200 -> 800 Hz; `Lunge` scrubbed 0 -> 0.525 s and held |
| WHIP | commit ends | after the whip -> RECOIL (or PARKED) | **0.35 / 0.30 / 0.25 s**; `Lunge` 0.525 -> 0.78 s; **lethal only inside the sphere at this instant**; emits `usher:blow {x, y, z, r}` (breaks every `blow` fixture inside: pawls, stands, brittle floors; snuffs every lamp inside) |
| RECOIL | after the whip | timer ends -> LISTEN if a toll is queued, else STAND / WALK | **3.0 / 2.5 / 2.0 s**; cannot COIL; may LISTEN; `Lunge` 0.78 -> 1.5 s slowed to the timer |
| PARKED | a WHIP whose aim was a bell in reach | a toll elsewhere -> LISTEN; N strikes spent -> the Round resumes | strikes the same bell every Recoil + Listen + Coil + Whip (3.0 + 2.5 + 2.0 + 0.35 = 7.85 s on Normal; 6.7 NM; 5.75 AB) because each blow is a bell toll; N = 3 / 2 / 1 |
| SEATED | the Evening ends (the last lamp snuffed); or Sandbox toggle | terminal until reset | Sit clip; the ring goes dark; a chair scrapes |

**Head Usher only.**

| State | Entry | Exit | Timers and notes |
|---|---|---|---|
| PULPIT | Phase A start (at d 92) | the player steps on the Well rim -> COLLAR | station 1; the throat coiled 6.75 m; never lethal in A (the rim is out of reach) |
| COLLAR | the Well rim trigger | 3.0 s -> SWEEP | the brass collar unbuttons and falls (a prop with a 1.2 s fall and a ring); `stretch` 1 -> 2.4 |
| SWEEP | collar down | 12 s -> STAND | two scripted arcs over the stalls at 6 m/s tip speed snuffing the rows; the tip is lethal (nobody is in range: the rim is 44 m away); closed-form |
| RELOCATE | Phase B done (the pawl broken and the player past G) | arrives at the tower gate -> STAND | station 2; only out of sight: the leaf's crash raises a dust cloud that hides the pulpit for 3 s; if he is still seen he waits (the Dresser's relocation rule) |
| REACH | per phase | | B 16 / 18 / 20 m (from the pulpit collar), C1 24 / 26 / 28 m, C2 32 / 34 / 36 m; `stretch` 2.4 -> 3.7 -> 5 |

**The Evening clock (closed form of the section clock `t`, reset on respawn to the phase lamp's snapshot).** Phase B, Normal, t = 0 at the Well rim: COLLAR 0-3 s; SWEEP 3-15 s; the Great Bell released at 15 s, strokes at 15 (W), 21 (E), 27 (W), 33 (E) ...; the Doorman's whip on each E stroke at stroke + 4.5 s (25.5, 37.5, 49.5 ...); W strokes are out of reach (sag-short, no whip). The Round: cluster k of tier j is snuffed at `t0_j + 6 k`; `t0_j` is the front's arrival at tier j (E19 rubber band). The Span: E19 `collapse`. The Lift: the cage `s(t) = 30 · smoothstep(t / 15)`, peak 3.0 m/s.

**Events** (bus): `toll:emit {x, y, z, loud, kind, src}`, `usher:listen`, `usher:coil {id, x, y, z, r, t}`, `usher:commit`, `usher:whip {id, x, y, z, r}`, `usher:blow`, `usher:park`, `usher:hit {id}`, `usher:seat`, `lamp:snuff {id}`, `evening:stroke`, `rope:telegraph {hand, intensity}`.

### 3.8 Fairness, difficulty and the cost of a death

| Parameter | Normal | Nightmare | Abyss | Sandbox |
|---|---|---|---|---|
| Hearing: bell / notch / chime | 60 / 42 / 18 m | 66 / 46 / 20 | 72 / 50 / 22 | as Normal |
| Listen hold | 2.5 s | 2.2 | 2.0 | 2.5 |
| **COIL (telegraph)** | **2.0 s** | **1.7** | **1.5** | 2.0 |
| Toll -> whip (Listen + Coil) | 4.5 s | 3.9 | 3.5 | |
| Whip | 0.35 s | 0.30 | 0.25 | |
| Recoil (safe window) | 3.0 s | 2.5 | 2.0 | 3.0 |
| Common Usher reach / walk | 4.5 m / 1.2 m/s | 5.0 / 1.45 | 5.5 / 1.7 | |
| Torch sphere start / lethal (Head) | 3.0 / 1.8 m (4.4 / 2.6) | same | same | drawn, never lethal |
| Head Usher reach B / C1 / C2 | 16 / 24 / 32 m | 18 / 26 / 34 | 20 / 28 / 36 | |
| SNUFF warning | 1.6 s | 1.5 | 1.5 | 1.6 |
| Front lead above you (A) | 25-40 m | 18-30 | 15-25 | off |
| Span front: base speed / target gap | 7 m/s / 22 m | 8 / 16 | 9 / 11 | replay toy |
| Parked Usher resumes after | 3 strikes | 2 | 1 | |
| The leaf's crash re-aims the Doorman | no | yes | yes | |
| Recovery rings (Well) / hooks under the deck | 3 / 4 | 1 / 2 | 0 / 0 | any |
| Lamps | all (L2-16 .. L2-19) | L2-16, 17, 19 | none (L2-1, L2-20) | all, plus warp |
| Grace after a wake (no strike) | 3 s | 3 s | 2 s | |

**Fairness rules (each is a bot assertion, §5.2):**
1. **Telegraph >= 1.5 s on every difficulty**, from sphere-on to the whip (COIL alone is >= 1.5 s; Listen adds 2.0-2.5 s).
2. The sphere is visible in the dark; it is **gold for the last 0.4 s and then never moves**; the lethal test is a 3D distance <= radius + 0.38 m (the body) at the whip instant.
3. A strike is only ever aimed at a **toll**; the player never needs to be tracked. A player who makes no toll is never struck (the SNUFF sphere, deterministic and visible 1.6 s ahead, is the only other danger).
4. **A safe line exists in every phase that makes no toll inside the Doorman's reach** (A: lifts; B: clapper tolls made from outside his reach, then iron rings; C1: iron hangers; C2: hang from the cage's outside ring). The bot checks each is completable at 75 % speed.
5. No strike within 3 s of a wake (2 s Abyss). The near-miss clamp: a whip that misses halts >= 1.2 m from the player's head.
6. Recoil is a guaranteed 2.0-3.0 s with no strike; a queued toll is answered only after it.
7. The front never kills directly; a staller is caught by SNUFF (visible) and loses.
8. Checkpoint placement (CHAPTERS §3.4): one before every phase, restore exact (E03 snapshot: lamps, the front, the Great Bell phase, the pawl, the cage); 120 s median death-free play between lamps is not exceeded (A 110 s, B 90 s, C1 60 s, C2 30 s).
9. **Cost of a death:** wake at the phase lamp in <= 10 s; the phase is restored; a **seated** stone figure of you remains (PROPOSAL: in the next empty stall seat, the first death in the empty 41st; canon-safe default: seated where you fell). Nothing else. Abyss has no phase lamps (wakes at L2-1, as its rule is).
10. Target: median <= 3 deaths per phase on Normal; a bot at 75 % of the optimal line survives each phase on every variant; a bot that stalls 3 s in the open dies at the next SNUFF or whip (Normal and Nightmare) and can still recover on a ring ahead (Normal).

**Sandbox:** no kills, falls not lethal, warp to any lamp. The torch, the coil, the whip, the blow and the Evening clock play out fully (so players learn them). Toys (unlocked by the chapter's trials, CHAPTERS §10.6): scrub and pause the Evening clock, show toll rings and spheres, park any Usher, replay the exam.

### 3.9 The audio language (what you hear first)

| Cue | Sound | Position | Use |
|---|---|---|---|
| **The rap** | three light, even knuckle raps, a pause; per-Name pitch not used | HRTF at the Usher | **the first sound of the Usher** (II-5); also its answer to a toll (Listen) |
| The keys | a jingle of a ring of keys, one note higher than the town's chimes | at the Head Usher | heard 6-10 s before he is seen; stops at COMMIT |
| The breath | a long exhale through a pipe, pitch drops when he turns away | at the ring | Listen and Recoil |
| The hum | a sine with harmonics rising 200 -> 800 Hz over the COIL | at the ring | the countdown; jumps an octave at COMMIT |
| The whip | a pipe note and a crack, then the blow | at the sphere | the stroke |
| The snuff | a soft pop, a tiny cold chime (the membrane taking the light) | at the lamp | every lamp |
| The brass chime | a small bell, bright | at the ring you bit | the toll you made (the player must hear what it hears) |
| The Great Bell | a modal bell, a tone each stroke, a sub thump | the Well | the metronome |
| The pawl | a chain ratchet, a clunk | G | the door |
| The shutter | a chain ratchet 1.5 s ahead, then iron | the Throat | the deadline |
| The chair | wood on stone, a body sitting, a sigh through a pipe | the tower | the end |
| The beds | thousands of small creaks, like a house settling; stone hands coming down | everywhere behind you | the loss (after the last lamp) |

Music (diegetic first; CHAPTERS §6.3 `cue.ch2.*`): `cue.ch2.snuffing` (A, ~110 s: the snuff pops land on its rhythm; the Lamp motif in a minor mode when the lamps below go out), `cue.ch2.span` (C1, 80 s: the collapse cascade leads), `cue.ch2.lift` (C2, 30 s: one held tone under the grinding, cut on the lamp's snuff). Phase B has **no score**: the Great Bell is the music.

### 3.10 VR comfort

- No camera movement, ever: the collar drop, the bow, the sit are in-world, the player keeps control. Movers translate the player only because they chose to hold or stand on them (the cage, the bell).
- No flash above 3 Hz; the whip's light step <= 30 % luminance for <= 120 ms; the torch pulses <= 1.6 Hz; reduced effects draws the sphere as an outline.
- The ring never enters the head volume: a whip halts >= 1.2 m short of the head; a death plays the standard muffle and fade, never the ring over the face.
- The cage and the Great Bell: no rotation, speed <= 3 m/s (cage) and <= 8 m/s (bell, chosen by the player).
- Never total black: the Mark Lamp throws a 3 m fill around the hands and a broad cone (CHAPTERS §2.4); anchors stay phosphor-marked and shape-coded in the dark.
- The Round and the Doorman are shown on a floor, at human scale, in a lit-by-themselves ring: no looming at face distance; depth is readable by the sphere.
- Captions for every cue: "[Three raps]", "[Hum rising]", "[Throat whips]", "[Ring chimes]", "[Bell tolls]", "[Chains ratchet]", "[Beds creak]".

### 3.11 Model and animation needs (reuse first)

| Need | How |
|---|---|
| Common Usher | `usher.glb` as is (28.7 k triangles, 6 draws, 34 bones). **COIL / WHIP / RECOIL are the existing `Lunge` clip, scrubbed**: 0 -> 0.525 s (draw-back, eased over the telegraph, held), 0.525 -> 0.78 s (the whip), 0.78 -> 1.5 s (the settle, slowed to the Recoil timer). `Idle`, `Walk`, `Listen` as named. No new clip for the combat. |
| New clips (small, same builder `build_usher.py`) | `Snuff` (1.2 s: the neck curls down over a lamp), `Bow` (2.5 s: the throat arcs forward in a long low curve; the hook), `Sit` (3 s: the Evening's end). 3 clips, +~20 KB. |
| Head Usher | the same GLB at **1.8x**; the throat "goes on" by **scaling Neck01..14 along their length** (`stretch` 1 -> 5: 6.75 m -> 33 m); the `Maw` ring scale as today. **Spike (half a day):** if stretched ribs look like an accordion, fall back to a procedural **throat ribbon** (an `InstancedMesh` of rib segments along a spline from the collar to a detached ring mesh), one extra draw. |
| Collar | a separate small mesh (a brass band) that detaches and falls at COLLAR; the common Ushers wear the white band as modelled; the Mere's have none. +1 call. |
| Keys | a small instanced ring of keys at the Head Usher's belt (jingle audio). +1 call. |
| Torch | an additive cone and a fresnel sphere shell (480 triangles), no real light; +2 calls. |
| LODs | LOD1 about 7 k triangles (to 30 m), LOD2 about 1.8 k (to 70 m), merged to 2 draws; the existing `simplify_glbs.mjs`. Beyond 70 m a two-quad ring glint. |
| Budget | the Round: <= 3 Ushers at LOD1 in view (42 k stereo triangles), the Doorman LOD0 (57 k), spheres and spray: about 110 k stereo on top of the level, replacing the Mason's 114 k in this exam; <= 150 calls / 350 k triangles to be measured per phase (`budget:at3d`, mock-XR, Quest tier). |

### 3.12 The escape, and what comes after

At the top of the shaft the Doorman's ring is level with the empty cage. Whip 2 lands. The master lamp, hanging from the cage's roof, goes out with a pop and a tiny cold chime; the ring flares once, brightest it has ever been. In one wave, from the tower outward and upward through the town, **every remaining light in Lamphold goes out**: the Round's rings, the last cluster, the stalls' lamps. The Evening is complete. The Doorman's throat withdraws up the shaft with a long dry rasp, and, small and clear from 30 m above, **a chair is drawn out and someone sits down**. The shutter is already moving: you swing through the Throat's mouth and it closes behind you. In the dark, with only the Mark Lamp's flame (it leans down), you hear what you did: far above, across the whole pit, a sound like a library of cards being set down, then thousands of small creaks like a house settling. **Everyone is awake.** The wrist bars read NO SIGNAL. The chapter's time keeps running into II-13, where the first 60 seconds are silent.

---

## 4. THE HOOK (II-13 THE SOOT THROAT, 1,790 -> 1,850 m, 3 min) for the full version

### 4.1 What changes from CHAPTER_II_PLAN §3, and why

The plan's hook is right: a silent, safe throat; a chain; black water; rings under it; one rears and does not strike; "III · THE MERE". Kept. Four changes make it the strongest image in the game and tie it to this chapter's rule:

1. **They answer the chain.** The chain's pawl clicks every 3 m: a bell. The Ushers of the Mere turn to the clicks, a wave across the lake at the speed of the descent. The rule the player learned for 8 minutes is the rule the hook obeys (nothing is invented at the last minute), and the player *feels responsible for the wave*.
2. **They bow.** The near Usher rears to your eye level, ring open, **the torch on you, and it never goes gold**: the first time in the chapter you stand in the light and nothing happens. Then it **bows**, and every Usher in the Mere rises and bows, throats arching over the water into an **aisle of arches** lit from within: a cathedral nave made of listening. Not a threat; an invitation, which is worse.
3. **The throats are free.** No collars. A Lamphold Usher's throat is 3.75 m; the Doorman's reached 32 m; the Mere's rise 33 m from the lake floor. "The throat goes on."
4. **A seat, not just a wait.** The card line gains a second sentence, *THE SEAT IS KEPT*, and far down the aisle, at the limit of the fog, there is one small warm light and, under it, something the size of a chair. Chapter I ended on a place cut to your shape; Chapter II ends on an aisle to a seat. **The question left open: whose seat is at the end of the aisle?**

### 4.2 The last three minutes, second by second (Normal; the player keeps control throughout)

| t | The player sees | Hears | Does |
|---|---|---|---|
| 0:00 | the Throat past the shutter: soot-glazed stone, one lamp (L2-20) in a niche, ash falling; T22; the Mark Lamp's flame leans down | silence: breath, heartbeat slowing; the beds' creak fades over 20 s; NO SIGNAL on the wrist | rest. The bag works. **Nothing hunts. The rest is never betrayed.** |
| 1:00 | a small lamp-cage platform (2 x 2 m, a rail) hangs on a chain at the Throat's lip; T23 on the rail | a low glassy tone (the Mere's preview); the chain's pawl ticks once | step on; hold the rail. The platform lowers at 1.0 m/s (translation only) |
| 1:00-1:40 | 40 m of narrowing, widening stone; ash; far below a **glint of silver**: the lamp's reflection in black water | a pawl **click every 3 m**; each click rings once in the stone | look; reach out and touch the wall if you like; you may fire the rope at it |
| 1:40 | the Throat opens into the Mere's cavern ceiling (stalactites carved as lanterns); black water to the fog's edge, perfectly still; **thousands of dark lanterns** floating like lilies | the room opens: a 6 s reverb; the clicks go small | nothing is asked of you |
| 1:50 | **a pale ring under the surface**, 15 m to the left, turns toward the platform. Then another. Then rows: Ushers standing on the lake floor 25 m down in ranks, each ring lighting the dark lantern above it from below | each click is answered by a **breath** through a pipe, nearer each time, until the Mere is a pipe organ with no player | watch the wave of turning rings cross the lake. The Mark Lamp's flame leans toward them |
| 2:20 | the platform stops 6 m above the water: **the last click, then silence** | the silence after a hundred clicks | |
| 2:25 | the throat of the nearest Usher rises from the water 2 m to your left, 6 m above the surface, and stops with the ring open at your eye height, **the pale sphere on you**. It does not go gold. | the breath; no hum | the whole chapter says *leave the light*. You can: jump (the water catches you; CHAPTERS III-1's first non-lethal fall; the card plays as you splash). Or stay |
| 2:35 | it **bows**: the throat arcs forward in a long low curve, the ring dipping toward the water. All around, throats rise from the lake and bow, arching into an aisle of arches over the water that leads away into the fog | a held, wordless, voice-like note: the Lamp motif's five notes, whole, unaccompanied | |
| 2:45 | far down the aisle, 180 m away, **one small warm light** (the only lamp in the Mere that nobody lit) and under it a shape the size of a chair | the note holds | |
| 2:50 | carved letters rise out of the dark, world-locked at 3 m: **III · THE MERE**; under them, smaller: *THEY HAVE WAITED SINCE THE FIRST LAMP. THE SEAT IS KEPT.* | no voice | |
| 3:00 | the end card (§4.3); the sim is in a pause state (no camera move; head tracking continues) | a held chord | choose |

The card appears at the first of: the bow completing; 25 s after the platform stops; a splash (a jump). The line is the plan's own (*They have been waiting since the first lamp.*) plus the seat; the plan's line alone is the fallback if the owner prefers.

### 4.3 The end card and the call to action (a carved stone panel at hand height; the aisle behind it; store wording, not pushy)

> **II · LAMPHOLD · 1,250 m**
> {your time} · *Woken N times.* (or *"Woken 0 times. Nobody had to show you in."*) · Names x / 5
>
> *The lamps are out. Everyone is awake. Something is showing you the way down.*
>
> **III The Mere · IV The Keeping · V The Still Flame.** *Three chapters. 1,520 more metres down, 240 back up. About an hour and three-quarters.*
>
> **[ Continue the descent: {price} ]**  ·  [ Replay Chapter II: Normal / Nightmare / Abyss ]  ·  [ Menu ]
> *One purchase unlocks Chapters III to V. Everything you have earned stays.*

- `{price}` is the localised store string (`getDetails()`, E06), never hard-coded. Outside a store install: the button reads *"The full descent is on the Meta Horizon Store"* and does nothing else (RELEASE §10.6).
- The purchase starts **synchronously inside the XR `select` handler** of the hand pointing at the button (T11). While the system dialog is up the game is paused; nothing can kill you behind it. On success the panel crumbles and the platform resumes lowering into the Mere (Chapter III begins with no loading screen). On cancel the panel returns.
- No countdown, no discount badge, no red dot, no "limited time"; one button; the panel never covers the aisle. The menu and chapter select show the same offer on the locked tiles.
- **Assumption to confirm (CHAPTER_II_PLAN §1):** Chapters I and II free, III-V the full version (`FREE_CHAPTERS = 2`). If Chapter II is instead paid, this card moves to the end of Chapter I and Chapter II ends on the line above with no button.

### 4.4 What the hook answers, and what it leaves

It answers the question the player has carried since the first Mason glimpse and since the owner's video: what are these things (a second species, an office, a custom: they answer bells and put out the lights), and it shows the numbers (a lake of them). It leaves one question, deliberately: **whose seat?** (Team answer, never printed before III-2: it is a bowl, and the bowl is for the Mark Lamp: the Ushers are showing a lamp to its seat. That is ending A's shape, and Chapter III's altar and *Lampless* trial are its payoff.)

---

## 5. BUILD PLAN

### 5.1 Work packages, in order (each ends with the harness green; sizes are person-weeks for a small team; the plan's C2-0..C2-5 keep their numbers)

| WP | What | Size | Files it touches | What proves it |
|---|---|---|---|---|
| **C2-0** | Chapter framework remainder: `Game` loads `Level3D(chapterData[n])`, the chain from Chapter I (E04 seam), per-chapter saves / splits / medals, chapter picker, `FREE_CHAPTERS` | 2 | `src/game.js`, `src/meta/save.js`, `src/sim/splits3d.js`, `src/ui/ui3d.js`, `src/data/chapter2-data.js`, `verify/chapters.mjs` (ch2 entry) | Chapter I unchanged (`npm run test:at3d`, `npm run verify:at3d` baseline 3167 and the hashes); `tests/release/test-save.mjs` per-chapter slots; `tests/level/chapter2.mjs`; a stub Chapter II loads, plays, saves, resumes |
| **C2-1a** | **Machines:** mover kinds `lift`, `path` (loop / pingpong), `pulled`, `driven`, `steps`, `escapement`; per-mover `maxSpeed` up to 13 (Chapter I keeps 1.5); E16 carry, relative impact, crush, `cutsRopes`; `timeScale` ramp; anchor flags `toll`, `blow`, `haul`; V1 checks | 4 | `src/sim/movers3d.js`, `physics3d.js`, `level3d.js`, `objectives3d.js`, `verify/machines.mjs` | `tests/objectives/machines.mjs` (extended); new `tests/physics/liveanchors.mjs` (a 13 m/s arrest with the elastic catch <= 1.12 L, release keeps absolute velocity, carry, relative landing, crush); closed form vs integrated within 1 mm; V1: speed <= 13, crush clearance >= 1.2 m or tagged with a >= 1.5 s telegraph |
| **C2-1b** | **Senses and the Mason's path:** `volumes3d.js` (`safeLight`, `mask`, `hush`), `noise3d.js` (E11: hearing `noise`, masking, rope telegraph), E17 `path` / hidden / breach / the Stopping, `fronts3d.js` (E19 `snuff`, `collapse`) | 3 | new `src/sim/volumes3d.js`, `noise3d.js`, `fronts3d.js`; `creature3d.js`; `game.js` | new `tests/creature/path.mjs`, `safelight.mjs`, `noise.mjs`, `tests/objectives/fronts.mjs`; Chapter I `legacy` hearing identical; `pacing.mjs` extended |
| **C2-1c** | **Graybox II-1..II-11 as data** (replaces the generated stair beat by beat; the stair stays as filler between authored set-pieces), the 20 lamps, Names, routes (fast / safe), Holdfast and Dresser sites | 4 | `src/data/chapter2-data.js` (authored per beat), `verify/routes-ch2.mjs`, `src/data/par-3d.js` | bots clear every beat on both lines, all three variants; movers <= 13 m/s; `tests/level/chapter2.mjs` extended (beat table, lamps, Names, depths) |
| **C2-2** | Lamphold kit art, lamp-field with the `lit` attribute, the three themes, the Winding Floor, the Span, the cage | 5 | `render/levelView.js`, `render/lighting.js`, `tools/.../build_env_kit.py`, `render/atmosphere.js` | Quest budget per beat (<= 150 calls, <= 350 k stereo triangles): `npm run budget:at3d` |
| **C2-3a** | **The Usher sim:** `usher3d.js`, the toll bus, authored node graphs (A*), SNUFF, the Evening clock, PARKED | 3 | new `src/sim/usher3d.js`, `src/sim/tolls3d.js`; `game.js` wiring | new `tests/creature/usher.mjs`, `usher-pacing.mjs` (§5.2) |
| **C2-3b** | **The Usher in game:** `render/usherView.js` (GLB, LODs, clip mapping, collar, keys, throat stretch), the torch, the audio and captions | 3 | new `src/render/usherView.js`, `torchView.js`; `src/audio/audio3d.js`; `ui/captions.js`; `tools/.../build_usher.py` (+ `Snuff`, `Bow`, `Sit`), `simplify_glbs.mjs` | `tests/render/test-glb-usher.mjs` (7 clips, bones unchanged), new `tests/render/test-usher-view.mjs` (LOD table, calls), `budget:at3d` |
| **C2-3c** | **The Evening (II-12):** an `evening` objective (phases, pawl, gate, clappers, cage, shutter, the last lamp), the fronts as data | 3 | `src/sim/objectives3d.js`, `src/data/chapter2-data.js`, `verify/boss.mjs` | new `tests/objectives/evening.mjs`; `verify/boss.mjs` (§5.2) |
| **C2-3d** | **The Tolling Gallery (II-9):** the scripted `UsherSight` actor, the Tenor `blow` fixture, the bells | 1 | `src/sim/usher3d.js`, data | `tests/objectives/verbs.mjs` extended (bells), a bot rings five bells and is never within reach + 3 m |
| **C2-4** | **The hook:** the platform sequence, the Ushers' wave and bow, the card, `entitlement` wiring, the store link | 1.5 | `src/game.js`, `src/ui/ui3d.js`, `src/meta/entitlement`, `src/data/chapter2-data.js` | `tests/release/test-entitlement.mjs` (nine scenarios + the card); played by hand on a headset |
| **C2-5** | Music and ambience, the radio script, polish, the playtest gate (>= 10 first-time VR players, median 60-70 min, <= 3 median deaths per phase) | 3 | `src/audio/music3d.js`, `comms3d.js` | the gate, §5.2 |

About 32 person-weeks; with 3-4 people in parallel, 9-11 calendar weeks to a content-complete chapter and a polished one in the plan's 16-18 weeks.

### 5.2 How the bots prove the boss is fair

1. **Data checks (V1, `verify/boss.mjs`, no play):** every `toll` ring in II-12 has an iron alternative on the same transfer; every id in the Evening data resolves (G, pawl, clappers, bell-wires, the cage, the shutter); the sphere of every **scheduled** strike (the Great Bell's east stroke, the cage whips) never contains a waking lamp, a recovery ring or a landing; the Usher node graph never comes within reach + 3 m of a player-reachable point in II-9; the cage and the shaft leave >= 3.3 m of outside-ring room; no `safeLight` overlaps a crush zone.
2. **Telegraph audit (every run, every variant):** for each `usher:coil` / `usher:whip` pair: `whip.t - coil.t >= 1.5 s`; the sphere centre at `usher:commit` equals the centre at `usher:whip`; a whip that misses stops >= 1.2 m from the head; Recoil >= 2.0 s with no `usher:coil`; no strike within the grace (3 s / 2 s) of a wake; **a strike's cause is always a recorded `toll:emit` or a recorded SNUFF sphere** (the "a player who makes no toll is never struck" rule is a trace assertion).
3. **Line bots:** the safe and the fast line of each phase, from **6 start phases of the Evening clock**, at **75 %, 100 % and 125 %** of the optimal speed, on Normal / Nightmare / Abyss: all pass (survive, every landing < 0.85 of lethal). A **stall bot** (stops 3 s in the open at fixed points) must die at the next SNUFF or whip on Normal and Nightmare in A and C1, and on Normal must still be recoverable on a ring ahead in B and C2 (CHAPTERS §3.1 rule 10). A **toll-spam bot** dies; a **silent bot** (iron rings only, no clapper) completes A, C1, C2 on Normal and dies in B only at the Well's east half if it tolls there.
4. **Pacing sims (`tests/creature/usher-pacing.mjs`, scripted players, like `pacing.mjs`):** 1,000 random landings, yanks, wall hits, jolts and reels produce **zero** Usher reactions (it hears bells only); the hearing ranges per source; masking (a chime inside a crash is not heard); aim = source + velocity x (Listen + Coil) for the cage and the chandeliers; the reach clamp and the sag-short; PARKED loops exactly N strikes; the `blow` breaks the Tenor stand and the pawl, and snuffs the lamps in the sphere; determinism (same toll log, same events) and V13 (an intent-log replay reproduces the Usher events hash).
5. **Budget:** `npm run budget:at3d` with the Round at LOD1 and the Doorman at LOD0 in the worst Phase A and Phase B views; the sim p99 <= 2.5 ms.
6. **Human gate (CHAPTERS §13):** after II-9, >= 70 % of testers can say what the Usher answers; <= 3 median deaths in each of A, B, C; nobody cites the sphere as unreadable; the Usher on screen <= 12 % outside II-12 and <= 35 % inside it (its telegraph must be seen).

### 5.3 Top risks and mitigations

| # | Risk | Mitigation |
|---|---|---|
| 1 | **Engine breadth.** The chapter needs five unbuilt systems at once (toll bus, mover kinds up to 13 m/s, fronts, volumes, creature path) and the E10 knock gesture | build the vertical slice first (§5.5); each system is pure and Node-tested alone; E10-dependent beats have a body-strike fallback |
| 2 | **Mover speed 1.5 -> 13 m/s.** Every V1 check, bot assumption and Chapter I regression rests on the 1.5 cap | per-mover `maxSpeed`; Chapter I data keeps 1.5; a Chapter I full regression gate on C2-1a |
| 3 | **The Head Usher's 33 m throat on a 3.7 m rotation-only bone chain** | the half-day spike (bone-length scaling) with the instanced ribbon as the fallback; the cut-list fallback is a fixed 6.75 m throat with a closer pulpit |
| 4 | **Telegraph readability in the dark in VR.** A sphere of light must read for depth at 15-30 m on Quest | headset prototype by week 3 of C2-3b on the graybox; fallbacks: a line from ring to sphere, a floor decal, a larger start radius |
| 5 | **Comprehension of the pawl and clapper puzzle** (B). A first-time player may not see "toll G's bell so he breaks the door" | II-9 teaches every verb (park, blow, bell-wire) in safety; Normal's crash is silent; one hint at II-9 (*"Bells call it."*); playtest; fallback: the leaf drops on the first toll at G from anyone |
| 6 | **1,250 m in one `Level3D`:** lightmap / GI atlas, culling bands, save tables, bot run time | measure in C2-0; per-beat packs; the lamps are emissive (CHAPTER_II_PLAN §5) |
| 7 | **Quest budget:** 28.7 k triangles per Usher, the lamp-field, the tiers and chandeliers in one view | LOD1 / LOD2 are required, not optional; the Mason's 114 k stereo is freed in II-12; gate per phase |
| 8 | **Canon and tone drift:** the Ushers snuff instead of the Mason; the Lamplighters' stalls echo the forty; the text budget | the owner decisions in §5.6; every new lore line is marked PROPOSAL; the boards obey DARK_STORY_BIBLE §1.1 |
| 9 | **Pillar 3 with passive spectacle** (collar drop, sweep, bow, sit) | the player keeps control during all of them and is out of reach; none uses a camera move |

### 5.4 Cut list, in order, if time runs short

1. The Lamplighters' stalls (40 + the empty seat), T13, T19 and the "seated in the empty seat" remnant exception. 2. The Dresser in II-6. 3. The re-light loop in II-11. 4. II-8's houses (keep the governor). 5. II-4 shrinks to 1.5 min. 6. Brass-ring tolls (keep bells, clappers, machine notches; the chime becomes sound only). 7. Phase A's clappers and parking (keep the front and SNUFF). 8. The throat stretch (fixed 6.75 m, pulpit moved to 10 m from G, reaches 12 / 14 / 16). 9. The hook's aisle (keep the rear, the bow of one, the title and the card). **Never cut:** II-9 (it teaches the rule), the Phase B pawl puzzle, the last lamp and the shutter, the hook's rings, the true rest.

### 5.5 What ships first (the vertical slice, "the Doorman slice")

Build **II-1, II-3, II-9, II-12 and II-13** with the existing graybox stair as filler between them (about 20-25 minutes): the warm start and the live-anchor test (the rule), the Usher's teaching scene (the villain, the torch, the parked loop, the blow), the exam with the Evening clock (Phase A on one tier, B and C complete) and the hook with its card. It needs C2-0 (minimal: `?chapter=2` already exists), C2-1a (pendulum cap, `lift`, `path`, `pulled`), C2-3a/b/c/d and C2-4, and nothing else. It answers the four questions that could sink the chapter before the other eight beats are built: does the torch read in a headset, does the rule teach in 4 minutes, is the pawl puzzle solvable by a stranger, does the hook land. Ship it on a headset at the end of week 8-10, with the hook also playable standalone (`?hook=1`) for the store trailer.

### 5.6 Decisions needed from the owner

1. **Ushers, not the Mason, perform the Snuffing** (§0.2 item 3). 2. **Free / paid line:** Chapters I-II free, III-V paid (CHAPTER_II_PLAN §1). 3. **The Lamplighters' stalls and the empty seat** (the forty-one echo, T13 / T19) and whether an Usher's victim is seated in the empty seat (breaks "where it fell", CHAPTERS §2.1 rule 2). 4. **The card line:** *THEY HAVE WAITED SINCE THE FIRST LAMP. THE SEAT IS KEPT.* or the plan's single line. 5. **The Dresser in II-6.** 6. **Names:** N2-5 moved to the Stone Yards. 7. **Text budget** per chapter (about 250 words).

---

## 6. AUDIO AND MUSIC CUES (diegetic first; the style and ids of CHAPTERS §6.3, ART_AUDIO §5)

Rooms (ART_AUDIO §5.1): Lamphold 4 s warm; the Winding Floor 2.5 s metallic; the Tolling Gallery 4 s with an inside-the-bell 1.2 s for the nine bells; the Mere 6 s. Priority (ART_AUDIO §5.1): creature > knocks and bells near you > movers (<= 8 nearest) > ambience one-shots. The radio ducks under the cave, never the reverse.

| Beat | Diegetic, first | Bed and stem | Cue and silence |
|---|---|---|---|
| II-1 | lamp-chain chimes; three thousand tiny flames as a soft chorus; a timber creak; a heavy knock far below | `amb.ch2.lit`; `mus.ch2.stems` Calm, the Lamp motif hidden in it | the first chime on the chandelier's apex is the chapter's first musical note |
| II-2 | doors knocking back (two taps, a third from the house); the counterweight's four loud ratchet notches; knocks in the wall | `amb.ch2.lit`, Calm | the cage's arrival is a soft gong |
| II-3 | each chandelier's chain creaks on its period; each apex chimes at a different pitch (the pit is a chord) | Calm -> Pressure on the fast line | the fast line is a melody; the safe line is a pad |
| II-4 | 600 lamps humming; a tally "tick" as each plate passes; a long reverb | Calm, nearly silent | rest: no radio; one far pop at the exit |
| II-5 | crane chains; trolley wheels on rail; the load's ratchet; **three light even raps** (the Usher) | Pressure | the raps are followed by 2 s of nothing |
| II-6 | saw whine 1.5 s ahead; plaster cracking and a dust fall; the breach: a dry tear; the fronds' chitter at the edge of the light | Pressure; a held cluster at the breach | silence when it withdraws |
| II-7 | gongs; the cage's wind; the Mason's knocks **climbing** the shaft wall (the count is the clock) | short Peak locked to the drop | the express's roar is the music |
| II-8 | the houses' chains creaking on an 8 s cycle; the governor's whir; the rope buzz in the hand; the Mason scraping the outer wall | Pressure | the buzz precedes the sight |
| II-9 | nine bells with modal tones pitched by size; the three raps; the ring's breath; the hum; BONG; the Tenor's long falling clang | **no score**: the bells are the music (the motif on the fifth) | the Usher's walk away down the stairs is the only footstep |
| II-10 | the engine *is* the bed: wheel groan, escapement clack every 1.2 s, hammers every 4 s | `amb.ch2.engine`, music locked to the hammer tempo | `sil.ch2.stopping`: everything stops over 1.2 s; breath, heartbeat, its chitter; three raps; then `cue.ch2.runaway` (Peak at 1.6x) |
| II-11 | lamp-hiss and the soft pops behind you; the Round's distant pops; ash; the Mason dragging | music thinned to low brass embers; the motif in a minor mode | no radio but one line |
| II-12 A | keys, the pops, the dips; the hum at a SNUFF sphere | `cue.ch2.snuffing` (~110 s), pops on its rhythm | the front is the beat |
| II-12 B | the collar's brass ring rolling; the Great Bell's stroke every 6 s; the hum; the pawl; the leaf's crash | **no score** | the Bell is the metronome; Recoil is a long breath |
| II-12 C1 | the Span's creak, the 0.7 s dust warning, the crash cascade, trolley wheels on the under-rail, brass chimes | `cue.ch2.span` (80 s) | the groan leads the cascade |
| II-12 C2 | the cage's gongs; the hum; the whip; the pop of the master lamp; the shutter's ratchet | `cue.ch2.lift` (30 s), one held tone | cut on the lamp's snuff; then everything cuts; a thousand small pops in two seconds; the chair; the creak of the beds |
| II-13 | breath, heartbeat, ash | `sil.ch2.soot`: 60 s of silence, then Calm; a glassy high tone | the pawl clicks and the Ushers' breaths; the bow: one wordless voice-like note, the five motif notes whole; a held chord under the card |

---

## Appendix A. IDs and data (follows CHAPTERS Appendix A)

| Thing | Id |
|---|---|
| Fronts | `ch2-front-snuff` (E19 `snuff`), `ch2-front-span` (E19 `collapse`) |
| Movers | `ch2-mov-chand-1..5`, `ch2-mov-express-g/b/a`, `ch2-mov-bell` (the Great Bell), `ch2-mov-cage`, `ch2-mov-trolley-1..3` |
| Ushers | `ch2-usher-head`, `ch2-usher-t1..t5`, `ch2-usher-sight-9` (II-9), `ch2-usher-sight-11` |
| Fixtures | `ch2-fx-tenor` (`blow`), `ch2-fx-pawl-g` (`blow`, `bell`), `ch2-fx-clapper-w/n`, `ch2-fx-clapper-t1..t5`, `ch2-fx-gate-g`, `ch2-fx-shutter`, `ch2-fx-lever` |
| Volumes | `ch2-vol-lit-*` (`safeLight`), `ch2-vol-din` (`mask`), `ch2-vol-hush-throat` |
| Beats | `ch2-beat-stopping`, `ch2-beat-collar`, `ch2-beat-lastlamp` |
| Seam | `seam-1-2` (Chapter I's end), `seam-2-3` (the platform into the Mere) |
| Audio | `amb.ch2.lit`, `amb.ch2.engine`, `sil.ch2.stopping`, `cue.ch2.runaway`, `cue.ch2.snuffing`, `cue.ch2.span`, `cue.ch2.lift`, `sil.ch2.soot`, `sting.ch2.rap`, `sting.ch2.bow` |

New data lists (all variant-filtered by `omitIn` / `onlyIn`, `by[difficulty]` overrides, like the shipped lists):

```js
ushers:      [{ id: 'ch2-usher-t3', kind: 'round', graph: 'g-t3', start: 'n0', collar: true, tier: 3,
                by: { nightmare: { snuffEvery: 5 }, abyss: { snuffEvery: 4 } } },
              { id: 'ch2-usher-head', kind: 'head', stations: [{ id: 'pulpit', x: 16, y: -1132, z: 8 }, { id: 'gate', x: 0, y: -1160, z: 20 }],
                reach: { B: 16, C1: 24, C2: 32 }, by: { nightmare: { reach: { B: 18, C1: 26, C2: 34 } } } }],
usherGraphs: [{ id: 'g-t3', nodes: [{ id: 'n0', x, y, z }], edges: [['n0', 'n1']] }],      // authored, <= 40 nodes, no climbing
fixtures:    [{ id: 'ch2-fx-pawl-g', kind: 'blow', bell: true, minSpeed: 3.5, drops: 'ch2-fx-gate-g' },
              { id: 'ch2-fx-clapper-w', kind: 'clapper', anchorId: 'ch2-a-clapper-w', wireTo: 'ch2-fx-pawl-g', yank: 1.2 }],
anchors:     [{ id: 'ch2-a-chand-3', kind: 'ring', toll: 0.35 /* brass */, mount: 'mover' }],
```

Tests named in this document are the proposals of §5.1; the existing ones they extend are `tests/level/chapter2.mjs`, `tests/render/test-glb-usher.mjs`, `tests/objectives/machines.mjs`, `tests/objectives/verbs.mjs`, `tests/creature/pacing.mjs`, `tests/release/test-save.mjs`, `tests/release/test-entitlement.mjs` and the `verify/` bots.
