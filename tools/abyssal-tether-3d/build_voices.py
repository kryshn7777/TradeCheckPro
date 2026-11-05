#!/usr/bin/env python3
"""ABYSSAL TETHER 3D: build the radio voice clips (docs/abyssal-tether-3d/plans/VO_SCRIPT.md, VO_DIRECTION.md).

For every voiced line of tools/abyssal-tether-3d/voice/lines.csv (regenerated first from src/sim/comms3d.js and, for Chapter II,
src/data/chapter2-text.js `radio`):
  1. a HUMAN RECORDING tools/abyssal-tether-3d/voice/recordings/<id>.wav wins (48 kHz 24-bit dry takes; see VO_SCRIPT.md);
  2. otherwise the AI PLACEHOLDER, PERFORMED: Kokoro-82M v1.0 text-to-speech (full-precision fp32 ONNX, Apache-2.0) directed line
     by line by tools/abyssal-tether-3d/voice/performance.json: a blended voice per speaker (style tensors mixed by weight), the
     line rendered PHRASE BY PHRASE (each phrase its own speed and pitch, stressed words forced in the phonemes and lifted 2 dB)
     and joined with measured silences, false starts cut from the speech itself, synthesised breaths / exhales / half-laughs,
     a trailing-off fade, and per-line fx (close, breathy, hushed, off mic). A line over its max length is fitted by shortening
     the pauses first, then by speaking a little faster (<= 1.16x).
Each clip is high-passed (70 Hz), gain-normalised per clip to -23 LUFS integrated (linear gain, peak held under -1 dBFS: no
compressor, no radio effect: the game's radio chain does the band-pass, squelch, static, dropouts), encoded mono 24 kHz Opus in
Ogg (32 kb/s, bit-exact muxing) to
    public/abyssal-tether-3d/assets/audio/voice/<speaker>/<id>.ogg
and word-aligned (PocketSphinx forced alignment, phrase by phrase for the AI takes; a proportional split when the aligner fails)
so the game's stuck-word glitch can repeat a real word. public/abyssal-tether-3d/assets/audio/voice/manifest.json lists every
clip (duration, words, source, the script text hash); lines with no clip (the UPLINK breathing) are listed under "fallback".

  python3 tools/abyssal-tether-3d/build_voices.py --fetch          # once: fetch + verify the Kokoro fp32 model + voices (Hugging Face)
  python3 tools/abyssal-tether-3d/build_voices.py                  # render / convert everything, write the manifest
  python3 tools/abyssal-tether-3d/build_voices.py --only s7-hang   # some lines only (the rest of the manifest is kept)
  python3 tools/abyssal-tether-3d/build_voices.py --no-ai          # no AI engine: convert recordings, keep current AI clips
  python3 tools/abyssal-tether-3d/build_voices.py --report out.md  # + the per-clip table (duration, peak, loudness, bytes)
  python3 tools/abyssal-tether-3d/build_voices.py --demo out.ogg   # + an offline mix through an approximation of the radio
Needs: ffmpeg (libopus, rubberband), node, and pip install -r tools/abyssal-tether-3d/voice/requirements.txt
"""
import argparse
import csv
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
VOICE_DIR = os.path.join(HERE, 'voice')
LINES_CSV = os.path.join(VOICE_DIR, 'lines.csv')
PERFORMANCE = os.path.join(VOICE_DIR, 'performance.json')
RECORDINGS = os.path.join(VOICE_DIR, 'recordings')
CACHE = os.path.join(VOICE_DIR, '.cache')
ENGINE_DIR = os.path.join(CACHE, 'kokoro-fp32')
OUT_DIR = os.path.join(REPO, 'public', 'abyssal-tether-3d', 'assets', 'audio', 'voice')
MANIFEST = os.path.join(OUT_DIR, 'manifest.json')

SR = 24000  # the shipped clips: mono 24 kHz Opus
BITRATE = '32k'
TARGET_LUFS = -23.0
PEAK_CEIL_DB = -1.0
BUDGET_BYTES = 2_500_000  # all shipped clips together (tests/comms/voice.mjs holds the same budget)
LIVE = ('live', 'ch2')  # lines.csv statuses the build voices (ch2: Chapter II's radio)

# ---- the AI placeholder engine (pinned, verified) ----------------------------------------------------------------------------
# The full-precision export of Kokoro-82M v1.0 (not the q8 quantisation the first placeholders used), pinned to one revision of
# the onnx-community repository; every file is checked against its SHA-256 (the repository's own LFS object ids).
ENGINE = {
    'name': 'Kokoro-82M v1.0 (ONNX, fp32)',
    'licence': 'Apache-2.0 (model and voices: hexgrad/Kokoro-82M; ONNX export: onnx-community/Kokoro-82M-v1.0-ONNX)',
    'url': 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/',
    'model': 'onnx/model.onnx',
    'model_bytes': 325_532_232,
    'model_sha256': '8fbea51ea711f2af382e88c833d9e288c6dc82ce5e98421ea61c058ce21a34cb',
}
# The official voice style tensors (510 x 1 x 256 float32 each) the cast blends from (voice/performance.json `cast`)
VOICE_SHA256 = {
    'af_heart': 'd583ccff3cdca2f7fae535cb998ac07e9fcb90f09737b9a41fa2734ec44a8f0b',
    'af_nicole': 'cd2191ab31b914ed7b318416b0e4440fdf392ddad9106a060819aa600a64f59a',
    'af_kore': '9be5221b6a941c04b561959b8ff0b06e809444dcc4ab7e75a7b23606f691819e',
    'am_puck': 'fcf73c989033e9233e0b98713eca600c8c74dcc1614b37009d5450ff4a2274a0',
    'am_fenrir': 'c27989f741f7ee34d273a39d8a595cc0837d35f5ced9a29b7cc162614616df43',
    'am_michael': '1d1f21dd8da39c30705cd4c75d039d265e9bc4a2a93ed09bc9e1b1225eb95ba1',
    'am_onyx': 'da5d135b424164916d75a68ffb4c2abce3d7d5ccc82dd1ee6cf447ce286145e6',
    'bf_emma': '669fe0647f9dd04fcab92f1439a40eeb4c8b4ab1f82e4996fe3d918ce4a63b73',
    'bf_isabella': '3754352c4aaa46d17f27654ab7518d65b62ad6163a0f55a5f4330c2da2c4e94f',
    'bm_george': 'c4b235a4c1f2cd3b939fed08b899ce9385638b763f7b73a59616c4fc9bd6c9bc',
    'bm_daniel': '6b3194bbceffb746733cbc22c8f593dd44e401a71d53895a2dca891bc595a1e8',
}
NO_CLIP_REASON = {
    'no-vo': 'not a voice: the UPLINK echo (your breathing played back late) is synthesised live by radio3d.js _breaths',
}
DISCLOSURE = ('AI placeholder voices (Kokoro-82M text-to-speech, Apache-2.0), not human actors: to be replaced by recorded '
              'performances (tools/abyssal-tether-3d/voice/recordings/<id>.wav overrides a line).')


