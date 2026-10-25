"""Canción de prueba sintética: acordes + bajo + percusión y una voz de `say`.

Uso: .venv/bin/python tools/make_test_song.py salida_dir [--nombre prueba] [--sin-voz]
Genera <nombre>.mp3, <nombre>.mp4 y <nombre>.letra.json (tiempos reales de cada verso).
Con --sin-voz sale solo la base, como una pista de karaoke.
La letra es original, escrita para las pruebas.
"""

import json
import subprocess
import tempfile
from pathlib import Path

import numpy as np

RATE = 44100
BPM = 100
BEAT = 60 / BPM
VOICE = "Paulina"
INTRO = 9.6  # 4 compases instrumentales antes de cantar

VERSES = [
    "La luna baila sobre el mar",
    "y yo te espero en el portal",
    "las luces cantan sin parar",
    "esta noche vamos a soñar",
    "",  # puente instrumental
    "camina lento por la ciudad",
    "que el viento sabe la verdad",
]

CHORDS = [(57, 60, 64), (53, 57, 60), (48, 52, 55), (55, 59, 62)]  # Am F C G


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def tone(freq, dur, amp, harmonics=(1, 0.5, 0.25)):
    t = np.arange(int(dur * RATE)) / RATE
    wave = sum(a * np.sin(2 * np.pi * freq * (i + 1) * t) for i, a in enumerate(harmonics))
    env = np.minimum(1, t / 0.02) * np.exp(-t * 1.8)
    return amp * wave * env


def add(out, start, seg):
    seg = seg[: max(0, len(out) - start)]
    out[start : start + len(seg)] += seg


def backing(length):
    out = np.zeros(int(length * RATE))
    bar = 4 * BEAT
    rng = np.random.default_rng(7)
    i = 0
    while i * bar < length:
        chord = CHORDS[i % len(CHORDS)]
        start = int(i * bar * RATE)
        for note in chord:
            seg = tone(midi(note), bar, 0.10)
            add(out, start, seg)
        for b in range(4):
            s = int((i * bar + b * BEAT) * RATE)
            bass = tone(midi(chord[0] - 12), BEAT, 0.22, (1, 0.3))
            add(out, s, bass)
            kick_t = np.arange(int(0.18 * RATE)) / RATE
            kick = 0.5 * np.sin(2 * np.pi * (110 - 300 * kick_t) * kick_t) * np.exp(-kick_t * 22)
            add(out, s, kick)
            h = s + int(BEAT / 2 * RATE)
            hat = (
                0.05
                * rng.standard_normal(int(0.04 * RATE))
                * np.exp(-np.arange(int(0.04 * RATE)) / 300)
            )
            add(out, h, hat)
        i += 1
    return out


def speak(text, tmp):
    aiff = Path(tmp) / f"v{abs(hash(text))}.aiff"
    subprocess.run(["say", "-v", VOICE, "-r", "150", "-o", str(aiff), text], check=True)
    pcm = subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-i",
            str(aiff),
            "-f",
            "f32le",
            "-ac",
            "1",
            "-ar",
            str(RATE),
            "-",
        ],
        capture_output=True,
        check=True,
    ).stdout
    return np.frombuffer(pcm, dtype=np.float32)


def main(dest: Path, name: str, voice: bool):
    dest.mkdir(parents=True, exist_ok=True)
    timeline = []
    with tempfile.TemporaryDirectory() as tmp:
        clips = []
        t = INTRO
        for verse in VERSES:
            if not verse:
                t += 4 * BEAT * 2  # dos compases sin voz
                continue
            clip = speak(verse, tmp)
            clips.append((t, clip))
            timeline.append(
                {"text": verse, "start": round(t, 2), "end": round(t + len(clip) / RATE, 2)}
            )
            t += max(len(clip) / RATE + 0.6, 4 * BEAT)
        length = t + 4 * BEAT * 2
        mix = backing(length)
        for start, clip in clips:
            s = int(start * RATE)
            if voice:
                add(mix, s, 0.9 * clip)
    mix = 0.9 * mix / np.max(np.abs(mix))
    stereo = np.stack([mix, mix], axis=1).astype(np.float32).tobytes()

    mp3 = dest / f"{name}.mp3"
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-y",
            "-f",
            "f32le",
            "-ar",
            str(RATE),
            "-ac",
            "2",
            "-i",
            "-",
            "-c:a",
            "libmp3lame",
            "-b:a",
            "192k",
            "-metadata",
            "title=Canción de prueba",
            "-metadata",
            "artist=Karaoke Lab",
            str(mp3),
        ],
        input=stereo,
        check=True,
    )
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            f"testsrc2=size=1280x720:rate=30:duration={length}",
            "-i",
            str(mp3),
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-preset",
            "veryfast",
            "-c:a",
            "aac",
            "-shortest",
            str(dest / f"{name}.mp4"),
        ],
        check=True,
    )
    (dest / f"{name}.letra.json").write_text(json.dumps(timeline, ensure_ascii=False, indent=1))
    print(f"{mp3} ({length:.1f} s)")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("dest", nargs="?", default=".")
    parser.add_argument("--nombre", default="prueba")
    parser.add_argument("--sin-voz", action="store_true")
    a = parser.parse_args()
    main(Path(a.dest), a.nombre, not a.sin_voz)
