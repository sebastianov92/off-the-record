"""The vocal guide (/ai/guide), pitch-shifted and re-encoded on demand, cached per key and format."""

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


def test_the_tv_gets_a_mono_pcm_guide_even_in_the_original_key(tmp_path):
    (tmp_path / "vocals.m4a").write_bytes(b"vocals")
    client = make_route_app(ai_bp, []).test_client()

    with (
        patch("pikaraoke.ai.routes.ai_dir", return_value=str(tmp_path)),
        patch("pikaraoke.ai.routes.subprocess.run", side_effect=_fake_ffmpeg) as run,
    ):
        response = client.get("/ai/guide/1?semitones=0&format=wav")

    cmd = run.call_args.args[0]
    assert "rubberband" not in " ".join(cmd)
    assert cmd[cmd.index("-c:a") + 1] == "pcm_s16le"
    assert cmd[cmd.index("-ac") + 1] == "1"
    assert response.data == b"shifted"
    assert (tmp_path / "vocals_+0.wav").exists()


def test_an_unknown_format_is_refused(tmp_path):
    (tmp_path / "vocals.m4a").write_bytes(b"vocals")
    client = make_route_app(ai_bp, []).test_client()

    with (
        patch("pikaraoke.ai.routes.ai_dir", return_value=str(tmp_path)),
        patch("pikaraoke.ai.routes.subprocess.run") as run,
    ):
        response = client.get("/ai/guide/1?format=flac")

    run.assert_not_called()
    assert response.status_code == 400
