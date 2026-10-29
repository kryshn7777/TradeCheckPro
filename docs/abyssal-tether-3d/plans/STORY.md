# STORY: the darker descent (Chapter I) and the blood writing

> Owner request (2026-10-29): *"Make the story darker. And even darker if player chose to read there will be texts in blood
> here and there. Normal story will involve curiosity; those are written in boards but blood stories invoke reality."*
>
> **2026-10-29, second pass:** [DARK_STORY_BIBLE.md](DARK_STORY_BIBLE.md) is now the reference for the voice (the hook patterns), the
> purpose at the bottom (**THE FITTING**: a place cut to your shape in the chamber's back wall, *MEASURED FORTY TIMES. CUT ONCE. IT
> FITS NOW.*), the revelation curve and every new text: **+51 boards** (a new non-decor channel, `src/data/board-writing-3d.js`,
> drawn by `src/render/boardWriting.js`) and **+20 blood writings** (41 in all). The tables below keep the first pass's texts.
>
> Canon lives in [CHAPTERS.md §2](../CHAPTERS.md) (the Still Flame, the waking, the kept, the Mason). This page adds what the
> boards and the blood say in Chapter I, who wrote them and the rules for writing more. Code: the boards are the `plaque` /
> `tablet` decor of `src/data/level-data-3d.js`; the blood is `src/data/blood-writing-3d.js`, drawn by
> `src/render/bloodWriting.js` only while **Settings › Display › Blood writing** is on (off by default).

## 1. What happened (the team's version; the player only ever pieces it together)

- **The Lanternwrights** built the Underspire downward toward the Still Flame. Its light wakes whoever carries it, so dying
  did not matter: you woke at the last lamp you passed and the body you died in stayed where it fell, turning to stone.
- They stood their first dead up as **statues**. Then there were too many, so they **dressed them into blocks and built with
  them**: the walls, the ledges, the galleries. *IT WEARS OUR WORK*: the work was their own dead.
- **The lamps are not for seeing.** Light holds the kept still; out of it they move, slowly, toward the lamp that left them.
  Every lamp in the shaft is a lid on a wall full of people.
- **The deep course** (the oldest dressed dead) woke when its lamps failed and moved as one: **the Mason**. It is blind,
  hunts by sound, knocks from inside the walls because every body in it is still knocking to be named, and comes for the
  lantern-bearers because every piece of it walks toward the light. A Mason kill leaves no stone body: it wears you.
- **The menders.** The Keepers sent nine Masons (the guild of menders) down to mend the deep course. The wall mended
  itself, with them. The Keepers' boards say only *THEY WERE NOT RETURNED*. The nine wrote the rest on the walls in their
  own blood on the way down: those are the blood writings.
- **The tenth.** From the ninth day the menders count ten shadows at the lamp. The tenth is the player: a pilgrim who has
  made this descent before and always will (canon rule 4, the loop). The last writing, at the grate, says so.

## 2. The two voices

| | Boards (always on) | Blood (opt-in) |
|---|---|---|
| Who | The Keepers, carving for whoever comes after | The nine menders, while it happened to them |
| Person | Formal, third person (or the institutional *we*), riddling | First person, names, counts, days |
| Job | **Curiosity**: make you ask *what happened?* | **Reality**: *this is what it did to us* |
| Form | ALL CAPS, carved, fits its plate (3.6 x 0.9 m plates: <= ~95 characters); safe-line lore plaques <= 12 words, <= 70 in all (tests/objectives/routes.mjs) | ALL CAPS scrawl, 1-3 hand-laid lines of <= 24 characters of `A-Z 0-9 . , ' ? ! -` (tests/render/test-blood-writing.mjs) |
| Never | explains the truth outright; drops a canon phrase (TRUST THE RING, NOT THE FLOOR · IT WEARS OUR WORK · DO NOT ANSWER WHAT KNOCKS · THE MASONS WENT DOWN TO MEND THE DEEP COURSE · ONLY THE STILL ONE · LET IT KNOCK · THE NAVE OPENS FOR THOSE WHO HANG · the fork names) | slurs or real-world hate, gore for its own sake, a lie about the mechanics (a writing never tells you to avoid a real recovery ring) |

Both voices may darken a hint or a menu line, but a hint's instruction stays first and unchanged in meaning.

