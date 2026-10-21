# Abyssal Tether: Meta Horizon Store release plan (WebXR PWA)

Prepared 2026-10-19 for the owner and the build agents. Scope: shipping the full-3D WebXR build in
`public/abyssal-tether-3d/` to the **Meta Horizon Store** as an **immersive WebXR PWA**, with a
**free demo (Chapter 1)** and a **$9.99 in-app unlock** of the full game (5 chapters, 2-3 hours).

Companion files:

| File | What it is |
|---|---|
| [vrc-checklist.md](vrc-checklist.md) | Every VRC with our status (unknown / likely-pass / needs-work) and the task that closes it |
| [pwa/manifest.draft.webmanifest](pwa/manifest.draft.webmanifest) | Proposed web app manifest for the game (not live) |
| [pwa/sw.draft.js](pwa/sw.draft.js) | Service worker draft: versioned precache, integrity-checked, offline shell |
| [pwa/gen-precache.mjs](pwa/gen-precache.mjs) | Generates `sw.js` from the draft plus a hashed precache list of a built game folder |
| [pwa/pwa-boot.draft.js](pwa/pwa-boot.draft.js) | Boot helpers: store-install detection, auto-enter VR, SW registration, persistent storage |
| [pwa/entitlement.draft.js](pwa/entitlement.draft.js) | Full-game unlock: Digital Goods API + Payment Request, restore, offline grace |
| [pwa/twa-manifest.template.json](pwa/twa-manifest.template.json) | Bubblewrap (Meta fork) config for an immersive PWA with Horizon Billing |
| [pwa/assetlinks.template.json](pwa/assetlinks.template.json) | Digital Asset Links file for `/.well-known/assetlinks.json` |
| [pwa/build-and-upload.sh](pwa/build-and-upload.sh) | Release-machine script: hosting preflight, build, APK checks, `ovr-platform-util` upload |
| [pwa/_headers.draft](pwa/_headers.draft) | Hosting headers (Cloudflare Pages / Netlify syntax) |

What was verified here, not just written:
- `twa-manifest.template.json` passes `TwaManifest.validate()` from Meta's own
  `@meta-quest/bubblewrap-core` 1.24.1. Its feature manager then adds the Horizon Billing payment
  activity for `https://quest.meta.com/billing` and the permissions listed in vrc-checklist.md.
- `sw.draft.js` + `gen-precache.mjs` were tested in headless Chromium on a scratch copy of the game
  served under a sub-path (the game itself was not modified). Results: 44 files / 7.4 MB
  precached; with the server stopped, a reload booted to the main menu and a deep link got the app
  shell; an update re-downloaded only the one changed file; a half-finished deploy (file changed
  after the list was generated) was rejected and players stayed on the previous build.
- `entitlement.draft.js` passed 9 scenario tests against a mocked billing service: no store,
  owned, not owned, offline grace, provider down, refund after 24 h, purchase, cancel, purchase
  outside the store.
- `npx eslint docs/abyssal-tether-3d/` passes, so `npm run lint` stays green.

---

## 1. What we are shipping (owner decisions)

