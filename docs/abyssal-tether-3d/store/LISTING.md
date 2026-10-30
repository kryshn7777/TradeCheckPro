# Abyssal Tether: Meta Horizon Store listing pack (free release, Chapter I)

Everything the owner pastes into the Developer Dashboard for the **free Chapter I release**. Limits are Meta's
(RELEASE.md section 13): name 30 characters, short description 150, long description 4000. Character counts below
were measured with `node tools/abyssal-tether-3d/release/check-listing.mjs` (it re-checks them from this file).

**Verify against the final build before pasting** (these depend on work packages that land after this text was
written; edit this file, not the Dashboard, and re-run the checker):

- [ ] controls in "How you move" match the final tutorial wording (WP-UX)
- [ ] comfort options: this text states what ships today (smooth locomotion, no teleport); if WP-UX adds a comfort
      vignette or seated toggle to Settings, add one sentence to "Comfort" and keep the rating **Intense**
- [ ] the creature description matches the final design (WP-CREATURE-*)
- [ ] screenshots in `screenshots/` and art in `art/` were regenerated from the final build
      (`npm run capture:at3d-store`, then `npm run art:at3d-store`)
- [ ] supported devices: Quest 3 + Quest 3S (Quest 2 only after a measured 72 fps pass, RELEASE.md section 14.2)

## Dashboard fields

| Field | Value |
|---|---|
| Title | `Abyssal Tether` (14 characters; must equal the title on the cover art, VRC.Quest.Asset.2) |
| Price | Free. No add-ons at launch (the dormant SKU `abyssal_tether_full_game` is NOT created until Chapters II-V exist) |
| Category / genres | Games: Action, Adventure |
| Tags | horror, climbing, physics, single player, atmospheric |
| Player modes | Single user (offline-capable after the first launch) |
| Supported input | Meta Quest Touch controllers (hand tracking is not supported) |
| Supported devices | Meta Quest 3, Meta Quest 3S |
| Comfort rating | **Intense** (see "Comfort rating" below) |
| Age group (self-certification) | **Teens and Adults** (`--age-group TEENS_AND_ADULTS` on upload) |
| Languages | English |
| Privacy policy URL | `https://<domain>/privacy/` (built from `PRIVACY_POLICY.md`) |
| Support URL / email | `https://<domain>/support/` (built from `SUPPORT.md`), `<support@your-domain>` |
| Website | `https://<domain>/` |
| Release notes (1.0.0) | see "Release notes" |

## Short description (max 150)

```
Descend a buried cathedral-machine on two grappling tethers while something vast hunts you from above. Chapter I is free.
```

## Long description (max 4000)

```
Something is following you down.

Abyssal Tether is a physical VR descent. You carry two tether launchers, one on each wrist, and a single lantern. Below you is a buried cathedral-machine of carved stone, rusted ironwork and broken galleries, more than half a kilometre deep. There is no floor you can trust and no way back up.

HOW YOU MOVE
- Fire a tether with each trigger and swing across the dark. Hold the trigger to stay attached, release to let go.
- Squeeze a grip to yank a taut line and throw yourself higher. Reel in or pay out with the right stick. The winch slips under load, so a late catch hurts.
- Chain your hands: swing, release, catch, swing. Momentum is the whole game, and every long fall is a decision.
- Move and steer in the air with the left stick, turn with the right stick, jump with A, pause with B. Hold Y to recenter.

THE DESCENT
- Chapter I is a complete descent in eight sections, from the Threshold to the Last Throat. Each one teaches a new idea and then asks you to use it under pressure.
- Checkpoints keep a bad fall from costing you everything. Your best times, deepest descent and fewest deaths are kept for each difficulty.
- Four difficulties. Normal is the intended descent. Nightmare gives you a faster hunter, tighter aim and fewer recovery anchors. Abyss has no checkpoints and almost no help, for speedrunners. Sandbox removes the hunter and the lethal falls so you can practise the tethers at your own pace.

THE THING ABOVE YOU
Something vast lives in the walls of this place. It listens. It follows you down the shaft, and the way you move, the noise you make and the light you carry decide when it finds you. You never fight it. You only outpace it.

BUILT FOR THE HEADSET
- Your real height is used 1:1, with a calibration step and a seated option.
- Spatial audio: you will hear it before you see it.
- Plays offline once it has been downloaded. The first launch needs an internet connection to fetch the game (about 65 MB).

COMFORT
Comfort rating: Intense. Abyssal Tether uses smooth artificial movement, swinging, long falls and thumbstick turning, and it contains sudden scares. If you are new to VR, start in Sandbox, take breaks, and stop if you feel unwell. Touch controllers are required; hand tracking is not supported.

CONTENT
Horror atmosphere, sudden loud sounds and peril. No blood, no gore.
The radio voices in this version are AI-generated (text-to-speech) placeholders, not human actors.

Chapter I is free and ends on a hook. The descent continues in future updates.
```

