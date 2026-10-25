"""Vocal / instrumental separation with Demucs."""

import logging
import os
from collections.abc import Callable

import numpy as np

DEMUCS_MODEL = os.environ.get("PIKARAOKE_DEMUCS_MODEL", "htdemucs")

_model = None


def device() -> str:
    """`PIKARAOKE_AI_DEVICE` wins; otherwise the Apple GPU when there is one, else CPU."""
    import torch

    wanted = os.environ.get("PIKARAOKE_AI_DEVICE", "auto")
    if wanted != "auto":
        return wanted
    if torch.cuda.is_available():
        return "cuda"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def separate(mix: np.ndarray, progress: Callable[[float], None]) -> tuple[np.ndarray, np.ndarray]:
    """Stereo mix at 44.1 kHz -> (vocals, instrumental), same shape."""
    global _model
    import torch
    from demucs.apply import apply_model
    from demucs.pretrained import get_model

    if _model is None:
        _model = get_model(DEMUCS_MODEL)
        _model.eval()

    wav = torch.from_numpy(mix)
    ref = wav.mean(0)
    mean, std = ref.mean(), ref.std() + 1e-8
    wav = (wav - mean) / std

    length = wav.shape[-1]
    # Pretrained models come as a bag; the chunk length lives on each model inside it.
    inner = getattr(_model, "models", [_model])
    segment = int(float(inner[0].segment) * inner[0].samplerate)
    models = len(inner)

    def on_chunk(d: dict) -> None:
        if d.get("state") == "end":
            done = min(1.0, (d["segment_offset"] + segment) / length)
            progress((d.get("model_idx_in_bag", 0) + done) / models)

    def run(dev: str) -> "torch.Tensor":
        return apply_model(
            _model, wav[None], device=dev, shifts=1, split=True, overlap=0.25, callback=on_chunk
        )[0]

    dev = device()
    try:
        sources = run(dev)
    except RuntimeError as e:
        if dev == "cpu":
            raise
        logging.warning(f"Demucs failed on {dev} ({e}); retrying on CPU")
        sources = run("cpu")

    sources = (sources * std + mean).cpu().numpy()
    vocals = sources[list(_model.sources).index("vocals")]
    return vocals, sources.sum(0) - vocals
