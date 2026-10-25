"""The pitch-shifted vocal guide (/ai/guide), cached per key."""

from pathlib import Path
from unittest.mock import patch

from pikaraoke.ai.routes import ai_bp
from tests.conftest import make_route_app


def _fake_ffmpeg(cmd, check):
    Path(cmd[-1]).write_bytes(b"shifted")


def test_each_request_renders_into_its_own_partial_file(tmp_path):
    (tmp_path / "vocals.m4a").write_bytes(b"vocals")
    client = make_route_app(ai_bp, []).test_client()

    with (
        patch("pikaraoke.ai.routes.ai_dir", return_value=str(tmp_path)),
        patch("pikaraoke.ai.routes.subprocess.run", side_effect=_fake_ffmpeg) as run,
    ):
        client.get("/ai/guide/1?semitones=2")
        (tmp_path / "vocals_+2.m4a").unlink()
        response = client.get("/ai/guide/1?semitones=2")

    partials = [call.args[0][-1] for call in run.call_args_list]
    assert len(set(partials)) == 2
    assert response.data == b"shifted"
    assert sorted(f.name for f in tmp_path.iterdir()) == ["vocals.m4a", "vocals_+2.m4a"]


def test_a_cached_key_is_served_without_rendering_again(tmp_path):
    (tmp_path / "vocals.m4a").write_bytes(b"vocals")
    (tmp_path / "vocals_-3.m4a").write_bytes(b"cached")
    client = make_route_app(ai_bp, []).test_client()

    with (
        patch("pikaraoke.ai.routes.ai_dir", return_value=str(tmp_path)),
        patch("pikaraoke.ai.routes.subprocess.run") as run,
    ):
        response = client.get("/ai/guide/1?semitones=-3")

    run.assert_not_called()
    assert response.data == b"cached"
