#!/usr/bin/env python3
"""THE LANTERN: render the opening cinematic's narration (docs/abyssal-tether-3d/plans/OPENING_CINEMATIC.md section 8).

  python3 tools/abyssal-tether-3d/voice/build_opening_vo.py [--only op-1,op-2]

Reads voice/opening_performance.json (the takes, in performance.json's format) and the cast (voice blends) of
voice/performance.json, renders each line with the radio build's Kokoro performer (build_voices.py Performer: same model, same
blends, same phrase-by-phrase acting, fitted inside the line's slot `max_s`), normalises it (-23 LUFS, peak < -1 dBFS) and writes

  public/abyssal-tether-3d/assets/audio/opening/<id>.ogg     Opus 32 kb/s mono 24 kHz, dry
  public/abyssal-tether-3d/assets/audio/opening/manifest.json  { lines: { id: { f, d, speaker, text, w } } }

The clips live outside assets/audio/voice/ on purpose: build_voices.py prunes any clip there that is not a radio line.
A human recording at voice/recordings/<id>.wav replaces the AI take (no code change), as for the radio.
Needs the Kokoro fp32 model: `python3 tools/abyssal-tether-3d/build_voices.py --fetch-only` once.
"""
import argparse
import json
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import build_voices as bv  # noqa: E402

REPO = bv.REPO
DIRECTION = os.path.join(HERE, 'opening_performance.json')
OUT_DIR = os.path.join(REPO, 'public', 'abyssal-tether-3d', 'assets', 'audio', 'opening')
MANIFEST = os.path.join(OUT_DIR, 'manifest.json')


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--only', help='comma-separated line ids')
    args = ap.parse_args()
    with open(DIRECTION, encoding='utf-8') as f:
        direction = json.load(f)
    perf = bv.load_performance()
    only = set(args.only.split(',')) if args.only else None
    try:
        with open(MANIFEST, encoding='utf-8') as f:
            old = json.load(f)
    except (OSError, ValueError):
        old = {'lines': {}}
    out = {}
    performer = None
    os.makedirs(OUT_DIR, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        for lid, line in direction['lines'].items():
            sp = line['speaker']
            rel = f'{lid}.ogg'
            ogg = os.path.join(OUT_DIR, rel)
            if only is not None and lid not in only:
                if lid in old.get('lines', {}) and os.path.exists(ogg):
                    out[lid] = old['lines'][lid]
                continue
            if sp not in perf['cast']:
                bv.die(f'{lid}: no cast entry for {sp} in performance.json')
            tokens = bv.spoken_tokens(line['text'], None)
            raw = os.path.join(tmp, lid + '.raw.wav')
            wav = os.path.join(tmp, lid + '.wav')
            rec = os.path.join(bv.RECORDINGS, lid + '.wav')
            if os.path.exists(rec):
                src = 'human'
                shutil.copyfile(rec, raw)
                bv.process(raw, wav)
                words, _m = bv.align(wav, tokens, perf['cast'][sp]['lang'])
            else:
                src = 'ai'
                bv.check_take(lid, line, tokens)
                if performer is None:
                    performer = bv.Performer(perf)
                import soundfile as sf
                audio, flat, _method, stats = performer.render(lid, sp, line, float(line['max_s']), int(bv.text_hash(lid), 16))
                sf.write(raw, audio, bv.SR, subtype='FLOAT')
                bv.process(raw, wav, trim=False)
                d = bv.ff_duration(wav)
                words, k = [], 0
                for ws in tokens:
                    if not ws:
                        continue
                    words.append([round(flat[k][0], 2), round(min(flat[k + len(ws) - 1][1], d), 2)])
                    k += len(ws)
            bv.encode(wav, ogg)
            lufs, peak, dur = bv.ff_loudness(ogg)
            out[lid] = {'f': rel, 'd': round(dur, 3), 'speaker': sp, 'src': src, 'text': line['text'], 'h': bv.text_hash(line['text']), 'w': words, 'bytes': os.path.getsize(ogg)}
            print(f'  {lid:<6} {sp:<6} {src:<5} {dur:5.2f} s / {line["max_s"]:.1f}  peak {peak:6.1f} dBFS  {lufs:6.1f} LUFS  {os.path.getsize(ogg) / 1024:5.1f} KB')
    manifest = {
        'format': 1,
        'generator': 'tools/abyssal-tether-3d/voice/build_opening_vo.py',
        'codec': f'opus/ogg mono {bv.SR} Hz {bv.BITRATE}b/s, {bv.TARGET_LUFS:g} LUFS per clip, dry',
        'disclosure': bv.DISCLOSURE,
        'bytes': sum(e['bytes'] for e in out.values()),
        'lines': dict(sorted(out.items(), key=lambda kv: int(kv[0].split('-')[1]))),
    }
    with open(MANIFEST, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=1)
        f.write('\n')
    print(f'opening: {len(out)} clips, {manifest["bytes"] / 1024:.0f} KB -> {os.path.relpath(OUT_DIR, REPO)}')


if __name__ == '__main__':
    main()
