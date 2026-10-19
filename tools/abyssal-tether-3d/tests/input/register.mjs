// Import first (statically) in a test, then load three.js and the game modules with
// dynamic import(): the hooks map "three" to the game's vendor/three for them.
import { register } from 'node:module';
import { VENDOR_THREE_URL } from '../../verify/root.mjs';

register('./hooks.mjs', import.meta.url, { data: { vendor: VENDOR_THREE_URL } });
