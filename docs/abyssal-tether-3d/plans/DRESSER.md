# THE DRESSER (Chapter I build): rules, numbers and the health corridor

The owner's brief: "New creature. Whatever works and makes things scary." FUTURE_STORY_PLAN §4 item 2, cut down to the game as it is today
(Chapter I, S1-S8; no Sounder, Harpoon, Biosign, Echo, comms or bandages).

**The idea.** The inverse of the Mason. The Mason hunts only while you are hurt (≤ 35 %, a 14 s scent window); the Dresser hunts only
while you are **whole**, because only whole bodies dress into good blocks ("DRESS THE OLD STONE WITH CARE. IT WAS SOMEONE."). At full
health the Dresser is after you, at low health the Mason, and in between neither: you live in a health corridor, and health regeneration
is the Dresser's clock.

## Code

| Piece | File |
|---|---|
| Sim (pure, Node, deterministic, allocation-free per frame) | `src/sim/dresser3d.js` (`Dresser3D`, `DRESSER_TUNING`, `DRESSER_DIFF`, `cuttable`) |
| Section data | `src/data/level-data-3d.js`: `sections[i].creature.dresser = { active, walkMul?, measureRange?, wholeBy?, by? }` |
| Wiring, `?dresser=` switch, haptics, `'dressed'` kill, debug API | `src/game.js` (`_updateDresser`, `AT3D.debug.dresser`), `src/sim/config3d.js` (`dresserMode`) |
| View (procedural, one skinned mesh per LOD) | `src/render/dresserView.js` |
| The cut ring | `src/sim/level3d.js` (`anchor.cut`), `src/render/levelView.js` (a sawn ring sprung open, bright clean iron) |
| Chalk health text | `src/render/lowHealthText.js` (`LINES_CHALK`, `LINES_MEASURE`), fed by `src/render/healthFx.js` |
| Sound, captions, death line | `src/audio/audio3d.js` (`_onDresser*`), `src/ui/captions.js` (`[Ticking] [Humming] [Scraping] [Sawing]`), `src/ui/ui3d.js` + `game.js` (`dressed`) |
| Tests | `tools/abyssal-tether-3d/tests/creature/dresser.mjs` (in `npm run test:at3d`) |

## Rules and numbers (Normal / Nightmare / Abyss)

- **Where:** S3 Broken Gallery (Normal: walks at 0.85x, measures from 14 m), S4 Listening Vault, S5 The Gullet Stair (since
  2026-10-29, CREATURE_PACING.md: Normal 0.9x and 14 m, so that a whole player is hunted there and a cut or a bite brings the Mason to
  the keystone), S6 The Two Descents (THE CORRIDOR, 1.1x). None in S1, S2, S7, S8. Sandbox and the menu's attract flight: never.
- **The gate:** whole at hp ≥ **0.75 / 0.70 / 0.65**; no longer whole below that minus **5 points** (0.70 / 0.65 / 0.60). Not whole it is
  **SPOILED**: it stops, turns its mask away and folds its arms; it never measures, cuts or dresses; it steps back if you come within 7 m.
  It also **yields to the Mason**: while the Mason has your scent (its gate armed, or withdrawing) or makes its staged S4 pass, the
  Dresser does not hunt and leaves play (at once if you are not looking at it, else when you look away, at most 10 s), and re-enters
  out of sight when the Mason is gone. One big creature at a time.
- **Entering play:** out of sight on a wall **30-44 m** away (never closer); a 4 s grace (no measure, no reach). Far behind you and out
  of sight (> 40 m, or past 64 m) or stuck where it cannot measure you for 8 s, it relocates **22-36 m** away, only where you cannot see
  it (behind masonry or outside your view cone: game.js feeds the head camera) and never from where you can see it.
