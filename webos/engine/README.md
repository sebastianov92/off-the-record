# otr-mic

The USB microphone for Off the Record on an LG TV. The TV's browser cannot record
(LG's PulseAudio policy hands every capture a silent source), so this small
native program does it: it reads the mic over ALSA, runs the voice chain, plays
the voice through the TV or a USB sound card, and sends the singer's pitch to the
app for the score and the avatar.

- **Voice chain**: trim → 90 Hz high-pass → expander → feedback notches → 5-band EQ
  → compressor → de-esser → echo and reverb sends → volume → limiter at -1 dBFS.
  No lookahead anywhere: the chain adds no delay.
- **Pitch**: YIN with the same constants as `pikaraoke/static/ai/pitch-worklet.js`
  (a test checks they agree), 50 frames a second.
- **Feedback**: a 2048-point FFT every 21 ms looks for narrow, steady peaks with no
  harmonics that are not the singer's notes, and cuts each with a narrow notch
  (up to six, -9 to -24 dB, released after 30 s).
- **Latency**: through the TV, LG's ADSP adds ~112–120 ms that nothing in software
  removes; `tv/otr-mic.sh` switches the sound mode to "game" (the shortest path),
  and the default echo delay equals the measured delay, so it sounds like the
  first repeat of a karaoke echo. A USB sound card skips the ADSP.
- **Clock drift** between the mic and the output: a block is dropped or repeated
  with a crossfade when the queue leaves its band.
- **Lifecycle**: the app's heartbeat keeps it alive; hidden app, muted in 4 s;
  gone, exit in 30 s.

Protocol: [PROTOCOL.md](PROTOCOL.md). Started and stopped by `../tv/otr-mic.sh`.

## Build and test

```bash
make                 # build/otr-mic for this machine (null audio device on a Mac)
make test            # C tests with sanitizers, then the Node tests
sh docker-build.sh   # dist/otr-mic-armv7l and dist/otr-mic-aarch64, static, for the TV
```

Offline tools: `otr-mic process in.wav out.wav --params p.json` runs the chain over
a file (for tuning presets on real takes); `otr-mic pitch in.wav` prints pitch
frames; `otr-mic probe` prints the TV's sound cards and what each PCM accepts.

Vendored: tinyalsa (BSD-3-Clause) and jsmn (MIT); see `vendor/VERSIONS`.
