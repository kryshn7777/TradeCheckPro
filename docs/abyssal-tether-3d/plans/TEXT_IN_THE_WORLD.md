# Text in the world: no boards

> Owner: "All the boards where there are texts look like someone intentionally placed a board there and wrote everything. It should not be like that. There should not be a board and there should not be writing somewhere. Brainstorm and show me options."

## What is wrong now
- 18 slab **plaques** (3.6 x 0.9 m dark rectangles, framed since the mesh-detail pass added frames and corner bosses) and 27 of the 51 **boards** are the `plate` style (a dark slate plate set in the wall): 45 of 69 pieces of text are the same placed-sign rectangle.
- All of it is typeset ALL-CAPS in one serif, centred, at reading height, facing the route, in one formal voice.

## Options (mock-ups composited on a real screenshot: `img/text-opt-*.png`; current look: `img/text-now.png`)
- **A. Cut into the stone.** No slab: letters chiselled straight into the masonry, irregular baseline and size, worn gaps, dust in the groove, lit by the lantern (a height field to a normal map: it rakes as you move). Monumental statements only (5-6 of them), at architectural scale, sometimes running across several blocks.
- **B. Written by a hand.** Chalk / charcoal / scratch: uneven, crooked, retraced, struck through, lowercase and hurried. The human voices (the menders, the previous divers), placed where hands would reach: beside holds, on ledge lips, under lamps. Blood writing already works this way.
- **C. Words on things.** A small stamped iron tag on a wire, a brass collar on a lamp, a serial on an anchor plate, a bell rim, a crate lid. Short facts only (3-6 words), found where the object is. Nothing at reading height unless the object is.
- **D. Light-only words.** The carving is almost invisible to the lantern (a faint bevel at a grazing angle); an infrared paint in the grooves glows only through the night vision goggles. Gives the goggles a second job: the walls say more through them.
- **E. No words.** Remove a third of the texts and let the place say it: a rope that stops, a lamp on its side, chalk outlines, tally scratches (already there), a coat on a hook.
- **G. A placement rule for all of them.** Text only where a person would have a reason: next to a hold, an anchor, a lamp, a ledge lip, a door; at awkward heights; sometimes behind a pillar or above a drop you must turn to read; never a centred rectangle facing the route.

## Recommendation
A mix, with **no free-standing plate anywhere**: A for ~6 monumental lines, B for the human voices (~20), C for the small facts (~10), D for ~8 of the "curiosity" lines, E for ~15 of today's 69 (cut). That is ~45 pieces, none of them a sign.

## Cost / risk (not started)
Reuses the board atlas pipeline (one merged mesh per section): the styles are shaders and atlas cells, no new draw calls. Removing the 18 slab plaques changes the decor (the verify counts and the lightmap bake inputs): do it as a second step with a re-bake; the first step restyles the plaque quad and the `plate` boards only (no bake change).

Dev-only builders for the mock-ups: `src/render/textStylePreview.js` (not imported by the game).
