"""The webOS app's song cache: the next songs' files, and only those, for the admin."""

from unittest.mock import MagicMock, patch

from pikaraoke.routes.tv_api import tv_api_bp
from tests.conftest import make_route_app


def _karaoke(tmp_path, queue, playing="now.mp4", direct=lambda path, semitones: path):
    for name in [playing, *queue]:
        if name:
            (tmp_path / name).write_bytes(b"x" * 10)
    k = MagicMock()
    k.url_base_path = ""
    k.playback_controller.now_playing_filename = str(tmp_path / playing) if playing else None
    k.playback_controller.now_playing_transpose = 0
    k.queue_manager.queue = [{"file": str(tmp_path / name), "semitones": 0} for name in queue]
    k.playback_controller.stream_manager.direct_source.side_effect = direct
    return k


def _get(k, url, admin=True):
    client = make_route_app(tv_api_bp, [], admin=admin).test_client()
    with patch("pikaraoke.routes.tv_api.get_karaoke_instance", return_value=k):
        return client.get(url)


def test_the_playing_song_and_the_next_four_in_order(tmp_path):
    k = _karaoke(tmp_path, [f"q{i}.mp4" for i in range(6)])

    songs = _get(k, "/api/tv/prefetch").get_json()["songs"]

    assert [s["file"].rsplit("/", 1)[1] for s in songs] == [
        "now.mp4",
        "q0.mp4",
        "q1.mp4",
        "q2.mp4",
        "q3.mp4",
    ]
    assert all(s["name"].endswith(".mp4") and s["size"] == 10 for s in songs)
    assert "source" not in songs[0]


def test_a_song_the_stream_must_transform_is_not_offered(tmp_path):
    k = _karaoke(
        tmp_path, ["q0.mp4", "q1.cdg"], direct=lambda p, s: None if p.endswith(".cdg") else p
    )

    songs = _get(k, "/api/tv/prefetch").get_json()["songs"]

    assert [s["file"].rsplit("/", 1)[1] for s in songs] == ["now.mp4", "q0.mp4"]


def test_a_listed_file_downloads_and_nothing_else_does(tmp_path):
    k = _karaoke(tmp_path, ["q0.mp4"])
    name = _get(k, "/api/tv/prefetch").get_json()["songs"][1]["name"]

    assert _get(k, f"/api/tv/media/{name}").data == b"x" * 10
    assert _get(k, "/api/tv/media/0123456789abcdef0123.mp4").status_code == 404


def test_a_guest_gets_nothing(tmp_path):
    k = _karaoke(tmp_path, ["q0.mp4"])

    assert _get(k, "/api/tv/prefetch", admin=False).status_code in (401, 403)
