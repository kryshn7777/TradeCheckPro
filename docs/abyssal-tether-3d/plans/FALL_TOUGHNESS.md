# FALL TOUGHNESS: the player takes half the damage from falls (2026-11-06)

Owner: "make the player tank more damage when he falls down ... currently he dies easily ... 2 times stronger than he is now" (not 3x).

## The rule

The same fall (and the same wall hit) costs **half** the hp it did. The free-drop threshold SPEED is unchanged, so a short hop is
still free; only the damage above it is halved, and death needs a faster landing.

`config3d.js: toughFall(lethal, threshold, FALL_TOUGHNESS = 2)`: the curve `((v/L - t)/(1 - t))^2` is divided by 2, so it reaches 1
at `L' = L * k`, `k = t + (1 - t) * sqrt(2)`, and the threshold fraction becomes `t' = t / k` (so `t' * L' == t * L`). The difficulty
tables carry `lethalImpact = L'` and `health.fallThreshold = t'` (+ `fallK`, `fallToughness` for the wall rule). Every consumer reads
those two numbers (health, release guide, fall cue, audio, bots), so they all move together.

| | old lethal | new lethal | free drop | lethal free fall (old -> new) |
|---|---|---|---|---|
| Normal | 17.0 m/s | 20.17 m/s | ~3.2 m (unchanged) | 10.7 m -> 15.1 m |
| Nightmare | 15.5 m/s | 18.71 m/s | ~2.2 m (unchanged) | 8.9 m -> 13.0 m |
| Abyss | 14.5 m/s | 17.80 m/s | ~1.6 m (unchanged) | 7.8 m -> 11.7 m |

Normal, damage by free-fall height (old -> new): 5 m 9 -> 4 hp, 6.5 m 26 -> 13, 8 m 49 -> 24, 10 m 85 -> 43, 12 m dead -> 64, 14 m dead
-> 87, 15 m+ dead.

Wall hits: read against the old lethal speed (`wallRef = lethalImpact / fallK`) with `wallScale / fallToughness`, i.e. exactly half the
damage at every speed (cap 0.7 -> 0.35). Hazards (spikes, blades) and creature damage are NOT changed.

To change the strength: `FALL_TOUGHNESS` in `sim/config3d.js` (1 = the old behaviour, 3 would be the "3x" the owner declined).