def die(msg):
    print('build_voices: ' + msg, file=sys.stderr)
    sys.exit(1)


def run(cmd, **kw):
    return subprocess.run(cmd, check=True, capture_output=True, **kw)


def text_hash(s):
    """FNV-1a over UTF-16 code units (export-lines.mjs textHash, comms3d.js hashStr)."""
    h = 2166136261
    data = s.encode('utf-16-le')
    for i in range(0, len(data), 2):
        h = ((h ^ (data[i] | (data[i + 1] << 8))) * 16777619) & 0xFFFFFFFF
    return '%08x' % h


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def load_performance():
    with open(PERFORMANCE, encoding='utf-8') as f:
        perf = json.load(f)
    for sp, c in perf['cast'].items():
        for vid in c['blend']:
            if vid not in VOICE_SHA256:
                die(f'performance.json: {sp} blends {vid}, which is not a pinned voice (VOICE_SHA256)')
        if abs(sum(c['blend'].values()) - 1) > 1e-6:
            die(f'performance.json: the blend weights of {sp} do not sum to 1')
    return perf


# ---- fetch -------------------------------------------------------------------------------------------------------------------
def _download(url, dest, want):
    """url -> dest through a .part file (the proxy / CA come from the environment); refuse anything whose SHA-256 differs."""
    if os.path.exists(dest) and sha256(dest) == want:
        return False
    print(f'fetch: {url}')
    part = dest + '.part'
    with urllib.request.urlopen(url, timeout=120) as r, open(part, 'wb') as out:
        shutil.copyfileobj(r, out, 1 << 20)
    if sha256(part) != want:
        os.remove(part)
        die(f'{os.path.basename(dest)} does not match the pinned sha256: refusing to use it')
    os.replace(part, dest)
    return True


def fetch_engine():
    """Download the pinned fp32 model and the cast's voice style tensors into voice/.cache/kokoro-fp32, each hash-checked."""
    os.makedirs(os.path.join(ENGINE_DIR, 'voices'), exist_ok=True)
    _download(ENGINE['url'] + ENGINE['model'], os.path.join(ENGINE_DIR, 'model.onnx'), ENGINE['model_sha256'])
    for vid, want in VOICE_SHA256.items():
        _download(ENGINE['url'] + f'voices/{vid}.bin', os.path.join(ENGINE_DIR, 'voices', vid + '.bin'), want)
    print(f'fetch: Kokoro fp32 model + {len(VOICE_SHA256)} voices verified in {os.path.relpath(ENGINE_DIR, REPO)}')


# ---- the performer --------------------------------------------------------------------------------------------------------------
VOWELS = set('aeiouæɑɒɐəɚɛɜɝɪʊʌɔᵻɘɵøœɤɯyʏ')
BREATH = {  # kind: (seconds, level dB under the speech RMS, band Hz, attack fraction, gap after s)
    'in': (0.36, -19, (500, 3600), 0.65, 0.07),
    'in:soft': (0.30, -24, (450, 3000), 0.65, 0.06),
    'in:quick': (0.17, -19, (600, 3800), 0.55, 0.04),
    'in:sharp': (0.16, -14, (700, 4500), 0.35, 0.05),
    'out': (0.46, -20, (250, 2200), 0.12, 0.09),
    'out:soft': (0.36, -25, (250, 1800), 0.12, 0.07),
}


