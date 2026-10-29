/* ABYSSAL TETHER 3D — board-writing-3d.js
 * THE BOARDS beyond the plaques: inscriptions the Keepers (and, at the bottom, something still cutting) left in the stone of
 * the Underspire. Always on. Story bible: docs/abyssal-tether-3d/plans/DARK_STORY_BIBLE.md (the voice, the hook patterns, the
 * purpose at the bottom: THE FITTING).
 *
 * The plaques (level-data-3d.js 'plaque' / 'tablet' decor) keep the canon lines; these are the receipts around them: ledgers
 * that do not balance, durations no work should take, instructions that admit an earlier failure, corrections cut by a later
 * hand, words chiselled out, names without people, and the measure that runs from S3 to the figure at the bottom. Each one
 * asks a question and refuses to answer it; each reads in 3-8 s.
 *
 * Not level decor: they are not in `decor` (no slab, no bake, no lightmap / GI hash, no dressing keep-out, no collider, no
 * anchor, no climb surface, no verify count); Level3D keeps the raw list on `level.data.boards` and only render/boardWriting.js
 * reads it.
 *
 * Entry: { id, section, group?, face, x, y, z, yaw, w, aspect?, style?, text, marks? }
 *   face 'wall'  (x, y, z) = the centre ON the wall's inner face; yaw = the way it faces (the plaque convention: yaw 0 faces
 *                -Z, π/2 faces -X: on an east wall)
 *        'floor' (x, y, z) = the centre ON the floor's top; yaw = the way the READER faces (the first line is the far one)
 *        'ceil'  (x, y, z) = the centre ON the ceiling's underside; yaw = the way the reader faces (the first line is the far one)
 *   w       width (m); height = w / aspect (BOARD_ASPECT: 4, the plaques' 3.6 x 0.9 shape)
 *   style   'plate' (default) | 'cut' | 'scratch' | 'fresh' | 'outline' (render/boardWriting.js)
 *   text    ALL CAPS; '\n' breaks a line, longer lines wrap; markup ~struck~ #gouged# {n} (n tally strokes)
 *   group   atlas group (default: the section): the chamber has its own
 *   marks   'outline' only: [name, height as a fraction of the figure's]
 * DOM-free, three.js-free: importable from Node. tests/render/test-board-writing.mjs keeps them on their faces, clear of climb
 * zones, plaques, lamps, anchors and the blood, near where the player passes, and short.
 */

const PI = Math.PI;
const N = PI; // a north wall's inner face (z = min): faces +Z
const S = 0; // a south wall's inner face (z = max): faces -Z
const E = PI / 2; // an east wall's inner face (x = max): faces -X
const W = -PI / 2; // a west wall's inner face (x = min): faces +X

