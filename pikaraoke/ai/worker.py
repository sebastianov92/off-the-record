"""The AI worker: a process of its own that turns queued songs into karaoke tracks.

Kept out of the server process on purpose: PyTorch inside gevent would block every
greenlet for minutes and freeze playback.
"""

import argparse
import logging
import os
import shutil
import time

# The xet download client crawled at ~100 KB/s where plain HTTPS ran at ~7 MB/s.
os.environ.setdefault("HF_HUB_DISABLE_XET", "1")

from pikaraoke.ai.store import ERROR, READY, AiStore, ai_dir  # noqa: E402
from pikaraoke.lib.get_platform import get_data_directory  # noqa: E402
from pikaraoke.lib.karaoke_database import KaraokeDatabase  # noqa: E402

POLL_SECONDS = 2.0
PROGRESS_EVERY = 0.5


def _run_job(store: AiStore, job: dict, models_dir: str | None) -> None:
    from pikaraoke.ai import pipeline

    song_id = job["song_id"]
    out_dir = ai_dir(song_id)
    shutil.rmtree(out_dir, ignore_errors=True)
    os.makedirs(out_dir)
    last = [0.0]

    def progress(stage: str, percent: float) -> None:
        now = time.monotonic()
        if now - last[0] >= PROGRESS_EVERY:
            last[0] = now
            store.update(song_id, stage=stage, progress=round(percent, 1))

    logging.info(f"AI: processing {job['file_path']}")
    result = pipeline.process(
        job["file_path"],
        out_dir,
        progress,
        describe=lambda: store.song_names(song_id),
        models_dir=models_dir,
    )
    store.update(song_id, stage=None, progress=100, error=None, **result)
    logging.info(f"AI: {result['status']} in {result['seconds']} s: {job['file_path']}")


def _add_missing_melodies(store: AiStore) -> None:
    """Songs processed before scoring existed get their reference melody when idle."""
    from pikaraoke.ai import audio, pipeline

    for state in store.all_states():
        folder = ai_dir(state["song_id"])
        vocals = os.path.join(folder, "vocals.m4a")
        if state["status"] != READY or os.path.exists(os.path.join(folder, "pitch.json")):
            continue
        if os.path.exists(vocals):
            pipeline.write_melody(folder, audio.decode(vocals, audio.WHISPER_RATE, 1)[0])
            logging.info(f"AI: melody added for {state['file_path']}")


def _add_missing_beats(store: AiStore) -> None:
    """Songs processed before the avatar danced get their beats when idle."""
    from pikaraoke.ai import pipeline

    for state in store.all_states():
        folder = ai_dir(state["song_id"])
        if state["status"] != READY or os.path.exists(os.path.join(folder, "beats.json")):
            continue
        if os.path.exists(os.path.join(folder, "instrumental.m4a")):
            pipeline.write_beats(folder)
            logging.info(f"AI: beats added for {state['file_path']}")


def _refresh_one_lyrics(store: AiStore) -> bool:
    """Look for published lyrics for one processed song still without a source."""
    from pikaraoke.ai import pipeline

    pending = store.lyrics_to_refresh()
    if not pending:
        return False
    song = pending[0]
    folder = ai_dir(song["song_id"])
    if not os.path.exists(os.path.join(folder, "transcript.json")):
        store.update(song["song_id"], lyrics_source="whisper")
        return True
    artist, title = store.song_names(song["song_id"])
    try:
        result = pipeline.refresh_lyrics(folder, artist, title, song["language"])
    except Exception:  # pylint: disable=broad-exception-caught
        # Keep the transcribed lyrics rather than retrying this song forever.
        logging.exception(f"AI: lyrics refresh failed for {artist} - {title}")
        result = {"lyrics_source": "whisper"}
    store.update(song["song_id"], **result)
    logging.info(f"AI: lyrics for {artist} - {title}: {result['lyrics_source']}")
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description="PiKaraoke AI worker")
    parser.add_argument("--db", default=os.path.join(get_data_directory(), "pikaraoke.db"))
    parser.add_argument("--models-dir", default=os.environ.get("PIKARAOKE_MODELS_DIR"))
    args = parser.parse_args()
    if args.models_dir:
        os.environ.setdefault("HF_HOME", args.models_dir)

    logging.basicConfig(level=logging.INFO, format="[%(asctime)s] AI %(levelname)s: %(message)s")
    try:
        os.nice(10)
    except (AttributeError, OSError) as e:
        logging.debug(f"Could not lower worker priority: {e}")

    store = AiStore(KaraokeDatabase(args.db))
    store.requeue_interrupted()
    _add_missing_melodies(store)
    _add_missing_beats(store)
    while True:
        job = store.claim_next()
        if job is None:
            if not _refresh_one_lyrics(store):
                time.sleep(POLL_SECONDS)
            continue
        try:
            _run_job(store, job, args.models_dir)
        except Exception as e:  # pylint: disable=broad-exception-caught
            # One bad file must not stop the queue; the error is shown on the song.
            logging.exception(f"AI: failed on {job['file_path']}")
            store.update(job["song_id"], status=ERROR, stage=None, error=str(e) or type(e).__name__)


if __name__ == "__main__":
    main()