class Performer:
    """Kokoro fp32 over onnxruntime (fixed thread count: repeatable output on one machine), acting voice/performance.json."""

    def __init__(self, perf):
        try:
            import numpy as np
            import onnxruntime as ort
            import soundfile as sf
            from kokoro_onnx import Kokoro as K
        except ImportError as e:
            die(f'missing Python packages ({e.name}): pip install -r tools/abyssal-tether-3d/voice/requirements.txt')
        self.np, self.sf = np, sf
        model = os.path.join(ENGINE_DIR, 'model.onnx')
        if not os.path.exists(model) or os.path.getsize(model) != ENGINE['model_bytes']:
            die('no Kokoro fp32 model: run with --fetch first (or --no-ai for recordings only)')
        if sha256(model) != ENGINE['model_sha256']:
            die('the Kokoro model does not match the pinned sha256: run with --fetch')
        raw = {}
        for vid, want in VOICE_SHA256.items():
            p = os.path.join(ENGINE_DIR, 'voices', vid + '.bin')
            if not os.path.exists(p) or sha256(p) != want:
                die(f'voice {vid} missing or modified: run with --fetch')
            raw[vid] = np.fromfile(p, dtype=np.float32).reshape(-1, 1, 256)
        self.perf = perf
        # one style tensor per speaker: the blend of its voices, row by row (Kokoro picks the row by the phoneme count)
        self.style = {sp: sum(w * raw[v] for v, w in c['blend'].items()).astype(np.float32) for sp, c in perf['cast'].items()}
        npz = os.path.join(tempfile.mkdtemp(prefix='kokoro-'), 'voices.npz')
        np.savez(npz, **self.style)
        so = ort.SessionOptions()
        so.intra_op_num_threads = 2  # fixed: the same output on every run on one machine (2 is also the fastest on a shared 4-core box)
        so.inter_op_num_threads = 1
        sess = ort.InferenceSession(model, so, providers=['CPUExecutionProvider'])
        self.k = K.from_session(sess, npz)
        self._cache = {}
        self._aligned = {}

    # -- the voice --
    def phonemes(self, text, lang, stress):
        """espeak phonemes of `text`; each word in `stress` gets a primary stress mark if it has none (an unreduced, lifted word)."""
        ph = self.k.tokenizer.phonemize(text, lang)
        if not stress:
            return ph
        toks = ph.split(' ')
        at = 0
        for w in stress:
            pw = self.k.tokenizer.phonemize(w, lang).strip(' .,!?;:…—')
            bare = pw.replace('ˈ', '').replace('ˌ', '')
            for i in range(at, len(toks)):
                core = toks[i].strip('.,!?;:…—"\'')
                if core.replace('ˈ', '').replace('ˌ', '') == bare:
                    if 'ˈ' not in core:
                        core2 = core.replace('ˌ', '')
                        j = next((n for n, ch in enumerate(core2) if ch in VOWELS), 0)
                        toks[i] = toks[i].replace(core, core2[:j] + 'ˈ' + core2[j:], 1)
                    at = i + 1
                    break
        return ' '.join(toks)

    def say(self, text, speaker, speed, pitch_st, stress=()):
        """One phrase: float32 mono at 24 kHz, Kokoro's own edge silence trimmed, pitch-shifted (formants kept) when asked."""
        np = self.np
        c = self.perf['cast'][speaker]
        key = (text, speaker, round(speed, 4), round(pitch_st, 3), tuple(stress))
        if key in self._cache:
            return self._cache[key]
        ph = self.phonemes(text, c['lang'], stress)
        audio, sr = self.k.create(ph, voice=self.style[speaker], speed=max(0.5, min(2.0, speed)), is_phonemes=True, trim=True)
        audio = audio.astype(np.float32)
        if sr != SR:
            die(f'Kokoro rendered {sr} Hz')
        if abs(pitch_st) > 1e-3:
            audio = self.ff(audio, f'rubberband=pitch={2 ** (pitch_st / 12):.5f}:formant=preserved:pitchq=quality')
        audio = self.edge(audio)
        self._cache[key] = audio
        return audio

    def ff(self, audio, chain):
        """Run an ffmpeg filter chain over a mono float buffer (same length out, as near as the filter allows)."""
        with tempfile.TemporaryDirectory() as t:
            a, b = os.path.join(t, 'a.wav'), os.path.join(t, 'b.wav')
            self.sf.write(a, audio, SR, subtype='FLOAT')
            run(['ffmpeg', '-v', 'error', '-y', '-i', a, '-af', chain, '-ac', '1', '-ar', str(SR), '-c:a', 'pcm_f32le', b])
            out, _ = self.sf.read(b, dtype='float32')
        return out

    def edge(self, audio, db=-46.0):
        """Trim to the first / last sample above `db` under the peak (keeping 15 ms), 5 ms fade in, 20 ms fade out."""
        np = self.np
        if not len(audio):
            return audio
        thr = np.max(np.abs(audio)) * 10 ** (db / 20)
        idx = np.nonzero(np.abs(audio) > thr)[0]
        if len(idx):
            pad = int(0.015 * SR)
            audio = audio[max(0, idx[0] - pad): min(len(audio), idx[-1] + pad)]
        audio = audio.copy()
        fi, fo = min(len(audio), int(0.005 * SR)), min(len(audio), int(0.02 * SR))
        audio[:fi] *= np.linspace(0, 1, fi, dtype=np.float32)
        audio[len(audio) - fo:] *= np.linspace(1, 0, fo, dtype=np.float32)
        return audio

    # -- the non-verbal --
    def noise(self, n, band, rng, tilt=0.0):
        """Band-passed noise (an FFT mask with soft 1-octave skirts), unit RMS."""
        np = self.np
        x = rng.standard_normal(n).astype(np.float64)
        X = np.fft.rfft(x)
        f = np.fft.rfftfreq(n, 1 / SR)
        lo, hi = band
        m = np.clip(np.log2(np.maximum(f, 1) / (lo / 2)), 0, 1) * np.clip(np.log2((hi * 2) / np.maximum(f, 1)), 0, 1)
        if tilt:
            m *= (np.maximum(f, 50) / 1000.0) ** tilt
        y = np.fft.irfft(X * m, n)
        return (y / (np.sqrt(np.mean(y ** 2)) + 1e-12)).astype(np.float32)

    def breath(self, kind, ref_rms, rng):
        np = self.np
        if kind in ('laugh', 'laugh:soft'):
            pulses, lvl = (2, -21) if kind == 'laugh:soft' else (3, -17)
            out = []
            for p in range(pulses):
                n = int((0.075 - 0.01 * p) * SR)
                env = np.exp(-np.linspace(0, 4.0, n)) * np.minimum(1, np.linspace(0, 8, n))
                out.append(self.noise(n, (380, 2600), rng, -0.3) * env.astype(np.float32) * ref_rms * 10 ** ((lvl - 2 * p) / 20) * 2.2)
                out.append(np.zeros(int(0.06 * SR), np.float32))
            return np.concatenate(out), 0.05
        dur, lvl, band, att, gap = BREATH[kind]
        n = int(dur * SR)
        t = np.linspace(0, 1, n)
        # inhale: a rise to `att` then a quicker fall; exhale: a fast attack and a long decay
        rise = np.sin(0.5 * np.pi * np.clip(t / att, 0, 1)) ** 2
        fall = np.cos(0.5 * np.pi * np.clip((t - att) / (1 - att), 0, 1)) ** (1.5 if kind.startswith('in') else 3)
        env = np.where(t < att, rise, fall)
        x = self.noise(n, band, rng, -0.4 if kind.startswith('out') else 0.2) * env.astype(np.float32)
        return x * ref_rms * 10 ** (lvl / 20) * 1.6, gap

    # -- the line --
    def render(self, lid, speaker, line, max_s, rng_seed):
        """The whole performance of one line -> (audio, [[start, end] per aligner word], method, stats)."""
        np = self.np
        c = self.perf['cast'][speaker]
        base_speed = c['speed'] * line.get('speed', 1)
        base_pitch = c.get('pitch', 0) + line.get('pitch', 0)
        fx = list(c.get('fx', [])) + list(line.get('fx', []))
        last = None
        # too long for the line's slot: the pauses give first (to 80 %, 65 %), then the pace (to 1.12x), then both, a step at a time
        for sf_, ps in ((1.0, 1.0), (1.0, 0.8), (1.04, 0.8), (1.04, 0.65), (1.08, 0.65), (1.12, 0.65), (1.12, 0.5), (1.16, 0.5)):
            out = self._assemble(lid, speaker, line, base_speed * sf_, base_pitch, ps, np.random.default_rng(rng_seed))
            last = out + (fx, sf_, ps)
            if len(out[0]) / SR + 0.04 <= max_s - 0.03:
                return self._finish(last)
        print(f'  warning: {lid} still {len(last[0]) / SR:.2f} s at 1.16x with the pauses halved (max {max_s} s)', file=sys.stderr)
        return self._finish(last)

    def _assemble(self, lid, speaker, line, speed, pitch, pause_scale, rng):
        np = self.np
        self._lang = self.perf['cast'][speaker]['lang']
        items = []  # (kind, payload)
        for it in line['take']:
            if isinstance(it, (int, float)):
                items.append(('pause', it / 1000.0))
            elif isinstance(it, str) and it.startswith('{'):
                kind = it.strip('{}')
                if speaker == 'VESPER':
                    die(f'{lid}: Vesper never breathes')
                items.append(('nv', kind))
            elif isinstance(it, dict) and 'cut' in it:
                a = self.say(it['cut'], speaker, speed * it.get('speed', 1), pitch + it.get('pitch', 0))
                n = max(int(0.06 * SR), int(len(a) * it.get('keep', 0.5)))
                a = a[:n].copy()
                f = min(n, int(0.012 * SR))
                a[n - f:] *= np.linspace(1, 0, f, dtype=np.float32)
                items.append(('cut', a))
            else:
                p = {'t': it} if isinstance(it, str) else it
                raw = p['t']
                stress = re.findall(r'\*([^*]+)\*', raw)
                text = raw.replace('*', '')
                a = self.say(text, speaker, speed * p.get('speed', 1), pitch + p.get('pitch', 0), stress)
                items.append(('phrase', {'a': a, 'text': text, 'stress': stress, 'gain': p.get('gain', 0), 'trail': p.get('trail', False)}))
        speech = [x[1]['a'] for x in items if x[0] == 'phrase']
        cat = np.concatenate(speech)
        ref = float(np.sqrt(np.mean(cat[np.abs(cat) > 0.05 * np.max(np.abs(cat))] ** 2)))
        parts, words, offs, prev = [], [], 0, None
        for kind, pl in items:
            if kind == 'pause':
                n = int(pl * pause_scale * SR)
                parts.append(np.zeros(n, np.float32))
                offs += n
            elif kind == 'nv':
                a, gap = self.breath(pl, ref, rng)
                a = np.concatenate([a, np.zeros(int(gap * SR), np.float32)])
                parts.append(a.astype(np.float32))
                offs += len(a)
            elif kind == 'cut':
                parts.append(pl)
                offs += len(pl)
            else:
                a = pl['a'].copy()
                ws = [w for t in spoken_tokens(pl['text'], None) for w in t]
                timing, method = self._align_phrase(a, ws, pl['text'])
                if pl['stress']:
                    for sw in pl['stress']:
                        sws = [w for t in spoken_tokens(sw, None) for w in t]
                        for k in range(len(ws) - len(sws) + 1):
                            if ws[k:k + len(sws)] == sws:
                                a = self._lift(a, timing[k][0], timing[k + len(sws) - 1][1], 2.0)
                                break
                if pl['gain']:
                    a = a * 10 ** (pl['gain'] / 20)
                if pl['trail']:
                    n = len(a)
                    k0 = int(n * 2 / 3)
                    a[k0:] *= (10 ** (np.linspace(0, -8, n - k0) / 20)).astype(np.float32)
                if prev == 'phrase':
                    gap = np.zeros(int(0.08 * pause_scale * SR), np.float32)  # two phrases with no pause written: a short breath of air
                    parts.append(gap)
                    offs += len(gap)
                for (s, e) in timing:
                    words.append([offs / SR + s, offs / SR + e, method])
                parts.append(a.astype(np.float32))
                offs += len(a)
            prev = kind
        return np.concatenate(parts), words

    def _align_phrase(self, a, ws, text):
        key = (hashlib.sha1(a.tobytes()).hexdigest(), tuple(ws))
        if key not in self._aligned:
            with tempfile.TemporaryDirectory() as t:
                p = os.path.join(t, 'p.wav')
                self.sf.write(p, a, SR, subtype='FLOAT')
                self._aligned[key] = align(p, [[w] for w in ws], self._lang)
        return self._aligned[key]

    def _lift(self, a, s, e, db):
        """+db on [s, e] s with 25 ms ramps (the stressed word stands out of the phrase)."""
        np = self.np
        g = np.ones(len(a), np.float32)
        i0, i1 = int(s * SR), int(e * SR)
        r = int(0.025 * SR)
        k = 10 ** (db / 20)
        for i in range(max(0, i0 - r), min(len(a), i1 + r)):
            if i < i0:
                g[i] = 1 + (k - 1) * (i - (i0 - r)) / r
            elif i > i1:
                g[i] = 1 + (k - 1) * ((i1 + r) - i) / r
            else:
                g[i] = k
        return a * g

    def _finish(self, out):
        """The line's fx over the joined performance -> (audio, word timings, method, stats)."""
        np = self.np
        audio, words, fx, sf_, ps = out
        rng = np.random.default_rng(len(audio))
        air = (0.07 if 'breathy' in fx else 0) + (0.05 if 'hushed' in fx else 0) + (0.04 if 'offmic' in fx else 0)
        if air:
            # aspiration under the voice: high band-passed noise that follows the voice's own 20 ms envelope
            w = int(0.02 * SR)
            env = np.sqrt(np.convolve(audio ** 2, np.ones(w) / w, mode='same')).astype(np.float32)
            audio = audio + self.noise(len(audio), (1800, 7500), rng) * env * air
        chain = []
        if 'close' in fx:
            chain.append('bass=g=2:f=160:w=0.8,treble=g=-1.5:f=8000')
        if 'hushed' in fx:
            chain.append('treble=g=-3:f=4500')
        if 'offmic' in fx:
            chain.append('lowpass=f=3600,aecho=1.0:0.85:11|23:0.28|0.16')
        if chain:
            n = len(audio)
            audio = self.ff(audio, ','.join(chain))[:n]
        method = 'align' if all(m == 'align' for (_s, _e, m) in words) else 'approx'
        return audio, [[s, e] for (s, e, _m) in words], method, {'speed_fit': sf_, 'pause_fit': ps, 'fx': fx}


