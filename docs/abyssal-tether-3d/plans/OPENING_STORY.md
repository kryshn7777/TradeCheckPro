# The opening story (plays when a new descent begins)

> "Animate a story at the start of the game when the user hits new game: something existed here even before that, something we have not prepared for, an imminent threat that could become dormant at any moment; we confronted it, but... The story grows darker in depth, as if documented in one of our advanced library books: something existed there before the lamp, something that was never supposed to be disturbed. The animation is just the descent, why the company exists and what the player must do. The other parts must be discovered by the player when they go below."

## What it is

A page from a Perennial library book (*Deep Recovery Library, Vol. XI, On the Unforeseen, entry 9, The Underspire; filed under: phenomena, not preventable*) that types itself out over black, **about 44 seconds**, six pages, and gets colder and darker with each: library white, tired amber, ember red. A depth gauge runs down its left edge; behind the text a ring of ancient marks turns slowly and wakes as the record darkens. The last page is the addendum (*recovered, condition: poor*): the ring glows red, the text jitters, and the entry is **torn off mid-sentence: "We confronted it, but"**, in a burst of static with a crack through the ring. Then the title (*Abyssal Tether · Expedition 41 · Descent authorised*) and the black eases away into the first section (the first radio line follows as before).

| Page | Tone | What it says (the only three jobs) |
|---|---|---|
| 1 Book | cool white | the entry's heading (no story yet) |
| 2 Light | amber-white | **why Perennial exists:** to keep the light on; everyone raised from the dark was raised by one flame, the Ember; it left this shaft in 1791 with the only one who climbed back; *it is dimming* |
| 3 Shaft | amber | **the descent:** 556 metres of cut stone below the capped mouth; every probe fell silent at the same depth; *so we are lowering a person* (the gauge runs 0 to 556) |
| 4 Procedure | deeper amber | **what the player must do:** go down, rope by rope, lamp by lamp; reach the bottom, take a fresh kindling from the source, carry it back up; the lantern will fail before the shaft does, the visor will not |
| 5 Addendum | ember red | **the monition:** something existed here before that; before the lamp, before the first stone was cut; something we had not prepared for, a threat that may lie dormant for a hundred years and wake in a breath; never meant to be disturbed; *we confronted it, but* (the gauge loses its number: `--- M`) |
| 6 Title | ember | the name and the expedition |

## What it deliberately does not say

Everything else is for the player to find below, in the boards, the blood writing, the radio and the places themselves (STORY.md, DARK_STORY_BIBLE.md, COMMS.md): who built the shaft and why, the Keepers, the menders, what the walls are made of, what the Mason is, what the radio never says about the restore, who is on the other end of it, and what waits at the bottom. `tests/ux/prologue.mjs` keeps a list of words the story may never contain (names, the creatures, the restore mechanism, the fitting, ...).

## How it plays

- **When:** only when a descent is begun from the menu (Begin descent / New descent / the difficulty picker). Not on Continue, not on restart or respawn, not from the debug and test entry points (`Game.start`), and not with `?intro=off`.
- **Controls:** any key / click / trigger / A finishes the typing of the page, then turns it; **Esc / B skips the whole story**. A press in the first half second is ignored (it is the click that began the run). Settings, Display: **Story intro** turns it off for good (on by default).
- **Under it:** state `intro`: nothing is simulated, the world waits under the black fade (so the procedural level is built behind it), the run clock has not started, the first section (title card, radio, objectives) is entered when the story ends or is skipped.
- **Desktop:** the page fills the window (16:9, letterboxed). **VR:** a world-locked panel 2.6 m wide, 2.2 m in front of where the head was when it began (a head-locked page of text is uncomfortable); it eases round to the front if the head has been turned away from it for a second. **Reduced effects:** no glitch slices, static or flicker; the typewriter and the colours stay.
- **Sound:** a quiet paper-and-relay tick on each page, the low swell of the rumble when the addendum begins, a burst of static and a drop at the tear. All through the existing bus (`intro:page`, `intro:dark`, `intro:cut`, `intro:end`).
- **Cost:** one draw call (a quad) while it plays, a 1280 x 720 canvas redrawn at 30 Hz; nothing afterwards.

## Files

`sim/prologue3d.js` (the script, the timeline, the presses; pure) · `render/prologueView.js` (the picture) · `game.js` (`startNewGame`, state `intro`, `_beginIntro` / `_updateIntro` / `_endIntro`, `?intro=off`) · `ui/ui3d.js` (the menu calls `startNewGame`; the Story intro toggle) · `sim/config3d.js` (`storyIntro`) · `audio/audio3d.js` (the three sounds) · test `tests/ux/prologue.mjs`.

## Not done / honest limits

- Not run in a headset: the panel distance and size (2.2 m, 2.6 m), the text size at VR resolution and the recentring need real eyes.
- The AI-voiced radio is not part of it (it starts with the first section): no narrator over the pages. A spoken, whispered read of the addendum would suit it (a recording job; see voice/lines.csv).
- Touch: any touch button advances it and the timeline runs by itself, but there is no tap-anywhere-to-advance yet.