- **Walking:** upright on any structural surface (the Mason's `isStructural` / `boxSurface`), its up the wall's normal; it never runs:
  **1.2 / 1.45 / 1.7 m/s**. It takes a vantage 8-13 m from you with a three-quarter view of you, or, if you cling to or stand by a wall,
  walks straight at you along it.
- **Dressing:** if its body (feet to head) comes within **1.6 m** of you while you are whole: death, cause `dressed`
  ("DRESSED. SOMEONE WILL BUILD WITH YOU.").
- **Measure:** you in sight (it must see your head *and* your feet) within **16 m** (S3 Normal 14), a rope of yours on a ring it may cut:
  for **3.0 s** it pays its line out to that ring (the higher-tension one) and chalks your outline on the wall beside you (it draws on,
  then the cut lines between the blocks). Losing sight of the whole of you for 0.25 s cancels it.
- **Cut:** then **1.0 s** of sawing on the taut line, then the ring is cut (`anchor.broken = anchor.cut = true`), every rope on it lets go
  and you fall (fall damage drops you into the corridor: the synergy). Only that ring. At most **one ring per 8 s**; after a cut it waits
  **10 / 6 / 4 s** before a new measure (cuts at least 14 / 10 / 8 s apart). Never your only anchor while you stand on a floor or ledge.
  Never a ring an objective needs (seal keys, haul and winch rings, movers). A respawn (Level3D.reset) restores the rings.
- **Counterplay:** chain a second rope to another ring before the cut (it takes only the targeted one); take a hit or a fall to drop
  below whole; break its line of sight (a pillar, a ledge); fire a hook through its body: **STAGGER 2.5 s**, the measure cancelled, once
  per **12 s** (a shot into a wall in front of it does nothing).
- **First contact:** an S3 hint ("Ticking on the walls: it measures the whole. Chain a second rope, break its sight, or hook it.").
- **Fairness:** every cut is telegraphed by 3 s of ticking + chalk + a rope buzz in that hand and 1 s of sawing; the measuring line is a
  pale thread from its hands to your ring; the chalk text in your head says it ("HOLD STILL. I AM MEASURING.").

## THE CORRIDOR (tested: `tests/creature/dresser.mjs`)

A scripted sweep 100 → 0 (a point every 0.2 s) → 100 (Normal's own regeneration) with the Mason's gate:

| hp | Dresser | Mason |
|---|---|---|
| ≥ 75 (down to 70 on the way down) | hunts | dormant |
| 35-70 down, 50-75 up after the scent | **neither** | **neither** |
| ≤ 35, and 14 s after hp is back to 50 (+ its withdraw) | waits, out of play | hunts |

Never both. **The regen clock** (Normal: 6 s, then 5 %/s): a hit to 50 % and it can see you again 6 + 25 / 5 = **11 s** later.

## The look and the sound

- A 3.2 m figure standing sideways on the wall: a tall pointed hood with a heavy lip, the split saint mask (two pale half-faces on a
  seam, the left one dropped, closed slit eyes with a faint cold glow), a dark wet robe and a chalk-dusted leather apron, mantis-held
  segmented chisel arms out of ragged sleeves, two small grey hands paying out the line, long bare feet. Idle breathing, small sudden head
  tilts, a head that turns past a person's reach; measuring: arms spread like dividers, head tilted; cutting: the chisels work the line
  like a bow saw; spoiled: mask turned away to the wall, arms folded with the blades up behind the shoulders; staggered: flung back.
- 32 bones, procedural; near LOD 8.8 k triangles, far 3.6 k (switch at 12 m on Quest, 45 m on desktop high), beyond 60 m only two
  cold glints. **One draw call, always**: the measuring line (a bone at its far end) and the chalk outline of you (a quad on its own
  bone, alpha-dithered from the outline texture) are part of the skinned mesh.
- The level's lit material (lantern, baked GI, wet film, horror grade) + a cold rim, a faint pale self-light on the mask, a fog cap.
- Sound: the line's irregular dry tick (~0.6 s, ~0.25 s and louder while it measures), a hummed three-note work-song (G, B flat, A),
  chalk scraping beside you while it measures, a rasping saw at your ring for the last second; the cut sounds as a snapped ring.
- Health text: while it hunts you (you are whole) the head-locked line is white chalk ("YOU LOOK WHOLE", "GOOD STONE", "IT WAS SOMEONE";
  measuring: "HOLD STILL. I AM MEASURING.", "A CLEAN CUT"); never with the blood-red low-health line.

## Quest budget (measured, not on a headset)

Mock-XR, Quest tier, the dressing finished, `renderer.info` over both eyes incl. the lantern shadow pass (≤ 150 calls, ≤ 350 k
triangles). "Without": the max over 8 look directions with the Dresser out of play. "With": looking at it on a wall while it
measures (the line to a ring, the chalk outline on), at ~12 m and at ~22-29 m.

| Section | Without | With the Dresser in view | Notes |
|---|---|---|---|
| S3 | 136 calls, 238 k | 128-134 calls, 229-233 k | |
| S4 | 146 calls, 226 k | 144-148 calls, 226 k | the Mason's staged pass in the same view costs 150-154 alone: the Dresser gives way to it |
| S6 | 134 calls, 253 k | 132-140 calls, 252-261 k | with Normal's live skitterling |
| S6 + a 2nd skitterling at 9 m | | 142-150 calls, 294-302 k | |
| S6 + 2 skitterlings at 9-10 m | 148-156 calls, 328-337 k (same views) | 150-158 calls, 336-344 k | the skitterlings' cost; the Dresser adds 2 calls |

The Dresser costs **one call per eye** and 3.6 k triangles per eye (the far LOD from 12 m on Quest; 8.8 k closer).

## Switches

`?dresser=off` (no sim, no view), `?dresser=always` (no health gate: captures, tests), `?dresser=on` (default). `?hunt=always` (the
Mason ungated: the e2e and the capture tools) leaves the Dresser out unless a `dresser=` flag asks for it. The verify harness and the
route bots never build it, so `npm run verify:at3d` and the lightmap / GI hashes are untouched (section creature config is not hashed).
