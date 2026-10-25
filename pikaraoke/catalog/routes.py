"""Library page and its API: songs with filters, artists, uploads, metadata fixes."""

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

from pikaraoke.catalog.artists import fold
from pikaraoke.catalog.enrich import apply
from pikaraoke.catalog.store import MANUAL, covers_dir
from pikaraoke.lib.auth import public
from pikaraoke.lib.current_app import get_karaoke_instance, get_site_name, is_admin
from pikaraoke.lib.metadata_providers import get_provider, suggest_metadata

_ = flask_babel.gettext

catalog_bp = Blueprint("catalog", __name__)

MAX_UPLOAD_BYTES = 500 * 1024 * 1024


def _service():
    return current_app.config["CATALOG_SERVICE"]


def _song_state(song: dict) -> str:
    """One state per song for the filter: AI progress first, then metadata review."""
    if song["ai_status"] in ("queued", "processing"):
        return "processing"
    if song["ai_status"] in ("ready", "no_vocals", "error"):
        return song["ai_status"]
    return "original"


@catalog_bp.route("/library")
@public
def library():
    """The organised library: songs and artists, searchable and filtered."""
    return render_template(
        "library.html",
        site_title=get_site_name(),
        title=_("Library"),
        admin=is_admin(),
    )


@catalog_bp.route("/api/catalog/songs")
@public
def songs():
    """Songs matching the search box and filters, sorted as asked."""
    q = fold(request.args.get("q", "")).split()
    artist_id = request.args.get("artist", type=int)
    language = request.args.get("language")
    state = request.args.get("state")
    genre = request.args.get("genre")
    decade = request.args.get("decade", type=int)
    sort = request.args.get("sort", "title")

    result = []
    for song in _service().store.library():
        song["state"] = _song_state(song)
        if q and not all(term in song["search_key"] for term in q):
            continue
        if artist_id and artist_id not in {a["id"] for a in song["artists"]}:
            continue
        if language and song["language"] != language:
            continue
        if (
            state
            and song["state"] != state
            and not (state == "review" and song["metadata_status"] == "review")
        ):
            continue
        if genre and song["genre"] != genre:
            continue
        if decade and not (song["year"] and song["year"] // 10 * 10 == decade):
            continue
        del song["search_key"]
        result.append(song)

    if sort == "recent":
        result.sort(key=lambda s: s["created_at"] or "", reverse=True)
    elif sort == "artist":
        result.sort(
            key=lambda s: (
                fold(s["artists"][0]["name"]) if s["artists"] else "~",
                fold(s["title"] or ""),
            )
        )
    else:
        result.sort(key=lambda s: fold(s["title"] or s["file_path"]))
    return jsonify(result)


@catalog_bp.route("/api/catalog/filters")
@public
def filters():
    """Values the filter menus offer: only what the library actually has."""
    library = _service().store.library()
    return jsonify(
        {
            "languages": sorted({s["language"] for s in library if s["language"]}),
            "genres": sorted({s["genre"] for s in library if s["genre"]}),
            "decades": sorted({s["year"] // 10 * 10 for s in library if s["year"]}, reverse=True),
        }
    )


@catalog_bp.route("/api/catalog/artists")
@public
def artists():
    q = fold(request.args.get("q", ""))
    return jsonify([a for a in _service().store.artists() if q in fold(a["name"])])


@catalog_bp.route("/catalog/covers/<int:song_id>.jpg")
@public
def cover(song_id: int):
    return send_from_directory(covers_dir(), f"{song_id}.jpg", conditional=True, max_age=86400)


@catalog_bp.route("/api/catalog/upload", methods=["POST"])
def upload():
    """Add a song from a file (audio or video; only the sound is kept) (admin)."""
    if (request.content_length or 0) > MAX_UPLOAD_BYTES:
        return jsonify({"error": _("The file is too large")}), 413
    file = request.files.get("file")
    if not file or not file.filename:
        return jsonify({"error": _("No file received")}), 400
    path = _service().save_upload(file)
    return jsonify({"path": path})


@catalog_bp.route("/api/catalog/organize", methods=["POST"])
def organize():
    """Look up metadata and artists for every song not yet confirmed (admin)."""
    if not _service().organize():
        return jsonify({"error": _("The library is already being organised")}), 409
    return jsonify(_service().organizing)


@catalog_bp.route("/api/catalog/artists/merge", methods=["POST"])
def merge_artists():
    """Fold one artist into another (admin)."""
    data = request.get_json(silent=True) or {}
    source, target = data.get("source"), data.get("target")
    if not isinstance(source, int) or not isinstance(target, int):
        abort(400)
    _service().store.merge_artists(source, target)
    return jsonify({"artist": target})


@catalog_bp.route("/api/catalog/artists/<int:artist_id>/rename", methods=["POST"])
def rename_artist(artist_id: int):
    """Rename an artist; a name another artist already has merges the two (admin)."""
    name = ((request.get_json(silent=True) or {}).get("name") or "").strip()
    if not name:
        abort(400)
    return jsonify({"artist": _service().store.rename_artist(artist_id, name)})


@catalog_bp.route("/api/catalog/songs/<int:song_id>/suggestions")
def suggestions(song_id: int):
    """iTunes matches for a song, to pick the right one (admin)."""
    song = _service().store.song(song_id)
    if not song:
        abort(404)
    k = get_karaoke_instance()
    query = request.args.get("q") or k.song_manager.display_name_from_path(song["file_path"])
    return jsonify(suggest_metadata(query, get_provider(k.preferences), limit=6))


@catalog_bp.route("/api/catalog/songs/<int:song_id>/meta", methods=["POST"])
def set_meta(song_id: int):
    """Set a song's artist, title, year and genre by hand or from a suggestion (admin)."""
    if not _service().store.song(song_id):
        abort(404)
    data = request.get_json(silent=True) or {}
    title = (data.get("title") or "").strip()
    if not title:
        return jsonify({"error": _("A title is required")}), 400
    apply(
        _service().store,
        song_id,
        artist=(data.get("artist") or "").strip(),
        title=title,
        year=data.get("year"),
        genre=data.get("genre"),
        album=data.get("album"),
        artwork=data.get("artwork"),
        itunes_artist_id=data.get("artist_id"),
        status=MANUAL,
    )
    # New artist or title: the published lyrics are looked up again under them.
    current_app.config["AI_SERVICE"].store.update(song_id, lyrics_source=None)
    return jsonify({"ok": True})
