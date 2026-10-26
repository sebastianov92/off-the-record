"""Deleting a song from the library: admin only, never one in use, stems and credits go too."""

from unittest.mock import MagicMock, patch

from pikaraoke.catalog.routes import catalog_bp
from tests.conftest import make_route_app


def _client(admin=True, in_use=False):
    app = make_route_app(catalog_bp, [], admin=admin)
    service, ai = MagicMock(), MagicMock()
    service.store.song.return_value = {"id": 7, "file_path": "/songs/Song.m4a"}
    app.config["CATALOG_SERVICE"] = service
    app.config["AI_SERVICE"] = ai
    karaoke = MagicMock()
    karaoke.is_song_in_use.return_value = in_use
    return app.test_client(), karaoke, service, ai


def test_admin_deletes_the_song_its_stems_and_credits():
    client, karaoke, service, ai = _client()
    with patch("pikaraoke.catalog.routes.get_karaoke_instance", return_value=karaoke):
        response = client.delete("/api/catalog/songs/7")

    assert response.get_json() == {"deleted": 7}
    karaoke.song_manager.delete.assert_called_once_with("/songs/Song.m4a")
    ai.store.prune_orphans.assert_called_once()
    service.store.prune_artists.assert_called_once()


def test_a_song_in_the_queue_stays():
    client, karaoke, _service, _ai = _client(in_use=True)
    with patch("pikaraoke.catalog.routes.get_karaoke_instance", return_value=karaoke):
        response = client.delete("/api/catalog/songs/7")

    assert response.status_code == 409
    karaoke.song_manager.delete.assert_not_called()


def test_a_guest_cannot_delete():
    client, karaoke, _service, _ai = _client(admin=False)
    with patch("pikaraoke.catalog.routes.get_karaoke_instance", return_value=karaoke):
        response = client.delete("/api/catalog/songs/7")

    assert response.status_code in (401, 403)
    karaoke.song_manager.delete.assert_not_called()