## Comfort rating: Intense

Meta judges the default experience. Smooth artificial locomotion, swinging at speed, falls of tens of metres and smooth
turning with a thumbstick are "significant camera movement, player motion" (Meta comfort page): **Intense**.
Under-rating is a known rejection reason ("Comfort rating mismatch"). Do not pick Moderate.

## Age group: Teens and Adults

Mandatory self-certification (Teens and Adults / Mixed Ages / Children). Horror and peril: Teens and Adults.

## IARC questionnaire: draft answers (Dashboard > Submission Info > Content Ratings)

Answer against the final build; these are written for the free Chapter I build as it is today.

| Topic | Draft answer |
|---|---|
| Violence | Fantasy violence, mild: the player character can be killed by a creature or by falling. Death is a fade to black with sound. **No blood, no gore, no dismemberment.** The player never attacks anything. |
| Fear / horror | **Yes**: sustained horror atmosphere, a predator that stalks the player, sudden scares and loud sounds. |
| Blood and gore | None. |
| Language | None. |
| Sexual content / nudity | None. |
| Controlled substances (drugs, alcohol, tobacco) | None. |
| Gambling / simulated gambling | None. |
| Discrimination / hate | None. |
| User-to-user interaction, chat, user-generated content | None (single player, no accounts, no network features). |
| Shares the user's location or personal information | No. |
| Digital purchases | **No** in this release (free, no in-app purchases). Change to Yes only when the paid unlock ships. |
| Ads | None. |
| Online features | The game is downloaded from the web on first launch and cached; there is no multiplayer and no server-side game state. |

Expected outcome: roughly Teen / PEGI 12-16 territory because of horror; IARC decides per region.

## Content-guideline notes (marketing material)

Meta judges key art and covers most strictly: no blood, no gore, no soft-tissue or organ close-ups, no "graphic
depictions of internal organs". The covers, hero and screenshots in `art/` and `screenshots/` come from the real game
(stone, light, ropes, the shaft) and show none of that. If the creature's final design is organic and graphic, keep it
out of key art and show it at distance, in silhouette.

## Data Use Checkup (for the Dashboard)

Request **no** platform-data grants for the free release: the game reads no Meta account data and the dormant
entitlement module is not called with a purchase. Add the "In-app purchases / DLC" grant only when the paid unlock
ships (RELEASE.md section 10.2; mind the one-way doors there).

## Accessibility statement (optional field)

Seated play with height calibration; all interactions can be done from a fixed position; sound cues are spatial;
two-handed tether controls are required (documented deviation from Accessibility.4 in vrc-checklist.md).

## Release notes (1.0.0)

```
First release. Chapter I: a complete descent in eight sections, four difficulties (Normal, Nightmare, Abyss, Sandbox),
checkpoints, best-time records. Plays offline after the first launch.
```

## Art and screenshot manifest (all generated from the real game; `keyart/` holds the raw renders the covers are built from)

| File | Size | Dashboard slot |
|---|---|---|
| `art/hero-3000x900.png` | 3000 x 900 | Hero (cover, wide) |
| `art/cover-landscape-2560x1440.png` | 2560 x 1440 | Cover, landscape |
| `art/cover-square-1440x1440.png` | 1440 x 1440 | Cover, square |
| `art/cover-portrait-1008x1440.png` | 1008 x 1440 | Cover, portrait |
| `art/mini-1080x360.png` | 1080 x 360 | Mini landscape |
| `art/icon-1024.png`, `art/icon-512.png` | 1024 / 512 | App icon (24-bit PNG, opaque) |
| `art/logo-transparent.png` | 2880 x 1440 | Logo (32-bit PNG, transparent) |
| `screenshots/shot-01..10.jpg` | 1920 x 1080 | Screenshots (at least 3 required; Meta prefers 2560 x 1440 captured on a Quest 3: replace with device captures before submission if possible) |
| `screenshots/hero-2880x1600.jpg` | 2880 x 1600 | Press / hero render |