# ---- processing ----------------------------------------------------------------------------------------------------------------
def ff_loudness(path):
    """(integrated LUFS, true-peak-ish sample peak dBFS, duration s) of an audio file."""
    p = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', path, '-af', 'ebur128=peak=sample', '-f', 'null', '-'], capture_output=True, text=True)
    err = p.stderr
    i = re.findall(r'I:\s+(-?[\d.]+|-inf) LUFS', err)
    pk = re.findall(r'Peak:\s+(-?[\d.]+|-inf) dBFS', err)
    lufs = float(i[-1]) if i and i[-1] != '-inf' else -70.0
    peak = float(pk[-1]) if pk and pk[-1] != '-inf' else -90.0
    return lufs, peak, ff_duration(path)


def ff_duration(path):
    p = run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], text=True)
    return float(p.stdout.strip() or 0)


def process(src_wav, out_wav, trim=True):
    """Mono, 24 kHz, 70 Hz high-pass, trimmed head/tail silence (a recording; an AI performance is already cut to its first and
    last sound, its breaths included, and its word timings depend on it) + short fades, -23 LUFS."""
    pre = []
    if trim:
        t = 'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.02'
        pre = [t, 'areverse', t, 'areverse']
    chain = ','.join(['highpass=f=70'] + pre + ['afade=t=in:d=0.006', 'areverse', 'afade=t=in:d=0.02', 'areverse', 'apad=pad_dur=0.04'])
    tmp = out_wav + '.pre.wav'
    run(['ffmpeg', '-v', 'error', '-y', '-i', src_wav, '-ac', '1', '-ar', str(SR), '-af', chain, '-c:a', 'pcm_f32le', tmp])
    lufs, peak, _ = ff_loudness(tmp)
    gain = TARGET_LUFS - lufs
    if peak + gain > PEAK_CEIL_DB:
        gain = PEAK_CEIL_DB - peak  # never clip: a peaky take ends up a little under the target
    run(['ffmpeg', '-v', 'error', '-y', '-i', tmp, '-af', f'volume={gain:.3f}dB', '-c:a', 'pcm_f32le', out_wav])
    os.remove(tmp)
    return gain


