"""ffmpeg in and out for the AI pipeline, plus the energy envelope of the vocal stem."""

import json
import subprocess

import numpy as np

SAMPLE_RATE = 44100
WHISPER_RATE = 16000


def probe(path: str) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
        capture_output=True,
        check=True,
        text=True,
    )
    return json.loads(out.stdout)


def decode(path: str, rate: int, channels: int) -> np.ndarray:
    """Any file with an audio stream -> float32 array shaped (channels, samples)."""
    out = subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-i",
            path,
            "-map",
            "0:a:0",
            "-f",
            "f32le",
            "-ac",
            str(channels),
            "-ar",
            str(rate),
            "-",
        ],
        capture_output=True,
        check=True,
    )
    return np.frombuffer(out.stdout, dtype=np.float32).reshape(-1, channels).T.copy()


def encode_m4a(wav: np.ndarray, dest: str) -> None:
    """float32 (2, samples) at SAMPLE_RATE -> AAC in an .m4a the browser can seek."""
    pcm = np.clip(wav.T, -1.0, 1.0).astype(np.float32).tobytes()
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-y",
            "-f",
            "f32le",
            "-ar",
            str(SAMPLE_RATE),
            "-ac",
            "2",
            "-i",
            "-",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-movflags",
            "+faststart",
            dest,
        ],
        input=pcm,
        check=True,
    )


def energy_db(signal: np.ndarray, fps: int, rate: int = WHISPER_RATE) -> np.ndarray:
    hop = rate // fps
    frames = len(signal) // hop
    rms = np.sqrt(np.mean(signal[: frames * hop].reshape(frames, hop) ** 2, axis=1) + 1e-12)
    return 20 * np.log10(rms)


def voice_threshold(db: np.ndarray) -> float:
    """Loudness above which the vocal stem counts as singing, relative to its loud parts."""
    return float(max(np.percentile(db, 95) - 30, -55)) if len(db) else -55.0


def voice_regions(vocals16: np.ndarray) -> list[tuple[float, float]]:
    """Stretches of the vocal stem with singing, merging gaps under 2.5 s."""
    db = energy_db(vocals16, 10)
    if len(db) == 0:
        return []
    active = db > voice_threshold(db)
    regions: list[list[float]] = []
    for i, on in enumerate(active):
        if not on:
            continue
        t = i / 10
        if regions and t - regions[-1][1] <= 2.5:
            regions[-1][1] = t + 0.1
        else:
            regions.append([t, t + 0.1])
    duration = len(vocals16) / WHISPER_RATE
    return [(max(0.0, s - 0.6), min(duration, e + 0.6)) for s, e in regions if e - s >= 0.6]
