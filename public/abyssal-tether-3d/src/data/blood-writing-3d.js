/* ABYSSAL TETHER 3D — blood-writing-3d.js
 * BLOOD WRITING (Settings › Display › Blood writing; OFF by default): short messages scrawled in blood on the walls of the
 * Underspire by the nine Masons who went down to mend the deep course. Story bible: docs/abyssal-tether-3d/plans/STORY.md.
 *
 * The carved boards (level-data-3d.js 'plaque' / 'tablet' decor) are the Keepers' voice: formal, third person, riddling,
 * they make you ask WHAT happened. These are the other voice: first person, by people who were really there, bodily and
 * specific (names, counts, days), and they say what it did to them. They escalate down the shaft: fear (S1-S3), resignation
 * (S4-S6), the truth about the descent (S7-S8).
 *
 * Not level decor: they are not in `decor` (no bake, no lightmap / GI hash, no dressing keep-out, no collider, no anchor, no
 * climb surface, no verify count); Level3D keeps the raw list on `level.data.blood` and only render/bloodWriting.js reads it,
 * and only while the setting is on.
 *
 * Entry: { id, section, x, y, z, yaw, w, text, floor? }
 *   wall  (x, y, z) = the centre of the writing ON the wall's inner face; yaw = the way the writing faces (out of the wall),
 *         the plaque convention (yaw 0 faces -Z, π/2 faces -X: a plaque on an east wall)
 *   floor (x, y, z) = the centre ON the floor's top face; yaw = the way the READER faces (the checkpoint convention): the
 *         first line is the far one
 *   w     width of the writing (m); its height is w / BLOOD_ASPECT (the atlas cell's shape)
 *   text  1-BLOOD_MAX_LINES lines ('\n'), each at most BLOOD_MAX_CHARS characters of BLOOD_CHARSET (hand-laid: no wrapping)
 * Each spot is clear of the kit dressing in front of its wall (pilasters, string courses, panels, floor inlays): checked by
 * raycasting the built level in the browser when the spots were chosen; tests/render/test-blood-writing.mjs keeps the rest
 * (on a static face, off climb zones and plaques, near the route).
 * DOM-free, three.js-free: importable from Node.
 */

const PI = Math.PI;
const N = PI; // a north wall's inner face (z = min): the writing faces +Z
const S = 0; // a south wall's inner face (z = max): faces -Z
const E = PI / 2; // an east wall's inner face (x = max): faces -X
const W = -PI / 2; // a west wall's inner face (x = min): faces +X

