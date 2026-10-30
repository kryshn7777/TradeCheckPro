# Human voice recordings (they override the AI placeholder)

Drop one file per line here, named by its line id: `s1-open-2.wav`, `back-hot-1.wav`, ... (the ids are in
`../lines.csv` and in `docs/abyssal-tether-3d/plans/VO_SCRIPT.md`). 48 kHz, 24-bit, mono WAV, dry, the chosen take only.
Then run `python3 tools/abyssal-tether-3d/build_voices.py` (add `--no-ai` if the Kokoro model is not fetched on this
machine). Every line with a WAV ships the recording; the rest keep the AI placeholder (or the babble with `--no-ai`). No code
change: the game reads `assets/audio/voice/manifest.json`. Whether these WAVs go into git is the owner's call (about 9 MB per
minute of takes; Git LFS or a separate store is recommended).
