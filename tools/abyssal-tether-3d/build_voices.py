#!/usr/bin/env python3
"""ABYSSAL TETHER 3D: build the radio voice clips (docs/abyssal-tether-3d/plans/VO_SCRIPT.md).

For every voiced line of tools/abyssal-tether-3d/voice/lines.csv (regenerated from src/sim/comms3d.js first):
  1. a HUMAN RECORDING tools/abyssal-tether-3d/voice/recordings/<id>.wav wins (48 kHz 24-bit dry takes; see VO_SCRIPT.md);
  2. otherwise the AI PLACEHOLDER: Kokoro-82M v1.0 text-to-speech (ONNX q8, Apache-2.0), one fixed voice per speaker.
Each clip is high-passed (70 Hz), trimmed of silence, gain-normalised per clip to -23 LUFS integrated (linear gain, peak
held under -1 dBFS: no compressor, no radio effect: the game's radio chain does the band-pass, squelch, static, dropouts),
encoded mono 24 kHz Opus in Ogg (24 kb/s, bit-exact muxing) to
    public/abyssal-tether-3d/assets/audio/voice/<speaker>/<id>.ogg
and word-aligned (PocketSphinx forced alignment; a proportional split when the aligner fails) so the game's stuck-word glitch
can repeat a real word. public/abyssal-tether-3d/assets/audio/voice/manifest.json lists every clip (duration, words, source,
the script text hash); lines with no clip (the UPLINK breathing) are listed under "fallback" with the reason.

  python3 tools/abyssal-tether-3d/build_voices.py --fetch          # once: fetch + verify the Kokoro weights / voices (npm)
  python3 tools/abyssal-tether-3d/build_voices.py                  # render / convert everything, write the manifest
  python3 tools/abyssal-tether-3d/build_voices.py --only s7-hang   # some lines only (the rest of the manifest is kept)
  python3 tools/abyssal-tether-3d/build_voices.py --no-ai          # no AI engine: convert recordings, keep current AI clips
  python3 tools/abyssal-tether-3d/build_voices.py --report out.md  # + the per-clip table (duration, peak, loudness, bytes)
  python3 tools/abyssal-tether-3d/build_voices.py --demo out.ogg   # + an offline mix through an approximation of the radio
Needs: ffmpeg (libopus, rubberband), node, npm (for --fetch), and pip install -r tools/abyssal-tether-3d/voice/requirements.txt
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
import tarfile
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
VOICE_DIR = os.path.join(HERE, 'voice')
LINES_CSV = os.path.join(VOICE_DIR, 'lines.csv')
RECORDINGS = os.path.join(VOICE_DIR, 'recordings')
CACHE = os.path.join(VOICE_DIR, '.cache')
OUT_DIR = os.path.join(REPO, 'public', 'abyssal-tether-3d', 'assets', 'audio', 'voice')
MANIFEST = os.path.join(OUT_DIR, 'manifest.json')

SR = 24000  # the shipped clips: mono 24 kHz Opus
BITRATE = '24k'
TARGET_LUFS = -23.0
PEAK_CEIL_DB = -1.0
BUDGET_BYTES = 2_500_000  # all shipped clips together (tests/comms/voice.mjs holds the same budget)

# ---- the AI placeholder engine (pinned, verified) ----------------------------------------------------------------------------
ENGINE = {
    'name': 'Kokoro-82M v1.0 (ONNX, q8)',
    'licence': 'Apache-2.0 (model and voices: hexgrad/Kokoro-82M; ONNX export: onnx-community/Kokoro-82M-v1.0-ONNX)',
    'model_npm': 'kokoro-q8-shards@1.0.0',  # model_quantized.onnx split in 6 (byte-identical when joined)
    'model_sha256': 'fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478',
    'voices_npm': 'kokoro-js@1.2.1',  # the official kokoro-js package (hexgrad / Xenova) bundles the voice style tensors
}
# One voice per speaker (CAST in voice/direction.mjs): Kokoro voice id, espeak language, base speed
VOICES = {
    'ODESSA': ('af_heart', 'en-us', 0.95, 'd583ccff3cdca2f7fae535cb998ac07e9fcb90f09737b9a41fa2734ec44a8f0b'),
    'TICK': ('am_puck', 'en-us', 1.10, 'fcf73c989033e9233e0b98713eca600c8c74dcc1614b37009d5450ff4a2274a0'),
    'MAREN': ('bf_emma', 'en-gb', 0.92, '669fe0647f9dd04fcab92f1439a40eeb4c8b4ab1f82e4996fe3d918ce4a63b73'),
    'ELIAS': ('am_michael', 'en-us', 0.96, '1d1f21dd8da39c30705cd4c75d039d265e9bc4a2a93ed09bc9e1b1225eb95ba1'),
    'VESPER': ('bm_george', 'en-gb', 1.00, 'c4b235a4c1f2cd3b939fed08b899ce9385638b763f7b73a59616c4fc9bd6c9bc'),
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


# ---- fetch -------------------------------------------------------------------------------------------------------------------
def fetch_engine():
    """npm pack the pinned packages into voice/.cache, join + verify the model, extract + verify the voices."""
    eng = os.path.join(CACHE, 'kokoro')
    os.makedirs(eng, exist_ok=True)
    for spec in (ENGINE['model_npm'], ENGINE['voices_npm']):
        name = spec.split('@')[0]
        tgz = [f for f in os.listdir(eng) if f.startswith(name + '-') and f.endswith('.tgz')]
        if not tgz:
            print(f'fetch: npm pack {spec}')
            run(['npm', 'pack', spec, '--silent'], cwd=eng)
    model = os.path.join(eng, 'model_quantized.onnx')
    if not os.path.exists(model) or sha256(model) != ENGINE['model_sha256']:
        tgz = os.path.join(eng, next(f for f in os.listdir(eng) if f.startswith('kokoro-q8-shards-')))
        with tarfile.open(tgz) as tf, open(model + '.part', 'wb') as out:
            for i in range(6):
                out.write(tf.extractfile(f'package/kokoro-q8.part{i}.bin').read())
        os.replace(model + '.part', model)
        if sha256(model) != ENGINE['model_sha256']:
            os.remove(model)
            die('the joined Kokoro model does not match the pinned sha256: refusing to use it')
    vdir = os.path.join(eng, 'voices')
    os.makedirs(vdir, exist_ok=True)
    tgz = os.path.join(eng, next(f for f in os.listdir(eng) if f.startswith('kokoro-js-')))
    with tarfile.open(tgz) as tf:
        for sp, (vid, _lang, _speed, want) in VOICES.items():
            data = tf.extractfile(f'package/voices/{vid}.bin').read()
            if hashlib.sha256(data).hexdigest() != want:
                die(f'voice {vid} ({sp}) does not match the pinned sha256')
            with open(os.path.join(vdir, vid + '.bin'), 'wb') as f:
                f.write(data)
    print(f'fetch: Kokoro model + {len(VOICES)} voices verified in {os.path.relpath(eng, REPO)}')


class Kokoro:
    """The AI placeholder: kokoro-onnx over the pinned q8 model, fixed thread count (repeatable output on one machine)."""

    def __init__(self):
        try:
            import numpy as np
            import onnxruntime as ort
            from kokoro_onnx import Kokoro as K
        except ImportError as e:
            die(f'missing Python packages ({e.name}): pip install -r tools/abyssal-tether-3d/voice/requirements.txt')
        eng = os.path.join(CACHE, 'kokoro')
        model = os.path.join(eng, 'model_quantized.onnx')
        if not os.path.exists(model):
            die('no Kokoro model: run with --fetch first (or --no-ai for recordings only)')
        voices = {}
        for _sp, (vid, _l, _s, want) in VOICES.items():
            p = os.path.join(eng, 'voices', vid + '.bin')
            if not os.path.exists(p) or sha256(p) != want:
                die(f'voice {vid} missing or modified: run with --fetch')
            voices[vid] = np.fromfile(p, dtype=np.float32).reshape(-1, 1, 256)
        npz = os.path.join(eng, 'voices.npz')
        np.savez(npz, **voices)
        so = ort.SessionOptions()
        so.intra_op_num_threads = 4
        so.inter_op_num_threads = 1
        sess = ort.InferenceSession(model, so, providers=['CPUExecutionProvider'])
        self.k = K.from_session(sess, npz)
        self.np = np

    def render(self, text, speaker, pace):
        vid, lang, base, _ = VOICES[speaker]
        speed = max(0.5, min(2.0, base * pace))
        audio, sr = self.k.create(text, voice=vid, speed=speed, lang=lang)
        return audio.astype(self.np.float32), sr


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


def process(src_wav, out_wav, pitch_st=0.0):
    """Mono, 24 kHz, 70 Hz high-pass, optional pitch drift (AI only), trimmed head/tail silence + short fades, -23 LUFS."""
    pre = []
    if abs(pitch_st) > 1e-3:
        pre.append(f'rubberband=pitch={2 ** (pitch_st / 12):.5f}')
    trim = 'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.02'
    chain = ','.join(pre + ['highpass=f=70', trim, 'areverse', trim, 'areverse', 'afade=t=in:d=0.006', 'areverse', 'afade=t=in:d=0.02', 'areverse', 'apad=pad_dur=0.04'])
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


def align(wav, tokens, lang):
    """[[start, end], ...] per subtitle word (s), and the method ('align' | 'approx')."""
    flat = [w for ws in tokens for w in ws]
    dur = ff_duration(wav)
    try:
        from pocketsphinx import Decoder
        dec = Decoder(bestpath=False, loglevel='FATAL')
        for w in set(flat):
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
        pass
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
    kokoro = None
    lines = {}
    fallback = {}
    report = []
    sec_of = {'any': -1}
    for i in range(8):
        sec_of[f'S{i + 1}'] = i
    with tempfile.TemporaryDirectory() as tmp:
        for r in rows:
            lid, sp, status = r['id'], r['speaker'], r['status']
            if status == 'spec':
                continue
            if status != 'live' or sp not in VOICES:
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
            if os.path.exists(rec):
                src = 'human'
                shutil.copyfile(rec, raw)
                pitch = 0.0
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
                if kokoro is None:
                    kokoro = Kokoro()
                import soundfile as sf
                say = (r['say'] or r['text']).replace('_', ' ')
                pace = float(r['ai_pace'] or 1)
                audio, sr = kokoro.render(say, sp, pace)
                sf.write(raw, audio, sr, subtype='FLOAT')
                pitch = float(r['ai_pitch'] or 0)
            wav = os.path.join(tmp, lid + '.wav')
            process(raw, wav, pitch)
            d = ff_duration(wav)
            max_s = float(r['max_s'])
            if src == 'ai' and d > max_s:
                # an AI take over the line's budget: re-render faster (<= 1.25x) once
                f = min(1.25, d / max_s * 1.02)
                audio, sr = kokoro.render((r['say'] or r['text']).replace('_', ' '), sp, float(r['ai_pace'] or 1) * f)
                sf.write(raw, audio, sr, subtype='FLOAT')
                process(raw, wav, pitch)
                d = ff_duration(wav)
            if d > max_s:
                print(f'  warning: {lid} runs {d:.2f} s (> {max_s} s): the subtitle holds longer', file=sys.stderr)
            tokens = spoken_tokens(r['text'], r['say'])
            words, method = align(wav, tokens, VOICES[sp][1])
            encode(wav, ogg)
            lufs, peak, dur = ff_loudness(ogg)
            size = os.path.getsize(ogg)
            lines[lid] = {'f': rel, 'd': round(dur, 3), 's': sec_of.get(r['section'], -1), 'src': src, 'h': text_hash(r['text']), 'w': words, 'wt': method, 'bytes': size}
            report.append((lid, sp, src, dur, peak, lufs, size, method))
            print(f'  {lid:<13} {sp:<6} {src:<5} {dur:5.2f} s  peak {peak:6.1f} dBFS  {lufs:6.1f} LUFS  {size / 1024:5.1f} KB  words: {method}')
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
        'engine': {'name': ENGINE['name'], 'licence': ENGINE['licence'], 'voices': {sp: v[0] for sp, v in VOICES.items()}} if 'ai' in srcs else None,
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
    ap.add_argument('--fetch', action='store_true', help='fetch + verify the Kokoro model and voices (npm), then build')
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
