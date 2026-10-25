"""AI endpoints: queue a song for processing, read progress, fetch stems and lyrics."""

import os
import subprocess
import uuid

import flask_babel
from flask import (
    abort,
    current_app,
    jsonify,
    render_template,
    request,
    send_from_directory,
)
from flask_smorest import Blueprint

from pikaraoke.ai.store import ai_dir
from pikaraoke.lib.auth import public
from pikaraoke.lib.current_app import get_site_name, is_admin

_ = flask_babel.gettext

ai_bp = Blueprint("ai", __name__)

# Only what the worker writes; never a path from the request.
_FILES = {
    "instrumental.m4a",
    "vocals.m4a",
    "lyrics.json",
    "lyrics.lrc",
    "lyrics.enhanced.lrc",
    "lyrics.ass",
    "pitch.json",
    "beats.json",
}


def _service():
    return current_app.config["AI_SERVICE"]


@ai_bp.route("/processing")
def processing():
    """Live view of the songs being turned into karaoke."""
    return render_template(
        "processing.html", site_title=get_site_name(), title=_("Conversions"), admin=is_admin()
    )


@ai_bp.route("/api/ai/process", methods=["POST"])
def process():
    """Queue a library song for vocal removal and lyrics (admin)."""
    if not _service().enabled:
        return jsonify({"error": _("AI features are not installed")}), 503
    song = request.form.get("song") or (request.get_json(silent=True) or {}).get("song")
    song_id = _service().request(song) if song else None
    if song_id is None:
        return jsonify({"error": _("Song not found in the library")}), 404
    return jsonify({"song_id": song_id})


@ai_bp.route("/api/ai/status")
@public
def status():
    """State of every song sent to the AI worker."""
    return jsonify({"enabled": _service().enabled, "songs": _service().states()})


@ai_bp.route("/ai/files/<int:song_id>/<name>")
@public
def files(song_id: int, name: str):
    if name not in _FILES:
        abort(404)
    return send_from_directory(ai_dir(song_id), name, conditional=True)


@ai_bp.route("/api/ai/guide_volume", methods=["POST"])
def guide_volume():
    """Set how loud the original vocals play under the instrumental (admin)."""
    data = request.get_json(silent=True) or request.form
    try:
        volume = int(data.get("volume", ""))
    except ValueError:
        return jsonify({"error": _("Volume must be a number from 0 to 100")}), 400
    _service().set_guide_volume(volume)
    return jsonify({"volume": _service().guide_volume})


@ai_bp.route("/api/ai/background", methods=["POST"])
def background():
    """Switch the playing song to another background style and palette (admin)."""
    if not _service().next_background():
        return jsonify({"error": _("The song playing has no karaoke stage")}), 409
    return jsonify({"ok": True})


@ai_bp.route("/api/ai/lyrics_offset", methods=["POST"])
def lyrics_offset():
    """Shift the playing song's lyrics earlier or later, in seconds (admin)."""
    data = request.get_json(silent=True) or request.form
    try:
        delta = float(data.get("delta", ""))
    except ValueError:
        return jsonify({"error": _("The shift must be a number of seconds")}), 400
    offset = _service().nudge_lyrics(delta)
    if offset is None:
        return jsonify({"error": _("The song playing has no karaoke stage")}), 409
    return jsonify({"offset": offset})


@ai_bp.route("/api/ai/lyrics/<int:song_id>/refresh", methods=["POST"])
def refresh_lyrics(song_id: int):
    """Look for the published lyrics of a processed song again (admin)."""
    if not _service().store.get(song_id):
        abort(404)
    _service().store.update(song_id, lyrics_source=None)
    return jsonify({"ok": True})


@ai_bp.route("/api/ai/score", methods=["POST"])
@public
def score():
    """The splash reports the score it measured for the song just sung.

    Public because the TV has no admin session; only the song on screen is accepted.
    """
    data = request.get_json(silent=True) or {}
    try:
        song_id = int(data["song_id"])
        result = {
            "total": max(0, min(100, int(data["total"]))),
            "pitch": float(data["pitch"]),
            "presence": float(data["presence"]),
            "timing": float(data["timing"]),
        }
    except (KeyError, TypeError, ValueError):
        abort(400)
    if not _service().record_score(song_id, result):
        return jsonify({"error": _("That song is not playing")}), 409
    return jsonify({"ok": True})


@ai_bp.route("/api/ai/scores")
@public
def scores():
    """Best scores of a session (?session=<id>) or of all time."""
    session_id = request.args.get("session", type=int)
    limit = min(50, request.args.get("limit", 10, type=int))
    return jsonify(_service().store.top_scores(session_id, limit))


@ai_bp.route("/ai/guide/<int:song_id>")
@public
def guide(song_id: int):
    """The vocal stem, pitch-shifted to match a transposed song and cached per key."""
    semitones = request.args.get("semitones", 0, type=int)
    folder = ai_dir(song_id)
    if semitones == 0:
        return send_from_directory(folder, "vocals.m4a", conditional=True)
    name = f"vocals_{semitones:+d}.m4a"
    target = os.path.join(folder, name)
    if not os.path.exists(target):
        source = os.path.join(folder, "vocals.m4a")
        if not os.path.exists(source):
            abort(404)
        # Unique per request: the TV and a phone can ask for one key at once, and two
        # ffmpegs sharing one file break each other's faststart pass.
        partial = f"{target}.{uuid.uuid4().hex}.part.m4a"
        subprocess.run(
            [
                "ffmpeg",
                "-v",
                "error",
                "-y",
                "-i",
                source,
                "-af",
                f"rubberband=pitch={2 ** (semitones / 12)}",
                "-c:a",
                "aac",
                "-b:a",
                "160k",
                "-movflags",
                "+faststart",
                partial,
            ],
            check=True,
        )
        os.replace(partial, target)
    return send_from_directory(folder, name, conditional=True)