## 3. Timeline of the blood writers (top to bottom = first to last)

| Section | Day | Writer | Beat | Arc |
|---|---|---|---|---|
| S1 Threshold | 1 | Hob (foreman), Hallam's knock | Nine arrive; the wall knocks back | fear |
| S2 Long Swing | ? | unsigned | The statues were people; Mab woke ninety times and left ninety bodies | fear |
| S3 Broken Gallery | 9 | Wenna; unsigned | She bricked six in; they knock in that order; ten shadows at the lamp | fear |
| S4 Listening Vault | ? | Tamsin; unsigned | She answered the knock (her dead brother's rhythm), went back to answer again; what the lamps are for | fear to resignation |
| S5 Gullet Stair | ? | Hob; unsigned | It is made of us (Hallam's hands in its side); four left; it only wants to be named | resignation |
| S6 Two Descents | ? | unsigned; Hob | Coll took the Throat and was carried; Hob stops under a lamp; the bottom is a mouth and we are its teeth | resignation |
| S7 Hollow Nave | ? | unsigned; Isolde | Our work was our dead (I cut my sister); the spire points down, home | the truth |
| S8 Last Throat | - | unsigned | There was nothing to mend: they were sent to feed it; the Still One keeps you; you make ten | the truth |

The nine: **Hob** (foreman), **Hallam**, **Mab** (Twice-Fallen), **Wenna** (lamplighter of the Ninth Gallery), **Tamsin** (of
the Deep Course), **Coll** (the Late), **Isolde** (who carved the spire) and two the walls never name. These are the
Chapter I Names of CHAPTERS.md §5.5; the writings agree with their codex lines.

## 4. The boards (Chapter I, as shipped)

| Where | Board |
|---|---|
| S1 Threshold, over the spawn | HERE THE DESCENT BEGINS. TRUST THE RING, NOT THE FLOOR. THE FLOOR KEEPS. |
| S2 far pier, by the lamp | THE LAMP DOES NOT RISE TO MEET US. WE GO DOWN TO IT. IT DOES NOT SEND US BACK. |
| S2 safe line (lore) | A YEAR TO LOWER THE FIRST LAMP. THE ROPE CAME BACK WET. |
| S3 landing | NINTH GALLERY — CLOSED FROM THIS SIDE. THE STONE HAS BEEN LISTENING. |
| S3 shelf (lore) | THE GALLERY FELL TWICE. IT WAS REBUILT WITH THOSE IT FELL ON. |
| S4 catwalk foot | DO NOT ANSWER WHAT KNOCKS FROM INSIDE THE WALL. IT HAS LEARNED OUR KNOCKS. |
| S4 catwalk end (the rest) | THE MASONS' REST. IT CANNOT FOLLOW. IT WAITS. |
| S4 shelf (lore) | THE VAULT WAS NOT DUG. IT WAS FOUND FULL, AND LISTENING. |
| S5 Gullet mouth | THE MASONS WENT DOWN TO MEND THE DEEP COURSE. THE WALL MENDED ITSELF. THEY WERE NOT RETURNED. |
| S5 step 4 (lore) | A MASON CUT EACH LEDGE. THE LEDGE BELOW WAS CUT FROM HIM. |
| S5 keystone niche | LET IT KNOCK. DO NOT KNOCK BACK. |
| S6 fork, west | THE LONG STAIR — FOR THE PATIENT, WHILE THE LAMPS HOLD. |
| S6 fork, east | THE THROAT — FOR THE LATE. IT IS NEVER EMPTY. |
| S6 shelf 5 (lore) | THE PATIENT REACH THE BOTTOM. THE LATE ARE CARRIED THERE, INSIDE. |
| S7 landing tablet | THE NAVE OPENS FOR THOSE WHO HANG. MANY STILL DO. |
| S7 west wall | IT WEARS OUR WORK. NONE OF OUR STONE WAS QUARRIED. |
| S8 first step (lore) | THE LAST LANTERNWRIGHTS RESTED HERE. THE WALLS STILL HAVE THEIR SHAPE. |
| S8 over the grate (the Mark) | BELOW THIS MARK NO LAMPS. ONLY THE STILL ONE, AND WHAT IT HOLDS. |

Section subtitles (second pass): *Where the descent begins. Again.* · *Every fall here is kept. So is the count.* · *Closed from
this side. Measured from the other.* · *Something answered the knock. It knew the rhythm.* · *It has your scent. It had theirs.* ·
*Slow and certain, or quick and carried. Never up.* · *Nothing to stand on. Nothing to bury.* · *Down. Now. Everything here wants
you down.* (Section names are unchanged: saves, records and the e2e use them.)

Hints (instruction first, a darker tail): S1 bell *... opens the way down. Only down.* · S2 *... The rope forgives; the floor
keeps.* · S2 haul *... It is heavier than stone should be.* · S3 rocks *... Do not look at what falls.* · S3 gear *... Something
inside is turning it.* · S4 *Hold your lantern to the cold lamps. Light them before the walls notice.* · S5 *Something made of the
lost is coming down after you. Keep moving.* · S6 *... Nobody has come back up to oil them.* · S7 *... Do not watch where it goes.* ·
S8 *The grate — run for the light. Do not look at the walls.* The control tutorials (S1, S3, S7) are unchanged.

Menu and screens (ui/ui3d.js, second pass): tagline *A lantern, a line, and a long way down. No one has climbed back. You have
tried.* · deaths: *The floor keeps what falls. It has kept you before.* / *The ironwork was waiting. It remembers your size.* /
*It is not a fall if it is where you were going.* / the Mason: *It wears you now.* / the Dresser: *DRESSED. SOMEONE WILL BUILD WITH
YOU.* · victory teaser: *Something at the bottom was cut to your measure. It took forty of you to get it right.* (the VR panel's
line is the comms owner's *Uplink lost below the Mark. Expedition 42 on standby.*). Sound captions stay plain descriptions of the
sound (accessibility).

## 5. The blood writings (41; Settings › Display › Blood writing)

The first pass's 21 are below; the second pass's 20 (S1-S8 and two in the chamber) are listed in
[DARK_STORY_BIBLE.md §4.2](DARK_STORY_BIBLE.md).

| Id | Where | Text |
|---|---|---|
| bw-s1-crew | S1 Threshold, low on the west wall at the lip, by the spawn lamp | NINE OF US CAME DOWN / TO MEND THE DEEP COURSE. / HOB. DAY ONE. |
| bw-s1-knock | S1 sill, north wall by its lamp | HALLAM KNOCKED TWICE / FOR LUCK. / THE WALL KNOCKED THREE. |
| bw-s2-statues | S2 landing (checkpoint), floor, read facing the hall and the colossus | THE STATUES WERE NOT / CARVED. THEY WERE / STOOD UP. |
| bw-s2-mab | S2 hall floor, south wall by the lore plaque | MAB FELL HERE NINETY / TIMES. SHE WOKE NINETY. / THE FLOOR KEPT THEM ALL. |
| bw-s3-wenna | S3 landing, east wall by the NINTH GALLERY board | I CLOSED IT MYSELF. / SIX WERE STILL INSIDE. / WENNA |
| bw-s3-ten | S3 over the narrow last span, west wall by its beacon | DAY NINE. HOB SAYS WE / ARE STILL NINE. I COUNT / TEN SHADOWS AT THE LAMP. |
| bw-s3-order | S3 shelf (safe line), north wall | THEY KNOCK IN THE ORDER / I BRICKED THEM IN. / SIX. ALWAYS SIX. |
| bw-s4-tamsin | S4 catwalk deck past the knock board (floor) | I ANSWERED. IT KNOCKED / BACK IN MY BROTHER'S / RHYTHM. TAMSIN |
| bw-s4-lamps | S4 catwalk end, in the rest under the lamp (floor) | THE LAMPS WERE NEVER FOR / SEEING. THEY KEEP THE / DEAD IN THE WALLS STILL. |
| bw-s4-again | S4 shelf (safe line), floor | TAMSIN WENT BACK TO / ANSWER IT AGAIN. / WE DID NOT STOP HER. |
| bw-s5-hands | S5 first step, north wall | IT IS MADE OF US. / I SAW HALLAM'S HANDS / IN ITS SIDE. HOB |
| bw-s5-four | S5 third step, south wall by its lamp | WE ARE FOUR. WE STOPPED / BURYING. THE WALL TAKES / THEM BEFORE WE CAN. |
| bw-s5-named | S5 last step, west wall beside the keystone niche | I LET IT KNOCK. / SIX HOURS. IT ONLY / WANTS TO BE NAMED. |
| bw-s6-coll | S6 fork, before the THROAT board (floor) | COLL TOOK THE THROAT. / HE WAS CARRIED. / WE STILL HEAR HIM. |
| bw-s6-hob | S6 Long Stair shelf 3, in the rest under the lamp | I HAVE SAT UNDER THIS / LAMP FOUR DAYS. I AM / NOT GOING ON. HOB |
| bw-s6-mouth | S6 shelf 5 (end of the safe line), north wall | THE BOTTOM IS NOT A / PLACE. IT IS A MOUTH, / AND WE ARE THE TEETH. |
| bw-s7-sister | S7 landing, before the tablet (floor) | OUR WORK WAS OUR DEAD. / WE CUT THEM SQUARE AND / BUILT. I CUT MY SISTER. |
| bw-s7-isolde | S7 iron perch (floor) | I CARVED THE SPIRE TO / POINT HOME. IT POINTS / DOWN. ISOLDE |
| bw-s8-feed | S8 landing (checkpoint), floor | THERE IS NO DEEP COURSE / TO MEND. WE WERE SENT / DOWN TO FEED IT. |
| bw-s8-keeps | S8 second step, east ledge (safe line), east wall | THE STILL ONE DOES NOT / SAVE YOU. IT KEEPS YOU. / LOOK AT THE WALLS. |
| bw-s8-ten | S8 throat foot, south wall beside the grate | WE WERE NINE. / YOU MADE TEN. / YOU ALWAYS MAKE TEN. |

The data file has the exact coordinates; the positions in the table above are only a guide.

## 6. How the blood is made (engineering notes)

- **Not decor.** The list is `LEVEL_DATA_3D.blood`, never `decor`: the lightmap / GI bakes and their hashes, the dressing's
  keep-out boxes, the kit colliders, anchors, climb zones and the verify counts never see it. The setting cannot change the
  level the bots and the bake check.
- **Placement rule.** Where the player stands or hangs anyway (a checkpoint, a supply spot, a route ledge, a rest, the
  grate), within reach of a lamp or the lantern; on a static wall's inner face or a floor's top (stone behind every corner,
  air in front), off climb zones, plaques, lamps, glyph bands, ribs and pipes, and clear of the kit dressing in front of the
  wall (pilasters, string courses, panels: checked by raycasting the built level in the browser). Second pass: 4-6 a section,
  and the chamber behind the grate counts as near the route.
- **Look.** A procedural canvas scrawl (no web font: a generic hand / cursive stack, every glyph rotated, scaled and offset
  on a drifting baseline), finger-thick strokes, a faint wet highlight, smears and drips with beads; dark wet red
  (#7a0b0b) drying to #2a0303 (the higher, older writings darker). One 1536 x 2816 atlas (2 x 11 cells of 768 x 256), one
  merged mesh of 21 quads (42 triangles), the decals' lit alpha-blended material (rougher, a faint wet film, a 0.7 albedo
  tint so the lantern never makes it glow) with a polygon offset, 1.4 cm off a wall and 2.6 cm above a floor (over the
  carved floor inlays). Second pass (41 writings): one atlas (2 columns of 768 x 256 cells, <= 1536 x 768, about 6 MB with mips)
  and one merged mesh **per section**, drawn a writing per frame while the head is within 35 m of the section and freed beyond 70 m
  (`render/textAtlasGroups.js`, shared with the boards): one draw call per section with a writing within 14 m (x the detail scale)
  of the head.
- **Live.** Renderer3D reads `settings.bloodWriting` every frame: on builds the mesh and precompiles; off disposes the
  mesh, its material and its atlas. A level rebuild keeps the state.
- **Adding one.** Append an entry (section, wall point or floor point, yaw, width 1.4-2.4 m, 1-3 lines of <= 24
  characters) and run `node tools/abyssal-tether-3d/tests/render/test-blood-writing.mjs` (4-6 per section, charset, on its
  wall, clear of climb zones and plaques, near the route) and `test-board-writing.mjs` (no board crosses a writing). Then look at it in the game (`capture-screens.mjs --only shots
  --recipe shot-blood` shows bw-s6-hob).