def encode(wav, ogg):
    os.makedirs(os.path.dirname(ogg), exist_ok=True)
    run(['ffmpeg', '-v', 'error', '-y', '-i', wav, '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact',
         '-c:a', 'libopus', '-b:a', BITRATE, '-vbr', 'on', '-application', 'voip', '-frame_duration', '20', '-ac', '1', '-ar', str(SR), ogg])


# ---- word timing ----------------------------------------------------------------------------------------------------------------
# espeak IPA -> CMU phones (only for words the aligner's dictionary does not know: names, coinages)
_IPA = sorted({
    'aɪə': 'AY ER', 'aɪ': 'AY', 'aʊ': 'AW', 'eɪ': 'EY', 'oʊ': 'OW', 'əʊ': 'OW', 'ɔɪ': 'OY', 'eə': 'EH R', 'ɪə': 'IH R', 'ʊə': 'UH R',
    'ɑːɹ': 'AA R', 'ɔːɹ': 'AO R', 'ɜːɹ': 'ER', 'ɑː': 'AA', 'ɔː': 'AO', 'ɜː': 'ER', 'iː': 'IY', 'uː': 'UW', 'oː': 'OW', 'ɑ': 'AA', 'ɒ': 'AA',
    'æ': 'AE', 'ʌ': 'AH', 'ə': 'AH', 'ɐ': 'AH', 'ɚ': 'ER', 'ɝ': 'ER', 'ɔ': 'AO', 'ɛ': 'EH', 'e': 'EH', 'ɪ': 'IH', 'ᵻ': 'IH', 'i': 'IY',
    'ʊ': 'UH', 'u': 'UW', 'o': 'OW', 'a': 'AE', 'tʃ': 'CH', 'dʒ': 'JH', 'b': 'B', 'd': 'D', 'f': 'F', 'ɡ': 'G', 'g': 'G', 'h': 'HH',
    'k': 'K', 'l': 'L', 'm': 'M', 'n': 'N', 'ŋ': 'NG', 'p': 'P', 'ɹ': 'R', 'r': 'R', 's': 'S', 'ʃ': 'SH', 't': 'T', 'θ': 'TH', 'ð': 'DH',
    'v': 'V', 'w': 'W', 'j': 'Y', 'z': 'Z', 'ʒ': 'ZH', 'ɾ': 'T', 'ʔ': 'T', 'x': 'K', 'ɬ': 'L',
}.items(), key=lambda kv: -len(kv[0]))


