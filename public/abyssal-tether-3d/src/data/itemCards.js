/* THE LANTERN (ABYSSAL TETHER 3D) — itemCards.js
 * ITEM CARDS (docs/abyssal-tether-3d/plans/ITEM_CARDS.md): what the name card over a collectible says. Keyed by the bag's ITEM id
 * (sim/inventory3d.js) as plain numbers, so a kind added to the enum later needs no import here (tests/ux/item-card.mjs fails until it
 * has a card). FUEL_CARD is the jetpack's fuel can (sim/jetpack3d.js), which is not a bag item.
 *
 *   name     the card's title (ITEM_NAMES wins where it has the kind; the card draws it upper case)
 *   hint     the one line under it: what it does, from the real numbers (CONFIG.bag, JET, KNOCKER)
 *   use      { vr, desktop, touch }: how it is used, with the real input names (ui/tutorial.js wording)
 *   accent   '#rrggbb' frame / icon colour (muted, the dark realism palette)
 *   icon     glyph id drawn by render/itemCardView.js ('aid' | 'bandage' | 'syringe' | 'cell' | 'knocker' | 'grenade' | 'revolver' | 'fuel' | 'box')
 */
import { ITEM_NAMES } from '../sim/inventory3d.js';

/** The jetpack fuel can's card key (not a bag kind). */
export const FUEL_CARD = 16;

export const ITEM_CARDS = Object.freeze({
  0: Object.freeze({
    name: 'First aid kit',
    hint: 'Heals you fully (5 s)',
    use: { vr: 'hip + grip to apply', desktop: 'press 1 to apply', touch: 'tap BAG to apply' },
    accent: '#b8463c',
    icon: 'aid',
  }),
  1: Object.freeze({
    name: 'Bandage',
    hint: 'Heals a little (1.5 s)',
    use: { vr: 'hip + grip to apply', desktop: 'press 2 to apply', touch: 'tap BAG to apply' },
    accent: '#c9b48a',
    icon: 'bandage',
  }),
  2: Object.freeze({
    name: 'Adrenaline shot',
    hint: 'Twice as fast for 10 s',
    use: { vr: 'hip + grip to apply', desktop: 'press 3 to apply', touch: 'tap BAG to apply' },
    accent: '#d0743a',
    icon: 'syringe',
  }),
  3: Object.freeze({
    name: 'Lantern battery',
    hint: 'Refills half the lantern',
    use: { vr: 'hip + grip to apply', desktop: 'press 4 to apply', touch: 'tap BAG to apply' },
    accent: '#d9b24a',
    icon: 'cell',
  }),
  4: Object.freeze({
    name: 'Knocker',
    hint: 'Throw it: the Mason answers knocks',
    use: { vr: 'grip at hip, pull up', desktop: 'hold G, release', touch: 'BAG, then KNOCK' },
    accent: '#a8874e',
    icon: 'knocker',
  }),
  5: Object.freeze({
    name: 'Grenade',
    hint: 'Throw it: scares the Mason off',
    use: { vr: 'from the bag', desktop: 'from the bag', touch: 'from the bag' },
    accent: '#7f8f5a',
    icon: 'grenade',
  }),
  6: Object.freeze({
    name: 'Service revolver',
    hint: 'Fire it: a hit scares the Mason off',
    use: { vr: 'from the bag', desktop: 'from the bag', touch: 'from the bag' },
    accent: '#8a96a3',
    icon: 'revolver',
  }),
  [FUEL_CARD]: Object.freeze({
    name: 'Jetpack fuel',
    hint: 'Half a tank for the jetpack',
    use: { vr: 'both triggers in a fall', desktop: 'J in a fall', touch: 'JUMP in a fall' },
    accent: '#5fa7b4',
    icon: 'fuel',
  }),
});

const GENERIC_USE = Object.freeze({ vr: 'walk over it to take', desktop: 'walk over it to take', touch: 'walk over it to take' });
const _generic = new Map();

/**
 * The card of `kind`: its table entry (the name from ITEM_NAMES where it has one), else a generic card named from ITEM_NAMES
 * ("Supplies" when even that is missing). Cached: the same object for the same kind.
 */
export function cardFor(kind, names = ITEM_NAMES) {
  const k = kind | 0;
  const hit = _generic.get(k);
  if (hit && hit.names === names) return hit.card;
  const base = ITEM_CARDS[k];
  const nm = names && typeof names[k] === 'string' && names[k] ? names[k] : null;
  const card = base
    ? Object.freeze({ kind: k, name: nm || base.name, hint: base.hint, use: base.use, accent: base.accent, icon: base.icon, generic: false })
    : Object.freeze({ kind: k, name: nm || 'Supplies', hint: 'Something worth carrying', use: GENERIC_USE, accent: '#9a9284', icon: 'box', generic: true });
  _generic.set(k, { names, card });
  return card;
}

/** The hint line for a platform ('vr' | 'desktop' | 'touch'): "what it does · how". `full`: the bag (the tank, for fuel) has no room for it. */
export function cardHint(card, platform, full) {
  if (full) return card.kind === FUEL_CARD ? 'Your jetpack tank is already full' : 'Your bag has no room for this';
  const u = card.use && (card.use[platform] || card.use.desktop);
  return u ? `${card.hint} · ${u}` : card.hint;
}