/** Width / height of a board (and of its atlas cell): the plaques' shape. */
export const BOARD_ASPECT = 4;
/** Characters a board may use (markup included), and the most a reader sees on one (3-8 s of reading). */
export const BOARD_CHARSET = /^[A-Z0-9 .,'?!:\-—~#{}\n]*$/;
export const BOARD_MAX_CHARS = 100;

export const BOARD_TEXTS = [
  // ---- S1 · The Threshold (curiosity: AGAIN; nobody came down through the Cap) --------------------------------------------
  // forty strokes scratched on the west wall beside the spawn's lamp, over the menders' first writing, no word with them
  // (bw-s1-forty reads them)
  { id: 'bd-s1-tally', section: 's1', face: 'wall', x: -11, y: 1.9, z: 5.2, yaw: W, w: 1.3, style: 'scratch', text: '{40}' },
  // the Threshold's west wall, across from the spawn
  { id: 'bd-s1-wake', section: 's1', face: 'wall', x: -11, y: 1.65, z: 1.75, yaw: W, w: 2.6, text: 'IF YOU WAKE HERE AND DO NOT REMEMBER THE CLIMB DOWN, THERE WAS NONE.' },
  // the east wall over the sill, in front of a body hanging from the second ring
  { id: 'bd-s1-cap', section: 's1', face: 'wall', x: 11, y: 0.6, z: -5.2, yaw: E, w: 2.6, text: 'THE CAP WAS SET IN LIME SO THAT NONE WOULD FOLLOW. NONE HAVE COME THROUGH IT.' },
  // the floor in front of the spawn, read facing down the shaft
  { id: 'bd-s1-count', section: 's1', face: 'floor', x: -4, y: 0, z: 6.4, yaw: 0, w: 2.4, style: 'cut', text: 'COUNT YOURSELF AT THE LAMP. COUNT AGAIN AT THE BOTTOM.' },
  // the sill's north wall by its lamp
  { id: 'bd-s1-call', section: 's1', face: 'wall', x: -0.2, y: -2.4, z: -11, yaw: N, w: 2.4, text: 'DO NOT CALL UP THE SHAFT. IT IS FARTHER THAN IT WAS.' },

  // ---- S2 · The Long Swing (the ledger; a year; the statues) -----------------------------------------------------------------
  // the landing's floor at the checkpoint's right hand, read facing the hall
  { id: 'bd-s2-ledger', section: 's2', face: 'floor', x: 8, y: -22, z: -8.6, yaw: E, w: 2.4, style: 'cut', text: 'LAMPS LIT: 4,112.\nLAMPS PAID FOR: 4,111.' },
  // the ceiling west of the hook under the floor above: you look up at it as you aim
  { id: 'bd-s2-silence', section: 's2', face: 'ceil', x: -10.2, y: -11, z: 0, yaw: PI / 2, w: 3.2, text: 'WE TRIED SALT, THEN SONG, THEN SILENCE. SILENCE WAS WORSE.' },
  // the far ledge's north wall, under the statue that faces the lamp
  { id: 'bd-s2-statues', section: 's2', face: 'wall', x: -22.5, y: -22.4, z: -11, yaw: N, w: 2.4, text: 'THE STATUES FACE THE LAMP. IF ONE DOES NOT, TELL NO ONE WHICH.' },
  // the hall's north wall over the floor walk
  { id: 'bd-s2-ropes', section: 's2', face: 'wall', x: -5.4, y: -33, z: -11, yaw: N, w: 2.4, text: 'ROPES LOWERED: 38. ROPES RETURNED: 38. RETURNED EMPTY: 37.' },
  // the hall floor on the safe line's walk west
  { id: 'bd-s2-bram', section: 's2', face: 'floor', x: -5.5, y: -35, z: 1.8, yaw: PI / 2, w: 2.4, style: 'cut', text: 'THIS FLOOR IS BRAM AND HIS BROTHERS. WALK SOFTLY.' },
  // the safe line's low ledge, south wall
  { id: 'bd-s2-settle', section: 's2', face: 'wall', x: -25.2, y: -41.4, z: 11, yaw: S, w: 2.6, text: 'IT TOOK TWO YEARS FOR THIS ONE COURSE TO FINISH SETTLING. DO NOT LEAN ON IT.' },

  // ---- S3 · Broken Gallery (closed in; the measure begins) -------------------------------------------------------------------
  // the landing's north wall, right of the checkpoint's view (the NINTH GALLERY board is behind you)
  { id: 'bd-s3-sealed', section: 's3', face: 'wall', x: 6.6, y: -64, z: -11, yaw: N, w: 2.6, text: 'THE NINTH WAS SEALED THREE TIMES: WITH LIME, WITH IRON, WITH THE NINE.' },
  // high on the south wall over the old cage's chain
  { id: 'bd-s3-cage', section: 's3', face: 'wall', x: -14.25, y: -58.6, z: 11, yaw: S, w: 2.4, text: 'THE CAGE CAME UP FORTY-ONE TIMES. IT WENT DOWN FORTY-TWO.' },
  // the north wall in front of a body hanging from the lower ring: the first measure, in the fresh hand
  { id: 'bd-s3-measure', section: 's3', face: 'wall', x: -29, y: -76.5, z: -11, yaw: N, w: 2.2, style: 'fresh', text: 'MEASURED HERE: FOURTEEN HANDS AND A KNOCK. NOT YET.' },
  // the south wall above the lower gallery
  { id: 'bd-s3-count', section: 's3', face: 'wall', x: -20.25, y: -88, z: 11, yaw: S, w: 2.6, text: 'THE GALLERY WAS CLOSED FOR NINE YEARS. WHEN IT WAS OPENED THE COUNT WAS HIGHER.' },
  // the north wall beside the winch gear
  { id: 'bd-s3-gear', section: 's3', face: 'wall', x: -18, y: -88.2, z: -11, yaw: N, w: 2.4, style: 'cut', text: 'THE GEAR WAS TURNED BY HAND FOR SIX YEARS. THEN IT WAS TURNED FROM INSIDE.' },
  // the shelf's floor (safe line)
  { id: 'bd-s3-small', section: 's3', face: 'floor', x: -29, y: -96, z: -4.6, yaw: N, w: 2.2, style: 'cut', text: 'FORGIVE THE SMALL STONES IN THIS COURSE.' },

  // ---- S4 · The Listening Vault (what the lamps are for; the knocks) ---------------------------------------------------------
  // the catwalk's east rail between its cold lamps
  { id: 'bd-s4-week', section: 's4', face: 'wall', x: -12.3, y: -104.5, z: -18.6, yaw: E, w: 1.8, style: 'cut', text: 'THIS LAMP WENT OUT ONCE. WE DO NOT SPEAK OF THE WEEK THAT FOLLOWED.' },
  // the catwalk's west rail by the rest
  { id: 'bd-s4-who', section: 's4', face: 'wall', x: -19.7, y: -104.5, z: -18.6, yaw: W, w: 1.8, style: 'cut', text: 'WHO LIT THIS LAMP? WHO IS STILL HOLDING IT?' },
  // across the catwalk deck, read walking out over the Vault
  { id: 'bd-s4-knock', section: 's4', face: 'floor', x: -16, y: -105, z: -13.3, yaw: 0, w: 2.4, style: 'cut', text: 'KNOCK ONCE: WE ARE HERE. KNOCK TWICE: WE ARE COMING. NEVER KNOCK THREE.' },
  // the landing's south wall
  { id: 'bd-s4-vault', section: 's4', face: 'wall', x: -3.4, y: -98.4, z: 11, yaw: S, w: 2.4, text: 'THE VAULT HOLDS NINE THOUSAND. IT WAS BUILT FOR SIX.' },
  // the south wall by the low lamp over the shelf
  { id: 'bd-s4-eleven', section: 's4', face: 'wall', x: -13.4, y: -123.6, z: 11, yaw: S, w: 2.4, text: 'WE COUNTED THE KNOCKS FOR ELEVEN YEARS. THEY ADD UP TO A NAME.' },
  // the plinth's west face
  { id: 'bd-s4-listen', section: 's4', face: 'wall', x: -12, y: -126.6, z: 4.2, yaw: W, w: 2.4, text: '~DO NOT LISTEN.~ LISTEN. IT IS THE ONLY WARNING YOU WILL GET.' },

  // ---- S5 · The Gullet Stair (what it is made of; who it comes for) ----------------------------------------------------------
  // the landing's north wall, right of the checkpoint's view
  { id: 'bd-s5-gathers', section: 's5', face: 'wall', x: -7.1, y: -150.4, z: -9, yaw: N, w: 2.4, text: 'IT DOES NOT HUNT THE WOUNDED. IT GATHERS THEM.' },
  // the second step's west face (a body lowered on the third ring reads it)
  { id: 'bd-s5-second', section: 's5', face: 'wall', x: -16, y: -168.75, z: 3.5, yaw: W, w: 2.2, style: 'cut', text: 'DO NOT BUILD THE SECOND STAIR AGAIN.' },
  // the third step's face (lowered on the fourth ring)
  { id: 'bd-s5-ours', section: 's5', face: 'wall', x: -8.5, y: -176.75, z: 4, yaw: S, w: 2.4, text: 'NINE WENT DOWN. NINE WERE COUNTED IN THE WALL. ONE OF THE NINE WAS NOT OURS.' },
  // the fifth step's face
  { id: 'bd-s5-names', section: 's5', face: 'wall', x: -15.5, y: -192.75, z: -4, yaw: N, w: 2.2, style: 'cut', text: 'WE TRIED TO NAME IT. IT HAS TOO MANY.' },
  // the last step's south wall, beside the keystone
  { id: 'bd-s5-keystone', section: 's5', face: 'wall', x: -16.1, y: -198.4, z: 9, yaw: S, w: 2.4, text: 'HE KNOCKED BACK. HE IS THE KEYSTONE NOW.' },

  // ---- S6 · The Two Descents (everything goes down) --------------------------------------------------------------------------
  // the fork's floor in front of the checkpoint, before the two plaques
  { id: 'bd-s6-third', section: 's6', face: 'floor', x: -12.6, y: -208, z: -2.4, yaw: 0, w: 2.4, style: 'cut', text: 'THERE WAS A THIRD WAY. IT WENT UP. WE FILLED IT.' },
  // the Long Stair's first shelf, north wall
  { id: 'bd-s6-steps', section: 's6', face: 'wall', x: -29.1, y: -216, z: -11, yaw: N, w: 2.4, text: 'THE STAIR HAS 1,440 STEPS. COUNT THEM. IF YOU COUNT 1,441, STOP.' },
  // the Long Stair's west wall above the second shelf: the corridor (the Dresser walks the stacks)
  { id: 'bd-s6-ticking', section: 's6', face: 'wall', x: -34, y: -221.4, z: -7.2, yaw: W, w: 2.2, style: 'cut', text: 'IF YOU HEAR TICKING, YOU ARE WHOLE. BE LESS WHOLE.' },
  // the second shelf, south wall: the measure again, in the fresh hand
  { id: 'bd-s6-measured', section: 's6', face: 'wall', x: -29.1, y: -228, z: 11, yaw: S, w: 2.4, style: 'fresh', text: 'MEASURED AGAIN: FOURTEEN HANDS AND A KNOCK. STILL TOO AFRAID.' },
  // the third shelf (the rest), north wall
  { id: 'bd-s6-rest', section: 's6', face: 'wall', x: -22.5, y: -239.4, z: -11, yaw: N, w: 2.4, text: 'REST UNDER THE LAMP. DO NOT REST LONGER THAN THE LAMP.' },
  // the fourth shelf, south wall
  { id: 'bd-s6-late', section: 's6', face: 'wall', x: -26.5, y: -251.4, z: 11, yaw: S, w: 2.4, text: 'THE LATE ARE NOT PUNISHED. THEY ARE USED SOONER.' },
  // the Throat: the divider's east face, seen from its frayed rings
  { id: 'bd-s6-throat', section: 's6', face: 'wall', x: -11, y: -221.5, z: -3, yaw: W, w: 3.2, text: 'THE THROAT WAS CUT IN FORTY YEARS. IT FILLED IN THREE DAYS.' },

  // ---- S7 · The Hollow Nave (what their work was) ----------------------------------------------------------------------------
  // the landing's north wall, right of the tablet
  { id: 'bd-s7-where', section: 's7', face: 'wall', x: -4, y: -286, z: -13, yaw: N, w: 2.4, text: 'WHERE DO THE FALLEN GO? WHERE ELSE WOULD WE PUT THEM?' },
  // the landing's west wall
  { id: 'bd-s7-cut', section: 's7', face: 'wall', x: -36, y: -286, z: -9.7, yaw: W, w: 2.4, text: 'WHAT WE #DID TO THEM# HERE, WE DID WITH LOVE.' },
  // the landing's south wall
  { id: 'bd-s7-left', section: 's7', face: 'wall', x: 8.7, y: -286, z: 13, yaw: S, w: 2.6, text: 'THE NAVE WAS NOT DESIGNED. IT IS WHAT WAS LEFT WHEN WE STOPPED ADDING.' },
  // the nave's north wall, large: read from the rings out in the nave
  { id: 'bd-s7-columns', section: 's7', face: 'wall', x: -4, y: -381.6, z: -40, yaw: N, w: 4, text: 'EACH COLUMN IS A FAMILY. THE TALL ONE IS STILL GROWING.' },
  // scratched into the iron perch, halfway down the spiral
  { id: 'bd-s7-spire', section: 's7', face: 'floor', x: -22.6, y: -349, z: 28.4, yaw: 0, w: 1.6, style: 'scratch', text: 'THE SPIRE POINTS HOME.' },

  // ---- S8 · The Last Throat (the truth about the descent) --------------------------------------------------------------------
  // the landing's north wall
  { id: 'bd-s8-books', section: 's8', face: 'wall', x: 13.6, y: -426, z: -20, yaw: N, w: 2.4, text: 'ONE LIGHT UP. ONE STILL ONE DOWN. THE BOOKS MUST BALANCE.' },
  // the first step's south ledge (the safe line), south wall
  { id: 'bd-s8-fed', section: 's8', face: 'wall', x: 0.4, y: -467.4, z: 20, yaw: S, w: 2.2, text: '~WE FED IT.~ NO. WE WERE FED.' },
  // the second step's east ledge (the safe line's last rest), east wall
  { id: 'bd-s8-she', section: 's8', face: 'wall', x: 13, y: -509.4, z: 2.6, yaw: E, w: 2.6, text: 'SHE CARRIED IT UP IN THE NIGHT. SHE LEFT THE PLACE EMPTY. BY MORNING THE WALLS WERE WALKING.' },
  // the throat's west wall near its foot
  { id: 'bd-s8-grate', section: 's8', face: 'wall', x: -12, y: -553, z: 6.5, yaw: W, w: 2.2, style: 'cut', text: 'THE GRATE IS NOT TO KEEP IT OUT.' },
  // the throat's foot, south wall left of the grate (bw-s8-ten is right of it): the fresh hand
  { id: 'bd-s8-short', section: 's8', face: 'wall', x: -9.4, y: -553.4, z: 10, yaw: S, w: 2.2, style: 'fresh', text: 'TOO SHORT. TOO WIDE. TOO AFRAID. NEXT.' },
  // the floor before the grate, read running into the chamber
  { id: 'bd-s8-arms', section: 's8', face: 'floor', x: -2, y: -556, z: 6.4, yaw: PI, w: 2.4, style: 'cut', text: 'KEEP YOUR ARMS AS THEY ARE. IT IS CUT THAT WAY.' },

  // ---- THE CHAMBER (the purpose at the bottom: THE FITTING) ------------------------------------------------------------------
  // the back wall, right of the Still Lamp as you face it: a life-size outline cut and chalked, your pose (lantern up, launcher down), the
  // heights the nine were measured at, all short of its head; XLI over it
  {
    id: 'bd-ch-figure', section: 's8', group: 'chamber', face: 'wall', x: -5.1, y: -554.9, z: 27, yaw: S, w: 1.05, aspect: 0.5, style: 'outline', text: 'XLI',
    marks: [['HOB', 0.86], ['HALLAM', 0.95], ['MAB', 0.83], ['WENNA', 0.79], ['TAMSIN', 0.9], ['COLL', 0.97], ['ISOLDE', 0.75]],
  },
  // the back wall over the Still Lamp: the last line of Chapter I, in the fresh hand
  { id: 'bd-ch-fits', section: 's8', group: 'chamber', face: 'wall', x: -2.4, y: -549.6, z: 27, yaw: S, w: 3.2, style: 'fresh', text: 'MEASURED FORTY TIMES. CUT ONCE. IT FITS NOW.' },
  // the floor between the statues, read walking in
  { id: 'bd-ch-whole', section: 's8', group: 'chamber', face: 'floor', x: -3, y: -556, z: 15.6, yaw: PI, w: 2.8, style: 'cut', text: 'FOR THE ONE WHO COMES DOWN WHOLE.' },
  // the ceiling, if you look up for the way out
  { id: 'bd-ch-stair', section: 's8', group: 'chamber', face: 'ceil', x: -3, y: -548, z: 18.5, yaw: PI, w: 3.2, style: 'cut', text: 'THERE IS NO STAIR UP. THERE NEVER NEEDED TO BE.' },
  // the west wall: the ledger of the measurings
  { id: 'bd-ch-ledger', section: 's8', group: 'chamber', face: 'wall', x: -9, y: -553.4, z: 19, yaw: W, w: 2, style: 'cut', text: 'I TO XL: NOT YET.\nXLI:' },
];