def ipa_to_cmu(ipa):
    s = re.sub(r'[ˈˌːˑ̩‿\-\s]', lambda m: 'ː' if m.group(0) == 'ː' else '', ipa)
    out = []
    i = 0
    while i < len(s):
        for k, v in _IPA:
            if s.startswith(k, i):
                out.extend(v.split())
                i += len(k)
                break
        else:
            i += 1  # an unknown symbol: skipped
    return ' '.join(out)


def spoken_tokens(text, say):
    """One entry per subtitle word: the list of aligner words it is spoken as."""
    toks = (say or text).split()
    out = []
    for t in toks:
        ws = []
        for part in t.replace('_', ' ').replace('-', ' ').replace('—', ' ').split():
            w = re.sub(r"[^a-z']", '', part.lower()).strip("'")
            if w:
                ws.append(w)
        out.append(ws)
    return out


_DECODER = {}


def align(wav, tokens, lang):
    """[[start, end], ...] per subtitle word (s), and the method ('align' | 'approx')."""
    flat = [w for ws in tokens for w in ws]
    dur = ff_duration(wav)
    try:
        from pocketsphinx import Decoder
        if 'dec' not in _DECODER:  # one decoder for the whole build (loading it is the slow part)
            _DECODER['dec'] = Decoder(bestpath=False, loglevel='FATAL')
        dec = _DECODER['dec']
        for w in sorted(set(flat)):
            if dec.lookup_word(w) is None:
                try:
                    from kokoro_onnx.tokenizer import Tokenizer
                    ph = ipa_to_cmu(Tokenizer().phonemize(w, lang))
                except Exception:
                    ph = ''
                if not ph:
                    raise ValueError('no phones for ' + w)
                dec.add_word(w, ph, True)
        raw = run(['ffmpeg', '-v', 'error', '-i', wav, '-ac', '1', '-ar', '16000', '-f', 's16le', '-']).stdout
        dec.set_align_text(' '.join(flat))
        dec.start_utt()
        dec.process_raw(raw, full_utt=True)
        dec.end_utt()
        # the word segmentation of the forced-alignment pass (10 ms frames; alternates read 'word(2)')
        segs = [(re.sub(r'\(\d+\)$', '', s.word), s.start_frame / 100.0, (s.end_frame + 1) / 100.0) for s in dec.seg()]
        segs = [s for s in segs if s[0] not in ('<s>', '</s>', '<sil>') and not s[0].startswith('[') and not s[0].startswith('+')]
        if len(segs) != len(flat):
            raise ValueError('alignment length')
        out = []
        k = 0
        for ws in tokens:
            if not ws:
                out.append([round(segs[min(k, len(segs) - 1)][1], 2)] * 2)
                continue
            a = segs[k][1]
            b = segs[k + len(ws) - 1][2]
            k += len(ws)
            out.append([round(a, 2), round(min(b, dur), 2)])
        return out, 'align'
    except Exception:
        _DECODER.pop('dec', None)  # a fresh decoder for the next line
    # proportional by letters (a word's share of the speech), from the first to the last non-silent sample
    lens = [max(1, sum(len(w) for w in ws)) for ws in tokens]
    tot = float(sum(lens))
    t0, t1 = 0.03, max(0.1, dur - 0.06)
    out = []
    acc = 0.0
    for n in lens:
        a = t0 + (t1 - t0) * acc / tot
        acc += n
        out.append([round(a, 2), round(t0 + (t1 - t0) * acc / tot, 2)])
    return out, 'approx'


# ---- the build ----------------------------------------------------------------------------------------------------------------
def check_take(lid, line, tokens):
    """The spoken words of a performance (its phrases, not its false starts) must be the subtitle's (or the say column's), in order."""
    said = []
    for it in line['take']:
        if isinstance(it, str) and not it.startswith('{'):
            said += [w for t in spoken_tokens(it.replace('*', ''), None) for w in t]
        elif isinstance(it, dict) and 't' in it:
            said += [w for t in spoken_tokens(it['t'].replace('*', ''), None) for w in t]
    want = [w for t in tokens for w in t]
    if said != want:
        die(f'{lid}: the performance says {" ".join(said)!r}, the line is {" ".join(want)!r}')


def read_lines():
    with open(LINES_CSV, newline='', encoding='utf-8') as f:
        return list(csv.DictReader(f))


