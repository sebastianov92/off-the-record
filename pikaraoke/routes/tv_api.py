"""What the webOS app keeps on the TV: copies of the next songs, played from the TV
instead of streamed. Admin only; the app sends its device token."""

import hashlib
import os

from flask import abort, jsonify, send_file
from flask_smorest import Blueprint

from pikaraoke.lib.current_app import get_karaoke_instance
from pikaraoke.lib.url_prefix import normalize_url_base_path

tv_api_bp = Blueprint("tv_api", __name__)

# The song playing and the next ones, as many as the app keeps.
PREFETCH = 5


def _upcoming() -> list[dict]:
    """The songs coming up that the TV can play from a copy, in order."""
    k = get_karaoke_instance()
    pc = k.playback_controller
    songs = [(pc.now_playing_filename, pc.now_playing_transpose)] if pc.now_playing_filename else []
    songs += [(item["file"], item.get("semitones", 0)) for item in k.queue_manager.queue]
    base = normalize_url_base_path(k.url_base_path)
    upcoming = []
    for path, semitones in songs[:PREFETCH]:
        source = pc.stream_manager.direct_source(path, semitones)
        if not source or not os.path.isfile(source):
            continue
        stat = os.stat(source)
        # Changes with the file, so a re-processed song is fetched again.
        digest = hashlib.sha1(f"{source}:{stat.st_size}:{stat.st_mtime_ns}".encode()).hexdigest()
        name = digest[:20] + os.path.splitext(source)[1].lower()
        upcoming.append(
            {
                "file": path,
                "name": name,
                "size": stat.st_size,
                "url": f"{base}/api/tv/media/{name}",
                "source": source,
            }
        )
    return upcoming


@tv_api_bp.route("/api/tv/prefetch")
def prefetch():
    """The next songs' files for the TV app to keep, the playing one first."""
    return jsonify(
        {"songs": [{k: v for k, v in song.items() if k != "source"} for song in _upcoming()]}
    )


@tv_api_bp.route("/api/tv/media/<name>")
def media(name: str):
    """One of the files /api/tv/prefetch lists: never any other file on the server."""
    for song in _upcoming():
        if song["name"] == name:
            return send_file(song["source"], conditional=True)
    abort(404)