| Decision | Value | Consequence in this plan |
|---|---|---|
| Store | Meta Horizon Store, as a WebXR PWA (Trusted Web Activity APK built with Meta's Bubblewrap fork) | §5-§12 |
| Business model | Free app; Chapter 1 free; one **durable** add-on unlocks Chapters 2-5 for **USD 9.99** | §10 |
| Scope at 1.0 | 5 chapters, about 2-3 h for a first-time player, studio-level polish | §17: content is the critical path; today's 556 m / 8-section descent is roughly one chapter |
| Movement | Full 3D, smooth turning, **no comfort options** | Comfort rating **Intense**; Accessibility.8 is a documented deviation (§16) |
| Engine | three.js r170, ES modules, no Unity | Packaging is engine-agnostic; performance is ours to prove (§14.2) |

## 2. Evidence and how to read this plan

- Every requirement below is quoted or closely paraphrased with a source tag like **[S5]**; the
  full URL list with retrieval dates is in §20.
- **Retrieval caveat.** `developers.meta.com` is blocked by this sandbox's network policy
  (`CONNECT 403`), so the Meta documentation pages were read through **search-engine excerpts of
  those official pages on 2026-10-19**, not by loading them directly. Quotes are what those excerpts
  showed. Before acting on any single requirement, open the page and re-read it; where excerpts
  conflicted, §19 says so and how to settle it.
- These were read **directly** from primary sources:
  - **[P1]** Meta's Bubblewrap fork: npm `@meta-quest/bubblewrap-cli` and `@meta-quest/bubblewrap-core`
    1.24.1 (published 2026-05-05), source `github.com/meta-quest/bubblewrap` at commit `7133ca6`
    (2026-09-16). The upstream Google package (`@bubblewrap/cli` 1.27.0) has **no** Horizon fields;
    use Meta's fork.
  - **[P2]** Meta's own agent playbooks `github.com/meta-quest/agentic-tools` at commit `3a8553d`
    (2026-09-23): `skills/hz-store-pwa/*` (PWA to Store pipeline), `skills/hz-store-submit/*`,
    `skills/hz-psdk-integration/references/data-use-checkup.md`.
  - **[P3]** W3C/WICG Digital Goods API explainer (`github.com/WICG/digital-goods`, `explainer.md`).
- Engineering facts about our build cite files under `public/abyssal-tether-3d/src/`.

## 3. Critical path and top risks

1. **Content volume** (5 chapters at studio polish) dominates the schedule (§17). Store plumbing is
   2-6 weeks; content is months.
2. **Immersive launch**: an installed immersive PWA has no 2D page. The game must request the XR
   session itself on load and show head-tracked frames (or a VR loading indicator) within
   **4 seconds** (VRC.Quest.Performance.3). Today it needs a 2D "Enter VR" click after a full asset
   load. Fix: tasks T1-T3 (§14).
3. **Hosting**: Digital Asset Links must be served at the **origin root**
   (`https://<domain>/.well-known/assetlinks.json`) or "An immersive PWA does not launch" **[S1]**.
   Our GitHub Pages project site (`https://kryshn7777.github.io/TradeCheckPro/...`) cannot serve the
   origin root. Needs a dedicated domain (§5).
4. **Public repository**: `kryshn7777/TradeCheckPro` is **public** (checked with the GitHub API on
   2026-10-19). Anything committed there (all chapters, all assets) is free to download, whatever
   the store charges. Move the game to a private repo before Chapters 2-5 land (§10.7).
5. **Frame rate** must be proven on device: 72 fps sustained over 45 minutes (§14.2).
6. **IAP unknowns** that only a device can answer: the PaymentRequest `data` shape, whether
   `listPurchases()` works offline, and whether a WebXR controller press counts as user activation
   for the purchase dialog (§19).
7. **One-way doors**: the signing key and package ID are permanent; tax details cannot be edited;
   submitting for review revokes provisional platform-feature access (§4, §10.2, §11).

## 4. Account and organization setup (owner)

| Step | Where | Notes / source |
|---|---|---|
| Meta developer account and **organization** | Meta Horizon Developer Dashboard (developers.meta.com/horizon/manage) | The Dashboard's Account area covers "Organization verification, Financial account ... and Notifications" **[S22]**. Turn on 2-factor auth. |
| Organization verification | Dashboard, Account | The current verification steps were not in the excerpts we could read; follow the Dashboard prompts. An older notice said developers "must verify their accounts by providing a payment method and/or phone number" **[S22b]**. |
| **Developer Distribution Agreement** | `https://developers.meta.com/horizon/manage/organizations/<ORG_ID>/legal-documents/` | Without it, the first upload fails with "must first agree to our Developer Distribution Agreement"; only an org admin can sign **[P2 store-upload.md]**. Also read the fee terms there (Meta's 2022 statement was a 30% platform fee **[S27]**). |
| **Financial account** (payouts + tax) | Team menu, Payment Information | Required to charge for apps or add-ons. Collects country, business type, name, address, tax ID. "once submitted, tax information generally cannot be changed"; non-US sellers file W-8BEN / W-8BEN-E or face US withholding. Payouts start above a USD 100 monthly threshold **[S21]**. |
| Team members | Dashboard, Members | Add the engineers who upload builds (or use the App Secret on one release machine). |

## 5. Hosting and domain

The Store APK is only a shell: it opens the live website in a Trusted Web Activity. "Web-only fixes
need only a ... redeploy: the installed TWA picks them up on the next launch" **[P2]**. So the
website **is** the product, and hosting needs:

| Requirement | Why | GitHub Pages project site today | Recommended |
|---|---|---|---|
| HTTPS, stable origin you control forever | Package and asset links are bound to the origin | `kryshn7777.github.io` (personal, shared) | Own domain, e.g. `abyssaltether.com` (owner buys) |
| `/.well-known/assetlinks.json` at the **origin root** | TWA verification; an immersive PWA does not launch without it **[S1]** | Not possible from a project site (`/TradeCheckPro/` path) | Root of the new domain |
| Custom headers (`sw.js` no-cache, manifest MIME type) | SW update reliability; manifest must be served as `application/manifest+json` **[P2]** | No header control | Cloudflare Pages, Netlify or Vercel (atomic deploys); `pwa/_headers.draft` |
| Private source | §10.7 | Public repo | Private repo deploying to the host |

Proposed URL layout on the new origin:

```
https://<domain>/                         landing page: store link, support, credits
https://<domain>/privacy/                 privacy policy (VRC.Quest.Privacy.1)
https://<domain>/support/                 support contact
https://<domain>/.well-known/assetlinks.json
https://<domain>/play/                    the game (manifest scope "/play/", sw.js scope "/play/")
https://<domain>/beta/                    staging copy for ALPHA/BETA builds (§12)
```

Keep the policy and support pages **outside** `/play/`: the service worker answers every navigation
inside its scope with the game shell.

Deploy pipeline (to be added by the game agent when the move happens): copy the game folder to
`dist/play/`, add `manifest.webmanifest` and `icons/`, run
`node docs/abyssal-tether-3d/pwa/gen-precache.mjs --root dist/play --template docs/abyssal-tether-3d/pwa/sw.draft.js --out dist/play/sw.js --version <semver>+<gitsha> --max-core-mb 60`,
add `/.well-known/assetlinks.json`, deploy atomically. Never deploy files one by one: the SW
integrity check rejects mixed builds, which protects players but delays the update.

## 6. App creation in the Developer Dashboard

1. Create the app **before** packaging: Meta's packaging guide says to create the app and get its
   Application ID first **[S2]**. Platform: Meta Quest. Note the numeric **App ID**.
2. API tab: generate the **App Secret** for `ovr-platform-util` uploads. Store it in a password
   manager; never in a repo or on the web host **[P2]**.
3. Choose the Android **package ID** once, e.g. `com.<studio>.abyssaltether`. It is permanent
   (§11).
4. Upload a first ALPHA build (§11); the add-on SKU and monetization APIs need "at least one APK
   uploaded" **[S6][S7]**.
5. Supported devices (owner decision): Quest 3 and Quest 3S at launch; Quest 2 only if it passes the
   frame-rate VRC (§14.2). Supported input: **Touch controllers** (see T9 for hand tracking).

## 7. Web app manifest for an immersive WebXR PWA

Meta: "Your app must include a manifest.json (or manifest.webmanifest) file that defines your app's
metadata" **[S1]**. The overview asks for `display` "standalone or fullscreen for immersive
experiences", "at least one icon at 512x512 pixels", and `orientation` "landscape for VR
experiences" **[S1]**. `start_url` must stay inside `scope`; Bubblewrap resolves both against the
manifest URL and uses a 512 px or larger icon **[S4]**.

Draft: [pwa/manifest.draft.webmanifest](pwa/manifest.draft.webmanifest) (to be copied to
`public/abyssal-tether-3d/manifest.webmanifest` by the game agent, with
`<link rel="manifest" href="manifest.webmanifest">` in `index.html`).

| Field | Value | Why |
|---|---|---|
| `id` | `"./"` | Stable app identity independent of `start_url` |
| `start_url` / `scope` | `./index.html` / `./` | Relative, so the same file works at `/play/` and `/beta/` |
| `display` | `standalone` | Meta's fork forces `standalone` for immersive mode anyway **[P1 init.js]** |
| `orientation` | `landscape` | **[S1]** (the APK uses `default` for immersive, set by the fork) |
| `icons` | 192 any, 512 any, 512 maskable (full-bleed, opaque), 1024 any | Launcher + splash; "The maskable icon must be full-bleed and opaque" **[P2]**; 1024 covers the larger icon spec in §13 |
| colors | `#08090a` | Matches `index.html` theme |
| **"xr"** | **No such member.** | Neither the manifest spec nor Meta's current docs define an `xr` key. Immersive vs 2D is chosen in the **APK**: `horizonOSAppMode: "immersive"` in `twa-manifest.json`, emitted as `horizonos.pwa.APP_MODE` meta-data plus `com.oculus.intent.category.VR` **[P1]**. The old `ovr_package_name` manifest key belonged to the retired `ovr-platform-util create-pwa` flow **[S28]**. |

The icon files do not exist yet for the 3D build (task T6); the 2D game's
`public/abyssal-tether/icons/` can serve as placeholders for ALPHA.

## 8. Immersive launch: auto-enter VR within 4 seconds

- Meta: WebXR PWAs should launch straight into immersive mode, so "call the requestSession API
  right after the page is loaded"; "clicking the PWA app icon is considered user action to create a
  WebXR session" **[S3]**.
- VRC.Quest.Performance.3: head-tracked graphics within 4 s of launch, or a loading indicator in VR.
  "because WebXR PWAs launch directly into immersive mode, pre-loaded assets count against this
  requirement"; "it's a best practice to load as many assets as possible after the WebXR session
  initiates" **[S1]**.
- Meta's pipeline gates the auto-enter on the Digital Goods API so it "runs only in the installed
  PWA, never a browser tab" **[P2]**. A wrong `horizonOSAppMode` is "the classic failure mode: ... an
  immersive app set to `2D` shows a browser URL bar" **[P2]**.

What changes in our code (owner: game agent; helpers in `pwa/pwa-boot.draft.js`):

1. Split `Game3D.boot()` into `bootMinimal()` (renderer, XR hooks, input, the in-VR loading panel:
   lantern glow + "Lowering the lantern...") and `bootContent()` (texture manifest, creature GLB,
   level view, audio, shader precompile).
2. In `main.js`: `if (isStoreInstall()) autoEnterVR(() => game.enterVR())` immediately after
   `bootMinimal()`; do not await any network before `requestSession`.
3. The VR menu (UI3D in-VR panels) is the first screen in the store build; the DOM menu stays for
   desktop and browser tabs.
4. Ask for a stable frame rate after session start: `session.updateTargetFrameRate(72)` when
   `supportedFrameRates` includes it ("Browser version 16.4 and higher has support for new WebXR
   APIs that let you query and set the current frame rate" **[S11]**).
5. If the session ends while the app is still open (error, or the OS ends it), show a 2D panel
   with a "Return to VR" button (a 2D click is a valid user activation). Behaviour to confirm on
   device (§19 Q5).

## 9. Service worker and offline strategy

Why: fast cold starts (Performance.3), play without network (Functional.7), and consistent
builds. Meta's PWA overview also notes PWAs "do not run in the background when the user switches to
another app" **[S1]**, so nothing here relies on background work.

Design ([pwa/sw.draft.js](pwa/sw.draft.js), generated into `sw.js` by
[pwa/gen-precache.mjs](pwa/gen-precache.mjs)):

| Tier | Contents | When downloaded | Strategy |
|---|---|---|---|
| core | `index.html`, CSS, all `src/**`, `vendor/three/**`, manifest, icons, Chapter 1 assets (today: everything, 44 files / 7.4 MB) | SW install, all-or-nothing | cache-first from `at3d/<scope>:core-<version>` |
| lazy | `assets/chapters/ch2..ch5/**`, video (paths reserved for future packs) | first use, or `WARM` message after unlock | cache-first, filled at runtime, carried over between versions |
| shell | any navigation inside the scope | from core | app shell; offline notice only if the cache was evicted |
| untouched | non-GET, cross-origin (Meta billing, payment UI), `Range` requests, `sw.js` | network | pass-through |

Properties:
- **Per-file SHA-256 revisions.** Unchanged files are copied from the previous version's cache, so
  an update downloads only what changed (tested: 1 of 44 files).
- **Integrity check.** Each download must match its revision, or the install fails and is retried
  later, so a half-finished upload never reaches players (tested).
- **No mid-session swaps.** No automatic `skipWaiting()`. A new build activates on the next cold
  launch, or from the main menu via `applyUpdateNow()` (it reloads, which ends XR, so never call it
  in a session).
- **Scoped cache names** (`at3d/play/:...` vs `at3d/beta/:...`) so staging and production on one
  origin never delete each other's caches.
- `requestPersistentStorage()` asks the browser not to evict caches and saves (Functional.4).
  Quest Browser's storage quota for PWAs is not documented; log `storageReport()` on device (§19).
- Budget: keep the core tier under 60 MB (`--max-core-mb 60` fails the build otherwise); ship
  textures as KTX2 when chapters grow.
- First launch with no network cannot be helped by a service worker (none installed yet); the
  platform shows its own error. The store description should say "internet required for first
  launch".

## 10. In-app purchase: free demo + $9.99 full-game unlock

### 10.1 Facts from Meta [S5][S6][S7] and the APK [P1]

- Horizon OS supports IAP in PWAs **only through the Digital Goods API, only in WebXR PWAs**;
  "Subscriptions are not currently supported" **[S5]**.
- The service is "only available for WebXR PWAs that are installed from the Meta Horizon Store
  (including ALPHA and BETA channels)"; call `window.getDigitalGoodsService('https://quest.meta.com/billing')`
  **[S5]**. It rejects when the provider is unavailable **[P3]**.
- Item IDs are the add-on **SKUs**; "There is no function to get a list of item IDs", so hard-code
  them **[S5]**.
- `listPurchases()` returns "all durable type purchases and any consumable type purchases that have
  not been consumed"; "Meta Horizon Store doesn't support purchase history, so listPurchaseHistory
  returns the same data as listPurchases" **[S5]**.
- Purchases go through the **Payment Request API** with the billing URL as payment method; a system
  purchase dialog appears **[S5]**. In the APK, Meta's fork registers `PaymentActivity` for
  `org.chromium.intent.action.PAY` with `default_payment_method_name = https://quest.meta.com/billing`
  and adds the `com.meta.androidbrowserhelper:horizonbilling` library **[P1 HorizonBillingFeature]**.
  Horizon Billing is only added when `alphaDependencies` is enabled **[P1 FeatureManager]**.
- IAP is a Platform SDK feature that requires the **Data Use Checkup** **[S5]**.
- SKUs: "SKUs can only contain alphanumeric characters, periods, dashes, and underscores", "The SKU
  is case-sensitive"; durable items: "Once the item has been purchased, it cannot be purchased again"
  **[S7]**.
- Optional server check: `graph.oculus.com/<APP_ID>/verify_entitlement` with an app token, `user_id`
  and `sku` returns `{"success":true,"grant_time":...}`; S2S APIs "are not required" **[S6]**.

### 10.2 Dashboard setup (owner)

1. Upload an ALPHA APK built with Horizon Billing on and the real `applicationId` (§11).
2. **Data Use Checkup**: request only the **In-app purchases / DLC** grant (that grant gates `iap.*`
   and a missing grant throws) **[P2 data-use-checkup.md]**. Two one-way doors **[P2]**:
   "Submitting for review revokes provisional access" until the evaluation completes, and
   "Requesting a release channel above 200 non-developer users ends on-the-spot approval". So
   finish IAP testing before submitting, and keep BETA under 200 external users until DUC is
   approved.
3. Monetization > Add-ons > create: **SKU `abyssal_tether_full_game`**, type **Durable**, name
   "Abyssal Tether: The Full Descent", description (required to fetch by SKU **[S7]**), price
   **USD 9.99**, add-on art. Let the Dashboard derive regional prices or set them by hand.
4. Optional: show the add-on on the store page (opt-in in the Dashboard **[S29]**).

### 10.3 Client flows (draft: `pwa/entitlement.draft.js`)

| Flow | Behaviour |
|---|---|
| Launch | `Entitlement.init()` runs in the background (never blocks the XR session). A cached "owned" answer shows immediately so a buyer never sees the demo flash, then `listPurchases()` confirms. |
| Chapter gate | `canPlayChapter(n)`: Chapter 1 always; 2-5 only when `state === 'full'`. Locks show on the chapter select and at the end of Chapter 1. |
| Unlock | End-of-Chapter-1 panel and main menu: "Unlock the full descent - <price>" (price string from `getDetails()`), "Restore purchases", "Back". `purchase()` opens the store dialog. On success, unlock at once, continue into Chapter 2, confirm with `listPurchases()` in the background. Cancel returns to the panel. |
| Restore | Settings > Purchases > "Restore purchases" = `refresh()` (durables always come back from `listPurchases()`). |
| Dialog and pause | The system dialog takes focus: the session goes `visible-blurred`, and the existing `_xrVisibilityChanged()` pauses the game. On return, refresh the entitlement and resume on the unlock panel. |
| Second user on the headset | Entitlement is per signed-in user (`listPurchases()`); the local cache lives in that user's storage (Functional.12). |

### 10.4 User activation inside VR (engineering risk)

`PaymentRequest.show()` needs a user activation. In VR there is no DOM click; our UI reads buttons
by polling the gamepad (`intent.ui.click`), and a polled button press is **not** an activation. The
only browser-dispatched input events in an immersive session are the `XRSession` `selectstart` /
`select` / `selectend` events (the controller's primary action), so the "Unlock" button must call
`purchase()` **synchronously inside a `select` (or `selectend`) handler** for the hand pointing at
the button (task T11). Whether Quest Browser counts that event as user activation for the payment
dialog is **not confirmed** in anything we could read: test it first on ALPHA (§19 Q3). If it does
not, ask Meta developer support how WebXR PWAs are expected to start a purchase.

### 10.5 Offline grace

- After one successful verification, the durable unlock is cached (`abyssalTether3d.v1.entitlement`)
  and honoured offline **indefinitely**; it is re-verified on every online launch.
- A fresh purchase not yet visible in `listPurchases()` is honoured for 24 h (propagation).
- The unlock is removed only by an authoritative online answer that lacks the SKU, more than 24 h
  after the grant (refund case).
- Offline with no cached answer: Chapter 1 plays; the gate says "Connect to the internet once to
  restore your purchase" (Functional.7).

### 10.6 Outside the store install

Browser tab on Quest, desktop browser, sideloaded debug APK: there is no Digital Goods API, so the
game runs as the **demo** (Chapter 1) and the gate says "The full descent is available on the Meta
Horizon Store". There is no external payment link. Cached flags are **ignored** outside the store
install, so a localStorage edit in a browser tab unlocks nothing (tested).

### 10.7 Anti-tamper: what a web app can and cannot do

What cannot be prevented: the TWA loads public URLs, so any file the store build can download, a
browser can download too; any client-side check can be flipped in devtools. A pure static web game
cannot enforce payment against a determined user. Plan for the realistic goal, which is that buying
is easier than bypassing:

1. **Make the source private** (owner). Today's repo is public, which is the largest leak by far:
   the code and every asset are browsable and cloneable. Git history is permanent, so do this
   before Chapters 2-5 are committed. Chapter 1 being public is fine; it is the free demo.
2. Store-only unlock path (§10.6): no URL flag, no debug unlock in production builds.
3. Chapters 2-5 live as **separate lazy packs** (`assets/chapters/chN/`), fetched only after
   unlock, with unguessable content-hashed file names generated at build time; level data for later
   chapters is not bundled in Chapter 1 code.
4. Minify and bundle the production build (an esbuild step) so the gate is not a one-line edit.
5. Optional later, stronger: serve the chapter packs from an edge function that requires a signed
   token, issued by a small server after `verify_entitlement` **[S6]**. Blocker: that call needs the
   player's Meta `user_id`, and how a PWA obtains a verified user ID is not documented in what we
   could read (Meta's fork does bundle a `horizonplatformsdk` bridge **[P1]**). Investigate after
   1.0; it adds a server, cost and an online requirement.

### 10.8 IAP test plan (ALPHA)

1. Device in developer mode, tester added to ALPHA, app installed **from the Store** (sideloads have
   no billing).
2. Use Meta test users / test payment methods for add-ons (Dashboard; see "Testing Add-ons" **[S30]**).
3. Cases: fresh install shows demo; buy, unlock without restart; kill the app and relaunch: still
   full; airplane mode relaunch: still full; restore on a second headset with the same account;
   second user on the same headset: demo; refund via Dashboard/support: demo after 24 h; cancel the
   dialog: stays demo; dialog while the creature is hunting: game paused, nobody dies behind the
   dialog.

## 11. Packaging with Bubblewrap (exact commands)

Tooling: Meta's fork **`@meta-quest/bubblewrap-cli@1.24.1`** (the version Meta's guide was verified
with **[S2]**; `engines.node >= 18` **[P1]**). Do this on the owner's release machine, not in CI,
because it touches the permanent signing key.

```bash
# 0. Tools (once)
node --version                                   # must be >= 18
npm i -g @meta-quest/bubblewrap-cli@1.24.1        # binary: bubblewrap
bubblewrap doctor                                # the first bubblewrap command offers to install Temurin JDK 17.0.11 + the Android SDK; accept both
KT=$(find ~/.bubblewrap/jdk -path '*/bin/keytool' | head -1)

# 1. Signing key (ONCE, forever). Outside every repo and web folder. Back it up twice offline.
mkdir -p ~/secure && chmod 700 ~/secure
"$KT" -genkeypair -v -keystore ~/secure/abyssal-tether.keystore -alias abyssaltether \
  -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Abyssal Tether, O=<Studio>, C=<CC>"
"$KT" -list -v -keystore ~/secure/abyssal-tether.keystore -alias abyssaltether | grep SHA256
#   -> SHA256: AB:CD:...  (the colon-hex fingerprint for assetlinks.json)
```

"Every future update must use the same signing certificate" **[S2]**; "A lost keystore means a new
app entry" **[P2]**.

Option A, interactive (a human at a terminal):

```bash
mkdir -p ~/release/abyssal-tether-twa && cd ~/release/abyssal-tether-twa
bubblewrap init --manifest="https://<domain>/play/manifest.webmanifest" --metaquest
```

| Prompt | Answer |
|---|---|
| App mode for your PWA in Meta Horizon OS? | `immersive` |
| Domain / URL path | `<domain>` / `/play/index.html` |
| Application name / Launcher name | `Abyssal Tether` / `Abyssal` (the launcher-name validator allows at most 12 characters **[P1]**) |
| Application ID (package) | `com.<studio>.abyssaltether` (permanent) |
| Starting version code | `1` |
| Background colour, icon URLs | `#08090A`, `https://<domain>/play/icons/icon-512.png`, maskable `icon-maskable-512.png` |
| Include support for Horizon Billing? | **Yes** (enables `alphaDependencies`) |
| Meta Horizon Application ID | the numeric App ID from §6 |
| Request microphone permission? / XR Scene (USE_SCENE)? | **No** / **No** (Security.2: minimum permissions) |
| Key store location / alias | `~/secure/abyssal-tether.keystore` / `abyssaltether` |

Option B, scripted (no TTY needed; Meta's own playbook recommends it for automation **[P2]**): copy
[pwa/twa-manifest.template.json](pwa/twa-manifest.template.json) to
`~/release/abyssal-tether-twa/twa-manifest.json` and replace every `__TOKEN__`
(`__DOMAIN__` = `play.example.com` without scheme, `__GAME_PATH__` = `/play/`, and so on).

```bash
cd ~/release/abyssal-tether-twa
bubblewrap fingerprint add <SHA256-colon-hex> --name=release   # writes ./assetlinks.json and updates twa-manifest.json
# publish ./assetlinks.json at https://<domain>/.well-known/assetlinks.json (or fill pwa/assetlinks.template.json)
export BUBBLEWRAP_KEYSTORE_PASSWORD='...' BUBBLEWRAP_KEY_PASSWORD='...'   # never in shell history files
bubblewrap update --appVersionName=1.0.0      # regenerates the Android project, bumps appVersionCode
bubblewrap build                              # -> app-release-signed.apk (+ an .aab Quest does not use)
```

Check the APK before it leaves the machine (`pwa/build-and-upload.sh build` does all of this, plus
a hosting preflight that refuses to continue if a keystore is publicly reachable):

```bash
BT=$(ls -d ~/.bubblewrap/android_sdk/build-tools/* | sort -V | tail -1)
"$BT/apksigner" verify --verbose --print-certs app-release-signed.apk   # v2 scheme, SHA-256 == keystore
"$BT/aapt" dump xmltree app-release-signed.apk AndroidManifest.xml | grep -A1 -E 'APP_MODE|OCULUS_APP_ID|category.VR'
"$BT/aapt" dump permissions app-release-signed.apk
curl -s https://<domain>/.well-known/assetlinks.json
```

Sideload for a quick look (Quest in developer mode): `bubblewrap install --apkFile=app-release-signed.apk`
or `adb install -r app-release-signed.apk`. Billing does not work in a sideload (§10.1); test IAP
from ALPHA.

Upload **[S12][P2]**:

```bash
./ovr-platform-util upload-quest-build \
  --app-id <APP_ID> --app-secret <APP_SECRET> \
  --apk app-release-signed.apk \
  --channel ALPHA --age-group TEENS_AND_ADULTS \
  --notes "shell 1.0.0 (code N) / web 1.0.0+<gitsha>" --disable-progress-bar
```

`--age-group` (`TEENS_AND_ADULTS | MIXED_AGES | CHILDREN`) is the mandatory age-group
self-certification **[S12][S18]**. Meta's alternative uploader is `metavr store dist upload`
(npm `@meta-quest/metavr`) **[P2]**. Uploading never submits for review; that is a Dashboard button
**[P2]**.

## 12. Versioning, release channels and device testing

Two version numbers:

| What | Format | Changes when | Shown where |
|---|---|---|---|
| **Web build** | `MAJOR.MINOR.PATCH+<gitsha>`, e.g. `1.0.0+3f2a1c9` | Every deploy (`gen-precache.mjs --version`) | Settings > About (via `serviceWorkerVersion()`), SW cache names, bug reports |
| **APK shell** | `appVersionName` semver + `appVersionCode` integer | Native changes only: name, icon, package, app mode, billing config, start URL, permissions, Bubblewrap version | Dashboard |

- `appVersionCode` must **strictly increase across every upload on every channel**, even builds
  never released **[P2]**. Keep one counter in the release notes.
- Save data carries a schema version (`abyssalTether3d.v1.*`); add migrations instead of renaming
  keys (Functional.4).
- Consequence of the TWA model: the LIVE app always runs whatever is deployed at `/play/`. Treat a
  production deploy like a store release: only deploy builds that passed RC on device. Store review
  approves the APK; later web changes are not re-reviewed, but every policy still applies (§19 Q13).

Channels (`ALPHA`/`BETA`/`RC` for testing; production is `STORE` in Meta's upload playbook and
`LIVE` in its submission playbook: check `ovr-platform-util get-release-channel-data` **[P2][S12]**):

| Channel | Who | Web path the APK opens | Purpose |
|---|---|---|---|
| ALPHA | Owner + developers | `/beta/` | Every candidate build; IAP testing with test users |
| BETA | External playtesters, **under 200** until DUC is approved (§10.2) | `/beta/` | Pacing, difficulty, comfort, horror-tuning feedback |
| RC | Owner + reviewers' proxy | `/play/` (pre-launch) | Exact submission candidate; full VRC sweep |
| LIVE / STORE | Players | `/play/` | Production |

A `/beta/` APK is the same package and key built from a second `twa-manifest.json` whose
`startUrl`, `webManifestUrl` and `fullScopeUrl` point at `/beta/`; asset links cover the whole
origin. Add testers in the Dashboard's release-channel settings (exact screen not confirmed in the
excerpts; §19 Q14).

Device matrix for every RC: Quest 3 and Quest 3S (plus Quest 2 if targeted), latest Horizon OS;
standing and seated; Wi-Fi on and off; second user account; long-press recenter; headset off and
on; Universal Menu; Change Boundary; purchase dialog; 45-minute soak per chapter with OVR Metrics
Tool.

## 13. Store assets

Meta asset specifications **[S13]** (confirm in the Dashboard uploader; the playbook in [P2] lists
some different sizes, noted below):

| Asset | Size | Format | Notes |
|---|---|---|---|
| Hero cover | 3000 x 900 | 24-bit PNG | Keep titles and focal points in the safe area; use Meta's templates |
| Cover landscape | 2560 x 1440 | 24-bit PNG | VRC.Quest.Asset.2/.3: branding only, no taglines, no text in bleed areas |
| Cover square | 1440 x 1440 | 24-bit PNG | |
| Cover portrait | 1008 x 1440 | 24-bit PNG | |
| Mini landscape | 1080 x 360 | 24-bit PNG | |
| Logo | up to 9000 x 1440 | 32-bit PNG, transparent | VRC.Quest.Asset.1 |
| Icon | 512 x 512 (Meta asset table) | 24-bit PNG | [P2] lists 1024 x 1024: make a 1024 master, export both |
| Screenshots | 2560 x 1440, at least 3 **[P2]** | PNG/JPEG | Captured on device from the RC build; no added text or logos (Asset.5); optional "Captured on Meta Quest 3" label (Asset.10) |
| Trailer | 30-60 s, 1920 x 1080 or 2560 x 1440, MP4/MOV (recommended) **[P2]** | | Trailers may show more than key art, but no gore (§16) |
| Add-on art | per Dashboard | | For the "Full Descent" add-on |

Listing text limits **[P2]**: name 30 characters, short description 150, long description 4000.
Draft:

- **Name**: Abyssal Tether
- **Short** (121 characters): "Descend a buried cathedral-machine on two grappling tethers while
  something vast hunts you from above. Chapter 1 is free."
- **Long description outline**: hook; two-handed tether movement (swing, reel, yank, chain); the
  Mason; 5 chapters and 2-3 hours; difficulties Normal/Nightmare/Abyss/Sandbox; "Chapter 1 free,
  full descent USD 9.99 in-app"; **comfort warning** (intense smooth locomotion, falls, no comfort
  options); internet needed on first launch; Touch controllers required.

Content rules for marketing **[S14][S15]**: key art and cover images are judged most strictly; no
blood filling the screen or splattering at the viewer, no "graphic depictions of internal organs or
soft-tissue wounds" in any asset. Keep the Mason's flesh textures out of close-up key art.

## 14. VRCs mapped to engineering tasks

Full per-VRC table: [vrc-checklist.md](vrc-checklist.md). "PWAs need to adhere to the same
policies and Virtual Reality Checks (VRCs) as other apps in the Horizon Store" **[S1]**.

### 14.1 Tasks

| ID | Task | VRC / reason | Owner (files) | Done when |
|---|---|---|---|---|
| T1 | Split `boot()` into `bootMinimal()` / `bootContent()`; in-VR loading panel | Performance.3 | game (`src/game.js`) | First head-tracked frame within 4 s of the icon tap on Quest 3, cold and warm |
| T2 | Auto-enter VR in the store install (`isStoreInstall()`, `autoEnterVR()`) | §8, [S3] | game (`src/main.js`) | Launch from the Library goes straight into VR; browser tab still shows "Enter VR" |
| T3 | Register `sw.js`, persistent storage, update-at-menu, version in About | Performance.3, Functional.4/.7 | game + ui | Second launch with Wi-Fi off boots into VR |
| T4 | `session.updateTargetFrameRate(72)` + dev perf overlay (fps, calls, tris, frame ms) | Performance.1 | render (`src/render/renderer3d.js`) | Overlay shows a steady 72 on device |
| T5 | WebGL context-loss handling (pause, rebuild, resume) | Functional.1 | render + game | Forced `WEBGL_lose_context` test recovers without reload |
| T6 | Web manifest + icon set (192, 512, 512 maskable, 1024) + `<link rel="manifest">` | §7 | game (`index.html`) + art | `bubblewrap init` accepts the manifest |
| T7 | Chapter structure + progress save (versioned, write on checkpoint) | Functional.3/.4; 5 chapters | game + level | Kill the app mid-chapter, relaunch, continue at the checkpoint |
| T8 | Entitlement module from `entitlement.draft.js`; chapter gate; unlock / restore UI in VR and DOM | §10 | game + ui | §10.8 test plan passes on ALPHA |
| T9 | Controllers-only: drop `'hand-tracking'` from `XR_OPTIONAL_FEATURES`; "Pick up your Touch controllers" pause state | Input.4-8 | input (`src/input/xrInput.js`, `inputManager.js`) + ui | Putting controllers down pauses with the prompt; picking them up resumes |
| T10 | Focus loss: hide gauntlets, lasers, reticles **and ropes**; ignore input; mute interactive audio | Input.4, Functional.2 | input + render + audio | Universal Menu over gameplay shows no hands/ropes; nothing advances |
| T11 | Purchase button fires inside an XR `select` event handler | §10.4 | input + ui | Store dialog opens from the VR panel |
| T12 | Brightness/exposure setting with a calibration image | Accessibility.5 (and perceived quality) | render + ui | Setting persists; dark scenes readable on all headsets |
| T13 | Captions for key sounds + visual threat cue (toggle) | Accessibility.1 | audio + ui | Game completable with sound off |
| T14 | Seated mode / height calibration (`XR_HEAD_OFFSET` from measured head height) | Accessibility.9 | game + ui | Seated tester completes Chapter 1 |
| T15 | Soft-lock detector offering "Respawn at checkpoint" | Functional.3 | game | No reproducible stuck state in BETA |
| T16 | Production build: bundle + minify, chapter packs as hashed lazy files, deploy to the new host | §5, §10.7 | game + release | `gen-precache.mjs` shows Chapter 2-5 packs in the lazy tier |
| T17 | 45-min soak per chapter, crash log capture (`chrome://inspect`, `adb logcat`) | Functional.1, Performance.1 | release | No crash, no sustained drop below 72 fps |
| T18 | Legibility pass + "Large text" option for VR panels | Accessibility.2 | ui | Testers read every panel at arm's length |

### 14.2 Performance plan (Performance.1)

- Requirement wording differs between Meta pages: "72 frames per second ... on boot, by default"
  **[S9]** versus "maintain a rendering rate (fps) of at least 60 fps" at an allowed refresh rate,
  measured over "the length of the content or 45 minutes, whichever is shorter" **[S10 Perf.1]**.
  **Target 72 fps sustained**; it satisfies both.
- Quest Browser defaults vary by headset ("90 frames per second on Meta Quest 2 and 72 frames per
  second on Meta Quest headsets" **[S11]**; Quest 3 not stated). Request 72 explicitly (T4); move to
  90 only with measured headroom.
- Budgets from `CONTRACT3D.md`: 150 draw calls, 350k visible triangles, at most 1 shadow light, no
  post-processing, `setFoveation(1)`, no per-frame allocation. Add a dynamic framebuffer-scale
  fallback (0.9 / 0.8) for worst-case scenes; Meta treats it as a last resort **[S31]**.
- Measure with the OVR Metrics Tool overlay on device in the heaviest scenes (creature burst + two
  ropes + debris + section transitions), plus thermal state after 30 minutes.

## 15. Privacy policy outline

Requirements: a "publicly available, easily accessible privacy policy, served over https with a
trusted certificate", owned by the team (not a support site or Meta's policy, not hosted on another
VR store); Meta crawls the URL daily and three consecutive failures can get the app flagged
**[S16]**. VRC.Quest.Privacy.2-4: say what is collected, how it is used, and how to request deletion
**[S25]**.

Outline for `https://<domain>/privacy/` (owner writes and publishes; have it reviewed if in doubt):

1. **Who we are**: studio name, contact email, postal address if required in your country.
2. **Scope**: Abyssal Tether on Meta Quest (Store app) and the web version at `<domain>`.
3. **What we collect**: nothing that identifies you on our servers. The game stores settings, best
   times, progress and a purchase-status cache **only on your headset** (browser local storage and
   cache). We run no analytics, ads or third-party SDKs. (If this ever changes, update this page and
   the Data Use Checkup first.)
4. **Purchases**: the full-game unlock is sold and processed by Meta; Meta's privacy policy covers
   payment and account data. We receive only whether your account owns the add-on.
5. **Hosting logs**: our host (name it) records standard request logs (IP address, user agent,
   time) for security and delivery, kept for N days.
6. **How it is used**: to run the game, remember your settings and progress, and restore purchases.
7. **Children**: not directed at children under 13 (age group Teens and Adults).
8. **Deleting your data**: clear the app's storage (Quest Settings > Apps > Abyssal Tether >
   Clear data, or uninstall), or email us to delete anything we hold (we hold no account data).
   Purchases are tied to your Meta account; Meta handles their deletion.
9. **Your rights** (GDPR/CCPA wording as applicable), **changes to this policy**, **effective date**.

## 16. Age, comfort and content rating answers (draft for the owner)

**Comfort rating: Intense.** Meta's help page describes Intense as content with "significant camera
movement, player motion, or disorienting content", and Meta judges "the default experience"
**[S20]**. Smooth artificial locomotion, swinging, long falls and smooth turning with no comfort
options sit squarely there. Under-rating it is a known rejection reason ("Comfort rating mismatch"
**[P2]**).

**Age group self-certification: Teens and Adults** ("mandatory for all apps"; options Teens and
Adults, Mixed Ages, Children **[S18]**).

**IARC questionnaire** (Dashboard > Submission Info > Content Ratings; free, "results are provided
instantaneously" **[S19]**). Draft answers to confirm against the build:

| Topic | Draft answer |
|---|---|
| Violence | Fantasy violence: a non-human creature can catch and kill the player character. Death is shown as a fade to black with sound; **no blood, no gore, no dismemberment**; the player never attacks anything. |
| Fear / horror | **Yes**: sustained horror atmosphere, a predator stalks the player, sudden lunges (jump scares). |
| Blood / gore | None. |
| Language | None. |
| Sexual content / nudity | None. |
| Drugs, alcohol, tobacco | None. |
| Gambling / simulated gambling | None. |
| User-to-user interaction, chat, user-generated content | None (single player, offline-capable). |
| Shares location / personal information | No. |
| Digital purchases | **Yes**: in-app purchase (one durable full-game unlock). |

Expected outcome: roughly Teen / PEGI 12-16 territory for horror and fantasy violence; IARC decides
per region.

**Content Guidelines**: Meta is "likely to accept content that generally falls within the threshold
of an R-rating for a movie" and prohibits "excessively violent content (including cannibalism,
glorification of gore, and dismemberment)" **[S15]**. The current build is well inside that.

## 17. Timeline (indicative; today is Monday 2026-10-19 = week 0)

| Weeks | Dates (approx.) | Store and engineering | Content |
|---|---|---|---|
| 0-2 | Oct 19 - Nov 1 | Owner: org, DDA, payout/tax, domain + host, private repo, App ID/secret, package ID, keystore. Eng: T1, T2, T6, manifest + SW live on the new host; first ALPHA APK; DUC; SKU created | Chapter 1 scope locked (current descent becomes Chapter 1) |
| 3-6 | Nov 2 - Nov 29 | T3-T5, T8-T11 on ALPHA; §10.8 IAP tests; first on-device perf and VRC sweep | Chapter 1 polished to release quality (the vertical slice that sets the bar) |
| 7-22 | Dec 2026 - Mar 2027 | BETA (under 200 users) per finished chapter; T7, T12-T18; perf per chapter; trailer capture | **Chapters 2-5** (the critical path: about 4 weeks per chapter for a small team at studio polish) |
| 23-25 | Apr 2027 | RC build; full VRC sweep; store art, listing, IARC, comfort, privacy policy live | Bug fixing only |
| 25-27 | Apr - May 2027 | Submit at least two weeks before launch ("submit your app for review at least two weeks in advance of your target launch date" **[S23]**); review typically 1-2 weeks **[P2]**; fix and resubmit if needed | |
| Launch | **May 2027 (earliest credible)** | Release now or on a scheduled date from the Dashboard **[S23]** | |

Optional (owner decision): launch the **free Chapter 1 earlier** (about January 2027) to build
ratings and wishlists, and add the paid unlock with Chapters 2-5 as an update. Trade-off: a public
demo is judged on its own, and the unlock cannot be sold before its content exists.

Not used: Meta's **Try Before You Buy** is a 15-30 minute trial of a **paid** app, during which
in-app purchases are unavailable **[S24]**. It is the fallback if Digital Goods IAP turns out not
to work in our case (then: paid app at USD 9.99 plus a trial), but it does not fit the free-demo
decision, and its availability for PWAs is unconfirmed.

## 18. OWNER ACTIONS (only a human can do these)

### 18.0 Free Chapter I release: the short list (updated 2026-10-20, state of WP-RELEASE)

Code side is done and checked (immersive boot, PWA, saves, resilience, governor, dormant entitlement, store pack,
`npm run build:at3d-release` -> `dist-at3d/web` + `dist-at3d/twa`; evidence in [pwa/WP_RELEASE.md](pwa/WP_RELEASE.md)).
What only you can do, in order:

1. **Fill the owner details** in `tools/abyssal-tether-3d/release/release.config.json` (`owner`: studio, contact email,
   domain, postal address, effective date, host name, log retention; `bubblewrap`: package ID, Meta App ID, keystore
   path/alias). The build warns until no `<placeholder>` is left; it fills the privacy / support pages and the TWA manifest.
2. **Meta developer organization**, 2FA, **Developer Distribution Agreement**; financial account / tax only if you will
   ever sell something (not needed for a free app with no add-ons, but needed before the paid unlock) (sections 4, 18.1).
3. **Domain + host with header control** (Cloudflare Pages / Netlify / Vercel). Deploy `dist-at3d/web/` atomically
   (it already contains `play/`, `privacy/`, `support/`, `_headers`); add `/.well-known/assetlinks.json` once you have the
   keystore fingerprint (`twa/assetlinks.template.json`). GitHub Pages can only serve the beta copy (no origin root).
4. **Signing keystore** + **package ID** + **Meta App ID/Secret**; build the APK with `docs/abyssal-tether-3d/store/BUBBLEWRAP.md`
   (`dist-at3d/twa/` has the filled `twa-manifest.json` and `build-and-upload.sh`). Keep the keystore out of every repo.
5. **Headset checks (cannot be done in the sandbox)**: first head-tracked frame under 4 s from the Library icon (cold and warm;
   `AT3D.debug.platform().bootTimes`), 72 fps in the heaviest sections with OVR Metrics Tool (tune the governor
   thresholds / level-0 foveation in `src/platform/governor.js`), offline relaunch with Wi-Fi off, Universal Menu /
   controllers-down pause, forced context loss (`AT3D.debug.loseContext()`), second launch after an update.
6. **Store page**: paste text from `docs/abyssal-tether-3d/store/LISTING.md` (title, short, long, tags, comfort **Intense**,
   age group **Teens and Adults**, IARC draft answers, Data Use Checkup: no grants), upload `store/art/*` and
   `store/screenshots/*` (replace with 2560 x 1440 Quest 3 captures if you can; re-run `npm run capture:at3d-store` and
   `npm run art:at3d-store` after the last visual change), privacy URL (`https://<domain>/privacy/`), support URL.
7. **Approve the deviations**: no comfort options beyond what Settings ships (Accessibility.8), two-handed design
   (Accessibility.4) (vrc-checklist.md).
8. **Upload ALPHA/BETA, test, press Submit for Review** (uploads never submit), submit at least two weeks before the
   release date (section 17).
9. **Paid unlock (later)**: create SKU `abyssal_tether_full_game`, Data Use Checkup IAP grant, private repo, only when
   Chapters II-V exist (18.1 items 6, 11, 12).

### 18.1 Full list (including the later paid unlock)

Accounts, legal, money:
1. Create/verify the Meta developer **organization**; enable 2-factor auth (§4).
2. Sign the **Developer Distribution Agreement** as org admin; read its fee terms (§4).
3. Set up the **financial account** (bank + tax forms). Tax data cannot be edited later (§4).
4. Decide **supported devices** (recommended: Quest 3 + 3S; Quest 2 only after perf proof) and
   **controllers-only** input (T9).

Domain, code, keys:
5. Buy the **domain**; choose a host with header control (Cloudflare Pages / Netlify / Vercel) (§5).
6. Move the game into a **private repository** before Chapters 2-5 are committed (§10.7).
7. Create the app in the Dashboard; record the **App ID**; generate the **App Secret** and keep it
   in a password manager (§6).
8. Choose the permanent **package ID** (`com.<studio>.abyssaltether`) (§6).
9. Generate the **signing keystore** on your machine; back it up in two offline places and store the
   passwords in a password manager. Losing it means a new store listing (§11).
10. Install `@meta-quest/bubblewrap-cli@1.24.1` and `ovr-platform-util` on the release machine
    (§11).

Store configuration:
11. Complete the **Data Use Checkup** (In-app purchases / DLC grant only), mindful of the two
    one-way doors (§10.2).
12. Create the durable add-on **`abyssal_tether_full_game`** at **USD 9.99** (§10.2).
13. Add ALPHA/BETA testers and IAP test users; keep BETA under 200 until DUC is approved (§12).
14. Write and publish the **privacy policy** and a **support** email/URL (§15).
15. Complete **IARC**, **age group (Teens and Adults)** and **comfort (Intense)** (§16).
16. Commission or produce **store art**, logo, icon and trailer; approve on-device screenshots (§13).
17. Approve the documented deviations: no comfort options (Accessibility.8), two-handed design
    (Accessibility.4) (vrc-checklist.md).
18. Decide the **launch shape** (full launch vs earlier free Chapter 1) and confirm regional
    pricing (§17).
19. Press **Submit for Review** in the Dashboard (uploads never submit) and choose the release date
    (§11, §17).

## 19. Open questions, ambiguities and how to verify

| # | Question | Why unclear | How to settle |
|---|---|---|---|
| Q1 | Exact PaymentRequest `data` for Meta billing: `{ sku }`, `{ itemId }` or both? | The excerpt of [S5] stopped before the purchase code; the WICG explainer says the format "is up to the store" [P3]; Google uses `{ sku }`. | Read the full [S5] page; on ALPHA try `{ sku }` first (the draft's choice). |
| Q2 | Does `listPurchases()` work offline? | Not documented. | Airplane-mode test on ALPHA; the draft already falls back to the cached answer. |
| Q3 | Is a WebXR controller `select` event a valid user activation for `show()` on Quest Browser? | Not stated in Meta's excerpts or in the spec text we could reach; it is the only browser-dispatched input event in a session. | T11 device test, first thing on ALPHA; if it fails, ask Meta developer support (forum "Web" category). |
| Q4 | Does the purchase dialog blur or end the XR session? | Not documented. | Device test; the game pauses on blur either way. |
| Q5 | What does an immersive PWA show if its XR session ends while the app is open? | Not documented. | Device test; T2 includes a "Return to VR" 2D fallback. |
| Q6 | Does the 4 s Performance.3 window start at icon tap or at session start? | The VRC says "launch". | Assume the icon tap; measure with a stopwatch video on device. |
| Q7 | Performance.1: 72 fps or 60 fps minimum? | [S9] and [S10] differ. | Target 72 (passes both). |
| Q8 | `minSdkVersion` 23 (Meta's Bubblewrap fork default) vs `>= 29` (Meta's native-app submission playbook [P2]) | Different Meta sources, different app types. | First ALPHA upload validation; raise to 29 in `twa-manifest.json` if rejected. |
| Q9 | Production channel name for uploads: `STORE` or `LIVE`? | [P2] uses both in different playbooks. | `ovr-platform-util get-release-channel-data --app-id ...` lists the real names [S12]. |
| Q10 | Store icon 512 x 512 [S13] or 1024 x 1024 [P2]? | Conflicting sources. | Make a 1024 master; the Dashboard uploader validates. |
| Q11 | Any policy against a free app selling a full-game unlock? | No policy found either way; free apps with add-ons are explicitly supported [S29]. | Ask Meta developer support before content lock; describe the model plainly in the listing. |
| Q12 | Web push on Quest Browser | [S1] says not supported; browser release notes say v33.3 added it as experimental [S26]. | Irrelevant: we do not use notifications. |
| Q13 | Expectations for web updates after approval (the TWA always loads the live site) | Not stated in what we read. | Keep RC discipline (§12); ask Meta support if planning big post-launch content drops. |
| Q14 | Where testers are added to channels | Exact Dashboard screen not in excerpts. | Dashboard > the app > Distribution / Release channels. |
| Q15 | Quest Browser storage quota for an installed PWA | Not documented. | `storageReport()` on device after installing all chapters. |
| Q16 | VRC pages we could not read: Performance.2, Accessibility.3/.10, Asset.4/.6/.7/.9 | Not in search results. | Read them on the VRC guidelines page [S8] before ALPHA. |
| Q17 | How a PWA gets a verified Meta user ID (for server-side unlock checks) | Not documented in what we read. | Only needed for §10.7 step 5; investigate after 1.0. |
| Q18 | Does `POST_NOTIFICATIONS` (needed for Horizon Billing per Meta's CLI) pass Security.2? | Meta's CLI error text says billing requires `enableNotifications`, but the code does not enforce it [P1]. | Keep it on; justify in the Dashboard; test billing with it off only if review objects. |

## 20. Sources

Meta pages, all retrieved **2026-10-19** through search-engine excerpts (direct fetch blocked from
this sandbox):

- [S1] Progressive Web Apps (overview): https://developers.meta.com/horizon/documentation/web/pwa-overview/
- [S2] Package a PWA for Meta Quest: https://developers.meta.com/horizon/documentation/web/pwa-packaging/
- [S3] Getting Started with WebXR PWAs: https://developers.meta.com/vr/documentation/web/pwa-webxr/
- [S4] Get started with PWA packaging (manifest fields): https://developers.meta.com/vr/documentation/web/pwa-overview-gs/
- [S5] In-app purchases in WebXR PWAs: https://developers.meta.com/vr/documentation/web/ps-iap/
- [S6] Add-ons Server APIs (web): https://developers.meta.com/horizon/documentation/web/ps-iap-s2s/
- [S7] Setting up add-ons: https://developers.meta.com/vr/resources/add-ons-setup/
- [S8] Meta Quest VRC guidelines: https://developers.meta.com/vr/resources/publish-quest-req/
- [S9] Common VRC failures and best practices: https://developers.meta.com/horizon/resources/publish-common-vrc-failures/
- [S10] Individual VRC pages, pattern `https://developers.meta.com/horizon/resources/vrc-quest-<area>-<n>/`, read: performance-1, performance-3, functional-1/2/3/4/5/6/9/10/12/13/14, input-1/2/3/4/5/7/8, security-1/2, privacy-1, packaging-5/6, asset-1/2/3/5/8/10, accessibility-1/2/4/5/6/7/8/9, audio-1
- [S11] WebXR App Framerate Control: https://developers.meta.com/horizon/documentation/web/webxr-frames/
- [S12] OVR Platform Utility command line tool: https://developers.meta.com/vr/resources/publish-reference-platform-command-line-utility/
- [S13] Asset design guidelines: https://developers.meta.com/vr/resources/asset-guidelines/
- [S14] Store marketing materials guidelines: https://developers.meta.com/horizon/resources/store-marketing-materials/
- [S15] Content Guidelines: https://developers.meta.com/horizon/policy/content-guidelines/
- [S16] Privacy Policy Requirements: https://developers.meta.com/horizon/policy/privacy-policy/
- [S17] Complete data use checkup: https://developers.meta.com/horizon/resources/publish-data-use/
- [S18] Age group self-certification: https://developers.meta.com/vr/resources/age-groups/
- [S19] Developer FAQ (IARC): https://developers.meta.com/vr/faqs/
- [S20] Comfort ratings: https://www.meta.com/help/quest/331713305046406/ and https://developers.meta.com/vr/policy/app-policies/
- [S21] Manage your financial account: https://developers.meta.com/vr/resources/publish-account-management-bank-tax/
- [S22] Developer Dashboard overview: https://developers.meta.com/vr/resources/publish-developer-dashboard-overview/ ; [S22b] Verify your developer account: https://developers.meta.com/horizon/blog/verify-your-developer-account-by-october-21/
- [S23] Submitting your app (Distribute and grow): https://developers.meta.com/horizon/resources/publish-submit/
- [S24] Try before you buy: https://developers.meta.com/vr/resources/try-before-you-buy/
- [S25] Designing for safety and privacy (Privacy VRCs 2-5): https://developers.meta.com/horizon/design/safetyprivacy/
- [S26] Browser developer release notes: https://developer.oculus.com/documentation/web/browser-release-notes
- [S27] Road to VR on Meta's 30% fee (2022, secondary): https://roadtovr.com/john-carmack-oculus-cto-meta-fee-structure-critique/
- [S28] web.dev, PWAs on Oculus Quest 2 (older `ovr-platform-util create-pwa` flow): https://web.dev/articles/pwas-on-oculus-2
- [S29] Monetization / add-ons on free and paid apps: https://developers.meta.com/horizon/resources/monetization and https://developers.meta.com/horizon/resources/add-ons/
- [S30] Testing Add-ons: https://developers.meta.com/horizon/documentation/spatial-sdk/ps-iap-test/
- [S31] WebXR performance optimization workflow: https://developers.meta.com/horizon/documentation/web/webxr-perf-workflow/

Primary sources read directly on 2026-10-19:

- [P1] `@meta-quest/bubblewrap-cli` / `@meta-quest/bubblewrap-core` 1.24.1 (npm, published 2026-05-05) and https://github.com/meta-quest/bubblewrap at `7133ca6` (2026-09-16): `cmds/init.js`, `cmds/shared.js`, `TwaManifest.ts`, `features/HorizonBillingFeature.js`, `features/HorizonPlatformSDKFeature.js`, `features/FeatureManager.ts`, `template_project/app/src/main/AndroidManifest.xml`, `template_project/app/build.gradle`
- [P2] https://github.com/meta-quest/agentic-tools at `3a8553d` (2026-09-23): `skills/hz-store-pwa/SKILL.md` and `references/{app-modes,manifest-and-icons,bubblewrap-packaging,store-upload,troubleshooting}.md`; `skills/hz-store-submit/SKILL.md` and `references/{submission-checklist,rejection-troubleshooting}.md`; `skills/hz-psdk-integration/references/data-use-checkup.md`
- [P3] WICG Digital Goods API explainer: https://github.com/WICG/digital-goods/blob/main/explainer.md