def build(args):
    if not args.no_export:
        run(['node', os.path.join(VOICE_DIR, 'export-lines.mjs')])
    rows = read_lines()
    try:
        with open(MANIFEST, encoding='utf-8') as f:
            old = json.load(f)
    except (OSError, ValueError):
        old = {}
    only = set(args.only.split(',')) if args.only else None
    perf = load_performance()
    performer = None
    lines = {}
    fallback = {}
    report = []
    sec_of = {'any': -1}
    for i in range(8):
        sec_of[f'S{i + 1}'] = i
        sec_of[f'II-S{i + 1}'] = i  # Chapter II: the chapter's own sections (its beats in order)
    with tempfile.TemporaryDirectory() as tmp:
        for r in rows:
            lid, sp, status = r['id'], r['speaker'], r['status']
            if status == 'spec':
                continue
            if status not in LIVE or sp not in perf['cast']:
                fallback[lid] = NO_CLIP_REASON.get(status, 'no voice for this speaker')
                continue
            rel = f'{sp.lower()}/{lid}.ogg'
            ogg = os.path.join(OUT_DIR, rel)
            if only is not None and lid not in only:
                if lid in old.get('lines', {}) and os.path.exists(ogg):
                    lines[lid] = old['lines'][lid]
                continue
            rec = os.path.join(RECORDINGS, lid + '.wav')
            raw = os.path.join(tmp, lid + '.raw.wav')
            wav = os.path.join(tmp, lid + '.wav')
            tokens = spoken_tokens(r['text'], r['say'])
            max_s = float(r['max_s'])
            stats = None
            if os.path.exists(rec):
                src = 'human'
                shutil.copyfile(rec, raw)
                process(raw, wav)
                words, method = align(wav, tokens, perf['cast'][sp]['lang'])
            elif args.no_ai:
                # no engine here: an existing AI clip of the same text stays; otherwise the babble speaks the line
                prev = old.get('lines', {}).get(lid)
                if prev and prev.get('src') == 'ai' and prev.get('h') == text_hash(r['text']) and os.path.exists(ogg):
                    lines[lid] = prev
                else:
                    fallback[lid] = 'no recording yet (built with --no-ai): the synthesised babble speaks it'
                continue
            else:
                src = 'ai'
                line = perf['lines'].get(lid)
                if not line:
                    die(f'{lid}: no performance in voice/performance.json')
                check_take(lid, line, tokens)
                if performer is None:
                    performer = Performer(perf)
                import soundfile as sf
                audio, flat, method, stats = performer.render(lid, sp, line, max_s, int(text_hash(lid), 16))
                sf.write(raw, audio, SR, subtype='FLOAT')
                process(raw, wav, trim=False)
                d = ff_duration(wav)
                words, k = [], 0
                for ws in tokens:  # aligner words -> one [start, end] per subtitle word
                    if not ws:
                        words.append([round(flat[min(k, len(flat) - 1)][0], 2)] * 2)
                        continue
                    words.append([round(flat[k][0], 2), round(min(flat[k + len(ws) - 1][1], d), 2)])
                    k += len(ws)
            d = ff_duration(wav)
            if d > max_s:
                print(f'  warning: {lid} runs {d:.2f} s (> {max_s} s): the subtitle holds longer', file=sys.stderr)
            encode(wav, ogg)
            lufs, peak, dur = ff_loudness(ogg)
            size = os.path.getsize(ogg)
            lines[lid] = {'f': rel, 'd': round(dur, 3), 's': sec_of.get(r['section'], -1), 'src': src, 'h': text_hash(r['text']), 'w': words, 'wt': method, 'bytes': size}
            report.append((lid, sp, src, dur, peak, lufs, size, method))
            fit = f"  fit x{stats['speed_fit']:.2f} pauses x{stats['pause_fit']:.2f}" if stats and (stats['speed_fit'] != 1 or stats['pause_fit'] != 1) else ''
            print(f'  {lid:<13} {sp:<6} {src:<5} {dur:5.2f} s / {max_s:.1f}  peak {peak:6.1f} dBFS  {lufs:6.1f} LUFS  {size / 1024:5.1f} KB  words: {method}{fit}')
    # stale clips (a line removed from the script, or now recorded under another speaker)
    keep = {os.path.normpath(os.path.join(OUT_DIR, e['f'])) for e in lines.values()}
    for dirpath, _dirs, files in os.walk(OUT_DIR):
        for fn in files:
            p = os.path.normpath(os.path.join(dirpath, fn))
            if fn.endswith('.ogg') and p not in keep:
                os.remove(p)
                print(f'  removed stale {os.path.relpath(p, OUT_DIR)}')
    total = sum(e['bytes'] for e in lines.values())
    srcs = {e['src'] for e in lines.values()}
    manifest = {
        'format': 1,
        'generator': 'tools/abyssal-tether-3d/build_voices.py',
        'codec': f'opus/ogg mono {SR} Hz {BITRATE}b/s, {TARGET_LUFS:g} LUFS per clip, dry',
        'engine': {'name': ENGINE['name'], 'licence': ENGINE['licence'], 'direction': 'tools/abyssal-tether-3d/voice/performance.json',
                   'voices': {sp: '+'.join(f'{v}*{w:g}' for v, w in c['blend'].items()) for sp, c in perf['cast'].items()}} if 'ai' in srcs else None,
        'disclosure': DISCLOSURE if 'ai' in srcs else 'Recorded performances.',
        'bytes': total,
        'lines': dict(sorted(lines.items())),
        'fallback': dict(sorted(fallback.items())),
    }
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(MANIFEST, 'w', encoding='utf-8') as f:
        f.write(dump_manifest(manifest))
    if not args.no_export:
        run(['node', os.path.join(VOICE_DIR, 'export-lines.mjs')])  # the pickup column reads the new manifest
    print(f'build_voices: {len(lines)} clips ({", ".join(sorted(srcs)) or "none"}), {total / 1024:.0f} KB of {BUDGET_BYTES / 1024:.0f} KB, {len(fallback)} fallback')
    if total > BUDGET_BYTES:
        die('over the size budget')
    if args.report:
        write_report(args.report, manifest)
    if args.demo:
        demo(args.demo, manifest, args.demo_lines)


def dump_manifest(m):
    """JSON with one line per clip (small, and a re-recorded line is a one-line diff)."""
    c = lambda v: json.dumps(v, separators=(',', ':'), ensure_ascii=False)
    out = ['{']
    keys = list(m.keys())
    for i, k in enumerate(keys):
        end = ',' if i < len(keys) - 1 else ''
        if k in ('lines', 'fallback') and m[k]:
            items = list(m[k].items())
            out.append(f' {c(k)}: {{')
            out.extend(f'  {c(lid)}: {c(v)}' + (',' if j < len(items) - 1 else '') for j, (lid, v) in enumerate(items))
            out.append(' }' + end)
        else:
            out.append(f' {c(k)}: {c(m[k])}{end}')
    return '\n'.join(out) + '\n}\n'


def write_report(path, manifest):
    rows = []
    for lid, e in manifest['lines'].items():
        ogg = os.path.join(OUT_DIR, e['f'])
        lufs, peak, dur = ff_loudness(ogg)
        rows.append(f"| {lid} | {e['f'].split('/')[0]} | {e['src']} | {dur:.2f} | {peak:.1f} | {lufs:.1f} | {e['bytes']} | {e['wt']} |")
    with open(path, 'w', encoding='utf-8') as f:
        f.write('| id | speaker | source | duration s | peak dBFS | loudness LUFS | bytes | words |\n|---|---|---|---|---|---|---|---|\n' + '\n'.join(rows) + '\n')
    print(f'report: {path}')