/** Lines per message, characters per line (fits the atlas cell at a legible size), the characters the renderer draws. */
export const BLOOD_MAX_LINES = 3;
export const BLOOD_MAX_CHARS = 24;
export const BLOOD_CHARSET = /^[A-Z0-9 .,'?!-]*$/;
/** Width / height of every writing (and of its atlas cell). */
export const BLOOD_ASPECT = 3;

export const BLOOD_TEXTS = [
  // ---- S1 · The Threshold (fear: they arrive; the wall answers) ------------------------------------------------------------
  // low on the Threshold's west wall at its north lip (written kneeling), lit by the lamp beside the spawn: read looking down
  { id: 'bw-s1-crew', section: 's1', x: -11, y: 1.07, z: 5.18, yaw: W, w: 1.8, text: 'NINE OF US CAME DOWN\nTO MEND THE DEEP COURSE.\nHOB. DAY ONE.' },
  // the sill (the first landing), north wall beside its lamp
  { id: 'bw-s1-knock', section: 's1', x: -5.92, y: -3.66, z: -11, yaw: N, w: 1.8, text: 'HALLAM KNOCKED TWICE\nFOR LUCK.\nTHE WALL KNOCKED THREE.' },

  // ---- S2 · The Long Swing (fear: what the statues are, what the floor keeps) -------------------------------------------
  // across the landing (checkpoint), read facing the hall: the colossus on the far pier is right ahead
  { id: 'bw-s2-statues', section: 's2', x: 5.4, y: -22, z: -6, yaw: E, w: 1.9, floor: true, text: 'THE STATUES WERE NOT\nCARVED. THEY WERE\nSTOOD UP.' },
  // the hall floor's south wall on the safe line's floor walk, beside the lore plaque, where a short release lands
  { id: 'bw-s2-mab', section: 's2', x: -20.68, y: -33.56, z: 11, yaw: S, w: 2.0, text: 'MAB FELL HERE NINETY\nTIMES. SHE WOKE NINETY.\nTHE FLOOR KEPT THEM ALL.' },

  // ---- S3 · Broken Gallery (fear: Wenna's six; a tenth shadow) ------------------------------------------------------------
  // the landing's east wall, beside the NINTH GALLERY board (behind the checkpoint)
  { id: 'bw-s3-wenna', section: 's3', x: 11, y: -64.5, z: -2.98, yaw: E, w: 1.9, text: 'I CLOSED IT MYSELF.\nSIX WERE STILL INSIDE.\nWENNA' },
  // over the narrow last span, west wall beside its beacon lamp (eye height for a body landing on the span)
  { id: 'bw-s3-ten', section: 's3', x: -34, y: -74.79, z: 0, yaw: W, w: 1.7, text: 'DAY NINE. HOB SAYS WE\nARE STILL NINE. I COUNT\nTEN SHADOWS AT THE LAMP.' },
  // the shelf (safe line), north wall
  { id: 'bw-s3-order', section: 's3', x: -30.4, y: -94.45, z: -11, yaw: N, w: 1.9, text: 'THEY KNOCK IN THE ORDER\nI BRICKED THEM IN.\nSIX. ALWAYS SIX.' },

  // ---- S4 · The Listening Vault (the knock answered; what the lamps are for) --------------------------------------------
  // scrawled across the catwalk deck just past the DO NOT ANSWER board, read walking out over the Vault
  { id: 'bw-s4-tamsin', section: 's4', x: -16, y: -105, z: -9.3, yaw: 0, w: 2.0, floor: true, text: "I ANSWERED. IT KNOCKED\nBACK IN MY BROTHER'S\nRHYTHM. TAMSIN" },
  // the catwalk's far end, in the Masons' rest, under the lamp you relight
  { id: 'bw-s4-lamps', section: 's4', x: -16, y: -105, z: -20.93, yaw: 0, w: 2.0, floor: true, text: 'THE LAMPS WERE NEVER FOR\nSEEING. THEY KEEP THE\nDEAD IN THE WALLS STILL.' },
  // the shelf (safe line): its north side is the open Vault, so across its floor, read facing the shelf's lamp (east)
  { id: 'bw-s4-again', section: 's4', x: 3.4, y: -119, z: -8.1, yaw: W, w: 2.0, floor: true, text: 'TAMSIN WENT BACK TO\nANSWER IT AGAIN.\nWE DID NOT STOP HER.' },

  // ---- S5 · The Gullet Stair (what the Mason is made of; what the knocking wants) ---------------------------------------
  // the first step, north wall (the first ledge you lower onto)
  { id: 'bw-s5-hands', section: 's5', x: -13.76, y: -158.6, z: -9, yaw: N, w: 1.8, text: "IT IS MADE OF US.\nI SAW HALLAM'S HANDS\nIN ITS SIDE. HOB" },
  // the third step, south wall by its lamp
  { id: 'bw-s5-four', section: 's5', x: -11.28, y: -174.85, z: 9, yaw: S, w: 2.0, text: 'WE ARE FOUR. WE STOPPED\nBURYING. THE WALL TAKES\nTHEM BEFORE WE CAN.' },
  // the last step, west wall beside the keystone niche (the lure): read while you wait for it to knock
  { id: 'bw-s5-named', section: 's5', x: -21, y: -198.87, z: 5.86, yaw: W, w: 1.9, text: 'I LET IT KNOCK.\nSIX HOURS. IT ONLY\nWANTS TO BE NAMED.' },

  // ---- S6 · The Two Descents (resignation: the carried, the one who stopped) --------------------------------------------
  // across the fork, before the THROAT board
  { id: 'bw-s6-coll', section: 's6', x: -7.2, y: -208, z: -3.5, yaw: 0, w: 1.9, floor: true, text: 'COLL TOOK THE THROAT.\nHE WAS CARRIED.\nWE STILL HEAR HIM.' },
  // the Long Stair's third shelf, north wall in the Masons' rest under the wall lamp
  { id: 'bw-s6-hob', section: 's6', x: -31.5, y: -240.6, z: -11, yaw: N, w: 1.7, text: 'I HAVE SAT UNDER THIS\nLAMP FOUR DAYS. I AM\nNOT GOING ON. HOB' },
  // the fifth shelf (the last of the safe line), north wall beside the lore plaque
  { id: 'bw-s6-mouth', section: 's6', x: -28.4, y: -264.6, z: -11, yaw: N, w: 1.9, text: 'THE BOTTOM IS NOT A\nPLACE. IT IS A MOUTH,\nAND WE ARE THE TEETH.' },

  // ---- S7 · The Hollow Nave (the truth: what their work was) -------------------------------------------------------------
  // across the landing, before the tablet at its north lip
  { id: 'bw-s7-sister', section: 's7', x: -12.5, y: -288, z: -5.2, yaw: 0, w: 2.2, floor: true, text: 'OUR WORK WAS OUR DEAD.\nWE CUT THEM SQUARE AND\nBUILT. I CUT MY SISTER.' },
  // the iron perch (the bail-out halfway down the spiral)
  { id: 'bw-s7-isolde', section: 's7', x: -20, y: -349, z: 25.4, yaw: 0, w: 2.0, floor: true, text: 'I CARVED THE SPIRE TO\nPOINT HOME. IT POINTS\nDOWN. ISOLDE' },

  // ---- S8 · The Last Throat (the truth about the descent) ----------------------------------------------------------------
  // across the landing (checkpoint), read facing the throat
  { id: 'bw-s8-feed', section: 's8', x: 4.75, y: -428, z: -12.75, yaw: PI * 0.75, w: 2.2, floor: true, text: 'THERE IS NO DEEP COURSE\nTO MEND. WE WERE SENT\nDOWN TO FEED IT.' },
  // the second step's east ledge (the safe line's last rest), east wall
  { id: 'bw-s8-keeps', section: 's8', x: 13, y: -510.5, z: -6.4, yaw: E, w: 2.0, text: 'THE STILL ONE DOES NOT\nSAVE YOU. IT KEEPS YOU.\nLOOK AT THE WALLS.' },
  // the throat's foot, south wall beside the grate: the last thing before the light
  { id: 'bw-s8-ten', section: 's8', x: 3.8, y: -554.5, z: 10, yaw: S, w: 1.8, text: 'WE WERE NINE.\nYOU MADE TEN.\nYOU ALWAYS MAKE TEN.' },
];
