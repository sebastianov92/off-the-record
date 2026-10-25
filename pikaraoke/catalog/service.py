"""Server side of the organised library: metadata on arrival, uploads, bulk tidy-up."""

import logging
import os
import subprocess
import tempfile

from gevent import spawn
from werkzeug.datastructures import FileStorage

from pikaraoke.catalog.enrich import enrich_song, file_tags
from pikaraoke.catalog.store import CatalogStore
from pikaraoke.lib.metadata_parser import sanitize_filename
from pikaraoke.lib.metadata_providers import get_provider


class CatalogService:
    def __init__(self, karaoke) -> None:
        self._karaoke = karaoke
        self.store = CatalogStore(karaoke.db)
        self.organizing: dict | None = None  # {"done": n, "total": n} while a tidy-up runs

    def start(self) -> None:
        # After Karaoke's own handler, so the song is already in the library.
        self._karaoke.events.on("song_downloaded", self._on_downloaded)
        self.store.prune_artists()

    def _on_downloaded(self, song_path: str, _youtube_id: str | None) -> None:
        spawn(self.enrich_path, song_path)

    def enrich_path(self, song_path: str) -> None:
        song_id, _ = self._karaoke.db.get_song_identity(song_path)
        if song_id is None:
            return
        display = self._karaoke.song_manager.display_name_from_path(song_path)
        enrich_song(
            self.store, song_id, song_path, display, get_provider(self._karaoke.preferences)
        )
        self._emit("catalog_update", {"song_id": song_id})

    def organize(self) -> bool:
        """Look up metadata for every song not yet confirmed; False if already running."""
        if self.organizing is not None:
            return False
        songs = self.store.songs_to_organize()
        self.organizing = {"done": 0, "total": len(songs)}
        spawn(self._organize, songs)
        return True

    def _organize(self, songs: list[dict]) -> None:
        try:
            for song in songs:
                try:
                    self.enrich_path(song["file_path"])
                except (OSError, ValueError) as e:
                    logging.warning(f"Could not organize {song['file_path']}: {e}")
                self.organizing["done"] += 1
                self._emit("catalog_progress", self.organizing)
        finally:
            self.store.prune_artists()
            self.organizing = None
            self._emit("catalog_progress", {"done": len(songs), "total": len(songs)})

    def save_upload(self, upload: FileStorage) -> str:
        """Store an uploaded song as m4a sound only, then announce it like a download."""
        songs_dir = self._karaoke.download_path
        suffix = os.path.splitext(upload.filename or "")[1]
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            upload.save(tmp)
        try:
            tags = file_tags(tmp.name)
            if tags.get("artist") and tags.get("title"):
                stem = f"{tags['artist']} - {tags['title']}"
            else:
                stem = os.path.splitext(os.path.basename(upload.filename or "song"))[0]
            dest = self._free_path(songs_dir, sanitize_filename(stem) or "song")
            subprocess.run(
                [
                    "ffmpeg",
                    "-v",
                    "error",
                    "-y",
                    "-i",
                    tmp.name,
                    "-vn",
                    "-map",
                    "0:a:0",
                    "-c:a",
                    "aac",
                    "-b:a",
                    "192k",
                    "-movflags",
                    "+faststart",
                    dest,
                ],
                check=True,
            )
        finally:
            os.remove(tmp.name)
        self._karaoke.events.emit("song_downloaded", dest, None)
        return dest

    @staticmethod
    def _free_path(folder: str, stem: str) -> str:
        path = os.path.join(folder, f"{stem}.m4a")
        n = 2
        while os.path.exists(path):
            path = os.path.join(folder, f"{stem} ({n}).m4a")
            n += 1
        return path

    def _emit(self, event: str, data: dict) -> None:
        if self._karaoke.socketio:
            self._karaoke.socketio.emit(event, data, namespace="/")
