"""YouTube cookies for yt-dlp: uploaded and removed from Settings, by the admin only."""

import io
import os
import stat
from unittest.mock import patch

from pikaraoke.routes.settings import settings_bp
from tests.conftest import make_route_app

COOKIES = b"# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tabc\n"


def _post(client, data, name="cookies.txt"):
    return client.post(
        "/api/youtube_cookies",
        data={"cookies": (io.BytesIO(data), name)},
        content_type="multipart/form-data",
    )


def test_a_cookies_txt_is_kept_private(tmp_path):
    client = make_route_app(settings_bp, []).test_client()
    with patch(
        "pikaraoke.routes.settings.youtube_cookies_file", return_value=str(tmp_path / "c.txt")
    ):
        response = _post(client, COOKIES)

    assert response.get_json() == {"loaded": True}
    assert (tmp_path / "c.txt").read_bytes() == COOKIES
    assert stat.S_IMODE(os.stat(tmp_path / "c.txt").st_mode) == 0o600


def test_anything_else_is_refused(tmp_path):
    client = make_route_app(settings_bp, []).test_client()
    with patch(
        "pikaraoke.routes.settings.youtube_cookies_file", return_value=str(tmp_path / "c.txt")
    ):
        response = _post(client, b"<html>not cookies</html>")

    assert response.status_code == 400
    assert not (tmp_path / "c.txt").exists()


def test_removing_forgets_them(tmp_path):
    (tmp_path / "c.txt").write_bytes(COOKIES)
    client = make_route_app(settings_bp, []).test_client()
    with patch(
        "pikaraoke.routes.settings.youtube_cookies_file", return_value=str(tmp_path / "c.txt")
    ):
        response = client.delete("/api/youtube_cookies")

    assert response.get_json() == {"loaded": False}
    assert not (tmp_path / "c.txt").exists()


def test_a_guest_cannot_upload(tmp_path):
    client = make_route_app(settings_bp, [], admin=False).test_client()
    with patch(
        "pikaraoke.routes.settings.youtube_cookies_file", return_value=str(tmp_path / "c.txt")
    ):
        response = _post(client, COOKIES)

    assert response.status_code in (401, 403)
    assert not (tmp_path / "c.txt").exists()
