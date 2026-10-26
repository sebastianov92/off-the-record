# otr-mic protocol (v1)

The app (`webos/src/engine.ts`) and the engine ship in the same IPK, so they always
match; `proto` in `hello` is a sanity check. JSON text frames over a WebSocket on
`ws://127.0.0.1:47830`.

## Connecting

- The engine listens on 127.0.0.1 only and refuses a handshake whose `Host` is not
  `127.0.0.1:<port>` or whose `Origin` is an `http(s)` page. The app's `file://`
  page sends `null` or `file://`.
- The app launches the engine with a random token in `OTR_TOKEN`. Its first message
  must be `{"type":"auth","token":"…"}` within 2 s, or the socket closes.
- One app at a time: a second client that authenticates replaces the first (a
  reloaded page).

## App → engine

| Message | Meaning |
| --- | --- |
| `auth {token, app}` | First message. `app` is the app's version, for logs. |
| `params {…}` | The full voice settings; missing fields keep their value, everything is clamped. Sent on connect and on every change. |
| `beat` | Every 2 s. No beat for 4 s: the monitor mutes (`standby`). For 30 s: the engine exits. |
| `standby` / `resume` | The app was hidden / shown again. |
| `quit` | Exit now. |
| `measure` | Time three 1 kHz bursts from the output back into the mic; answers `measured`. |
| `onsets {on}` | Report sharp attacks (calibration clicks) as `onset`. |

`params` fields:

| Field | Range | Default |
| --- | --- | --- |
| `inputGain` | -24..24 dB | 0 |
| `hpf` | bool (90 Hz high-pass) | true |
| `gate {threshold, range}` | -90..0 dB, 0..60 dB | -50, 30 |
| `eq` | 5 × -12..12 dB: shelf 120 Hz, peaks 300 / 1200 / 3500 Hz, shelf 9 kHz | 0 |
| `comp {threshold, ratio}` | -60..0 dB, 1..20 | -18, 3 |
| `deesser {amount}` | 0..1 | 0.3 |
| `echo {mix, delayMs, feedback}` | 0..1, 1..900, 0..0.8 | 0.15, 120, 0.25 |
| `reverb {mix, size}` | 0..1, 0..1 | 0.15, 0.5 |
| `antifeedback` | bool | true |
| `micVolume` | 0..100 (70 is unity, 0.4 dB a step) | 70 |
| `mute` | bool | false |

## Engine → app

| Message | Meaning |
| --- | --- |
| `hello {proto, version, epoch, rt, input{name, card}, output{kind, pcm, period, buffer}}` | After `auth`. `epoch` is random per launch: pitch frame numbers restart with it. `rt`: the audio thread got real-time priority. |
| `tick {epoch, seq, hop, midi[], meter{peak, rms, gate, gr, notches}}` | 10 times a second. `midi` are the pitch frames since the last tick (50 a second; fractional MIDI, 0 = silence), the first numbered `seq`. Frame `k` is `k × hop` seconds into the capture. Meter values in dB: input peak and RMS, the expander's and compressor's reduction, active feedback notches. |
| `status {state, error, xruns, slips, cpu}` | Once a second. `state`: `running`, `standby`, `mic-lost` (no USB mic; retried every 2 s), `output-busy`. `cpu`: % of real time the audio thread used. |
| `measured {ms, confidence}` | Output-to-mic delay (median of three; `confidence` = bursts heard, 0..3). |
| `onset {epoch, frame}` | An attack, in (fractional) pitch frame numbers. |
