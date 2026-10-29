# DARK STORY BIBLE: THE FITTING (the purpose at the bottom, and the voice that gets you there)

1. **The bottom:** behind the Still Lamp at 556 m, a place is cut into the last wall in **your exact shape and height**, lantern up in the left hand, launcher down in the right: the pose you climbed in. XLI over its head; the nine menders' heights marked beside it, all too short. Last line of Chapter I: **MEASURED FORTY TIMES. CUT ONCE. IT FITS NOW.**
2. **Why (team only):** the Still Flame lends light. A light goes up only while one whole person stands in it below (the Still One). In 1791 Hesper Vell carried the Ember up and left the place empty; by morning the walls were walking (the Mason). The Ember dims because the debt is due.
3. **Perennial knows.** The brief says "bring back a kindling"; the work order says PLACE. Forty Wrens refused. "Highest Continuity fidelity on record" means **he fits**. You were sent to be kept down, at last.
4. **Every shipped system already serves it:** the Dresser measures the whole (it cut the place to you), the Mason drives the hurt down, the grate that "saved" you shut you in, health regeneration makes you whole again.
5. **Voice:** BOARDS (the Keepers' receipts), BLOOD (the nine, first person), THE FRESH CUT (something still measuring), RADIO (Perennial: procedure, euphemism, slips). Every text asks a question and refuses to answer it.
6. **Ten hook patterns** (§1.6): failure receipts, impossible durations, instructions that admit a past, corrections, ledgers, gouges, names without people, questions answered with questions, apologies, the measure.
7. **Shipped now:** +51 boards in a new non-decor channel (bake, lightmap / GI hashes, verify baseline untouched), +20 blood (41), 5 subtitles, 6 hint tails, 3 death lines, tagline, victory teaser, the chamber (figure, last line, floor, ceiling, ledger, 2 blood).
8. **The question the player leaves with:** *who measured me, and what did the other forty do instead?*
9. **For a modeler** (§5): THE FITTING (niche scaled to the player's calibrated height + 40 chalk outlines) and the Kneeling One (W-40) facing it: about +2 draw calls.
10. **For the comms owner** (§4.3): 11 lines; the last is off-mic and clean, in a dead zone that suddenly has five bars: *"He fits now."*
11. **Second playthrough:** 10 lines that change meaning once you know (§3.2). Open questions with my recommendations: §7.

Where the texts live: boards `src/data/board-writing-3d.js` (render `src/render/boardWriting.js`), plaques `src/data/level-data-3d.js`
(`dec('plaque' | 'tablet')`, canon lines kept word for word), blood `src/data/blood-writing-3d.js`, UI copy `src/ui/ui3d.js`, radio
`src/sim/comms3d.js` (owned by the comms owner; spec only here). Canon: [CHAPTERS.md §2](../CHAPTERS.md), [FUTURE_STORY_PLAN.md
§1, §5](FUTURE_STORY_PLAN.md), [STORY.md](STORY.md), [DRESSER.md](DRESSER.md), [COMMS.md](COMMS.md).

---

## 1. THE VOICE

### 1.1 Rules for every register

1. **The receipt, never the purchase.** Every text is a shard of a record whose missing part is the horror. The player gets the
   count, the duration, the instruction, the correction: never the event.
2. **One question each, never answered.** Each text must make the player stop and think *what did they do / what did not work /
   what took two years / who is that for*. If a line answers its own question, cut the answer.
3. **Never explain the mechanism on a wall.** No "copy", "restore", "original", "Still Flame keeps", "Continuity". The words that
   matter are ordinary: *kept, whole, measured, paid, fits, place, down*.
4. **The specific is the horror.** A number (4,111), a unit (FOURTEEN HANDS AND A KNOCK), a name (BRAM), a domestic object (a ring,
   a rope tied off from above), a body part (HALLAM'S HANDS). Never adjectives of fear.
5. **Tired, real, grammatical.** Every line could have been cut by a real mason at the end of a real shift, or written by a real
   person bleeding: strange, but a sentence. Read time 3-8 s: a board <= 18 words (most 8-14), a blood writing 3 x 24 characters,
   a radio line <= 6 s.
6. **No cheap shock words.** Never *horror, evil, demon, scream, blood-soaked, abyss, doom, nightmare*; never gore for its own sake.
   The darkest lines in this bible contain no violent word at all (*FORGIVE THE SMALL STONES IN THIS COURSE*).
7. **Mechanics stay true.** A text may sound insane but never lies about a rule (*IF YOU HEAR TICKING, YOU ARE WHOLE. BE LESS WHOLE.*
   is the Dresser's gate, exactly). A hint's instruction stays first and unchanged in meaning; the dark tail follows.
8. **Three gaps make dread:** the missing subject (passive voice: *IT WAS REBUILT WITH THOSE IT FELL ON*), the missing reason
   (an instruction with no why: *COUNT THE STATUES ONCE*), the extra one (a count that is one off: *LAMPS PAID FOR: 4,111*).

### 1.2 BOARDS: the Keepers (carved; always on)

**Who:** an order that kept records for four hundred years and kept failing. Monastic, municipal, exhausted. *WE* without a
roster, *IT* without an antecedent, *THEY* without names. Formal capitals. **What they sound like:** a ledger that does not balance,
a maintenance note, a standing order, a dedication, a correction by a later hand.

Tools: passive with the agent removed · ledger columns (*LAMPS LIT: 4,112. LAMPS PAID FOR: 4,111.*) · durations (*IT TOOK TWO
YEARS ...*) · *AGAIN / STILL / ONCE / NEVER* · units that should not apply (*HANDS, KNOCKS, COURSES*) · ~strike-throughs~ (a
second generation correcting the first) · #gouges# (a word chiselled out: you see its width) · tallies · names used as places.

Forms (render/boardWriting.js styles): **plate** (a dark slate plate set into the wall, the plaques' look), **cut** (letters cut
straight into a wall, floor or ceiling), **scratch** (scratched by a hand, not a chisel: tallies, the iron perch).

### 1.3 BLOOD: the nine menders (opt-in; reality)

First person, flat, specific. Days, counts going down, names, the one detail a person would actually notice (a ring, a step, a
face on a statue). Their sentences are attempts: *WE TRIED X. IT DID NOT.* They answer the boards' questions **wrongly first**
(they think they are mending; then feeding; then they learn they were *tried on*) and the chamber gives the last answer:
*WE ALL STOOD IN IT. NONE OF US FIT. IT IS CUT FOR YOU.* 3 lines of <= 24 characters of `A-Z 0-9 . , ' ? ! -`.

### 1.4 THE FRESH CUT: the hand that is still measuring (new register)

Pale new-cut stone with chalk dust (style **fresh**), the same hand as the Dresser's chalk lines in your head (`LINES_CHALK`,
`LINES_MEASURE`: *SIX HANDS TALL · MEASURE TWICE. CUT ONCE. · HOLD STILL. I AM MEASURING.*). Short, practical, a craftsman's
verdicts: *MEASURED HERE: FOURTEEN HANDS AND A KNOCK. NOT YET.* · *TOO SHORT. TOO WIDE. TOO AFRAID. NEXT.* · *MEASURED FORTY
TIMES. CUT ONCE. IT FITS NOW.* It appears only three times before the chamber (S3, S6, the throat's foot), and it is the only
voice that is **recent**. Players who notice that the cut is fresh in a 500-year-old shaft have found the first thread.

### 1.5 RADIO: Perennial (spoken; owned by the comms owner, see COMMS.md)

Procedure as tenderness, tenderness as procedure. *Restore, relay, fidelity, staging, read, standby.* Never *die* (*event*), never
*copy* (*restore*), never *body* on air (the hot mic says it). Slips that admit a past (*louder than last time*, *same as always*).
Technically true sentences (*nobody has been lowered through the Cap*). The radio is the only register that **lies**, and only by
omission: when the cave asks a question, Perennial answers with a procedure.

### 1.6 The hook patterns (10 x 3; the bold ones are in the build)

| # | Pattern | What it does to the player | Examples |
|---|---|---|---|
| 1 | **The receipt of failure** | *What did they try? Why did it fail?* | **THE NINTH WAS SEALED THREE TIMES: WITH LIME, WITH IRON, WITH THE NINE.** · **WE TRIED SALT, THEN SONG, THEN SILENCE. SILENCE WAS WORSE.** · **WE TRIED TO KILL IT. YOU CANNOT KILL A WALL. WE APOLOGISED TO IT.** |
| 2 | **The impossible duration** | *What takes two years? What fills in three days?* | **IT TOOK TWO YEARS FOR THIS ONE COURSE TO FINISH SETTLING. DO NOT LEAN ON IT.** · **THE THROAT WAS CUT IN FORTY YEARS. IT FILLED IN THREE DAYS.** · **THE GEAR WAS TURNED BY HAND FOR SIX YEARS. THEN IT WAS TURNED FROM INSIDE.** |
| 3 | **The instruction that admits a past** | *Who did it last time, and what happened?* | **DO NOT BUILD THE SECOND STAIR AGAIN.** · **COUNT YOURSELF AT THE LAMP. COUNT AGAIN AT THE BOTTOM.** · **DO NOT CALL UP THE SHAFT. IT IS FARTHER THAN IT WAS.** |
| 4 | **The correction** (a later hand) | *Who changed the record, and why?* | **~WE FED IT.~ NO. WE WERE FED.** · **~DO NOT LISTEN.~ LISTEN. IT IS THE ONLY WARNING YOU WILL GET.** · *HERE REST ~NINE~ TEN.* |
| 5 | **The ledger** | *What is the one that does not balance?* | **LAMPS LIT: 4,112. LAMPS PAID FOR: 4,111.** · **ROPES LOWERED: 38. ROPES RETURNED: 38. RETURNED EMPTY: 37.** · **THE CAGE CAME UP FORTY-ONE TIMES. IT WENT DOWN FORTY-TWO.** |
| 6 | **The gouge** (a word chiselled out) | *What word was so bad they cut it out?* | **WHAT WE #DID TO THEM# HERE, WE DID WITH LOVE.** · *THE FIRST WAS #...# BY HER MOTHER.* · *DO NOT #...# THE STILL ONE.* |
| 7 | **The name without a person** | *Where is Bram?* (under you) | **THIS FLOOR IS BRAM AND HIS BROTHERS. WALK SOFTLY.** · **ONE STATUE HAS HOB'S FACE. HOB IS ALIVE. I WENT AND CHECKED.** · **I FOUND MY MOTHER IN THE THIRD COLUMN. I KNEW HER BY HER RING.** |
| 8 | **The question answered with a question** | The answer is worse than the question | **WHERE DO THE FALLEN GO? WHERE ELSE WOULD WE PUT THEM?** · **WHO LIT THIS LAMP? WHO IS STILL HOLDING IT?** · *WHY DO YOU THINK YOU WERE SENT? WHY DO YOU THINK YOU WOKE?* |
| 9 | **The apology** | *Sorry for what?* (re-reads on the second run) | **FORGIVE THE SMALL STONES IN THIS COURSE.** · **THE LATE ARE NOT PUNISHED. THEY ARE USED SOONER.** · *WE MEANT TO COME BACK FOR THEM. THE LAMPS WERE CHEAPER.* |
| 10 | **The measure** (the motif of the bottom) | *Measured for what? Who is tall enough?* | **MEASURED HERE: FOURTEEN HANDS AND A KNOCK. NOT YET.** · **TOO SHORT. TOO WIDE. TOO AFRAID. NEXT.** · **KEEP YOUR ARMS AS THEY ARE. IT IS CUT THAT WAY.** |

More lines in the build, by pattern: the instruction (*IF YOU WAKE HERE AND DO NOT REMEMBER THE CLIMB DOWN, THERE WAS NONE.* ·
*REST UNDER THE LAMP. DO NOT REST LONGER THAN THE LAMP.* · *KNOCK ONCE: WE ARE HERE. KNOCK TWICE: WE ARE COMING. NEVER KNOCK
THREE.* · *THE STAIR HAS 1,440 STEPS. COUNT THEM. IF YOU COUNT 1,441, STOP.* · *THE STATUES FACE THE LAMP. IF ONE DOES NOT, TELL
NO ONE WHICH.* · *IF YOU HEAR TICKING, YOU ARE WHOLE. BE LESS WHOLE.*), the receipt (*THE CAP WAS SET IN LIME SO THAT NONE WOULD
FOLLOW. NONE HAVE COME THROUGH IT.* · *THERE WAS A THIRD WAY. IT WENT UP. WE FILLED IT.* · *THE GALLERY WAS CLOSED FOR NINE YEARS.
WHEN IT WAS OPENED THE COUNT WAS HIGHER.* · *THIS LAMP WENT OUT ONCE. WE DO NOT SPEAK OF THE WEEK THAT FOLLOWED.* · *HE KNOCKED
BACK. HE IS THE KEYSTONE NOW.* · *SHE CARRIED IT UP IN THE NIGHT. SHE LEFT THE PLACE EMPTY. BY MORNING THE WALLS WERE WALKING.*),
the ledger (*THE VAULT HOLDS NINE THOUSAND. IT WAS BUILT FOR SIX.* · *WE COUNTED THE KNOCKS FOR ELEVEN YEARS. THEY ADD UP TO A NAME.*
· *NINE WENT DOWN. NINE WERE COUNTED IN THE WALL. ONE OF THE NINE WAS NOT OURS.* · *ONE LIGHT UP. ONE STILL ONE DOWN. THE BOOKS MUST
BALANCE.* · *EACH COLUMN IS A FAMILY. THE TALL ONE IS STILL GROWING.* · *I TO XL: NOT YET. XLI:* · the bare tally of forty strokes),
the name and the place (*IT DOES NOT HUNT THE WOUNDED. IT GATHERS THEM.* · *WE TRIED TO NAME IT. IT HAS TOO MANY.* · *THE NAVE WAS
NOT DESIGNED. IT IS WHAT WAS LEFT WHEN WE STOPPED ADDING.* · *THE SPIRE POINTS HOME.* · *THE GRATE IS NOT TO KEEP IT OUT.* · *FOR
THE ONE WHO COMES DOWN WHOLE.* · *THERE IS NO STAIR UP. THERE NEVER NEEDED TO BE.*). 51 boards, 41 blood writings: §4.

### 1.7 Never

A board that explains (*THE FLAME COPIES YOU*), a joke, modern words on a Keepers' board (*restore, scan, signal*), a real-world
religion or hate symbol, a child in peril shown (children exist only as the size of stones), gore described, a line that tells a
player to avoid a real recovery ring, a blood writing that names Wren (the menders never knew him: they count *ten*).

---

## 2. THE PURPOSE AT THE BOTTOM

### 2.1 Five candidates

| | 1 · **THE FITTING** | 2 · THE TAUT ROPE | 3 · THE SICKBED | 4 · THE LEDGER WALL | 5 · THE SECOND STAIR |
|---|---|---|---|---|---|
| **What it is** | A place cut into the last wall in your exact shape and height, mid-climb pose, XLI over it, 40 chalk outlines layered in it | The first rope, still taut down a bore in the chamber floor after 500 years; grip it and it pulls back in the rhythm of your knock | A child's iron bed under the Still Lamp; a stone girl in it, eyes open | Every name Continuity ever restored, cut into the wall as it happens; a line being cut now: *ELIAS WREN · XLI* | A stair below the bottom, cut **upward** from beneath; fresh chips; forty pairs of your boot prints going down, none up |
| **Why the shaft was built around it** | A light may go up only while one whole person stands below in it: the shaft is the road to the place | The Keepers lowered their first to the Flame and could never let go of the line; they built the shaft around a rope | The founders' daughter was dying; the Flame was below; they built a 556 m stair to keep visiting a child who could not die | The Flame keeps accounts; the Keepers were its clerks | They dug down; something was digging up; the shaft is where they met |
| **Why Perennial sends Wren** | The Ember is unpaid light and the debt is due; he fits (fidelity = fit) | To haul the rope up: the kindling is tied to it | To bring the girl's lamp up | To erase a line | To close it |
| **What it wants** | Someone to stand in it, whole, still, awake, forever | To be pulled up, or to pull you down | Company | Balance | Up |
| **Mason / Dresser / Ember / body** | Dresser measured you for it; Mason herds the hurt down to it; Ember is the unpaid light; it is your height in VR | Weak: the rope ties to tethers only | Strong for Odessa (a daughter), weak for the creatures | Strong for Continuity, weak for the body | Strong for the Mason, weak for the Ember |
| **What you see / do in VR** | Step into it: it fits your real height; your hands grey, your heart slows, one knock behind your head | Grip a rope and feel it pull | Look at a bed | Read | Look down a stair |
| **Why it chills** | It was made for you before you were born, and the menders were measured and found too short | A hand on the other end | A child | Your name being carved | Your own footprints |

### 2.2 The pick: THE FITTING (ruthless)

- **It is an object and a wrong detail at once.** A niche is mundane; a niche your height, posed like a VR player holding a lantern
  and a launcher, is wrong in a way your own body feels. Only VR can do this: the game knows how tall you are (calibrated eye
  height). The "it fits" moment is a uniform scale: cheap, and it will be the clip.
- **It answers the owner's brief literally.** *"Keep something down at last, as the purpose of this descent."* You were never
  sent to bring something up. You were sent to be **kept down**, **at last**, after forty Wrens who were not.
- **It costs no retcon.** Every shipped canon line gains a second reading without changing a word: *THE FLOOR KEEPS · IT DOES NOT
  SEND US BACK · THE WALLS STILL HAVE THEIR SHAPE · ONLY THE STILL ONE, AND WHAT IT HOLDS* (the Still One is a person) *· WE WERE
  NINE. YOU MADE TEN. YOU ALWAYS MAKE TEN.*
- **It explains the creatures we already shipped**, which no other candidate does: the Dresser hunts only the *whole* because the
  place needs a whole body (its chalk already says *MEASURE TWICE. CUT ONCE.*); the Mason hunts only the *hurt* and drives them
  *down*; the health corridor is the place's condition; the grate's slam is a door closing behind you, not a rescue.
- **It sets up all three endings.** B (the Kept: the mission) = stand in it. A (the Unkindled) = put the light out so no place ever
  needs filling. C (the Answered) = name the ones in the walls so nobody has to stand.
- **Why not the others.** The rope points to a monster on the other end (the cheapest answer). The bed is powerful but risks a
  sentimental, child-in-peril read and has nothing for the creatures. The ledger is text about text. The second stair is a mystery
  without an object. **Steal from them:** the rope's tug-back becomes the knock behind your head; the ledger becomes S2's lamps
  paid for; the stair becomes *DO NOT BUILD THE SECOND STAIR AGAIN* and *THERE WAS A THIRD WAY. IT WENT UP.*

### 2.3 The team truth (never on a wall; the player only ever pieces it together)

1. **The price.** The Still Flame does not give light; it lends it. A flame lifted from it burns above only while one whole person
   stands in its light below, held still and awake: *the Still One*. Every lamp in the shaft was paid for this way (*LAMPS PAID FOR*);
   the statues and the columns are, among other things, the payers. One lamp was never paid for.
2. **The theft.** In 1791 Hesper Vell, the last keeper of the Mark, carried the deepest light up (the Ember) and left the place at the
   bottom **empty**. Before that she had sent nine menders down *to mend the deep course* (*WE WERE NOT SENT TO MEND. WE WERE SENT TO
   BE TRIED ON.*); none fitted (*TOO SHORT. TOO WIDE. TOO AFRAID.*). She took the light anyway, sealed the Cap *so that none would
   follow*, and by morning the deep course was walking: the Mason is the unpaid debt, walking toward any light that leaves a body.
3. **The dimming.** Borrowed light burns down. The Ember is failing; restores come back with gaps (the fade, the greying hands).
4. **The fitting.** The place is dressed to the one who will stand in it. The Dresser is the Keepers' last working tool: it measures
   every whole body that comes down; the ones that do not fit it dresses into blocks (*SOMEONE WILL BUILD WITH YOU*). It has
   measured Elias Wren forty times. Each restore of the same scan is the same body: the place now fits him, and only him.
5. **Perennial knows** (Vell's papers came with her lamp). The work order Vesper carries reads *PAYLOAD 1 · RETURN 0*. Forty Wrens
   reached the bottom or near it and refused (they knelt, ran, tried to cut their way out: W-40 is the Kneeling One). "Highest
   Continuity fidelity on record" is the fit. Odessa sends her father to be the Still One because a Still One never dies: it is the
   only way she can keep him. The loop is love that will not let go (FUTURE_STORY_PLAN §5 #12).
6. **Time is not straight down there** (deliberate, never explained): the menders of 1790 count a tenth shadow at the lamp and see
   forty strokes nobody cut; the Wrens of 2260+ read their writing fresh. The Flame's light holds *when* as it holds stone.

### 2.4 How the end of Chapter I plays

**(a) As built today (text and existing props; the demo ships with this).** The approach, S8 *The Last Throat* (subtitle now
*Down. Now. Everything here wants you down.*): the boards turn from the Keepers' ledger to the fresh hand.

| Beat | Where | What you read |
|---|---|---|
| T-180 s | S8 landing | *ONE LIGHT UP. ONE STILL ONE DOWN. THE BOOKS MUST BALANCE.* · blood *THERE IS NO DEEP COURSE TO MEND. WE WERE SENT DOWN TO FEED IT.* |
| T-120 s | first step (safe) | *~WE FED IT.~ NO. WE WERE FED.* · blood *IT DROVE US DOWN LIKE SHEEP. IT NEVER ONCE TRIED TO STOP US.* · lore *THE WALLS STILL HAVE THEIR SHAPE.* |
| T-80 s | second step (safe) | *SHE CARRIED IT UP IN THE NIGHT. SHE LEFT THE PLACE EMPTY. BY MORNING THE WALLS WERE WALKING.* · blood *THE STILL ONE DOES NOT SAVE YOU. IT KEEPS YOU. LOOK AT THE WALLS.* |
| T-20 s | the throat's foot (the Mason close) | fresh *TOO SHORT. TOO WIDE. TOO AFRAID. NEXT.* · *THE GRATE IS NOT TO KEEP IT OUT.* · floor *KEEP YOUR ARMS AS THEY ARE. IT IS CUT THAT WAY.* · the Mark · blood *WE WERE NINE. YOU MADE TEN.* |
| T-5 s | through the grate | on the back wall, lit by the Still Lamp: **the figure** (life-size, lantern up, launcher down, the nine's heights all short of its head, XLI over it) and **MEASURED FORTY TIMES. CUT ONCE. IT FITS NOW.** |
| T 0 | the goal | the grate slams behind you |
| T+0-2.8 s | inside | floor *FOR THE ONE WHO COMES DOWN WHOLE.* · ceiling *THERE IS NO STAIR UP. THERE NEVER NEEDED TO BE.* · west wall *I TO XL: NOT YET. XLI:* · blood *WE ALL STOOD IN IT. NONE OF US FIT. IT IS CUT FOR YOU.* · *THE GRATE CLOSED BEHIND US TOO. IT ALWAYS CLOSES.* |
| T+2.8 s | the panel | *You reached the bottom* · teaser *Something at the bottom was cut to your measure. It took forty of you to get it right.* (VR panel: the comms owner's *Uplink lost below the Mark. Expedition 42 on standby.*) |

**(b) THE FITTING set-piece (S9; needs the models of §5; slots into CHAPTERS §5.4 before the Mark Lamp is lifted).**

- **Light.** The Still Lamp moves to the plinth (CHAPTERS §5.4) and its lens throws one narrow, perfectly still column of 2700 K
  light into the niche: the brightest thing in Chapter I, everything else at 30 %. **Dust hangs frozen in the beam** (motes with zero
  velocity: the Flame's light holds everything still); when your hand enters the beam, the motes around your fingers stop too.
- **Scale and silence.** Low ceiling (8 m), the `hush` volume: for the first time you cannot hear the shaft. Your lantern's flame
  **leans toward the niche** and dims to 60 % within 2 m (out-shone). The wrist ECG slows from 72 to 40 bpm in the haptics as you
  approach; your gauntlets grey at the edges within 2 m (canon E25).
- **The Kneeling One** (W-40) kneels 1.4 m in front of the niche, back to you, head bowed, lantern dark: the one before you, who
  would not stand. It does not move while your light is on it; its head is turned toward you whenever you look back.
- **The niche** is cut to your calibrated height in your pose: a hook for the lantern bail where your left hand is, a worn grip
  where your right is, two shallow foot hollows. Forty chalk outlines inside it, each a little different (each Wren stood a little
  differently), the newest one fresh and in the pose you are in right now (the Dresser's outline renderer, fed your tracked pose).
- **What you DO (the last 90 seconds).** Nothing forces you. You can read, look, knock (the Kneeling One knocks back your Name,
  CHAPTERS §5.4 beat 3). If you **step in** (head inside the recess for 2 s): the world goes silent, the frozen dust, your hands
  grey, the haptic heartbeat stops, the lantern's flame goes perfectly still; after 3 s **one knock from inside the wall behind
  your head**. Step out at any time (non-lethal in Chapter I): everything resumes, and the Kneeling One's head is now turned toward
  the niche you left. If you never step in, after 60 s the Still Lamp's flame leans toward the niche and the beat sheet continues
  with the lift (CHAPTERS §5.4 beat 4).
- **The last lines.** Board: **MEASURED FORTY TIMES. CUT ONCE. IT FITS NOW.** Blood: **IT IS CUT FOR YOU.** Radio (in a dead zone
  that, for one line, shows five bars and zero latency): Vesper *"Fit: ninety-nine point eight."* then, off-mic, clean, almost
  tender, Odessa: ***"He fits now."***
- **The cliffhanger into Chapter II.** You lift the Mark Lamp; the coils pour away (canon); the place stays empty behind you, lit.
  The chain lowers you into Lamphold, a town of three thousand lit lamps, where (Chapter II) every lamp has its own small niche, and
  every niche is full. The question the player cannot stop thinking about: **who measured me, and what did the other forty do?**

---

## 3. THE REVELATION CURVE

### 3.1 Section by section

| Section | Dread | The question it plants (never answered there) | The detail answered wrongly | New texts (boards / blood) |
|---|---|---|---|---|
| S1 Threshold | curiosity | *Who cut forty strokes beside the lamp, and why does the board say AGAIN?* | "the descent begins" (it is a return; nobody came down through the Cap) | 5 / +3 |
| S2 Long Swing | curiosity | *Which lamp was never paid for, and paid with what?* | the statues are monuments (they were stood up; one has a living man's face) | 6 / +3 |
| S3 Broken Gallery | unease | *Measured for what?* (the fresh hand appears) | "closed from this side" keeps something out (it kept them in; the count rose) | 6 / +2 |
| S4 Listening Vault | unease to dread | *What happened the week the lamp went out? Whose name do the knocks spell?* | lamps are for seeing (each holds someone still, and someone holds each) | 6 / +2 |
| S5 Gullet Stair | dread | *Why does it come only when you bleed?* | it hunts to kill (it gathers: it drives the hurt down) | 5 / +2 |
| S6 Two Descents | dread | *Why does every way go down? What did they fill the way up with?* | the patient reach the bottom as a reward | 7 / +2 |
| S7 Hollow Nave | knowledge | *What did they do to them, with love?* | "our work" is craft (it is their dead: the tall column is still growing) | 5 / +3 |
| S8 Last Throat | knowledge | *Who carried the light up and left the place empty?* | the grate saves you from the Mason (it shuts you in) | 6 / +1 |
| The chamber | the object | ***Who measured me, and what did the other forty do?*** | (the answer is a shape, not a sentence) | 5 / +2 |

### 3.2 Second playthrough (what re-reads once you know)

1. **The forty strokes** by the spawn's lamp (and *FORTY STROKES BY THE LAMP. NONE OF US CUT THEM.*): forty earlier Wrens.
2. **IF YOU WAKE HERE AND DO NOT REMEMBER THE CLIMB DOWN, THERE WAS NONE.**: you were restored at the lamp, never lowered (FUTURE §5 #4).
3. **LAMPS PAID FOR: 4,111.**: every lamp has a Still One; the unpaid one is the Ember, and you are the payment.
4. **The Dresser's chalk** (*HOLD STILL. I AM MEASURING.*) and **MEASURED HERE: FOURTEEN HANDS AND A KNOCK. NOT YET.**: it was fitting you.
5. **IF YOU HEAR TICKING, YOU ARE WHOLE.** and **FOR THE ONE WHO COMES DOWN WHOLE.**: whole is the requirement, not a health state.
6. **IT DOES NOT HUNT THE WOUNDED. IT GATHERS THEM.** and **IT DROVE US DOWN LIKE SHEEP.**: the Mason never chased you away from the chamber.
7. **THE CAGE CAME UP FORTY-ONE TIMES. IT WENT DOWN FORTY-TWO.**: forty-two is next (the comms owner's *Expedition 42 on standby*).
8. **THE GRATE IS NOT TO KEEP IT OUT.**: the slam everyone remembers as relief.
9. **THE WALLS STILL HAVE THEIR SHAPE.** and **KEEP YOUR ARMS AS THEY ARE. IT IS CUT THAT WAY.**: the shape is a person's.
10. **ONLY THE STILL ONE, AND WHAT IT HOLDS.** (canon, unchanged): the Still One is not the Flame. It is whoever stands in the place.

---

## 4. THE TEXT BUDGET

### 4.1 Counts (this pass)

| Kind | Before | Now | Where | Limits |
|---|---|---|---|---|
| Plaques (decor, canon) | 18 | 18 (unchanged: their lines are the canon) | `level-data-3d.js` | canon phrases word for word (tests/render/test-board-writing.mjs checks 14); lore <= 12 words (routes.mjs) |
| **Boards (new channel)** | 0 | **51** (5/6/6/6/5/7/5/11 by section, the chamber's 5 in S8) | `board-writing-3d.js` | <= 100 characters seen, <= 18 words, ALL CAPS; on a face, off climb zones, plaques, lamps, statues, anchors, blood |
| Blood | 21 | **41** (5 a section, S8 6) | `blood-writing-3d.js` | 3 x 24 characters; 4-6 a section (test) |
| Subtitles | 8 | 5 rewritten (S2, S3, S4, S6, S8) | `level-data-3d.js` | section names unchanged (saves, records, e2e) |
| Hints | | 6 dark tails (S1 bell, S2 haul, S3 rocks, S3 gear, S6 rust, S7 floor) | `level-data-3d.js` | the instruction first, unchanged |
| Deaths | 5 | 3 rewritten (impact, hazard, fall) | `ui3d.js` | Mason / Dresser lines kept (canon) |
| Menu, victory | | tagline *... No one has climbed back. You have tried.* · teaser *Something at the bottom was cut to your measure. It took forty of you to get it right.* | `ui3d.js` | |

### 4.2 Every new board (where the player actually sees it)

| Id | Where (why there) | Style | Text |
|---|---|---|---|
| bd-s1-tally | west wall by the spawn's lamp, over the menders' first writing | scratch | *(forty tally strokes, no word)* |
| bd-s1-wake | west wall, across from the spawn | plate | IF YOU WAKE HERE AND DO NOT REMEMBER THE CLIMB DOWN, THERE WAS NONE. |
| bd-s1-cap | high on the south wall: you look up toward the Cap | plate | THE CAP WAS SET IN LIME SO THAT NONE WOULD FOLLOW. NONE HAVE COME THROUGH IT. |
| bd-s1-count | the floor in front of the spawn | cut | COUNT YOURSELF AT THE LAMP. COUNT AGAIN AT THE BOTTOM. |
| bd-s1-call | the sill's north wall by its lamp | plate | DO NOT CALL UP THE SHAFT. IT IS FARTHER THAN IT WAS. |
| bd-s2-ledger | the landing's north wall | plate | LAMPS LIT: 4,112. / LAMPS PAID FOR: 4,111. |
| bd-s2-silence | **the ceiling** by the hook under the floor above (you look up as you aim) | plate | WE TRIED SALT, THEN SONG, THEN SILENCE. SILENCE WAS WORSE. |
| bd-s2-statues | the far ledge, under the statue | plate | THE STATUES FACE THE LAMP. IF ONE DOES NOT, TELL NO ONE WHICH. |
| bd-s2-ropes | the hall's north wall over the floor walk | plate | ROPES LOWERED: 38. ROPES RETURNED: 38. RETURNED EMPTY: 37. |
| bd-s2-bram | the hall floor, the safe line's walk | cut | THIS FLOOR IS BRAM AND HIS BROTHERS. WALK SOFTLY. |
| bd-s2-settle | the safe line's low ledge | plate | IT TOOK TWO YEARS FOR THIS ONE COURSE TO FINISH SETTLING. DO NOT LEAN ON IT. |
| bd-s3-sealed | the landing's north wall | plate | THE NINTH WAS SEALED THREE TIMES: WITH LIME, WITH IRON, WITH THE NINE. |
| bd-s3-cage | high on the south wall over the old cage | plate | THE CAGE CAME UP FORTY-ONE TIMES. IT WENT DOWN FORTY-TWO. |
| bd-s3-measure | in front of a body hanging from the lower ring | **fresh** | MEASURED HERE: FOURTEEN HANDS AND A KNOCK. NOT YET. |
| bd-s3-count | over the lower gallery | plate | THE GALLERY WAS CLOSED FOR NINE YEARS. WHEN IT WAS OPENED THE COUNT WAS HIGHER. |
| bd-s3-gear | beside the winch gear | cut | THE GEAR WAS TURNED BY HAND FOR SIX YEARS. THEN IT WAS TURNED FROM INSIDE. |
| bd-s3-small | the shelf's floor (safe line) | cut | FORGIVE THE SMALL STONES IN THIS COURSE. |
| bd-s4-week | the catwalk rail between its cold lamps | cut | THIS LAMP WENT OUT ONCE. WE DO NOT SPEAK OF THE WEEK THAT FOLLOWED. |
| bd-s4-who | the catwalk's other rail by the rest | cut | WHO LIT THIS LAMP? WHO IS STILL HOLDING IT? |
| bd-s4-knock | across the catwalk deck | cut | KNOCK ONCE: WE ARE HERE. KNOCK TWICE: WE ARE COMING. NEVER KNOCK THREE. |
| bd-s4-vault | the landing's south wall | plate | THE VAULT HOLDS NINE THOUSAND. IT WAS BUILT FOR SIX. |
| bd-s4-eleven | by the low lamp over the shelf | plate | WE COUNTED THE KNOCKS FOR ELEVEN YEARS. THEY ADD UP TO A NAME. |
| bd-s4-listen | the plinth | plate | ~DO NOT LISTEN.~ LISTEN. IT IS THE ONLY WARNING YOU WILL GET. |
| bd-s5-gathers | the landing's north wall | plate | IT DOES NOT HUNT THE WOUNDED. IT GATHERS THEM. |
| bd-s5-second | **a step's side face** (lowered on the third ring) | cut | DO NOT BUILD THE SECOND STAIR AGAIN. |
| bd-s5-ours | the third step's face (fourth ring) | plate | NINE WENT DOWN. NINE WERE COUNTED IN THE WALL. ONE OF THE NINE WAS NOT OURS. |
| bd-s5-names | the fifth step's face | cut | WE TRIED TO NAME IT. IT HAS TOO MANY. |
| bd-s5-keystone | beside the keystone | plate | HE KNOCKED BACK. HE IS THE KEYSTONE NOW. |
| bd-s6-third | the fork's floor, before the two plaques | cut | THERE WAS A THIRD WAY. IT WENT UP. WE FILLED IT. |
| bd-s6-steps | the Long Stair's first shelf | plate | THE STAIR HAS 1,440 STEPS. COUNT THEM. IF YOU COUNT 1,441, STOP. |
| bd-s6-ticking | above the second shelf (the corridor) | cut | IF YOU HEAR TICKING, YOU ARE WHOLE. BE LESS WHOLE. |
| bd-s6-measured | the second shelf | **fresh** | MEASURED AGAIN: FOURTEEN HANDS AND A KNOCK. STILL TOO AFRAID. |
| bd-s6-rest | the third shelf (the rest) | plate | REST UNDER THE LAMP. DO NOT REST LONGER THAN THE LAMP. |
| bd-s6-late | the fourth shelf | plate | THE LATE ARE NOT PUNISHED. THEY ARE USED SOONER. |
| bd-s6-throat | the divider, seen from the Throat's frayed rings | plate | THE THROAT WAS CUT IN FORTY YEARS. IT FILLED IN THREE DAYS. |
| bd-s7-where | the landing, beside the tablet | plate | WHERE DO THE FALLEN GO? WHERE ELSE WOULD WE PUT THEM? |
| bd-s7-cut | the landing's west wall | plate | WHAT WE #DID TO THEM# HERE, WE DID WITH LOVE. |
| bd-s7-left | the landing's south wall | plate | THE NAVE WAS NOT DESIGNED. IT IS WHAT WAS LEFT WHEN WE STOPPED ADDING. |
| bd-s7-columns | the nave's north wall, 4 m wide (read from the rings) | plate | EACH COLUMN IS A FAMILY. THE TALL ONE IS STILL GROWING. |
| bd-s7-spire | scratched into the iron perch | scratch | THE SPIRE POINTS HOME. |
| bd-s8-books | the landing | plate | ONE LIGHT UP. ONE STILL ONE DOWN. THE BOOKS MUST BALANCE. |
| bd-s8-fed | the first step (safe) | plate | ~WE FED IT.~ NO. WE WERE FED. |
| bd-s8-she | the second step (safe) | plate | SHE CARRIED IT UP IN THE NIGHT. SHE LEFT THE PLACE EMPTY. BY MORNING THE WALLS WERE WALKING. |
| bd-s8-grate | the throat's west wall at its foot | cut | THE GRATE IS NOT TO KEEP IT OUT. |
| bd-s8-short | the throat's foot, left of the grate | **fresh** | TOO SHORT. TOO WIDE. TOO AFRAID. NEXT. |
| bd-s8-arms | the floor before the grate | cut | KEEP YOUR ARMS AS THEY ARE. IT IS CUT THAT WAY. |
| bd-ch-figure | **the chamber's back wall**, left of the Still Lamp | outline | the life-size figure; the menders' heights (HOB, HALLAM, MAB, WENNA, TAMSIN, COLL, ISOLDE) all short of its head; XLI |
| bd-ch-fits | the back wall over the Still Lamp | **fresh** | MEASURED FORTY TIMES. CUT ONCE. IT FITS NOW. |
| bd-ch-whole | **the chamber floor** between the statues | cut | FOR THE ONE WHO COMES DOWN WHOLE. |
| bd-ch-stair | **the chamber ceiling** | cut | THERE IS NO STAIR UP. THERE NEVER NEEDED TO BE. |
| bd-ch-ledger | the chamber's west wall | cut | I TO XL: NOT YET. / XLI: |

The 20 new blood writings (with the 21 of STORY.md §5): S1 *FORTY STROKES BY THE LAMP...* · *WE TRIED TO GO BACK UP. THE ROPE WAS
TIED OFF FROM ABOVE.* · *FIRST NIGHT. SOMETHING WALKED THE SILL. IT HAD OUR FOREMAN'S STEP.* · S2 *MAB COUNTED THE STATUES.
THIRTEEN. COUNTED AGAIN. FOURTEEN.* · *WE HAULED THE WEIGHT FOR AN HOUR. SOMETHING HAULED BACK.* · *ONE STATUE HAS HOB'S FACE. HOB
IS ALIVE. I WENT AND CHECKED.* · S3 *IT TICKS WHEN I AM WELL. IT STOPS WHEN I BLEED. SO I BLEED.* · *IT DREW ME ON THE WALL. CHALK.
MY OWN SHAPE. IT SAID NOT YET.* · S4 *I RELIT THE LAMP. THE WALL BEHIND IT WENT QUIET. A HELD BREATH.* · *I WROTE DOWN THE KNOCKS.
THEY SPELL A NAME. NOT ONE OF OURS.* · S5 *IT CAME WHEN COLL CUT HIS HAND. NOT BEFORE. IT CAN SMELL IT.* · *WE TRIED TO KILL IT. YOU
CANNOT KILL A WALL. WE APOLOGISED TO IT.* · S6 *THERE IS NO WAY UP. WE LOOKED FOR SIX DAYS. EVERY STAIR GOES DOWN.* · *THE WHITE ONE
WAITS FOR YOU TO HEAL. THE OTHER FOR YOU TO BLEED.* · S7 *I FOUND MY MOTHER IN THE THIRD COLUMN. I KNEW HER BY HER RING.* · *WE ARE
TWO. HOB AND I. HOB IS NOT HOB. I DO NOT SAY SO.* · *WE WERE NOT SENT TO MEND. WE WERE SENT TO BE TRIED ON.* · S8 *IT DROVE US
DOWN LIKE SHEEP. IT NEVER ONCE TRIED TO STOP US.* · the chamber *WE ALL STOOD IN IT. NONE OF US FIT. IT IS CUT FOR YOU.* · *THE
GRATE CLOSED BEHIND US TOO. IT ALWAYS CLOSES.* (The data file has the exact spots; Hob stopped under a lamp in S6, so the Hob of S7
*is not Hob*: that is deliberate.)

### 4.3 The radio's contribution (a spec for the comms owner; not implemented here)

Fits COMMS.md's cast and rules (<= 6 s, one unscripted line per 20 s, never over a set-piece peak, silence in rests). Triggers are
board gazes (the existing `gaze` sense, aimed at a board id) or depths. None reveal the truth; each one lets a board's question
land on a human voice.

| Id | Trigger | Who | Line |
|---|---|---|---|
| s1-tally | gaze bd-s1-tally 2 s | MAREN | "Forty tally marks. The last one's still sharp." |
| s1-tally-2 | chain | ODESSA | "Probes, Maren. Keep moving, Elias." |
| s1-wake | gaze bd-s1-wake | MAREN | "'If you don't remember the climb down...' You remember it, don't you, Elias?" (Wren never answers) |
| s2-ledger | gaze bd-s2-ledger | TICK | "Four thousand one hundred and eleven paid. Paid with what?" (static; nobody answers) |
| s3-measure | gaze bd-s3-measure | TICK | "Fourteen hands and a knock. Dessa, is that his height?" |
| s3-measure-2 | chain | ODESSA | "Focus, Tomasz." |
| s3-cage | gaze bd-s3-cage | MAREN | "Up forty-one, down forty-two. Someone stayed down." |
| s6-third | gaze bd-s6-third | TICK | "No way up on the scans either. What's the extraction plan?" |
| s6-third-2 | chain | ODESSA | "Restore. Same as always." *(the slip, like "louder than last time")* |
| ch-fit | the goal box, before the slam's 2.8 s are up; **a dead zone that shows five bars for this one line, zero latency, no static** | VESPER | "Fit: ninety-nine point eight." |
| ch-last | chain, `kind: 'offmic'`, clean | ODESSA | ***"He fits now."*** *(the last line of Chapter I; the radio is cut at `game:victory` today, so it must play before)* |

---

## 5. MODEL BRIEF: THE FITTING (S9; do not build until S9 is scheduled)

| Piece | Silhouette and size | Materials | Triangles / LOD | Behaviour | Lighting |
|---|---|---|---|---|---|
| **The niche** (in the chamber's back wall, or the Mark chamber's per CHAPTERS §5.4) | A recess the shape of a climber facing out: lantern arm raised (left: forearm vertical, hand at shoulder height, an iron hook for the bail), launcher arm down and forward (right), feet 0.3 m apart in two worn hollows, head slightly bowed. 0.95 m wide, 2.05 m tall at the default height, 0.45 m deep at the shoulders, 0.25 m at the face. The rim is crisp; the back is tooled (claw-chisel striations) | The level's stone (kit atlas) plus a **fresh-cut** variant: +35 % albedo, roughness 0.9, no grime or moss, crisp arrises; chalk decals (§ below) | LOD0 2,000 (within 12 m), LOD1 600 (to 30 m), then the flat wall (the recess is in the chamber's static chunk: 0 new draw calls) | **Scaled uniformly to the player's calibrated eye height** (`eyeHeight x 1.13 + 0.06` m tall; desktop 1.8 m) at chamber load. A trigger volume inside it (the head inside the recess for 2 s) drives the step-in beat of §2.4(b) | The Still Lamp's lens: a narrow 2700 K spot (20 deg) into the niche, still (no flicker); a GI probe inside so the recess is not black from the side |
| **The forty outlines** | 40 chalk outlines of the same figure on the niche's back face, each offset 1-3 cm and rotated up to 2 deg (forty slightly different stances); the newest one fresh and thicker | One chalk atlas (the Dresser's chalk shader), alpha-blended decal | 40 quads (80 triangles), one draw call | The newest outline is redrawn from the player's tracked pose while they stand within 3 m (the Dresser's `_placeOutline` path) | Unlit chalk with a faint glow, so it reads inside the beam |
| **XLI and the marks** | XLI cut 12 cm high over the head; a measuring rod up the left side with the nine menders' marks and names, all below the head; one tick level with the head, no name | Cut into the fresh stone (normal-map decal) | in the niche's mesh / the decal atlas | none | as the niche |
| **The Kneeling One (W-40)** | A Perennial Mk-suit figure kneeling 1.4 m in front of the niche, back to the entrance, head bowed, dark lantern raised in the left hand, stencil W-40 on the gauntlet; stone-grey with suit seams still visible | The statue stone + the suit's trim (one material) | LOD0 6,000, LOD1 1,500 (beyond 10 m), one skinned mesh with 2 bones (head, lantern arm) | **The kept rule:** it never moves while your lantern's cone is on it; when the cone has been off it for 0.3 s its head turns toward you (or toward the niche after you step out). Non-lethal in Chapter I | Lit only by the beam's spill and your lantern: no light of its own |
| **Frozen dust** | 300 motes in the beam | the existing dust sprite | one points draw (existing FX pool) | zero velocity in the beam; motes near the player's hand stop when the hand enters | additive, inside the beam only |

**Budget:** +2 draw calls at most (the chalk, the Kneeling One; the niche merges into the static chunk), about 8.5 k triangles
in view, no new texture beyond the chalk atlas (128 KB). Quest: within the 150-call cap at the chamber (the chamber's view today is
far from the throat's worst case). **Fairness / comfort:** no camera motion, the player can always step out, nothing in the chamber
can kill.

---

## 6. ENGINEERING NOTES (what this pass built, and why the hashes do not move)

- **The channel.** New boards are **not decor**: `LEVEL_DATA_3D.boards` (`data/board-writing-3d.js`), read only by
  `render/boardWriting.js`, like the blood. The lightmap hash (`levelLmHash`) hashes only light-shaft and shadow-casting decor
  types and the GI hash only solids and lights, so the 18 plaques never touched them either. But `verify:at3d` counts every decor
  object (178 in its baseline), the dressing plans around decor and the routes test reads lore plaques. A separate list keeps all of
  that identical: no slab, no collider, anchor, climb zone or bake input.
- **The render.** `render/textAtlasGroups.js` (new, shared): a group's canvas atlas and ONE merged mesh are drawn a cell per frame
  when the head is within 40 m (blood 35 m) and freed beyond 70 m. The spawn's group is drawn at level build so the program is
  precompiled. Boards use the plaques' material (unlit MeshBasic, the phosphor carving reads in the dark), double-sided for
  ceilings, with a polygon offset, 1.6 cm off a wall or ceiling and 3 cm above a floor. The blood moved onto the same helper: twice
  the writings, one section's atlas (<= 6 MB) at a time instead of one 22 MB whole-level atlas.
- **Cost.** One draw call per group in view (usually one board call and, with the setting on, one blood call). Two triangles a
  board. Atlases: the largest group 9.3 MB with mips (S6, the chamber), at most two resident (<= 20 MB).
- **Tests.** `tests/render/test-board-writing.mjs` (new, in `test:at3d`) checks:
  - the data, the placement on static faces and the clearances
  - the canon plaque lines, word for word
  - the markup, the fit and the lazy groups

  `tests/render/test-blood-writing.mjs` now expects 4-6 writings a section and accepts the chamber. It tests the per-section meshes.

---

## 7. OPEN QUESTIONS for the owner (recommendation first)

1. **Show the figure in the demo now, or hold it for S9?** *Recommended: now.* The flat outline is cheap and already does 80 % of
   the work. S9's niche makes it physical later.
2. **Say "forty" on the victory screen?** *Recommended: yes.* It is the hook that sells Chapter II. FUTURE_STORY_PLAN already
   reveals "first descent is a lie" at the Mark.
3. **Should the player be able to step into the niche in the demo (S9)?** *Recommended: yes, non-lethal.* It is the clip.
4. **Should the last radio line ("He fits now.") play in a zone that has no signal?** *Recommended: yes.* The impossible clean
   signal is the second chill. It is the comms owner's call.