# ---- the offline radio demo (an approximation of radio3d.js, for listening outside the game) -------------------------------------
DEMO_DEFAULT = 's1-open-1,s1-open-2,s1-open-3,s1-open-4,s1-bell-1,s1-bell-2,s1-bell-3,s7-hang,s8-warm,s8-lost'


def demo(out, manifest, ids):
    """Each clip through: radio = high-pass 350, low-pass 3200, +4 dB at 1.8 kHz, tanh saturation, a squelch burst on and off,
    a band-passed static bed at the section's signal, 30 % to the left ear; the suit (Vesper) and 'not quite' lines dry.
    s7-hang gets its stuck word (the game's stutter: the word's first 0.28 s twice more); s8-warm is pitched + doubled."""
    ids = (ids or DEMO_DEFAULT).split(',')
    signal = [1.0, 0.94, 0.82, 0.7, 0.58, 0.46, 0.33, 0.2]
    rows = {r['id']: r for r in read_lines()}
    parts = []
    with tempfile.TemporaryDirectory() as tmp:
        for n, lid in enumerate(ids):
            e = manifest['lines'].get(lid)
            if not e:
                continue
            src = os.path.join(OUT_DIR, e['f'])
            sp = e['f'].split('/')[0].upper()
            kind = rows.get(lid, {}).get('kind', 'radio')
            dry = sp in ('VESPER', 'ELIAS') or kind == 'notquite'
            seg = os.path.join(tmp, f'{n:02d}.wav')
            voice = os.path.join(tmp, f'{n:02d}.v.wav')
            # the stuck word: [0, a+s) + [a, a+s) + [a, end)
            if lid == 's7-hang' and e['w']:
                a, b = e['w'][len(e['w']) - 2]
                s = min(0.28, b - a)
                fc = (f'[0]atrim=0:{a + s:.3f},asetpts=N/SR/TB[p0];[0]atrim={a:.3f}:{a + s:.3f},asetpts=N/SR/TB[p1];'
                      f'[0]atrim={a:.3f},asetpts=N/SR/TB[p2];[p0][p1][p2]concat=n=3:v=0:a=1[o]')
                run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-filter_complex', fc, '-map', '[o]', '-ar', '48000', voice])
            elif kind == 'notquite':
                fc = ('[0]aresample=48000,asplit[a][b];[a]rubberband=pitch=0.94:tempo=0.94[m];[b]rubberband=pitch=0.951:tempo=0.951,'
                      'adelay=22,volume=0.5[d];[m][d]amix=inputs=2:normalize=0,lowpass=f=5200[o]')
                run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-filter_complex', fc, '-map', '[o]', voice])
            else:
                run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-ar', '48000', voice])
            dur = ff_duration(voice)
            sec = max(0, e['s'])
            if dry:
                fc = f'[0]volume=1.2,lowpass=f=5200,adelay=50,apad=pad_dur=0.4,pan=stereo|c0=0.7*c0|c1=0.7*c0[o]'
                run(['ffmpeg', '-v', 'error', '-y', '-i', voice, '-filter_complex', fc, '-map', '[o]', '-ar', '48000', seg])
            else:
                lvl = 0.006 + 0.05 * (1 - signal[min(7, sec)])
                total = dur + 0.6
                fc = (f'[0]adelay=110,apad=pad_dur=0.5,highpass=f=350,lowpass=f=3200,equalizer=f=1800:t=q:w=1.1:g=4,volume=1.8,'
                      f'asoftclip=type=tanh,volume=1.06[v];'
                      f'anoisesrc=d={total:.2f}:c=white:a=1:r=48000:s=7,bandpass=f=2300:t=q:w=0.55,volume={lvl * 3:.4f}[st];'
                      f'anoisesrc=d=0.06:c=white:a=0.32:r=48000:s=3,bandpass=f=3000:t=q:w=0.9,afade=t=out:st=0.012:d=0.045[q1];'
                      f'anoisesrc=d=0.06:c=white:a=0.32:r=48000:s=5,bandpass=f=3000:t=q:w=0.9,afade=t=out:st=0.012:d=0.045,adelay={int((0.11 + dur + 0.06) * 1000)}[q2];'
                      f'[v][st][q1][q2]amix=inputs=4:normalize=0:duration=longest,pan=stereo|c0=0.85*c0|c1=0.53*c0[o]')
                run(['ffmpeg', '-v', 'error', '-y', '-i', voice, '-filter_complex', fc, '-map', '[o]', '-ar', '48000', '-t', f'{total + 0.1:.2f}', seg])
            parts.append(seg)
            gap = os.path.join(tmp, f'{n:02d}.gap.wav')
            run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '0.7', gap])
            parts.append(gap)
        lst = os.path.join(tmp, 'list.txt')
        with open(lst, 'w') as f:
            f.write(''.join(f"file '{p}'\n" for p in parts))
        os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
        run(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', lst, '-c:a', 'libopus', '-b:a', '64k', out])
    print(f'demo: {out} ({ff_duration(out):.1f} s, 48 kHz stereo Opus, {len(parts) // 2} lines)')


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--fetch', action='store_true', help='fetch + verify the Kokoro fp32 model and the cast voices (Hugging Face, pinned revision), then build')
    ap.add_argument('--fetch-only', action='store_true')
    ap.add_argument('--only', help='comma-separated line ids')
    ap.add_argument('--no-ai', action='store_true', help='do not run the AI engine: convert recordings, keep existing AI clips of unchanged lines')
    ap.add_argument('--no-export', action='store_true', help='do not regenerate lines.csv from comms3d.js first')
    ap.add_argument('--report', help='write a markdown table of every shipped clip')
    ap.add_argument('--demo', help='also render an offline radio-chain demo (.ogg)')
    ap.add_argument('--demo-lines', help='comma-separated ids for --demo')
    args = ap.parse_args()
    if args.fetch or args.fetch_only:
        fetch_engine()
        if args.fetch_only:
            return
    build(args)


if __name__ == '__main__':
    main()
