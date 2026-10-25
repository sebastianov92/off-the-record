"""Server side of the AI feature: starts the worker, queues songs, pushes progress."""

import atexit
import importlib.util
import logging
import os
import subprocess
import sys
import time

from gevent import spawn

from pikaraoke.ai.store import PROCESSING, QUEUED, READY, AiStore, ai_dir
from pikaraoke.lib.get_platform import get_data_directory
from pikaraoke.lib.url_prefix import normalize_url_base_path

WATCH_SECONDS = 1.0
PRUNE_SECONDS = 60.0
GUIDE_VOLUME_KEY = "ai_guide_volume"


def ai_available() -> bool:
    """The `ai` extra is optional; without it PiKaraoke behaves exactly like upstream."""
    return all(importlib.util.find_spec(m) for m in ("torch", "demucs", "faster_whisper"))


class AiService:
    def __init__(self, karaoke) -> None:
        self._karaoke = karaoke
        self.store = AiStore(karaoke.db)
        self.enabled = ai_available()
        self._worker: subprocess.Popen | None = None
        self._snapshot: dict[int, dict] = {}

    def start(self) -> None:
        self._idle_on_gradient()
        if not self.enabled:
            logging.info("AI features off: install the 'ai' extra to enable them")
            return
        self._attach()
        self._start_worker()
        atexit.register(self._stop_worker)
        spawn(self._watch)

    def _idle_on_gradient(self) -> None:
        """The TV idles on Off the Record's own gradient (static/ai/splash.js), with or without
        the AI extra, so the sea video that ships as the default goes. A video the
        host chose with --bg-video-path stays, and the gradient steps aside for it."""
        if self._karaoke.bg_video_path == self._karaoke.default_bg_video_path:
            self._karaoke.bg_video_path = None

    def request(self, song_path: str) -> int | None:
        """Queue a library song; None when the path is not in the library."""
        song_id, _ = self._karaoke.db.get_song_identity(song_path)
        if song_id is None:
            return None
        self.store.request(song_id)
        return song_id

    def states(self) -> list[dict]:
        return self.store.all_states()

    @property
    def guide_volume(self) -> int:
        """Volume (0-100) of the original vocals mixed under the instrumental; 0 = off."""
        return int(self._karaoke.db.get_metadata(GUIDE_VOLUME_KEY) or 0)

    def set_guide_volume(self, volume: int) -> None:
        volume = max(0, min(100, volume))
        self._karaoke.db.set_metadata(GUIDE_VOLUME_KEY, str(volume))
        self._emit("ai_guide_volume", {"volume": volume})

    def next_background(self) -> bool:
        """Give the song on screen the next background; False if it has no AI stage."""
        state = self._now_playing_state()
        if not state:
            return False
        variant = int(state["background"] or 0) + 1
        self.store.update(state["song_id"], background=str(variant))
        self._karaoke.update_now_playing_socket()
        return True

    def nudge_lyrics(self, delta: float) -> float | None:
        """Shift the lyrics of the song on screen; positive shows them later."""
        state = self._now_playing_state()
        if not state:
            return None
        offset = round(max(-5.0, min(5.0, (state["lyrics_offset"] or 0) + delta)), 2)
        self.store.update(state["song_id"], lyrics_offset=offset)
        self._karaoke.update_now_playing_socket()
        return offset

    def record_score(self, song_id: int, score: dict) -> bool:
        """Keep a score for the performance under way; False if it is not that song's."""
        state = self._now_playing_state()
        play_id = self._karaoke.play_history.current_play_id
        if not state or state["song_id"] != song_id or play_id is None:
            return False
        self.store.save_score(play_id, song_id, score)
        return True

    def _now_playing_state(self) -> dict | None:
        state = self._state(self._karaoke.playback_controller.now_playing_filename)
        return state if state and state["status"] == READY else None

    def _state(self, song_path: str | None) -> dict | None:
        if not song_path:
            return None
        song_id, _ = self._karaoke.db.get_song_identity(song_path)
        return self.store.get(song_id) if song_id is not None else None

    def _is_ready(self, song_path: str) -> bool:
        state = self._state(song_path)
        return not state or state["status"] not in (QUEUED, PROCESSING)

    def _instrumental_for(self, song_path: str) -> str | None:
        state = self._state(song_path)
        if not state or state["status"] != READY:
            return None
        path = os.path.join(ai_dir(state["song_id"]), "instrumental.m4a")
        return path if os.path.exists(path) else None

    def _now_playing_info(self, song_path: str | None, semitones: int) -> dict | None:
        """What the splash needs to sing a processed song: lyrics, vocal guide, look."""
        state = self._state(song_path)
        if not state or state["status"] != READY:
            return None
        base = normalize_url_base_path(self._karaoke.url_base_path)
        song_id = state["song_id"]
        return {
            "song_id": song_id,
            "lyrics_url": f"{base}/ai/files/{song_id}/lyrics.json",
            "pitch_url": f"{base}/ai/files/{song_id}/pitch.json",
            "beats_url": f"{base}/ai/files/{song_id}/beats.json",
            "guide_url": f"{base}/ai/guide/{song_id}?semitones={semitones}",
            "guide_volume": self.guide_volume,
            "lyrics_offset": state["lyrics_offset"] or 0,
            "background": state["background"],
        }

    def _attach(self) -> None:
        """Plug into the core: unready songs wait, the instrumental replaces the audio."""
        self._karaoke.queue_manager.is_ready = self._is_ready
        self._karaoke.playback_controller.stream_manager.audio_source = self._instrumental_for
        self._karaoke.now_playing_ai = self._now_playing_info
        self._karaoke.events.on("song_downloaded", self._on_downloaded)

    def _on_downloaded(self, song_path: str, _youtube_id: str | None) -> None:
        """Originals arrive as sound only (m4a); karaoke videos already carry lyrics."""
        if song_path.lower().endswith(".m4a"):
            self.request(song_path)

    def _start_worker(self) -> None:
        cmd = [
            sys.executable,
            "-m",
            "pikaraoke.ai.worker",
            "--db",
            os.path.join(get_data_directory(), "pikaraoke.db"),
        ]
        self._worker = subprocess.Popen(cmd)
        logging.info(f"AI worker started (pid {self._worker.pid})")

    def _stop_worker(self) -> None:
        if self._worker and self._worker.poll() is None:
            self._worker.terminate()

    def _watch(self) -> None:
        """Restart a dead worker and push every change in ai_songs to the browsers."""
        last_prune = 0.0
        while True:
            if self._worker and self._worker.poll() is not None:
                logging.warning(f"AI worker exited ({self._worker.returncode}); restarting")
                self._start_worker()
            if time.monotonic() - last_prune > PRUNE_SECONDS:
                last_prune = time.monotonic()
                self.store.prune_orphans()
            for state in self.store.all_states():
                if self._snapshot.get(state["song_id"]) != state:
                    self._snapshot[state["song_id"]] = state
                    self._emit("ai_status", state)
            time.sleep(WATCH_SECONDS)

    def _emit(self, event: str, data: dict) -> None:
        if self._karaoke.socketio:
            self._karaoke.socketio.emit(event, data, namespace="/")
